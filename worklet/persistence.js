// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// persistence.js — telefondaki çekirdeğin diskteki durumu (Bare'de bare-fs, Node'da fs; RFC-0027 §5)
//
// Dizin düzeni:
//   kimlik            bu uygulamanın kimliği (memberId, imza ve kutu anahtar çiftleri, cihaz sertifikası); bir kez yazılır
//   hlc               son hlc (RFC-0001 §6: işlem gönderilmeden önce kalıcı yazılır; Hlc.persist kancası)
//   durum             tek anlık görüntü: defter, replika (kasa koleksiyonlarının anahtarları ve bekleyen yazımları hariç),
//                     dosya dizini, son görülme ve ilk kullanım onayları; kimlik dosyasının özeti ve tekdüze sayaç;
//                     bu çekirdek ailenin kutusuysa kutunun kör emaneti (okuyamadığı işlemler, D34)
//   arsiv             kasa duyarlılıklı koleksiyonların dönem anahtarları ve bekleyen yazımları: her öğe Arşiv açık
//                     anahtarıyla ayrı ayrı mühürlü (crypto_box_seal). 224 UNLOCK açar, 19 LOCK ve işlemsizlik kapatır.
//   kilit             dizin kilidi (süreç kimliği); aynı dizin iki kez açılmaz
//   aileler/<yerelNo>/ ek aile örnekleri (RFC-0034 §5.2): kimlik, hlc, durum, arsiv, dosyalar/, gomme/; kilit kökte
//   dosyalar/<blobId> dosya deposu: şifreli parçalar (anahtar kayıttaki BlobRef'tedir, burada değil)
// Durum tek dosyadır: birden çok dosya ayrı ayrı yazılsaydı yarıda kalan kayıt defteri yeni, replikayı eski bırakabilirdi.
// Dosya önce, durum sonra yazılır; durumun andığı dosya her zaman diskte bulunur.
//
// Her dosya: "HFW1" ‖ sürüm(1) ‖ kip(1) ‖ gövde
//   kip 1 (şifreli): nonce(24) ‖ XChaCha20-Poly1305(içerik, AD);  anahtar = derive(platform anahtarı, 'hf/worklet/kalici')
//   kip 0 (açık):    özet(32) ‖ içerik; yalnız testKipi (RFC-0027 §5 a); bozulmayı yakalar, saldırıya karşı değil
//   AD = "HFW1" ‖ sürüm ‖ kip ‖ dosya adı. Ad AD'de olduğu için bir dosya başka bir adın yerine konamaz.
//   Ek örnekte (RFC-0034 §5.2) anahtar = derive(platform anahtarı, 'hf/worklet/kalici', yerelNo) ve AD'deki ad örneğin
//   yolunu içerir ('aileler/<yerelNo>/durum'): bir ailenin dosyası öbürünün (ya da kök örneğin) yerine konamaz.
// Platform anahtarı zorunludur (iOS Keychain, Android Keystore); yoksa NO_KEY. Açık kipte yazılmış dizin şifreli
// kiple açılınca bir kez şifreli kipe taşınır. Silme ve geri alma (RFC-0027 §5 c): durum kimliğin özetini taşır; biri
// yoksa ya da özet uymuyorsa STATE_CORRUPT; durumun sayacı uygulamanın verdiğinden küçükse STATE_ROLLED_BACK.
// Yazım atomiktir: geçici dosya + fsync + yeniden adlandırma + dizin fsync. Bozuk dosya sessizce sıfırlanmaz.
'use strict'
/* global Bare */
const fs = require('#fs')
const b4a = require('b4a')
const sodium = require('sodium-native')
const { kdf, ledger: { Ledger, encodeEvent, decodeEvent }, caps: { CapsBook }, identity: { createIdentity } } = require('@havenfold/core')
const { Replika, hlc: { Hlc }, anahtar: A, kutu: { Kutu }, islem: { peekOp }, kodlama: { decodeRecDrop }, dropOpIdOf, uygulama: U } = require('@havenfold/records')
const { onay: { OnayDefteri }, yetenek: { YetenekDefteri } } = require('@havenfold/tasks')
const S = require('@havenfold/sdk')
const { istek: { payOzeti } } = require('@havenfold/vault')
// Açık kip (testKipi ve açık dosyanın okunması) telefon paketinde derleme anında kapalıdır (package.json imports,
// ios/android koşulu; inceleme 13 bulgu 1)
const { ACIK_KIP } = require('#mode')
const Ol = require('@havenfold/events')
const { v23: { tumAileOf } } = require('@havenfold/core')
// Bu çekirdeğin hf.uygulama kaydında bildirdiği yetenekler (RFC-0037 §6.2: SOS alındısı yazar). Defterde duran protokol
// değeri ('sos-alindi'); okuyanla aynı sabit. Uygulamaya giden olayın adı ayrı: 'sos-received'.
const YETENEKLER = [Ol.alindi.YETENEK]

const MAGIC = b4a.from('HFW1')
const SURUM = 1
const ACIK = 0
const SIFRELI = 1
const NONCE = sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES
const ABYTES = sodium.crypto_aead_xchacha20poly1305_ietf_ABYTES
const SEAL = sodium.crypto_box_SEALBYTES
// Ürün saklaması (urunSaklama): değer başına ve toplam sınır; gizli önekler Arşiv katmanında durur ve yedeğe girer
// (RFC-0010 açıklama 3 madde 4: hizmet paylaşımının takma adları), arşiv kilitliyken okunmaz ve yazılmaz (ARCHIVE_LOCKED)
const URUN_DEGER_EN_COK = 256 * 1024
const URUN_TOPLAM_EN_COK = 4 * 1024 * 1024
const AFET_TOPLAM_EN_COK = 4 * 1024 * 1024 // afet saklaması (D104)
const URUN_GIZLI = ['hizmet/takma/']
const urunGizliMi = (k) => URUN_GIZLI.some((o) => k.startsWith(o))
const AD_KURALI = /^[a-z0-9][a-z0-9._-]{0,100}(\/[a-z0-9][a-z0-9._-]{0,100})?$/
const DURUM_SURUMU = 3 // 3: yerelNo (RFC-0034 §5.2, §10)
const YEREL_NO = /^[0-9a-f]{32}$/
const YASAK_ANAHTAR = new Set(['__proto__', 'constructor', 'prototype'])
// arsiv'in ilk parçası: "HFA2" ‖ sayaç (u64) ‖ açık anahtar (32): eşlik ettiği durumun sayacı ve öğelerin mühürlendiği
// Arşiv açık anahtarı (D40). "HFA1" ‖ sayaç (D36) okunur.
const ARSIV_BASLIK = b4a.from('HFA2')
const ARSIV_BASLIK_1 = b4a.from('HFA1')

const hex = (b) => (typeof b === 'string' ? b : b4a.toString(b, 'hex'))
function hata (kod, dosya) {
  const e = new Error(kod)
  if (dosya) e.dosya = dosya
  return e
}

const baytMi = (x) => x !== null && typeof x === 'object' && ArrayBuffer.isView(x) && Object.prototype.toString.call(x) === '[object Uint8Array]'

// ---------------------------------------------------------------- değer kodlaması (JSON)

// Baytlar { $h }, BigInt { $n }, Map { $m }, Set { $s }, sonlu olmayan sayı ve -0 { $f }; anahtarı $ ile başlayan nesne { $o }
function kodla (x) {
  if (x === undefined || x === null) return null
  if (typeof x === 'bigint') return { $n: x.toString() }
  if (typeof x === 'number') return Number.isFinite(x) && !Object.is(x, -0) ? x : { $f: Object.is(x, -0) ? '-0' : String(x) }
  if (typeof x === 'string' || typeof x === 'boolean') return x
  if (typeof x === 'function') return null
  if (baytMi(x)) return { $h: b4a.toString(x, 'hex') }
  if (Array.isArray(x)) return x.map(kodla)
  if (x instanceof Map) return { $m: [...x].map(([k, v]) => [kodla(k), kodla(v)]) }
  if (x instanceof Set) return { $s: [...x].map(kodla) }
  const o = {}
  let kacis = false
  for (const [k, v] of Object.entries(x)) {
    if (v === undefined || typeof v === 'function') continue
    if (k.startsWith('$')) kacis = true
    o[k] = kodla(v)
  }
  return kacis ? { $o: o } : o
}

// Prototip anahtarları (__proto__, constructor, prototype) reddedilir: diskteki bir nesne prototip değiştiremez
function nesne (girdiler) {
  const o = {}
  for (const [a, v] of girdiler) {
    if (YASAK_ANAHTAR.has(a)) throw hata('STATE_CORRUPT')
    o[a] = coz(v)
  }
  return o
}

function coz (x) {
  if (x === null || typeof x !== 'object') return x
  if (Array.isArray(x)) return x.map(coz)
  const k = Object.keys(x)
  if (k.length === 1) {
    switch (k[0]) {
      case '$h': return b4a.from(x.$h, 'hex')
      case '$n': return BigInt(x.$n)
      case '$f': return x.$f === '-0' ? -0 : Number(x.$f)
      case '$m': return new Map(x.$m.map(([a, b]) => [coz(a), coz(b)]))
      case '$s': return new Set(x.$s.map(coz))
      case '$o': return nesne(Object.entries(x.$o))
    }
  }
  return nesne(Object.entries(x))
}

const jsonYaz = (x) => b4a.from(JSON.stringify(kodla(x)))
function jsonOku (bytes, ad) {
  try { return coz(JSON.parse(b4a.toString(bytes))) } catch { throw hata('STATE_CORRUPT', ad) }
}

// ---------------------------------------------------------------- dosya katmanı

function adDenetle (ad) {
  if (typeof ad !== 'string' || !AD_KURALI.test(ad) || ad.includes('..') || ad.includes('.tmp')) throw hata('INVALID_NAME', ad)
  return ad
}

function okuYaDaNull (yol) {
  try {
    return fs.readFileSync(yol)
  } catch (err) {
    if (err && err.code === 'ENOENT') return null
    throw err
  }
}

// Yeniden adlandırmanın kendisi de kalıcı olsun: dizin fsync (desteklemeyen sistemde sessiz geçilir)
function dizinEsle (dizin) {
  let fd = null
  try {
    fd = fs.openSync(dizin, 'r')
    fs.fsyncSync(fd)
  } catch {} finally {
    if (fd !== null) try { fs.closeSync(fd) } catch {}
  }
}

function atomikYaz (yol, veri) {
  const rnd = b4a.alloc(6)
  sodium.randombytes_buf(rnd)
  const gecici = yol + '.tmp-' + b4a.toString(rnd, 'hex')
  const fd = fs.openSync(gecici, 'w')
  try {
    let yazilan = 0
    while (yazilan < veri.byteLength) {
      const n = fs.writeSync(fd, veri, yazilan, veri.byteLength - yazilan)
      if (!(n > 0)) throw new Error('WRITE_STOPPED') // 0 dönen yazım sonsuz döngüye girmesin
      yazilan += n
    }
    fs.fsyncSync(fd)
  } catch (err) {
    try { fs.closeSync(fd) } catch {}
    try { fs.unlinkSync(gecici) } catch {}
    throw err
  }
  fs.closeSync(fd)
  try {
    fs.renameSync(gecici, yol)
  } catch (err) {
    try { fs.unlinkSync(gecici) } catch {}
    throw err
  }
  dizinEsle(yol.slice(0, yol.lastIndexOf('/')) || '/')
}

