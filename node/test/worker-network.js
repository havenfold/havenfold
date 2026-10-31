// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// İşçinin ağ tarafı (node/worker.js IsciAgi; RFC-0002 §6.2 madde 8, §6.3): görev başlayınca isteyene TASK_PROGRESS,
// denetçinin GOREV_ILERLEME bildirimi 10 saniyede en çok bir kez iletilir; görülen taskId'ler diske yazılır, yeniden
// başlayan işçi aynı görevi TEKRAR ile reddeder. Ağ, denetçi ve saat sahte; defter görev vektörlerinin ailesi.
const test = require('brittle')
const fs = require('fs')
const os = require('os')
const path = require('path')
const b4a = require('b4a')
const { zarf: { Z }, hello: { CAPS } } = require('@havenfold/core')
const { kodlama: K } = require('@havenfold/tasks')
const G = require('../../core/tasks/test/helpers/task')
const { IsciAgi, isciCaps } = require('../worker')
const { IPC } = require('../ipc/types')

const KEREM = G.hex(G.U.kerem.memberId)

// Denetçinin yerine: GOREV_HAZIRLA dizini kurar, GOREV_BASLAT bitir() çağrılana kadar bekler (ya da hemen biter)
function sahteDenetci (kok, { bekle = false } = {}) {
  const giden = []
  let bitir = null
  const baslat = new Promise((resolve) => { bitir = resolve })
  return {
    giden,
    bitir: () => bitir(),
    gonder: (type, mesaj) => giden.push({ type, mesaj }),
    istek: async (type, mesaj) => {
      giden.push({ type, mesaj })
      const id = G.hex(mesaj.taskId)
      if (type === IPC.GOREV_HAZIRLA) {
        for (const d of ['in', 'out']) fs.mkdirSync(path.join(kok, 'g', id, d), { recursive: true })
        return { type: IPC.GOREV_HAZIR, mesaj: { taskId: mesaj.taskId, dir: 'g/' + id, ok: true, code: '' } }
      }
      if (type === IPC.GOREV_BASLAT) {
        if (bekle) await baslat
        fs.writeFileSync(path.join(kok, 'g', id, 'out', 'metin.txt'), 'tamam')
        return { type: IPC.GOREV_BITTI, mesaj: { taskId: mesaj.taskId, status: 'ok', exitCode: 0, log: '' } }
      }
      throw new Error('UNEXPECTED')
    }
  }
}

function isciKur (t, { kok, gorulenDosyasi, saat, bekle = false, kurtarma = null }) {
  const L = G.defter()
  const ag = []
  const istemci = sahteDenetci(kok, { bekle })
  const olcum = { ramTotalMB: 8192, cores: 4, onAC: true, tasks: G.caps(G.C.isci1).tasks }
  const a = new IsciAgi({ defter: () => L, me: G.C.isci1, ag: { gonder: (p, type, bytes) => { ag.push({ p, type, bytes }); return true } }, istemci, kok, olcum, now: () => saat.t, gorulenDosyasi, kurtarma })
  t.teardown(() => a.kapat())
  return { L, a, ag, istemci }
}

const bekleyin = async (f) => { for (let i = 0; i < 200 && !f(); i++) await new Promise((resolve) => setTimeout(resolve, 10)) }

test('işçi: görev başlayınca isteyene TASK_PROGRESS (basladi); denetçinin ilerlemesi 10 saniyede bir', async (t) => {
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-ia-'))
  t.teardown(() => fs.rmSync(kok, { recursive: true, force: true }))
  const saat = { t: G.SIMDI }
  const { L, a, ag, istemci } = isciKur(t, { kok, saat, bekle: true })
  const task = K.encodeTask(L.familyId, G.gorev(L, { inputs: [] }), G.U.kerem)
  a.al(KEREM, Z.TASK, task, 'dogrudan')
  await bekleyin(() => istemci.giden.some((x) => x.type === IPC.GOREV_BASLAT))
  const taskId = G.id16(0x51)
  a.ilerleme({ taskId, pct: 30, note: 'sayfa 3' }) // 10 saniye dolmadı: gitmez
  saat.t += 11_000
  a.ilerleme({ taskId, pct: 55, note: 'sayfa 6' })
  a.ilerleme({ taskId: G.id16(0x99), pct: 10, note: 'başkası' }) // bilinmeyen görev
  t.is(a.caps().running[0].pct, 55, 'NODE_CAPS çalışan görevin yüzdesi')
  istemci.bitir()
  await bekleyin(() => ag.some((x) => x.type === Z.TASK_RESULT))
  t.alike(ag.map((x) => [x.p, x.type]), [[KEREM, Z.TASK_ACCEPT], [KEREM, Z.TASK_PROGRESS], [KEREM, Z.TASK_PROGRESS], [KEREM, Z.TASK_RESULT]])
  const ilerlemeler = ag.filter((x) => x.type === Z.TASK_PROGRESS).map((x) => K.decodeProgress(x.bytes))
  t.alike(ilerlemeler.map((m) => [b4a.toString(m.taskId, 'hex'), m.pct, m.note]), [[G.hex(taskId), 0, 'basladi'], [G.hex(taskId), 55, 'sayfa 6']])
  t.is(K.decodeResult(ag.at(-1).bytes).status, 'ok')
})

