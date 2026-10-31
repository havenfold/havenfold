// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// D86: RFC-0008 §17 adım 4 — Linux işçide uç kaynağı, benzetimli uçtan uca: ebeveyn uç yapılandırır (targets yalnız işçi),
// işçi hf.task.vision görevi için UC_STREAM_OPEN açar, uç kabul eder ve kareleri mühürler; işçi açıp IPC 40–41 ile
// denetçiye verir; denetçi yetki yardımcısının uc-akis-ag işlemiyle ad alanı ve akış sunucusunu (benzetim) kurar, kareleri
// akis.sock'a yazar; görev 127.0.0.1'den okur. Bakım YB12/YB2: görüntü işçinin diskine ve ağ dışına çıkmaz.
// D89 (inceleme 23): ad alanını görev kullanıcısının rootless Podman'ı pod olarak kurar (podman.js akisPodKur; burada
// pod kancası akış sunucusu benzetimini süreç içinde başlatır, gerçek Podman bu makinede yok).
const test = require('brittle')
const b4a = require('b4a')
const fs = require('fs')
const os = require('os')
const net = require('net')
const path = require('path')
const { ledger: { Ledger }, zarf: { Z }, pairs: { PairBook } } = require('@havenfold/core')
const S = require('@havenfold/sdk')
const V = require('../../core/core/test/helpers/v21')
const { Denetci } = require('../supervisor')
const { YetkiYardimcisi } = require('../privilege-helper')
const { IPC } = require('../ipc/types')
const { cerceveYaz, mesajCoz } = require('../ipc/frame')
const { IsciAkisAlici, anahtarMi, YENILE_MS } = require('../edge/worker-stream')
const { RtspBenzetimi } = require('../edge/rtsp-simulation')
const AS = require('../edge/stream-socket')

const { hex } = V
const ucHex = hex(V.C.uc1.memberId)
const isciHex = hex(V.C.isci1.memberId)
const kerem = hex(V.K.kerem.memberId)
const TASK = 'ab'.repeat(16)
const KOSUL = { oturum: 'dogrudan', yerel: { gun: 1, dk: 600 }, thermal: 'normal', pil: { percent: 80, onAC: true } }
const IDR = b4a.from('00000001658880', 'hex') // NAL 5
const P = b4a.from('00000001419a00', 'hex') // NAL 1
const bekle = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function kadar (kosul, ms = 20000) { // CPU kotası ve kapsam koşusunda yavaş
  const son = Date.now() + ms
  while (!kosul()) { if (Date.now() > son) throw new Error('TIMEOUT'); await bekle(5) }
}
const cift = (L, me) => (peer) => new PairBook({ me, ledger: L }).get(peer)?.pair || null
function bellek () { const m = new Map(); return { get: (k) => m.get(k) ?? null, set: (k, v) => m.set(k, v) } }
// Görev dizinindeki akis.sock'un yolu Unix soket sınırına (macOS 104 bayt) sığsın: macOS'un os.tmpdir()'i uzun (/var/folders/…)
const GECICI = process.platform === 'win32' ? os.tmpdir() : '/tmp'
const hataOf = async (fn) => { try { await fn(); return null } catch (e) { return e.message } }

// İşçi çekirdeğinin denetçi istemcisi yerine: aynı çerçevelerle Denetci'nin işçi ucuna
function ipcIstemcisi (dn) {
  const b = dn.uc('isci').baglan('havenfold-isci')
  const bildirimler = []
  let alici = null
  b.yaziciBagla((f) => { const m = mesajCoz(f.subarray(4)); bildirimler.push(m); if (alici) alici.denetcidenAl(m) })
  let sira = 0
  const gonder = async (type, mesaj) => {
    const { cikis } = await b.al(cerceveYaz(type, ++sira, mesaj))
    return cikis
  }
  return {
    b,
    bildirimler,
    bagla: (a) => { alici = a },
    istek: async (type, mesaj) => {
      const cikis = await gonder(type, mesaj)
      const f = cikis[0].subarray(4)
      const ust = mesajCoz(f, type === IPC.AKIS_AC ? 'cevap' : 'istek')
      if (ust.type === IPC.HATA) throw new Error(ust.mesaj.code)
      return ust
    },
    gonder: (type, mesaj) => { gonder(type, mesaj) }
  }
}

