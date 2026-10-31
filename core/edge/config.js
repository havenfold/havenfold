// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// config.js — uç yapılandırması UC_CONFIG (RFC-0008 §11.4)
//
// Uçun ne yapacağına ve görüntüsünün kime gideceğine ebeveyn karar verir (H3: cihaz karar vermez). Uç gelen
// yapılandırmayı tablodaki sırayla denetler; geçeni saklananla belirlenimci kurala göre birleştirir (madde 7): büyük seq
// kazanır, eşitse hashLP('hf/uc-config/', familyId, body) bayt sırasıyla büyük olan. Sıra geliş anına ve saate bağlı
// değildir; iki ebeveyn aynı anda yazarsa bütün cihazlar aynı yapılandırmada birleşir.
const b4a = require('b4a')
const K = require('./encoding')

const { hex, fail } = K
const HEX16 = '[0-9a-f]{32}'
// koleksiyon: sensör modunda olayların gideceği olaylar koleksiyonu (açıklama 2 madde 1)
const HEDEF_RE = new RegExp(`^(device:${HEX16}|uye:${HEX16}|rol:(ebeveyn|yetiskin)|koleksiyon:${HEX16})$`)
const KAYNAK_RE = new RegExp(`^(uye:${HEX16}|rol:(ebeveyn|yetiskin))$`)

/**
 * Açıklama 2 madde 1: sensör olaylarının gittiği koleksiyonun okuyucuları evin bütün aktif ebeveyn ve yetişkinlerini kapsar
 * (rolüyle ya da kişinin herhangi bir kimliğiyle, RFC-0017 §5). Kapsamıyorsa sensör verisi bazı yetişkinlerden gizli kalırdı.
 */
function okuyucuKapsar (L, col) {
  if (!col || !Array.isArray(col.readers)) return false
  const kisi = (id) => L.canonical(id)
  for (const [id, m] of L.members) {
    if (!m.active || L.sessionRole(id) !== 'uye' || !['ebeveyn', 'yetiskin'].includes(m.role)) continue
    if (!col.readers.some((r) => r === 'rol:' + m.role || (r.startsWith('uye:') && kisi(r.slice(4)) === kisi(id)))) return false
  }
  return true
}

/** Sensör hedefi geçerli mi: olaylar koleksiyonu ve okuyucuları kapsar */
const sensorHedefiGecerli = (L, collectionHex) => {
  const col = L.collections.get(collectionHex)
  return !!col && col.kind === 'olaylar' && okuyucuKapsar(L, col)
}

/** Yapılandırmanın sensör hedefleri (koleksiyon kimlikleri, hex) */
const sensorHedefleri = (m) => m.targets.filter((t) => t.startsWith('koleksiyon:')).map((t) => t.slice(11))

// signer: ebeveynin kimliği { memberId, signKeyPair }
function yapilandirmaKodla (familyId, m, signer) {
  return K.imzaliKodla(K.yapilandirmaGovde, (x) => x, K.ETIKET.UC_CONFIG, familyId, { ...m, signerId: signer.memberId }, signer.signKeyPair.secretKey)
}

const yapilandirmaCoz = (buf) => K.imzaliCoz(K.yapilandirmaGovde, buf)

// Bir üye `at` anındaki defterde aktif ebeveyn mi (bekleyen değil)
function ebeveynMi (D, id) {
  const m = D.members.get(id)
  return !!m && m.active && m.role === 'ebeveyn' && D.sessionRole(id) === 'uye'
}

// §11.4 madde 4: çocuk rolü ve misafir hiçbir listede olamaz; uye: hedefi aktif çocuksa da (v1'de çocuk izleyemez, ekrana
// kart gönderemez)
function cocukMu (L, oge) {
  if (oge === 'rol:cocuk' || oge.startsWith('grant:')) return true
  if (!oge.startsWith('uye:')) return false
  return L.members.get(oge.slice(4))?.role === 'cocuk'
}

