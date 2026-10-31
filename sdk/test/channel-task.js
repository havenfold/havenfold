// SPDX-License-Identifier: Apache-2.0
// Görev kanal komutları (protocol/vectors/channel-task.json; RFC-0002 §14 ve Ek: RFC-0033 §9 s; RFC-0024 §2–§4):
// numaralar SDK sabitleriyle aynı, her komutun SDK yöntemi var; worklet/task-channel.js sunucusunun çerçeve akışı
// (istek → cevap, işçiye giden zarflar, 'gorev' olayları) vektördekiyle bayt bayt aynı.
const test = require('brittle')
const b4a = require('b4a')
const { zarf: { Z } } = require('@havenfold/core')
const { kodlama: K } = require('@havenfold/tasks')
const S = require('..')
const F = require('../../protocol/vectors/channel-task.json')
const H = require('./helpers/channel-task')
const G = require('../../core/tasks/test/helpers/task')

test('kanal-gorev: 250–255 CHANNEL_COMMAND\'ta, her biri TaskApi yöntemine bağlı; 256–259 boş', (t) => {
  t.alike(F.komutlar.map((k) => k.no), [250, 251, 252, 253, 254, 255])
  for (const k of F.komutlar) {
    t.is(S.CHANNEL_COMMAND[k.ad], k.no, k.ad)
    const [sinif, yontem] = k.sdk.split('.')
    t.is(typeof S[sinif].prototype[yontem], 'function', k.sdk)
  }
  for (const n of F.bos) t.absent(Object.values(S.CHANNEL_COMMAND).includes(n), n + ' boş')
})

test('kanal-gorev: aile yokken her komut NO_IDENTITY', async (t) => {
  t.alike(await H.ailesiz(), F.ailesiz)
  t.ok(Object.values(F.ailesiz).every((x) => x === 'NO_IDENTITY'))
})

test('kanal-gorev: çerçeve akışı vektörle aynı', async (t) => {
  const a = await H.akis()
  t.is(a.length, F.akis.length)
  for (let i = 0; i < F.akis.length; i++) t.alike(a[i], F.akis[i], 'adım ' + (i + 1) + ': ' + (F.akis[i].istek ? F.akis[i].istek.komut : F.akis[i].gelen.ad))
})

test('kanal-gorev: giden TASK isteyen imzalı, işçiye, params UTF-8 JSON; iptal TASK_CANCEL; sürekli görev standing', (t) => {
  const L = G.defter()
  const tasklar = F.akis.flatMap((x) => x.giden).filter((g) => g.tur === Z.TASK).map((g) => ({ ...g, ...K.decodeTask(b4a.from(g.bayt, 'hex')) }))
  t.is(tasklar.length, 3)
  for (const x of tasklar) {
    t.is(x.kime, H.ISCI)
    t.ok(K.verifySig(K.ETIKET.TASK, L.familyId, x.body, x.sig, G.U.kerem.signPub || L.entity(b4a.toString(G.U.kerem.memberId, 'hex')).signPub), 'isteyen imzası')
    t.is(b4a.toString(x.m.workerId, 'hex'), H.ISCI)
  }
  t.alike(JSON.parse(b4a.toString(tasklar[0].m.params)), { langs: ['tur'], output: 'text' })
  t.alike([tasklar[0].m.standing, tasklar[2].m.standing, tasklar[2].m.type], [false, true, 'hf.task.vision'])
  const iptal = F.akis.flatMap((x) => x.giden).filter((g) => g.tur === Z.TASK_CANCEL)
  t.is(iptal.length, 1)
  const c = K.decodeCancel(b4a.from(iptal[0].bayt, 'hex'))
  t.is(b4a.toString(c.m.taskId, 'hex'), tasklar[1].m.taskId.toString('hex'), 'ikinci işin görevi iptal')
  // Olaylar: ilerleme, sonuç ve iptal sonucu tutamaçla
  const olaylar = F.akis.flatMap((x) => x.olaylar).map((o) => o.veri)
  t.alike(olaylar.map((o) => [o.id, o.tur, o.status || o.pct]), [
    ['a1'.repeat(16), 'progress', 62], ['a1'.repeat(16), 'result', 'ok'], ['a3'.repeat(16), 'result', 'iptal']
  ])
})
