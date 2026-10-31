// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// supervisor.js — denetçinin çekirdeklere bakan IPC işleyicileri (RFC-0007 §4.1, §5, §6.3)
//
// Denetçi kimlik anahtarı görmez, defter tutmaz. Her çekirdeğe ayrı soketten bağlanır; bir soketin isteğini yalnız o
// soketin kapsamına ('kutu' | 'isci') uygular. Yollar 'kok' önekine göredir (kurulu düğümde '/'; testte geçici dizin).
const fs = require('fs')
const path = require('path')
const b4a = require('b4a')
const { IPC } = require('./ipc/types')
const { IpcUcu } = require('./ipc/server')
const { cerceveYaz } = require('./ipc/frame')
const AS = require('./edge/stream-socket')

const hex = (b) => b4a.toString(b, 'hex')
function fail (code) { throw new Error(code) }

const KULLANICI = { kutu: 'havenfold-kutu', isci: 'havenfold-isci' }
const AKIS_TAMPON = 4 * 1024 * 1024 // akış sunucusuna yazılmayı bekleyen en çok veri

// UTF-8'de en çok n bayt; karakter bölünmez (inceleme 11 bulgu 10: sınır baytladır)
function baytKes (s, n) {
  if (b4a.byteLength(s) <= n) return s
  let out = ''
  let boy = 0
  for (const ch of s) {
    const b = b4a.byteLength(ch)
    if (boy + b > n) break
    out += ch
    boy += b
  }
  return out
}

class Denetci {
  // kaynakVar(limits) → bool (RAM ve disk; tmpfs'e sığmayan görev şifresiz diskte NO_SOURCE); calistir(gorev) →
  // Promise<{ status, exitCode, log }> (Podman API'si); iptal(taskIdHex); saglik(kapsam) → SAGLIK_ANLIK gövdesi ya da null
  // (MERHABA cevabının ardından gönderilir; RFC-0007 §6.3 satır 2); yetki(islem, girdi) → Promise: yetki yardımcısının
  // işlemi (RFC-0007 §6.4; üretimde yardımcının soketi, privilege-socket.js; verilmezse NO_PERMISSION);
  // kurtarmaKapsami: RECOVERY_KEY'nı isteyebilecek çekirdek ('isci'; tek kimlikli kutu düğümünde 'kutu'; §6.3 tür 22)
  // akisBagla(yol) → Promise<soket>: görevin akış sunucusunun Unix soketine bağlanır (RFC-0008 §11.5 madde 4; üretimde net)
  // akisPodKur({ taskId, sourceId, dir }) → Promise<{ soket }>, akisPodSil(taskId): görüntü görevinin pod'u ve akış sunucusu
  // (podman.js; inceleme 23 madde 1–3)
  constructor ({ kok = '/', hostId, surum, kaynakVar = () => true, calistir = null, iptal = () => {}, saglik = () => null, yetki = null, kurtarmaKapsami = 'isci', akisBagla = null, akisPodKur = null, akisPodSil = () => {} }) {
    this.kok = kok
    this.hostId = hostId
    this.surum = surum
    this.kanca = { kaynakVar, calistir, iptal, saglik, yetki, akisBagla: akisBagla || unixBaglan, akisPodKur, akisPodSil }
    this.akislar = new Map() // streamIdHex → { taskId, soket, baglanti } (uç akışı, RFC-0008 §11.5)
    this.kurtarmaKapsami = kurtarmaKapsami
    this.merhaba = new Map() // kapsam → { surum, at }
    this.uclar = new Map() // kapsam → IpcUcu (yayinla için)
    this.gorevler = new Map() // taskIdHex → { dir, limits, type, version, standing }
  }

  yol (...p) { return path.join(this.kok, ...p) }
  yedekDizini (kapsam) { return this.yol('var/lib/havenfold/yedek', kapsam) }
  gorevDizini (taskIdHex) { return this.yol('run/havenfold/gorev', taskIdHex) }

