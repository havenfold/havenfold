// SPDX-License-Identifier: AGPL-3.0-only
// tools.js — hizmetin paketi açan ve cevaplayan komut satırı aracı (RFC-0010 §8.3, §12.2, §13.2): kendi alıcısını kuran hizmet için
//   node tools.js ac <kart (hex)> <şifre anahtarı (hex, X25519 gizli)> <paket (ikili)>
//     Çıktı: gövde JSON (öğelerin alanları çözülmüş, dosya anahtarları hex; silme paketinde silinmesi istenen `ref`)
//   node tools.js cevap <kart (hex)> <imza anahtarı (hex, Ed25519 gizli)> <şifre anahtarı (hex)> <paket (ikili)> <tür> [metin] [n]
//     tür: makbuz | mesaj | belge | ret | silindi. Çıktı: { packageId, n, cevap (hex) }; alıcıya PUT /v1/r/{packageId}/{n}.
//     'silindi' yalnız silme paketine, 'ret' imzası doğrulanamayan pakete de (açılabildiyse) yazılır. Belge dosyalarının
//     yüklenmesi RFC'de açık nokta (açıklama 2 madde 5): belge cevabı şimdilik yalnız metin taşır.
// Anahtar dosyaları yalnız okunur, yazdırılmaz.
const b4a = require('b4a')
const { kart: Kt, paket: P, cevap: C, kodlama: K } = require('@havenfold/services')

const hex = (b) => b4a.toString(b, 'hex')

function paketiAc ({ kartBytes, encSecret, paketBytes }) {
  const kart = Kt.kartCoz(kartBytes)
  const { paket, govde } = P.paketAc(paketBytes, { kart, encSecret })
  return {
    packageId: hex(paket.packageId), shareId: hex(govde.shareId), kind: govde.kind, seqNo: govde.seqNo, category: govde.category,
    title: govde.title, note: govde.note, issuedAt: govde.issuedAt, useUntil: govde.useUntil, gonderen: { takmaAd: hex(govde.sender.pseudoPub), etiket: govde.sender.label },
    replyPub: hex(govde.replyPub), ogeler: govde.items.map((i) => ({ type: i.type, alanlar: duz(P.alanlarCoz(i.fields)) })),
    dosyalar: govde.files.map((f) => ({ blobId: hex(f.blobId), fileKey: hex(f.fileKey), size: f.size, mime: f.mime, name: f.name })),
    ref: govde.ref ? hex(govde.ref) : null
  }
}

const TURLER = ['makbuz', 'mesaj', 'belge', 'ret', 'silindi']
function fail (kod) { throw new Error(kod) }

// İmza denetimi olmadan iç gövde (yalnız 'ret' için: hizmet doğrulayamadığı pakete de cevap verebilsin, §7.2)
function icGovde (kart, encSecret, paketBytes) {
  try { return P.paketAc(paketBytes, { kart, encSecret }) } catch (e) {
    if (e.message !== 'INVALID_SIGNATURE') throw e
    const sodium = require('sodium-native')
    const p = P.paketCoz(paketBytes)
    const pub = b4a.alloc(32)
    sodium.crypto_scalarmult_base(pub, encSecret)
    const ortak = P.x25519(encSecret, p.ephPub)
    const { kdf: { hashLP, deriveLP } } = require('@havenfold/core')
    const k = deriveLP(hashLP(K.ETIKET.dh, ortak, p.ephPub, pub), K.ETIKET.key)
    const ic = b4a.alloc(p.ct.byteLength - sodium.crypto_aead_xchacha20poly1305_ietf_ABYTES)
    sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(ic, null, p.ct, P.adOf(p), p.nonce, k)
    const { body } = K.kanonik(K.PAKET_IC, ic, 'PACKAGE_CORRUPT')
    return { paket: p, govde: P.govdeCoz(body), imzaGecersiz: true }
  }
}

/** Pakete cevap (CEVAP baytları). 'silindi' yalnız silme paketine; 'ret' dışında imzası geçersiz pakete cevap yazılmaz */
function cevapYaz ({ kartBytes, signSecret, encSecret, paketBytes, kind, text = '', n = 0, at = Date.now() }) {
  if (!TURLER.includes(kind)) fail('REPLY_CORRUPT')
  const kart = Kt.kartCoz(kartBytes)
  const a = icGovde(kart, encSecret, paketBytes)
  if (a.imzaGecersiz && kind !== 'ret') fail('INVALID_SIGNATURE')
  if ((kind === 'silindi') !== (a.govde.kind === 'silme')) fail('REPLY_CORRUPT')
  const bytes = C.cevapKur({ packageId: a.paket.packageId, n, replyPub: a.govde.replyPub, signSecret, kind, text, files: [], at })
  return { packageId: hex(a.paket.packageId), n, cevap: hex(bytes), ref: a.govde.ref ? hex(a.govde.ref) : null }
}

// JSON'a yazılabilir değerler: bayt hex, büyük tamsayı metin
function duz (v) {
  if (b4a.isBuffer(v)) return hex(v)
  if (typeof v === 'bigint') return v.toString()
  if (Array.isArray(v)) return v.map(duz)
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([a, x]) => [a, duz(x)]))
  return v
}

/* c8 ignore start */ // komut satırı girişi; işlevler testte
if (require.main === module) {
  const fs = require('fs')
  const [komut, ...a] = process.argv.slice(2)
  const okuHex = (f) => b4a.from(fs.readFileSync(f, 'utf8').trim(), 'hex')
  try {
    if (komut === 'ac' && a.length === 3) console.log(JSON.stringify(paketiAc({ kartBytes: okuHex(a[0]), encSecret: okuHex(a[1]), paketBytes: fs.readFileSync(a[2]) }), null, 2))
    else if (komut === 'cevap' && a.length >= 5) console.log(JSON.stringify(cevapYaz({ kartBytes: okuHex(a[0]), signSecret: okuHex(a[1]), encSecret: okuHex(a[2]), paketBytes: fs.readFileSync(a[3]), kind: a[4], text: a[5] || '', n: Number(a[6] || 0) })))
    else { console.error('kullanım: node tools.js ac <kart> <anahtar> <paket> | cevap <kart> <imza> <anahtar> <paket> <tür> [metin] [n]'); process.exit(2) }
  } catch (e) { console.error('olmadı: ' + e.message); process.exit(1) }
}
/* c8 ignore stop */

module.exports = { paketiAc, cevapYaz, duz }
