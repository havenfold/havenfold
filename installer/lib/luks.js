// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// lib/luks.js — disk şifrelemesinin TPM bağı ve kurtarma anahtarı planı (RFC-0007 §8.5)
//
// Saf ve bağımlılıksız. Girdi: `cryptsetup luksDump --dump-json-metadata <aygıt>` ve `clevis luks list -d <aygıt>`
// çıktıları; çıktı havenfold-luks-yenile'nin yapacağı adımlar. Şifreleme ve TPM işi Clevis ve cryptsetup'ındır
// (kendi kriptomuz yok).
//
// Yuvalar:
//   - Kurulumda: geçici parola (subiquity) + Clevis TPM bağı PCR'sız (kurulum ortamı USB'den açıldı).
//   - İlk açılışta: kurtarma anahtarı yeni yuvaya; PCR 7'ye bağlı yeni Clevis bağı; PCR'sız bağ ve geçici parolanın
//     yuvası silinir. Kurtarma yuvası LUKS2 jetonuyla işaretlenir: { type: 'havenfold-kurtarma', keyslots: [n] }
//     (jetonda sır yok; yalnız hangi yuvanın kurtarma olduğunu söyler).

function fail (code) { throw new Error(code) }

const KURTARMA_TOKEN = 'havenfold-kurtarma'
const PCR7 = { pcr_bank: 'sha256', pcr_ids: '7' }

function luksDumpCoz (girdi) {
  let j = girdi
  if (typeof girdi === 'string') { try { j = JSON.parse(girdi) } catch { fail('INVALID_LUKS_DUMP') } }
  if (!j || typeof j.keyslots !== 'object') fail('INVALID_LUKS_DUMP')
  const yuvalar = Object.keys(j.keyslots).map(Number).filter(Number.isSafeInteger).sort((a, b) => a - b)
  const jetonlar = Object.entries(j.tokens || {}).map(([no, t]) => ({ no: Number(no), tur: String(t.type || ''), yuvalar: (t.keyslots || []).map(Number) }))
  return { yuvalar, jetonlar }
}

// "1: tpm2 '{"hash":"sha256","key":"ecc","pcr_bank":"sha256","pcr_ids":"7"}'"
function clevisListeCoz (metin) {
  const out = []
  for (const satir of String(metin || '').split('\n')) {
    const m = /^\s*([0-9]+):\s+(\S+)\s+'(.*)'\s*$/.exec(satir)
    if (!m) continue
    let ayar = {}
    try { ayar = JSON.parse(m[3]) } catch {}
    out.push({ yuva: Number(m[1]), pin: m[2], ayar })
  }
  return out
}

const pcrler = (ayar) => String(ayar.pcr_ids || '').split(',').map((x) => x.trim()).filter(Boolean)

