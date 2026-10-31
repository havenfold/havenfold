// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// D39: kutuda pay tutma (RFC-0004 §3.1, §4.4): TPM mühürlü dosya, alındı yazımdan sonra, yeniden başlatmada mühürden.
// Beklenenler elle yazıldı.
const test = require('brittle')
const fs = require('fs')
const os = require('os')
const path = require('path')
const b4a = require('b4a')
const S = require('@havenfold/sdk')
const { KutuPaylari, DOSYA } = require('../box-share')
const { sistemTpm, taklitTpm } = require('../tpm')
const A = require('../../core/records/test/helpers/family')

const hataOf = (fn) => { try { fn(); return null } catch (err) { return err.message } }
const NOW = () => A.TS0 + 3_600_000
const id = (k) => A.hex(k.memberId)
const TPM_ANAHTARI = b4a.alloc(32, 0x39)

function dizin (t) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-kutu-pay-'))
  t.teardown(() => fs.rmSync(d, { recursive: true, force: true }))
  return d
}

async function kurulum () {
  const L = A.anaDefter()
  const kerem = new S.VaultApi({ ledger: L, me: A.K.kerem, now: NOW, uygunCihaz: (x) => x === id(A.K.kutu) })
  await kerem.setupRecoveryKey(A.hex(A.K_KASA), b4a.alloc(32, 3), { kagit: 0 })
  return { L, kerem, put: kerem.outgoing().find((x) => x.to === id(A.K.kutu)) }
}

test('TPM: gerçek bağlama yokken NO_TPM; taklit yalnız açıkça test kipinde', (t) => {
  t.is(hataOf(() => sistemTpm()), 'NO_DIR') // D76: gerçek TPM dizin ister
  t.is(hataOf(() => sistemTpm({ dizin: dizin(t), araclar: '/olmayan/dizin' })), 'NO_TPM', 'tpm2-tools yoksa NO_TPM')
  t.is(hataOf(() => taklitTpm()), 'NO_TPM')
  t.is(hataOf(() => new KutuPaylari({ ledger: A.anaDefter(), me: A.K.kutu, dizin: os.tmpdir(), tpm: taklitTpm({ test: true }) })), 'NO_TPM', 'test kipi olmadan taklit kabul edilmez')
  t.is(hataOf(() => new KutuPaylari({ ledger: A.anaDefter(), me: A.K.kutu, dizin: os.tmpdir(), tpm: null })), 'NO_TPM')
})

test('kutu KRA payını alır: önce mühürlü dosya, sonra alındı (teslim); dosyada pay düz yok; yeniden başlatmada mühürden', async (t) => {
  const d = dizin(t)
  const { L, kerem, put } = await kurulum()
  t.ok(put, 'kutu KRA payının sahibi (uygun cihaz)')
  const kp = new KutuPaylari({ ledger: L, me: A.K.kutu, dizin: d, tpm: taklitTpm({ test: true, anahtar: TPM_ANAHTARI }), now: NOW, testKipi: true })
  t.is(hataOf(() => kp.payAl(id(A.K.kerem), put.bytes, 'posta')), 'MAILBOX_FORBIDDEN')
  const a = kp.payAl(id(A.K.kerem), put.bytes, 'dogrudan')
  t.is(a.durum, 'yeni')
  t.ok(fs.existsSync(path.join(d, DOSYA)), 'mühürlü dosya alındıdan önce yazıldı')
  const pay = require('@havenfold/vault').teslim.payTeslimiCoz(put.bytes).share
  t.absent(fs.readFileSync(path.join(d, DOSYA)).includes(pay.share), 'pay baytları dosyada düz değil')
  t.is(kerem.receiveAck(id(A.K.kutu), a.bytes, 'dogrudan'), 'teslim')
  t.is(kp.payAl(id(A.K.kerem), put.bytes, 'dogrudan').durum, 'tekrar', 'aynı pay ikinci kez: alındı yeniden')
  const yeniden = new KutuPaylari({ ledger: L, me: A.K.kutu, dizin: d, tpm: taklitTpm({ test: true, anahtar: TPM_ANAHTARI }), now: NOW, testKipi: true })
  t.alike(yeniden.liste(), kp.liste(), 'yeniden başlatmada pay mühürden açıldı')
  t.is(yeniden.liste().length, 1)
  t.is(hataOf(() => new KutuPaylari({ ledger: L, me: A.K.kutu, dizin: d, tpm: taklitTpm({ test: true }), now: NOW, testKipi: true })), 'SEAL_CORRUPT', 'başka mühür anahtarı açamaz')
})

test('mühürleme düşerse alındı gitmez ve pay tutulmaz; işçi kutunun payını almaz (WRONG_HOLDER)', async (t) => {
  const { L, put } = await kurulum()
  const bozuk = taklitTpm({ test: true, muhurleOncesi: () => { throw new Error('NO_TPM') } })
  const kp = new KutuPaylari({ ledger: L, me: A.K.kutu, dizin: dizin(t), tpm: bozuk, now: NOW, testKipi: true })
  t.is(hataOf(() => kp.payAl(id(A.K.kerem), put.bytes, 'dogrudan')), 'NO_TPM')
  t.alike(kp.liste(), [], 'mühürlenmeyen pay bellekte de kalmaz')
  const isci = new KutuPaylari({ ledger: L, me: A.C.isci1, dizin: dizin(t), tpm: taklitTpm({ test: true }), now: NOW, testKipi: true })
  t.is(hataOf(() => isci.payAl(id(A.K.kerem), put.bytes, 'dogrudan')), 'WRONG_HOLDER')
})
