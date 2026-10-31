// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// edge/worker-stream.js — Linux işçide uç kaynağı, işçi çekirdeği tarafı (RFC-0008 §11.5 "İşçi tarafı" madde 1–2, §17 adım 4).
//
// hf.task.vision sürekli görevi params.sourceId = ucId ile gelir. İşçi uçun defterde aktif ve class 'uc' olduğunu
// denetler, uçtan aldığı son UC_CONFIG'in seq'iyle UC_STREAM_OPEN (purpose 'analiz', taskId) imzalar ve yalnız doğrudan
// oturumla uca yollar. UC_STREAM_ACCEPT gelince denetçiye AKIS_AC (IPC 40) gider; denetçi görevin ağ ad alanını ve yerel
// akış sunucusunu kurar. Gelen her çerçeve açılır (core/edge frame.js AkisAcici) ve AKIS_KARE (41) olur. Kapanış iki
// yönlüdür (AKIS_KAPAT 42). Akış 24 saati dolmadan yenilenir (§11.5). Görüntü işçinin diskine yazılmaz.
//
// ANAHTAR_KARE_ISTE (43) denetçiden gelir: işçi uca denetim izinde (tip 2) anahtar kare isteği mühürler; ters yön ayrı
// ssrc ve ayrı anahtarla (RFC-0008 açıklama 1 madde 5; core/edge frame.js YON.ALICI). Çift sırrı zorunludur (madde 7).
const b4a = require('b4a')
const sodium = require('sodium-native')
const { zarf: { Z }, giris } = require('@havenfold/core')
const { akis: A, cerceve: C, yapilandirma: Y } = require('@havenfold/edge')
const { IPC } = require('../ipc/types')

const hex = (b) => (typeof b === 'string' ? b : b4a.toString(b, 'hex'))
const unhex = (s) => (typeof s === 'string' ? b4a.from(s, 'hex') : s)
const VISION = 'hf.task.vision'
const ISTEK = { width: 1280, height: 720, fps: 10 }
const YENILE_MS = A.AKIS_SURESI_MS - 30 * 60_000 // 24 saat dolmadan yarım saat önce yeni akış
const ANAHTAR_ISTEGI = b4a.from('anahtar-kare') // denetim izinin yükü (sdk/edge.js CameraApi ile aynı)

function fail (code) { throw new Error(code) }
const rastgele16 = () => { const b = b4a.alloc(16); sodium.randombytes_buf(b); return b }
// H.264 Annex B erişim birimi: içindeki NAL birimlerinden biri IDR (5) ya da SPS (7) ise anahtar kare. AUD (9) ya da SEI
// (6) önde olabilir (inceleme 23 madde 7); başlangıç kodu yoksa anahtar değil; sınır dışı okuma yok.
function anahtarMi (yuk) {
  const n = yuk.byteLength
  for (let i = 0; i + 2 < n; i++) {
    if (yuk[i] !== 0 || yuk[i + 1] !== 0) continue
    let bas = -1
    if (yuk[i + 2] === 1) bas = i + 3
    else if (yuk[i + 2] === 0 && i + 3 < n && yuk[i + 3] === 1) bas = i + 4
    if (bas < 0 || bas >= n) continue
    const tur = yuk[bas] & 0x1f
    if (tur === 5 || tur === 7) return true
    i = bas - 1
  }
  return false
}

class IsciAkisAlici {
  /**
   * o: { ledger: () => Ledger, me (işçi kimliği), ciftSirri: (peerHex) → 32 B (platformun PairBook'u, tören anahtarıyla;
   *      zorunlu), gonder: (peerHex, tür, bayt) → bool (yalnız doğrudan oturum), cerceveGonder?: (peerHex, streamIdHex,
   *      çerçeve) → bool (oturumun sırasız kanalı; denetim izi), denetci: { istek(tür, mesaj) → Promise, gonder(tür, mesaj) }, now? }
   */
  constructor ({ ledger, me, ciftSirri, gonder, cerceveGonder = () => false, denetci, now = Date.now }) {
    if (typeof ciftSirri !== 'function') fail('PAIR_SECRET_REQUIRED') // RFC-0008 açıklama 1 madde 7
    this.L = ledger
    this.me = me
    this.meHex = hex(me.memberId)
    this.cift = ciftSirri
    this.ag = gonder
    this.cerceveAg = cerceveGonder
    this.denetci = denetci
    this.now = now
    this.yapilandirmalar = new Map() // ucHex → yapilandirmaDenetle sonucu (en yenisi)
    this.akislar = new Map() // streamIdHex → { taskId, ucHex, opener, kabul, acilma, durum }
    this.gorevler = new Map() // taskIdHex → { ucHex, want }
    this.bekleyenler = new Map() // taskIdHex → { resolve, reject } (hazirla: ilk akış açılınca)
    this.dinleyiciler = { 'anahtar-kare': [], kapandi: [] }
  }