function kur ({ targets = ['device:' + isciHex] } = {}) {
  const L = new Ledger()
  for (const f of V.anaAdimlar(L).slice(0, 16)) L.apply(f())
  let now = V.TS0 + 3_600_000
  const saat = () => now
  const kok = fs.mkdtempSync(path.join(GECICI, 'hf-uc-'))
  const telefon = new S.CameraApi({ defter: new S.LedgerApi({ ledger: L, me: V.K.kerem, now: saat }), ciftSirri: cift(L, V.K.kerem), now: saat })
  const uc = new S.EdgeDevice({ ledger: L, me: V.C.uc1, ciftSirri: cift(L, V.C.uc1), saklama: bellek(), now: saat })
  const ag = { olaylar: [], sunucular: new Map() }
  const akisPodKur = async ({ taskId, sourceId, dir }) => {
    ag.olaylar.push('pod hf-' + taskId)
    const akis = path.join(dir, 'akis')
    fs.mkdirSync(akis, { recursive: true })
    const s = new RtspBenzetimi({ soketYolu: path.join(akis, 'akis.sock'), sourceHex: sourceId, port: 0 })
    ag.sunucular.set('hf-rtsp-' + taskId, s)
    s.hazir = s.baslat()
    await s.hazir
    return { soket: path.join(akis, 'akis.sock') }
  }
  const akisPodSil = async (taskId) => { ag.olaylar.push('podSil hf-' + taskId); await ag.sunucular.get('hf-rtsp-' + taskId)?.kapat() }
  const dn = new Denetci({ kok, hostId: b4a.alloc(16, 1), surum: '0.0.0', akisPodKur, akisPodSil })
  dn.merhaba.set('isci', { surum: '0.0.0', at: 0 })
  const ipc = ipcIstemcisi(dn)
  const giden = [] // işçiden uca (doğrudan oturum)
  const denetimler = [] // işçiden uca sırasız kanaldan (denetim izi)
  const alici = new IsciAkisAlici({ ledger: () => L, me: V.C.isci1, ciftSirri: cift(L, V.C.isci1), gonder: (p, type, bytes) => { giden.push({ p, type, bytes }); return true }, cerceveGonder: (p, sid, c) => { denetimler.push({ p, sid, c }); return true }, denetci: ipc, now: saat })
  ipc.bagla(alici)
  // Ebeveyn yapılandırır; uç ve işçi alır
  const y = telefon.configure(ucHex, { mode: 'kamera', targets }).bytes
  uc.receiveConfig(kerem, y, 'dogrudan')
  alici.yapilandirmaAl(kerem, y, 'emanet')
  return { L, kok, telefon, uc, alici, dn, ipc, ag, giden, denetimler, ilerlet: (ms) => { now += ms } }
}

async function goreviHazirla (ipc, { type = 'hf.task.vision', sourceId = ucHex, taskId = TASK } = {}) {
  const h = await ipc.istek(IPC.GOREV_HAZIRLA, { taskId: b4a.from(taskId, 'hex'), type, version: '1.0.0', limits: { ramMB: 256, minutes: 60, diskMB: 16 }, standing: true, sourceId: sourceId ? b4a.from(sourceId, 'hex') : null })
  return h.mesaj
}

// Görev konteynerinin yerine: 127.0.0.1:8554'ten (testte rastgele port) okur
function okuyucu (port, kaynak) {
  return new Promise((resolve) => {
    const s = net.connect(port, '127.0.0.1')
    const o = { s, ilk: '', kareler: [], bitti: false }
    let t = b4a.alloc(0)
    s.on('data', (p) => {
      if (!o.ilk) {
        const metin = b4a.toString(p)
        const i = metin.indexOf('\n')
        o.ilk = metin.slice(0, i)
        p = p.subarray(i + 1)
        resolve(o)
      }
      t = b4a.concat([t, p])
      while (t.byteLength >= 4) {
        const n = new DataView(t.buffer, t.byteOffset, 4).getUint32(0)
        if (t.byteLength < 4 + n) break
        o.kareler.push({ key: t[4] === 1, ts: new DataView(t.buffer, t.byteOffset + 5, 4).getUint32(0), data: b4a.from(t.subarray(9, 4 + n)) })
        t = t.subarray(4 + n)
      }
    })
    s.on('end', () => { o.bitti = true; if (!o.ilk) resolve(o) })
    // Sunucu reddedip kapatınca macOS RST verir (ECONNRESET): okuyucu için bu da bitiş
    s.on('error', () => { o.bitti = true; resolve(o) })
    s.write('OKU /' + kaynak + '\n')
  })
}