// Dizindeki dosyaları okur ve yazar. anahtar: 32 B platform anahtarı; yalnız testKipi'nde null olabilir (açık kip)
class Depo {
  constructor ({ dizin, anahtar = null, testKipi = false, yerelNo = null }) {
    if (typeof dizin !== 'string' || !dizin) throw hata('NO_DIR')
    if (yerelNo !== null && (typeof yerelNo !== 'string' || !YEREL_NO.test(yerelNo))) throw hata('INVALID_NAME', 'yerelNo')
    if (anahtar !== null && (!baytMi(anahtar) || anahtar.byteLength !== 32)) throw hata('INVALID_KEY')
    if (anahtar === null && testKipi !== true) throw hata('NO_KEY')
    if (testKipi === true && !ACIK_KIP) throw hata('NO_TEST_MODE')
    this.dizin = dizin.endsWith('/') && dizin.length > 1 ? dizin.slice(0, -1) : dizin
    this.kip = anahtar ? SIFRELI : ACIK
    this.onek = yerelNo ? 'aileler/' + yerelNo + '/' : '' // AD'deki yol (RFC-0034 §5.2)
    this.anahtar = anahtar ? (yerelNo ? kdf.derive(anahtar, 'hf/worklet/kalici', b4a.from(yerelNo, 'hex')) : kdf.derive(anahtar, 'hf/worklet/kalici')) : null
    fs.mkdirSync(this.dizin + '/dosyalar', { recursive: true })
    this.temizle()
  }

  _yol (ad) { return this.dizin + '/' + adDenetle(ad) }
  _ad (kip, ad) { return b4a.concat([MAGIC, b4a.from([SURUM, kip]), b4a.from(this.onek + ad)]) }

  // Yarıda kalmış yazımların geçici dosyaları (açılışta)
  temizle () {
    for (const alt of ['', '/dosyalar', '/gomme']) { // gomme/: anlamsal dizin (inceleme 18 W3)
      let liste = []
      try { liste = fs.readdirSync(this.dizin + alt) } catch {}
      for (const f of liste) if (String(f).includes('.tmp-')) try { fs.unlinkSync(this.dizin + alt + '/' + f) } catch {}
    }
  }

  // Açık kipte yazılmış dosyalar şifreli kipe bir kez taşınır (RFC-0027 §5 a, §5 g). Sıra: kimlik önce, durum en
  // son; durum şifreliyse göç bitmiştir. Saldırgan platform anahtarı olmadan yalnız açık kip dosyası yazabilir
  // (inceleme 13 bulgu 1), bu yüzden:
  //   - durum şifreliyken dizindeki her açık dosya STATE_MODE_MISMATCH (göçten sonra konmuş)
  //   - göç ancak kimlik de açıkken ve dizinde hiç şifreli dosya yokken başlar; kimlik şifreli, durum açıksa yarıda
  //     kalmış göç sürer (şifreli kimliğin özetini bilmeyen açık durum zaten STATE_CORRUPT)
  //   - uygulama bir sayaç biliyorsa (beklenenSayac) dizin şifreli kiple açılmıştır: açık dosyadan göç yok
  //   - telefon paketinde açık dosya hiç okunmaz
  goc (beklenenSayac = null) {
    if (this.kip !== SIFRELI) return 0
    const adlar = ['kimlik', 'hlc', 'arsiv']
    try { for (const f of fs.readdirSync(this.dizin + '/dosyalar')) if (/^[0-9a-f]{64}$/.test(String(f))) adlar.push('dosyalar/' + f) } catch {}
    adlar.push('durum')
    const kipOf = (ad) => {
      const d = okuYaDaNull(this._yol(ad))
      return d && d.byteLength >= 6 && b4a.equals(d.subarray(0, 4), MAGIC) ? d[5] : null
    }
    const kipler = new Map(adlar.map((ad) => [ad, kipOf(ad)]))
    const acik = adlar.filter((ad) => kipler.get(ad) === ACIK)
    if (!acik.length) return 0
    if (!ACIK_KIP || beklenenSayac !== null) throw hata('STATE_MODE_MISMATCH', acik[0])
    if (kipler.get('durum') === SIFRELI) throw hata('STATE_MODE_MISMATCH', acik[0])
    if (kipler.get('kimlik') === ACIK && adlar.some((ad) => kipler.get(ad) === SIFRELI)) throw hata('STATE_MODE_MISMATCH', 'kimlik')
    for (const ad of acik) this.yaz(ad, this._acikOku(okuYaDaNull(this._yol(ad)), ad))
    this.gocEdilen = new Set(acik)
    return acik.length
  }

  // Kapanışta alt anahtar bellekte sıfırlanır (sınırlar 14); şifreli kipte kapalı depo yazmaz ve okumaz (sıfır
  // anahtarla şifrelenmiş dosya yazılmasın). Açık kipte (yalnız test) korunacak sır yok
  kapat () {
    if (this.anahtar) sodium.sodium_memzero(this.anahtar)
    this.anahtar = null
  }

  yaz (ad, icerik) {
    if (this.kip === SIFRELI && !this.anahtar) throw hata('STATE_CLOSED')
    const yol = this._yol(ad)
    const bas = b4a.concat([MAGIC, b4a.from([SURUM, this.kip])])
    const ek = this._ad(this.kip, ad)
    let govde
    if (this.kip === SIFRELI) {
      const nonce = b4a.alloc(NONCE)
      sodium.randombytes_buf(nonce)
      const sifreli = b4a.alloc(icerik.byteLength + ABYTES)
      sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(sifreli, icerik, ek, null, nonce, this.anahtar)
      govde = b4a.concat([nonce, sifreli])
    } else {
      govde = b4a.concat([kdf.hash('hf/worklet/ozet', ek, icerik), icerik])
    }
    atomikYaz(yol, b4a.concat([bas, govde]))
  }

  _acikOku (d, ad) {
    const govde = d.subarray(6)
    if (govde.byteLength < 32) throw hata('STATE_CORRUPT', ad)
    const icerik = govde.subarray(32)
    if (!b4a.equals(govde.subarray(0, 32), kdf.hash('hf/worklet/ozet', this._ad(ACIK, ad), icerik))) throw hata('STATE_CORRUPT', ad)
    return b4a.from(icerik)
  }

  // İçerik ya da (dosya yoksa) null. Bozuksa STATE_CORRUPT, başka sürümse STATE_VERSION, şifreli dosya açık kiple
  // açılırsa STATE_MODE_MISMATCH; açık dosya şifreli kiple okunursa da (göç yalnız goc() ile, açılışta).
  oku (ad) {
    if (this.kip === SIFRELI && !this.anahtar) throw hata('STATE_CLOSED')
    const d = okuYaDaNull(this._yol(ad))
    if (d === null) return null
    if (d.byteLength < 6 || !b4a.equals(d.subarray(0, 4), MAGIC)) throw hata('STATE_CORRUPT', ad)
    if (d[4] !== SURUM) throw hata('STATE_VERSION', ad)
    const kip = d[5]
    if (kip !== ACIK && kip !== SIFRELI) throw hata('STATE_CORRUPT', ad)
    if (kip === ACIK) {
      // Şifreli kipte açık dosya yalnız göçte (goc) okunur; açılıştan sonra konmuşsa saldırıdır
      if (this.kip === SIFRELI || !ACIK_KIP) throw hata('STATE_MODE_MISMATCH', ad)
      return this._acikOku(d, ad)
    }
    if (this.kip !== SIFRELI) throw hata('STATE_MODE_MISMATCH', ad)
    const govde = d.subarray(6)
    if (govde.byteLength < NONCE + ABYTES) throw hata('STATE_CORRUPT', ad)
    const nonce = govde.subarray(0, NONCE)
    const sifreli = govde.subarray(NONCE)
    const acik = b4a.alloc(sifreli.byteLength - ABYTES)
    try {
      sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(acik, null, sifreli, this._ad(kip, ad), nonce, this.anahtar)
    } catch {
      throw hata('STATE_CORRUPT', ad)
    }
    return acik
  }

  sil (ad) { try { fs.unlinkSync(this._yol(ad)) } catch (err) { if (!err || err.code !== 'ENOENT') throw err } }
}

// ---------------------------------------------------------------- dizin kilidi (RFC-0027 §5 f)

const ACIK_DIZINLER = new Set() // bu süreçte açık dizinler
const pidOf = () => (typeof Bare !== 'undefined' ? Bare.pid : process.pid)

// Kilit dosyasındaki süreç yaşıyor mu: /proc varsa (Android, Linux) oradan; yoksa (iOS: worklet uygulama sürecindedir,
// başka süreç dizine erişmez) eski kilit bırakılmış sayılır
function surecYasiyor (pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false
  if (pid === pidOf()) return true
  try { fs.statSync('/proc/self') } catch { return false }
  try { fs.statSync('/proc/' + pid); return true } catch { return false }
}

function kilitAl (dizin) {
  if (ACIK_DIZINLER.has(dizin)) throw hata('DIR_LOCKED')
  const yol = dizin + '/kilit'
  const var_ = okuYaDaNull(yol)
  if (var_) {
    const pid = parseInt(b4a.toString(var_), 10)
    if (pid !== pidOf() && surecYasiyor(pid)) throw hata('DIR_LOCKED')
  }
  atomikYaz(yol, b4a.from(String(pidOf())))
  ACIK_DIZINLER.add(dizin)
}

function kilitBirak (dizin) {
  if (!ACIK_DIZINLER.delete(dizin)) return
  try { fs.unlinkSync(dizin + '/kilit') } catch {}
}

// ---------------------------------------------------------------- dosya deposu (RecordApi depo arayüzü: get, set, delete)

const BLOB_AD = /^[0-9a-f]{64}$/

function parcalariYaz (parcalar) {
  const boy = b4a.alloc(4 + 4 * parcalar.length)
  const v = new DataView(boy.buffer, boy.byteOffset, boy.byteLength)
  v.setUint32(0, parcalar.length)
  parcalar.forEach((p, i) => v.setUint32(4 + 4 * i, p.byteLength))
  return b4a.concat([boy, ...parcalar])
}

function parcalariOku (b, ad) {
  if (b.byteLength < 4) throw hata('STATE_CORRUPT', ad)
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const n = v.getUint32(0)
  let o = 4 + 4 * n
  if (o > b.byteLength) throw hata('STATE_CORRUPT', ad)
  const out = []
  for (let i = 0; i < n; i++) {
    const l = v.getUint32(4 + 4 * i)
    if (o + l > b.byteLength) throw hata('STATE_CORRUPT', ad)
    out.push(b4a.from(b.subarray(o, o + l)))
    o += l
  }
  if (o !== b.byteLength) throw hata('STATE_CORRUPT', ad)
  return out
}

class DiskDeposu {
  constructor (depo) { this.depo = depo }
  _ad (k) {
    if (typeof k !== 'string' || !BLOB_AD.test(k)) throw hata('INVALID_NAME', k)
    return 'dosyalar/' + k
  }

  get (k) {
    const ad = this._ad(k)
    const b = this.depo.oku(ad)
    return b === null ? null : parcalariOku(b, ad)
  }

  set (k, chunks) { this.depo.yaz(this._ad(k), parcalariYaz(chunks)) }
  delete (k) { this.depo.sil(this._ad(k)) }
  has (k) { return fs.existsSync(this.depo.dizin + '/' + this._ad(k)) }
}

// ---------------------------------------------------------------- anlık görüntü

function defterGoruntusu (L, oneriler, caps) {
  return {
    olaylar: L.events.map((e) => encodeEvent(e)),
    kabul: L.acceptedAt,
    bekletilen: L.deferred ? L.deferred.map((e) => encodeEvent(e)) : null,
    oneriler: oneriler ? oneriler.toJSON() : null,
    caps: caps ? caps.toJSON() : null
  }
}

function defterKur (g, now) {
  const L = new Ledger({ now, acceptedAt: g.kabul })
  for (const b of g.olaylar) L.apply(decodeEvent(b))
  if (g.bekletilen) L.deferred = g.bekletilen.map((b) => decodeEvent(b))
  return L
}