  on (ad, fn) { this.dinleyiciler[ad].push(fn); return this }
  _yay (ad, ...a) { for (const f of this.dinleyiciler[ad]) f(...a) }

  /** UC_CONFIG (ebeveynden; işçi hedefteyse ona da gider): uçun geçerli seq'i öğrenilir. Dönüş: seq ya da null */
  yapilandirmaAl (fromHex, bytes, yol) {
    const L = this.L()
    giris.gelenZarf({ myRole: 'cihaz', peerRole: L.sessionRole(hex(fromHex)), type: Z.UC_CONFIG, bytes, L, gonderen: hex(fromHex), yol })
    const y = Y.yapilandirmaDenetle(L, bytes, { ucHex: hex(Y.yapilandirmaCoz(bytes).m.ucId) })
    const ucHex = hex(y.m.ucId)
    if (!Y.yeniKazanir(this.yapilandirmalar.get(ucHex), y)) return null
    this.yapilandirmalar.set(ucHex, y)
    return y.m.seq
  }

  /**
   * hf.task.vision görevi başladı: uça UC_STREAM_OPEN. g: { taskId, type, params: { sourceId } }. Dönüş: streamId (hex)
   * Hata: INVALID_TASK_TYPE, INVALID_SOURCE (uç aktif değil ya da class 'uc' değil), NO_CONFIG, NOT_TARGET, NO_PAIR, NO_NETWORK
   */
  baslat ({ taskId, type, params }, { want = ISTEK } = {}) {
    if (type !== VISION) fail('INVALID_TASK_TYPE')
    const L = this.L()
    const ucHex = hex(params?.sourceId ?? fail('INVALID_SOURCE'))
    const d = L.devices.get(ucHex)
    if (!d || !d.active || d.class !== 'uc') fail('INVALID_SOURCE')
    const y = this.yapilandirmalar.get(ucHex) ?? fail('NO_CONFIG')
    // İşçi hedefte değilse uç zaten reddeder (IZIN_YOK); erken söylenir (Bakım YB12: targets yalnız işçi)
    if (y.m.mode !== 'kamera' || !A.hedefUyar(y.m, { id: this.meHex, sinif: 'isci', rol: null, purpose: 'analiz' })) fail('NOT_TARGET')
    if (!this.cift(ucHex)) fail('NO_PAIR')
    const streamId = rastgele16()
    const bytes = A.akisAcKodla(L.familyId, { streamId, ucId: unhex(ucHex), purpose: 'analiz', taskId: unhex(taskId), want, configSeq: y.m.seq, ledgerSeq: L.len - 1 }, this.me)
    const id = hex(streamId)
    this.akislar.set(id, { taskId: hex(taskId), ucHex, opener: null, kabul: null, acilma: this.now(), durum: 'istendi' })
    this.gorevler.set(hex(taskId), { ucHex, want })
    if (!this.ag(ucHex, Z.UC_STREAM_OPEN, bytes)) { this.akislar.delete(id); fail('NO_NETWORK') }
    return id
  }