test('işçi: görülen taskId diske yazılır; yeniden başlayan işçi aynı görevi TEKRAR ile reddeder (RFC-0002 §6.2 madde 8)', async (t) => {
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-ia-'))
  t.teardown(() => fs.rmSync(kok, { recursive: true, force: true }))
  const gorulenDosyasi = path.join(kok, 'gorev-kayit', 'gorulen.json')
  const saat = { t: G.SIMDI }
  const ilk = isciKur(t, { kok, gorulenDosyasi, saat })
  const task = K.encodeTask(ilk.L.familyId, G.gorev(ilk.L, { inputs: [] }), G.U.kerem)
  ilk.a.al(KEREM, Z.TASK, task, 'dogrudan')
  t.is(ilk.ag[0].type, Z.TASK_ACCEPT)
  await bekleyin(() => ilk.ag.some((x) => x.type === Z.TASK_RESULT))
  t.ok(fs.existsSync(gorulenDosyasi), 'dosya yazıldı')
  t.is(fs.statSync(gorulenDosyasi).mode & 0o777, 0o600)
  ilk.a.kapat()

  // Aynı dosyayla yeniden başlayan işçi
  const ikinci = isciKur(t, { kok, gorulenDosyasi, saat })
  ikinci.a.al(KEREM, Z.TASK, task, 'dogrudan')
  t.is(ikinci.ag[0].type, Z.TASK_REJECT)
  t.is(K.decodeReject(ikinci.ag[0].bytes).code, 'TEKRAR')
  t.absent(ikinci.istemci.giden.some((x) => x.type === IPC.GOREV_HAZIRLA), 'konteyner yeniden kurulmadı')

  // Süresi (deadline) geçen kayıt yüklenmez
  saat.t = G.SIMDI + 2 * G.DAY
  const ucuncu = isciKur(t, { kok, gorulenDosyasi, saat })
  t.is(ucuncu.a.isci.seen.size, 0, 'süresi geçmiş taskId unutuldu')
  // Bozuk dosya işçiyi düşürmez
  fs.writeFileSync(gorulenDosyasi, '{bozuk')
  const dorduncu = isciKur(t, { kok, gorulenDosyasi, saat: { t: G.SIMDI } })
  t.is(dorduncu.a.isci.seen.size, 0)
})

