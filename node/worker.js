// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// worker.js — işçi çekirdeği (Node): denetçi istemcisi, görev yürütücüsü ve ağ tarafı (RFC-0002 §4, §6, §11.1;
// RFC-0007 §4.1, §6.1–6.3; RFC-0028 taşıyıcısı)
//
// Akış: taşıyıcıyla topluluğa bağlanır (işçi dinler, telefon arar), bağlanan üyelere NODE_CAPS yayar, gelen TASK'ı
// kendi defter kopyasıyla doğrular (@havenfold/tasks Isci; ilk kullanım onayı isteyen telefondadır, RFC-0002 §7),
// TASK_ACCEPT ya da TASK_REJECT döner, girdileri isteyenden BLOB_REQ ile çeker, konteyneri denetçiye çalıştırtır
// (GOREV_HAZIRLA → girdiler dir/in/ → GOREV_BASLAT → GOREV_BITTI → dir/out/ okunur → GOREV_TEMIZLE) ve TASK_RESULT
// gönderir. Çekirdek konteyner başlatamaz; yalnız bu IPC'yi kullanır.
//
// Kimlik, defter ve tören kutu çekirdeğindeki gibi worklet kalıcı katmanındadır (/var/lib/havenfold/isci/cekirdek/);
// işçi `havenfold katil --rol isci` ile cihaz törenine girer (DEVICE_ATTACH), defteri eşitleyiciyle eşitlenir.
//
// Ortam: HF_KOK (yalnız test: yolların öneki), HF_ISCI_ADI (törende görünen ad), HF_ONYUKLEME (yalnız test: yerel
// testnet), HF_TEST_KIPI=1 (yalnız test: taklit TPM), HF_TOREN_MS. Yalnız test olanlar üretimde (systemd, kök,
// havenfold-* kullanıcısı) TEST_ENV_IN_PRODUCTION ile reddedilir (test-env.js). Bare desteği İstek 151'e kadar Node.
'use strict'
const fs = require('fs')
const path = require('path')
const b4a = require('b4a')
const c = require('compact-encoding')
const sodium = require('sodium-native')
const { IPC } = require('./ipc/types')
const { baglan } = require('./ipc/socket')
const { cerceveYaz, mesajCoz, CerceveOkuyucu, ipcMsg } = require('./ipc/frame')
const { YONETIM_SOKETI } = require('./command')

function fail (code) { throw new Error(code) }
const hex = (b) => (typeof b === 'string' ? b : b4a.toString(b, 'hex'))

const CIKTI_MAX = 1 << 30 // tek görevin çıktısı en çok 1 GiB (limits.diskMB ayrıca sınırlar)

// Denetçiye bağlı istemci: istek → cevap (reqId ile), cevapsız bildirimler (DURDUR, SAGLIK_ANLIK) bildirim kancasına
class DenetciIstemcisi {
  // bekleMs: denetçinin soketi henüz yoksa (ENOENT) ya da dinlemiyorsa (ECONNREFUSED) bu süre boyunca yeniden denenir;
  // açılışta işçi denetçiden önce başlayıp düşmesin (Type=simple denetçi soketini birim başladıktan sonra açar)
  constructor ({ soket, rol = 'isci', surum = '0.0.0', bildirim = () => {}, bekleMs = 30_000 }) {
    this.soket = soket
    this.bekleMs = bekleMs
    this.rol = rol
    this.surum = surum
    this.bildirim = bildirim
    this.s = null
    this.sira = 0
    this.bekleyen = new Map() // reqId → { type, resolve, reject }
    this.okuyucu = new CerceveOkuyucu()
  }

  async baglan () {
    const son = Date.now() + this.bekleMs
    for (let ara = 100; ; ara = Math.min(ara * 2, 2000)) {
      try { this.s = await baglan(this.soket); break } catch (err) {
        if (!['ENOENT', 'ECONNREFUSED'].includes(err.code) || Date.now() + ara > son) throw err
        await new Promise((resolve) => setTimeout(resolve, ara))
      }
    }
    this.s.on('data', (p) => this._al(p))
    this.s.on('error', () => {})
    this.s.on('close', () => {
      for (const b of this.bekleyen.values()) b.reject(new Error('CONNECTION_LOST'))
      this.bekleyen.clear()
      this.bildirim({ type: 'kapandi' })
    })
    return this
  }

  _al (parca) {
    let mesajlar
    try { mesajlar = this.okuyucu.besle(parca) } catch { this.s.destroy(); return }
    for (const b of mesajlar) {
      let ust
      try { ust = c.decode(ipcMsg, b) } catch { continue }
      if (ust.type === IPC.HATA) {
        let m
        try { m = mesajCoz(b).mesaj } catch { continue }
        const bk = this.bekleyen.get(m.reqId)
        if (bk) { this.bekleyen.delete(m.reqId); bk.reject(new Error(m.code)) }
        continue
      }
      const bk = ust.reqId ? this.bekleyen.get(ust.reqId) : null
      let m
      try { m = mesajCoz(b, bk && (bk.type === IPC.MERHABA || bk.type === IPC.RECOVERY_KEY || bk.type === IPC.AKIS_AC) ? 'cevap' : 'istek') } catch { continue }
      if (bk) { this.bekleyen.delete(ust.reqId); bk.resolve(m) } else this.bildirim(m)
    }
  }

  // Cevap bekleyen istek
  istek (type, mesaj) {
    if (!this.s || this.s.destroyed) return Promise.reject(new Error('NO_CONNECTION'))
    const reqId = ++this.sira
    return new Promise((resolve, reject) => {
      this.bekleyen.set(reqId, { type, resolve, reject })
      this.s.write(cerceveYaz(type, reqId, mesaj))
    })
  }

  // Cevapsız istek (TASK_CANCEL, GOREV_TEMIZLE)
  gonder (type, mesaj) {
    if (this.s && !this.s.destroyed) this.s.write(cerceveYaz(type, ++this.sira, mesaj))
  }

  async merhaba () {
    const r = await this.istek(IPC.MERHABA, { rol: this.rol, surum: this.surum })
    return r.mesaj // { hostId, denetciSurum }
  }

  kapat () { if (this.s) this.s.destroy() }
}

// umask (birimde 0077) yazılan dosyanın grup iznini keser: konteyner (grup havenfold-gorev) okuyabilsin diye açıkça
function grupOkunurYaz (p, veri) {
  fs.writeFileSync(p, veri, { flag: 'wx', mode: 0o640 })
  fs.chmodSync(p, 0o640)
}

