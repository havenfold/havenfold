// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// archive.js — kabın içindeki arşiv: icerik.json, dosyalar/, BENIOKU.txt (RFC-0014 §4)
//
// Kişi alanları görünen adla yazılır; iç kimlikler (memberId, deviceId) ve iç kimlik taşıyan başvurular (msg:, kayit:)
// dışarı çıkmaz. Yapay zekanın doldurduğu alanlar her kayıtta yapay_zeka_alanlari ile işaretlenir (_ai'den).
// Ürün şeması (bicim, bicimSurum) ürünün belgesindedir; burada yalnız ortak dönüşümler var.
const b4a = require('b4a')
const { zipYaz, zipAkis, crcAkis, zipOku, adGecerli } = require('./zip')
const { kapla, kaplaAsync, ac, acAsync, kapYaziciAsync } = require('./export')

function fail (code) { throw new Error(code) }

const BENIOKU = [
  'Bu klasör bir Havenfold dışa aktarmasıdır (RFC-0014).',
  'icerik.json: kayıtlar, ürünün şemasıyla (bicim, bicimSurum). dosyalar/: ekler, çözülmüş halde.',
  'Kişiler görünen adlarıyla yazılmıştır. yapay_zeka_alanlari: yapay zekanın doldurup kullanıcının onayladığı alanlar.',
  '',
  'This folder is a Havenfold export (RFC-0014).',
  'icerik.json: records in the product schema (bicim, bicimSurum). dosyalar/: attachments, decrypted.',
  'People are written by display name. yapay_zeka_alanlari: fields filled by AI and approved by the user.',
  ''
].join('\n')

const KIMLIK_RE = /^(uye|device|grant|varlik|yer):([0-9a-f]{32})$/
// İç kimlikler hiçbir metin değerinde dışarı çıkmaz (RFC-0021 g): kişi ve nesne kimlikleri görünen ada, başvurular
// (msg:, kayit:) [kaynak]'a çevrilir; çevrilemeyen [bilinmeyen] olur
const KISI_METIN_RE = /(uye|device|grant|varlik|yer):([0-9a-f]{32})/g
const BASVURU_RE = /(msg:[0-9a-f]{64}\/[0-9a-f]{32}|kayit:[0-9a-f]{32}(?:\/[0-9a-f]{32})?)/g

const UZANTI = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/heic': 'heic', 'text/plain': 'txt', 'audio/mpeg': 'mp3', 'video/mp4': 'mp4', 'application/zip': 'zip' }
function uzantiOf (b) {
  const m = typeof b.name === 'string' && /\.([A-Za-z0-9]{1,8})$/.exec(b.name)
  return m ? m[1].toLowerCase() : UZANTI[b.mime] || 'bin'
}
// Varsayılan arşiv yolu: dosyalar/<hex(blobId)>.<uzantı>
const varsayilanDosyaAdi = (b) => 'dosyalar/' + b4a.toString(b.blobId, 'hex') + '.' + uzantiOf(b)

// fields: kayıt alanları. kisiAdi(tur, hex) → görünen ad (uye, device, grant, varlik, yer). dosyaAdi(blobRef) →
// arşivdeki yol. basvuruMetni(başvuru) → iç başvurunun yerine görünen metin.
// Dönüş: { alanlar, yapay_zeka_alanlari } (yapay zeka alanları kayıt düzeyinde ayrı)
function kayitDisa (fields, { kisiAdi = () => null, dosyaAdi = varsayilanDosyaAdi, basvuruMetni = () => '[kaynak]' } = {}) {
  const ad = (tur, id) => kisiAdi(tur, id) || '[bilinmeyen]'
  const metin = (v) => {
    const m = KIMLIK_RE.exec(v)
    if (m) return ad(m[1], m[2])
    return v.replace(BASVURU_RE, (x) => basvuruMetni(x) || '[bilinmeyen]').replace(KISI_METIN_RE, (x, tur, id) => ad(tur, id))
  }
  const deger = (v) => {
    if (v === null || typeof v === 'boolean' || typeof v === 'number') return v
    if (typeof v === 'string') return metin(v)
    if (b4a.isBuffer(v)) return { base64: b4a.toString(v, 'base64') }
    if (Array.isArray(v)) return v.map(deger)
    if (v && b4a.isBuffer(v.blobId)) return { dosya: dosyaAdi(v), mime: v.mime, boyut: v.size } // fileKey çıkmaz
    fail('INVALID_VALUE')
  }
  const alanlar = {}
  for (const [a, v] of Object.entries(fields)) {
    if (a === '_ai' || a === '_aiyol') continue
    if (a === '_src') {
      const s = (v || []).filter((x) => typeof x === 'string' && !/^(msg|kayit):/.test(x))
      if (s.length) alanlar._src = s
      continue
    }
    if (a === '_key' || a === '_obs') continue // iç anahtar ve gözlem kaynağı kimliği
    alanlar[a] = deger(v)
  }
  return { alanlar, yapay_zeka_alanlari: Array.isArray(fields._ai) ? [...fields._ai] : [] }
}

