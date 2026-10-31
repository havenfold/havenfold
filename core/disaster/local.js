// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// local.js — keşif ve bağ oturumu (RFC-0012 §6.2, §6.3, §6.6, §9.3): etiket listesi (AFET_TAGS), tarayanın eşleşmesi, yerel
// ağ duyurusu, duyuru aralığı, bağ türü kapısı ve Noise IK + HELLO ile bağ oturumu. Soket açmaz: ham bayt akışını (yerel ağda
// TCP, telefonda Bluetooth akışı) ve UDP gönderimini ürünün yerel modülü ya da düğüm verir.
//
// Yerel ağ oturumu HELLO'dan sonra olağan doğrudan oturumdur (bütün zarf türleri; çekirdeğin oturum süzgeci geçerli).
// Bağlanan Noise'tan önce eşleşen etiketi gönderir; karşılayan çifti bundan bulur (açıklama 1 madde 2).
// Bluetooth, Wi-Fi Direct ve Multipeer bağlarında yalnız HELLO, HELLO_OK, PING, PONG ve 0xB0–0xB5 geçer; başka tür gelirse
// oturum kapanır (DISASTER_TYPE_FORBIDDEN).
const b4a = require('b4a')
const c = require('compact-encoding')
const NoiseSecretStream = require('@hyperswarm/secret-stream')
const { Duplex } = require('streamx')
const { zarf: { Z: ZARF }, messages: MS, hello: H } = require('@havenfold/core')
const T = require('./derivation')
const M = require('./message')
const { cerceve } = require('./engine')

const hex = (b) => b4a.toString(b, 'hex')
const SN = 1000
const DK = 60 * SN

const YEREL_AG = { adres: '239.255.72.70', port: 47870 } // §6.6, §13: UDP çok noktaya yayın, yalnız IPv4
const BAG = { YEREL: 'yerel', BLUETOOTH: 'bluetooth', WIFI_DIRECT: 'wifi-direct', MULTIPEER: 'multipeer' }
const AFET_BAGI = new Set([ZARF.HELLO, ZARF.HELLO_OK, ZARF.PING, ZARF.PONG, ...Object.values(M.Z)])
const YOK_SAY_MS = 15 * DK // §6.2: eşleşmeyen Bluetooth adresi
const EN_COK_BAG = 3 // §6.4, §9.2: aynı anda en çok 3 bağlantı
const HELLO_MS = 10 * SN
// Yerel ağ bağı olağan doğrudan oturumdur: en büyük çerçeve gövdesi taşıyıcınınkiyle aynı (transport EN_BUYUK_GOVDE;
// records/sync.js DIRECT_MAX REC_OPS'u 1 MiB'a kadar paketler). Afet bağlarında message.js SINIR.cerceve (256 KiB)
const YEREL_CERCEVE = 1024 * 1024

/** Bağ türü kapısı (§6.3 madde 3): null (geçer) ya da 'DISASTER_TYPE_FORBIDDEN' */
function kapi (bag, tur) {
  if (bag === BAG.YEREL) return null
  return AFET_BAGI.has(tur) ? null : 'DISASTER_TYPE_FORBIDDEN'
}

