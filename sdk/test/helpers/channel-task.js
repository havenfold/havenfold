// SPDX-License-Identifier: Apache-2.0
// protocol/vectors/channel-task.json üreticisi (RFC-0002 §14 ve Ek: RFC-0033 §9 s; RFC-0024 §2). Belirlenimci: görev
// vektörlerinin ailesi (core/tasks/test/helpers/task.js), sabit zaman, sayaçlı tutamaç ve taskId, Ed25519.
//
// Akış uygulama tarafından görülen çerçevelerdir: istek → cevap, TaskApi'nin işçiye gönderdiği zarflar (giden) ve
// uygulamaya giden olay çerçeveleri. İşçinin cevapları (TASK_ACCEPT, TASK_PROGRESS, TASK_RESULT) 'gelen' adımlarıdır.
// Sunucu worklet/task-channel.js'tir; çerçeve JSON'u worklet/channel-json.js ile ({ $b } baytlar).
const b4a = require('b4a')
const { zarf: { Z } } = require('@havenfold/core')
const { kodlama: K, yetenek: { YetenekDefteri } } = require('@havenfold/tasks')
const S = require('../..')
const G = require('../../../core/tasks/test/helpers/task')
const { taskChannel } = require('../../../worklet/task-channel')
const { kodla, coz } = require('../../../worklet/channel-json')

const { C, U, hex, SIMDI, K_TUM_AILE, K_OLAYLAR, id32 } = G
const ISCI = hex(C.isci1.memberId)

async function akis () {
  const L = G.defter()
  const now = () => SIMDI
  const y = new YetenekDefteri({ ledger: L, now })
  y.al(G.capsBayt(L, C.isci1), { from: ISCI })
  let sayac = 0
  const giden = []
  const gorev = new S.TaskApi({
    ledger: L, me: U.kerem, yetenekler: y, now,
    rastgele: () => b4a.alloc(16, 0xa0 + (++sayac)),
    gonder: (p, type, bytes) => giden.push({ kime: p, tur: type, bayt: hex(bytes) })
  })
  const k = taskChannel({ nesneler: { aile: true, gorev } })
  const olaylar = []
  k.olaylariBagla((metin) => olaylar.push(JSON.parse(metin)))
  let id = 0
  const adimlar = []
  const kaydet = (adim) => { adimlar.push({ ...adim, giden: giden.splice(0), olaylar: olaylar.splice(0) }) }

  // Uygulamanın çerçevesi → ürün sunucusunun yaptığı gibi çöz, işle, kodla
  async function iste (komut, govde) {
    const istek = { id: ++id, komut, govde }
    const j = JSON.parse(JSON.stringify(istek))
    let cevap
    try {
      cevap = { id: j.id, sonuc: kodla(await k.isleyiciler[j.komut](coz(j.govde))) }
    } catch (err) {
      cevap = { id: j.id, hata: err.message }
    }
    kaydet({ istek, cevap: JSON.parse(JSON.stringify(cevap)) })
    return cevap
  }
  function gelen (ad, type, bytes) {
    gorev.receive(ISCI, type, bytes, 'dogrudan')
    kaydet({ gelen: { ad, kimden: ISCI, tur: type, bayt: hex(bytes) } })
  }

  const girdi = { blobId: { $b: b4a.toString(id32(0x61), 'base64') }, fileKey: { $b: b4a.toString(id32(0x62), 'base64') }, size: 1_048_576, mime: 'application/pdf' }
  const opts = { collectionId: hex(K_TUM_AILE), ramMB: 2048, minutes: 30, diskMB: 1024, deadline: SIMDI + 3_600_000 }
  const ocr = { type: 'hf.task.ocr', version: '1.1.0', inputs: [girdi], params: { langs: ['tur'], output: 'text' }, opts }

  await iste(252, {})
  await iste(253, {})
  await iste(250, ocr) // onaysız işçi seçilmez (RFC-0002 §7)
  await iste(254, { deviceId: ISCI, allow: true })
  const r = await iste(250, ocr)
  const taskId = b4a.from(r.sonuc.taskIds[0], 'hex')
  gelen('TASK_ACCEPT', Z.TASK_ACCEPT, K.encodeAccept({ taskId, etaSec: 90 }))
  gelen('TASK_PROGRESS', Z.TASK_PROGRESS, K.encodeProgress({ taskId, pct: 62, note: 'sayfa 17' }))
  gelen('TASK_RESULT', Z.TASK_RESULT, K.encodeResult({ taskId, status: 'ok', outputs: [], inline: b4a.from('Kira sözleşmesi, sayfa 1'), log: 'ocrmypdf 16.0' }))
  const r2 = await iste(250, ocr)
  await iste(251, { id: r2.sonuc.id })
  await iste(251, { id: r2.sonuc.id }) // bitmiş iş: sessiz
  await iste(251, { id: '00'.repeat(16) })
  await iste(250, { ...ocr, opts: { ...opts, collectionId: 'kasa' } })
  await iste(250, { ...ocr, inputs: [{ ...girdi, blobId: { $b: 'AA==' } }] })
  await iste(255, { type: 'hf.task.vision', version: '1.0.0', deviceId: ISCI, params: { kaynak: 'kapi' }, opts: { collectionId: hex(K_OLAYLAR), ramMB: 512, deadline: SIMDI + 86_400_000 } })
  await iste(254, { deviceId: ISCI, allow: 'evet' })
  return adimlar
}

// Aile yokken
async function ailesiz () {
  const k = taskChannel({ nesneler: { aile: false, gorev: null } })
  const out = {}
  for (const no of [250, 251, 252, 253, 254, 255]) {
    try { await k.isleyiciler[no]({}); out[no] = null } catch (err) { out[no] = err.message }
  }
  return out
}

module.exports = { akis, ailesiz, ISCI }