test('D86 uçtan uca: hf.task.vision → UC_STREAM_OPEN (analiz) → kabul → AKIS_AC → ad alanı ve akış sunucusu → görev 127.0.0.1\'den okur', async (t) => {
  const k = kur()
  const g = await goreviHazirla(k.ipc)
  t.ok(g.ok)
  const sid = k.alici.baslat({ taskId: TASK, type: 'hf.task.vision', params: { sourceId: ucHex } })
  t.is(k.giden[0].type, Z.UC_STREAM_OPEN)
  t.is(k.giden[0].p, ucHex, 'yalnız uca, doğrudan oturumla')
  const r = k.uc.receiveStreamRequest(isciHex, k.giden[0].bytes, 'dogrudan', KOSUL)
  t.ok(r.kabul, 'uç işçinin analiz isteğini kabul eder (targets device:<işçi>)')
  t.is(await k.alici.kabulAl(ucHex, r.kabul, 'dogrudan'), sid)
  t.alike(k.ag.olaylar, ['pod hf-' + TASK], 'görev kullanıcısının pod\'u ve içinde sunucu (inceleme 23 madde 1–3)')
  const sunucu = k.ag.sunucular.get('hf-rtsp-' + TASK)
  await sunucu.hazir
  t.is(sunucu.rtsp.address().address, '127.0.0.1', 'yalnız geri döngü')
  // Görev okur; bağlanınca anahtar kare istenir (IPC 43 → işçi)
  const anahtar = []
  k.alici.on('anahtar-kare', (id) => anahtar.push(id))
  const o = await okuyucu(sunucu.port, ucHex)
  t.is(o.ilk, 'TAMAM')
  await kadar(() => anahtar.length === 1)
  t.alike(anahtar, [sid])
  t.ok(k.ipc.bildirimler.some((m) => m.type === IPC.ANAHTAR_KARE_ISTE))
  // İşçi uca anahtar kare isteğini ters yön anahtarıyla mühürledi; uç açar (RFC-0008 açıklama 1 madde 5)
  t.is(k.denetimler.length, 1)
  t.is(k.denetimler[0].p, ucHex)
  t.is(b4a.toString(r.denetimAc(k.denetimler[0].c).yuk), 'anahtar-kare')
  // Uç kareleri mühürler; anahtar kareden önceki ara kare okuyucuya gitmez
  t.ok(k.alici.cerceveAl(ucHex, sid, r.muhurle(P, { ts: 1 })))
  t.ok(k.alici.cerceveAl(ucHex, sid, r.muhurle(IDR, { ts: 2 })))
  t.ok(k.alici.cerceveAl(ucHex, sid, r.muhurle(P, { ts: 3 })))
  await kadar(() => o.kareler.length === 2)
  t.alike(o.kareler.map((x) => [x.key, x.ts, hex(x.data)]), [[true, 2, hex(IDR)], [false, 3, hex(P)]])
  // Tekrar ve başka akıştan çerçeve atılır
  const tekrar = r.muhurle(P, { ts: 4 })
  t.ok(k.alici.cerceveAl(ucHex, sid, tekrar))
  t.absent(k.alici.cerceveAl(ucHex, sid, tekrar), 'tekrar')
  t.absent(k.alici.cerceveAl(kerem, sid, tekrar), 'başka göndericiden')
  t.absent(k.alici.cerceveAl(ucHex, 'cd'.repeat(16), tekrar))
  // YB12/YB2: görüntü diske yazılmadı; görev dizininde yalnız in, out, params ve akis.sock
  t.alike(fs.readdirSync(path.join(k.kok, 'run/havenfold/gorev', TASK)).sort(), ['akis', 'in', 'out', 'params'])
  t.alike(fs.readdirSync(path.join(k.kok, 'run/havenfold/gorev', TASK, 'akis')), ['akis.sock'])
  t.is((fs.statSync(path.join(k.kok, 'run/havenfold/gorev', TASK, 'akis', 'akis.sock')).mode & 0o777).toString(8), '660', 'madde 2: denetçi grupla bağlanır')
  t.absent(fs.existsSync(path.join(k.kok, 'var')), 'kalıcı dizine hiçbir şey yazılmadı')
  // Uç kapatır → denetçi akış sunucusuna KAPAT → görev okuyucusu biter
  const kapat = k.uc.closeStream(sid, 'BITTI').kapat
  t.alike(k.alici.kapatAl(ucHex, kapat, 'dogrudan'), { streamId: sid, code: 'BITTI' })
  await kadar(() => o.bitti)
  t.is(sunucu.kapandi, 'BITTI')
  // Görev temizlenince ad alanı ve sunucu gider
  await k.ipc.istek(IPC.GOREV_TEMIZLE, { taskId: b4a.from(TASK, 'hex') }).catch(() => {})
  await kadar(() => k.ag.olaylar.includes('podSil hf-' + TASK))
  t.absent(fs.existsSync(path.join(k.kok, 'run/havenfold/gorev', TASK)))
})

