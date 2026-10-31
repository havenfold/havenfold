// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// ceremony.js (@havenfold/transport) — tören taşıyıcısının deneme sürümü (D43; kollar/D-tasiyici-oneri.md §4). VARSAYILAN KAPALI.
//
// CeremonyApi'nin { davet, katil } kancası (ve kutunun ya da işçinin QR'ı için kutuDavet, isciDavet) HyperDHT üstünde:
//   QR   yuva://j/2/ ‖ base64url(v=2, kind, famHint(8), inv(16), rv(32), sec(16), exp)  rv: QR'ı gösterenin rastgele
//        buluşma açık anahtarı; sec: davet sırrı. Gösteren yalnız sec'ten türeyen arama anahtarını kabul eder.
//   Akış JOIN_HELLO ⇄ (sertifika, ad, cihaz, geçici X25519 anahtarı, el sıkışma özetine ve caps'e bağlı MAC) → iki tarafta 5
//        resim → aile tarafı onaylayınca JOIN_DRAFT (davet edenin imzalı ADD_MEMBER'ı) → yeni gelen onaylayınca JOIN_SIG
//        (yeni gelenin imzası) → aile tarafı uygular, JOIN_LEDGER → yeni gelen defteri bağlar (aileBagla).
//        İşçi töreninde (kind 2, TOREN.CIHAZ; kurucu §6.4, RFC-0003 §5.1, RFC-0007 §9 adım 8) taslak ADD_MEMBER yerine
//        DEVICE_ATTACH'tır (sınıf 'isci', yer yok, caps boş): imzacılar yeni cihaz ve ebeveyn, akış kutununkiyle aynı.
//   5 resim: töreni anahtarı = derive(X25519(geçici anahtarlar), 'hf/toren/anahtar', sec, transkript); transkript el
//        sıkışma özetini ve iki sertifikayı kapsar; resimler derive(töreni anahtarı, 'hf/toren/sas')'ın ilk 30 biti.
// Kendi kriptomuz yok: X25519 (crypto_scalarmult), BLAKE2b (core kdf), Noise (hyperdht). Zarf türleri RFC-0003'ün
// JOIN_* numaraları. QR ekranda 60 sn'de yenilenir (yeni davet sırrı ve buluşma anahtarı; eski QR 10 sn daha yaşar),
// tek QR'ın ömrü en çok 180 sn, oturumun toplam ömrü 180 sn (Yuva Hat policy.inviteTtlSec ve invite.js; RFC-0028 §5 d,
// kurucu T8). Tarayan en çok 3 kez dener.
'use strict'
const b4a = require('b4a')
const c = require('compact-encoding')
const sodium = require('sodium-native')
const DHT = require('hyperdht')
const { EN_BUYUK_GOVDE } = require('./transport')
const { kdf, ledger: { Ledger, T, encodeEvent, decodeEvent, eventHash, signEvent, memberIdOf }, joinHello: J, hello: { CAPS }, sync: S, encoding: { decodeBody }, guestView: { buildGuestView }, quorum: { needsMore }, proposals: { UZAKTAN_ONAY_MS, sonTarih } } = require('@havenfold/core')

const hex = (b) => (typeof b === 'string' ? b : b4a.toString(b, 'hex'))
function fail (code) { throw new Error(code) }

