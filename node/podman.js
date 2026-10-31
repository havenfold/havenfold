// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// podman.js — denetçinin görev çalıştırıcısı: kök olmayan Podman konteyneri (RFC-0002 §11.1, RFC-0007 §4.1, §5, §12.1)
//
// Denetçinin kancalarını gerçekler (node/supervisor.js: kaynakVar, calistir, iptal). Podman denetçinin kendi kullanıcısıyla
// çalışmaz: havenfold-task kullanıcısının podman.socket'ine istemci olarak bağlanılır (`podman --remote --url …`,
// RFC-0007 §4.3 "Denetçinin kullandığı Podman API'si"); konteyner havenfold-task'ın kullanıcı ad alanındadır.
//
// Konteynerin ayarları (RFC-0002 §11.1): ağ yok, kök salt okunur, /in salt okunur, /out ayrı, /work tmpfs
// (limits.diskMB, en çok RAM'in yarısı), --memory = limits.ramMB, --cpus = çekirdeklerin %75'i, --pids-limit=256,
// süre limits.minutes, --cap-drop=all, no-new-privileges, varsayılan seccomp, imaj @sha256: özetiyle.
// RFC'de olmayıp burada verilen kararlar (raporda da):
//   - --memory-swap = --memory: takas sınırın üstüne çıkmasın (Podman'ın varsayılanı belleğin iki katı).
//   - --userns=keep-id ve ek grupların korunması: süreç konteynerin kökü değil havenfold-task kimliğiyle çalışır;
//     görev dizinine (2770, grup havenfold-gorev) grup üyeliğiyle erişir. crun ister. Uzak istemci (--remote)
//     --group-add=keep-groups'u reddeder ("not supported in remote mode", çıkış 125; CI'daki imaj denemesi buldu):
//     aynı şey crun'un run.oci.keep_original_groups=1 açıklamasıyla (annotation) verilir.
//   - --log-driver=none: çıktı Podman'ın günlük deposuna yazılmaz (RFC-0007 §5: günlüğe içerik yazılmaz); istemci
//     çıktıyı yalnız bağlı akıştan alır, son 4 KB'ı GOREV_BITTI.log olur.
//   - --umask=0027, --pull=never (imaj yalnız doğrulanmış arşivden yüklenir), --hostname=hf-gorev.
//   - /work ve bağlanan dizinlerde nosuid, nodev, noexec.
//   - --timeout: Podman'ın kendi süre sınırı yedek olarak (limits.minutes + 30 sn); asıl süre bu modülün sayacıdır.
//   - Taşma dizini (/var/lib/havenfold/tasma/, RFC-0007 §5) tmpfiles'ta ve denetçinin yazılabilir yollarında yok:
//     RAM'in yarısına sığmayan görev NO_SOURCE.
//   - hf.task.backup yerleşiktir (RFC-0002 §11.2): konteynerde çalışmaz, BUILTIN_TASK.
//   - hf.task.vision (RFC-0008 §11.5 madde 3–6; inceleme 23 madde 1–3): ağ ad alanını kök yardımcı değil, görev
//     kullanıcısının (havenfold-task) rootless Podman'ı kurar: pod hf-<taskId>, --network=none (yalnız lo). Akış sunucusu
//     (havenfold-rtsp; bu sürümde benzetim imajı) aynı pod'da ayrı, sertleştirilmiş bir konteynerdir (salt okunur, bütün
//     yetkiler düşük, no-new-privileges, ağ yok, sınırlı bellek); kareleri görev dizinindeki akis/akis.sock'tan alır,
//     yalnız 127.0.0.1:8554'ü dinler. Görev konteyneri pod'a katılır (--pod=hf-<taskId>). Böylece ad alanı görev
//     kullanıcısının kendi kullanıcı ad alanındadır (setns EPERM yok) ve akış sunucusu denetçi yetkisiyle çalışmaz.
//     Kaynağı (sourceId) olmayan görüntü görevi INVALID_SOURCE. IP kamera kaynağı (KAYNAK_AG, kamera-ag) bu sürümde yok.
//
// Giriş ve çıkış sözleşmesi (images/<tür>/CONTRACT.md): /in/params (TASK.params baytları), /in/girdiler.json,
// /in/0, /in/1, … (çekirdek yazar); /out/ türün dosyaları; çıkış kodu 0 tamam.
//
// İmajlar (RFC-0007 §12.1 "Görev imajı bütünlüğü"): imajYukle arşivin özetini bildirimdeki değerle denetler, podman load
// ile yükler, yüklenen imajın özetinin ociDigest olduğunu denetler ve imajlar.json'a yazar. imajBul yalnız bu kayıttan
// döner; kayıtta olmayan imaj çalıştırılmaz (T10).
const { spawn } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const b4a = require('b4a')
const { yetenek: { maxTaskRam, surumUyar } } = require('@havenfold/tasks')
const S = require('./release')