  // Kapsam başına IPC ucu (/run/havenfold/denetci/<kapsam>.sock; RFC-0026 f: denetçinin soketleri kendi dizininde,
  // çekirdekler oraya grup üyeliğiyle bağlanır)
  uc (kapsam) {
    if (!KULLANICI[kapsam]) fail('INVALID_COVERAGE')
    const yalnizIsci = (f) => (m, ctx) => { if (ctx.kapsam !== 'isci') fail('UNAUTHORIZED'); return f(m, ctx) }
    const u = new IpcUcu({
      kapsam,
      beklenen: new Set([KULLANICI[kapsam]]),
      isleyiciler: {
        [IPC.MERHABA]: (m, ctx) => this.merhabaAl(m, ctx),
        [IPC.YEDEK_YAZ]: (m, ctx) => this.yedekYaz(m, ctx),
        [IPC.YEDEK_OKU]: (m, ctx) => this.yedekOku(m, ctx),
        [IPC.YEDEK_SIL]: (m, ctx) => this.yedekSil(m, ctx),
        [IPC.GOREV_HAZIRLA]: yalnizIsci((m) => this.gorevHazirla(m)),
        [IPC.GOREV_BASLAT]: yalnizIsci((m) => this.gorevBaslat(m)),
        [IPC.TASK_CANCEL]: yalnizIsci((m) => { this.kanca.iptal(hex(m.taskId)); return [] }),
        [IPC.GOREV_TEMIZLE]: yalnizIsci((m) => this.gorevTemizle(m)),
        [IPC.AKIS_AC]: yalnizIsci((m, ctx) => this.akisAc(m, ctx)),
        [IPC.AKIS_KARE]: yalnizIsci((m) => this.akisKare(m)),
        [IPC.AKIS_KAPAT]: yalnizIsci((m) => this.akisKapat(m)),
        [IPC.RECOVERY_KEY]: (m, ctx) => this.kurtarmaAnahtari(m, ctx),
        [IPC.HATA]: () => []
      }
    })
    this.uclar.set(kapsam, u)
    return u
  }

  // Sağlık anlığını o kapsamın bağlı çekirdeğine yeniden gönder (güç değişti: prizden kesinti, pil; RFC-0012 §10). MERHABA
  // demiş çekirdek yoksa gönderilmez. Dönüş: gönderildi mi
  saglikYenile (kapsam = 'isci') {
    const u = this.uclar.get(kapsam)
    if (!u || !this.merhaba.has(kapsam)) return false
    const anlik = this.kanca.saglik(kapsam)
    return anlik ? u.yayinla(IPC.SAGLIK_ANLIK, anlik) > 0 : false
  }

  merhabaAl (m, { kapsam }) {
    if (m.rol !== kapsam) fail('UNAUTHORIZED') // kutu soketinden işçi olarak tanıtılamaz
    this.merhaba.set(kapsam, { surum: m.surum, at: Date.now() })
    const cevap = { type: IPC.MERHABA, yon: 'cevap', mesaj: { hostId: this.hostId, denetciSurum: this.surum } }
    const anlik = this.kanca.saglik(kapsam)
    return anlik ? [cevap, { type: IPC.SAGLIK_ANLIK, reqId: 0, mesaj: anlik }] : cevap
  }

  // Çekirdek şifreli bloğu kendi /run/havenfold/<kapsam>/ dizinine (alt dizin yok) yazar; denetçi onu kapsamın yedek
  // dizinine kopyalar, kaynağı çekirdek siler. Yolda bağ izlenmez (inceleme 11 bulgu 5): dizin gerçek yolu kapsamın
  // dizinidir, dosya O_NOFOLLOW ile açılır ve aynı tanıtıcıdan okunur; düzenli dosya ve beyan edilen boyut.
  yedekYaz (m, { kapsam }) {
    const izinli = this.yol('run/havenfold', kapsam)
    const kaynak = path.resolve(this.yol(m.path))
    if (path.dirname(kaynak) !== izinli) fail('INVALID_PATH')
    let gercek
    try { gercek = fs.realpathSync(path.dirname(kaynak)) } catch { fail('INVALID_PATH') }
    if (gercek !== fs.realpathSync(izinli)) fail('INVALID_PATH')
    let fd
    try { fd = fs.openSync(kaynak, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK) } catch { fail('INVALID_PATH') }
    let bytes
    try {
      const st = fs.fstatSync(fd)
      if (!st.isFile() || st.size !== m.size) fail('SIZE_MISMATCH')
      bytes = b4a.alloc(st.size)
      let n = 0
      while (n < st.size) {
        const r = fs.readSync(fd, bytes, n, st.size - n, n)
        if (r === 0) fail('SIZE_MISMATCH')
        n += r
      }
    } finally { fs.closeSync(fd) }
    fs.mkdirSync(this.yedekDizini(kapsam), { recursive: true, mode: 0o700 })
    fs.writeFileSync(path.join(this.yedekDizini(kapsam), hex(m.blobId)), bytes, { flag: 'wx', mode: 0o600 })
    return { type: IPC.YEDEK_CEVAP, mesaj: { blobId: m.blobId, ok: true, path: '' } }
  }