// haric: anahtarları ve bekleyen yazımları durum dosyasına girmeyen koleksiyonlar (kasa; arsiv dosyasındalar)
function replikaGoruntusu (r, haric = new Set()) {
  const anahtarlar = [...r.keys.epochs.values()].filter((s) => !haric.has(s.cid)).map((s) => ({
    cid: s.cid, epochSeq: s.epochSeq, epochHash: s.epochHash, keys: [...s.keys.values()].map((x) => ({ entry: x.entry, role: x.role }))
  }))
  const kesimler = []
  for (const p of r.cutoffs.partial.values()) for (const x of p.parts.values()) kesimler.push(x.bytes)
  return {
    hlc: r.hlc.last,
    ops: [...r.ops.values()].map((o) => ({ kind: o.kind, bytes: o.bytes })),
    tomb: r.tomb,
    pruned: r.pruned,
    cleaned: r.cleaned,
    anahtarlar,
    birakma: [...r.keys.drops.values()],
    kesimler,
    verilenKesimler: r.cutoffs.issued,
    ertelenenKesimler: [...r.ertelenenKesimler], // kasa kilitliyken ertelenen kesimler ve aday işlemleri (RFC-0027 §9 h)
    bekleyenAnahtar: r.pendingKeys.filter((b) => !haric.has(recKeyCid(b))),
    bekleyenKesim: r.pendingCutoffs,
    yazimKuyrugu: r.writeQueue.filter((w) => !haric.has(w.cid)),
    cikis: r.outbox.filter((m) => !kasaCikisi(m, haric)),
    donemGorulme: r.donemGorulme,
    gonderilenPaket: r.joinSent || new Set()
  }
}

// Kutunun kör emaneti (kutu.js): koleksiyon başına işlem kopyaları, mezar, gönderen kotası ve budama kaydı
function kutuGoruntusu (k) {
  return {
    kullanilan: k.used,
    koleksiyonlar: [...k.cols].map(([cid, x]) => ({
      cid,
      ops: [...x.ops.values()].map((g) => ({ kind: g.kind, kopyalar: g.kopyalar.map((y) => ({ bytes: y.bytes, sig: y.sig, from: y.from })) })),
      tomb: [...x.tomb],
      usage: [...x.usage],
      noReaderSince: x.noReaderSince,
      budamalar: x.budamalar
    }))
  }
}

// Diskteki her kopyanın opId'si ve koleksiyonu baytlarından yeniden hesaplanır; uymayan STATE_CORRUPT
function kutuKur (g, { ledger, now }) {
  const k = new Kutu({ ledger, now })
  if (!g) return k
  let used = 0
  for (const x of g.koleksiyonlar) {
    const col = k._col(x.cid)
    for (const o of x.ops) {
      let opId = null
      const kopyalar = []
      for (const y of o.kopyalar) {
        if (!baytMi(y.bytes) || !baytMi(y.sig)) throw hata('STATE_CORRUPT', 'durum')
        let id, cid
        try {
          if (o.kind === 0) { const p = peekOp(y.bytes); id = p.opId; cid = hex(p.wire.collectionId) } else { const w = decodeRecDrop(y.bytes); id = dropOpIdOf(w); cid = hex(w.collectionId) }
        } catch { throw hata('STATE_CORRUPT', 'durum') }
        if (cid !== x.cid || (opId && !b4a.equals(opId, id))) throw hata('STATE_CORRUPT', 'durum')
        opId = id
        used += y.bytes.byteLength
        kopyalar.push({ bytes: y.bytes, sig: y.sig, from: y.from })
      }
      if (!opId) throw hata('STATE_CORRUPT', 'durum')
      col.ops.set(hex(opId), { kind: o.kind, opId, kopyalar, get bytes () { return this.kopyalar[0].bytes } })
    }
    for (const t of x.tomb) col.tomb.add(t)
    for (const [a, v] of x.usage) col.usage.set(a, v)
    col.noReaderSince = x.noReaderSince
    col.budamalar = x.budamalar
  }
  if (used !== g.kullanilan) throw hata('STATE_CORRUPT', 'durum')
  k.used = used
  k.yetki.update(ledger)
  return k
}

// Kasa koleksiyonunun anahtar taşıyan ya da kesim çıkışı (REC_KEY, REC_CUTOFF): durumda değil, arsivde (RFC-0027 §5 g;
// inceleme 13 bulgu 2). Kasa işlemleri (REC_OPS) zaten şifreli kalır.
const REC_KEY = 0x82
const REC_CUTOFF = 0x88
const kasaCikisi = (m, kasa) => kasa.has(m.cid) && (m.type === REC_KEY || m.type === REC_CUTOFF)
function recKeyCid (b) {
  try { return hex(A.decodeRecKey(b).collectionId) } catch { return null }
}

// Bir anahtar girdisini çekirdeğin doğrulamasından geçirip ekler (diskteki girdiye güvenilmez; inceleme 12 bulgu 2)
function anahtarDogrula (r, cid, epochSeq, epochHash, entry, dosya = 'durum') {
  const ep = r.yetki.epoch(cid, epochSeq)
  if (!ep || !b4a.equals(ep.hash, epochHash)) throw hata('STATE_CORRUPT', dosya)
  try {
    return { ep, role: A.verifyKeyEntry({ familyId: r.familyId, collectionId: b4a.from(cid, 'hex'), epoch: ep, entry, signPubOf: (id) => r.ledger.entity(id)?.signPub }).role }
  } catch { throw hata('STATE_CORRUPT', dosya) }
}

function anahtarEkle (r, cid, epochSeq, epochHash, entry) {
  const { ep, role } = anahtarDogrula(r, cid, epochSeq, epochHash, entry)
  r.keys.add(cid, ep, entry, role)
}

// Sıra önemlidir: mezar, temizlenenler, verilen kesimler ve gönderilen paketler işlemlerden önce gelir; yoksa ilk
// defter yetiştirmesi boş işlem kümesiyle yeni bir kesim çıkarır ya da temizlenmiş işlemi yeniden kabul ederdi.
// Açılışta her girdi çekirdeğin doğrulamasından geçer; reddedilen işlem, mezardaki işlem ya da doğrulanmayan anahtar
// STATE_CORRUPT'tur (sessiz kayıp yok).
function replikaKur (g, { ledger, me, now, hlcYaz, kesimErtele = null }) {
  const hlc = new Hlc({ last: g.hlc })
  // Otomatik anahtar kuralı _nesneleriKur'da kurulur: geri yüklemede kilitli kasaya anahtar üretilmesin (inceleme 15)
  const r = new Replika({ ledger, me, now, hlc, otomatikAnahtar: false, kesimErtele })
  // Alan türleri (D50 bulanık test): bozuk durum açılışta ve sonra çalışırken TypeError vermesin, STATE_CORRUPT desin
  const bozuk = () => { throw hata('STATE_CORRUPT', 'durum') }
  const dizi = (x, ok) => Array.isArray(x) && x.every((y) => { try { return ok(y) } catch { return false } })
  const nesneMi = (x) => x !== null && typeof x === 'object'
  if (!dizi(g.cikis, (m) => nesneMi(m) && baytMi(m.bytes) && Number.isInteger(m.type)) || !dizi(g.yazimKuyrugu, (w) => nesneMi(w) && typeof w.cid === 'string') ||
    !dizi(g.bekleyenAnahtar, baytMi) || !dizi(g.bekleyenKesim, baytMi) || !dizi(g.kesimler, baytMi) || !dizi(g.ops, (o) => nesneMi(o) && baytMi(o.bytes)) ||
    !dizi(g.anahtarlar, (x) => nesneMi(x) && Array.isArray(x.keys) && x.keys.every(nesneMi)) || !dizi(g.birakma, nesneMi)) bozuk()
  for (const [alan, ad] of [['tomb', 'tomb'], ['pruned', 'pruned'], ['cleaned', 'cleaned'], ['verilenKesimler', null], ['gonderilenPaket', 'joinSent'], ['donemGorulme', 'donemGorulme']]) {
    const ornek = ad ? r[ad] : r.cutoffs.issued
    if (ornek && typeof ornek === 'object' && !(g[alan] instanceof ornek.constructor)) bozuk()
  }
  r.tomb = g.tomb
  r.pruned = g.pruned
  r.cleaned = g.cleaned
  r.cutoffs.issued = g.verilenKesimler
  // Ertelenen kesimler (RFC-0027 §9 h): eski durumda yok; varsa metin listesi olmalı
  const metinler = (x) => Array.isArray(x) && x.every((y) => typeof y === 'string')
  if (g.ertelenenKesimler !== undefined && !dizi(g.ertelenenKesimler, (x) => Array.isArray(x) && x.length === 2 && typeof x[0] === 'string' && metinler(x[1]))) bozuk()
  r.ertelenenKesimler = new Map(g.ertelenenKesimler || [])
  r.joinSent = g.gonderilenPaket
  r.donemGorulme = g.donemGorulme
  r._catchUp()
  for (const s of g.anahtarlar) for (const x of s.keys) anahtarEkle(r, s.cid, s.epochSeq, s.epochHash, x.entry)
  for (const d of g.birakma) {
    if (!baytMi(d.secret) || !b4a.equals(A.dropPubOf(d.secret), d.pub)) throw hata('STATE_CORRUPT', 'durum')
    r.keys.addDrop(d.cid, d.pub, d.secret)
  }
  r.outbox = g.cikis
  r.writeQueue = g.yazimKuyrugu
  r.pendingKeys = g.bekleyenAnahtar
  r.pendingCutoffs = g.bekleyenKesim
  for (const b of g.kesimler) r.receiveCutoff(b)
  for (const o of g.ops) {
    const x = r.receiveOp(o.bytes, o.kind)
    if (x.status === 'reddedildi') { const e = hata('STATE_CORRUPT', 'durum'); e.neden = x.code; throw e }
  }
  hlc.persist = hlcYaz // geri yüklemede gözlenen saatler yeniden yazılmasın
  r.sync()
  return r
}

// Durum sürümleri arası göç (STATE_VERSION yerine): sürüm → bir sonraki sürüme dönüştüren işlev
// 1 → 2: kimlik özeti ve sayaç eklenir (RFC-0027 §5 c); eski dosyada ikisi yoktu, var olan kimlik dosyası esas alınır
const GOCLER = {
  1: (g, { kimlikOzet }) => ({ ...g, v: 2, kimlikOzet, sayac: 0 }),
  // RFC-0034 §10: bugünkü dizin kök örnek olur; dosya taşınmaz, örneğe bir yerelNo verilir
  2: (g, { yerelNo }) => ({ ...g, v: 3, yerelNo })
}

function yeniYerelNo () {
  const b = b4a.alloc(16)
  sodium.randombytes_buf(b)
  return b4a.toString(b, 'hex')
}

function gocEt (g, ctx) {
  let x = g
  while (x.v !== DURUM_SURUMU) {
    const f = GOCLER[x.v]
    if (!f) throw hata('STATE_VERSION', 'durum')
    x = f(x, ctx)
  }
  return x
}

const kimlikOzetiOf = (b) => kdf.hash('hf/worklet/kimlik', b)

// ---------------------------------------------------------------- çekirdek nesneleri

/**
 * Kalıcı çekirdek: diskteki durumdan kurulur, kaydet() ile yazılır.
 *   kimlik    { memberId, signKeyPair, uda, deviceCert } (ilk açılışta üretilir)
 *   nesneler  aile varsa { ledger, replika, kayit, defter, gorev, gorulme, caps, kasa }, yoksa { defter (ailesiz) … }
 * anahtar: 32 B platform anahtarı (zorunlu; testKipi: true ile açık kip). archivePubHex: Arşiv açık anahtarı (kasa
 * anahtarlarını mühürler; testKipi'nde verilmezse kasa anahtarları durumda kalır). sayac: uygulamanın sakladığı son sayaç.
 * kaydedildi(sayac): her yazımdan sonra (uygulama sayacı platform kasasında tutar).
 */
