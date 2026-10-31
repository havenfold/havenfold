// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// D39 (349459c) bağımsız saldırı testleri: node/box-share.js, node/tpm.js. Yalnız Node (düğüm yazılımı Node'dadır).
// Her test DOĞRU davranışı sınar; "not ok" bulgunun doğrulanmasıdır. Koşturma: node d39-saldiri.js
'use strict'
const W = __dirname + '/../..' // D44: depo kökü (kaynak: kollar/D-inceleme-15-testler/d39-saldiri.js)
const NM = '' // paket adları bulunduğu paketten çözülür
const test = require(NM + 'brittle')
const fs = require('fs')
const os = require('os')
const path = require('path')
const b4a = require(NM + 'b4a')
const S = require(NM + '@havenfold/sdk')
const K = require(NM + '@havenfold/vault')
const { KutuPaylari, DOSYA } = require(W + '/node/box-share.js')
const { taklitTpm } = require(W + '/node/tpm.js')
const A = require(W + '/core/records/test/helpers/family.js')

const hataOf = (fn) => { try { fn(); return null } catch (err) { return err.message } }
const NOW = () => A.TS0 + 3_600_000
const id = (k) => A.hex(k.memberId)
const TPM_ANAHTARI = b4a.alloc(32, 0x39)
const surumOf = (put) => K.teslim.payTeslimiCoz(put.bytes).share.version
const sifirMi = (b) => b.every((x) => x === 0)

function dizin (t) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-d39-saldiri-'))
  t.teardown(() => fs.rmSync(d, { recursive: true, force: true }))
  return d
}

// S1: sürüm 2 payı gelir, PayTutucu.ekle sürüm 1'in pay baytlarını YERİNDE sıfırlar (sodium_memzero), sonra mühürleme
// düşer; payAl'ın geri alması Map'leri sığ kopyadan geri koyar ama sıfırlanmış tamponu geri getiremez. Bellekteki
// sürüm 1 payı artık sıfır; sonraki ilk başarılı mühürleme (başka bir pay, ya da aynı payın tekrarı) sıfırları diske yazar.
test('S1 (D39): mühürleme düşünce geri alınan eski sürüm payı bozulmamalı (bellekte ve sonraki yazımda)', async (t) => {
  const d = dizin(t)
  const L = A.anaDefter()
  const kerem = new S.VaultApi({ ledger: L, me: A.K.kerem, now: NOW, uygunCihaz: (x) => x === id(A.K.kutu) })
  await kerem.setupRecoveryKey(A.hex(A.K_KASA), b4a.alloc(32, 3), { kagit: 0 })
  const put1 = kerem.outgoing().find((x) => x.to === id(A.K.kutu))
  let dus = false
  // D44 uyarlaması: taklit mühür artık yalnız taklitTpm'nin ürettiği nesne (inceleme 15 şüphelisi); düşen mühürleme
  // sarmalayıcıyla değil, taklidin test seçeneğiyle
  const tpm = taklitTpm({ test: true, anahtar: TPM_ANAHTARI, muhurleOncesi: () => { if (dus) throw new Error('TPM_BUSY') } })
  const kp = new KutuPaylari({ ledger: L, me: A.K.kutu, dizin: d, tpm, now: NOW, testKipi: true })
  t.is(kp.payAl(id(A.K.kerem), put1.bytes, 'dogrudan').durum, 'yeni')
  t.is(kerem.receiveAck(id(A.K.kutu), kp.payAl(id(A.K.kerem), put1.bytes, 'dogrudan').bytes, 'dogrudan'), 'teslim')
  const k1 = kp.liste()[0]
  const dogru = b4a.from(kp.tutucu.paylar.get(k1).share.share)

  // Döndürme: sürüm 2
  await kerem.setupRecoveryKey(A.hex(A.K_KASA), b4a.alloc(32, 4), { kagit: 0 })
  const put2 = kerem.outgoing().find((x) => x.to === id(A.K.kutu) && surumOf(x) === 2)
  if (!put2) { t.fail('sürüm 2 payı üretilemedi (fikstür)'); return }
  dus = true
  t.is(hataOf(() => kp.payAl(id(A.K.kerem), put2.bytes, 'dogrudan')), 'TPM_BUSY', 'mühürleme düştü, alındı yok')
  dus = false
  t.alike(kp.liste(), [k1], 'geri alındı: yalnız sürüm 1')
  t.absent(sifirMi(kp.tutucu.paylar.get(k1).share.share), 'bellekteki sürüm 1 payı sıfırlanmamalı')
  // Gönderen sürüm 1'i yeniden gönderirse (ör. alındı kayboldu) "tekrar" olmalı
  t.is(hataOf(() => kp.payAl(id(A.K.kerem), put1.bytes, 'dogrudan')), null, 'sürüm 1 tekrarı DUPLICATE_HOLDER olmamalı')
  // Sonraki ilk başarılı yazım (burada doğrudan; gerçekte başka bir sırrın payı) sıfırları diske yazar mı
  kp._yaz()
  const yeniden = new KutuPaylari({ ledger: L, me: A.K.kutu, dizin: d, tpm: taklitTpm({ test: true, anahtar: TPM_ANAHTARI }), now: NOW, testKipi: true })
  const diskte = yeniden.tutucu.paylar.get(k1)
  t.ok(diskte && b4a.equals(diskte.share.share, dogru), 'yeniden başlatmada sürüm 1 payı doğru baytlarla açılmalı')
})

// S2 (tasarım/şüpheli): taklit denetimi yalnız `taklit` özelliğine bakar; özelliği taşımayan bir sarmalayıcı (ya da
// muhurle = kimlik işlevi) test kipi olmadan kabul edilir ve payı düz yazar. Üretimde KutuPaylari'yi kuran yol yok.
test('S2 (D39, şüpheli): mühür arayüzü kimlik işleviyse (düz yazım) test kipi olmadan kabul edilmemeli', async (t) => {
  const d = dizin(t)
  const L = A.anaDefter()
  const kerem = new S.VaultApi({ ledger: L, me: A.K.kerem, now: NOW, uygunCihaz: (x) => x === id(A.K.kutu) })
  await kerem.setupRecoveryKey(A.hex(A.K_KASA), b4a.alloc(32, 3), { kagit: 0 })
  const put = kerem.outgoing().find((x) => x.to === id(A.K.kutu))
  const duz = { muhurle: (b) => b4a.from(b), ac: (m) => b4a.from(m) }
  const e = hataOf(() => new KutuPaylari({ ledger: L, me: A.K.kutu, dizin: d, tpm: duz, now: NOW }))
  t.is(e, 'NO_TPM', 'gerçek TPM olduğu kanıtlanmayan mühür reddedilmeli')
  if (e) return
  const kp = new KutuPaylari({ ledger: L, me: A.K.kutu, dizin: d, tpm: duz, now: NOW })
  kp.payAl(id(A.K.kerem), put.bytes, 'dogrudan')
  const pay = K.teslim.payTeslimiCoz(put.bytes).share.share
  t.comment('dosyada pay düz mü: ' + fs.readFileSync(path.join(d, DOSYA)).includes(b4a.toString(pay, 'hex')))
})
