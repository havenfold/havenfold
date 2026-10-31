// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// vector-check.js — vektörlerin bağımsız yeniden üretimi (D27)
//
// Her protocol/vectors/*.json dosyasını, üreticisini çalıştırmadan, onu okuyan testlerin kendisiyle yeniden hesaplar:
// testler dosyadaki girdilerden sonucu kitaplıkla hesaplayıp dosyadaki beklenenle karşılaştırır. "Üretici aynı dosyayı
// verir" testleri atlanır (üretici çalışmaz). Node ve Bare'de aynı sonuç beklenir:
//   node scripts/vector-check.js      bare scripts/vector-check.js
// Çıktı: vektör başına geçen ve kalan doğrulama sayısı, sonunda "VEKTOR_DENETIMI TAMAM" ya da "FARK". Dizindeki her
// vektör dosyası aşağıdaki eşlemede olmalıdır; eşlemede olmayan dosya FARK sayılır.
const BARE = typeof Bare !== 'undefined'
const fs = require(BARE ? 'bare-fs' : 'f' + 's')

// Vektör → onu yeniden hesaplayan test dosyaları (depo köküne göre)
const ESLEME = {
  'multi-app.json': ['core/records/test/multi.js'],
  'multi-app-v2.json': ['core/records/test/multi.js'],
  'multi-family.json': ['worklet/test/multi-family.js', 'core/core/test/multi-family.js', 'core/events/test/multi-family.js'],
  'node.json': ['node/test/vector.js'],
  'pair-accept.json': ['worklet/test/pair-accept.js'],
  'team.json': ['core/core/test/team-vector.js'],
  'team-v2.json': ['core/core/test/team-vector-v2.js'],
  'task.json': ['core/tasks/test/vector.js'],
  'task-v2.json': ['core/tasks/test/vector.js'],
  'channel.json': ['sdk/test/channel.js'],
  'channel-v2.json': ['sdk/test/d24.js'],
  'channel-v3.json': ['sdk/test/d25.js'],
  'channel-v4.json': ['sdk/test/d25.js'],
  'channel-task.json': ['sdk/test/channel-task.js'],
  'kdf-lp.json': ['core/core/test/d69.js'],
  'export.json': ['core/export/test/vector.js', 'core/export/test/review-6.js'],
  'export-v2.json': ['core/export/test/review-6.js'],
  'vault.json': ['core/vault/test/vector.js'],
  'vault-v2.json': ['core/vault/test/vector.js'],
  'vault-share.json': ['core/vault/test/delivery.js'],
  'record.json': ['core/records/test/record.js'],
  'record-v2.json': ['core/records/test/record.js', 'core/records/test/file.js'],
  'bridge.json': ['core/core/test/bridge.js'],
  'guest-write.json': ['core/records/test/guest-write.js'],
  'sos.json': ['core/events/test/sos.js'],
  'disaster-normal-path.json': ['core/disaster/test/upgrade.js', 'worklet/test/disaster-normal-path.js'],
  'disaster-mid.json': ['core/events/test/disaster-mid.js'],
  'sos-receipt.json': ['core/events/test/receipt.js', 'worklet/test/sos-receipt.js'],
  'disaster.json': ['core/disaster/test/vector.js'],
  'service.json': ['core/services/test/vector.js', 'services/receiver/test/receiver.js'],
  'edge.json': ['core/edge/test/vector.js'],
  'asset.json': ['sdk/test/asset.js'],
  'guest-ceremony.json': ['worklet/test/guest.js'],
  'remote-decision.json': ['core/transport/test/remote-decision.js'],
  'app-record.json': ['core/records/test/app.js'],
  'event-v3.json': ['core/events/test/event-v3.js'],
  'crisis-set.json': ['core/ai/test/crisis.js'],
  'ledger-v21.json': ['core/core/test/ledger-v21.js'],
  'ledger-v21-v2.json': ['core/core/test/ledger-v21.js', 'core/core/test/session-v21.js'],
  'event.json': ['core/events/test/vector.js'],
  'event-v2.json': ['core/events/test/vector.js'],
  'erasure.json': ['installer/test/vector.js'],
  'sdk.json': ['sdk/test/vector.js'],
  'sdk-v2.json': ['sdk/test/vector.js'],
  'ceremony.json': ['core/transport/test/ceremony-vector.js'],
  'ceremony-family-name.json': ['core/transport/test/ceremony-family-name.js'],
  'ai.json': ['core/ai/test/vector.js'],
  'ai-v2.json': ['core/ai/test/vector-v2.js']
}
const URETICI = /üretici/ // yalnız üreticiyi çalıştıran testler

