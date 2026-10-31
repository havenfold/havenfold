// SPDX-License-Identifier: Apache-2.0
// D42: docs/sdk-rehberi.md'deki örnekler (sdk/test/guide-examples.js, scripts/guide-gen.js üretir) Node'da ve Bare'de
// koşar. Örneklerin test yardımcıları: ornekKanal (uygulama tarafı IPC), ornekAile (defter v2.1 ana zinciri; örneklerde
// alex ve maya adıyla geçen kimlikler zincirin donmuş test kimlikleridir: kerem, irem; kayıt yüzü husniye'nin), geciciDizin.
const test = require('brittle')
const b4a = require('b4a')
const S = require('..')
const A = require('../../core/records/test/helpers/family')
const W = require('../../worklet/test/helpers/common')
const ORNEKLER = require('./guide-examples')

const isteKok = (ad) => {
  if (ad === '@havenfold/worklet') return require('../../worklet')
  if (ad.startsWith('@havenfold/worklet')) return require('../../worklet/' + ad.slice('@havenfold/worklet'.length))
  return require(ad)
}

function baglam (t) {
  return {
    require: isteKok,
    assert: (kosul, mesaj = 'beklenen') => { if (!kosul) throw new Error('ORNEK_DUSTU: ' + mesaj) },
    geciciDizin: () => W.geciciDizin(t, 'rehber'),
    ornekKanal: () => {
      const ipc = W.ipcCifti()
      const c = W.istemci(ipc)
      return { ipc, iste: (komut, govde) => c.iste(komut, govde), olaylar: c.olaylar }
    },
    ornekAile: () => {
      const L = A.anaDefter()
      const kayit = new S.RecordApi({ replika: A.replika(L, A.K.husniye) })
      return {
        ledger: L, alex: A.K.kerem, maya: A.K.irem, kayit,
        TA: b4a.toString(A.K_TUM_AILE, 'hex'), bakici: b4a.toString(A.K_BAKICI, 'hex'),
        arsiv: W.arsivAnahtari(42), arsivCifti: { eski: W.arsivAnahtari(43), yeni: W.arsivAnahtari(44) }
      }
    }
  }
}

for (const [ad, ornek] of Object.entries(ORNEKLER)) {
  test('rehber örneği: ' + ad, { timeout: 60000 }, async (t) => {
    await ornek(baglam(t))
    t.pass(ad)
  })
}