// Belirlenimci karıştırma için rastgele kaynağı: rastgele(n) → n bayt
function karistir (dizi, rastgele) {
  const a = [...dizi]
  for (let i = a.length - 1; i > 0; i--) {
    const r = rastgele(4)
    const j = (((r[0] << 24) | (r[1] << 16) | (r[2] << 8) | r[3]) >>> 0) % (i + 1)
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/**
 * Reklam yapanın etiket listesi (§6.2): her çift için bir etiket, rastgele baytlarla 25'e tamamlanır, her dilimde karışır.
 * Çift 25'ten çoksa her dilimde sırası kayan 25'i konur (her eş en geç birkaç dilimde bir görünür).
 * o: { ciftler: [{ id, pair }], meId, simdi, rastgele? }. Dönüş: AFET_TAGS { v, slot, tags }
 */
function etiketListesi ({ ciftler, meId, simdi, rastgele = M.rastgele }) {
  const slot = T.dilimOf(simdi)
  let secili = ciftler
  if (ciftler.length > M.SINIR.etiket) {
    const k = slot % ciftler.length
    secili = [...ciftler.slice(k), ...ciftler.slice(0, k)].slice(0, M.SINIR.etiket)
  }
  const tags = secili.map((x) => T.etiket(T.afetKey(x.pair), meId, slot))
  while (tags.length < M.SINIR.etiket) tags.push(rastgele(4))
  return { v: 1, slot, tags: karistir(tags, rastgele) }
}

/**
 * Dilim başına tek liste (açıklama 2 madde 1): aynı dilimde her okuma aynı listeyi görür (dolgu ve karıştırma dahil);
 * yoksa iki okumanın kesişimi gerçek etiketleri, yani ailenin büyüklüğünü verir. Bluetooth TAGS ve yerel ağ duyurusu
 * aynı kaynaktan okur. Dilim içinde çift kümesi değişirse liste dilim sonuna kadar aynı kalır (yeni eş en geç 15 dakikada
 * görünür; listeyi değiştirmek farkı sızdırır).
 */
class EtiketKaynagi {
  constructor ({ rastgele = M.rastgele } = {}) { this.rastgele = rastgele; this.son = null }

  /** o: { ciftler, meId, simdi }. Dönüş: AFET_TAGS { v, slot, tags } (aynı dilimde aynı nesnenin kopyası) */
  liste ({ ciftler, meId, simdi }) {
    const slot = T.dilimOf(simdi)
    if (!this.son || this.son.slot !== slot || !b4a.equals(this.son.meId, meId)) {
      this.son = { slot, meId, liste: etiketListesi({ ciftler, meId, simdi, rastgele: this.rastgele }) }
    }
    const l = this.son.liste
    return { v: l.v, slot: l.slot, tags: l.tags.map((x) => b4a.from(x)) }
  }
}

/**
 * Tarayanın eşleşmesi (§6.2): kendi her çifti için, reklam yapan = karşı taraf, bu ve önceki dilimde arar.
 * Dönüş: { cift, dilim } ya da null (bağlantı kapatılır, adres 15 dakika yok sayılır)
 */
function eslestir ({ liste, ciftler, simdi }) {
  const s = T.dilimOf(simdi)
  const var_ = new Set(liste.tags.map(hex))
  for (const cift of ciftler) {
    const key = T.afetKey(cift.pair)
    for (const d of [s, s - 1]) if (var_.has(hex(T.etiket(key, cift.id, d)))) return { cift, dilim: d }
  }
  return null
}

/** Yerel ağ duyurusu (§6.6): AFET_TAGS çerçevesi (tür baytıyla) ‖ u16be TCP portu */
function duyuruKodla (liste, port) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('DISASTER_PORT')
  const p = b4a.alloc(2)
  p[0] = port >> 8
  p[1] = port & 255
  return b4a.concat([cerceve(M.Z.AFET_TAGS, liste), p])
}

function duyuruCoz (buf) {
  if (!buf || buf.byteLength < 4 || buf[0] !== M.Z.AFET_TAGS) throw new Error('DISASTER_CORRUPT')
  const port = (buf[buf.byteLength - 2] << 8) | buf[buf.byteLength - 1]
  if (port === 0) throw new Error('DISASTER_PORT')
  return { liste: M.coz(M.Z.AFET_TAGS, buf.subarray(1, buf.byteLength - 2)), port }
}

/** §9.3: yerel ağ duyurusu aralığı (ms); KAPALI'da duyuru yok (null). o: { durum, pil, dugum: { prizde } | null } */
function duyuruAraligi ({ durum, pil = null, dugum = null }) {
  if (durum === 'KAPALI') return null
  if (dugum) return dugum.prizde || pil == null || pil >= 30 ? 30 * SN : 60 * SN
  if (durum === 'HAZIR') return 120 * SN
  if (pil == null || pil >= 30) return 30 * SN
  return pil >= 15 ? 60 * SN : 120 * SN
}

/** Eşleşmeyen adresleri 15 dakika yok sayar (§6.2, §9.2) */
class YokSayilan {
  constructor () { this.m = new Map() }
  ekle (adres, simdi) { this.m.set(adres, simdi + YOK_SAY_MS) }
  var (adres, simdi) {
    const t = this.m.get(adres)
    if (t == null) return false
    if (simdi < t) return true
    this.m.delete(adres)
    return false
  }
}

// Ham akışın başından okunan baytlardan artakalanı öne ekleyerek akışı sürdürür (etiket okunduktan sonra Noise için)
function onekli (ham, kalan) {
  const d = new Duplex({
    write (b, cb) { ham.write(b); cb() },
    final (cb) { ham.end(); cb() },
    predestroy () { ham.destroy() }
  })
  ham.on('data', (b) => d.push(b))
  ham.on('end', () => d.push(null))
  ham.on('close', () => d.destroy())
  ham.on('error', () => d.destroy())
  if (kalan.byteLength) d.push(kalan)
  return d
}

// Etiketin dilimindeki gün: iki taraf da Noise anahtarlarını bu günün afetSeed'inden türetir
const etiketGunu = (dilim) => T.gunOf(dilim * T.DILIM_MS)

/**
 * Bağ oturumu (§6.3, açıklama 1 madde 2). Bağlanan, Noise IK'den önce keşifte eşleşen etiketi (4 bayt, düz) gönderir;
 * karşılayan kendi her çifti için bu ve önceki dilimin etiketini hesaplar, eşleşen çifti ve dilimi bulur. Tanımayan
 * karşılayan bağlantıyı kapatır (DISASTER_LABEL). İki taraf anahtar çiftlerini etiketin dilimindeki günün afetSeed'inden türetir.
 * Sonra kanal bağlamalı HELLO (caps'te AFET).
 * o: { ham, baslatan, me (kimlik: memberId, signKeyPair, deviceCert), L (Ledger), bag, caps?, sureMs?,
 *      eslesme (bağlanan: eslestir() sonucu { cift, dilim }), ciftler (karşılayan: [{ id, pair }]), simdi (karşılayan: ms) }
 * Dönüş (Promise): BagOturumu. Hata: DISASTER_LABEL, DISASTER_NOISE, DISASTER_HELLO_<kod>, DISASTER_HELLO_TIMEOUT, DISASTER_CAPS
 */
function bagKur ({ ham, baslatan, me, L, bag, caps = 0, sureMs = HELLO_MS, eslesme = null, ciftler = null, simdi = null }) {
  return new Promise((resolve, reject) => {
    let bitti = false
    let s = null
    let cift = null
    let gun = null
    const zaman = setTimeout(() => son(new Error('DISASTER_HELLO_TIMEOUT')), sureMs)
    if (zaman.unref) zaman.unref()
    const son = (e, v) => {
      if (bitti) return
      bitti = true
      clearTimeout(zaman)
      if (s) s.removeListener('data', ilk)
      if (e) { (s ?? ham).destroy(); reject(e) } else resolve(v)
    }
    const ilk = (b) => {
      if (b.byteLength < 1 || b[0] !== ZARF.HELLO) return son(new Error('DISASTER_HELLO_CORRUPT'))
      let h
      try { h = c.decode(MS.hello, b.subarray(1)) } catch { return son(new Error('DISASTER_HELLO_CORRUPT')) }
      const r = H.verifyHello(h, s, L, hex(cift.id))
      if (!r.ok) return son(new Error('DISASTER_HELLO_' + r.code))
      if (!(h.caps & H.CAPS.AFET)) return son(new Error('DISASTER_CAPS'))
      son(null, new BagOturumu(s, { bag, karsi: hex(cift.id), rol: r.role, caps: h.caps, baslatan }))
    }
    const noise = (akis) => {
      const ac = { pattern: 'IK', keyPair: T.anahtarCifti(cift.pair, me.memberId, gun) }
      const karsiAnahtar = T.anahtarCifti(cift.pair, cift.id, gun).publicKey
      if (baslatan) ac.remotePublicKey = karsiAnahtar
      s = new NoiseSecretStream(baslatan, akis, ac)
      s.on('error', () => son(new Error('DISASTER_NOISE')))
      s.on('close', () => son(new Error('DISASTER_NOISE')))
      s.opened.then((ok) => {
        if (!ok || bitti) return son(new Error('DISASTER_NOISE'))
        // Karşılayan: Noise'ta gelen statik anahtar etiketin çiftindeki karşı tarafın o günkü anahtarı olmalı
        if (!b4a.equals(s.remotePublicKey, karsiAnahtar)) return son(new Error('DISASTER_NOISE'))
        s.on('data', ilk)
        s.write(b4a.concat([b4a.from([ZARF.HELLO]), c.encode(MS.hello, H.createHello(me, s, L, caps | H.CAPS.AFET))]))
      })
    }
    if (baslatan) {
      cift = eslesme.cift
      gun = etiketGunu(eslesme.dilim)
      ham.write(T.etiket(T.afetKey(cift.pair), cift.id, eslesme.dilim))
      return noise(ham)
    }
    // Karşılayan: ilk 4 bayt etiket
    let birikmis = b4a.alloc(0)
    const kapandi = () => son(new Error('DISASTER_LABEL'))
    const topla = (b) => {
      birikmis = b4a.concat([birikmis, b])
      if (birikmis.byteLength < 4) return
      ham.removeListener('data', topla)
      ham.removeListener('close', kapandi)
      const etiket = birikmis.subarray(0, 4)
      const d = T.dilimOf(simdi)
      for (const x of ciftler) {
        const key = T.afetKey(x.pair)
        for (const dilim of [d, d - 1]) {
          if (b4a.equals(T.etiket(key, me.memberId, dilim), etiket)) { cift = x; gun = etiketGunu(dilim); break }
        }
        if (cift) break
      }
      if (!cift) return son(new Error('DISASTER_LABEL'))
      noise(onekli(ham, birikmis.subarray(4)))
    }
    ham.on('data', topla)
    ham.on('close', kapandi)
  })
}

/** HELLO'dan sonraki bağ: çerçeve = tür ‖ gövde. Afet bağlarında kapı uygulanır; ihlal oturumu kapatır */
class BagOturumu {
  constructor (socket, { bag, karsi, rol, caps, baslatan = false }) {
    this.socket = socket
    this.bag = bag
    this.baslatan = !!baslatan // grup sahibi (Wi-Fi Direct yükseltmesi, RFC-0012 §6.5) başlatmayan taraftır
    this.karsi = karsi
    this.rol = rol
    this.caps = caps
    this.kapandi = null
    this.dinleyici = null
    this.kuyruk = [] // dinle()'den önce gelen çerçeveler (HELLO ile ilk HAVE aynı okumada gelebilir; inceleme 21 B8)
    socket.on('data', (b) => this._al(b))
    // Karşı taraf yazmayı bitirdi: biz de bitiririz, soket iki yönde kapanır
    socket.on('end', () => { if (!this.kapandi) this.kapandi = 'SHUT_DOWN'; socket.end() })
    socket.on('close', () => { if (!this.kapandi) this.kapandi = 'SHUT_DOWN' })
  }

  _al (b) {
    if (this.kapandi || b.byteLength < 1) return
    // Genel boy sınırı: tür baytı ‖ gövde; afet bağlarında en büyük meşru çerçeve (DONE) bunun çok altında (message.js
    // SINIR). Yerel ağda doğrudan oturumun sınırı (Codex 12. tur: 256 KiB üstü REC_OPS oturumu döngüyle düşürüyordu)
    if (b.byteLength > 1 + (this.bag === BAG.YEREL ? YEREL_CERCEVE : M.SINIR.cerceve)) return this.kapat('DISASTER_LENGTH', { hemen: true })
    const neden = kapi(this.bag, b[0])
    if (neden) return this.kapat(neden, { hemen: true })
    if (b[0] === ZARF.PING) return this.socket.write(b4a.from([ZARF.PONG]))
    if (this.dinleyici) this.dinleyici(b)
    else this.kuyruk.push(b)
  }

  /** Gelen çerçeveleri dinle (PING'e çekirdek cevap verir); önceden gelenler sırayla verilir */
  dinle (fn) {
    this.dinleyici = fn
    const k = this.kuyruk
    this.kuyruk = []
    for (const b of k) if (!this.kapandi) fn(b)
  }

  gonder (b) {
    if (this.kapandi) return false
    if (kapi(this.bag, b[0])) throw new Error('DISASTER_TYPE_FORBIDDEN')
    this.socket.write(b)
    return true
  }

  /**
   * Kapat. Olağan kapanışta akış end() ile kapanır: kuyruktaki yazılar (ör. son DONE) karşıya ulaşır; karşı da kapatınca
   * soket kapanır, en geç `sureMs` sonra zorla (inceleme 21 B7). Kural ihlalinde (`hemen`) hemen düşürülür.
   */
  kapat (neden = 'BITTI', { hemen = false, sureMs = 2000 } = {}) {
    if (this.kapandi) return
    this.kapandi = neden
    if (hemen) return this.socket.destroy()
    this.socket.end()
    const z = setTimeout(() => this.socket.destroy(), sureMs)
    if (z.unref) z.unref()
    this.socket.once('close', () => clearTimeout(z))
  }
}

/**
 * Bağ üstünde afet eşitlemesi (§8.2): motorun oturumunu bağa bağlar, iş bitince bağı kapatır.
 * Dönüş (Promise): { bitti, kapandi, alinan }
 */
// yukseltme (RFC-0012 §6.5; D104): { iste () → teklif | null | Promise (grup sahibi: bağı başlatmayan taraf; platform Wi-Fi
// Direct grubunu ya da Multipeer hizmetini kurar), geldi (teklif) (başlatan taraf) }. Bluetooth oturumunda iki yönde bekleyen
// veri 16 KB'ı ya da 20 mesajı aşınca grup sahibi AFET_LINK_UP'ı gönderir. Verilirse yukseltme.gonder(teklif) bağ açıkken
// uygulamanın kendi teklifini de iletir. Taşıyıcının kendisi platformdadır; burada yalnız karar ve ileti.
function afetEsitle (bagOturumu, motor, { sureMs = 30 * SN, sessizMs = 200, yukseltme = null } = {}) {
  const o = motor.oturum(b4a.from(bagOturumu.karsi, 'hex'))
  const yuksel = yukseltme && bagOturumu.bag === BAG.BLUETOOTH ? yukseltme : null
  // Yalnız geçerli teklif gider ve gelir; başlatan taraf bir oturumda bir teklifi platforma verir (Codex 7. tur)
  const linkGonder = (t) => {
    if (son || !t || M.linkHatasi(t)) return false
    bagOturumu.gonder(b4a.concat([b4a.from([M.Z.AFET_LINK_UP]), M.kodla(M.Z.AFET_LINK_UP, t)]))
    return true
  }
  let istendi = false
  let geldi = false
  const yukseltmeDene = () => {
    if (!yuksel || istendi || bagOturumu.baslatan || !o.yukseltmeGerekli()) return
    istendi = true
    Promise.resolve().then(() => yuksel.iste()).then(linkGonder, () => {})
  }
  if (yuksel) yuksel.gonder = linkGonder
  let son = false
  return new Promise((resolve) => {
    let sessiz = null
    const bitir = (neden) => {
      if (son) return
      son = true
      clearTimeout(zaman)
      clearTimeout(sessiz)
      // Olağan bitiş ya da karşı bitirdi: son yazılarımız (DONE, ALINDI) gitsin; yalnız hata ve süre aşımında hemen
      // (inceleme 21 B7, inceleme 22 madde 9)
      bagOturumu.kapat(neden, { hemen: neden !== 'BITTI' && neden !== 'SHUT_DOWN' })
      resolve({ bitti: o.bitti, kapandi: bagOturumu.kapandi, alinan: o.alinan })
    }
    const zaman = setTimeout(() => bitir('SURE'), sureMs)
    if (zaman.unref) zaman.unref()
    bagOturumu.socket.on('close', () => bitir(bagOturumu.kapandi ?? 'SHUT_DOWN'))
    bagOturumu.socket.on('end', () => bitir(bagOturumu.kapandi ?? 'SHUT_DOWN'))
    bagOturumu.dinle((b) => {
      try {
        if (b[0] === M.Z.AFET_LINK_UP) {
          const t = M.coz(M.Z.AFET_LINK_UP, b.subarray(1))
          const hata = M.linkHatasi(t)
          if (hata) return bitir(hata) // kimliği doğrulanmış karşının bozuk teklifi: oturum biter
          if (yuksel && bagOturumu.baslatan && !geldi && typeof yuksel.geldi === 'function') { geldi = true; yuksel.geldi(t) }
          return
        }
        for (const x of o.al(b)) bagOturumu.gonder(x)
        yukseltmeDene()
      } catch (e) { return bitir(e.message) }
      // Kendi işimiz bitince karşının son çerçeveleri (ör. teslim bilgisi) için akış kısa bir sessizlik boyunca açık kalır
      if (o.bitti) { clearTimeout(sessiz); sessiz = setTimeout(() => bitir('BITTI'), sessizMs) }
    })
    for (const x of o.basla()) bagOturumu.gonder(x)
  }).finally(() => { if (yuksel) yuksel.gonder = () => false })
}

/**
 * Yerel ağ yolunda HELLO'dan sonraki olağan oturum (§6.6): taşıyıcının esitleyici kancasına ({ baglandi, al, koptu })
 * bağlanır; gelen her zarf `al(peer, tür, gövde, 'dogrudan')` ile çekirdeğin giriş noktasına gider (oturum süzgeci orada).
 * Dönüş: { gonder (tür, gövde) → bool, kapat () }
 */
function olaganOturum (bagOturumu, isl) {
  const karsi = bagOturumu.karsi
  isl.baglandi(karsi, { caps: bagOturumu.caps })
  bagOturumu.dinle((b) => isl.al(karsi, b[0], b4a.from(b.subarray(1)), 'dogrudan'))
  bagOturumu.socket.on('close', () => isl.koptu(karsi))
  return {
    gonder: (tur, govde) => tur !== ZARF.HELLO && bagOturumu.gonder(b4a.concat([b4a.from([tur]), govde])),
    kapat: () => bagOturumu.kapat()
  }
}

module.exports = {
  YEREL_AG, YEREL_CERCEVE, BAG, YOK_SAY_MS, EN_COK_BAG, kapi, etiketListesi, EtiketKaynagi, eslestir, duyuruKodla, duyuruCoz, duyuruAraligi, YokSayilan,
  bagKur, BagOturumu, afetEsitle, onekli, olaganOturum
}