  yedekOku (m, { kapsam }) {
    const p = path.join(this.yedekDizini(kapsam), hex(m.blobId))
    const var_ = fs.existsSync(p)
    return { type: IPC.YEDEK_CEVAP, mesaj: { blobId: m.blobId, ok: var_, path: var_ ? path.relative(this.kok, p) : '' } }
  }

  yedekSil (m, { kapsam }) {
    fs.rmSync(path.join(this.yedekDizini(kapsam), hex(m.blobId)), { force: true })
    return { type: IPC.YEDEK_CEVAP, mesaj: { blobId: m.blobId, ok: true, path: '' } }
  }

  // /run/havenfold/gorev/<taskId>/ in/, out/, params (2770; grup havenfold-gorev kurulumda tmpfiles ile)
  gorevHazirla (m) {
    const id = hex(m.taskId)
    const dir = this.gorevDizini(id)
    if (this.gorevler.has(id) || fs.existsSync(dir)) return { type: IPC.GOREV_HAZIR, mesaj: { taskId: m.taskId, dir: '', ok: false, code: 'REPLAY' } }
    if (!this.kanca.kaynakVar(m.limits)) return { type: IPC.GOREV_HAZIR, mesaj: { taskId: m.taskId, dir: '', ok: false, code: 'NO_SOURCE' } }
    for (const d of ['', 'in', 'out']) {
      fs.mkdirSync(path.join(dir, d), { recursive: true })
      fs.chmodSync(path.join(dir, d), 0o2770)
    }
    fs.writeFileSync(path.join(dir, 'params'), JSON.stringify({ type: m.type, version: m.version, limits: m.limits, standing: m.standing }), { mode: 0o640 })
    this.gorevler.set(id, { dir, type: m.type, version: m.version, limits: m.limits, standing: m.standing, sourceId: m.sourceId ? hex(m.sourceId) : null })
    return { type: IPC.GOREV_HAZIR, mesaj: { taskId: m.taskId, dir: path.relative(this.kok, dir), ok: true, code: '' } }
  }

  async gorevBaslat (m) {
    const g = this.gorevler.get(hex(m.taskId))
    if (!g) fail('NO_TASK')
    if (!this.kanca.calistir) fail('NO_RUNNER')
    const r = await this.kanca.calistir({ taskId: hex(m.taskId), ...g })
    return { type: IPC.GOREV_BITTI, mesaj: { taskId: m.taskId, status: r.status, exitCode: r.exitCode, log: baytKes(String(r.log || ''), 4096) } }
  }

  async gorevTemizle (m) {
    const id = hex(m.taskId)
    const g = this.gorevler.get(id)
    for (const [sid, a] of [...this.akislar]) if (a.taskId === id) this._akisBirak(sid, 'BITTI')
    // Görevin pod'u (ağ ad alanı ve akış sunucusu) görevle biter
    if (g?.ag) { try { await this.kanca.akisPodSil(id) } catch {} }
    fs.rmSync(this.gorevDizini(id), { recursive: true, force: true })
    this.gorevler.delete(id)
    return []
  }

  // --- Uç akışı (RFC-0008 §11.5 "İşçi tarafı" madde 2–4; IPC 40–43) -----------------------------------------------
  // İşçi açtığı akışı bildirir: görev hf.task.vision ve kaynak görevinki olmalı. Görevin ilk akışında görev kullanıcısının
  // rootless Podman'ı pod'u (--network=none, yalnız lo) ve içinde sertleştirilmiş akış sunucusunu kurar (inceleme 23
  // madde 1–3); denetçi kareleri akis.sock'a yazar. Kareler diske yazılmaz (yalnız Unix soketinden geçer). Geri basınç
  // (madde 6): sokete yazılmayı bekleyen veri sınırı aşınca kareler atılır, sonraki anahtar kareyle sürer.
  async akisAc (m, { baglanti }) {
    const id = hex(m.taskId)
    const sid = hex(m.streamId)
    const g = this.gorevler.get(id)
    if (!g) fail('NO_TASK')
    if (g.type !== 'hf.task.vision') fail('INVALID_TASK_TYPE')
    if (!g.sourceId || g.sourceId !== hex(m.sourceId)) fail('INVALID_SOURCE')
    if (this.akislar.has(sid)) fail('REPLAY')
    if (!g.ag) {
      // POD_YOK İngilizceye çevrilmez: IPC HATA.code ile işçiye gider (tel değeri)
      if (!this.kanca.akisPodKur) fail('POD_YOK')
      // Unix soket yolu sınırı (sun_path: Linux 108, macOS 104 bayt, sonda NUL); aşan yolda listen kodsuz hata atar
      if (Buffer.byteLength(path.join(g.dir, 'akis', 'akis.sock')) > 103) fail('SOCKET_PATH_TOO_LONG')
      try {
        g.akisSoketi = (await this.kanca.akisPodKur({ taskId: id, sourceId: g.sourceId, dir: g.dir })).soket
      } catch (e) { fail(/^[A-Z_]+$/.test(e.message) ? e.message : 'POD_SETUP_FAILED') }
      g.ag = true
    }
    const soket = await this.kanca.akisBagla(g.akisSoketi)
    const a = { taskId: id, soket, baglanti, atiliyor: false, atilan: 0 }
    this.akislar.set(sid, a)
    const ok = new AS.Okuyucu()
    soket.on('data', (p) => {
      let cs
      try { cs = ok.besle(p) } catch { soket.destroy(); return }
      for (const c of cs) if (c.tur === AS.TUR.ANAHTAR) baglanti?.gonder(IPC.ANAHTAR_KARE_ISTE, { streamId: m.streamId })
    })
    soket.on('error', () => {})
    soket.on('close', () => {
      if (this.akislar.get(sid) !== a) return
      this.akislar.delete(sid)
      baglanti?.gonder(IPC.AKIS_KAPAT, { streamId: m.streamId, code: 'SERVER_CLOSED' })
    })
    return { type: IPC.AKIS_AC, yon: 'cevap', mesaj: { streamId: m.streamId } }
  }