test('D86 YB12: hedefte işçi yoksa işçi akış açmaz; üye analiz isteyemez; ağ yayını ve kalıcı yol yok', async (t) => {
  const k = kur({ targets: ['rol:ebeveyn'] })
  t.is(await hataOf(() => k.alici.baslat({ taskId: TASK, type: 'hf.task.vision', params: { sourceId: ucHex } })), 'NOT_TARGET')
  t.is(await hataOf(() => k.alici.baslat({ taskId: TASK, type: 'hf.task.ocr', params: { sourceId: ucHex } })), 'INVALID_TASK_TYPE')
  t.is(await hataOf(() => k.alici.baslat({ taskId: TASK, type: 'hf.task.vision', params: { sourceId: isciHex } })), 'INVALID_SOURCE', 'kaynak bir uç değil')
  t.is(await hataOf(() => k.alici.baslat({ taskId: TASK, type: 'hf.task.vision', params: {} })), 'INVALID_SOURCE')
  // Uç tarafında da: üye "analiz" amaçlı akış açamaz (targets device:<işçi> değilse IZIN_YOK)
  const k2 = kur()
  const istek = k2.telefon.watch(ucHex)
  t.is(k2.uc.receiveStreamRequest(kerem, istek.bytes, 'dogrudan', KOSUL).code, 'IZIN_YOK', 'canlı izleme hedefte yok')
  t.exception(() => new RtspBenzetimi({ soketYolu: '/tmp/x', sourceHex: ucHex, adres: '0.0.0.0' }), /ADDRESS_FORBIDDEN/)
  t.exception(() => new RtspBenzetimi({ soketYolu: '/tmp/x', sourceHex: 'x' }), /INVALID_SOURCE/)
  const yeni = kur()
  t.is(yeni.alici.yapilandirmaAl(kerem, yeni.telefon.configure(ucHex, { mode: 'kamera', targets: ['device:' + isciHex], seq: 1 }).bytes, 'dogrudan'), null, 'eski seq kazanmaz')
})

test('D86 denetçi: yanlış görev ve kaynak; akış sunucusu kapanınca işçi uca kapatır; yardımcının girdi denetimi', async (t) => {
  const k = kur()
  await goreviHazirla(k.ipc, { type: 'hf.task.ocr', sourceId: null, taskId: 'cd'.repeat(16) })
  const ac = (taskId, sourceId = ucHex, streamId = b4a.alloc(16, 9)) => k.ipc.istek(IPC.AKIS_AC, { taskId: b4a.from(taskId, 'hex'), sourceId: b4a.from(sourceId, 'hex'), streamId, codec: 'h264', width: 640, height: 480, fps: 5 })
  t.is(await hataOf(() => ac('cd'.repeat(16))), 'INVALID_TASK_TYPE')
  t.is(await hataOf(() => ac('ef'.repeat(16))), 'NO_TASK')
  await goreviHazirla(k.ipc)
  t.is(await hataOf(() => ac(TASK, isciHex)), 'INVALID_SOURCE')
  // Geçerli akış; sunucu çökerse işçiye AKIS_KAPAT SERVER_CLOSED, işçi uca UC_STREAM_CLOSE
  const sid = k.alici.baslat({ taskId: TASK, type: 'hf.task.vision', params: { sourceId: ucHex } })
  const r = k.uc.receiveStreamRequest(isciHex, k.giden[0].bytes, 'dogrudan', KOSUL)
  await k.alici.kabulAl(ucHex, r.kabul, 'dogrudan')
  t.is(await hataOf(() => k.ipc.istek(IPC.AKIS_AC, { taskId: b4a.from(TASK, 'hex'), sourceId: b4a.from(ucHex, 'hex'), streamId: b4a.from(sid, 'hex'), codec: 'h264', width: 640, height: 480, fps: 5 })), 'REPLAY')
  const kapandi = []
  k.alici.on('kapandi', (id, code) => kapandi.push([id, code]))
  await k.ag.sunucular.get('hf-rtsp-' + TASK).kapat()
  await kadar(() => kapandi.length === 1)
  t.alike(kapandi, [[sid, 'BITTI']])
  const son = k.giden.at(-1)
  t.is(son.type, Z.UC_STREAM_CLOSE)
  const kp = k.uc.receiveClose(isciHex, son.bytes, 'dogrudan')
  t.alike([kp.streamId, kp.code], [sid, 'BITTI'])
  // Bilinmeyen akışın karesi sessizce atılır
  k.ipc.gonder(IPC.AKIS_KARE, { streamId: b4a.alloc(16, 7), ts: 1, key: true, data: IDR })
  // Yardımcı ad alanı kurmaz (inceleme 23 madde 1): uc-akis-ag bu sürümde yok
  const y = new YetkiYardimcisi({ kok: k.kok })
  t.is(await hataOf(() => y.isle('havenfold-denetci', 'uc-akis-ag', { taskId: TASK, sourceId: ucHex })), 'NOT_IN_THIS_VERSION')
  // Pod kancası yoksa
  const dn2 = new Denetci({ kok: k.kok, hostId: b4a.alloc(16, 2), surum: '0.0.0' })
  dn2.gorevler.set('12'.repeat(16), { dir: k.kok, type: 'hf.task.vision', sourceId: ucHex })
  t.is(await hataOf(() => dn2.akisAc({ taskId: b4a.from('12'.repeat(16), 'hex'), sourceId: b4a.from(ucHex, 'hex'), streamId: b4a.alloc(16, 3) }, {})), 'POD_YOK')
  await k.ipc.istek(IPC.GOREV_TEMIZLE, { taskId: b4a.from(TASK, 'hex') }).catch(() => {})
})

