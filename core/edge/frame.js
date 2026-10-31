// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// frame.js — uç akışının çerçeve şifrelemesi (RFC-0008 §11.5)
//
// Biçim arama kodunun çerçevesidir (Yuva Hat worklet/media/frame.js, docs/08 §3): aynı başlık, aynı nonce düzeni, aynı
// sayaç tahmini. Tek fark AEAD'dir: kurucu belge §13.2 tablosundaki XChaCha20-Poly1305 (H7; yeni kripto ilkesi yok).
//
//   keyShare = deriveLP(pair, 'hf/uc-stream/')          pair: uç ile alıcının çift sırrı (RFC-0003 §6.2)
//   mediaKey = derive(keyShare, 'media', streamId, 0)    frame.js mediaKey(keyShare, callId = streamId, dönem = 0)
//   başlık   = hdr(1) ‖ ssrc(4) ‖ seq(2) ‖ ts(4) ‖ level(1); hdr = sürüm 1 (2 bit) | tip (2 bit) | dönem (4 bit)
//   nonce12  = ssrc(4) ‖ dönem(2) ‖ sayaç(6); nonce24 = nonce12 ‖ 12 sıfır bayt (tele konmaz, başlıktan türetilir)
//   çerçeve  = başlık ‖ XChaCha20-Poly1305(mediaKey, nonce24, yük, AD = başlık)
// Tip 1 görüntü izi (H.264 parçaları), tip 2 denetim izi (anahtar kare isteği). Sayaç 48 bittir, başlıkta alt 16 biti
// gider; alıcı üst kısmı en yüksek görülen sayaca göre tahmin eder. Akış başına yeni streamId, dolayısıyla yeni anahtar;
// dönem 0'da kalır (24 saatte 48 bit tükenmez). Alıcı ayrıca 64 çerçevelik tekrar penceresi tutar: aynı sayaç ikinci kez
// ya da pencerenin gerisindeki sayaç açılmaz.
//
// Yön (açıklama 1 madde 5): uçtan alıcıya yalnız görüntü izi (tip 1) mediaKey ile; alıcıdan uca yalnız denetim izi (tip 2)
// ayrı anahtarla ve ayrı ssrc'yle:
//   tersAnahtar = deriveLP(keyShare, 'hf/uc-stream-ters/', streamId)     tersSsrc = ssrc XOR 0xFFFFFFFF
// Aynı anahtar iki yönde kullanılmaz; ters yönün ssrc'si tele ayrıca konmaz, kabuldeki ssrc'den türetilir.
const sodium = require('sodium-native')
const b4a = require('b4a')
const { kdf: { derive, deriveLP } } = require('@havenfold/core')

const SURUM = 1
const TIP = { GORUNTU: 1, DENETIM: 2 }
const BASLIK = 12
const ABYTES = sodium.crypto_aead_xchacha20poly1305_ietf_ABYTES
const EN_COK_SAYAC = 2 ** 48 - 1
const PENCERE = 64
const DONEM = 0

// Çift sırrı 32 bayt olmalı; değilse kodlu hata (yerel kitaplığa bayt olmayan anahtar gitmez)
function anahtarPayi (pair) {
  if (!b4a.isBuffer(pair) || pair.byteLength !== 32) throw new Error('INVALID_PAIR')
  return deriveLP(pair, 'hf/uc-stream/')
}
const medyaAnahtari = (keyShare, streamId) => derive(keyShare, 'media', streamId, DONEM)
const YON = { UC: 'uc', ALICI: 'alici' }
const tersAnahtar = (keyShare, streamId) => deriveLP(keyShare, 'hf/uc-stream-ters/', streamId)
const tersSsrc = (ssrc) => (ssrc ^ 0xffffffff) >>> 0
// Yönün anahtarı, ssrc'si ve izinli çerçeve tipi
function yonOf ({ pair, streamId, ssrc, yon }) {
  const ks = anahtarPayi(pair)
  if (yon === YON.UC) return { key: medyaAnahtari(ks, streamId), ssrc: ssrc >>> 0, tip: TIP.GORUNTU }
  if (yon === YON.ALICI) return { key: tersAnahtar(ks, streamId), ssrc: tersSsrc(ssrc), tip: TIP.DENETIM }
  throw new Error('INVALID_DIRECTION')
}

function baslikKodla ({ tip, ssrc, seq, ts, level = 0, donem = DONEM }) {
  const h = b4a.alloc(BASLIK)
  const v = new DataView(h.buffer, h.byteOffset, h.byteLength)
  h[0] = (SURUM << 6) | ((tip & 3) << 4) | (donem & 15)
  v.setUint32(1, ssrc >>> 0)
  v.setUint16(5, seq & 0xffff)
  v.setUint32(7, ts >>> 0)
  h[11] = level & 0xff
  return h
}