// icerik: ürün şemasındaki nesne (bicim ve bicimSurum eklenir). dosyalar: [{ ad: 'x.pdf', bytes }]
function arsivYaz ({ bicim, bicimSurum = 1, icerik, dosyalar = [], benioku = BENIOKU }) {
  // bicim ve bicimSurum içerikle ezilemez (inceleme kap 14); alan sırası korunur
  const { bicim: _b, bicimSurum: _s, ...geri } = icerik
  const girdiler = [{ ad: 'icerik.json', bytes: b4a.from(JSON.stringify({ bicim, bicimSurum, ...geri }, null, 1)) }]
  for (const d of dosyalar) {
    const ad = 'dosyalar/' + d.ad
    if (!adGecerli(ad)) fail('INVALID_ZIP_NAME')
    girdiler.push({ ad, bytes: d.bytes })
  }
  girdiler.push({ ad: 'BENIOKU.txt', bytes: b4a.from(benioku) })
  return zipYaz(girdiler)
}

function arsivOku (zip, opts) {
  const girdiler = zipOku(zip, opts)
  const ic = girdiler.find((g) => g.ad === 'icerik.json')
  if (!ic) fail('INVALID_ARCHIVE')
  let icerik
  try { icerik = JSON.parse(b4a.toString(ic.bytes)) } catch { fail('INVALID_ARCHIVE') }
  // arsivYaz hep nesne yazar; null, dizi ya da sayı iceAl'da TypeError olurdu (Codex 12. tur)
  if (!icerik || typeof icerik !== 'object' || Array.isArray(icerik)) fail('INVALID_ARCHIVE')
  return {
    icerik,
    dosyalar: girdiler.filter((g) => g.ad.startsWith('dosyalar/')).map((g) => ({ ad: g.ad.slice(9), bytes: g.bytes })),
    benioku: girdiler.find((g) => g.ad === 'BENIOKU.txt')?.bytes || null
  }
}

// Tek seferlik dışa aktarma (ilke 6): onay ve biyometri ürünün akışındadır (§7)
function disaAktar ({ parola, urun, bicim, bicimSurum = 1, icerik, dosyalar = [], kdf = {} }) {
  return kapla(arsivYaz({ bicim, bicimSurum, icerik, dosyalar }), parola, { ...kdf, urun, bicim, bicimSurum })
}

// Telefonda içe aktarma (RFC-0021 h, inceleme 6 Y7): eşzamansız; telefon sınırları varsayılan
const TELEFON_TOPLAM = 512 * 1024 * 1024
async function iceAlAsync (kap, parola, { telefon = true, ...opts } = {}) {
  const { baslik, icerik } = await acAsync(kap, parola, { telefon })
  const a = arsivOku(icerik, { ...(telefon ? { enCokToplam: TELEFON_TOPLAM } : {}), ...opts })
  if (a.icerik.bicim !== baslik.bicim || a.icerik.bicimSurum !== baslik.bicimSurum) fail('INVALID_ARCHIVE')
  return { baslik, ...a }
}

async function disaAktarAsync ({ parola, urun, bicim, bicimSurum = 1, icerik, dosyalar = [], kdf = {} }) {
  return kaplaAsync(arsivYaz({ bicim, bicimSurum, icerik, dosyalar }), parola, { ...kdf, urun, bicim, bicimSurum })
}