  akisKare (m) {
    const a = this.akislar.get(hex(m.streamId))
    if (!a) return [] // cevapsız; bilinmeyen akışın karesi atılır
    // Geri basınç: sunucu yetişemiyorsa kare atılır (bellek sınırsız büyümez; takas yoluyla diske de düşmez, YB2)
    if (a.soket.writableLength > AKIS_TAMPON) a.atiliyor = true
    if (a.atiliyor && m.key && a.soket.writableLength <= AKIS_TAMPON / 2) a.atiliyor = false
    if (a.atiliyor) { a.atilan++; return [] }
    a.soket.write(AS.kare(m))
    return []
  }

  akisKapat (m) {
    this._akisBirak(hex(m.streamId), m.code)
    return []
  }

  _akisBirak (sid, code) {
    const a = this.akislar.get(sid)
    if (!a) return
    this.akislar.delete(sid)
    a.soket.end(AS.kapat(code))
  }

  // LUKS kurtarma anahtarı (RFC-0007 §8.5 adım 4 ve 6): çekirdek okur, töreni yapan ebeveynin telefonuna NODE_RECOVERY
  // ile gönderir; telefonun alındısından sonra sildirir. Denetçi anahtarı saklamaz; yetki yardımcısı dosyayı kendisi
  // denetler (kökün dizini, bağ değil, 32 bayt).
  async kurtarmaAnahtari (m, { kapsam }) {
    if (kapsam !== this.kurtarmaKapsami) fail('UNAUTHORIZED')
    if (!this.kanca.yetki) fail('NO_PERMISSION')
    const r = await this.kanca.yetki('luks-kurtarma', { istek: m.istek })
    const mesaj = m.istek === 'oku'
      ? { var: !!r.var, anahtar: r.var ? b4a.from(r.anahtar, 'hex') : b4a.alloc(0) }
      : { var: !!r.silindi, anahtar: b4a.alloc(0) }
    return { type: IPC.RECOVERY_KEY, yon: 'cevap', mesaj }
  }

  // D → Ç: çekirdeklerin oturumlarını düzgün kapatması için
  durdur (neden) { return cerceveYaz(IPC.DURDUR, 0, { neden }) }
}

// Unix soketine bağlan; sunucu henüz dinlemiyorsa kısa aralıklarla en çok 15 sn dener (yüklü makinede sunucu geç açılır)
function unixBaglan (yol) {
  const net = require('net')
  const son = Date.now() + 15000
  return new Promise((resolve, reject) => {
    const dene = () => {
      const s = net.createConnection(yol)
      const hata = () => { if (Date.now() > son) reject(new Error('NO_STREAM_SERVER')); else setTimeout(dene, 100) }
      s.once('error', hata)
      // Bağlandıktan sonra yeniden deneme yok; kapanıştaki ECONNRESET/EPIPE yakalanmayan hata olmaz (soket 'close' ile biter)
      s.once('connect', () => { s.off('error', hata); s.on('error', () => {}); resolve(s) })
    }
    dene()
  })
}

module.exports = { Denetci, KULLANICI, baytKes }