// Misafir güven çapası (Kalici._misafirKur): durumda düz JSON (onaltılık)
function capaKodla (c) {
  if (!c) return null
  return { s: c.signerHex, f: b4a.toString(c.familyId, 'hex'), g: b4a.toString(c.grantHash, 'hex'), p: [...c.peers].map(([id, v]) => [id, v.role, b4a.toString(v.signPub, 'hex')]) }
}
function capaCoz (j) {
  const h = (x, n) => typeof x === 'string' && x.length === n * 2 && /^[0-9a-f]+$/.test(x)
  if (!j || typeof j !== 'object' || typeof j.s !== 'string' || !h(j.f, 32) || !h(j.g, 32) || !Array.isArray(j.p)) return null
  const peers = new Map()
  for (const x of j.p) {
    if (!Array.isArray(x) || typeof x[0] !== 'string' || typeof x[1] !== 'string' || !h(x[2], 32)) return null
    peers.set(x[0], { role: x[1], signPub: b4a.from(x[2], 'hex') })
  }
  if (!peers.has(j.s)) return null
  return { signerHex: j.s, familyId: b4a.from(j.f, 'hex'), grantHash: b4a.from(j.g, 'hex'), ledgerLen: 0, ledgerHead: b4a.alloc(32), peers }
}

class Kalici {
  // yerelNo: ek aile örneği (RFC-0034 §5.2; dizin <kök>/aileler/<yerelNo>, kilidi kök örnek tutar); verilmezse kök örnek
  constructor ({ dizin, anahtar = null, testKipi = false, archivePubHex = null, sayac = null, now = Date.now, appId = null, platform = 'bare', kayitKancalari = {}, kimlik = null, kaydedildi = null, uygunCihaz = () => false, yerelNo = null, olay = null, sosBildiren = null }) {
    if (!testKipi && anahtar === null) throw hata('NO_KEY')
    if (archivePubHex !== null && (typeof archivePubHex !== 'string' || !/^[0-9a-f]{64}$/.test(archivePubHex))) throw hata('INVALID_KEY')
    if (!testKipi && archivePubHex === null) throw hata('NO_KEY')
    if (sayac !== null && !(Number.isSafeInteger(sayac) && sayac >= 0)) throw hata('INVALID_KEY')
    this.depo = new Depo({ dizin, anahtar, testKipi, yerelNo })
    this.ek = yerelNo !== null
    this.yerelNo = yerelNo
    if (!this.ek) kilitAl(this.depo.dizin)
    try {
      this.depo.goc(sayac)
      this.dosyalar = new DiskDeposu(this.depo)
      this.now = now
      this.appId = appId
      this.kancalar = kayitKancalari
      this.kaydedildi = kaydedildi
      // olay(ad, veri): uygulamaya olay ('sos-received', RFC-0037 §12). sosBildiren(familyIdHex): bu cihazda hf.sos'u bildiren
      // uygulama bu kimlik mi (RFC-0017 §9, RFC-0037 §5.3 f); verilmezse (yerel kanal yok) her kimlik alındı yazar
      this.olay = typeof olay === 'function' ? olay : () => {}
      this.sosBildiren = typeof sosBildiren === 'function' ? sosBildiren : () => true
      this.uygunCihaz = uygunCihaz // KRA ve YA'da cihaz payı tutabilecekler (TPM mührü doğrulanmış kutu; kurulumdan)
      this.arsivPub = archivePubHex ? b4a.from(archivePubHex, 'hex') : null
      this.arsivAcik = false
      this.arsivOzet = null // diskteki arsivin özeti (durumda arsivOzetleri; inceleme 14 Y4)
      this._arsivGecis = null // arsiv yazılırken: [önceki, yeni] (çöküş penceresi)
      this.sonOzet = null
      this.sayac = 0
      this.acilisSayac = null // ilk açılışta null
      this._ac(platform, kimlik, sayac)
    } catch (err) {
      if (!this.ek) kilitBirak(this.depo.dizin)
      this.depo.kapat()
      throw err
    }
  }

  kapat () { if (!this.ek) kilitBirak(this.depo.dizin); this.depo.kapat() }

  // Anlamsal arama dizininin saklaması (D52, RFC-0013 §9.3): durum dosyasının dışında, koleksiyon başına 'gomme/<cid>'
  // dosyası; Depo platform anahtarıyla şifreler (AD'de dosya adı). AiApi({ gommeSaklama: kalici.gommeSaklama() })
  gommeSaklama () {
    const yol = (ad) => { if (typeof ad !== 'string' || !/^gomme-[0-9a-f]{32}$/.test(ad)) throw hata('INVALID_NAME', ad); return 'gomme/' + ad.slice(6) }
    fs.mkdirSync(this.depo.dizin + '/gomme', { recursive: true })
    const dizin = this.depo.dizin + '/gomme'
    return {
      oku: (ad) => this.depo.oku(yol(ad)),
      yaz: (ad, b) => this.depo.yaz(yol(ad), b),
      // Silmede yarım yazımın geçici kopyası da (inceleme 18 W3)
      sil: (ad) => {
        const y = yol(ad)
        this.depo.sil(y)
        const kok = y.slice(6)
        let l = []
        try { l = fs.readdirSync(dizin) } catch {}
        for (const f of l) if (String(f).startsWith(kok + '.tmp-')) try { fs.unlinkSync(dizin + '/' + f) } catch {}
      },
      // Dizindeki gömme dosyaları (açılış süpürmesi; inceleme 18 B1, B7)
      liste: () => {
        let l = []
        try { l = fs.readdirSync(dizin) } catch {}
        return l.map(String).filter((f) => /^[0-9a-f]{32}$/.test(f)).map((f) => 'gomme-' + f)
      }
    }
  }

  _hlcOku () {
    const b = this.depo.oku('hlc')
    if (!b) return 0n
    if (b.byteLength !== 8) throw hata('STATE_CORRUPT', 'hlc')
    return new DataView(b.buffer, b.byteOffset, 8).getBigUint64(0)
  }

  // Hlc.persist: işlem gönderilmeden önce (RFC-0001 §6)
  _hlcYaz (h) {
    const b = b4a.alloc(8)
    new DataView(b.buffer, b.byteOffset, 8).setBigUint64(0, h)
    this.depo.yaz('hlc', b)
    this._hlcSon = h
  }

  // arsiv ve hlc da silme ve geri almaya karşı durumla bağlıdır (RFC-0027 §5 g; inceleme 13 bulgu 7, inceleme 14 Y4):
  //   arsiv  özeti durumun arsivOzetleri listesinde olmalı. Arsiv değişirken önce durum [önceki, yeni] ile, sonra arsiv,
  //          sonra durum yalnız [yeni] ile yazılır: çöküş penceresinde ikisi de geçerli, iş bitince eski kopya geçersiz.
  //          null, "arsiv yok" demektir. D36–D40 dizinlerinde (arsivSayac) başlık sayacı denetlenir.
  //   hlc    durumdaki replika saatinden geride olamaz (her işlemden önce yazılır); durumda saat varken hlc yoksa bozuk.
  _yanDosyalar (g) {
    const ham = this.depo.oku('arsiv')
    const a = this._arsivOku()
    const ozet = ham ? hex(kdf.hash('hf/worklet/arsiv', ham)) : null
    if (Array.isArray(g.arsivOzetleri)) {
      if (!g.arsivOzetleri.includes(ozet)) throw hata('STATE_CORRUPT', 'arsiv')
    } else if ((g.arsivSayac ?? null) !== null) {
      if (!a || a.sayac === null || (a.sayac !== g.arsivSayac && a.sayac !== g.sayac + 1)) throw hata('STATE_CORRUPT', 'arsiv')
    } else if (a && a.sayac !== null && a.sayac !== g.sayac + 1) throw hata('STATE_CORRUPT', 'arsiv')
    this.arsivOzet = ozet
    // Arşiv anahtarı taşındıysa (389) uygulama yeni açık anahtarı vermeli: eskisiyle açılış hangi anahtarın geçerli
    // olduğunu söyler (taşıma ile uygulamanın yeni anahtarı saklaması arasında çöküş)
    if (a && a.pub && this.arsivPub && !b4a.equals(a.pub, this.arsivPub)) throw hata('ARCHIVE_KEY_MISMATCH', 'arsiv')
    const durumSaati = g.replika && typeof g.replika.hlc === 'bigint' ? g.replika.hlc : 0n
    if (durumSaati > 0n && (this.depo.oku('hlc') === null || this._hlcSon < durumSaati)) throw hata('STATE_CORRUPT', 'hlc')
  }

  // Kimlik ve durum birlikte vardır ya da birlikte yoktur (ilk açılış); özet ve sayaç denetlenir (RFC-0027 §5 c)
  _ac (platform, verilen, beklenenSayac) {
    const kb = this.depo.oku('kimlik')
    const db = this.depo.oku('durum')
    if (!kb && db) throw hata('STATE_CORRUPT', 'kimlik')
    if (kb && !db) throw hata('STATE_CORRUPT', 'durum')
    if (!kb) {
      if (beklenenSayac) throw hata('STATE_ROLLED_BACK', 'durum') // uygulama yazılmış bir durum biliyor
      this.kimlik = verilen || createIdentity({ platform, createdAt: this.now() })
      const yeni = jsonYaz(this.kimlik)
      this.depo.yaz('kimlik', yeni)
      this.kimlikOzet = kimlikOzetiOf(yeni)
      if (!this.yerelNo) this.yerelNo = yeniYerelNo()
      this._hlcSon = 0n
      this._kur(null)
      this.kaydet()
      return
    }
    this.kimlik = jsonOku(kb, 'kimlik')
    if (!this.kimlik || !baytMi(this.kimlik.memberId) || !this.kimlik.signKeyPair || !baytMi(this.kimlik.signKeyPair.secretKey)) throw hata('STATE_CORRUPT', 'kimlik')
    if (verilen && !b4a.equals(verilen.memberId, this.kimlik.memberId)) throw hata('IDENTITY_MISMATCH', 'kimlik')
    this.kimlikOzet = kimlikOzetiOf(kb)
    this._beklenenSayac = beklenenSayac
    const g = jsonOku(db, 'durum')
    if (g === null || typeof g !== 'object' || Array.isArray(g) || !Number.isSafeInteger(g.v)) throw hata('STATE_CORRUPT', 'durum')
    // Bu açılışta açık kipten taşınan durum "şifreli kipte yazıldım" diyorsa (sifreli: true) şifreli bir durumun açık
    // kopyasıdır: göç yalnız hiç şifrelenmemiş dizine (inceleme 14: bayrak göç kararında okunur)
    if (this.depo.gocEdilen && this.depo.gocEdilen.has('durum') && g.sifreli === true) throw hata('STATE_MODE_MISMATCH', 'durum')
    try {
      this._durumuAc(g)
    } catch (err) {
      // Diskteki durumun yapısı bozuksa (D50 bulanık test) açılış her zaman kodlu hata verir
      if (err && /^[A-Z][A-Z0-9_]{2,63}$/.test(err.message) && !(err instanceof TypeError) && !(err instanceof RangeError)) throw err
      const e = hata('STATE_CORRUPT', 'durum')
      e.neden = err && err.message
      throw e
    }
  }

  _durumuAc (g) {
    const beklenenSayac = this._beklenenSayac
    let yeniden = g.v !== DURUM_SURUMU // göç edilen durum yeni biçimle yazılır
    g = gocEt(g, { kimlikOzet: this.kimlikOzet, yerelNo: this.yerelNo || yeniYerelNo() })
    if (!baytMi(g.kimlikOzet) || !b4a.equals(g.kimlikOzet, this.kimlikOzet)) throw hata('STATE_CORRUPT', 'kimlik')
    // Örneğin adı durumdadır; ek örnekte klasör adıyla aynı olmalı (AD de yolu içerir)
    if (typeof g.yerelNo !== 'string' || !YEREL_NO.test(g.yerelNo) || (this.ek && g.yerelNo !== this.yerelNo)) throw hata('STATE_CORRUPT', 'durum')
    this.yerelNo = g.yerelNo
    if (!Number.isSafeInteger(g.sayac) || g.sayac < 0) throw hata('STATE_CORRUPT', 'durum')
    if (beklenenSayac !== null && g.sayac < beklenenSayac) throw hata('STATE_ROLLED_BACK', 'durum')
    this.sayac = g.sayac
    this.acilisSayac = g.sayac // diskten okunan (göç yazımından önce; start'ın sayaç haritası denetimi)
    this._hlcSon = this._hlcOku()
    this._yanDosyalar(g)
    try {
      this._kur(g)
    } catch (err) {
      if (err && /^KALICI_/.test(err.message)) throw err
      const e = hata('STATE_CORRUPT', 'durum') // diskteki olay ya da işlem çekirdeğin doğrulamasından geçmedi
      e.neden = err && err.message
      throw e
    }
    this.sonOzet = kdf.hash('hf/worklet/durum', jsonYaz(this._ozetlik()))
    // Eski durumda kalmış kasa anahtarları (Arşiv anahtarı sonradan verildi ya da eski sürüm) arsive alınır
    if (this.nesneler.aile && this.arsivPub) {
      const kasa = this._kasaCidleri()
      if (this._kasaOgeleri(kasa).length) { this._arsivYaz(kasa); yeniden = true }
    }
    if (yeniden) { this.sonOzet = null; this.kaydet() }
  }