function fail (code) { throw new Error(code) }

const LOG_MAX = 4096
const PIDS = 256
const CPU_ORANI = 0.75
const SURE_PAYI_SN = 30
const KOMUT_MS = 120_000 // kill, rm, load, inspect
const OLDUR_BEKLE_MS = 30_000 // kill'den sonra istemci kapanmazsa
const ID_RE = /^[0-9a-f]{32}$/
const OZET_RE = /^sha256:[0-9a-f]{64}$/
const IMAJ_RE = /^[a-z0-9][a-z0-9._/:-]*@sha256:[0-9a-f]{64}$/
const AD_RE = /^[a-z0-9][a-z0-9._/-]*$/
const YERLESIK = new Set(['hf.task.backup'])
const AGLI = new Set(['hf.task.vision'])
const kapAdi = (id) => 'hf-gorev-' + id
const podAdi = (id) => 'hf-' + id
const sunucuAdi = (id) => 'hf-rtsp-' + id
const RTSP_TURU = 'havenfold-rtsp' // imajlar.json'da görev imajları gibi doğrulanmış kayıt (sürüm: 'benzetim' ya da gerçek)
const RTSP_RAM_MB = 64

// UTF-8'de son n bayt; karakter bölünmez (hata iletisi çıktının sonundadır)
function sonuKes (s, n = LOG_MAX) {
  if (b4a.byteLength(s) <= n) return s
  const ch = [...s]
  let boy = 0
  let i = ch.length
  while (i > 0 && boy + b4a.byteLength(ch[i - 1]) <= n) boy += b4a.byteLength(ch[--i])
  return ch.slice(i).join('')
}

function tamsayi (x, alt = 0) { return Number.isSafeInteger(x) && x >= alt }

// RFC-0002 §5 tablosu: bölünebilir türler ve sürekli tür (NODE_CAPS.tasks)
const BOLUNUR = new Set(['hf.task.ocr', 'hf.task.transcribe', 'hf.task.embed'])
const SUREKLI = new Set(['hf.task.vision'])

// Kayıt: <kok>/var/lib/havenfold/denetci/imajlar.json — { "<tür>@<sürüm>": { ref: "<ad>@sha256:…", ramMB } }
function kayitYolu (kok) { return path.join(kok, 'var/lib/havenfold/denetci/imajlar.json') }
function kayitOku (kok) {
  try { return JSON.parse(fs.readFileSync(kayitYolu(kok), 'utf8')) } catch (err) { if (err.code === 'ENOENT') return {}; fail('IMAGE_RECORD_CORRUPT') }
}

// İşçinin istediği sürüme uyan en yüksek kayıtlı imaj (MAJOR aynı, MINOR ≥ istenen; RFC-0002 §5)
function imajBul (kok) {
  return (type, version) => {
    let en = null
    for (const [k, kayit] of Object.entries(kayitOku(kok))) {
      const ref = kayit && kayit.ref
      const i = k.lastIndexOf('@')
      const t = k.slice(0, i)
      const v = k.slice(i + 1)
      if (t !== type || !surumUyar(v, version) || !IMAJ_RE.test(ref)) continue
      const sira = v.split('.').map(Number)
      if (!en || sira[1] > en.sira[1] || (sira[1] === en.sira[1] && sira[2] > en.sira[2])) en = { sira, ref }
    }
    return en ? en.ref : null
  }
}

