// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// D104: Wi-Fi Direct / Multipeer yükseltmesi (RFC-0012 §6.1, §6.5). Bellek içi akış çifti üstünde Noise + HELLO bağ
// oturumu; iki yönde bekleyen mesaj eşiği aşılınca grup sahibi (bağı başlatmayan) AFET_LINK_UP gönderir. Vektör
// protocol/vectors/disaster-normal-path.json (elle yazıldı).
const test = require('brittle')
const b4a = require('b4a')
const { Duplex } = require('streamx')
const M = require('../message')
const T = require('../derivation')
const Y = require('../local')
const { ZINCIR, KIMLIK, defter, ciftler, cihaz } = require('./helpers/disaster-vector')
const V = require('../../../protocol/vectors/disaster-normal-path.json')

const GUN = 20750
const AN = GUN * 86_400_000 + 15 * 3_600_000
const L = defter(ZINCIR)
const id = (ad) => KIMLIK[ad].memberId
const cift = (ben, karsi) => ciftler(L, KIMLIK[ben]).find((x) => b4a.equals(x.id, id(karsi)))
const durum = (no) => V.durumlar.find((d) => d.no === no)

function akisCifti () {
  let a = null
  let b = null
  const yap = (karsi) => new Duplex({ write (d, cb) { karsi().push(d); cb() }, final (cb) { karsi().push(null); cb() }, predestroy () { karsi().destroy() } })
  a = yap(() => b)
  b = yap(() => a)
  return [a, b]
}

async function esitle (c, ben, karsi, yuk) {
  const [x, y] = akisCifti()
  const [a, b] = await Promise.all([
    Y.bagKur({ ham: x, baslatan: true, me: KIMLIK[ben], L, eslesme: { cift: cift(ben, karsi), dilim: T.dilimOf(AN) }, bag: Y.BAG.BLUETOOTH }),
    Y.bagKur({ ham: y, baslatan: false, me: KIMLIK[karsi], L, ciftler: ciftler(L, KIMLIK[karsi]), simdi: AN, bag: Y.BAG.BLUETOOTH })
  ])
  return Promise.all([Y.afetEsitle(a, c[ben], { sessizMs: 30, yukseltme: yuk[ben] }), Y.afetEsitle(b, c[karsi], { sessizMs: 30, yukseltme: yuk[karsi] })])
}

// Gönderim aralığı sınırı için saat her mesajda ilerler
function yaz (c, s, ben, karsi, n) {
  for (let i = 0; i < n; i++) { s.t += 10 * 60_000; c[ben].gonder({ to: id(karsi), kind: M.KIND.METIN, text: ben + ' ' + i }) }
}

test('vektör b: iki yönde 21 mesaj — grup sahibi teklif eder, başlatan alır; eşik altında yükseltme yok', async (t) => {
  const d = durum('b')
  const s = { t: AN }
  const saat = () => s.t
  const c = { kerem: cihaz(L, 'kerem', saat), husniye: cihaz(L, 'husniye', saat) }
  yaz(c, s, 'kerem', 'husniye', d.kerem)
  yaz(c, s, 'husniye', 'kerem', d.husniye)
  const olan = { iste: [], geldi: [] }
  const yuk = {
    kerem: { iste: () => { olan.iste.push('kerem'); return d.teklif }, geldi: (x) => olan.geldi.push(['kerem', x]) },
    husniye: { iste: async () => { olan.iste.push('husniye'); return d.teklif }, geldi: (x) => olan.geldi.push(['husniye', x]) }
  }
  const [k, h] = await esitle(c, 'kerem', 'husniye', yuk)
  t.alike(olan.iste, ['husniye'], 'yalnız grup sahibi (bağı başlatmayan) ister, bir kez')
  t.alike(olan.geldi, [['kerem', d.teklif]], 'başlatan AFET_LINK_UP\'ı alır')
  t.is(k.alinan.length, d.husniye)
  t.is(h.alinan.length, d.kerem)
  // Eşik altında (toplam 20) yükseltme yok
  const s2 = { t: AN }
  const c2 = { kerem: cihaz(L, 'kerem', () => s2.t), husniye: cihaz(L, 'husniye', () => s2.t) }
  yaz(c2, s2, 'kerem', 'husniye', 10)
  yaz(c2, s2, 'husniye', 'kerem', 10)
  const olan2 = []
  await esitle(c2, 'kerem', 'husniye', { kerem: { iste: () => olan2.push('k'), geldi: () => olan2.push('g') }, husniye: { iste: () => { olan2.push('h'); return d.teklif }, geldi: () => olan2.push('g') } })
  t.alike(olan2, [], '20 mesajda yükseltme yok (eşik aşılınca)')
})