test('Pod kancası olmayan denetçiye AKIS_AC: IPC HATA.code telde POD_YOK (tel değeri değişmez)', async (t) => {
  const kok = fs.mkdtempSync(path.join(GECICI, 'hf-uc-'))
  t.teardown(() => fs.rmSync(kok, { recursive: true, force: true }))
  const dn = new Denetci({ kok, hostId: b4a.alloc(16, 2), surum: '0.0.0' })
  dn.merhaba.set('isci', { surum: '0.0.0', at: 0 })
  dn.gorevler.set('12'.repeat(16), { dir: kok, type: 'hf.task.vision', sourceId: ucHex })
  const ipc = ipcIstemcisi(dn)
  const { cikis } = await ipc.b.al(cerceveYaz(IPC.AKIS_AC, 1, { taskId: b4a.from('12'.repeat(16), 'hex'), sourceId: b4a.from(ucHex, 'hex'), streamId: b4a.alloc(16, 3), codec: 'h264', width: 640, height: 480, fps: 5 }))
  const ust = mesajCoz(cikis[0].subarray(4), 'cevap')
  t.is(ust.type, IPC.HATA)
  t.is(ust.mesaj.code, 'POD_YOK', 'eski işçiler POD_YOK bekler; kod yeniden adlandırılmaz')
})

test('D86 işçi: kabul hatası uca kapatır; 24 saat dolmadan yenileme, eski akış yenisi açılınca kapanır; anahtar kare tanıma', async (t) => {
  const k = kur()
  // Görev hazırlanmadan kabul: denetçi NO_TASK, işçi uca kapatır
  const sid = k.alici.baslat({ taskId: TASK, type: 'hf.task.vision', params: { sourceId: ucHex } })
  const r = k.uc.receiveStreamRequest(isciHex, k.giden[0].bytes, 'dogrudan', KOSUL)
  t.is(await hataOf(() => k.alici.kabulAl(ucHex, r.kabul, 'dogrudan')), 'NO_TASK')
  t.is(k.giden.at(-1).type, Z.UC_STREAM_CLOSE)
  k.uc.receiveClose(isciHex, k.giden.at(-1).bytes, 'dogrudan') // uç da kapatır (en çok 2 akış)
  t.is(await hataOf(() => k.alici.kabulAl(ucHex, r.kabul, 'dogrudan')), 'NO_STREAM')
  t.ok(sid)
  // Yenileme
  await goreviHazirla(k.ipc)
  const s1 = k.alici.baslat({ taskId: TASK, type: 'hf.task.vision', params: { sourceId: ucHex } })
  const r1 = k.uc.receiveStreamRequest(isciHex, k.giden.at(-1).bytes, 'dogrudan', KOSUL)
  await k.alici.kabulAl(ucHex, r1.kabul, 'dogrudan')
  t.alike(k.alici.yenile(), [], 'erken')
  k.ilerlet(YENILE_MS)
  const [s2] = k.alici.yenile()
  t.ok(s2)
  t.alike(k.alici.yenile(), [], 'bir kez')
  const r2 = k.uc.receiveStreamRequest(isciHex, k.giden.at(-1).bytes, 'dogrudan', KOSUL)
  t.ok(r2.kabul)
  await k.alici.kabulAl(ucHex, r2.kabul, 'dogrudan')
  t.absent(k.alici.akislar.has(s1), 'eski akış kapandı')
  t.is(A_kod(k.giden.at(-1)), 'SURE_DOLDU')
  // Görev durunca akış kapanır
  k.alici.durdur(TASK)
  t.is(k.alici.akislar.size, 0)
  t.ok(anahtarMi(IDR))
  t.ok(anahtarMi(b4a.from('0000016742', 'hex')), 'SPS, 3 baytlık başlangıç')
  t.absent(anahtarMi(P))
  t.ok(anahtarMi(b4a.from('0000000109f0' + '00000001060501' + '0000000165b8', 'hex')), 'madde 7: AUD ve SEI önde, sonra IDR')
  t.absent(anahtarMi(b4a.from('6588', 'hex')), 'başlangıç kodu yok')
  t.absent(anahtarMi(b4a.from('000001', 'hex')), 'sonda başlangıç kodu: sınır dışı okuma yok')
  t.absent(anahtarMi(b4a.alloc(0)))
  t.absent(k.alici.denetcidenAl({ type: IPC.HATA, mesaj: {} }))
  t.ok(k.alici.denetcidenAl({ type: IPC.ANAHTAR_KARE_ISTE, mesaj: { streamId: b4a.alloc(16) } }))
  t.absent(k.alici.anahtarKareIste('ef'.repeat(16)), 'bilinmeyen akış')
  t.exception(() => new IsciAkisAlici({ ledger: () => k.L, me: V.C.isci1, gonder: () => true, denetci: k.ipc }), /PAIR_SECRET_REQUIRED/, 'açıklama 1 madde 7')
  await k.ipc.istek(IPC.GOREV_TEMIZLE, { taskId: b4a.from(TASK, 'hex') }).catch(() => {})
})

