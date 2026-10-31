// SPDX-License-Identifier: Apache-2.0
// D36: inceleme 13'ün "bu PR'da kapanacak şüpheliler"i (SDK tarafı). Beklenenler elle yazıldı.
const test = require('brittle')
const b4a = require('b4a')
const S = require('..')
const A = require('../../core/records/test/helpers/family')

const hex = (b) => b4a.toString(b, 'hex')
const hataOfA = async (fn) => { try { await fn(); return null } catch (err) { return err.message } }
const HIZLI = { opslimit: 3, memlimit: 64 * 1024 * 1024 }
const PAROLA = 'yirmi-dort-karakterli-p'

test('tören: eşzamanlı iki davet tek oturum açar (ikincisi CEREMONY_IN_PROGRESS); taşıyıcı düşerse yeniden denenebilir', async (t) => {
  const L = A.anaDefter()
  let bekle = null
  let cagri = 0
  const oturum = () => ({ on () {}, confirm () {}, cancel () {} })
  const tas = { davet: () => { cagri++; return new Promise((resolve, reject) => { bekle = { resolve, reject } }) }, katil: async () => oturum() }
  const toren = new S.CeremonyApi({ ledger: L, me: A.K.kerem, tasiyici: tas })
  const ilk = toren.startInvite('uye', 'cocuk')
  t.is(await hataOfA(() => toren.startInvite('uye', 'cocuk')), 'CEREMONY_IN_PROGRESS', 'ikinci davet taşıyıcıya gitmez')
  t.is(cagri, 1)
  bekle.reject(new Error('NO_NETWORK'))
  t.is(await hataOfA(() => ilk), 'NO_NETWORK')
  const ucuncu = toren.startInvite('uye', 'cocuk')
  bekle.resolve(oturum())
  t.alike(await ucuncu, { ttlSec: 180 }, 'hazırlık bitince yeni davet açılır')
  t.ok(toren.inProgress)
})

test('kap: gizli alan kancası verilmezse gizli alanlar dışarıda bırakılamaz (NO_EXPORT_SECRET_HOOK); gizli alanın adı yapay zeka listesinde görünmez', async (t) => {
  const L = A.anaDefter()
  const kayit = new S.RecordApi({ replika: A.replika(L, A.K.husniye) })
  const TA = hex(A.K_TUM_AILE)
  kayit._yaz(TA, null, 'yuva.defter.sifre', { ad: 'Banka', parola: 'gizli123', _ai: ['ad', 'parola'], _aiyol: 'kural/1' })
  const kancasiz = new S.ExportApi({ kayit, kdf: HIZLI })
  t.is(await hataOfA(() => kancasiz.export({ koleksiyonlar: [TA], parola: PAROLA })), 'NO_EXPORT_SECRET_HOOK')
  t.ok((await kancasiz.export({ koleksiyonlar: [TA], parola: PAROLA, gizliDahil: true })).bytes, 'gizliler dahil istenirse kanca gerekmez')
  const kap = new S.ExportApi({ kayit, kdf: HIZLI, gizliAlanlar: (tur) => (tur === 'yuva.defter.sifre' ? ['parola'] : []) })
  const r = await kap.export({ koleksiyonlar: [TA], parola: PAROLA })
  const k = (await kap.import({ bytes: r.bytes, parola: PAROLA })).icerik.koleksiyonlar[0].kayitlar[0]
  t.absent('parola' in k.alanlar)
  t.alike(k.yapay_zeka_alanlari, ['ad'], 'gizli alanın adı da çıkmaz')
})