  /**
   * Görev başlamadan önce (inceleme 23 madde 4): akışı açar ve denetçi pod'u kurana (AKIS_AC) kadar bekler; böylece görev
   * konteyneri pod'a katıldığında akış sunucusu hazırdır. Dönüş Promise<streamId>. Hata: baslat hataları, STREAM_OPEN_FAILED
   * (uç kapattı ya da süre doldu)
   */
  hazirla (g, { sureMs = 30_000 } = {}) {
    const t = hex(g.taskId)
    return new Promise((resolve, reject) => {
      const z = setTimeout(() => { if (this.bekleyenler.get(t)) { this.bekleyenler.delete(t); this.durdur(t); reject(new Error('STREAM_OPEN_FAILED')) } }, sureMs)
      if (z.unref) z.unref()
      this.bekleyenler.set(t, { resolve: (id) => { clearTimeout(z); resolve(id) }, reject: (e) => { clearTimeout(z); reject(e) } })
      try { this.baslat({ ...g, taskId: t }) } catch (e) { this.bekleyenler.delete(t); clearTimeout(z); reject(e) }
    })
  }

  /** UC_STREAM_ACCEPT: kareleri açan nesne kurulur, denetçiye AKIS_AC. Dönüş Promise<streamId> */
  async kabulAl (fromHex, bytes, yol) {
    const L = this.L()
    giris.gelenZarf({ myRole: 'cihaz', peerRole: L.sessionRole(hex(fromHex)), type: Z.UC_STREAM_ACCEPT, bytes, L, gonderen: hex(fromHex), yol })
    const k = A.kabulCoz(bytes)
    const id = hex(k.streamId)
    const a = this.akislar.get(id)
    if (!a || a.ucHex !== hex(fromHex) || a.opener) fail('NO_STREAM')
    const pair = this.cift(a.ucHex)
    a.opener = new C.AkisAcici({ pair, streamId: k.streamId, ssrc: k.ssrc, yon: C.YON.UC })
    a.sealer = new C.AkisMuhurleyici({ pair, streamId: k.streamId, ssrc: k.ssrc, yon: C.YON.ALICI })
    a.kabul = k
    try {
      await this.denetci.istek(IPC.AKIS_AC, { taskId: unhex(a.taskId), sourceId: unhex(a.ucHex), streamId: k.streamId, codec: k.codec, width: k.width, height: k.height, fps: k.fps })
    } catch (e) {
      this._kapat(id, 'BITTI', { uca: true })
      throw e
    }
    // Beklerken uç kapattıysa (kapatAl) ya da görev durduysa kayıt gitmiştir: denetçinin açtığı akış kapatılır, aynı görevin
    // açık akışına dokunulmaz (Codex 12. tur)
    if (this.akislar.get(id) !== a) {
      this.denetci.gonder(IPC.AKIS_KAPAT, { streamId: k.streamId, code: 'BITTI' })
      fail('NO_STREAM')
    }
    a.durum = 'acik'
    const b = this.bekleyenler.get(a.taskId)
    if (b) { this.bekleyenler.delete(a.taskId); b.resolve(id) }
    // Yenileme: aynı görevin eski akışı yenisi açılınca kapanır (§11.5: bir akış en çok 24 saat)
    for (const [eid, e] of [...this.akislar]) if (eid !== id && e.taskId === a.taskId && e.durum === 'acik') this._kapat(eid, 'SURE_DOLDU', { uca: true, denetciye: true })
    return id
  }

  /**
   * Sırasız kanaldan gelen çerçeve (uçtan, doğrudan oturum). Açılamayan ya da tekrar eden çerçeve atılır (false).
   * Görüntü izi (tip 1) denetçiye AKIS_KARE olur.
   */
  cerceveAl (fromHex, streamIdHex, cerceve) {
    const a = this.akislar.get(streamIdHex)
    if (!a || a.durum !== 'acik' || a.ucHex !== hex(fromHex)) return false
    let r
    try { r = a.opener.ac(cerceve) } catch { return false }
    if (r.tip !== C.TIP.GORUNTU) return false
    this.denetci.gonder(IPC.AKIS_KARE, { streamId: unhex(streamIdHex), ts: r.ts >>> 0, key: anahtarMi(r.yuk), data: r.yuk })
    return true
  }