// Çıktı dizinindeki düzenli dosyalar; bağ izlenmez (konteyner yazdı, güvenilmez)
function ciktilariOku (dir, max) {
  const out = []
  let toplam = 0
  for (const ad of fs.readdirSync(dir).sort()) {
    const p = path.join(dir, ad)
    let fd
    try { fd = fs.openSync(p, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK) } catch { continue }
    try {
      const st = fs.fstatSync(fd)
      if (!st.isFile()) continue
      toplam += st.size
      if (toplam > max) fail('OUTPUT_TOO_LARGE')
      const bytes = b4a.alloc(st.size)
      let n = 0
      while (n < st.size) {
        const r = fs.readSync(fd, bytes, n, st.size - n, n)
        if (r === 0) break
        n += r
      }
      out.push({ ad, bytes: bytes.subarray(0, n) })
    } finally { fs.closeSync(fd) }
  }
  return out
}

// Kabul edilmiş görevi denetçiye çalıştırtır. g: { taskId, type, version, limits, standing, sourceId?, params: buffer,
// girdiler: [{ mime, bytes }] } (bytes çözülmüş içerik; yazıldıktan sonra sıfırlanır). kok: denetçinin döndürdüğü
// göreli dizinin öneki. Dönüş: { ok: false, code } (GOREV_HAZIR reddi) ya da { ok: true, status, exitCode, log,
// ciktilar: [{ ad, bytes }] }. Çıktıların şifrelenmesi ve TASK_RESULT ağ tarafının işidir (teslim.ciktiHazirla).
async function gorevYurut (istemci, g, { kok = '/', akis = null } = {}) {
  const taskId = typeof g.taskId === 'string' ? b4a.from(g.taskId, 'hex') : g.taskId
  // hf.task.vision (RFC-0008 §11.5; inceleme 23 madde 4): kaynak params'tan; akış açılıp pod kurulmadan görev başlamaz
  const gorus = g.type === 'hf.task.vision'
  if (gorus) {
    if (!akis) return { ok: false, code: 'NO_STREAM' }
    if (!g.sourceId) g = { ...g, sourceId: require('./edge/worker-stream').kaynakOf(g.params || b4a.alloc(0)) }
    if (!g.sourceId) return { ok: false, code: 'INVALID_SOURCE' }
  }
  try {
    // hf.task.vision: kaynak (uç) denetçiye bildirilir; denetçi uç akışını yalnız bu kaynak için kabul eder (RFC-0008 §11.5)
    const sourceId = g.sourceId ? (typeof g.sourceId === 'string' ? b4a.from(g.sourceId, 'hex') : g.sourceId) : null
    const h = await istemci.istek(IPC.GOREV_HAZIRLA, { taskId, type: g.type, version: g.version, limits: g.limits, standing: !!g.standing, sourceId })
    if (h.type !== IPC.GOREV_HAZIR || !b4a.equals(h.mesaj.taskId, taskId)) fail('INVALID_REPLY')
    if (!h.mesaj.ok) return { ok: false, code: h.mesaj.code }
    const dir = path.join(kok, h.mesaj.dir)
    try {
      const giris = path.join(dir, 'in')
      grupOkunurYaz(path.join(giris, 'params'), g.params || b4a.alloc(0))
      const liste = []
      g.girdiler.forEach((x, i) => {
        grupOkunurYaz(path.join(giris, String(i)), x.bytes)
        liste.push({ ad: String(i), mime: x.mime, size: x.bytes.byteLength })
      })
      grupOkunurYaz(path.join(giris, 'girdiler.json'), JSON.stringify(liste))
      if (gorus) {
        try { await akis.hazirla({ taskId, type: g.type, params: { sourceId: typeof g.sourceId === 'string' ? g.sourceId : b4a.toString(g.sourceId, 'hex') } }) } catch (e) {
          return { ok: false, code: /^[A-Z_]+$/.test(e.message) ? e.message : 'STREAM_OPEN_FAILED' }
        }
      }
      const r = await istemci.istek(IPC.GOREV_BASLAT, { taskId })
      if (r.type !== IPC.GOREV_BITTI || !b4a.equals(r.mesaj.taskId, taskId)) fail('INVALID_REPLY')
      const ciktilar = r.mesaj.status === 'ok' ? ciktilariOku(path.join(dir, 'out'), Math.min(CIKTI_MAX, (g.limits.diskMB || 1) * 1048576)) : []
      return { ok: true, status: r.mesaj.status, exitCode: r.mesaj.exitCode, log: r.mesaj.log, ciktilar }
    } finally {
      if (gorus) akis.durdur(taskId)
      istemci.gonder(IPC.GOREV_TEMIZLE, { taskId })
    }
  } finally {
    // Düz girdiler bellekte kalmaz (RFC-0002 §11.1 "Bitiş")
    for (const x of g.girdiler || []) if (b4a.isBuffer(x.bytes)) sodium.sodium_memzero(x.bytes)
  }
}

// --- Afet modu: işçinin deprem ve elektrik UYARI'sı (RFC-0012 §10, §17 adım 8; D88, D90) -------------------------------
//
// Güç izleyici (2 dk kesinti) ve varsa deprem algılayıcı UyariYoneticisi'ne bağlanır. UYARI gövdeleri aynı evdeki kutuya
// olağan oturumla (işçi kutuyu arar; transport.js) ve doğrudan oturumu olan uzaktaki ebeveyn ve yetişkine normal yoldan
// (AFET_MSG) gider. Deprem: eşik dugum.toml'da `deprem_esik = <sayı>` (yoksa kapalı); sensör kaynağı bu sürümde yok
// (Yuva Kutusu donanımı): eşik verilse de algılayıcı kurulmaz ve uyarı verilir. Kutu ve uzaktaki üye yoksa uyarı
// işçinin giden kutusunda kalır (normal yol dönünce normalYolaVer).
function isciAfetleri ({ a, wOf, gonder, sensor = null }) {
  const { YakinKaydi, UyariYoneticisi, DepremAlgilayici, GucIzleyici } = require('./disaster')
  const { denetim: D } = require('@havenfold/disaster')
  const { zarf: { Z } } = require('@havenfold/core')
  const ledger = () => { const w = wOf(); return w && w.kalici.nesneler.aile ? w.kalici.nesneler.ledger : null }
  let api = null
  const afet = () => {
    const w = wOf()
    if (!ledger()) return null
    if (!api) { const { DisasterApi } = require('@havenfold/sdk'); api = new DisasterApi({ me: w.kalici.kimlik, defter: ledger, saklama: require('./box').afetSaklamasi(w) }) }
    return api
  }
  const yakin = new YakinKaydi({ uyeMi: (k) => { const L = ledger(); return !!L && D.kimlikTuru(L, k) === 'telefon' } })
  const kutular = () => { const L = ledger(); return L ? [...L.members].filter(([, m]) => m.active && m.role === 'kutu').map(([id]) => id) : [] }
  const yonetici = new UyariYoneticisi({
    afet: { sendAlert: (o) => (afet() || fail('NO_FAMILY')).sendAlert(o) },
    yakin,
    kutuyaBirak: (govde) => kutular().map((k) => gonder(k, Z.AFET_MSG, govde)).some(Boolean),
    normalGonder: (to, govde) => gonder(to, Z.AFET_MSG, govde),
    internetVar: () => true // normal yol yalnız doğrudan oturum varsa gider (gonder false döner)
  })
  const guc = new GucIzleyici({ kok: a.kok, olay: (o) => { const x = afet(); if (!x) return; try { x.signal(guc.sinyal()) } catch {} yonetici.olay(o) } })
  const esik = depremEsigi(a.kok)
  const deprem = esik != null && sensor ? new DepremAlgilayici({ sensor, esik, olay: (o) => yonetici.olay(o) }) : null
  if (esik != null && !sensor) console.error('havenfold-isci: uyarı: deprem_esik var ama deprem sensörü yok; deprem uyarısı kapalı')
  return { yakin, yonetici, guc: guc.baslat(), deprem, afet, kapat: () => { guc.durdur(); deprem?.durdur() } }
}

