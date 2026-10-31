// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// stream.js — kamera akışı UC_STREAM_OPEN, UC_STREAM_ACCEPT, UC_STREAM_CLOSE (RFC-0008 §11.5)
//
// Akışı açan alıcıdır; uç kendiliğinden görüntü göndermez. Uç isteği tablodaki sırayla denetler ve ilk tutmayan satırın
// kodunu UC_STREAM_CLOSE ile döner. Akış yalnız doğrudan oturumda (HyperDHT doğrudan bağlantı) açılır: kutu rölesi ve
// emanet bu türleri taşımaz (envelope.js YALNIZ_DOGRUDAN_UC). Kareler frame.js ile şifrelenir.
const b4a = require('b4a')
const K = require('./encoding')

const { hex } = K
const EN_COK_AKIS = 2
const AKIS_SURESI_MS = 24 * 3_600_000 // §11.5: bir akış en çok 24 saat; işçi süre dolmadan yenisini açar
const PIL_ALT = 20 // §11.3: prizde değilken ≤ %20 kamera durur
const SIFIR16 = b4a.alloc(16)

// signer: isteyen { memberId, signKeyPair }
const akisAcKodla = (familyId, m, signer) => K.imzaliKodla(K.akisAcGovde, K.akisAcDenetle, K.ETIKET.UC_STREAM_OPEN, familyId, { ...m, requesterId: signer.memberId }, signer.signKeyPair.secretKey)
const akisAcCoz = (buf) => K.imzaliCoz(K.akisAcGovde, buf, K.akisAcDenetle)

// İsteyen kim: aktif üye (rolüyle) ya da aktif işçi; değilse null
function isteyenOf (L, id) {
  if (L.sessionRole(id) === 'uye') {
    const m = L.members.get(id)
    return m.role === 'kutu' ? null : { id, sinif: 'uye', rol: m.role }
  }
  const d = L.devices.get(id)
  if (d && d.active && d.class === 'isci') return { id, sinif: 'isci', rol: null }
  return null
}

// §11.5 madde 3: işçi `device:<id>` ve analiz; üye `uye:<id>` ya da rolü (`rol:ebeveyn`, `rol:yetiskin`) ve canlı.
// Çocuk hiçbir zaman (§11.4).
function hedefUyar (cfg, { id, sinif, rol, purpose }) {
  if (sinif === 'isci') return purpose === 'analiz' && cfg.targets.includes('device:' + id)
  if (purpose !== 'canli' || rol === 'cocuk') return false
  return cfg.targets.includes('uye:' + id) || (!!rol && cfg.targets.includes('rol:' + rol))
}

// §11.4: windows boşsa her zaman; days bit 0 Pazartesi … bit 6 Pazar; gece yarısını aşan pencere (start > end) başladığı
// günden ertesi güne sürer. yerel: { gun (0 Pazartesi … 6 Pazar), dk (0–1439) } — ucun yerel saati
function penceredeMi (windows, { gun, dk }) {
  if (!windows.length) return true
  const dun = (gun + 6) % 7
  return windows.some((w) => {
    if (w.startMin < w.endMin) return (w.days & (1 << gun)) !== 0 && dk >= w.startMin && dk < w.endMin
    return ((w.days & (1 << gun)) !== 0 && dk >= w.startMin) || ((w.days & (1 << dun)) !== 0 && dk < w.endMin)
  })
}

// §11.3: ısı ve pil
function isiPilKodu ({ thermal = 'normal', pil = null }) {
  if (thermal === 'durdu') return 'SICAK'
  if (pil && (pil.kritik || (!pil.onAC && pil.percent <= PIL_ALT))) return 'PIL'
  return null
}

// İsteğin want değerleri yapılandırmanın video sınırlarına indirilir
const istenenIndir = (want, v) => ({ width: Math.min(want.width, v.maxWidth), height: Math.min(want.height, v.maxHeight), fps: Math.min(want.fps, v.fps) })

/**
 * §11.5 denetim tablosu. Dönüş { kabul: true, m, want, isteyen } ya da { kabul: false, code, streamId }.
 * u: { ucHex, cfg (geçerli yapılandırmanın gövdesi, yoksa null), oturum: 'dogrudan' | 'role' | 'emanet', yerel: { gun, dk },
 *      thermal, pil: { percent, onAC, kritik }, acikAkis }
 */
function akisAcDenetle (L, bytes, u) {
  const { m, body, sig } = akisAcCoz(bytes)
  const red = (code) => ({ kabul: false, code, streamId: m.streamId })
  if (hex(m.ucId) !== u.ucHex) return red('IZIN_YOK')
  // 1: imza; isteyen aktif üye ya da aktif işçi (ledgerSeq anında da)
  const id = hex(m.requesterId)
  const isteyen = isteyenOf(L, id)
  if (!isteyen || m.ledgerSeq >= L.len || !isteyenOf(L.pastCursor().at(m.ledgerSeq + 1), id)) return red('IZIN_YOK')
  if (!K.imzaGecerli(K.ETIKET.UC_STREAM_OPEN, L.familyId, body, sig, L.entity(id)?.signPub)) return red('IZIN_YOK')
  const cfg = u.cfg
  // 2
  if (!cfg || cfg.mode !== 'kamera') return red('IZIN_YOK')
  // 3: hedef ve amaç; analizde taskId dolu, canlıda 16 sıfır
  if (!hedefUyar(cfg, { ...isteyen, purpose: m.purpose })) return red('IZIN_YOK')
  if ((m.purpose === 'canli') !== b4a.equals(m.taskId, SIFIR16)) return red('IZIN_YOK')
  // 4
  if (m.configSeq !== cfg.seq) return red('YAPILANDIRMA_DEGISTI')
  // 5
  if (!penceredeMi(cfg.windows, u.yerel)) return red('PENCERE_DISI')
  // 6
  if (u.oturum !== 'dogrudan') return red('ROLE_YASAK')
  // 7
  const ip = isiPilKodu(u)
  if (ip) return red(ip)
  // 8
  if (u.acikAkis >= EN_COK_AKIS) return red('MESGUL')
  return { kabul: true, m, want: istenenIndir(m.want, cfg.video), isteyen }
}

// Uç kabul eder: ssrc rastgele (frame.js), çözünürlük indirilmiş istek
function kabulOf (m, want, { ssrc, profile = 'baseline' }) {
  return { streamId: m.streamId, codec: 'h264', profile, width: want.width, height: want.height, fps: want.fps, ssrc }
}

// Kapatma kodları (§11.4, §11.5): tablo kodları ve olağan kapanış
const KAPAT_KODLARI = ['IZIN_YOK', 'YAPILANDIRMA_DEGISTI', 'PENCERE_DISI', 'ROLE_YASAK', 'SICAK', 'PIL', 'MESGUL', 'SURE_DOLDU', 'BITTI']

module.exports = {
  EN_COK_AKIS, AKIS_SURESI_MS, PIL_ALT, KAPAT_KODLARI, akisAcKodla, akisAcCoz, isteyenOf, hedefUyar, penceredeMi, isiPilKodu, istenenIndir,
  akisAcDenetle, kabulOf, kabulKodla: K.kabulKodla, kabulCoz: K.kabulCoz, kapatKodla: K.kapatKodla, kapatCoz: K.kapatCoz
}