const ONEK = 'yuva://j/2/'
const Z = { JOIN_HELLO: 0x08, JOIN_LEDGER: 0x09, JOIN_DRAFT: 0x0a, JOIN_SIG: 0x0b }
// Misafir töreninin son mesajı (D99): aile tarafı JOIN_LEDGER yerine misafirin görünümünü yollar (RFC-0019 §11.3, RFC-0030)
const GUEST_VIEW = 0x9a
const MISAFIR_EN_UZUN_MS = 90 * 86_400_000 // RFC-0003 §5.5: yazan telefon expiresAt'i en çok 90 gün sonrasına verir
const MISAFIR_VARSAYILAN_MS = 86_400_000
const TTL_SN = 180
const YENILE_MS = 60000
const UZAKTAN_KOD_MS = 10 * 60_000 // D106 K1: uzaktan davet kodunun ömrü (bağlantı olarak gider; yenilenmez)
// D106 K2: öbür imzacıların LEDGER_SIGN'ı için son tarih önerinin zamanından UZAKTAN_ONAY_MS (core proposals; her telefon
// aynı son tarihe bakar). Tören son tarihten sonra UZAKTAN_PAY_MS daha açık kalır: son anda başka telefonda tamamlanan
// ekleme eşitlemeyle gelsin; telefon saatleri arasındaki fark da bu payın içinde kalmalı
const UZAKTAN_PAY_MS = 60_000
const ARA_MS = 10000 // yenilemeden sonra önceki QR'ın yaşadığı süre (tarayan tam o anda okumuş olabilir)
const DENEME = 3
const DENEME_ARA_MS = 500
const CAPS_TAM = CAPS.LEDGER_V21 | CAPS.KAYIT | CAPS.GOREV | CAPS.COKLU_UYGULAMA | CAPS.MISAFIR_YAZAR | CAPS.AILE_ADI | CAPS.UZAKTAN_IPTAL // RFC-0030 §8, RFC-0036 §4.2, D106
const qrYapi = {
  preencode (s, m) { c.uint.preencode(s, 2); c.uint8.preencode(s, m.kind); c.fixed(8).preencode(s, m.famHint); c.fixed16.preencode(s, m.inv); c.fixed32.preencode(s, m.rv); c.fixed16.preencode(s, m.sec); c.uint.preencode(s, m.exp) },
  encode (s, m) { c.uint.encode(s, 2); c.uint8.encode(s, m.kind); c.fixed(8).encode(s, m.famHint); c.fixed16.encode(s, m.inv); c.fixed32.encode(s, m.rv); c.fixed16.encode(s, m.sec); c.uint.encode(s, m.exp) },
  decode (s) { if (c.uint.decode(s) !== 2) fail('QR_VERSION'); return { kind: c.uint8.decode(s), famHint: c.fixed(8).decode(s), inv: c.fixed16.decode(s), rv: c.fixed32.decode(s), sec: c.fixed16.decode(s), exp: c.uint.decode(s) } }
}

// QR → alanlar (D50 bulanık test bulgusu: kesik QR'da kodlayıcının "Out of bounds" hatası sızıyordu). Kanonik: sonda
// fazla bayt yok, base64url yeniden yazımı aynı. Hatalar INVALID_QR, QR_VERSION
function qrCoz (kod) {
  if (typeof kod !== 'string' || !kod.startsWith(ONEK) || kod.length > 512) fail('INVALID_QR')
  const govde = kod.slice(ONEK.length)
  if (!/^[A-Za-z0-9_-]*$/.test(govde)) fail('INVALID_QR')
  let b
  try { b = b4a.from(govde, 'base64url') } catch { fail('INVALID_QR') } // Bare geçersiz base64url'de fırlatır (D50)
  if (b4a.toString(b, 'base64url') !== govde) fail('INVALID_QR')
  const st = { start: 0, end: b.byteLength, buffer: b }
  let q
  try { q = qrYapi.decode(st) } catch (err) { fail(err && err.message === 'QR_VERSION' ? 'QR_VERSION' : 'INVALID_QR') }
  if (st.start !== st.end) fail('INVALID_QR')
  return q
}

function rastgele (n) { const b = b4a.alloc(n); sodium.randombytes_buf(b); return b }
const aramaAnahtari = (sec) => DHT.keyPair(kdf.derive(sec, 'hf/toren/arama'))
// Tören MAC'i: davet sırrıyla, el sıkışma özetine ve tarafa bağlı. caps MAC'in kapsamındadır (RFC-0021 §2 madde 81,
// RFC-0003 §2.2; İstek 81): caps = 0 iken JOIN_HELLO'da alan yazılmadığı gibi MAC'e de girmez (eski istemcinin biçimi
// aynen kalır); doluysa u64be olarak son parça. Böylece yolda bit düşürmek ya da eklemek MAC'i bozar.
// Aile adı (RFC-0036 §4.2) yazılmışsa MAC'in son parçasıdır (UTF-8 baytları); silmek ya da değiştirmek MAC'i bozar.
// Vektör: protocol/vectors/ceremony.json, protocol/vectors/ceremony-family-name.json
const mac = (sec, hs, taraf, caps = 0, aileAdi = null) => kdf.derive(sec, 'hf/toren/mac', hs, b4a.from(taraf), ...(caps ? [caps] : []), ...(aileAdi != null ? [b4a.from(aileAdi)] : []))

// Aile adını yazan tören türleri (RFC-0036 §4.3 madde 1–2): üye ve misafir; aile tarafı yalnız gösterenken
const ADLI_TOREN = new Set([J.TOREN.UYE, J.TOREN.MISAFIR])

class Oturum {
  constructor () { this.f = new Map(); this.ttlSec = TTL_SN; this.onaylandi = null }
  on (ad, fn) { if (!this.f.has(ad)) this.f.set(ad, []); this.f.get(ad).push(fn) }
  emit (ad, x) { for (const fn of this.f.get(ad) || []) fn(x) }
  confirm (ayni) { this.onaylandi = !!ayni; if (this.onay) this.onay(this.onaylandi) }
  cancel () { this.iptal = true; if (this.kapat) this.kapat('kullanici') }
}