// Denetim sırası §11.4 tablosudur. Dönüş { m, body, sig, ozet }; geçmezse tablodaki hata kodu atılır.
// ucHex: denetleyen ucun kendi kimliği.
function yapilandirmaDenetle (L, bytes, { ucHex }) {
  const { m, body, sig } = yapilandirmaCoz(bytes)
  // 1
  if (hex(m.ucId) !== ucHex) fail('WRONG_EDGE')
  // 2: imzacı ledgerSeq anında ve bugün aktif ebeveyn; imza geçerli
  const imzaci = hex(m.signerId)
  if (m.ledgerSeq >= L.len) fail('LEDGER_BEHIND') // uç defteri yetişince yeniden dener
  if (!ebeveynMi(L.pastCursor().at(m.ledgerSeq + 1), imzaci) || !ebeveynMi(L, imzaci)) fail('UNAUTHORIZED')
  if (!K.imzaGecerli(K.ETIKET.UC_CONFIG, L.familyId, body, sig, L.members.get(imzaci).signPub)) fail('UNAUTHORIZED')
  // Biçim: hedef ve kaynak öğeleri tanınan biçimde (madde 4'ün dışındakiler gövde hatası)
  for (const t of m.targets) if (!HEDEF_RE.test(t) && !cocukMu(L, t)) fail('INVALID_BODY')
  for (const t of m.screenFrom) if (!KAYNAK_RE.test(t) && !cocukMu(L, t)) fail('INVALID_BODY')
  // 3: device: öğeleri aktif işçi; koleksiyon: öğeleri okuyucusu evin bütün ebeveyn ve yetişkinleri olan olaylar koleksiyonu
  for (const t of m.targets) {
    if (t.startsWith('koleksiyon:') && !sensorHedefiGecerli(L, t.slice(11))) fail('INVALID_TARGET')
    if (!t.startsWith('device:')) continue
    const d = L.devices.get(t.slice(7))
    if (!d || !d.active || d.class !== 'isci') fail('INVALID_TARGET')
  }
  // 4
  if ([...m.targets, ...m.screenFrom].some((t) => cocukMu(L, t))) fail('INVALID_TARGET')
  // 5
  if (!K.MODLAR.includes(m.mode)) fail('INVALID_BODY')
  // Kamerada hedef alıcıdır (koleksiyon olamaz); sensörde hedef yalnız ve en az bir koleksiyondur (açıklama 2 madde 1)
  const koleksiyonlu = m.targets.filter((t) => t.startsWith('koleksiyon:')).length
  if (m.mode === 'kamera' && koleksiyonlu) fail('INVALID_BODY')
  if (m.mode === 'sensor' && (!koleksiyonlu || koleksiyonlu !== m.targets.length)) fail('INVALID_BODY')
  if ((m.mode === 'ekran' || m.mode === 'kapali') && m.targets.length) fail('INVALID_BODY')
  if (m.mode !== 'ekran' && m.screenFrom.length) fail('INVALID_BODY')
  // 6 ve alanların geri kalanı
  const v = m.video
  const S = K.VIDEO_SINIR
  if (v.maxWidth > S.maxWidth || v.maxHeight > S.maxHeight || v.fps > S.fps || v.kbps > S.kbps || !v.maxWidth || !v.maxHeight || !v.fps || !v.kbps) fail('INVALID_BODY')
  for (const w of m.windows) if (!w.days || w.days > 127 || w.startMin >= K.GUN_DK || w.endMin > K.GUN_DK || w.startMin === w.endMin) fail('INVALID_BODY')
  if (new Set(m.sensors).size !== m.sensors.length || !m.sensors.every((x) => K.SENSORLER.includes(x))) fail('INVALID_BODY')
  if (m.mode !== 'sensor' && m.sensors.length) fail('INVALID_BODY')
  if (new Set(m.targets).size !== m.targets.length || new Set(m.screenFrom).size !== m.screenFrom.length) fail('INVALID_BODY')
  return { m, body, sig, ozet: K.ozetOf(K.ETIKET.UC_CONFIG, L.familyId, body) }
}

// Madde 7: yeni yapılandırma saklananı geçer mi. a, b: yapilandirmaDenetle sonuçları (a null olabilir)
function yeniKazanir (eski, yeni) {
  if (!eski) return true
  if (yeni.m.seq !== eski.m.seq) return yeni.m.seq > eski.m.seq
  return b4a.compare(yeni.ozet, eski.ozet) > 0
}

// Gelen yapılandırmalardan kazananı seçer (geliş sırasından bağımsız)
const kazanan = (liste) => liste.reduce((a, b) => (yeniKazanir(a, b) ? b : a), null)

// Yeni yapılandırma kabul edilince uyuşmayan akışlar hemen kapanır (UC_STREAM_CLOSE { code: 'YAPILANDIRMA_DEGISTI' }).
// akislar: [{ streamId, requesterId, purpose, sinif: 'isci' | 'uye', rol }] → kapanacak streamId'ler
function kapanacakAkislar (m, akislar) {
  const { hedefUyar } = require('./stream')
  return akislar.filter((a) => m.mode !== 'kamera' || !hedefUyar(m, a)).map((a) => a.streamId)
}

module.exports = { HEDEF_RE, KAYNAK_RE, okuyucuKapsar, sensorHedefiGecerli, sensorHedefleri, yapilandirmaKodla, yapilandirmaCoz, yapilandirmaDenetle, ebeveynMi, cocukMu, yeniKazanir, kazanan, kapanacakAkislar }