function A_kod (g) { return require('@havenfold/edge').akis.kapatCoz(g.bytes).code }

test('D86 akış soketi çerçevesi: kare, kapat, anahtar; büyük uzunluk', (t) => {
  const o = new AS.Okuyucu()
  const k = AS.kare({ key: true, ts: 2 ** 32 + 5, data: IDR })
  const cs = o.besle(b4a.concat([k.subarray(0, 3)]))
  t.alike(cs, [])
  const cs2 = o.besle(b4a.concat([k.subarray(3), AS.kapat('BITTI'), AS.anahtarIste()]))
  t.is(cs2.length, 3)
  t.alike(AS.kareCoz(cs2[0].govde), { key: true, ts: 5, data: IDR })
  t.is(b4a.toString(cs2[1].govde), 'BITTI')
  t.is(cs2[2].tur, AS.TUR.ANAHTAR)
  const b = b4a.alloc(4)
  new DataView(b.buffer).setUint32(0, AS.EN_BUYUK + 1)
  t.exception(() => new AS.Okuyucu().besle(b), /STREAM_FRAME_TOO_LARGE/)
})

test('D89 madde 5, 6: yenilenen akışın eski yazarının KAPAT’ı okuyucuları kesmez; okuyucu sınırı; denetçi geri basıncı', async (t) => {
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-rtsp-'))
  const b = new RtspBenzetimi({ soketYolu: path.join(kok, 'a.sock'), sourceHex: ucHex, port: 0 })
  await b.baslat()
  const o = await okuyucu(b.port, ucHex)
  const yaz = () => new Promise((resolve) => { const s = net.connect(path.join(kok, 'a.sock'), () => resolve(s)); s.on('error', () => {}) })
  const eski = await yaz()
  await kadar(() => b.denetci)
  const yeni = await yaz()
  await bekle(30)
  eski.write(AS.kapat('BITTI')) // yeni yazar bağlanınca eskisi düşürüldü; çerçevesi gelse de işlenmez
  await bekle(30)
  t.is(b.kapandi, null, 'eski yazarın KAPAT\'ı işlenmedi (madde 5)')
  yeni.write(AS.kare({ key: true, ts: 1, data: IDR }))
  await kadar(() => o.kareler.length === 1)
  t.absent(o.bitti)
  // Okuyucu sınırı: en çok 4
  const ekler = await Promise.all([1, 2, 3].map(() => okuyucu(b.port, ucHex)))
  t.is(b.okuyucular.size, 4)
  const fazla = await okuyucu(b.port, ucHex)
  t.ok(fazla.bitti || !fazla.ilk, 'beşinci okuyucu kabul edilmez')
  for (const x of [o, ...ekler]) x.s.destroy()
  eski.destroy()
  yeni.destroy()
  await b.kapat()
  // Denetçi geri basıncı: yazılmayı bekleyen veri sınırı aşınca kareler atılır, anahtar kareyle sürer
  const dn = new Denetci({ kok, hostId: b4a.alloc(16, 1), surum: '0.0.0' })
  const yazilan = []
  const soket = { writableLength: 0, write: (x) => yazilan.push(x), end () {} }
  dn.akislar.set('aa'.repeat(16), { taskId: TASK, soket, baglanti: null, atiliyor: false, atilan: 0 })
  const kare = (key) => dn.akisKare({ streamId: b4a.from('aa'.repeat(16), 'hex'), ts: 1, key, data: P })
  kare(false)
  soket.writableLength = 5 * 1024 * 1024
  kare(false)
  kare(true)
  soket.writableLength = 0
  kare(false)
  t.is(yazilan.length, 1, 'tampon doluyken ve anahtar kare gelene kadar atılır')
  kare(true)
  kare(false)
  t.is(yazilan.length, 3)
  t.is(dn.akislar.get('aa'.repeat(16)).atilan, 3)
})

