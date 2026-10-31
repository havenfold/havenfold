// SPDX-License-Identifier: Apache-2.0
// D46: kişisel köprü SDK yüzeyi (RFC-0005 §15; 288 BRIDGE_PREPARE, 289 BRIDGE_RECEIVE). Beklenen değerler elle.
const test = require('brittle')
const S = require('..')

const hataOf = (fn) => { try { fn(); return null } catch (err) { return err.message } }
const bellek = () => { const m = new Map(); return { get: (k) => (m.has(k) ? m.get(k) : null), set: (k, v) => m.set(k, v) } }

test('288/289: düğme varsayılan kapalı; kişi açınca paket hazırlanır, öbür uygulama önizler; tekrar ve ters yön reddedilir', (t) => {
  let saat = 1_790_000_000_000
  const now = () => ++saat
  const mekan = new S.BridgeApi({ kendi: 'ekip', saklama: bellek(), now })
  const yuva = new S.BridgeApi({ kendi: 'aile', saklama: bellek(), now })
  t.alike(mekan.kinds(), ['mekan.durum.giris', 'mekan.durum.cikis', 'mekan.durum.gec', 'mekan.durum.serbest'])
  t.alike(mekan.buttons(), [], 'varsayılan: hiçbiri')
  t.is(hataOf(() => mekan.prepare({ type: 'mekan.durum.cikis', text: 'Çıktım' })), 'BRIDGE_DISABLED')
  t.is(hataOf(() => mekan.buttons(['yuva.durum.gec'])), 'BRIDGE_TYPE', 'aile türü ekip uygulamasında yok')
  t.alike(mekan.buttons(['mekan.durum.cikis', 'mekan.durum.gec']), ['mekan.durum.cikis', 'mekan.durum.gec'])
  t.is(hataOf(() => mekan.prepare({ type: 'mekan.kamera.olay', text: 'x' })), 'BRIDGE_TYPE', 'iş verisi geçmez')
  t.is(hataOf(() => mekan.prepare({ type: 'mekan.durum.cikis', text: 'x'.repeat(281) })), 'BRIDGE_TEXT')
  const { metin, yol } = mekan.prepare({ type: 'mekan.durum.cikis', text: 'Çıktım' })
  t.is(yol, 'metin')
  t.ok(metin.startsWith('hfkopru1:'))
  const o = yuva.receive(metin)
  t.alike({ from: o.from, type: o.type, text: o.text, etiket: o.etiket }, { from: 'ekip', type: 'mekan.durum.cikis', text: 'Çıktım', etiket: 'is' })
  t.is(hataOf(() => yuva.receive(metin)), 'BRIDGE_REPLAY')
  t.is(hataOf(() => mekan.receive(metin)), 'BRIDGE_DIRECTION', 'kendi paketini almaz')
  // Ters yön ve platform yolu
  const birakilan = []
  const yuva2 = new S.BridgeApi({ kendi: 'aile', saklama: bellek(), now, kanal: { birak: (m) => birakilan.push(m) } })
  yuva2.buttons(['yuva.durum.gec'])
  t.is(yuva2.prepare({ type: 'yuva.durum.gec', text: 'Geç kalacağım' }).yol, 'kanal')
  t.is(mekan.receive(birakilan[0]).etiket, 'aile')
  t.is(hataOf(() => new S.BridgeApi({ kendi: 'kisi' })), 'INVALID_BRIDGE')
})

test('kanal: 288–289 CHANNEL_COMMAND\'ta ve BridgeApi yöntemine bağlı', (t) => {
  t.alike([S.CHANNEL_COMMAND.BRIDGE_PREPARE, S.CHANNEL_COMMAND.BRIDGE_RECEIVE], [288, 289])
  t.alike(S.BRIDGE_COMMAND, { BRIDGE_PREPARE: 288, BRIDGE_RECEIVE: 289 })
})
