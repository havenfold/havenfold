// SPDX-License-Identifier: Apache-2.0
// D16 (RFC-0024 §5): SDK'da kademeli kriz sonucu; sınır bilgisi olaya ve geçmişe girmez
const test = require('brittle')
const b4a = require('b4a')
const S = require('..')
const yzc = require('@havenfold/ai')
const A = require('../../core/records/test/helpers/family')
const { sahteGom } = require('../../core/ai/test/helpers/fake-embedding')

const hex = (b) => b4a.toString(b, 'hex')

test('yz.krizDuzeyi ve sor: sınırda yardım önerisi; olay ve geçmiş temiz', async (t) => {
  const L = A.anaDefter()
  const r = A.replika(L, A.K.irem, { now: () => A.TS0 + 3_600_000 })
  const kayit = new S.RecordApi({ replika: r })
  const yz = new S.AiApi({
    kayit,
    me: A.K.irem,
    now: () => A.TS0 + 3_600_000,
    yetenek: () => yzc.yetenek.yetenekKur({ isletim: { id: 'apple-fm', surum: '26.1', tr: true }, bildirim: { platform: [{ id: 'apple-fm', surum: '26.1', tr: true, baglamToken: 4096 }] } }),
    model: async () => ({ metin: 'Cevap.', model: 'telefon/apple-fm@26.1' }),
    gom: { gom: sahteGom }
  })
  yz.krizAnlam.esik = { esik: 1.01, fark: 0, k: 1 }
  yz.krizAnlam.dusuk = { esik: 0.5, fark: 0, k: 1 }
  const olaylar = []
  yz.on('ai', (o) => olaylar.push(o))
  t.is(await yz.crisisLevel('artık var olmak istemiyorum'), 'sinir')
  t.is(await yz.crisisLevel('ölmek istiyorum'), 'tam')
  t.is(await yz.crisisLevel('bugün hava çok güzel parka gidelim'), null)
  const c = await yz.ask({ metin: 'artık var olmak istemiyorum' })
  t.alike([c.yardimOner, c.metin], [true, 'Cevap.'])
  t.alike(olaylar, [{ tur: 'cevap' }], 'olayda sınır bilgisi yok')
  const g = kayit.query(hex(A.K_KISISEL_IREM), { type: 'hf.ai.konusma' })
  t.is(g.length, 1)
  t.absent(JSON.stringify(g[0].fields).includes('yardim'))
})