// Kayıtlı imajlardan NODE_CAPS.tasks girdileri (denetçi SAGLIK_ANLIK ile işçiye verir; işçi imzalar)
function kayitliTurler (kok) {
  const out = []
  for (const [k, v] of Object.entries(kayitOku(kok))) {
    const i = k.lastIndexOf('@')
    const type = k.slice(0, i)
    if (!v || !IMAJ_RE.test(v.ref) || YERLESIK.has(type) || type === RTSP_TURU) continue // akış sunucusu görev türü değil
    out.push({ type, version: k.slice(i + 1), maxRamMB: tamsayi(v.ramMB) ? v.ramMB : 0, standing: SUREKLI.has(type), splittable: BOLUNUR.has(type) })
  }
  return out.sort((a, b) => (a.type + a.version < b.type + b.version ? -1 : 1))
}

class PodmanCalistirici {
  // podman: ikili (PATH'te ya da tam yol); url: havenfold-task'ın Podman API soketi (unix://…); kok: yolların öneki;
  // cekirdek, ramMB: makinenin (testte verilir); imajBul(type, version) → '<ad>@sha256:…' | null; dakikaMs: yalnız test
  constructor ({ podman = 'podman', url, kok = '/', cekirdek = os.cpus().length, ramMB = Math.floor(os.totalmem() / 1048576), imajBul: bul = null, dakikaMs = 60_000, ortam = process.env }) {
    if (typeof url !== 'string' || !/^unix:\/\/\//.test(url)) fail('INVALID_PODMAN_URL')
    this.podman = podman
    this.url = url
    this.kok = kok
    this.cekirdek = cekirdek
    this.ramMB = ramMB
    this.imajBul = bul || imajBul(kok)
    this.dakikaMs = dakikaMs
    this.ortam = ortam
    this.calisan = new Map() // taskIdHex → { cocuk, ramMB, neden, zaman }
  }

  // Denetçi kancaları (bağlı işlevler)
  kancalar () {
    return {
      kaynakVar: (l) => this.kaynakVar(l), calistir: (g) => this.calistir(g), iptal: (id) => this.iptal(id),
      akisPodKur: (o) => this.akisPodKur(o), akisPodSil: (id) => this.akisPodSil(id)
    }
  }

  // RAM: maxTaskRamMB (RFC-0002 §4) çalışanlar düşülerek; disk: /work tmpfs'i RAM'in yarısını aşamaz
  kaynakVar (limits) {
    if (!limits || !tamsayi(limits.ramMB, 1) || !tamsayi(limits.diskMB) || !tamsayi(limits.minutes, 1)) return false
    const bos = maxTaskRam({ ramTotalMB: this.ramMB, runningRamMB: [...this.calisan.values()].map((k) => k.ramMB) })
    return limits.ramMB <= bos && limits.diskMB <= Math.floor(this.ramMB / 2)
  }

  // g: { taskId (hex), dir (mutlak), type, version, limits }. Sonuç: { status, exitCode, log }
  argumanlar (g, imaj) {
    const { ramMB, diskMB, minutes } = g.limits
    const giris = path.join(g.dir, 'in')
    const cikis = path.join(g.dir, 'out')
    for (const p of [giris, cikis]) if (/[,:]/.test(p)) fail('INVALID_PATH') // birleştirme ayırıcıları
    const cpus = Math.max(0.01, Math.round(this.cekirdek * CPU_ORANI * 100) / 100)
    return [
      '--remote', '--url=' + this.url,
      'run', '--rm', '--name=' + kapAdi(g.taskId), '--pull=never',
      AGLI.has(g.type) ? '--pod=' + podAdi(g.taskId) : '--network=none',
      '--read-only', '--read-only-tmpfs=false',
      '--cap-drop=all', '--security-opt=no-new-privileges',
      '--userns=keep-id', '--annotation=run.oci.keep_original_groups=1',
      '--memory=' + ramMB + 'm', '--memory-swap=' + ramMB + 'm',
      '--cpus=' + cpus, '--pids-limit=' + PIDS,
      '--timeout=' + (minutes * 60 + SURE_PAYI_SN),
      '--umask=0027', '--log-driver=none', '--hostname=hf-gorev',
      '--tmpfs=/work:rw,nosuid,nodev,noexec,size=' + Math.max(1, diskMB) + 'm,mode=1777',
      '--volume=' + giris + ':/in:ro,nosuid,nodev,noexec',
      '--volume=' + cikis + ':/out:rw,nosuid,nodev,noexec',
      '--workdir=/work', '--env=HOME=/work', '--env=TMPDIR=/work',
      '--env=HF_GOREV_TUR=' + g.type, '--env=HF_GOREV_SURUM=' + g.version,
      imaj
    ]
  }

  async calistir (g) {
    const id = g && g.taskId
    if (typeof id !== 'string' || !ID_RE.test(id)) fail('INVALID_TASK')
    if (YERLESIK.has(g.type)) fail('BUILTIN_TASK')
    if (AGLI.has(g.type) && !(typeof g.sourceId === 'string' && ID_RE.test(g.sourceId))) fail('INVALID_SOURCE')
    if (this.calisan.has(id)) fail('REPLAY')
    if (!this.kaynakVar(g.limits)) fail('NO_SOURCE')
    const imaj = this.imajBul(g.type, g.version)
    if (typeof imaj !== 'string' || !IMAJ_RE.test(imaj)) fail('NO_IMAGE')
    const args = this.argumanlar(g, imaj)
    const k = { cocuk: null, ramMB: g.limits.ramMB, neden: null, zaman: null }
    this.calisan.set(id, k)
    let cikti = ''
    try {
      const kod = await new Promise((resolve, reject) => {
        const cocuk = spawn(this.podman, args, { stdio: ['ignore', 'pipe', 'pipe'], env: this.ortam })
        k.cocuk = cocuk
        const al = (p) => { cikti = sonuKes(cikti + p, LOG_MAX * 2) }
        cocuk.stdout.setEncoding('utf8') // parça sınırında bölünen çok baytlı karakter için
        cocuk.stderr.setEncoding('utf8')
        cocuk.stdout.on('data', al)
        cocuk.stderr.on('data', al)
        cocuk.once('error', (err) => reject(new Error(err.code === 'ENOENT' ? 'PODMAN_YOK' : 'PODMAN_ERROR')))
        cocuk.once('close', (code) => resolve(code === null ? -1 : code)) // sinyalle bitti: -1
        k.zaman = setTimeout(() => this._durdur(id, 'sure'), g.limits.minutes * this.dakikaMs)
      })
      const status = k.neden || (kod === 0 ? 'ok' : 'hata')
      return { status, exitCode: kod, log: sonuKes(cikti) }
    } finally {
      clearTimeout(k.zaman)
      clearTimeout(k.oldur)
      this.calisan.delete(id)
      // Durdurulan konteynerde --rm'in işi bitmemiş olabilir: kalıntı kaldırılır (GOREV_TEMIZLE, RFC-0007 §6.3)
      if (k.neden) await this._komut(['rm', '--force', '--ignore', kapAdi(id)]).catch(() => {})
    }
  }

  // TASK_CANCEL (RFC-0007 §6.3): konteyner öldürülür, sonuç 'iptal'
  iptal (taskIdHex) {
    if (typeof taskIdHex !== 'string' || !ID_RE.test(taskIdHex)) return
    this._durdur(taskIdHex, 'iptal')
  }

  _durdur (id, neden) {
    const k = this.calisan.get(id)
    if (!k || k.neden) return Promise.resolve()
    k.neden = neden
    // İstemci bağlı akışta kalırsa (API soketi koptu gibi) süreç de sonlandırılır
    k.oldur = setTimeout(() => { try { k.cocuk.kill('SIGKILL') } catch {} }, OLDUR_BEKLE_MS)
    return this._komut(['kill', '--signal=KILL', kapAdi(id)]).catch(() => {})
  }

  // Denetçi kapanırken çalışan her görev durdurulur; kill komutları bitene kadar beklenir (yoksa systemd denetçinin
  // denetim grubunu öldürürken istemci de ölür, konteyner havenfold-task'ın tarafında çalışmaya devam eder)
  kapat () { return Promise.all([...this.calisan.keys()].map((id) => this._durdur(id, 'iptal'))) }

  /**
   * Görüntü görevinin pod'u ve akış sunucusu (inceleme 23 madde 1–3). o: { taskId, sourceId (hex), dir (görev dizini) }.
   * Kurulamazsa yarım kalan pod silinir (madde 8). Dönüş: { pod, soket } (soket: denetçinin bağlanacağı akis.sock)
   */
  async akisPodKur ({ taskId, sourceId, dir }) {
    if (!ID_RE.test(taskId) || !ID_RE.test(sourceId)) fail('INVALID_TASK')
    const imaj = this.imajBul(RTSP_TURU, 'benzetim') || this.imajBul(RTSP_TURU, 'guncel')
    if (typeof imaj !== 'string' || !IMAJ_RE.test(imaj)) fail('NO_RTSP_IMAGE')
    const akis = path.join(dir, 'akis')
    if (/[,:]/.test(akis)) fail('INVALID_PATH')
    fs.mkdirSync(akis, { recursive: true })
    fs.chmodSync(akis, 0o2770)
    const adim = async (args) => { const r = await this._komut(args); if (r.kod !== 0) fail('POD_SETUP_FAILED') }
    try {
      await adim(['pod', 'create', '--name=' + podAdi(taskId), '--network=none', '--userns=keep-id', '--label=havenfold=akis'])
      await adim(this.sunucuArgumanlari({ taskId, sourceId, akis }, imaj))
    } catch (err) {
      await this.akisPodSil(taskId)
      throw err
    }
    return { pod: podAdi(taskId), soket: path.join(akis, 'akis.sock') }
  }

  sunucuArgumanlari ({ taskId, sourceId, akis }, imaj) {
    return [
      'run', '--detach', '--rm', '--pod=' + podAdi(taskId), '--name=' + sunucuAdi(taskId), '--pull=never',
      '--read-only', '--read-only-tmpfs=false', '--cap-drop=all', '--security-opt=no-new-privileges',
      '--memory=' + RTSP_RAM_MB + 'm', '--memory-swap=' + RTSP_RAM_MB + 'm', '--pids-limit=32', '--cpus=0.5',
      '--umask=0007', '--log-driver=none', '--hostname=hf-rtsp',
      '--volume=' + akis + ':/akis:rw,nosuid,nodev,noexec',
      imaj, '--soket', '/akis/akis.sock', '--kaynak', sourceId
    ]
  }

  async akisPodSil (taskId) {
    if (!ID_RE.test(taskId)) return
    await this._komut(['pod', 'rm', '--force', '--ignore', podAdi(taskId)]).catch(() => {})
  }

  /** Denetçi yeniden başlayınca: çalışan görevi olmayan akış pod'ları silinir (madde 8). Dönüş: silinenler */
  async akisPodlariSupur (yasayan = new Set()) {
    const r = await this._komut(['pod', 'ps', '--filter=label=havenfold=akis', '--format={{.Name}}']).catch(() => null)
    if (!r || r.kod !== 0) return []
    const silinen = []
    for (const ad of r.cikti.split('\n').map((x) => x.trim()).filter((x) => /^hf-[0-9a-f]{32}$/.test(x))) {
      if (yasayan.has(ad.slice(3))) continue
      await this.akisPodSil(ad.slice(3))
      silinen.push(ad)
    }
    return silinen
  }

  // Tek seferlik podman komutu (uzak). Dönüş: { kod, cikti }
  _komut (args, { ms = KOMUT_MS } = {}) {
    return new Promise((resolve, reject) => {
      const cocuk = spawn(this.podman, ['--remote', '--url=' + this.url, ...args], { stdio: ['ignore', 'pipe', 'pipe'], env: this.ortam })
      let out = ''
      let err = ''
      cocuk.stdout.on('data', (p) => { out += p })
      cocuk.stderr.on('data', (p) => { err = sonuKes(err + p, LOG_MAX) })
      const z = setTimeout(() => { try { cocuk.kill('SIGKILL') } catch {} }, ms)
      cocuk.once('error', (e) => { clearTimeout(z); reject(new Error(e.code === 'ENOENT' ? 'PODMAN_YOK' : 'PODMAN_ERROR')) })
      cocuk.once('close', (kod) => { clearTimeout(z); resolve({ kod, cikti: out, hata: err }) })
    })
  }

  // girdi: doğrulanmış RELEASE_MANIFEST'in images satırı (çağıran bildirimi bildirimCoz ile doğrulamıştır);
  // arsivYolu: indirilmiş oci-archive. Dönüş: kayda yazılan '<ad>@sha256:…'
  async imajYukle (girdi, arsivYolu) {
    if (!girdi || typeof girdi.type !== 'string' || !/^[a-z][a-z0-9.-]*$/.test(girdi.type)) fail('MANIFEST_ERROR')
    try { S.versionCode(girdi.version) } catch { fail('MANIFEST_ERROR') }
    if (!OZET_RE.test(girdi.ociDigest)) fail('MANIFEST_ERROR')
    // §12.1 madde 9: dosyanın boyutu ve özeti (akışla)
    const oz = S.dosyaOzeti()
    let boyut = 0
    const fd = fs.openSync(arsivYolu, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)
    try {
      if (!fs.fstatSync(fd).isFile()) fail('DIGEST_MISMATCH')
      const tampon = b4a.alloc(1 << 20)
      for (;;) {
        const n = fs.readSync(fd, tampon, 0, tampon.byteLength, null)
        if (n === 0) break
        oz.guncelle(tampon.subarray(0, n))
        boyut += n
      }
    } finally { fs.closeSync(fd) }
    S.dosyaDenetle(girdi.archive, { ozet: oz.bitir(), boyut })
    const y = await this._komut(['load', '--quiet', '--input=' + arsivYolu])
    if (y.kod !== 0) fail('IMAGE_LOAD_FAILED')
    const satir = y.cikti.split('\n').map((s) => s.trim()).filter((s) => s.startsWith('Loaded image')).pop()
    const ref = satir ? satir.slice(satir.indexOf(':') + 1).trim() : ''
    const ad = ref.replace(/@sha256:[0-9a-f]{64}$/, '').replace(/:[^:/]+$/, '')
    if (!AD_RE.test(ad)) fail('IMAGE_LOAD_FAILED')
    const d = await this._komut(['image', 'inspect', '--format={{.Digest}}', ref])
    if (d.kod !== 0 || d.cikti.trim() !== girdi.ociDigest) {
      await this._komut(['rmi', '--force', ref]).catch(() => {})
      fail('DIGEST_MISMATCH')
    }
    const tam = ad + '@' + girdi.ociDigest
    const kayit = kayitOku(this.kok)
    kayit[girdi.type + '@' + girdi.version] = { ref: tam, ramMB: girdi.ramMB || 0 }
    const p = kayitYolu(this.kok)
    fs.writeFileSync(p + '.yeni', JSON.stringify(kayit), { mode: 0o600 })
    fs.renameSync(p + '.yeni', p)
    return tam
  }
}

module.exports = { PodmanCalistirici, imajBul, kayitliTurler, sonuKes, kapAdi, podAdi, sunucuAdi, RTSP_TURU, LOG_MAX, PIDS }
