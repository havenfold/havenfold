// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// box-share.js — kutunun pay tutması (RFC-0004 §3.1, §4.4, RFC-0027 §1b; D39)
//
// Kutu KRA ve YA dağıtımında cihaz payı tutucusudur. Gelen KASA_SHARE_PUT (0xF1) tek giriş noktasından geçer
// (giris.gelenZarf: oturum süzgeci, Posta Kutusu yasağı, kanonik çözme), tutucu kuralları core/vault teslimAl'dadır
// (WRONG_HOLDER, YETKISIZ, DUPLICATE_HOLDER, STALE_VERSION). Pay önce TPM mühürlü dosyaya yazılır, sonra alındı (0xF2)
// döner: yazım düşerse alındı gitmez, gönderen yeniden dener. Yeniden başlatmada paylar mühürden açılır.
// Kurtarmada (RFC-0004 §5.2, D67) kutu sürüm sorusuna (0x9E → 0x9F) ve pay isteğine (0x9B → 0x9C) denetimler geçince
// sormadan cevap verir; verilen paylar ve ilk görülmeler (72 saat) mühürlü dosyaya yazılmadan pay gitmez. Mühürlü yazım
// yalnız pay verilince, yeni pay gelince ya da bir istekçinin 72 saati başlayınca (inceleme 19 B13: reddedilen istek ve
// sürüm sorusu TPM işi yaptırmaz; yazılmayan ilk görülme yeniden başlatmada yeniden sayılır, bekleme yalnız uzar). Sürüm sorusuna yalnız yetkili istekçi
// cevap alır; 72 saat kuralına giren olay ilk görülünce uyar(bildirim, alıcılar) çağrılır (RFC-0021 a, B3).
// Kasa zarfının opak kopyası (RFC-0027 §9 g): okuyucunun gönderdiği zarf (0xF3) imzası doğrulanıp tutulur, alındı
// (0xF4) mühürlü yazımdan sonra; KRA'yı kurtaran telefon etiketle ister (0xF5 → 0xF6), yanlış etiket sessiz ret.
//   <dizin>/paylar.muhur   TPM mührü(JSON { paylar, ilk, verilen, zarflar })
'use strict'
// Kutu çekirdeği Bare'de çalışır (RFC-0028 §7 l, D62): dosya ve yol modülleri eşlemeyle (Node'da yerleşik)
const fs = require('#fs')
const path = require('#path')
const b4a = require('b4a')
const sodium = require('sodium-native')
const { giris } = require('@havenfold/core')
const K = require('@havenfold/vault')
const { taklitMi, tpmGercekMi } = require('./tpm')

const hex = (b) => (typeof b === 'string' ? b : b4a.toString(b, 'hex'))
function fail (code) { throw new Error(code) }
const DOSYA = 'paylar.muhur'

// JSON'da baytlar açıkça { $h } olarak (D73, inceleme 19 B14): Node'da Buffer toJSON'la { type: 'Buffer', data } verir,
// Bare'de düz dizi; ikisine de bakmadan özgün değer (this[k]) bayt mı diye denetlenir
function kodla (x) {
  return JSON.stringify(x, function (k, v) {
    const o = this[k]
    return o instanceof Uint8Array ? { $h: b4a.toString(b4a.from(o.buffer, o.byteOffset, o.byteLength), 'hex') } : v
  })
}
const coz = (s) => JSON.parse(s, (k, v) => (v && typeof v === 'object' && Object.keys(v).length === 1 && typeof v.$h === 'string' ? b4a.from(v.$h, 'hex') : v))

// Eski Bare biçimi (D62–D73 arası): baytlar düz sayı dizisi ya da sayı anahtarlı nesne olarak yazılmıştı
const PAY_BAYTLARI = ['secretId', 'share', 'holderId', 'commit']
function bayt (x) {
  if (b4a.isBuffer(x)) return x
  if (Array.isArray(x) && x.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) return b4a.from(x)
  if (x && typeof x === 'object') {
    const k = Object.keys(x)
    if (k.length && k.every((a, i) => a === String(i)) && k.every((a) => Number.isInteger(x[a]) && x[a] >= 0 && x[a] <= 255)) return b4a.from(k.map((a) => x[a]))
  }
  fail('SEAL_CORRUPT')
}
function eskiBicim (v) {
  if (!v || typeof v.share !== 'object' || v.share === null) fail('SEAL_CORRUPT')
  const share = { ...v.share }
  for (const a of PAY_BAYTLARI) share[a] = bayt(share[a])
  return { ...v, share }
}

// Değişince işaretlenen Map (ilk görülmeler ve verilen paylar): mühürlü dosya yalnız değişiklikte yazılır
class IzliMap extends Map {
  set (k, v) { this.kirli = true; return super.set(k, v) }
}