test('AFET_LINK_UP kodlaması kanonik; bağ dışı türde değil', (t) => {
  const d = durum('b')
  const b = M.kodla(M.Z.AFET_LINK_UP, d.teklif)
  t.alike(M.coz(M.Z.AFET_LINK_UP, b), d.teklif)
  t.is(Y.kapi(Y.BAG.BLUETOOTH, M.Z.AFET_LINK_UP), null)
  t.is(V.esik.adet, 20)
})

// Codex 7. tur: geçersiz teklif platforma geçmez (oturum biter), geçerli teklif oturumda bir kez verilir; uygulamanın kendi
// geçersiz teklifi gönderilmez
test('Codex 7. tur: AFET_LINK_UP teklifi doğrulanır ve oturum başına bir kez', async (t) => {
  const d = durum('b')
  t.is(M.linkHatasi(d.teklif), null, 'vektördeki teklif geçerli')
  for (const x of [{ kind: 99, name: 'x', pass: 'parola123', port: 1 }, { kind: 0, name: 'x', pass: 'kisa', port: 47871 }, { kind: 0, name: 'x', pass: 'parola123', port: 70000 },
    { kind: 0, name: '', pass: 'parola123', port: 1 }, { kind: 0, name: 'x'.repeat(33), pass: 'parola123', port: 1 }, { kind: 1, name: 'baska', pass: '', port: 0 }, { kind: 1, name: 'hf-afet', pass: 'p', port: 0 }]) {
    t.is(M.linkHatasi(x), 'INVALID_DISASTER_LINK', JSON.stringify(x))
  }
  t.is(M.linkHatasi({ kind: 1, name: 'hf-afet', pass: '', port: 0 }), null, 'Multipeer')
  const cerceve = (x) => b4a.concat([b4a.from([M.Z.AFET_LINK_UP]), M.kodla(M.Z.AFET_LINK_UP, x)])
  const oturum = async (gonderilecek) => {
    const s = { t: AN }
    const c = { kerem: cihaz(L, 'kerem', () => s.t), husniye: cihaz(L, 'husniye', () => s.t) }
    yaz(c, s, 'kerem', 'husniye', 2)
    const [x, y] = akisCifti()
    const [a, b] = await Promise.all([
      Y.bagKur({ ham: x, baslatan: true, me: KIMLIK.kerem, L, eslesme: { cift: cift('kerem', 'husniye'), dilim: T.dilimOf(AN) }, bag: Y.BAG.BLUETOOTH }),
      Y.bagKur({ ham: y, baslatan: false, me: KIMLIK.husniye, L, ciftler: ciftler(L, KIMLIK.husniye), simdi: AN, bag: Y.BAG.BLUETOOTH })
    ])
    const geldi = []
    const yk = { iste: () => null, geldi: (z) => geldi.push(z) }
    const yh = { iste: () => null }
    const p = Promise.all([Y.afetEsitle(a, c.kerem, { sessizMs: 30, yukseltme: yk }), Y.afetEsitle(b, c.husniye, { sessizMs: 30, yukseltme: yh })])
    for (const z of gonderilecek) b.gonder(cerceve(z)) // grup sahibinin ham çerçeveleri
    const [k] = await p
    return { geldi, k, yh }
  }
  const bozuk = await oturum([{ kind: 99, name: 'x', pass: '', port: 70000 }])
  t.alike(bozuk.geldi, [], 'geçersiz teklif platforma verilmedi')
  t.is(bozuk.k.kapandi, 'INVALID_DISASTER_LINK', 'oturum bozuk teklifle bitti')
  const cok = await oturum([d.teklif, d.teklif, d.teklif])
  t.alike(cok.geldi, [d.teklif], 'geçerli teklif bir kez')
})