// dht: HyperDHT düğümü; cihaz(): { kimlik, ledger (ailesiz null), defter, aileBagla(L), now, ad, cihazAdi }
// tamam(): tören bitince (eşitleme taşıyıcısı yeni üyeyi hemen arasın)
// yenileMs, araMs, sureMs: yalnız testte kısaltılır
// caps: JOIN_HELLO'nun yetenek bitleri (yalnız testte değişir: eski istemci benzetimi; AILE_ADI'sız taraf ad yazmaz).
// uzaktanKodMs, uzaktanOnayMs, uzaktanPayMs, beklemeMs: D106 süreleri (yalnız testte kısaltılır)
function dhtTorenTasiyici ({ dht, cihaz, tamam = () => {}, deneysel = false, yenileMs = YENILE_MS, araMs = ARA_MS, sureMs = TTL_SN * 1000, caps = CAPS_TAM, beklemeMs = 500, uzaktanKodMs = UZAKTAN_KOD_MS, uzaktanOnayMs = UZAKTAN_ONAY_MS, uzaktanPayMs = UZAKTAN_PAY_MS }) {
  if (deneysel !== true) fail('EXPERIMENTAL_DISABLED')

  // Aile adı (RFC-0036 §4.3 madde 1–2): aile tarafı gösterenken, üye ve misafir töreninde, karşı AILE_ADI bitini
  // bildirdiyse; değer defterin aile adı, 256 bayttan uzun ya da boşsa yazılmaz
  function yazilacakAd (o, d) {
    if (!o.aile || o.rol !== 'gosteren' || !ADLI_TOREN.has(o.kind) || !o.karsi || (caps & CAPS.AILE_ADI) === 0 || (o.karsi.caps & CAPS.AILE_ADI) === 0) return null
    const ad = d.ledger && d.ledger.familyName
    return typeof ad === 'string' && b4a.byteLength(ad) >= 1 && b4a.byteLength(ad) <= J.AILE_ADI_EN_UZUN ? ad : null
  }

  function benimHello (o) {
    const d = cihaz()
    o.eph = { pub: b4a.alloc(32), sk: b4a.alloc(32) }
    sodium.crypto_box_keypair(o.eph.pub, o.eph.sk)
    const familyName = yazilacakAd(o, d)
    return J.encodeJoinHello({ cert: d.kimlik.deviceCert, name: d.ad, device: d.cihazAdi, eph: o.eph.pub, mac: mac(o.sec, o.socket.handshakeHash, o.rol === 'gosteren' ? 's' : 'c', caps, familyName), caps, familyName })
  }

  const yaz = (o, tur, govde) => o.socket.write(b4a.concat([b4a.from([tur]), govde]))

  function sas (o) {
    const m = o.karsi
    const [ilk, ikinci] = o.rol === 'gosteren' ? [o.benCert, m.cert] : [m.cert, o.benCert]
    const ortak = b4a.alloc(32)
    // Düşük dereceli nokta: sodium-native sıfır sonuçta zaten fırlatır; pairSecret'teki gibi açıkça da denetlenir
    let zayif = false
    try { sodium.crypto_scalarmult(ortak, o.eph.sk, m.eph); zayif = sodium.sodium_is_zero(ortak) } catch { zayif = true }
    if (zayif) { sodium.sodium_memzero(ortak); sodium.sodium_memzero(o.eph.sk); fail('WEAK_KEY') }
    o.transkript = kdf.hash('hf/toren/transkript', o.socket.handshakeHash, c.encode(require('@havenfold/core').messages.deviceCert, ilk), c.encode(require('@havenfold/core').messages.deviceCert, ikinci))
    const anahtar = kdf.derive(ortak, 'hf/toren/anahtar', o.sec, o.transkript)
    sodium.sodium_memzero(ortak)
    sodium.sodium_memzero(o.eph.sk)
    const s = kdf.derive(anahtar, 'hf/toren/sas')
    // Tören anahtarı çift sırrına girer (RFC-0028 §7 c): tören başarıyla biterse iki tarafta çekirdeğe verilir
    // (cihaz().torenAnahtariKaydet), bitmezse bitir'de sıfırlanır
    o.torenAnahtari = anahtar
    const bitler = ((s[0] << 22) | (s[1] << 14) | (s[2] << 6) | (s[3] >> 2)) >>> 0 // ilk 30 bit
    sodium.sodium_memzero(s)
    o.resimler = [24, 18, 12, 6, 0].map((k) => (bitler >>> k) & 63)
    // aileAdi: yeni gelenin ekranında ailenin adı (RFC-0036 §4.3 madde 4); yoksa null
    o.oturum.emit('sas', { resimler: o.resimler, karsiAd: m.name, karsiCihaz: m.device, aileAdi: o.aile ? null : m.familyName })
    if (o.aile) {
      J.checkJoinCaps(cihaz().ledger, m.caps)
      // Uzaktan gelen 24 saat bekleyen kalır ve oturumu olmadığı için yeteneğini başka yoldan bildiremez; davet iptali
      // (D106 K1) onun defterine de girecek, eski sürüm reddederdi. Uzaktan katılım bu biti ister: SDK'nın iptal kapısı
      // (LedgerApi.revokeMember) uzaktan bekleyenleri bu yüzden sormaz (Codex 10. tur)
      if (o.uzaktan && (m.caps & CAPS.UZAKTAN_IPTAL) === 0) fail('UPDATE_REQUIRED')
    }
  }

  // Tören türünün defter olayı: cihaz töreninde DEVICE_ATTACH, öbürlerinde ADD_MEMBER
  const olayTuru = (kind) => (kind === J.TOREN.CIHAZ ? T.DEVICE_ATTACH : T.ADD_MEMBER)

  function taslakGonder (o) {
    const d = cihaz()
    if (o.kind === J.TOREN.MISAFIR) return misafirTaslagi(o, d)
    // RFC-0003 §5.1: caps ilk NODE_CAPS'tir, yalnız bilgi verir; törende henüz yok (boş). Sınıf: düğümün cihaz töreni işçidir
    const r = o.kind === J.TOREN.CIHAZ
      ? d.defter.addDevice({ deviceCert: o.karsi.cert, cls: 'isci', name: o.karsi.name, placeId: b4a.alloc(16), caps: b4a.alloc(0), ceremonyTranscriptHash: o.transkript })
      : d.defter.addMember({ deviceCert: o.karsi.cert, displayName: o.karsi.name, role: o.kind === J.TOREN.KUTU ? 'kutu' : o.uyeRol, ceremonyTranscriptHash: o.transkript, remote: !!o.uzaktan })
    if (r.durum !== 'oneri') fail('INVALID_CEREMONY')
    o.oneriId = r.oneriId
    o.taslak = encodeEvent(r.event)
    yaz(o, Z.JOIN_DRAFT, o.taslak)
  }

  // Misafir töreni (D99): GRANT taslağı (bakiciHazirla; bakıcı koleksiyonu yoksa açılır). Defterde görülmüş kimliğe ikinci
  // GRANT yoktur (RFC-0003 §5.5 tek kimlik kuralı): süren ya da biten misafirlikle yeniden tören hiçbir şey yazmadan kapanır.
  // Süre uzatma protokolde tanımlı değil (İstek 177)
  function misafirTaslagi (o, d) {
    const grantHex = hex(memberIdOf(o.karsi.cert.ukaPub))
    if (d.ledger.grants.has(grantHex) || d.ledger.members.has(grantHex) || d.ledger.devices.has(grantHex)) fail('IDENTITY_ALREADY_EXISTS')
    const ad = String(o.karsi.name || '').trim() || 'Bakıcı'
    const r = d.defter.prepareCaregiver({ deviceCert: o.karsi.cert, ad, expiresAt: o.bitis, ceremonyTranscriptHash: o.transkript })
    if (!r.event) fail('INVALID_CEREMONY')
    o.taslakOlay = r.event
    o.taslak = encodeEvent(r.event)
    yaz(o, Z.JOIN_DRAFT, o.taslak)
  }

  function taslakImzala (o) {
    const e = decodeEvent(o.taslak)
    if (e.type !== (o.kind === J.TOREN.MISAFIR ? T.GRANT : olayTuru(o.kind))) fail('INVALID_CEREMONY')
    // Misafir yalnız kendisine, bu törende (transkript) verilen misafirliği imzalar
    if (o.kind === J.TOREN.MISAFIR) {
      const g = decodeBody(T.GRANT, e.body)
      if (!b4a.equals(g.to.ukaPub, cihaz().kimlik.deviceCert.ukaPub) || !b4a.equals(g.ceremonyTranscriptHash, o.transkript)) fail('INVALID_CEREMONY')
    }
    signEvent(e, cihaz().kimlik)
    // Misafir töreninin son mesajı (GUEST_VIEW) yalnız kullanıcının onayladığı ve imzaladığı bu GRANT'a bağlanır
    o.imzalanan = eventHash(e)
    yaz(o, Z.JOIN_SIG, encodeEvent(e))
  }

  // Tören anahtarını karşı tarafın kimliğiyle çekirdeğe ver (kopyası saklanır); buradaki sıfırlanır
  function anahtarVer (o, d) {
    if (!o.torenAnahtari || typeof d.torenAnahtariKaydet !== 'function') return
    d.torenAnahtariKaydet(hex(memberIdOf(o.karsi.cert.ukaPub)), b4a.from(o.torenAnahtari))
  }

  // Üye töreninin sonu: defter yeni gelene (aile tarafı)
  function uyeyiBitir (o, d) {
    anahtarVer(o, d)
    yaz(o, Z.JOIN_LEDGER, S.encodeEvents(S.answerReq(d.ledger, { fromSeq: 0 })))
    bitir(o, 'tamam', { memberId: hex(memberIdOf(o.karsi.cert.ukaPub)) })
    tamam()
  }

  // D106 K2: yeni üye deftere girene kadar (öneri burada ya da öbür ebeveynin telefonunda tamamlanır) bekle. Bekleme
  // bir kez başlar: aynı JOIN_SIG'in tekrarı süreyi uzatmaz, ikinci bir yoklama zamanlayıcısı kurmaz (Codex 10. tur)
  function onayBekle (o, d, oneriId) {
    if (o.bekliyor) return
    o.bekliyor = true
    const yeni = hex(memberIdOf(o.karsi.cert.ukaPub))
    clearTimeout(o.zaman)
    // Son tarih önerinin kendi zamanından (öbür telefonlar da ona bakar; core proposals sonTarih); testte kısaltılmış
    // uzaktanOnayMs aynı tabana göre
    const taslak = decodeEvent(o.taslak)
    const kalan = Math.max(0, Math.min(sonTarih(taslak) ?? Infinity, taslak.ts + uzaktanOnayMs) - d.now())
    o.oturum.emit('onay-bekleniyor', { memberId: yeni, sureSn: Math.round(kalan / 1000) })
    o.zaman = setTimeout(() => {
      try { cihaz().defter.oneriler.reject(oneriId, cihaz().now()) } catch {}
      bitir(o, 'kapandi', { neden: 'QUORUM_TIMEOUT' })
    }, kalan + uzaktanPayMs)
    o.bekle = setInterval(() => {
      if (o.bitti) { clearInterval(o.bekle); return }
      const c2 = cihaz()
      if (!c2.ledger || !c2.ledger.members.has(yeni)) return
      clearInterval(o.bekle)
      try { uyeyiBitir(o, c2) } catch (err) { bitir(o, 'kapandi', { neden: err.message }) }
    }, beklemeMs)
  }

  function bitir (o, olay, x) {
    if (o.bitti) return
    o.bitti = true
    clearTimeout(o.zaman)
    clearInterval(o.yenile)
    clearInterval(o.bekle)
    if (o.eph) sodium.sodium_memzero(o.eph.sk)
    if (o.torenAnahtari) { sodium.sodium_memzero(o.torenAnahtari); o.torenAnahtari = null }
    o.imzalanan = null
    o.oturum.emit(olay, x)
    setTimeout(() => o.socket && o.socket.end(), 50)
    for (const y of o.yuvalar || []) yuvaKapat(o, y, true)
  }

  function al (o, b) {
    // Biten ya da iptal edilen törenin soketi kapanana kadar gelen mesaj işlenmez (Codex 5. tur: iptalden sonra
    // geciken GUEST_VIEW misafirliği bağlıyordu)
    if (o.bitti) return
    try {
      if (b.byteLength > 1 + EN_BUYUK_GOVDE) fail('FRAME_TOO_LARGE') // sınırlar 16: taşıyıcıyla aynı sınır
      const tur = b[0]
      const govde = b4a.from(b.subarray(1))
      if (tur === Z.JOIN_HELLO && !o.karsi) {
        const m = J.decodeJoinHello(govde)
        if (!sodium.sodium_memcmp(m.mac, mac(o.sec, o.socket.handshakeHash, o.rol === 'gosteren' ? 'c' : 's', m.caps, m.familyName))) fail('INVALID_CEREMONY')
        // Aile adını yalnız gösteren aile tarafı, üye ve misafir töreninde yazar (RFC-0036 §4.3 madde 2–3)
        if (m.familyName !== null && (o.aile || o.rol !== 'tarayan' || !ADLI_TOREN.has(o.kind))) fail('INVALID_CEREMONY')
        o.karsi = m
        if (o.rol === 'gosteren') yaz(o, Z.JOIN_HELLO, benimHello(o))
        sas(o)
        return
      }
      if (!o.karsi) fail('INVALID_CEREMONY')
      if (tur === Z.JOIN_DRAFT && !o.aile) {
        o.taslak = govde
        // Uzaktan katılım (D106 K2): aile tarafı öbür imzaları 10 dakika bekleyebilir; yeni gelenin süresi de uzar
        try {
          const te = decodeEvent(govde)
          if (te.type === T.ADD_MEMBER && decodeBody(T.ADD_MEMBER, te.body).remote) {
            clearTimeout(o.zaman)
            o.zaman = setTimeout(() => bitir(o, 'kapandi', { neden: 'QUORUM_TIMEOUT' }), uzaktanOnayMs + uzaktanPayMs + 60_000)
          }
        } catch {}
        if (o.oturum.onaylandi) taslakImzala(o)
        return
      }
      if (tur === Z.JOIN_SIG && o.aile && o.kind === J.TOREN.MISAFIR) {
        const d = cihaz()
        const e = decodeEvent(govde)
        if (!b4a.equals(eventHash(e), eventHash(o.taslakOlay))) fail('INVALID_CEREMONY')
        const grantId = memberIdOf(o.karsi.cert.ukaPub)
        const imza = e.sigs.find((x) => b4a.equals(x.memberId, grantId))
        if (!imza) fail('INVALID_CEREMONY')
        const r = d.defter.proposeCaregiver(o.taslakOlay, imza)
        if (r.durum !== 'uygulandi') fail('INVALID_CEREMONY')
        if (typeof d.bakiciEklendi === 'function') d.bakiciEklendi(r) // misafirin örtük SOS anahtarı (RFC-0031 §4.1) çekirdeğe
        anahtarVer(o, d)
        yaz(o, GUEST_VIEW, buildGuestView(d.ledger, hex(grantId), d.kimlik, { now: d.now }))
        bitir(o, 'tamam', { grantId: hex(grantId) })
        tamam()
        return
      }
      // Görünüm yalnız kullanıcı resimleri onaylayıp bu törenin GRANT taslağını imzaladıktan sonra ve o GRANT'ı taşıyorsa
      // (eski, geçerli bir görünüm onaysız bağlanamaz; açılış öncesi inceleme, Codex 4. tur)
      if (tur === GUEST_VIEW && !o.aile && o.kind === J.TOREN.MISAFIR) {
        const d = cihaz()
        if (typeof d.misafirBagla !== 'function' || !o.imzalanan) fail('INVALID_CEREMONY')
        anahtarVer(o, d) // çift sırrı misafir oturumları kurulmadan önce
        // Görünümü doğrular (acceptGuestView; GRANT bu törende imzalanan), misafir kipine geçer. Aile adı karşılaştırılmaz
        // (GUEST_VIEW ad taşımaz), misafir örneğinin yerel durumunda saklanır (RFC-0036 §4.3 madde 5a)
        d.misafirBagla(govde, { aileAdi: o.karsi.familyName, grantHash: o.imzalanan })
        bitir(o, 'tamam', { grantId: hex(d.kimlik.memberId) })
        tamam()
        return
      }
      if (tur === Z.JOIN_SIG && o.aile) {
        if (o.bekliyor) return // aynı imzanın tekrarı: bekleme zaten sürüyor
        const d = cihaz()
        const e = decodeEvent(govde)
        if (!b4a.equals(eventHash(e), eventHash(decodeEvent(o.taslak)))) fail('INVALID_CEREMONY')
        const id = d.defter.oneriler.add(e, d.now())
        const sonuc = id === o.oneriId ? d.defter.oneriler.tryApply(id) : null
        // Uzaktan ve çok onaylı (D106 K2): öbür imzacılar LEDGER_SIGN ile tamamlayana kadar en çok 10 dakika beklenir;
        // öneri olağan eşitlemeyle onlara gider (onay ekranı). Süre dolarsa QUORUM_TIMEOUT, öneri yerelde düşer
        if (sonuc === 'waiting' && o.uzaktan) return onayBekle(o, d, id)
        if (sonuc !== 'applied') fail('INVALID_CEREMONY')
        d.defter.changed()
        uyeyiBitir(o, d)
        return
      }
      if (tur === Z.JOIN_LEDGER && !o.aile) {
        const d = cihaz()
        const L = new Ledger({ now: d.now })
        const r = S.ingest(L, { fromSeq: 0, events: S.decodeEvents(govde).events })
        const ben = hex(d.kimlik.memberId)
        const katildi = o.kind === J.TOREN.CIHAZ ? L.devices.get(ben)?.active : L.members.get(ben)
        if (r.needFrom !== undefined || !katildi) fail('INVALID_CEREMONY')
        // 5 resim ekranında gösterilen ad defterinkiyle aynı olmalı (RFC-0036 §4.3 madde 5); değilse bağlanmaz, katılım
        // örneği silinir (worklet: tören kapanınca, RFC-0034 §4.3)
        if (o.karsi.familyName !== null && L.familyName !== o.karsi.familyName) fail('FAMILY_NAME_MISMATCH')
        anahtarVer(o, d) // çift sırrı oturumlar kurulmadan önce anahtarla (aileBagla eşitlemeyi başlatır)
        d.aileBagla(L)
        bitir(o, 'tamam', { memberId: hex(d.kimlik.memberId) })
        tamam()
        return
      }
      fail('INVALID_CEREMONY')
    } catch (err) {
      bitir(o, 'kapandi', { neden: err.message })
    }
  }

  function bagla (o, socket) {
    o.socket = socket
    socket.on('data', (b) => al(o, b))
    socket.on('error', () => {})
    socket.on('close', () => { if (!o.bitti) bitir(o, 'kapandi', { neden: 'baglanti' }) })
    if (o.rol === 'tarayan') yaz(o, Z.JOIN_HELLO, benimHello(o))
  }

  // QR'ı gösteren taraf. Her QR bir yuva: rastgele buluşma anahtarıyla dinleyen sunucu ve davet sırrı; yalnız o
  // sırdan türeyen arayan girer, oturumda bir kez. Yuva ara süreden sonra kapanır (bağlanılan yuva tören bitene dek).
  function yuvaKapat (o, y, hepsi = false) {
    if (y.kapali || (!hepsi && o.bagliYuva === y)) return
    y.kapali = true
    clearTimeout(y.zaman)
    y.sunucu.close().catch(() => {})
  }

  async function yeniYuva (o, kind) {
    const d = cihaz()
    const t = d.now()
    if (o.bitti || o.socket || t >= o.sonTarih) return null
    const y = { sec: rastgele(16), kapali: false }
    const izinli = aramaAnahtari(y.sec).publicKey
    const rv = DHT.keyPair(rastgele(32))
    y.sunucu = dht.createServer({ firewall: (remote) => !!o.socket || o.bitti || y.kapali || !b4a.equals(remote, izinli) }, (socket) => {
      if (o.socket || o.bitti || y.kapali) { socket.destroy(); return }
      o.sec = y.sec
      o.bagliYuva = y
      clearInterval(o.yenile)
      for (const z of o.yuvalar) yuvaKapat(o, z)
      bagla(o, socket)
    })
    o.yuvalar.push(y)
    // Tek QR ≤ 180 sn; uzaktan kod tek ve yenilenmez, ömrü 10 dakika (D106 K1)
    const olum = o.uzaktan ? o.sonTarih : Math.min(t + yenileMs + araMs, o.sonTarih)
    y.zaman = setTimeout(() => yuvaKapat(o, y), olum - t)
    o.benCert = d.kimlik.deviceCert
    const famHint = d.ledger ? b4a.from(d.ledger.familyId.subarray(0, 8)) : b4a.alloc(8)
    const qr = ONEK + b4a.toString(c.encode(qrYapi, { kind, famHint, inv: d.kimlik.memberId, rv: rv.publicKey, sec: y.sec, exp: Math.ceil(olum / 1000) }), 'base64url')
    await y.sunucu.listen(rv)
    if (o.bitti) { yuvaKapat(o, y, true); return null }
    return qr
  }

  async function goster (o, kind) {
    o.yuvalar = []
    const sure = o.uzaktan ? uzaktanKodMs : sureMs
    o.sonTarih = cihaz().now() + sure
    o.zaman = setTimeout(() => bitir(o, 'kapandi', { neden: 'sure' }), sure)
    const qr = await yeniYuva(o, kind)
    // Ekrandaki QR yenilenir (kutunun QR'ı tek; kutu ekranı yok, düğüm yazılımı gösterir)
    if (o.yenilenir) {
      o.yenile = setInterval(() => {
        yeniYuva(o, kind).then((q) => { if (q && !o.socket && !o.bitti) o.oturum.emit('qr', { qr: q, kalanSn: Math.round(yenileMs / 1000) || 60 }) }, () => {})
      }, yenileMs)
    }
    return qr
  }

  // Düğümün (ailesiz, ekransız) gösterdiği QR: kutu ve işçi töreni
  async function dugumDavet (kind, oturumla) {
    const o = { oturum: new Oturum(), rol: 'gosteren', aile: false, kind }
    o.oturum.onaylandi = true
    o.oturum.kapat = (neden) => bitir(o, 'kapandi', { neden })
    const qr = await goster(o, kind)
    return oturumla ? { qr, oturum: o.oturum } : qr
  }

  return {
    // 3 INVITE_START: QR'ı aile tarafı gösterir
    // bitis: misafir töreninde misafirliğin bitişi (ms; verilmezse 24 saat, en çok 90 gün)
    // uzaktan: uzaktan katılım (D101; kurucu ilke 2, K15): aynı tören (QR bağlantı olarak gönderilir, 5 resim sesli ya da
    // görüntülü aramada karşılaştırılır; İstek 181), ADD_MEMBER remote ve 24 saat bekleme. Yeter sayı tören içinde
    // (bu telefon + yeni gelen) tamamlanmıyorsa QR'dan önce defterin koduyla düşer (ör. NO_PARENT_APPROVAL)
    async davet ({ kind, rol, bitis = null, uzaktan = false }) {
      const simdi = cihaz().now()
      if (kind === J.TOREN.MISAFIR && bitis !== null && !(Number.isSafeInteger(bitis) && bitis > simdi && bitis <= simdi + MISAFIR_EN_UZUN_MS)) fail('INVALID_DURATION')
      if (uzaktan) {
        if (kind !== J.TOREN.UYE) fail('INVALID_TYPE')
        // Eksik imza (öbür ebeveynler, yetişkin) tören içinde beklenir (D106 K2); başka engel QR'dan önce düşer
        const eksik = cihaz().defter.remoteMissing(rol)
        if (eksik && !needsMore(cihaz().ledger, eksik)) fail(eksik)
      }
      const o = { oturum: new Oturum(), rol: 'gosteren', aile: true, kind, uyeRol: rol, yenilenir: !uzaktan, bitis: bitis ?? simdi + MISAFIR_VARSAYILAN_MS, uzaktan: !!uzaktan }
      if (uzaktan) o.oturum.ttlSec = uzaktanKodMs / 1000
      // "Farklı": CeremonyApi ardından cancel() çağırır, oturum orada kapanır
      // Taslak kurulamazsa (ör. IDENTITY_ALREADY_EXISTS) tören nedeniyle kapanır; onay komutu hata vermez
      o.oturum.onay = (ayni) => { if (ayni && o.karsi) { try { taslakGonder(o) } catch (err) { bitir(o, 'kapandi', { neden: err.message }) } } }
      o.oturum.kapat = (neden) => bitir(o, 'kapandi', { neden })
      const qr = await goster(o, kind)
      setTimeout(() => o.oturum.emit('qr', { qr, kalanSn: o.uzaktan ? uzaktanKodMs / 1000 : Math.round(yenileMs / 1000) || 60 }), 0)
      return o.oturum
    },

    // Kutu: QR'ı kutu gösterir; kendiliğinden onaylar (5 resmi aile tarafında kişi karşılaştırır). oturumla: true ise
    // { qr, oturum } döner: ekransız kutu resimleri metin olarak gösterir ('sas'), sonucu bildirir ('tamam', 'kapandi')
    kutuDavet ({ oturumla = false } = {}) { return dugumDavet(J.TOREN.KUTU, oturumla) },

    // İşçi: kutuyla aynı akış, cihaz töreni (kind 2, DEVICE_ATTACH)
    isciDavet ({ oturumla = false } = {}) { return dugumDavet(J.TOREN.CIHAZ, oturumla) },

    // 5 JOIN: QR'ı tarayan (kutu QR'ında aile tarafı)
    async katil (kod) {
      const q = qrCoz(kod)
      const d = cihaz()
      if (q.exp * 1000 < d.now()) fail('QR_EXPIRY_EXPIRED')
      const o = { oturum: new Oturum(), rol: 'tarayan', aile: !!d.ledger, kind: q.kind, sec: q.sec, benCert: d.kimlik.deviceCert }
      o.oturum.onay = (ayni) => {
        if (!ayni) return
        if (o.aile && o.karsi) taslakGonder(o)
        else if (!o.aile && o.taslak) taslakImzala(o)
      }
      o.oturum.kapat = (neden) => bitir(o, 'kapandi', { neden })
      o.zaman = setTimeout(() => bitir(o, 'kapandi', { neden: 'sure' }), sureMs)
      // Bağlantı ilk denemede kurulamayabilir (delik açma): en çok 3 deneme, 500 ms arayla (Yuva Hat accept.js gibi)
      const dene = (kalan) => {
        if (o.bitti) return
        const socket = dht.connect(q.rv, { keyPair: aramaAnahtari(q.sec) })
        socket.once('open', () => bagla(o, socket))
        socket.on('error', () => {})
        socket.once('close', () => {
          if (o.socket) return
          if (kalan > 1) setTimeout(() => dene(kalan - 1), DENEME_ARA_MS)
          else bitir(o, 'kapandi', { neden: 'baglanti' })
        })
      }
      dene(DENEME)
      return o.oturum
    }
  }
}

// QR kodu (qrCoz'un tersi; test ve RFC-0034 §4.2 famHint denetimi)
const qrKodla = (m) => ONEK + b4a.toString(c.encode(qrYapi, m), 'base64url')

module.exports = { dhtTorenTasiyici, qrCoz, qrKodla, torenMac: mac, UZAKTAN_KOD_MS, UZAKTAN_ONAY_MS, UZAKTAN_PAY_MS, TOREN_TURLERI: new Set(Object.values(Z)) }