function atomikYaz (yol, veri) {
  const gecici = yol + '.yeni'
  const fd = fs.openSync(gecici, 'w', 0o600)
  try { fs.writeSync(fd, veri); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
  fs.renameSync(gecici, yol)
  try { const d = fs.openSync(path.dirname(yol), 'r'); fs.fsyncSync(d); fs.closeSync(d) } catch {}
}

class KutuPaylari {
  // ledger: defter; me: kutunun kimliği; dizin: kalıcı dizin; tpm: { muhurle, ac } (node/tpm.js); testKipi: taklit mühre izin
  // uyar(bildirim, alıcılar): rotate_pending_share güvenlik bildirimi (platform gönderir)
  constructor ({ ledger, me, dizin, tpm, now = Date.now, testKipi = false, uyar = () => {} }) {
    // Yalnız gerçek TPM (sistemTpm) ya da test kipinde taklitTpm'nin ürettiği nesne; başka bir mühür arayüzü (ör. kimlik
    // işlevi, payı düz yazardı) NO_TPM (inceleme 15 şüphelisi)
    if (!tpmGercekMi(tpm) && !(testKipi === true && taklitMi(tpm))) fail('NO_TPM')
    this.L = ledger
    this.me = me
    this.yol = path.join(dizin, DOSYA)
    this.tpm = tpm
    this.ilk = new IzliMap()
    this.verilen = new IzliMap()
    this.tutucu = new K.istek.PayTutucu({ ledger, me, now, ilkGorulme: this.ilk, sayac: this.verilen, uyar })
    this.tutucu.ertele = true // eski sürüm payı mühürlü yazım başarılı olunca sıfırlanır (inceleme 15 B4)
    this.zarflar = new K.kutuZarf.ZarfKopyalari({ ledger, now })
    this._yukle()
    this.ilk.kirli = false
    this.verilen.kirli = false
  }

  _yukle () {
    let muhur
    try { muhur = fs.readFileSync(this.yol) } catch (err) { if (err.code === 'ENOENT') return; throw err }
    const acik = this.tpm.ac(muhur)
    let g
    try { g = coz(b4a.toString(acik)) } catch { fail('SEAL_CORRUPT') } finally { sodium.sodium_memzero(acik) }
    for (const [k, v] of g.ilk || []) this.ilk.set(k, v)
    for (const [k, v] of g.verilen || []) this.verilen.set(k, v)
    this.zarflar.kopyalar = new K.kutuZarf.ZarfKopyalari({ ledger: this.L, kopyalar: Array.isArray(g.zarflar) ? g.zarflar : [] }).kopyalar
    // Sürüm sırasıyla: eski sürüm yenisinden sonra gelirse STALE_VERSION olur, yüklenmez
    for (const v of (g.paylar || []).map(eskiBicim).sort((a, b) => a.share.version - b.share.version)) {
      try { this.tutucu.ekle({ share: v.share }, v.rootId ? { rootId: v.rootId } : {}) } catch (err) { if (err.message !== 'STALE_VERSION') throw err }
    }
  }

  _yaz () {
    const g = { paylar: [...this.tutucu.paylar.values()], ilk: [...this.ilk], verilen: [...this.verilen], zarflar: this.zarflar.kopyalar }
    const acik = b4a.from(kodla(g))
    try { atomikYaz(this.yol, this.tpm.muhurle(acik)) } finally { sodium.sodium_memzero(acik) }
    this.ilk.kirli = false
    this.verilen.kirli = false
  }

  // Verilen pay değiştiyse yazılır (ilk görülmeler onunla birlikte)
  _yazGerekirse () { if (this.verilen.kirli) this._yaz() }

  // Gelen KASA_SHARE_PUT (tek giriş noktası). Dönüş: gönderilecek alındı { to, type, bytes, durum }
  payAl (fromHex, bytes, yol) {
    const L = this.L
    giris.gelenZarf({ myRole: 'uye', peerRole: L.sessionRole(hex(fromHex)), type: K.teslim.Z.KASA_SHARE_PUT, bytes, L, gonderen: hex(fromHex), yol })
    const t = this.tutucu
    const once = [new Map(t.paylar), new Map(t.dizin)]
    let r
    try { r = K.teslim.teslimAl(t, hex(fromHex), bytes) } catch (err) { if (err.message === 'ON_HOLD' && this.ilk.kirli) this._yaz(); throw err }
    if (r.durum === 'yeni' || r.durum === 'degisti') {
      try {
        this._yaz()
      } catch (err) {
        // Mühürlenmeyen pay tutulmaz; silinmiş eski sürüm baytları sıfırlanmadığı için olduğu gibi geri gelir
        t.paylar = once[0]
        t.dizin = once[1]
        t.sifirlanacak.length = 0
        throw err
      }
      t.sifirla()
    }
    return { to: hex(fromHex), type: K.teslim.Z.KASA_SHARE_ACK, bytes: r.alindi, durum: r.durum }
  }

  // Gelen KASA_VERSION_REQ (tek giriş noktası). Dönüş: { to, type, bytes } ya da null (bu sırrın payı yok)
  surumIstegiAl (fromHex, bytes, yol) {
    const L = this.L
    giris.gelenZarf({ myRole: 'uye', peerRole: L.sessionRole(hex(fromHex)), type: K.istek.Z.KASA_VERSION_REQ, bytes, L, gonderen: hex(fromHex), yol })
    const r = this.tutucu.surum(bytes, { from: hex(fromHex) })
    return r ? { to: hex(fromHex), type: K.istek.Z.KASA_VERSION_RES, bytes: r } : null
  }

  // Gelen KASA_SHARE_REQ (tek giriş noktası). Denetimler geçerse pay (KASA_SHARE_RES), beklemede ya da retle null.
  // İlk görülme ve günlük sınır kayıtları mühürlü dosyaya yazılır (yazım düşerse pay gitmez)
  payIstegiAl (fromHex, bytes, yol) {
    const L = this.L
    giris.gelenZarf({ myRole: 'uye', peerRole: L.sessionRole(hex(fromHex)), type: K.istek.Z.KASA_SHARE_REQ, bytes, L, gonderen: hex(fromHex), yol })
    const r = this.tutucu.iste(bytes, { from: hex(fromHex) })
    if (r.bekle && this.ilk.kirli) this._yaz() // istekçinin 72 saati başladı: kalıcı
    else this._yazGerekirse()
    return r.ver ? { to: hex(fromHex), type: K.istek.Z.KASA_SHARE_RES, bytes: r.ver } : null
  }

  // Gelen KASA_ENV_PUT (tek giriş noktası; RFC-0027 §9 g). Zarf mühürlü dosyaya yazılmadan alındı gitmez. 72 saat
  // beklemesindeki gönderici zarf yazamaz (BEKLEMEDE). Dönüş: { to, type, bytes, durum }
  zarfAl (fromHex, bytes, yol) {
    const L = this.L
    const { mesaj: m } = giris.gelenZarf({ myRole: 'uye', peerRole: L.sessionRole(hex(fromHex)), type: K.kutuZarf.Z.KASA_ENV_PUT, bytes, L, gonderen: hex(fromHex), yol })
    if (this.tutucu.now() < this.tutucu.bekleme(hex(fromHex)).bitis) { if (this.ilk.kirli) this._yaz(); fail('ON_HOLD') }
    const once = this.zarflar.kopyalar
    const r = this.zarflar.al(hex(fromHex), m)
    if (r.durum === 'yeni') {
      try { this._yaz() } catch (err) { this.zarflar.kopyalar = once; throw err }
    }
    return { to: hex(fromHex), type: K.kutuZarf.Z.KASA_ENV_ACK, bytes: r.alindi, durum: r.durum }
  }

  // Gelen KASA_ENV_REQ (tek giriş noktası). Doğru etiket, kasanın okuyucusu ve hız sınırı içinde: zarf (0xF6); yoksa
  // null (yanlış etiket ağa ayrı bir hata vermez). Mühürlü yazım yok (hız sınırı bellekte)
  zarfIstegiAl (fromHex, bytes, yol) {
    const L = this.L
    const { mesaj: m } = giris.gelenZarf({ myRole: 'uye', peerRole: L.sessionRole(hex(fromHex)), type: K.kutuZarf.Z.KASA_ENV_REQ, bytes, L, gonderen: hex(fromHex), yol })
    const r = this.zarflar.iste(hex(fromHex), m)
    return r ? { to: hex(fromHex), type: K.kutuZarf.Z.KASA_ENV_RES, bytes: r } : null
  }

  // Tutulan zarf kopyaları (zarf baytı dönmez)
  zarfListesi () { return this.zarflar.liste() }

  // Tutulan paylar: 'secretId|sürüm' (pay baytı dönmez)
  liste () { return [...this.tutucu.paylar.keys()].sort() }
}

const ENTRY_POINTS = ['KutuPaylari.payAl', 'KutuPaylari.surumIstegiAl', 'KutuPaylari.payIstegiAl', 'KutuPaylari.zarfAl', 'KutuPaylari.zarfIstegiAl']

module.exports = { KutuPaylari, ENTRY_POINTS, DOSYA }