  _kur (g) {
    const now = this.now
    const me = this.kimlik
    const caps = new CapsBook()
    this._urunYukle(g)
    this._afetYukle(g)
    if (g && g.defter && g.defter.caps) caps.load(g.defter.caps)
    if (!g || !g.defter) {
      // Ailesiz (eşleşme öncesi ya da aile kurulmadan): yalnız kimlik ve boş defter
      this.nesneler = { ledger: null, replika: null, kayit: null, gorev: null, gorulme: null, kasa: null, caps, defter: S.LedgerApi.withoutFamily({ Ledger, me, appId: this.appId, now }), aile: false, misafir: null }
      if (g && g.misafir) {
        const m = g.misafir
        if (!baytMi(m.gorunum) || (m.iptal !== null && m.iptal !== undefined && !baytMi(m.iptal))) throw hata('STATE_CORRUPT', 'durum')
        // Doğrulanamayan görünüm telefonu açılmaz hâle getirmez: misafirlik düşer, sebebi misafirAcilisHatasi'nda
        // (start.js uygulamaya 'guest' olayıyla bildirir); kimlik ve ürün durumu açılır
        if (m.aileAdi !== undefined && m.aileAdi !== null && typeof m.aileAdi !== 'string') throw hata('STATE_CORRUPT', 'durum')
        try { this._misafirKur(m.gorunum, m.iptal || null, null, capaCoz(m.capa), null, m.aileAdi ?? null) } catch (err) { this._misafir = null; this.nesneler.misafir = null; this.misafirAcilisHatasi = err.message || 'INVALID_VIEW' }
      }
      return
    }
    const ledger = defterKur(g.defter, now)
    // Açılışta kasa kilitlidir: kasa koleksiyonunun kesimi ertelenir (_nesneleriKur kesin kuralı kurar)
    const replika = replikaKur(g.replika, { ledger, me, now, hlcYaz: (h) => this._hlcYaz(h), kesimErtele: (cid) => !!this.arsivPub && !this.arsivAcik && ledger.collections.get(cid)?.sensitivity === 'kasa' })
    if (this._hlcSon > replika.hlc.last) replika.hlc.last = this._hlcSon // hlc dosyası durumdan yeni olabilir
    this._nesneleriKur({ ledger, replika, caps, g })
  }

  // Ürünün küçük kalıcı durumu (urunSaklama; ör. hizmet paylaşımının il dizinleri ve taslakları; RFC-0010): anahtar → JSON
  // metni; durumda (şifreli kipte durum dosyası şifrelidir), aile kurulmadan önce de. Gizli öneklerin değeri arşivdedir.
  _urunYukle (g) {
    if (!this._urunKV) this._urunKV = new Map()
    if (!g || g.urun === undefined) return
    if (!Array.isArray(g.urun) || !g.urun.every((x) => Array.isArray(x) && x.length === 2 && typeof x[0] === 'string' && typeof x[1] === 'string')) throw hata('STATE_CORRUPT', 'durum')
    for (const [k, v] of g.urun) this._urunKV.set(k, v)
  }

  // Afet saklaması (D104): durumdaki [anahtar, JSON] çiftleri
  _afetYukle (g) {
    if (!this._afetKV) this._afetKV = new Map()
    if (!g || g.afet === undefined) return
    if (!Array.isArray(g.afet) || !g.afet.every((x) => Array.isArray(x) && x.length === 2 && typeof x[0] === 'string' && typeof x[1] === 'string')) throw hata('STATE_CORRUPT', 'durum')
    for (const [k, v] of g.afet) this._afetKV.set(k, v)
  }

  _nesneleriKur ({ ledger, replika, caps, g = null }) {
    // Tören anahtarları (RFC-0028 §7 c, D74): peerHex → 32 bayt (hex); çift sırrına girer, durumda gizli (şifreli kipte
    // durum dosyası şifrelidir). Aile bağlanmadan önce gelen anahtar korunur.
    if (!this.torenAnahtarlari) this.torenAnahtarlari = new Map()
    if (g && g.torenAnahtarlari !== undefined) {
      if (!Array.isArray(g.torenAnahtarlari) || !g.torenAnahtarlari.every((x) => Array.isArray(x) && x.length === 2 && /^[0-9a-f]{32}$/.test(x[0]) && /^[0-9a-f]{64}$/.test(x[1]))) throw hata('STATE_CORRUPT', 'durum')
      for (const [k, v] of g.torenAnahtarlari) this.torenAnahtarlari.set(k, v)
    }
    // Kilitliyken anahtarı arsivde olan kasa dönemi için yeniden anahtar üretilmez (D40); hiç anahtarı olmayan dönemde
    // üretilir ve hemen mühürlenir (üretici kilitli üye olabilir)
    this._arsivDonemleri = new Set(g && Array.isArray(g.arsivDonemleri) ? g.arsivDonemleri : [])
    // D40 öncesinden yükseltilen dizinde bu liste yok: arsiv doluysa ilk açılışa kadar kasa anahtarı üretilmez
    // (hangi dönemin anahtarı arsivde bilinmiyor; inceleme 15)
    this._arsivDonemleriBilinmiyor = !!(g && !Array.isArray(g.arsivDonemleri) && this._arsivListe().length)
    // Kasa kilitliyken kasa koleksiyonunun kesimi ertelenir, kilit açılınca verilir (RFC-0027 §9 h)
    replika.kesimErtele = (cid) => !this.arsivAcik && this._kasaCidleri().has(cid)
    replika.otomatikAnahtar = (cid) => {
      if (this.arsivAcik || !this._kasaCidleri().has(cid)) return true
      if (this._arsivDonemleriBilinmiyor) return false
      const ep = replika.yetki.epochAt(cid, ledger.len - 1)
      return !ep || !this._arsivDonemleri.has(cid + '|' + ep.seq + '|' + hex(ep.hash))
    }
    const now = this.now
    const me = this.kimlik
    const k = this.kancalar
    // Kasa kilidi (RFC-0027 §1, §5 b): Arşiv anahtarı verildiyse kasa koleksiyonları kilitli başlar
    // Kasa saklaması (D31): gizli olmayan özetler durumda; gönderilecek pay baytları ve tutulan paylar arsivde
    this._kasaKV = new Map(g && Array.isArray(g.kasa) ? g.kasa : [])
    this._kasaPayDizini = g && Array.isArray(g.kasaPayDizini) ? g.kasaPayDizini : []
    // Kutunun emaneti (D34): bu kimlik ailenin kutusuysa ilk kullanımda kurulur
    this._kutu = null
    this._kutuGoruntu = g && g.kutu ? g.kutu : null
    const kv = this._kasaKV
    const saklama = { get: (k) => (kv.has(k) ? JSON.parse(kv.get(k)) : null), set: (k, v) => kv.set(k, JSON.stringify(v)), delete: (k) => kv.delete(k), anahtarlar: () => [...kv.keys()] }
    const gorulme = new S.Presence({ ledger, me: me.memberId, caps, now })
    const defter = new S.LedgerApi({ ledger, me, gorulme, now, appId: this.appId, capsBook: caps, uygulamaOf: (id) => U.kimlikUygulamasi(ledger, U.kayitlar(replika), id) })
    const kasa = this.arsivPub ? new S.VaultApi({ ledger, me, now, saklama, defter, anahtarDogrula: (h) => this._arsivDogrula(h), uygunCihaz: (id) => this.uygunCihaz(id), arsivTasi: (e, y) => this.arsivTasi(e, y) }) : null
    if (kasa) kasa.on('vault', (x) => { if (x.type === 'kilitlendi') this.arsivKilitle() })
    const kayit = new S.RecordApi({ replika, depo: this.dosyalar, dosyaYaz: k.dosyaYaz || null, dosyaOku: k.dosyaOku || null, dosyaYuklendi: k.dosyaYuklendi || null, kasa })
    if (kasa) kasa.kayit = kayit // kasa zarfı kaydı ve kurtarılan dönem anahtarları (RFC-0027 §9 b)
    if (kasa) for (const [a, v] of this._kasaPayDizini) kasa.tutucu.dizin.set(a, v)
    const onay = new OnayDefteri(g && g.onay ? g.onay : [], { personOf: (id) => ledger.personIdOf(ledger.resolveMember(id) || id) })
    // gorevGonder: işçiye görev zarfı (start'ın eşitleyicisi; ağ yoksa verilmez)
    const gorev = new S.TaskApi({ ledger, me, yetenekler: new YetenekDefteri({ ledger, now }), onay, now, ...(k.gorevGonder ? { gonder: k.gorevGonder } : {}) })
    if (g) {
      if (g.defter.oneriler) defter.oneriler.load(g.defter.oneriler)
      if (g.dosya) {
        for (const id of g.dosya.eklenen || []) kayit.eklenen.add(id)
        for (const [id, tut] of g.dosya.tutucular || []) kayit.tutucular.m.set(id, new Set(tut))
        for (const [k2, v] of g.dosya.bekleyen || []) kayit._bekleyen.set(k2, v)
        for (const id of g.dosya.kasa || []) kayit.kasaDosyalari.add(id)
      }
      for (const [id, v] of g.gorulme || []) gorulme.son.set(id, { dogrudan: v.dogrudan ?? null, emanet: v.emanet ?? null })
    }
    // Eşitleme durumu (D100): teyit bekleyen kendi işlemlerim ve son eşitleme anı durumda
    const esitleme = new S.SyncStatus({ replika, now, durum: g && g.esitleme ? g.esitleme : null })
    esitleme.clear((id) => replika.ops.has(id))
    this.nesneler = { ledger, replika, kayit, defter, gorev, gorulme, caps, kasa, esitleme, aile: true }
    if (this._kutuGoruntu) this.kutu() // diskteki emanet açılışta doğrulanır
    replika._autoKeys() // geri yüklemede ertelenen otomatik anahtar, kasa kuralıyla
    this._uygulamaSon = null
    this._alindiIz = null
    this._alindiGorulen = null
    this._uygulamaKaydi()
  }

  // _sosAlindi'nin yeniden hesap izi: defter, işlem ve kuyruk sayısı ile çözülen ve geçerli işlem, anahtar ve tamamlanan
  // kesim sayısı. SOS önce gelip anahtarı (REC_KEY, Codex 6. tur) ya da kesimi (REC_CUTOFF, Codex 7. tur) sonra gelirse
  // işlem sayısı değişmez ama kayıt görünüme girer
  _alindiIzOf (n) {
    const r = n.replika
    let cozulen = 0
    let gecerli = 0
    for (const o of r.ops.values()) {
      if (o.inner) cozulen++
      if (o.status === 'gecerli') gecerli++
    }
    let anahtar = 0
    for (const e of r.keys.epochs.values()) anahtar += e.keys.size
    return [n.ledger.len, r.ops.size, r.writeQueue.length, cozulen, gecerli, anahtar, r.cutoffs.unions.size].join('|')
  }