// dugum.toml'un ilk bölümünden sayısal `deprem_esik` (Acil 05 §6: eşik açık nokta, varsayılan kapalı)
function depremEsigi (kok) {
  let s
  try { s = fs.readFileSync(path.join(kok, 'etc/havenfold/dugum.toml'), 'utf8') } catch { return null }
  for (const satir of s.split('\n')) {
    if (/^\s*\[/.test(satir)) break
    const m = /^\s*deprem_esik\s*=\s*"?(\d+(?:\.\d+)?)"?\s*$/.exec(satir)
    if (m) { const v = Number(m[1]); return v > 0 ? v : null }
  }
  return null
}

// --- Ağ tarafı ---------------------------------------------------------------------------------------------------
//
// RFC-0002 §4 (NODE_CAPS), §6 (TASK, TASK_ACCEPT/REJECT, TASK_RESULT, TASK_CANCEL), §6.1 (girdiler BLOB_REQ ile
// isteyenden), §6.3 (≤ 32 KB satır içi, büyüğü yeni anahtarla dosya), §11.1 (bitişte anahtarlar sıfırlanır).
// Taşıma: taşıyıcının ağ kancası { gonder(peerHex, tür, gövde), dinle({ baglandi, koptu, al }) } (RFC-0028 §4 f);
// gelen her zarf önce giris.gelenZarf'tan geçer (myRole 'cihaz'). Görev denetimi core/tasks Isci'dedir.
// İlerleme (§6.3 TASK_PROGRESS): görev başlayınca { pct: 0, note: 'basladi' }; denetçinin GOREV_ILERLEME bildirimi
// (RFC-0007 §6.3 tür 6) 10 saniyede en çok bir kez iletilir. Bugünkü konteyner sözleşmesinde ilerleme kanalı yok;
// denetçi GOREV_ILERLEME üretmez, işçi geleni iletir.
// Kurtarma anahtarı (RFC-0007 §8.5, §13.6): töreni yapan ebeveyn bağlanınca denetçiden okunan LUKS kurtarma anahtarı
// NODE_RECOVERY ile gider; o ebeveynin imzalı alındısıyla dosya sildirilir. Denetçi anahtarı yetki yardımcısının
// soketinden alır (privilege-socket.js); yardımcıya ulaşılamazsa NO_PERMISSION, anahtar dosyada bekler.
// Tekrar (§6.2 madde 8): işçinin gördüğü taskId'ler deadline'larına kadar gorulenDosyasi'na yazılır (0600, atomik);
// yeniden başlayan işçi aynı görevi TEKRAR ile reddeder.
// Bu sürümde olmayanlar: koordinatörün alt görev gönderimi, sonucun kutu emanetine bırakılması (HOLD; RFC-0002 Ek:
// RFC-0033 §9 r "emanete bırakma sonraki iş"; isteyen çevrimdışıysa sonuç işçide 7 gün bekler, teslim.SonucKutusu),
// hf.task.backup (yerleşik iş: YEDEK_YAZ'a bağlanmadı).
const MIME = { '.txt': 'text/plain', '.pdf': 'application/pdf', '.json': 'application/json' }
const GIRDI_MS = 120_000 // bir girdinin bütün parçaları için

class IsciAgi {
  // defter(): işçinin defteri (worklet Kalici'nin; aile yokken null; eşitlemeyle yerinde büyür); me: cihaz kimliği;
  // ag: { gonder }; istemci: DenetciIstemcisi; kok: görev dizinlerinin öneki; olcum: denetçinin SAGLIK_ANLIK caps
  // ölçümleri (JSON nesnesi); gorulenDosyasi: görülen taskId'lerin dosyası (verilmezse yalnız bellekte); kurtarma:
  // { oku() → Promise<32 B | null>, sil() → Promise<bool> } LUKS kurtarma anahtarı (denetçi ve yetki yardımcısı üzerinden)
  // ucAkis: IsciAkisAlici (edge/worker-stream.js; hf.task.vision için uç akışı; inceleme 23 madde 4)
  constructor ({ defter, me, ag, istemci, kok = '/', olcum = {}, now = Date.now, capsAralikMs = null, gorulenDosyasi = null, kurtarma = null, ucAkis = null }) {
    const { yetenek: { CAPS_ARALIK_MS } } = require('@havenfold/tasks')
    this.defter = defter
    this.me = me
    this.meHex = hex(me.memberId)
    this.ag = ag
    this.istemci = istemci
    this.kok = kok
    this.olcum = olcum
    this.now = now
    this.seq = 0
    this._durum = 'hazir' // sıcaklık histerezisi için önceki durum (core/tasks yetenek.durumHesapla)
    this.bagli = new Set()
    this.calisan = new Map() // taskIdHex → { type, ramMB, requester (hex), pct }
    this.blob = null
    this.bekleyenGirdi = new Map() // blobIdHex → { resolve, reject }
    this._isci = null // core/tasks Isci, defter nesnesi değişince yeniden
    const { SonucKutusu, IlerlemeSiniri } = require('@havenfold/tasks').teslim
    this.sonuclar = new SonucKutusu({ now })
    this.ilerlemeSiniri = new IlerlemeSiniri({ now })
    this.gorulenDosyasi = gorulenDosyasi
    this.kurtarma = kurtarma
    this._kurtarmaBitti = !kurtarma // dosya yok, teslim edildi ya da kanca yok
    this._kurtarmaSuruyor = false
    this.capsAralikMs = capsAralikMs || CAPS_ARALIK_MS
    this._zaman = null
    this.ucAkis = ucAkis
  }

  get L () { return this.defter() }

  // Bu ailedeki aktif işçi kimliği miyim (tören bitmeden ya da çıkarıldıktan sonra ağ tarafı susar)
  get hazir () {
    const L = this.L
    const d = L && L.devices.get(this.meHex)
    return !!(d && d.active && d.class === 'isci')
  }

  get isci () {
    const L = this.L
    if (!this._isci || this._isci.ledger !== L) {
      const { denetim: { Isci } } = require('@havenfold/tasks')
      const { dosya: { BlobStore } } = require('@havenfold/records')
      this._isci = new Isci({ ledger: L, me: this.me, caps: this.caps(), now: this.now })
      this._gorulenYukle(this._isci)
      this.blob = new BlobStore({ ledger: L, now: this.now })
    }
    return this._isci
  }

  // Görülen taskId'ler (§6.2 madde 8): { v: 1, gorulen: [[taskIdHex, saklamaSonu], …] }; süresi geçen ve bozuk girdiler
  // yüklenmez, bozuk dosya yok sayılır (işçi açılır; o durumda koruma yalnız bellekte)
  _gorulenYukle (isci) {
    if (!this.gorulenDosyasi) return
    let x
    try { x = JSON.parse(fs.readFileSync(this.gorulenDosyasi, 'utf8')) } catch { return }
    if (!x || x.v !== 1 || !Array.isArray(x.gorulen)) return
    const now = this.now()
    for (const g of x.gorulen) {
      if (Array.isArray(g) && /^[0-9a-f]{32}$/.test(g[0]) && Number.isSafeInteger(g[1]) && g[1] > now) isci.seen.set(g[0], g[1])
    }
  }

  _gorulenYaz () {
    if (!this.gorulenDosyasi || !this._isci) return
    try {
      fs.mkdirSync(path.dirname(this.gorulenDosyasi), { recursive: true, mode: 0o700 })
      require('./box').atomikYaz(this.gorulenDosyasi, JSON.stringify({ v: 1, gorulen: [...this._isci.seen] }))
    } catch {} // yazılamazsa koruma bu oturumda bellekte sürer
  }

  baslat () {
    this._zaman = setInterval(() => { this.capsYay(); try { this.ucAkis?.yenile() } catch {} }, this.capsAralikMs)
    if (this._zaman.unref) this._zaman.unref()
  }

  koptu (p) { this.bagli.delete(p) }

  // Ağ kancasında bu zarf işçinin mi (görev türleri ve beklenen girdi parçası); değilse eşitleyiciye gider
  ister (type, bytes) {
    const { zarf: { Z, GOREV } } = require('@havenfold/core')
    if (GOREV.includes(type) || type === Z.NODE_RECOVERY) return true
    if (this.ucAkis && (type === Z.UC_STREAM_ACCEPT || type === Z.UC_STREAM_CLOSE || type === Z.UC_CONFIG)) return true
    if (type !== Z.BLOB_DATA || !this.bekleyenGirdi.size) return false
    try { return this.bekleyenGirdi.has(hex(require('@havenfold/records').dosya.decodeBlobData(bytes).blobId)) } catch { return false }
  }

  kapat () { clearInterval(this._zaman) }

  // NODE_CAPS alanları (RFC-0002 §4): ölçümler denetçiden, değişenler bu makinede; durum ve çalışanlar işçinin.
  // Sıcaklık her bildirimde bu makinede okunur (temperature.js): 90 °C üstünde durum 'sicak', 80 °C altına inene kadar
  // öyle kalır ve işçi görev almaz. Okunamazsa durum sıcaklıksız hesaplanır.
  caps () {
    const { yetenek: { maxTaskRam, durumHesapla } } = require('@havenfold/tasks')
    const os = require('os')
    const o = this.olcum
    const cpuC = require('./temperature').sicaklikOku(this.kok).cpuC
    this._durum = durumHesapla({ onceki: this._durum, sicakliklar: cpuC === null ? [] : [cpuC], onAC: o.onAC !== false })
    const ramTotalMB = o.ramTotalMB || Math.floor(os.totalmem() / 1048576)
    const calisan = [...this.calisan.entries()]
    // seq her bildirimde artar ve yeniden başlamada geri gitmez (telefon eski sırayı reddeder)
    this.seq = Math.max(this.seq + 1, this.now())
    return {
      nodeId: this.me.memberId,
      class: 'isci',
      seq: this.seq,
      os: o.os || 'linux',
      arch: o.arch || os.arch(),
      cpuModel: o.cpuModel || '',
      cores: o.cores || os.cpus().length,
      ramTotalMB,
      ramFreeMB: Math.floor(os.freemem() / 1048576),
      diskTotalGB: o.diskTotalGB || 0,
      diskFreeGB: o.diskFreeGB || 0,
      accel: o.accel || [],
      battery: o.battery || null,
      tempC: cpuC ?? (o.tempC || 0),
      uptimeSec: Math.floor(os.uptime()),
      load1x100: Math.round(os.loadavg()[0] * 100),
      tpm: false,
      tasks: o.tasks || [],
      maxTaskRamMB: maxTaskRam({ ramTotalMB, runningRamMB: calisan.map(([, k]) => k.ramMB) }),
      storage: o.storage || { holdGB: 0, blobGB: 0 },
      status: this._durum,
      running: calisan.map(([id, k]) => ({ taskId: b4a.from(id, 'hex'), type: k.type, pct: k.pct || 0 }))
    }
  }

  // Denetçinin yeni SAGLIK_ANLIK'i (güç değişti; RFC-0012 §10, inceleme 22 madde 2): ölçümler güncellenir; durum
  // (hazir → pil ya da geri) değiştiyse NODE_CAPS hemen yayılır, pille çalışan işçi yeni görev almaz (RFC-0002 §4).
  // Dönüş: durum değişti mi
  olcumGuncelle (olcum) {
    const { yetenek: { durumHesapla } } = require('@havenfold/tasks')
    const once = durumHesapla({ onAC: this.olcum.onAC !== false })
    this.olcum = olcum || {}
    const sonra = durumHesapla({ onAC: this.olcum.onAC !== false })
    if (once === sonra) return false
    this.capsYay()
    return true
  }

  // Bildirim: bağlı üyelere (kutu dahil; RFC-0002 §4 "Kime gider"); işçinin kendi denetimi de güncel alanlarla
  capsYay (yalniz = null) {
    const { kodlama: K, yetenek: { capsAlicisiMi } } = require('@havenfold/tasks')
    const { zarf: { Z } } = require('@havenfold/core')
    if (!this.hazir) return
    const caps = this.caps()
    this.isci.setCaps(caps)
    const bytes = K.encodeNodeCaps(this.L.familyId, caps, this.me)
    for (const p of yalniz ? [yalniz] : this.bagli) if (capsAlicisiMi(this.L, this.meHex, p)) this.ag.gonder(p, Z.NODE_CAPS, bytes)
  }

  baglandi (p) {
    const { zarf: { Z } } = require('@havenfold/core')
    this.bagli.add(p)
    this.capsYay(p)
    this._kurtarmaGonder(p)
    // Bekleyen sonuçlar isteyen bağlanınca (RFC-0002 §6.3)
    for (const x of this.sonuclar.bekleyenler(b4a.from(p, 'hex'))) {
      if (this.ag.gonder(p, Z.TASK_RESULT, x.bytes)) this.sonuclar.teslimEdildi(x.taskId)
    }
  }

  // Ağdan gelen her zarf: giris.gelenZarf (oturum süzgeci, yol, kanonik çözme), sonra türüne göre
  al (peerHex, type, bytes, yol) {
    const { giris, zarf: { Z } } = require('@havenfold/core')
    if (!this.hazir) return
    // Uç akışı zarfları IsciAkisAlici'ye (kendisi giris.gelenZarf'tan geçirir)
    if (this.ucAkis && (type === Z.UC_STREAM_ACCEPT || type === Z.UC_STREAM_CLOSE || type === Z.UC_CONFIG)) {
      try {
        if (type === Z.UC_CONFIG) this.ucAkis.yapilandirmaAl(peerHex, bytes, yol)
        else if (type === Z.UC_STREAM_CLOSE) this.ucAkis.kapatAl(peerHex, bytes, yol)
        else this.ucAkis.kabulAl(peerHex, bytes, yol).catch(() => {})
      } catch {}
      return
    }
    let mesaj
    try {
      mesaj = giris.gelenZarf({ myRole: 'cihaz', peerRole: this.L.sessionRole(peerHex), type, bytes, L: this.L, gonderen: peerHex, yol }).mesaj
    } catch { return }
    if (type === Z.NODE_RECOVERY) return this._kurtarmaAlindi(peerHex, mesaj)
    if (type === Z.TASK) return this._gorevAl(peerHex, bytes)
    if (type === Z.TASK_CANCEL) return this._iptal(bytes)
    if (type === Z.BLOB_DATA) return this._parca(peerHex, bytes)
  }

  _gorevAl (peerHex, bytes) {
    const isci = this.isci
    const once = [...isci.seen.keys()].join()
    const r = isci.al(bytes, { from: peerHex })
    if ([...isci.seen.keys()].join() !== once) this._gorulenYaz() // görev madde 2'yi geçti: yeniden başlamada TEKRAR
    this.ag.gonder(peerHex, r.type, r.bytes)
    if (!r.ok) return
    this._calistir(peerHex, r.task).catch(() => {})
  }

  // NODE_RECOVERY (RFC-0007 §8.5 adım 4, §13.6): kurtarma anahtarı yalnız töreni yapan ebeveyne, yalnız doğrudan
  // oturumda; alındı gelene kadar her bağlanışında yeniden. Okuma hatası (ör. NO_PERMISSION) sessizdir: anahtar dosyada
  // bekler, kartta "teslim edilmedi" uyarısı denetçinin işidir.
  async _kurtarmaGonder (p) {
    if (this._kurtarmaBitti || this._kurtarmaSuruyor || !this.hazir) return
    const { kurtarma: R, zarf: { Z } } = require('@havenfold/core')
    if (!R.torenEbeveyni(this.L, this.meHex).includes(p)) return
    this._kurtarmaSuruyor = true
    let anahtar = null
    try {
      anahtar = await this.kurtarma.oku()
      if (!anahtar) { this._kurtarmaBitti = true; return }
      if (!this.bagli.has(p)) return
      this.ag.gonder(p, Z.NODE_RECOVERY, R.encodeNodeRecovery(this.L.familyId, { nodeId: this.me.memberId, kind: 'luks-kurtarma', secret: anahtar }, this.me))
    } catch {} finally {
      if (anahtar) sodium.sodium_memzero(anahtar)
      this._kurtarmaSuruyor = false
    }
  }

  // Telefonun alındısı: imzacı gönderenin kendisi, töreni yapan ebeveyn ve nodeId bu düğüm olmalı; sonra dosya silinir
  async _kurtarmaAlindi (peerHex, d) {
    const { kurtarma: R } = require('@havenfold/core')
    if (this._kurtarmaBitti || d.m.kind !== 'alindi' || hex(d.m.nodeId) !== this.meHex) return
    if (!R.torenEbeveyni(this.L, this.meHex).includes(peerHex)) return
    const u = this.L.members.get(peerHex)
    if (!u || !R.verifyNodeRecovery(this.L.familyId, d, u.signPub)) return
    try {
      await this.kurtarma.sil()
      this._kurtarmaBitti = true
    } catch {} // silinemezse sonraki bağlanışta anahtar yeniden gider, telefon yeniden alındı verir
  }

  // Denetçinin GOREV_ILERLEME bildirimi (RFC-0007 §6.3 tür 6): çalışan görevin isteyenine TASK_PROGRESS
  ilerleme ({ taskId, pct, note }) {
    const k = this.calisan.get(hex(taskId))
    if (!k) return
    k.pct = Math.min(100, pct)
    this._ilerlet(taskId, k, note)
  }

  // En çok 10 saniyede bir (§6.3; teslim.IlerlemeSiniri)
  _ilerlet (taskId, k, note) {
    const { kodlama: K } = require('@havenfold/tasks')
    const { zarf: { Z } } = require('@havenfold/core')
    if (!this.ilerlemeSiniri.gonderilsinMi(taskId)) return
    try { this.ag.gonder(k.requester, Z.TASK_PROGRESS, K.encodeProgress({ taskId, pct: k.pct, note: String(note || '').slice(0, 200) })) } catch {}
  }

  _iptal (bytes) {
    let t
    try { t = this.isci.iptal(bytes) } catch { return }
    this.istemci.gonder(IPC.TASK_CANCEL, { taskId: t.taskId })
  }

  _parca (peerHex, bytes) {
    let durum
    try { durum = this.blob.receive(peerHex, bytes) } catch { return }
    if (durum !== 'tamam') return
    const { dosya: D } = require('@havenfold/records')
    const id = hex(D.decodeBlobData(bytes).blobId)
    const b = this.bekleyenGirdi.get(id)
    if (!b) return
    this.bekleyenGirdi.delete(id)
    const kayit = this.blob.blobs.get(id)
    this.blob.blobs.delete(id) // işçi dosyayı tutmaz
    b.resolve(kayit.chunks)
  }

  // Girdi isteyenden (RFC-0002 §6.1): BLOB_REQ, bütün parçalar gelince blobId ve fileKey ile çözülür
  _girdiCek (peerHex, inp) {
    const { dosya: D } = require('@havenfold/records')
    const { zarf: { Z } } = require('@havenfold/core')
    const id = hex(inp.blobId)
    return new Promise((resolve, reject) => {
      const z = setTimeout(() => { this.bekleyenGirdi.delete(id); reject(new Error('INPUT_FETCH_FAILED')) }, GIRDI_MS)
      this.bekleyenGirdi.set(id, { resolve: (parcalar) => { clearTimeout(z); resolve(parcalar) }, reject })
      if (!this.ag.gonder(peerHex, Z.BLOB_REQ, c.encode(D.blobReq, { blobId: inp.blobId, from: 0, count: D.totalOf(inp.size) }))) {
        clearTimeout(z)
        this.bekleyenGirdi.delete(id)
        reject(new Error('INPUT_FETCH_FAILED'))
      }
    }).then((parcalar) => D.decryptBlob({ blobId: inp.blobId, fileKey: inp.fileKey, size: inp.size }, parcalar))
  }

  async _calistir (peerHex, t) {
    const { kodlama: K, teslim: { ciktiHazirla, logKirp } } = require('@havenfold/tasks')
    const { zarf: { Z } } = require('@havenfold/core')
    const { dosya: D } = require('@havenfold/records')
    const id = hex(t.taskId)
    const k = { type: t.type, ramMB: t.limits.ramMB, requester: hex(t.requester), pct: 0 }
    this.calisan.set(id, k)
    this._ilerlet(t.taskId, k, 'basladi')
    this.capsYay()
    let sonuc = { taskId: t.taskId, status: 'hata', outputs: [], inline: b4a.alloc(0), log: '' }
    const bloblar = []
    try {
      const girdiler = []
      for (const inp of t.inputs) girdiler.push({ mime: inp.mime, bytes: await this._girdiCek(peerHex, inp) })
      const r = await gorevYurut(this.istemci, { taskId: t.taskId, type: t.type, version: t.version, limits: t.limits, standing: t.standing, params: t.params, girdiler }, { kok: this.kok, akis: this.ucAkis })
      if (!r.ok) sonuc.log = r.code
      else {
        sonuc = { ...sonuc, status: r.status, log: logKirp(r.log || '') }
        if (r.status === 'ok') {
          // Tek ve küçük çıktı satır içi; değilse her dosya yeni anahtarla şifreli dosya (BLOB_DATA isteyene)
          const tek = r.ciktilar.length === 1 ? ciktiHazirla(r.ciktilar[0].bytes, { mime: MIME[path.extname(r.ciktilar[0].ad)] || 'application/octet-stream' }) : null
          if (tek && !tek.blob) sonuc.inline = tek.inline
          else {
            for (const x of r.ciktilar) {
              const blob = D.encryptBlob(x.bytes)
              bloblar.push(blob)
              sonuc.outputs.push({ blobId: blob.blobId, fileKey: blob.fileKey, size: blob.size, mime: MIME[path.extname(x.ad)] || 'application/octet-stream' })
            }
          }
        }
      }
    } catch (err) {
      sonuc.log = /^[A-Z_]+$/.test(err.message) ? err.message : 'INTERNAL_ERROR'
    } finally {
      this.isci.bitir(id) // girdilerin dosya anahtarları sıfırlanır (§11.1)
      this.calisan.delete(id)
      this.ilerlemeSiniri.unut(t.taskId)
    }
    const istek = hex(t.requester)
    for (const blob of bloblar) for (const m of D.uploadMsgs(blob)) this.ag.gonder(istek, Z.BLOB_DATA, m)
    const bytes = K.encodeResult(sonuc)
    for (const o of sonuc.outputs) sodium.sodium_memzero(o.fileKey)
    if (!this.ag.gonder(istek, Z.TASK_RESULT, bytes)) this.sonuclar.ekle(t.taskId, t.requester, bytes)
    this.capsYay()
  }
}

function ayarlar (env = process.env, secenek = {}) {
  require('./test-env').testOrtamiDenetle(env, { adlar: ['HF_KOK', 'HF_TEST_KIPI', 'HF_ONYUKLEME'], ...secenek }) // üretimde reddedilir
  const kok = env.HF_KOK || '/'
  return {
    kok,
    dizin: path.join(kok, 'var/lib/havenfold/isci'),
    gorulen: path.join(kok, 'var/lib/havenfold/isci/gorev-kayit/gorulen.json'), // görülen taskId'ler (RFC-0002 §6.2 madde 8)
    soket: path.join(kok, 'run/havenfold/denetci/isci.sock'),
    yonetim: path.join(kok, YONETIM_SOKETI.isci),
    ad: env.HF_ISCI_ADI || 'Ev işçisi',
    test: env.HF_TEST_KIPI === '1', // yalnız test: taklit TPM, anahtarı dizinde
    onyukleme: env.HF_ONYUKLEME ? JSON.parse(env.HF_ONYUKLEME) : null, // yalnız test: yerel testnet
    torenMs: Number(env.HF_TOREN_MS) || 10 * 60_000
  }
}

// Platform ve Arşiv anahtarları: `havenfold ilk-ayar` (node/setup.js) ve kutu çekirdeğiyle aynı düzen (box.js
// tpmAc, platformAnahtari, arsivAcik): <rol dizini>/platform.muhur, arsiv.muhur, kimlik <rol dizini>/cekirdek'te
// worklet kalıcı katmanında. TPM yoksa anahtarlar dosyada (0600; platform.anahtar, arsiv.anahtar) ve uyarı verilir;
// TPM'siz işçi kasa payı tutmaz (kurucu §9.2).
// Hangi yol (açılış öncesi inceleme): var olan anahtar dosyası belirler (platform.anahtar: TPM'siz, platform.muhur:
// TPM); ilk açılışta TPM aygıtı varsa TPM. TPM komutunun hatası (meşgul, kilit, bozuk mühür) "TPM yok" sayılmaz: aygıt
// varken şifresiz dosyaya düşülmez, hata yukarı çıkar; TPM'li kurulum TPM'siz dosyaya, TPM'siz kurulum yeni mühre geçmez.
const tpmAygitiVar = (kok = '/') => ['dev/tpmrm0', 'dev/tpm0'].some((d) => fs.existsSync(path.join(kok, d)))
function tpmsizMi (a, kok = '/') {
  if (fs.existsSync(path.join(a.dizin, 'platform.anahtar'))) return true
  if (fs.existsSync(path.join(a.dizin, 'platform.muhur'))) return false
  return !a.test && !tpmAygitiVar(kok)
}
function anahtarlariAc (a) {
  const K = require('./box')
  if (!tpmsizMi(a, a.kok)) {
    const { tpm, tur } = K.tpmAc(a)
    return { anahtar: K.platformAnahtari(a, tpm), archivePubHex: K.arsivAcik(a, tpm), tpm: tur, uyari: null }
  }
  return { ...tpmsizAnahtarlar(a), tpm: 'yok', uyari: 'TPM yok: işçinin anahtarları diskte, şifresiz dosyada' }
}

// TPM'siz işçinin platform anahtarı ve Arşiv açık anahtarı: a.dizin'de dosya (yoksa üretilir). havenfold ilk-ayar da
// aynı yolu kullanır (setup.js kimlikAgacta), işçi açılınca aynı anahtarları bulur. yaz/oku: kök olarak çalışan
// ilk-ayar kendi güvenli yazma ve okumasını verir (O_EXCL | O_NOFOLLOW, bağ izlemez)
function tpmsizAnahtarlar (a, { yaz = (y, v) => require('./box').atomikYaz(y, v), oku = (y) => fs.readFileSync(y) } = {}) {
  const dosya = (ad, uret) => {
    const yol = path.join(a.dizin, ad)
    if (!fs.existsSync(yol)) yaz(yol, uret())
    return oku(yol)
  }
  const anahtar = dosya('platform.anahtar', () => { const k = b4a.alloc(32); sodium.randombytes_buf(k); return k })
  const sk = dosya('arsiv.anahtar', () => { const pk = b4a.alloc(32); const k = b4a.alloc(32); sodium.crypto_box_keypair(pk, k); return k })
  const pub = b4a.alloc(32)
  sodium.crypto_scalarmult_base(pub, sk)
  sodium.sodium_memzero(sk)
  return { anahtar, archivePubHex: hex(pub) }
}

// LUKS kurtarma anahtarı denetçi üzerinden (RFC-0007 §6.3 tür 22; denetçi yetki yardımcısının luks-kurtarma işlemini
// çağırır). Denetçi HATA dönerse (ör. NO_PERMISSION) istek düşer; IsciAgi bunu sessizce bekletir.
function kurtarmaKancasi (istemci) {
  const sor = async (istek) => {
    const r = await istemci.istek(IPC.RECOVERY_KEY, { istek })
    if (r.type !== IPC.RECOVERY_KEY) fail('INVALID_REPLY')
    return r.mesaj
  }
  return {
    oku: async () => { const m = await sor('oku'); return m.var && m.anahtar && m.anahtar.byteLength === 32 ? m.anahtar : null },
    sil: async () => (await sor('sil')).var
  }
}

// İlk ayarın işareti (<rol dizini>/kimlik: { v, rol, memberId, tpm }) varsa kalıcı katmanın kimliğiyle aynı olmalı:
// işçi ikinci bir kimlik üretmez
function isaretOku (a) {
  const yol = path.join(a.dizin, 'kimlik')
  if (!fs.existsSync(yol)) return null
  let x
  try { x = JSON.parse(fs.readFileSync(yol, 'utf8')) } catch { fail('IDENTITY_MARKER_CORRUPT') }
  if (!x || x.rol !== 'isci' || typeof x.memberId !== 'string') fail('IDENTITY_MARKER_CORRUPT')
  return x
}

// İşçi çekirdeği: denetçiye MERHABA (ardından SAGLIK_ANLIK), sonra kutu çekirdeğiyle aynı yığın (node/box.js): worklet
// kalıcı katmanı (kimlik, defter, tören anahtarları; durum platform anahtarıyla şifreli), eşitleyici (defter
// eşitlemesi, RFC-0003 §6.1 üye ↔ cihaz), taşıyıcı (cihazlar: true; işçi dinler), tören (isciDavet), yönetim soketi
// (`havenfold durum`, `havenfold katil --rol isci`). Görev zarfları ağ kancasında IsciAgi'ye ayrılır.
// ag: false ise yalnız denetçi bağlantısı (testler).
// İşçinin HELLO yetenek bitleri. UZAKTAN_IPTAL (D106): işçi telefonla aynı defter kodunu çalıştırır, REVOKE'u bilir;
// bildirmezse telefon bekleyen uzaktan üyenin davetini işçili ailede hiç iptal edemez (UPDATE_PENDING; Codex 12. tur)
function isciCaps (CAPS) { return CAPS.LEDGER_V21 | CAPS.GOREV | CAPS.UZAKTAN_IPTAL }

async function isciyiBaslat (a = ayarlar(), { bildirim = () => {}, ag = true, bekleMs } = {}) {
  let olcum = null
  let olcumGeldi
  const ref = { isciAgi: null, ucAkis: null } // denetçi bildirimleri ağ tarafı kurulmadan da gelebilir
  const olcumSozu = new Promise((resolve) => { olcumGeldi = resolve })
  const istemci = new DenetciIstemcisi({
    soket: a.soket,
    rol: 'isci',
    surum: require('./package.json').version,
    bekleMs, // yoksa varsayılan (30 sn); test denetçisiz açılışı beklemeden sınar
    bildirim: (m) => {
      if (m.type === IPC.SAGLIK_ANLIK) {
        try { olcum = JSON.parse(b4a.toString(m.mesaj.caps)) } catch {}
        olcumGeldi()
        if (ref.isciAgi && olcum) ref.isciAgi.olcumGuncelle(olcum) // güç değişince yeniden gelir (D85, inceleme 22 madde 2)
      }
      if (m.type === IPC.GOREV_ILERLEME && ref.isciAgi) ref.isciAgi.ilerleme(m.mesaj)
      if ((m.type === IPC.AKIS_KAPAT || m.type === IPC.ANAHTAR_KARE_ISTE) && ref.ucAkis) ref.ucAkis.denetcidenAl(m)
      bildirim(m)
    }
  })
  await istemci.baglan()
  const m = await istemci.merhaba()
  const k = { a, istemci, hostId: hex(m.hostId), denetciSurum: m.denetciSurum, w: null, toren: null }
  k.kapat = async () => { istemci.kapat() }
  if (!ag) return k
  await Promise.race([olcumSozu, new Promise((resolve) => setTimeout(resolve, 5000).unref())])

  const K = require('./box')
  const os = require('os')
  const isaret = isaretOku(a) // ağ açılmadan
  for (const d of [a.dizin, path.join(a.dizin, 'cekirdek'), path.join(a.dizin, 'pay')]) fs.mkdirSync(d, { recursive: true, mode: 0o700 })
  const pa = anahtarlariAc(a)
  const { start: baslat } = require('../worklet')
  const { DhtTasiyici, dhtTorenTasiyici, dhtAc } = require('@havenfold/transport')
  const { hello: { CAPS }, zarf: { Z } } = require('@havenfold/core')
  const dht = dhtAc(a.onyukleme ? { bootstrap: a.onyukleme, firewalled: false } : {})
  let w = null
  const cihaz = () => (w ? w.tasiyiciCihazi({ ad: a.ad, cihazAdi: os.hostname() }) : null)
  let isciAgi = null
  // Ailedeyken yalnız aktif işçi kimliğiyle buluşur; tören öncesi taşıyıcı boş kalır
  const isciOlarak = () => { const d = cihaz(); return d && d.ledger && isciAgi && isciAgi.hazir ? d : null }
  const zaman = a.test ? { yoklamaMs: 500, hizliMs: 500 } : {}
  const dt = new DhtTasiyici({ dht, cihaz: isciOlarak, deneysel: true, cihazlar: true, caps: isciCaps(CAPS), ...zaman })
  const toren = dhtTorenTasiyici({ dht, cihaz, tamam: () => dt.yokla(), deneysel: true })
  // Afet modu (RFC-0012 §10; D90): yakındakiler yalnız bu işçi kimliğinin kendi yerel ağ oturumlarından (H4)
  const afetler = isciAfetleri({ a, wOf: () => w, gonder: (p, type, bytes) => dt.gonder(p, type, bytes) })
  // Ağ kancası: görev zarfları ve beklenen girdi parçaları işçiye, gerisi (defter, dosya) eşitleyiciye
  const agKancasi = {
    gonder: (p, type, bytes) => dt.gonder(p, type, bytes),
    dinle: (isl) => dt.ag.dinle({
      baglandi: (p, x) => { isl.baglandi(p, x); if (isciAgi) isciAgi.baglandi(p); if (x && x.yerel) afetler.yakin.gordu(p, 'yerel') },
      koptu: (p) => { isl.koptu(p); if (isciAgi) isciAgi.koptu(p) },
      al: (p, type, bytes, yol) => (isciAgi && isciAgi.ister(type, bytes) ? isciAgi.al(p, type, bytes, yol) : isl.al(p, type, bytes, yol))
    })
  }
  w = await baslat({ urunSunucusu: K.kutuSunucusu, dizin: path.join(a.dizin, 'cekirdek'), anahtar: pa.anahtar, archivePubHex: pa.archivePubHex, ipc: K.bosKanal(), appId: 'havenfold-isci', platform: 'isci', torenTasiyici: toren, ag: agKancasi })
  sodium.sodium_memzero(pa.anahtar)
  if (isaret && isaret.memberId !== hex(w.kalici.kimlik.memberId)) { w.kapat(); await dht.destroy(); fail('IDENTITY_MISMATCH') }
  // Uç akışı (RFC-0008 §11.5; inceleme 23 madde 4): çift sırrı tören anahtarıyla (açıklama 1 madde 7). Sırasız kanal
  // (kareler ve denetim izi) taşıyıcıda henüz yok: cerceveGonder false döner (İstek 168)
  const { IsciAkisAlici } = require('./edge/worker-stream')
  const { pairs: { PairBook } } = require('@havenfold/core')
  const ucAkis = new IsciAkisAlici({
    ledger: () => w.kalici.nesneler.ledger,
    me: w.kalici.kimlik,
    ciftSirri: (p) => { const d = cihaz(); return d && d.ledger ? new PairBook({ me: w.kalici.kimlik, ledger: d.ledger, ceremonyKeys: d.torenAnahtarlari instanceof Map ? d.torenAnahtarlari : new Map() }).get(p)?.pair || null : null },
    gonder: (p, type, bytes) => dt.gonder(p, type, bytes),
    denetci: istemci
  })
  ref.ucAkis = ucAkis
  isciAgi = new IsciAgi({ defter: () => (w.kalici.nesneler.aile ? w.kalici.nesneler.ledger : null), me: w.kalici.kimlik, ag: { gonder: (p, type, bytes) => dt.gonder(p, type, bytes) }, istemci, kok: a.kok, olcum: olcum || {}, gorulenDosyasi: a.gorulen, kurtarma: kurtarmaKancasi(istemci), ucAkis })
  ref.isciAgi = isciAgi
  isciAgi.baslat()
  dt.baslat()
  Object.assign(k, { w, dt, dht, isciAgi, tpmTur: pa.tpm, uyari: pa.uyari, Z })
  k.a.soket = a.yonetim // box.js yonetimSoketi k.a.soket'i dinler
  k.davet = () => toren.isciDavet({ oturumla: true })
  k.durum = () => isciDurumu(k)
  k.sunucu = await K.yonetimSoketi(k)
  k.afet = afetler
  k.kapat = async () => {
    try { k.sunucu.close() } catch {}
    try { if (k.toren) k.toren.oturum.cancel() } catch {}
    afetler.kapat()
    isciAgi.kapat()
    await dt.kapat()
    w.kapat()
    await dht.destroy()
    istemci.kapat()
  }
  return k
}

// `havenfold durum` (command.js durumMetni alanları)
function isciDurumu (k) {
  const n = k.w.kalici.nesneler
  const L = n.aile ? n.ledger : null
  const oturum = [...k.dt.oturumlar.values()].filter((o) => o.dogrulandi).length
  return {
    id: hex(k.w.kalici.kimlik.memberId),
    bagli: k.isciAgi.hazir,
    duzey: L ? String(L.level || '—') : null,
    defterUzunlugu: L ? L.len : 0,
    oturum,
    aile: L ? { ad: L.familyName || '' } : null,
    gorevler: [...k.isciAgi.calisan.values()].map((x) => x.type),
    turler: k.isciAgi.caps().tasks.map((t) => t.type + '@' + t.version),
    tpm: k.tpmTur,
    surum: require('./package.json').version,
    uyarilar: k.uyari ? [k.uyari] : []
  }
}

// Giriş (cekirdek/isci.js): DURDUR ya da denetçi bağlantısının kopması süreci bitirir; systemd yeniden başlatır.
// HF_TEST_KIPI=1: ana süreç ölünce (stdin kapanır) işçi de kapanır, sahipsiz süreç kalmaz (box.js'teki D75 gibi).
function ana () {
  let k = null
  const bitir = (kod) => { Promise.resolve(k && k.kapat()).catch(() => {}).finally(() => process.exit(kod)) }
  isciyiBaslat(ayarlar(), {
    bildirim: (m) => {
      if (m.type === IPC.DURDUR) { console.log('havenfold-isci: durduruluyor (' + m.mesaj.neden + ')'); bitir(0) }
      if (m.type === 'kapandi') { console.error('havenfold-isci: denetçi bağlantısı koptu'); bitir(1) }
    }
  }).then((x) => {
    k = x
    const d = x.durum()
    if (x.uyari) console.error('havenfold-isci: uyarı: ' + x.uyari)
    console.log('havenfold-isci: başladı · kimlik ' + d.id.slice(0, 8) + ' · ailede ' + (d.bagli ? 'evet' : 'hayır (havenfold katil --rol isci)') + ' · TPM ' + d.tpm + ' · türler ' + (d.turler.join(', ') || 'yok'))
    process.once('SIGTERM', () => bitir(0))
    process.once('SIGINT', () => bitir(0))
    if (x.a.test) { process.stdin.on('end', () => bitir(0)); process.stdin.on('close', () => bitir(0)); process.stdin.resume() }
  }, (err) => {
    console.error('havenfold-isci: başlatılamadı: ' + (err && err.message))
    process.exit(1)
  })
}

const ENTRY_POINTS = ['IsciAgi.al']

module.exports = { isciCaps, tpmsizAnahtarlar, tpmsizMi, isciAfetleri, depremEsigi, DenetciIstemcisi, IsciAgi, gorevYurut, isciyiBaslat, ayarlar, isciDurumu, ana, ENTRY_POINTS }