test('D89 madde 4: gorevYurut görüntü görevinde akış açılıp pod kurulmadan GOREV_BASLAT yapmaz', async (t) => {
  const { gorevYurut } = require('../worker')
  const { kaynakOf } = require('../edge/worker-stream')
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-gy-'))
  const sira = []
  let n = 0
  const istemci = {
    istek: async (type) => {
      sira.push(type)
      if (type === IPC.GOREV_HAZIRLA) {
        const d = 'g' + (++n)
        for (const x of ['in', 'out']) fs.mkdirSync(path.join(kok, d, x), { recursive: true })
        return { type: IPC.GOREV_HAZIR, mesaj: { taskId: b4a.from(TASK, 'hex'), ok: true, dir: d, code: '' } }
      }
      return { type: IPC.GOREV_BITTI, mesaj: { taskId: b4a.from(TASK, 'hex'), status: 'hata', exitCode: 1, log: '' } }
    },
    gonder: (type) => sira.push(type)
  }
  const params = b4a.from(JSON.stringify({ sourceId: ucHex }))
  const g = (ek = {}) => ({ taskId: TASK, type: 'hf.task.vision', version: '1.0.0', limits: { ramMB: 64, minutes: 1, diskMB: 1 }, standing: true, params, girdiler: [], ...ek })
  t.alike(await gorevYurut(istemci, g(), { kok }), { ok: false, code: 'NO_STREAM' })
  const akis = { hazirlandi: [], durduruldu: [], hazirla: async (x) => { akis.hazirlandi.push(x); sira.push('akis') }, durdur: (id) => akis.durduruldu.push(id) }
  t.alike(await gorevYurut(istemci, g({ params: b4a.from('{}') }), { kok, akis }), { ok: false, code: 'INVALID_SOURCE' })
  const r = await gorevYurut(istemci, g(), { kok, akis })
  t.ok(r.ok)
  t.alike(sira, [IPC.GOREV_HAZIRLA, 'akis', IPC.GOREV_BASLAT, IPC.GOREV_TEMIZLE], 'akış hazır olmadan başlamaz')
  t.is(akis.hazirlandi[0].params.sourceId, ucHex)
  t.is(akis.durduruldu.length, 1, 'görev bitince akış kapanır')
  // Akış açılamazsa görev başlamaz
  sira.length = 0
  const kotu = { hazirla: async () => { throw new Error('STREAM_OPEN_FAILED') }, durdur: () => {} }
  t.alike(await gorevYurut(istemci, g(), { kok, akis: kotu }), { ok: false, code: 'STREAM_OPEN_FAILED' })
  t.absent(sira.includes(IPC.GOREV_BASLAT))
  t.is(kaynakOf(b4a.from('bozuk')), null)
})

test('Codex 12. tur: kabulAl AKIS_AC beklerken uç akışı kapatırsa kabul düşer ve denetçinin açtığı akış kapanır', async (t) => {
  const k = kur()
  const E = require('@havenfold/edge')
  await goreviHazirla(k.ipc)
  k.alici.baslat({ taskId: TASK, type: 'hf.task.vision', params: { sourceId: ucHex } })
  await k.alici.kabulAl(ucHex, k.uc.receiveStreamRequest(isciHex, k.giden.at(-1).bytes, 'dogrudan', KOSUL).kabul, 'dogrudan')
  k.ilerlet(YENILE_MS)
  const [s2] = k.alici.yenile()
  const r2 = k.uc.receiveStreamRequest(isciHex, k.giden.at(-1).bytes, 'dogrudan', KOSUL)
  // AKIS_AC denetçide sürerken uç yeni akışı kapatır
  const istek = k.ipc.istek.bind(k.ipc)
  const gonder = k.ipc.gonder.bind(k.ipc)
  const kapatilan = []
  let ac
  const kapi = new Promise((resolve) => { ac = resolve })
  k.ipc.istek = async (...x) => { const r = await istek(...x); await kapi; return r }
  k.ipc.gonder = (type, m) => { if (type === IPC.AKIS_KAPAT) kapatilan.push(b4a.toString(m.streamId, 'hex')); return gonder(type, m) }
  const p = k.alici.kabulAl(ucHex, r2.kabul, 'dogrudan')
  await new Promise((resolve) => setTimeout(resolve, 20))
  k.alici.kapatAl(ucHex, E.akis.kapatKodla({ streamId: b4a.from(s2, 'hex'), code: 'PENCERE_DISI', by: V.C.uc1.memberId }), 'dogrudan')
  ac()
  t.is(await hataOf(() => p), 'NO_STREAM')
  t.alike(kapatilan, [s2], 'denetçinin açtığı akış kapatıldı')
  await new Promise((resolve) => setTimeout(resolve, 20))
  t.absent(k.dn.akislar.has(s2), 'denetçide sahipsiz akış kalmadı')
  t.absent(k.alici.akislar.has(s2))
  k.alici.durdur(TASK)
  for (const s of k.ag.sunucular.values()) await s.kapat()
})