  // SOS alındısı (RFC-0037 §5.3): Tüm Aile'de görünüme giren SOS için bu kimliğin hf.sos.alindi kaydı (bir kez; uyandırma
  // zarfı yok); yeni geçerli alındılar uygulamaya 'sos-received' { collectionId, sos, personId } olayıyla. İz (_alindiIzOf)
  // değişmedikçe yeniden hesaplanmaz. İlk geçişte var olan alındılar olay üretmez
  _sosAlindi () {
    const n = this.nesneler
    if (!n || !n.aile) return
    const r = n.replika
    const cid = tumAileOf(n.ledger)
    if (!cid) return
    const iz = this._alindiIzOf(n)
    if (iz === this._alindiIz) return
    let ks = Ol.olay.kayitlarReplikadan(r, cid)
    if (this.sosBildiren(hex(n.ledger.familyId))) {
      const yaz = Ol.alindi.yazilacaklar(r, cid, { now: this.now(), ks })
      for (const sos of yaz) r.put(cid, null, Ol.alindi.TUR, Ol.alindi.alindiAlanlari(r.meHex, sos, this.now()))
      if (yaz.length) ks = Ol.olay.kayitlarReplikadan(r, cid)
    }
    this._alindiIz = this._alindiIzOf(n)
    const ilk = !this._alindiGorulen
    if (ilk) this._alindiGorulen = new Set()
    for (const [sos, kisiler] of Ol.alindi.gecerliAlindilar(r, cid, ks)) {
      for (const personId of kisiler.keys()) {
        const k = sos + '|' + personId
        if (this._alindiGorulen.has(k)) continue
        this._alindiGorulen.add(k)
        if (!ilk) this.olay('sos-received', { collectionId: cid, sos, personId })
      }
    }
  }

  // Kimliğin hf.uygulama kaydı (RFC-0036 §3.3 madde 4): aile kurma, törenle katılma, APP_ATTACH ve ROTATE_DEVICE
  // (yeni kimlik bu çekirdeğe aileBagla ile gelir) ve açılışta; her kayıtta denenir. Kayıt güncelse ya da kimlik
  // yazamıyorsa (misafir, kutu, bekleyen, düzey 2.0) defter değişene kadar yeniden denenmez. Anahtar yoksa yazım
  // replikanın kuyruğunda bekler (kuyruk durumla saklanır).
  _uygulamaKaydi () {
    const n = this.nesneler
    if (!n || !n.aile || !this.appId || this._uygulamaSon === n.ledger.len) return
    const r = U.kendiKaydiniYaz(n.replika, this.appId, YETENEKLER)
    if (r === 'var' || r === null) this._uygulamaSon = n.ledger.len
  }

  /**
   * Yeni aile (RFC-0024 komut 2): kurucunun GENESIS'i, düzey ve varsayılan koleksiyonlar; durum hemen yazılır.
   * Dönüş: nesneler.
   */
  aileKur ({ aileAdi = '', benimAdim }) {
    if (this.nesneler.aile) throw hata('FAMILY_EXISTS')
    const { ledger } = S.LedgerApi.createFamily({ Ledger, me: this.kimlik, familyName: aileAdi, displayName: benimAdim, ts: this.now() })
    // Ledger'ın saati bu çekirdeğin saati olsun (LedgerApi.createFamily saatsiz kurar)
    ledger.now = this.now
    return this.aileBagla(ledger)
  }

  // --- Misafir kipi (RFC-0019 §11.3, RFC-0030; D99) ---------------------------------------------------------------
  // Misafir telefonunda defter yoktur: yalnız ebeveynin imzaladığı görünüm (GUEST_VIEW). nesneler.misafir: { gorunum
  // (acceptGuestView), ledger (guestLedger: taşıyıcının çift sırları), hlc, saklama (GuestWriteApi'nin küçük durumu),
  // iptal (verifyGuestRevoked sonucu ya da null), aileAdi (törende aile tarafının JOIN_HELLO'sundaki ad ya da null;
  // RFC-0036 §4.3 madde 5a: kayıt değil, yerel durum) }. Ürün GuestWriteApi'yi kendi kataloğuyla bunlardan kurar.
  //
  // Güven çapası (açılış öncesi inceleme): kabul edilen görünümün imzacısı ve zincir boyunca güvenilmiş ebeveynlerin
  // anahtarları durumla saklanır. Açılışta görünüm bu çapaya göre doğrulanır: ebeveyn cihaz değiştirdikten (halef) ya da
  // koleksiyonu imzalayan ebeveyn görünümden çıktıktan sonra da telefon açılır. Çapasız eski durum ilk görünüm gibi.
  _misafirKur (bayt, iptalBayt = null, onceki = null, capa = null, grantHash = null, aileAdi = null) {
    const { acceptGuestView, guestLedger, verifyGuestRevoked } = require('@havenfold/core').guestView
    const gorunum = acceptGuestView(onceki || capa, bayt, this.kimlik.memberId)
    if (grantHash && !b4a.equals(gorunum.grantHash, grantHash)) throw hata('VIEW_NOT_FOR_CEREMONY')
    const iptal = iptalBayt ? verifyGuestRevoked(gorunum, iptalBayt) : null
    const eski = this._misafir
    const hlc = eski ? eski.hlc : new Hlc({ last: this._hlcSon || 0n, persist: (h) => this._hlcYaz(h) })
    const peers = new Map((capa && capa.peers) || [])
    if (eski && eski.capa && b4a.equals(eski.capa.grantHash, gorunum.grantHash)) for (const [k, v] of eski.capa.peers) peers.set(k, v)
    for (const [k, v] of gorunum.peers) if (v.role === 'ebeveyn') peers.set(k, { role: v.role, signPub: v.signPub })
    const yeniCapa = { signerHex: gorunum.signerHex, familyId: gorunum.familyId, grantHash: gorunum.grantHash, ledgerLen: 0, ledgerHead: b4a.alloc(32), peers }
    this._misafir = { bayt: b4a.from(bayt), iptalBayt: iptalBayt ? b4a.from(iptalBayt) : null, capa: yeniCapa, aileAdi }
    this.nesneler.misafir = { gorunum, ledger: guestLedger(gorunum), hlc, saklama: this.urunSaklama('misafir/'), iptal, aileAdi }
    return this.nesneler.misafir
  }

  // Törenle gelen ya da güncellenen görünüm: doğrulanır (imzacı ebeveyn, misafirin kendisi, halef zinciri), durum yazılır.
  // tören: true (törenle gelen ilk görünüm): önceki görünüme bağlanmadan baştan doğrulanır; grantHash (taşıyıcı verir):
  // görünümün GRANT'ı bu törende imzalanan olmalı, değilse hiçbir durum değişmez (VIEW_NOT_FOR_CEREMONY); aileAdi o
  // törende gelen ad, sonraki görünümler adı değiştirmez.
  // Törenle gelmeyen görünüm iptali kaldırmaz: GUEST_REVOKED'i görmemiş bir ebeveynin sonradan yolladığı görünüm
  // misafirliği yeniden açmaz (açılış öncesi inceleme); iptal yalnız yeni bir törenle kalkar.
  misafirBagla (bayt, { toren = false, grantHash = null, aileAdi = null } = {}) {
    if (this.nesneler.aile) throw hata('FAMILY_EXISTS')
    const onceki = this.nesneler.misafir && !toren ? this.nesneler.misafir.gorunum : null
    const iptalBayt = !toren && this._misafir ? this._misafir.iptalBayt : null
    const eskiAile = this._misafir && this._misafir.capa ? this._misafir.capa.familyId : null
    const ad = toren ? (typeof aileAdi === 'string' ? aileAdi : null) : (this._misafir ? this._misafir.aileAdi : null)
    const m = this._misafirKur(bayt, iptalBayt, onceki, null, toren ? grantHash : null, ad)
    // Başka ailenin misafirliği: eski ailenin bırakma kuyruğu ve küçük durumu yeni ailenin üyelerine taşınmaz
    if (toren && eskiAile && !b4a.equals(eskiAile, m.gorunum.familyId) && this._urunKV) for (const k of [...this._urunKV.keys()]) if (k.startsWith('misafir/')) this._urunKV.delete(k)
    this.kaydet()
    return m
  }

  // Misafirlik bitti mi: 'iptal' (GUEST_REVOKED) | 'suresi-doldu' (GRANT expiresAt geçti) | null. Süre dolunca bırakma
  // yapılmaz, oturum kurulmaz (PairBook) ve misafirin yerel kuyruğu ile küçük durumu silinir (_misafirSuresi; Codex 9. tur)
  misafirBitti () {
    const m = this.nesneler.misafir
    if (!m) return null
    if (m.iptal) return 'iptal'
    const e = m.gorunum && m.gorunum.expiresAt
    return Number.isSafeInteger(e) && this.now() >= e ? 'suresi-doldu' : null
  }

  _misafirSuresi () {
    if (this.misafirBitti() !== 'suresi-doldu' || !this._urunKV) return
    for (const k of [...this._urunKV.keys()]) if (k.startsWith('misafir/')) this._urunKV.delete(k)
  }

  // GUEST_REVOKED: misafirlik bitti (iptal, ebeveyn ayrıldı); bırakma artık yapılmaz
  misafirIptal (bayt) {
    const m = this.nesneler.misafir
    if (!m) throw hata('NOT_GUEST')
    const { verifyGuestRevoked } = require('@havenfold/core').guestView
    m.iptal = verifyGuestRevoked(m.gorunum, bayt)
    this._misafir.iptalBayt = b4a.from(bayt)
    this.kaydet()
    return m.iptal
  }

  /**
   * Dışarıda kurulmuş ya da eşleşmeyle gelen defteri bu çekirdeğe bağlar (replika boş başlar); durum hemen yazılır.
   * aileGecidi(ledger) (start.js, kök örnek): bağlamadan önce çağrılır, hata fırlatırsa aile bağlanmaz; dönen işlev
   * bağladıktan sonra çağrılır (kullanılan ebeveyn izinleri; RFC-0034 §4.4). Defter, ailenin yeni olup olmadığı için verilir.
   */
  aileBagla (ledger) {
    if (this.nesneler.aile) throw hata('FAMILY_EXISTS')
    if (this.nesneler.misafir) throw hata('IN_GUEST_MODE') // aynı kimlik bir defterde misafir, öbüründe üye olmaz (RFC-0034 madde 1)
    const sonra = this.aileGecidi ? this.aileGecidi(ledger) : null
    const replika = new Replika({ ledger, me: this.kimlik, now: this.now, hlc: new Hlc({ last: this._hlcSon, persist: (h) => this._hlcYaz(h) }) })
    replika.sync()
    this._nesneleriKur({ ledger, replika, caps: this.nesneler.caps })
    this.kaydet()
    if (sonra) sonra()
    return this.nesneler
  }

  // Bu çekirdek ailenin kutusuysa kör emanet (D34); değilse null
  kutu () {
    const n = this.nesneler
    if (!n || !n.aile || n.ledger.members.get(hex(this.kimlik.memberId))?.role !== 'kutu') return null
    if (!this._kutu) this._kutu = kutuKur(this._kutuGoruntu, { ledger: n.ledger, now: this.now })
    return this._kutu
  }

  // ---------------------------------------------------------------- arsiv: kasa anahtarları (RFC-0027 §5 b)

  _kasaCidleri () {
    const L = this.nesneler.ledger
    if (!L || !this.arsivPub) return new Set()
    return new Set([...L.collections.values()].filter((c) => c.sensitivity === 'kasa').map((c) => c.id))
  }

  _muhurle (x) {
    const b = jsonYaz(x)
    const out = b4a.alloc(b.byteLength + SEAL)
    sodium.crypto_box_seal(out, b, this.arsivPub)
    sodium.sodium_memzero(b)
    return out
  }

  // arsiv: [başlık, ...mühürlü öğeler]. Başlıksız dosya eski biçimdir (D36 öncesi). Dönüş: { sayac, pub, ogeler }
  _arsivOku () {
    const b = this.depo.oku('arsiv')
    if (!b) return null
    const parcalar = parcalariOku(b, 'arsiv')
    const bas = parcalar[0]
    const sayacOf = () => Number(new DataView(bas.buffer, bas.byteOffset, 12).getBigUint64(4))
    if (bas && bas.byteLength === 44 && b4a.equals(bas.subarray(0, 4), ARSIV_BASLIK)) return { sayac: sayacOf(), pub: b4a.from(bas.subarray(12)), ogeler: parcalar.slice(1) }
    if (bas && bas.byteLength === 12 && b4a.equals(bas.subarray(0, 4), ARSIV_BASLIK_1)) return { sayac: sayacOf(), pub: null, ogeler: parcalar.slice(1) }
    return { sayac: null, pub: null, ogeler: parcalar }
  }