function baslikCoz (buf) {
  if (!b4a.isBuffer(buf) || buf.byteLength < BASLIK + ABYTES) throw new Error('FRAME_TOO_SHORT')
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const hdr = buf[0]
  if (hdr >>> 6 !== SURUM) throw new Error('FRAME_VERSION')
  const tip = (hdr >>> 4) & 3
  if (tip !== TIP.GORUNTU && tip !== TIP.DENETIM) throw new Error('FRAME_TYPE')
  return { tip, donem: hdr & 15, ssrc: v.getUint32(1), seq: v.getUint16(5), ts: v.getUint32(7), level: buf[11] }
}

// frame.js nonceOf + 12 sıfır bayt
function nonce24 (ssrc, donem, sayac) {
  const n = b4a.alloc(24)
  const v = new DataView(n.buffer, n.byteOffset, 12)
  v.setUint32(0, ssrc >>> 0)
  v.setUint16(4, donem & 0xffff)
  v.setUint16(6, Math.floor(sayac / 2 ** 32) & 0xffff)
  v.setUint32(8, sayac >>> 0)
  return n
}

// En yüksek görülen sayaca en yakın aday (ROC−1, ROC, ROC+1); frame.js estimate
function tahmin (enYuksek, seq) {
  if (enYuksek < 0) return seq
  const roc = Math.floor(enYuksek / 65536)
  let best = -1
  for (const r of [roc - 1, roc, roc + 1]) {
    if (r < 0) continue
    const c = r * 65536 + seq
    if (best < 0 || Math.abs(c - enYuksek) < Math.abs(best - enYuksek)) best = c
  }
  return best
}

// Gönderen: her çerçevede sayaç bir artar. yon 'uc' (uç → alıcı, görüntü izi) ya da 'alici' (alıcı → uç, denetim izi);
// ssrc her iki tarafta da kabuldeki ssrc'dir (ters yön kendi ssrc'sini türetir)
class AkisMuhurleyici {
  constructor ({ pair, streamId, ssrc, yon = YON.UC }) {
    const y = yonOf({ pair, streamId, ssrc, yon })
    this.key = y.key
    this.ssrc = y.ssrc
    this.tip = y.tip
    this.sayac = 0
  }

  muhurle (yuk, { tip = this.tip, ts, level = 0 }) {
    if (tip !== this.tip) throw new Error('FRAME_TYPE') // bu yönde bu iz yok
    if (this.sayac > EN_COK_SAYAC) throw new Error('COUNTER_EXHAUSTED')
    const sayac = this.sayac++
    const baslik = baslikKodla({ tip, ssrc: this.ssrc, seq: sayac & 0xffff, ts, level })
    const out = b4a.alloc(yuk.byteLength + ABYTES)
    sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(out, yuk, baslik, null, nonce24(this.ssrc, DONEM, sayac), this.key)
    return { cerceve: b4a.concat([baslik, out]), sayac }
  }

  kapat () { sodium.sodium_memzero(this.key) }
}

// Açan: yon gönderenin yönüdür ('uc': alıcı uçtan gelen görüntüyü açar; 'alici': uç alıcıdan gelen denetimi açar).
// Açılamayan çerçeve durumu değiştirmez
class AkisAcici {
  constructor ({ pair, streamId, ssrc, yon = YON.UC }) {
    const y = yonOf({ pair, streamId, ssrc, yon })
    this.key = y.key
    this.ssrc = y.ssrc
    this.tip = y.tip
    this.enYuksek = -1
    this.gorulen = 0n // enYuksek'ten geriye 64 çerçevenin bit maskesi (bit 0: enYuksek)
  }

  ac (cerceve) {
    const h = baslikCoz(cerceve)
    if (h.tip !== this.tip) throw new Error('FRAME_TYPE')
    if (h.ssrc !== this.ssrc || h.donem !== DONEM) throw new Error('FRAME_DECODE_FAILED')
    const sayac = tahmin(this.enYuksek, h.seq)
    if (this.enYuksek >= 0 && sayac <= this.enYuksek) {
      const fark = this.enYuksek - sayac
      if (fark >= PENCERE || (this.gorulen >> BigInt(fark)) & 1n) throw new Error('REPLAY')
    }
    const baslik = cerceve.subarray(0, BASLIK)
    const out = b4a.alloc(cerceve.byteLength - BASLIK - ABYTES)
    try {
      sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(out, null, cerceve.subarray(BASLIK), baslik, nonce24(h.ssrc, h.donem, sayac), this.key)
    } catch {
      throw new Error('FRAME_DECODE_FAILED')
    }
    const maske = (1n << BigInt(PENCERE)) - 1n
    if (sayac > this.enYuksek) {
      const kay = this.enYuksek < 0 ? PENCERE : sayac - this.enYuksek
      this.gorulen = kay >= PENCERE ? 1n : ((this.gorulen << BigInt(kay)) | 1n) & maske
      this.enYuksek = sayac
    } else {
      this.gorulen |= 1n << BigInt(this.enYuksek - sayac)
    }
    return { ...h, sayac, yuk: out }
  }

  kapat () { sodium.sodium_memzero(this.key) }
}

module.exports = { SURUM, TIP, YON, BASLIK, ABYTES, PENCERE, anahtarPayi, medyaAnahtari, tersAnahtar, tersSsrc, baslikKodla, baslikCoz, nonce24, tahmin, AkisMuhurleyici, AkisAcici }