test('D89 madde 4: IsciAkisAlici.hazirla ilk akış açılınca çözülür; uç kapatırsa ya da süre dolarsa STREAM_OPEN_FAILED', async (t) => {
  const k = kur()
  await goreviHazirla(k.ipc)
  const p = k.alici.hazirla({ taskId: TASK, type: 'hf.task.vision', params: { sourceId: ucHex } })
  const r = k.uc.receiveStreamRequest(isciHex, k.giden.at(-1).bytes, 'dogrudan', KOSUL)
  await k.alici.kabulAl(ucHex, r.kabul, 'dogrudan')
  t.ok(await p)
  k.alici.durdur(TASK)
  // Uç reddederse
  const p2 = k.alici.hazirla({ taskId: TASK, type: 'hf.task.vision', params: { sourceId: ucHex } })
  const sid = require('@havenfold/edge').akis.akisAcCoz(k.giden.at(-1).bytes).m.streamId
  k.alici.kapatAl(ucHex, require('@havenfold/edge').akis.kapatKodla({ streamId: sid, code: 'PENCERE_DISI', by: V.C.uc1.memberId }), 'dogrudan')
  t.is(await hataOf(() => p2), 'STREAM_OPEN_FAILED')
  // Süre
  const tut = setTimeout(() => {}, 500)
  t.is(await hataOf(() => k.alici.hazirla({ taskId: TASK, type: 'hf.task.vision', params: { sourceId: ucHex } }, { sureMs: 30 })), 'STREAM_OPEN_FAILED')
  clearTimeout(tut)
  t.is(await hataOf(() => k.alici.hazirla({ taskId: TASK, type: 'hf.task.ocr', params: {} })), 'INVALID_TASK_TYPE')
  await k.ipc.istek(IPC.GOREV_TEMIZLE, { taskId: b4a.from(TASK, 'hex') }).catch(() => {})
})

test('D89: görev dizini Unix soket sınırını aşarsa AKIS_AC açık kodla düşer (SOCKET_PATH_TOO_LONG); pod kurulamazsa POD_SETUP_FAILED', async (t) => {
  const uzun = fs.mkdtempSync(path.join(GECICI, 'hf-uzun-' + 'x'.repeat(60) + '-'))
  t.teardown(() => fs.rmSync(uzun, { recursive: true, force: true }))
  let kuruldu = 0
  const hazirla = (dn) => dn.gorevHazirla({ taskId: b4a.from(TASK, 'hex'), type: 'hf.task.vision', version: '1.0.0', limits: { ramMB: 256, minutes: 60, diskMB: 16 }, standing: true, sourceId: b4a.from(ucHex, 'hex') })
  const ac = (dn) => dn.akisAc({ taskId: b4a.from(TASK, 'hex'), streamId: b4a.alloc(16, 7), sourceId: b4a.from(ucHex, 'hex') }, {})
  const dn = new Denetci({ kok: uzun, hostId: b4a.alloc(16, 1), surum: '0.0.0', akisPodKur: async () => { kuruldu++; return { soket: '/yok' } } })
  hazirla(dn)
  t.is(await hataOf(() => ac(dn)), 'SOCKET_PATH_TOO_LONG')
  t.is(kuruldu, 0, 'pod kurulmaya çalışılmadı')
  const kisa = fs.mkdtempSync(path.join(GECICI, 'hf-pk-'))
  t.teardown(() => fs.rmSync(kisa, { recursive: true, force: true }))
  const dn2 = new Denetci({ kok: kisa, hostId: b4a.alloc(16, 1), surum: '0.0.0', akisPodKur: async () => { throw new Error('listen EINVAL: invalid argument') } })
  hazirla(dn2)
  t.is(await hataOf(() => ac(dn2)), 'POD_SETUP_FAILED', 'kodsuz hata INTERNAL_ERROR değil')
})