  _arsivListe () { const a = this._arsivOku(); return a ? a.ogeler : [] }

  // Diskteki arsivin başlık sayacı (bilgi; denetim özetle)
  get arsivSayac () { const a = this._arsivOku(); return a ? a.sayac : null }

  // Arsiv iki aşamalı yazılır (inceleme 14 Y4): önce durum [önceki özet, yeni özet], sonra arsiv; çağıran sonra kaydet()
  // ile durumu yalnız yeni özetle yazar. Başlık: sayaç (bilgi) ve öğelerin mühürlendiği açık anahtar.
  _arsivDosya (muhurlu) {
    const bas = b4a.alloc(44)
    bas.set(ARSIV_BASLIK, 0)
    new DataView(bas.buffer, bas.byteOffset, 12).setBigUint64(4, BigInt(this.sayac + 1))
    bas.set(this.arsivPub, 12)
    const icerik = parcalariYaz([bas, ...muhurlu])
    const ozet = hex(kdf.hash('hf/worklet/arsiv', icerik))
    this._arsivGecis = [this.arsivOzet, ozet]
    try {
      this._durumYaz()
      this.depo.yaz('arsiv', icerik)
      this.arsivOzet = ozet
    } finally {
      this._arsivGecis = null
    }
  }

  // Bellekteki kasa öğeleri: anahtarlar, bekleyen yazımlar, anahtar ve kesim çıkışı, bekleyen anahtar mesajları,
  // gönderilecek pay baytları, tutulan paylar. Öğe kimliği içeriğin özetidir (inceleme 13 bulgu 4: yeniden kurulumda
  // aynı uzunluktaki yeni sürüm eskisiyle karışmasın)
  _kasaOgeleri (kasa) {
    const r = this.nesneler.replika
    const out = []
    const ekle = (x) => out.push({ kim: x.t + ':' + hex(kdf.hash('hf/worklet/arsiv-oge', jsonYaz(x))), x })
    for (const s of r.keys.epochs.values()) {
      if (!kasa.has(s.cid)) continue
      for (const x of s.keys.values()) ekle({ t: 'a', cid: s.cid, epochSeq: s.epochSeq, epochHash: s.epochHash, entry: x.entry })
      if (s.keys.size) this._arsivDonemleri.add(s.cid + '|' + s.epochSeq + '|' + hex(s.epochHash))
    }
    for (const w of r.writeQueue) if (kasa.has(w.cid)) ekle({ t: 'y', item: w })
    for (const m of r.outbox) if (kasaCikisi(m, kasa)) ekle({ t: 'o', m })
    for (const b of r.pendingKeys) if (kasa.has(recKeyCid(b))) ekle({ t: 'k', b })
    // Pay teslimi (D31): gönderilecek pay baytları, bu telefonun bildiği KRA (RFC-0027 §9 b) ve tuttuğu paylar
    for (const [k, v] of this._kasaKV || []) if (S.isSecret(k)) ekle({ t: 's', k, v })
    for (const [k, v] of this._urunKV || []) if (urunGizliMi(k)) ekle({ t: 'u', k, v })
    const tut = this.nesneler.kasa && this.nesneler.kasa.tutucu
    if (tut) for (const [k, v] of tut.paylar) ekle({ t: 'p', k, v })
    return out
  }

  _arsivYaz (kasa) {
    if (!this.arsivPub || !this.nesneler.aile) return
    const ogeler = this._kasaOgeleri(kasa)
    if (this.arsivAcik) {
      // Açıkken bellekteki hâl tam hâldir: dosya baştan yazılır (artık kuyrukta olmayan yazım düşer)
      const kimlik = ogeler.map((o) => o.kim).join(',')
      if (kimlik === this._arsivKimlik && this.arsivOzet !== null) return
      this._arsivDosya(ogeler.map((o) => this._muhurle(o.x)))
      this._arsivKimlik = kimlik
      return
    }
    // Kilitliyken gelen kasa öğeleri (REC_KEY, pay) mühürlenip eklenir, bellekten çıkar (açık anahtar yeter)
    if (!ogeler.length) return
    this._arsivDosya([...this._arsivListe(), ...ogeler.map((o) => this._muhurle(o.x))])
    this._kasaBirak(kasa)
  }

  // Kasa koleksiyonlarının anahtarları ve anahtar taşıyan mesajları bellekten sıfırlanarak silinir; çözülmüş işlemleri
  // bırakılır (yeniden anahtar bekler)
  _kasaBirak (kasa) {
    const r = this.nesneler.replika
    if (!r) return
    for (const [k, s] of [...r.keys.epochs]) {
      if (!kasa.has(s.cid)) continue
      for (const v of s.keys.values()) if (v.key) sodium.sodium_memzero(v.key)
      r.keys.epochs.delete(k)
    }
    for (const o of r.ops.values()) {
      if (!kasa.has(o.cid) || !o.inner) continue
      o.inner = null
      o.status = 'bekliyor'
      o.code = 'NO_KEY'
    }
    r.writeQueue = r.writeQueue.filter((w) => !kasa.has(w.cid))
    r.outbox = r.outbox.filter((m) => { if (!kasaCikisi(m, kasa)) return true; if (m.type === REC_KEY) sodium.sodium_memzero(m.bytes); return false })
    r.pendingKeys = r.pendingKeys.filter((b) => { if (!kasa.has(recKeyCid(b))) return true; sodium.sodium_memzero(b); return false })
    if (this._kasaKV) for (const k of [...this._kasaKV.keys()]) if (S.isSecret(k)) this._kasaKV.delete(k)
    if (this._urunKV) for (const k of [...this._urunKV.keys()]) if (urunGizliMi(k)) this._urunKV.delete(k)
    const tut = this.nesneler.kasa && this.nesneler.kasa.tutucu
    if (tut) { for (const v of tut.paylar.values()) if (v.share && v.share.share) sodium.sodium_memzero(v.share.share); tut.paylar.clear() }
  }

  // 389 VAULT_ARCHIVE_MOVE (D40): bütün öğeler eski gizli anahtarla açılır ve yeni açık anahtara mühürlenir; biri bile
  // açılmazsa STATE_CORRUPT ve hiçbir şey değişmez. Yeni dosya tek atomik yazımla gelir: yazım düşerse eski dosya ve eski
  // anahtar geçerli kalır. Başlık yeni açık anahtarı taşır. Dönüş: { oge }
  arsivTasi (eskiArchiveKeyHex, yeniArchivePubHex) {
    if (!this.arsivPub) throw hata('NO_KEY')
    for (const h of [eskiArchiveKeyHex, yeniArchivePubHex]) if (typeof h !== 'string' || !/^[0-9a-f]{64}$/.test(h)) throw hata('INVALID_KEY')
    const sk = b4a.from(eskiArchiveKeyHex, 'hex')
    const pk = b4a.alloc(32)
    const yeniPub = b4a.from(yeniArchivePubHex, 'hex')
    // Yeni açık anahtar deneme mühürlemesiyle denetlenir: sıfır ya da küçük mertebeli nokta kabul edilirse sonraki her
    // mühürleme ve yazım düşerdi (inceleme 15 B3)
    try {
      if (sodium.sodium_is_zero(yeniPub)) throw new Error('sifir')
      sodium.crypto_box_seal(b4a.alloc(1 + SEAL), b4a.alloc(1), yeniPub)
    } catch { throw hata('INVALID_KEY') }
    try {
      sodium.crypto_scalarmult_base(pk, sk)
      if (!b4a.equals(pk, this.arsivPub)) throw hata('WRONG_LOCK_KEY')
      const a = this._arsivOku()
      const yeni = []
      for (const m of a ? a.ogeler : []) {
        if (m.byteLength < SEAL) throw hata('STATE_CORRUPT', 'arsiv')
        const acik = b4a.alloc(m.byteLength - SEAL)
        if (!sodium.crypto_box_seal_open(acik, m, pk, sk)) throw hata('STATE_CORRUPT', 'arsiv')
        const out = b4a.alloc(acik.byteLength + SEAL)
        sodium.crypto_box_seal(out, acik, yeniPub)
        sodium.sodium_memzero(acik)
        yeni.push(out)
      }
      const eskiPub = this.arsivPub
      this.arsivPub = yeniPub
      try { this._arsivDosya(yeni) } catch (err) { this.arsivPub = eskiPub; throw err }
      this._arsivKimlik = null
      // Arsiv yeni anahtarla yazıldı: taşıma işlenmiştir, geri alınmaz. Durum yazımı düşerse ayrı kodla döner; uygulama
      // eski ve yeni anahtar çiftini, yeni anahtarla açılış başarılı olana kadar saklar (inceleme 15 B1)
      try { this.kaydet() } catch { throw hata('ARCHIVE_MOVED_STATE_WRITE_FAILED') }
      return { oge: yeni.length }
    } finally {
      sodium.sodium_memzero(sk)
    }
  }

  // VaultApi.unlock'ın kancası: yanlış anahtarda false
  _arsivDogrula (h) {
    try { this.arsivAc(h); return true } catch (err) { if (err.message === 'WRONG_LOCK_KEY') return false; throw err }
  }