  /** UC_STREAM_CLOSE (uçtan): denetçiye AKIS_KAPAT */
  kapatAl (fromHex, bytes, yol) {
    const L = this.L()
    giris.gelenZarf({ myRole: 'cihaz', peerRole: L.sessionRole(hex(fromHex)), type: Z.UC_STREAM_CLOSE, bytes, L, gonderen: hex(fromHex), yol })
    const m = A.kapatCoz(bytes)
    const id = hex(m.streamId)
    const a = this.akislar.get(id)
    if (!a || a.ucHex !== hex(fromHex)) fail('NO_STREAM')
    this._kapat(id, m.code, { denetciye: true })
    return { streamId: id, code: m.code }
  }

  /** Denetçiden cevapsız bildirim: AKIS_KAPAT (akış sunucusu kapandı, görev bitti) ya da ANAHTAR_KARE_ISTE */
  denetcidenAl (m) {
    if (m.type === IPC.AKIS_KAPAT) { const id = hex(m.mesaj.streamId); if (this.akislar.has(id)) this._kapat(id, 'BITTI', { uca: true }); return true }
    if (m.type === IPC.ANAHTAR_KARE_ISTE) { const id = hex(m.mesaj.streamId); if (this.akislar.has(id)) this.anahtarKareIste(id); return true }
    return false
  }

  /** Uca anahtar kare isteği (denetim izi, tip 2; ters yön anahtarı). Dönüş: gönderildi mi */
  anahtarKareIste (streamIdHex) {
    const a = this.akislar.get(streamIdHex)
    if (!a || a.durum !== 'acik') return false
    const c = a.sealer.muhurle(ANAHTAR_ISTEGI, { tip: C.TIP.DENETIM, ts: this.now() >>> 0 }).cerceve
    this._yay('anahtar-kare', streamIdHex)
    return this.cerceveAg(a.ucHex, streamIdHex, c)
  }

  /** Görev bitti ya da iptal: o görevin akışı kapanır, uça ve denetçiye bildirilir */
  durdur (taskId) {
    const t = hex(taskId)
    for (const [id, a] of [...this.akislar]) if (a.taskId === t) this._kapat(id, 'BITTI', { uca: true, denetciye: true })
    this.gorevler.delete(t)
  }

  /** 24 saat dolmadan yenilenecek akışlar için yeni UC_STREAM_OPEN; eskisi yenisi kabul edilince kapanır (kabulAl). Dönüş: yeni streamId'ler */
  yenile () {
    const out = []
    for (const [id, a] of [...this.akislar]) {
      if (a.durum !== 'acik' || this.now() - a.acilma < YENILE_MS || a.yenilendi) continue
      const g = this.gorevler.get(a.taskId)
      a.yenilendi = true
      try { out.push(this.baslat({ taskId: a.taskId, type: VISION, params: { sourceId: a.ucHex } }, { want: g?.want })) } catch { a.yenilendi = false }
    }
    return out
  }

  _kapat (id, code, { uca = false, denetciye = false } = {}) {
    const a = this.akislar.get(id)
    if (!a) return
    a.opener?.kapat()
    a.sealer?.kapat()
    this.akislar.delete(id)
    // Görev bu akışı bekliyorsa (hazirla) açılmadan kapandı
    const b = a.durum !== 'acik' && this.bekleyenler.get(a.taskId)
    if (b) { this.bekleyenler.delete(a.taskId); b.reject(new Error('STREAM_OPEN_FAILED')) }
    if (uca) this.ag(a.ucHex, Z.UC_STREAM_CLOSE, A.kapatKodla({ streamId: unhex(id), code, by: this.me.memberId }))
    if (denetciye && a.durum === 'acik') this.denetci.gonder(IPC.AKIS_KAPAT, { streamId: unhex(id), code })
    this._yay('kapandi', id, code)
  }
}

/**
 * hf.task.vision görevinin params baytlarından kaynak (uç kimliği). Biçim RFC-0002'de yazılınca kesinleşir (İstek 166 e):
 * bugün JSON { sourceId: hex32 }. Dönüş: hex ya da null
 */
function kaynakOf (params) {
  try {
    const j = JSON.parse(b4a.toString(params))
    return typeof j.sourceId === 'string' && /^[0-9a-f]{32}$/.test(j.sourceId) ? j.sourceId : null
  } catch { return null }
}

module.exports = { IsciAkisAlici, anahtarMi, kaynakOf, VISION, YENILE_MS }