// g: { dump, clevis, pcr7Acilir: bool | null (PCR 7 bağlı yuva TPM'den açılabildi mi), kurtarmaDosyasi: bool }
// Dönüş: { durum, adimlar, ... }
//   'luks-yok' | 'tpm-yok': yapılacak bir şey yok
//   'ilk':  kurtarma anahtarı ekle (yoksa), PCR 7 bağla, PCR'sız bağı ve geçici yuvaları sil
//   'temizle': PCR 7 bağı var; yarım kalan ilk açılışın artıkları (PCR'sız bağ, geçici yuva) silinir
//   'yeniden-bagla': PCR 7 değişmiş (Güvenli Önyükleme ayarı ya da anahtar veritabanı); kurtarma anahtarı konsoldan
//                    istenir, bağ yeni PCR 7 değeriyle kurulur
//   'tamam'
function plan ({ dump, clevis, pcr7Acilir = null }) {
  if (!dump) return { durum: 'luks-yok', adimlar: [] }
  const d = typeof dump.yuvalar === 'object' && Array.isArray(dump.yuvalar) ? dump : luksDumpCoz(dump)
  const c = Array.isArray(clevis) ? clevis : clevisListeCoz(clevis)
  const tpm = c.filter((x) => x.pin === 'tpm2')
  const pcrsiz = tpm.filter((x) => pcrler(x.ayar).length === 0).map((x) => x.yuva)
  const pcr7 = tpm.filter((x) => pcrler(x.ayar).includes('7')).map((x) => x.yuva)
  const kurtarma = d.jetonlar.filter((t) => t.tur === KURTARMA_TOKEN).flatMap((t) => t.yuvalar)
  const jetonlu = new Set(d.jetonlar.flatMap((t) => t.yuvalar))
  const gecici = d.yuvalar.filter((y) => !jetonlu.has(y))
  if (!tpm.length) return { durum: 'tpm-yok', adimlar: [] }
  if (!pcr7.length) {
    const adimlar = []
    if (!kurtarma.length) adimlar.push('kurtarma-ekle')
    adimlar.push('pcr7-bagla')
    for (const y of pcrsiz) adimlar.push('clevis-coz:' + y)
    for (const y of gecici) adimlar.push('yuva-sil:' + y)
    return { durum: 'ilk', adimlar, pcrsiz, gecici, kurtarma, kaynakYuva: pcrsiz[0] }
  }
  if (pcr7Acilir === false) return { durum: 'yeniden-bagla', adimlar: ['kurtarma-sor', 'pcr7-bagla', ...pcr7.map((y) => 'clevis-coz:' + y)], pcr7, kurtarma }
  const artik = [...pcrsiz.map((y) => 'clevis-coz:' + y), ...gecici.map((y) => 'yuva-sil:' + y)]
  if (artik.length && kurtarma.length) return { durum: 'temizle', adimlar: artik, pcrsiz, gecici, kurtarma }
  return { durum: 'tamam', adimlar: [], pcr7, kurtarma }
}

// Kurtarma anahtarı 32 rastgele bayttır (§8.5); dosyada ham, LUKS yuvasında ve telefonda Crockford base32 küçük harfle
// (52 karakter, I L O U yok). Türkçe klavyede i/ı karışmaz; açılışta parola isteminde aynen yazılır.
const CROCKFORD = '0123456789abcdefghjkmnpqrstvwxyz'
function kurtarmaKodla (bayt) {
  if (!bayt || bayt.length !== 32) fail('INVALID_RECOVERY')
  let bit = 0
  let deger = 0
  let out = ''
  for (const b of bayt) {
    deger = (deger << 8) | b
    bit += 8
    while (bit >= 5) { out += CROCKFORD[(deger >>> (bit - 5)) & 31]; bit -= 5 }
    deger &= (1 << bit) - 1
  }
  if (bit > 0) out += CROCKFORD[(deger << (5 - bit)) & 31]
  return out
}

// Ekranda 4'lü öbekler (yazarken boşluk yazılmaz)
const kurtarmaGoster = (kod) => kod.match(/.{1,4}/g).join(' ')

// Konsolda yazılan kurtarma anahtarı (hf-luks-yenile): boşluk ve tire atılır, küçük harf; Crockford okuması o → 0,
// i ve l → 1 (alfabede yoklar). Anahtar dosyası LUKS'a eklenen baytlarla aynı olmalı (Codex 12. tur)
const kurtarmaDuzelt = (s) => String(s).toLowerCase().replace(/[\s-]/g, '').replace(/o/g, '0').replace(/[il]/g, '1')

const kurtarmaJetonu = (yuva) => JSON.stringify({ type: KURTARMA_TOKEN, keyslots: [String(yuva)] })

// Kurulumda ilk bağ PCR'sız: kurulum ortamı USB'den açıldığı için PCR 7 değeri hedefin açılışındakiyle aynı değildir
const PCRSIZ = {}

module.exports = { KURTARMA_TOKEN, PCR7, PCRSIZ, luksDumpCoz, clevisListeCoz, plan, kurtarmaKodla, kurtarmaGoster, kurtarmaDuzelt, kurtarmaJetonu, CROCKFORD }