  // 224 UNLOCK: Arşiv gizli anahtarıyla arsiv açılır; anahtarlar doğrulanıp belleğe, bekleyen yazımlar kuyruğa
  arsivAc (archiveKeyHex) {
    if (!this.arsivPub) throw hata('NO_KEY')
    if (typeof archiveKeyHex !== 'string' || !/^[0-9a-f]{64}$/.test(archiveKeyHex)) throw hata('INVALID_KEY')
    const sk = b4a.from(archiveKeyHex, 'hex')
    const pk = b4a.alloc(32)
    try {
      sodium.crypto_scalarmult_base(pk, sk)
      if (!b4a.equals(pk, this.arsivPub)) throw hata('WRONG_LOCK_KEY')
      if (this.arsivAcik || !this.nesneler.aile) { this.arsivAcik = true; return }
      const r = this.nesneler.replika
      // Önce bütün öğeler çözülür ve denetlenir; biri bozuksa hiçbiri uygulanmaz (yarıda kalıp çiftlenmesin)
      const ogeler = []
      for (const m of this._arsivListe()) {
        if (m.byteLength < SEAL) throw hata('STATE_CORRUPT', 'arsiv')
        const acik = b4a.alloc(m.byteLength - SEAL)
        if (!sodium.crypto_box_seal_open(acik, m, pk, sk)) throw hata('STATE_CORRUPT', 'arsiv')
        const x = jsonOku(acik, 'arsiv')
        sodium.sodium_memzero(acik)
        if (!x || !['a', 'y', 'o', 'k', 's', 'p', 'u'].includes(x.t)) throw hata('STATE_CORRUPT', 'arsiv')
        if (x.t === 's' && !S.isSecret(x.k)) throw hata('STATE_CORRUPT', 'arsiv')
        if (x.t === 'u' && (typeof x.k !== 'string' || !urunGizliMi(x.k) || typeof x.v !== 'string')) throw hata('STATE_CORRUPT', 'arsiv')
        if (x.t === 'k' && !baytMi(x.b)) throw hata('STATE_CORRUPT', 'arsiv')
        if (x.t === 'o' && (!x.m || !baytMi(x.m.bytes) || ![REC_KEY, REC_CUTOFF].includes(x.m.type))) throw hata('STATE_CORRUPT', 'arsiv')
        // Anahtar girdisi de uygulanmadan önce doğrulanır (dönem özeti çatallanmayla değişmiş olabilir; inceleme 14)
        if (x.t === 'a') x.dogrulanan = anahtarDogrula(r, x.cid, x.epochSeq, x.epochHash, x.entry, 'arsiv')
        ogeler.push(x)
      }
      const cidler = new Set()
      const goruldu = new Set()
      const tut = this.nesneler.kasa && this.nesneler.kasa.tutucu
      for (const x of ogeler) {
        // Kilitliyken eklenen öğeler açıkken yazılmış olanlarla aynı olabilir: içerik özetiyle bir kez
        const { dogrulanan, ...oz } = x
        const kim = x.t + ':' + hex(kdf.hash('hf/worklet/arsiv-oge', jsonYaz(oz)))
        if (goruldu.has(kim)) continue
        goruldu.add(kim)
        if (x.t === 'a') {
          if (!r.keys.has(x.cid, x.epochSeq, x.epochHash) || !r.keys.get(x.cid, x.epochSeq, x.epochHash, x.entry.keyId)) r.keys.add(x.cid, x.dogrulanan.ep, x.entry, x.dogrulanan.role)
          cidler.add(x.cid)
        } else if (x.t === 'y') { r.writeQueue.push(x.item); cidler.add(x.item.cid) } else if (x.t === 'o') r.outbox.push(x.m)
        else if (x.t === 'k') r.pendingKeys.push(x.b)
        else if (x.t === 's') this._kasaKV.set(x.k, x.v)
        else if (x.t === 'u') { if (!this._urunKV) this._urunKV = new Map(); this._urunKV.set(x.k, x.v) }
        else if (x.t === 'p' && tut) {
          // Tutucu kuralları (inceleme 13 bulgu 6): eski sürüm ve dizinde olmayan (sonradan silinmiş) pay yüklenmez
          const ozet = tut.dizin.get(x.k)
          if (tut.dizin.size && (ozet === undefined || ozet !== payOzeti(x.v.share))) continue
          try { tut.ekle({ share: x.v.share }, x.v.rootId ? { rootId: x.v.rootId } : {}) } catch (err) { if (err.message !== 'STALE_VERSION') throw err }
        }
      }
      this.arsivAcik = true
      this._arsivDonemleriBilinmiyor = false
      for (const c of cidler) r._afterKeys(c)
      // Kilitliyken ertelenen kesimler şimdi, çözülen işlemlerle (RFC-0027 §9 h)
      r.ertelenenKesimleriVer()
      // Kilitliyken üretilmeyen kasa dönem anahtarları şimdi (kurulduktan sonra hiç açılmamış kasa) ve bekleyen yazımlar
      r._autoKeys()
      r._flushWrites()
      // Kilitliyken gelen kasa kayıtları şimdi çözüldü: dosyaları kasa dosyaları dizinine, uygulamaya değişiklik
      // (inceleme 14 Y5)
      const kayit = this.nesneler.kayit
      for (const cid of this._kasaCidleri()) {
        const rids = r.records(cid).map((x) => x.recordId)
        if (rids.length && kayit) kayit.changed(cid, rids)
      }
      this._arsivKimlik = null
    } finally {
      sodium.sodium_memzero(sk)
    }
  }

  // 19 LOCK ve 5 dakika işlemsizlik: arsiv son hâliyle yazılır, kasa anahtarları bellekten çıkar
  arsivKilitle () {
    if (!this.arsivAcik) return
    if (typeof this.kaydetmedenOnce === 'function') this.kaydetmedenOnce()
    if (this.nesneler.aile) {
      const kasa = this._kasaCidleri()
      this._arsivYaz(kasa)
      this._kasaBirak(kasa)
    }
    this.arsivAcik = false
    if (this.nesneler.kasa && !this.nesneler.kasa.locked()) this.nesneler.kasa.lock()
    if (typeof this.kilitlenince === 'function') this.kilitlenince()
    // LOCK hemen yazar: arsiv ile durum arasında pencere kalmasın (inceleme 14 Y4)
    this.kaydet()
  }

  // ---------------------------------------------------------------- yazım

  _ozetlik () {
    const n = this.nesneler
    const temel = { v: DURUM_SURUMU, kimlikOzet: this.kimlikOzet, yerelNo: this.yerelNo, ...(this.depo.kip === SIFRELI ? { sifreli: true } : {}) }
    // Ürün durumu aile kurulmadan da yazılır (inceleme A3 madde 8); arşiv varsa gizli öneklerin değeri arşivde
    const urun = [...(this._urunKV || [])].filter(([k]) => !(this.arsivPub && urunGizliMi(k))).sort(([a], [b]) => (a < b ? -1 : 1))
    if (urun.length) temel.urun = urun
    // Afet modu (D104): ailesizken de (afet hâli) yazılır
    if (this._afetKV && this._afetKV.size) temel.afet = [...this._afetKV].sort(([a], [b]) => (a < b ? -1 : 1))
    // Misafir kipi (D99): son kabul edilen GUEST_VIEW ve (varsa) GUEST_REVOKED baytları; açılışta yeniden doğrulanır
    if (!n.aile && this._misafir) temel.misafir = { gorunum: this._misafir.bayt, iptal: this._misafir.iptalBayt || null, capa: capaKodla(this._misafir.capa), aileAdi: this._misafir.aileAdi }
    if (!n.aile) return { ...temel, defter: null }
    const kasa = this._kasaCidleri()
    return {
      ...temel,
      defter: defterGoruntusu(n.ledger, n.defter.oneriler, n.caps),
      replika: replikaGoruntusu(n.replika, kasa),
      dosya: {
        eklenen: [...n.kayit.eklenen],
        tutucular: [...n.kayit.tutucular.m].map(([id, s]) => [id, [...s]]),
        bekleyen: [...n.kayit._bekleyen],
        kasa: [...n.kayit.kasaDosyalari] // kasa kayıtlarının dosyaları (kilitliyken açılmasın; inceleme 13 bulgu 8)
      },
      gorulme: [...n.gorulme.son],
      onay: n.gorev.onay.toJSON(),
      kasa: [...(this._kasaKV || [])].filter(([k]) => !S.isSecret(k)),
      kasaPayDizini: n.kasa ? [...n.kasa.tutucu.dizin] : this._kasaPayDizini,
      arsivOzetleri: this._arsivGecis || [this.arsivOzet],
      arsivDonemleri: [...(this._arsivDonemleri || [])].sort(),
      kutu: this._kutu ? kutuGoruntusu(this._kutu) : this._kutuGoruntu,
      torenAnahtarlari: [...(this.torenAnahtarlari || [])].sort(([a], [b]) => (a < b ? -1 : 1)),
      esitleme: n.esitleme.toJSON()
    }
  }

  /**
   * Ürünün kalıcı küçük durumu, önekle ayrılmış: { get(k), set(k, v), delete(k) }; değerler JSON, değer başına 256 KB, toplam
   * 4 MB. undefined yazmak siler. Gizli önekler (URUN_GIZLI) arşiv anahtarı varsa Arşiv katmanında durur ve yedeğe girer;
   * arşiv kilitliyken okunup yazılamaz (ARCHIVE_LOCKED). Durum dosyasıyla yazılır.
   */
  urunSaklama (onek) {
    if (typeof onek !== 'string' || !/^[a-z0-9.-]{1,32}\/$/.test(onek)) throw hata('INVALID_NAME')
    if (!this._urunKV) this._urunKV = new Map()
    const kv = this._urunKV
    const kilitli = (a) => this.arsivPub && !this.arsivAcik && urunGizliMi(a)
    return {
      get: (k) => {
        const a = onek + k
        if (kilitli(a)) throw hata('ARCHIVE_LOCKED')
        return kv.has(a) ? JSON.parse(kv.get(a)) : null
      },
      set: (k, v) => {
        const a = onek + k
        if (kilitli(a)) throw hata('ARCHIVE_LOCKED')
        if (v === undefined) { kv.delete(a); return }
        const j = JSON.stringify(v)
        if (typeof j !== 'string') throw hata('INVALID_VALUE')
        if (j.length > URUN_DEGER_EN_COK) throw hata('VALUE_TOO_LARGE')
        let toplam = j.length
        for (const [x, y] of kv) if (x !== a) toplam += y.length
        if (toplam > URUN_TOPLAM_EN_COK) throw hata('VALUE_TOO_LARGE')
        kv.set(a, j)
      },
      delete: (k) => { kv.delete(onek + k) }
    }
  }

  /**
   * Afet modunun kalıcı durumu (RFC-0031 §8.3; D104): DisasterApi'nin saklaması ({ get, set }); afet hâli, sakla-ilet deposu,
   * teslim edilmemiş kendi mesajları ve gelen kutusu şifreli durum dosyasında kalır, yeniden açılışta sıfırlanmaz. Ürün
   * saklamasının değer başına 256 KB sınırı depoya (en çok 512 KB taşınan mesaj) yetmediği için ayrıdır; toplam 4 MB.
   */
  afetSaklama () {
    if (!this._afetKV) this._afetKV = new Map()
    if (!this._afetOnce) this._afetOnce = new Set()
    const kv = this._afetKV
    const once = this._afetOnce
    return {
      // DisasterApi deposunun bekleyen yazımı (mikro görevde) durum dosyasından önce boşaltılır
      kaydetmedenOnce: (fn) => { if (typeof fn === 'function') once.add(fn) },
      get: (k) => (kv.has(k) ? JSON.parse(kv.get(k)) : null),
      set: (k, v) => {
        if (v === undefined) { kv.delete(k); return }
        const j = JSON.stringify(v)
        if (typeof j !== 'string') throw hata('INVALID_VALUE')
        let toplam = j.length
        for (const [x, y] of kv) if (x !== k) toplam += y.length
        if (toplam > AFET_TOPLAM_EN_COK) throw hata('VALUE_TOO_LARGE')
        kv.set(k, j)
      }
    }
  }

  /** Törenden gelen anahtar (RFC-0028 §7 c): karşı tarafın memberId'si (hex) ve 32 bayt; taşıyıcının çift sırrına girer */
  torenAnahtariKaydet (peerHex, anahtar) {
    if (typeof peerHex !== 'string' || !/^[0-9a-f]{32}$/.test(peerHex) || !b4a.isBuffer(anahtar) || anahtar.byteLength !== 32) throw hata('INVALID_KEY')
    if (!this.torenAnahtarlari) this.torenAnahtarlari = new Map()
    this.torenAnahtarlari.set(peerHex, b4a.toString(anahtar, 'hex'))
    sodium.sodium_memzero(anahtar)
  }

  goruntu () { return { ...this._ozetlik(), sayac: this.sayac } }

  // Durumu yazar; değişmediyse diske dokunmaz. Kasa anahtarları önce arsive. Her yazımda sayaç artar ve kaydedildi
  // kancası çağrılır. Dönüş: yazıldı mı
  kaydet () {
    for (const fn of this._afetOnce || []) { try { fn() } catch {} }
    this._uygulamaKaydi()
    this._sosAlindi()
    this._misafirSuresi()
    // Önce taşıyıcı çıkışı boşaltır (kasa REC_KEY'i mühürlenip çıkıştan silinmeden gitsin; start bağlar)
    if (typeof this.kaydetmedenOnce === 'function') this.kaydetmedenOnce()
    if (this.nesneler.aile) this._arsivYaz(this._kasaCidleri())
    return this._durumYaz(true)
  }

  // Durum dosyası; degismediyseAtla: özet aynıysa yazma
  _durumYaz (degismediyseAtla = false) {
    const ozetlik = this._ozetlik()
    const ozet = kdf.hash('hf/worklet/durum', jsonYaz(ozetlik))
    if (degismediyseAtla && this.sonOzet && b4a.equals(ozet, this.sonOzet)) return false
    this.depo.yaz('durum', jsonYaz({ ...ozetlik, sayac: this.sayac + 1 }))
    this.sayac++
    this.sonOzet = ozet
    if (typeof this.kaydedildi === 'function') this.kaydedildi(this.sayac)
    return true
  }
}

module.exports = { Kalici, Depo, DiskDeposu, kodla, coz, atomikYaz, defterGoruntusu, defterKur, replikaGoruntusu, replikaKur, kutuGoruntusu, kutuKur, gocEt, GOCLER, DURUM_SURUMU, kilitBirak, yeniYerelNo, YEREL_NO }