const kok = __dirname + '/..'
const brittle = require('brittle')
const sonuc = new Map() // dosya → { passes, fails, atlanan, testler }
let dosya = null

// brittle'ı sarmalar: üretici testi atlanır; diğerlerinin doğrulama sayıları dosyasına yazılır
function sar (ad, ...rest) {
  const d = dosya
  const s = sonuc.get(d)
  if (typeof ad === 'string' && URETICI.test(ad)) { s.atlanan++; return brittle.skip(ad, ...rest) }
  const i = rest.findIndex((x) => typeof x === 'function')
  if (i < 0) return brittle(ad, ...rest)
  const fn = rest[i]
  rest[i] = (t) => {
    t.teardown(() => { s.passes += t.passes; s.fails += t.fails; s.testler++; if (t.fails) s.kalanlar.push(ad) })
    return fn(t)
  }
  return brittle(ad, ...rest)
}
Object.assign(sar, brittle)
for (const k of Object.keys(require.cache)) if (/node_modules\/brittle\/index\.js$/.test(k)) require.cache[k].exports = sar

const dosyalar = [...new Set(Object.values(ESLEME).flat())]
for (const d of dosyalar) {
  dosya = d
  sonuc.set(d, { passes: 0, fails: 0, atlanan: 0, testler: 0, kalanlar: [] })
  require(kok + '/' + d)
}

brittle('vektör denetimi özeti', (t) => {
  const dizin = fs.readdirSync(kok + '/protocol/vectors').filter((f) => f.endsWith('.json')).sort()
  let fark = 0
  const satirlar = []
  for (const v of dizin) {
    const ts = ESLEME[v]
    if (!ts) { fark++; satirlar.push(`${v}: FARK (denetleyen test eşlemede yok)`); continue }
    // Doğrulamalar test dosyası başına sayılır: eşlemedeki dosya vektörü hiç okumuyorsa geçen testleri ona yazılmasın
    // (Codex 12. tur: core/transport/test/multi-family.js multi-family.json'u okumadan sayılıyordu)
    const okumayan = ts.filter((d) => !fs.readFileSync(kok + '/' + d, 'utf8').includes(v))
    if (okumayan.length) { fark++; satirlar.push(`${v}: FARK (vektörün adı geçmeyen test eşlemede: ${okumayan.join(', ')})`); continue }
    const r = ts.map((d) => sonuc.get(d))
    const p = r.reduce((a, x) => a + x.passes, 0)
    const f = r.reduce((a, x) => a + x.fails, 0)
    const atl = r.reduce((a, x) => a + x.atlanan, 0)
    if (f || !p) fark++
    satirlar.push(`${v}: ${f || !p ? 'FARK' : 'tamam'} · ${p} doğrulama geçti, ${f} kaldı, ${atl} üretici testi atlandı · ${ts.join(', ')}${f ? ' · kalan: ' + r.flatMap((x) => x.kalanlar).join('; ') : ''}`)
  }
  for (const v of Object.keys(ESLEME)) if (!dizin.includes(v)) { fark++; satirlar.push(`${v}: FARK (eşlemede var, dizinde yok)`) }
  console.log('# ' + (BARE ? 'Bare ' + Bare.version : 'Node ' + process.version))
  for (const s of satirlar) console.log('# ' + s)
  console.log('# ' + (fark ? 'VEKTOR_DENETIMI FARK ' + fark : 'VEKTOR_DENETIMI TAMAM ' + dizin.length))
  t.is(fark, 0)
})