// Akışla dışa aktarma (D41): kap baytları parça parça yaz(baytlar)'a gider; bellekte bütün kap, bütün ZIP ya da bütün
// icerik.json tutulmaz. icerikParcalari() ve her dosyanın bytes() işlevi iki kez çağrılır (önce CRC ve boy ölçülür,
// sonra yazılır); yazım geçişi ölçümle farklı veri verirse INVALID_ZIP. Çıktı, aynı içerikle disaAktarAsync'in kabıyla
// aynı biçimdedir (icerik.json'ın metni farklı girintili olabilir; içerik aynı).
//   icerikParcalari: () → yinelenebilir Buffer (icerik.json'ın metni; bicim ve bicimSurum çağıranın)
//   dosyalar: [{ ad, bytes: () → Buffer }]; bytes() NO_FILE fırlatırsa dosya atlanır ve eksik sayılır
//   oncesi(): anahtar türetildikten sonra, ilk yaz'dan hemen önce (kilit ve dosya varlığı yeniden denetlenir;
//            fırlatırsa yaz hiç çağrılmamıştır)
//   yaz(baytlar): Promise dönerse beklenir (geri basınç)
// Hata dönerse o ana kadar yazılanlar geçersizdir, çağıran atar (inceleme 15 B5). Dönüş: { boy, eksik }
async function disaAktarAkis ({ parola, urun, bicim, bicimSurum = 1, icerikParcalari, dosyalar = [], kdf = {}, yaz, oncesi = null, benioku = BENIOKU }) {
  if (typeof yaz !== 'function' || typeof icerikParcalari !== 'function') fail('INVALID_ARCHIVE')
  for (const d of dosyalar) if (!adGecerli('dosyalar/' + d.ad)) fail('INVALID_ZIP_NAME')
  const y = await kapYaziciAsync(parola, { ...kdf, urun, bicim, bicimSurum })
  try {
    if (oncesi) await oncesi()
    let boy = 0
    let eksik = 0
    const cik = async (b) => { boy += b.byteLength; const r = yaz(b); if (r && typeof r.then === 'function') await r }
    await cik(y.baslangic())
    const z = zipAkis(async (b) => { for (const c of y.yaz(b)) await cik(c) })
    const olc = (parcalar) => {
      const c = crcAkis()
      let n = 0
      for (const p of parcalar()) { c.ekle(p); n += p.byteLength }
      return { crc: c.sonuc(), boy: n }
    }
    const girdi = async (ad, parcalar) => z.girdiAsync(ad, { ...olc(parcalar), parcalar: parcalar() })
    await girdi('icerik.json', icerikParcalari)
    for (const d of dosyalar) {
      // Akışta silinmiş dosya (eşzamanlı silme, bellek deposunun boşaltması) atlanır, eksik sayılır
      let bytes
      try { bytes = d.bytes() } catch (err) { if (err.message === 'NO_FILE') { eksik++; continue } throw err }
      await girdi('dosyalar/' + d.ad, function * () { yield bytes })
    }
    const bb = b4a.from(benioku)
    await girdi('BENIOKU.txt', function * () { yield bb })
    await z.bitirAsync()
    await cik(y.bitir())
    return { boy, eksik }
  } catch (err) {
    y.iptal()
    throw err
  }
}

// Geri yükleme ürünün işidir; burada yalnız açma
function iceAl (kap, parola, opts) {
  const { baslik, icerik } = ac(kap, parola)
  const a = arsivOku(icerik, opts)
  if (a.icerik.bicim !== baslik.bicim || a.icerik.bicimSurum !== baslik.bicimSurum) fail('INVALID_ARCHIVE')
  return { baslik, ...a }
}

// §5: uzantılar yalnız kolaylıktır; açma aracı her kabı sihirden tanır
const UZANTILAR = { 'yuva-defter-arsiv': '.yuvadefter', 'hf-koleksiyon-arsiv': '.hfkap' }

module.exports = { BENIOKU, UZANTILAR, varsayilanDosyaAdi, kayitDisa, arsivYaz, arsivOku, disaAktar, disaAktarAsync, disaAktarAkis, iceAl, iceAlAsync }