// NODE_RECOVERY (RFC-0007 §8.5 adım 4–6, §13.6): işçi kurtarma anahtarını töreni yapan ebeveyn bağlanınca gönderir;
// yalnız onun imzalı alındısıyla sildirir. Anahtar dosyası denetçi ve yetki yardımcısında (burada sahte kanca).
test('işçi: kurtarma anahtarı töreni yapan ebeveyne NODE_RECOVERY ile; alındıdan sonra silinir', async (t) => {
  const { kurtarma: R } = require('@havenfold/core')
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-ia-'))
  t.teardown(() => fs.rmSync(kok, { recursive: true, force: true }))
  let dosya = b4a.alloc(32, 0x5a)
  const cagri = []
  const kurtarma = {
    oku: async () => { cagri.push('oku'); return dosya ? b4a.from(dosya) : null },
    sil: async () => { cagri.push('sil'); const v = !!dosya; dosya = null; return v }
  }
  const { L, a, ag } = isciKur(t, { kok, saat: { t: G.SIMDI }, kurtarma })
  const ISCI = G.hex(G.C.isci1.memberId)
  const HUSNIYE = G.hex(G.U.husniye.memberId)
  const IREM = G.hex(G.U.irem.memberId)
  const kurtarmalar = () => ag.filter((x) => x.type === Z.NODE_RECOVERY)

  a.baglandi(HUSNIYE) // ebeveyn ama töreni yapan değil
  await new Promise((resolve) => setTimeout(resolve, 20))
  t.is(kurtarmalar().length, 0, 'yalnız töreni yapan ebeveyne')
  a.baglandi(KEREM)
  await bekleyin(() => kurtarmalar().length === 1)
  const giden = kurtarmalar()[0]
  t.is(giden.p, KEREM)
  const d = R.decodeNodeRecovery(giden.bytes)
  t.alike([G.hex(d.m.nodeId), d.m.kind, d.m.secret], [ISCI, 'luks-kurtarma', b4a.alloc(32, 0x5a)])
  t.ok(R.verifyNodeRecovery(L.familyId, d, L.devices.get(ISCI).signPub), 'işçinin imzası')

  // Başkasının ya da başka düğümün alındısı silmez
  const alindi = (imzaci, nodeId = G.C.isci1.memberId) => R.encodeNodeRecovery(L.familyId, { nodeId, kind: 'alindi' }, imzaci)
  a.al(HUSNIYE, Z.NODE_RECOVERY, alindi(G.U.husniye), 'dogrudan')
  a.al(IREM, Z.NODE_RECOVERY, alindi(G.U.irem), 'dogrudan')
  a.al(KEREM, Z.NODE_RECOVERY, alindi(G.U.kerem, G.id16(0x77)), 'dogrudan')
  a.al(KEREM, Z.NODE_RECOVERY, alindi(G.U.husniye), 'dogrudan') // imza gönderenin değil
  a.al(KEREM, Z.NODE_RECOVERY, alindi(G.U.kerem), 'emanet') // yalnız doğrudan
  await new Promise((resolve) => setTimeout(resolve, 20))
  t.absent(cagri.includes('sil'), 'geçersiz alındılar silmedi')
  t.ok(a.ister(Z.NODE_RECOVERY), 'NODE_RECOVERY işçinin ağ tarafına yönlenir')

  a.al(KEREM, Z.NODE_RECOVERY, alindi(G.U.kerem), 'dogrudan')
  await bekleyin(() => cagri.includes('sil'))
  t.is(dosya, null, 'dosya silindi')
  a.baglandi(KEREM)
  await new Promise((resolve) => setTimeout(resolve, 20))
  t.is(kurtarmalar().length, 1, 'teslimden sonra yeniden gönderilmez')
})

test('işçi: kurtarma dosyası yoksa (TPM yok ya da teslim edilmiş) hiçbir şey gitmez', async (t) => {
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-ia-'))
  t.teardown(() => fs.rmSync(kok, { recursive: true, force: true }))
  const kurtarma = { oku: async () => null, sil: async () => false }
  const { a, ag } = isciKur(t, { kok, saat: { t: G.SIMDI }, kurtarma })
  a.baglandi(KEREM)
  await new Promise((resolve) => setTimeout(resolve, 20))
  t.absent(ag.some((x) => x.type === Z.NODE_RECOVERY))
  const hata = { oku: async () => { throw new Error('NO_PERMISSION') }, sil: async () => false }
  const b = isciKur(t, { kok, saat: { t: G.SIMDI }, kurtarma: hata })
  b.a.baglandi(KEREM)
  await new Promise((resolve) => setTimeout(resolve, 20))
  t.absent(b.ag.some((x) => x.type === Z.NODE_RECOVERY), 'okuma hatası işçiyi düşürmez')
})

// Codex 12. tur (D106 K1): telefonun iptal kapısı ailenin aktif cihazlarından da UZAKTAN_IPTAL bitini ister; işçi HELLO'da
// bildirmezse işçili ailede bekleyen uzaktan üyenin daveti hiç iptal edilemez
test('işçinin HELLO yetenekleri: defter v2.1, görev ve uzaktan iptal', (t) => {
  const c = isciCaps(CAPS)
  for (const b of ['LEDGER_V21', 'GOREV', 'UZAKTAN_IPTAL']) t.ok(c & CAPS[b], b)
})
