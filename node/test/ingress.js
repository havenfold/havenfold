// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// D12 sabitleyici test (düğüm): ağdan gelen her zarf core giris.gelenZarf'tan geçer. Kaynakta bayt alan her yöntem
// kayıtlı giriş noktası ya da gerekçeli dışlamadır; giriş çağrılınca gelenZarf çalışır, yol kuralı uygulanır.
const test = require('brittle')
const fs = require('fs')
const path = require('path')
const b4a = require('b4a')
const c = require('compact-encoding')
const core = require('@havenfold/core')
const { DugumZarf, ENTRY_POINTS: ZARF_GIRISLERI, updateHave } = require('../node-envelope')
const { ENTRY_POINTS: PAY_GIRISLERI } = require('../box-share')
const { ENTRY_POINTS: ISCI_GIRISLERI } = require('../worker')
const ENTRY_POINTS = [...ZARF_GIRISLERI, ...PAY_GIRISLERI, ...ISCI_GIRISLERI]
const { mesajCoz } = require('../ipc/frame')
const { IPC } = require('../ipc/types')
const S = require('../release')
const V = require('../../core/core/test/helpers/v21')

const { Z } = core.zarf
const hataOf = (fn) => { try { fn(); return null } catch (err) { return err.message } }

const ISCI_IC = 'yalnız IsciAgi.al\'dan, giris.gelenZarf\'tan geçtikten sonra çağrılır'
const DISLANAN = {
  'IsciAgi._gorevAl': ISCI_IC,
  'IsciAgi._iptal': ISCI_IC,
  'IsciAgi._parca': ISCI_IC,
  'IsciAgi.ister': 'yalnız yönlendirme (tür ve beklenen blobId); zarfı işleyen IsciAgi.al ya da eşitleyici gelenZarf\'tan geçirir',
  'Guncelleyici.hazirla': 'bildirim baytları denetçinin kendi önbelleğinden gelir (GUNCELLEME_BILDIRIMI ile, DugumZarf.al\'dan geçtikten sonra) ve kök imzasıyla doğrulanır'
}

function yontemler (dosya) {
  const out = []
  let sinif = null
  for (const satir of fs.readFileSync(dosya, 'utf8').split('\n')) {
    const k = /^class (\w+)/.exec(satir)
    if (k) sinif = k[1]
    const m = /^ {2}(?:async )?([a-zA-Z_]\w*) \(([^)]*)\) \{/.exec(satir)
    if (m && /bytes|Bytes/.test(m[2])) out.push(sinif + '.' + m[1])
  }
  return out
}

test('düğüm: bayt alan her yöntem kayıtlı giriş noktası ya da gerekçeli dışlama', (t) => {
  const kok = path.join(__dirname, '..')
  const dosyalar = [...fs.readdirSync(kok).filter((f) => f.endsWith('.js')).map((f) => path.join(kok, f)), ...fs.readdirSync(path.join(kok, 'ipc')).map((f) => path.join(kok, 'ipc', f))]
  const kaynak = dosyalar.flatMap(yontemler)
  for (const y of kaynak) t.ok(ENTRY_POINTS.includes(y) || DISLANAN[y], y)
  for (const g of ENTRY_POINTS) t.ok(kaynak.includes(g), 'liste kaynağa uyar: ' + g)
})

test('düğüm: DugumZarf.al gelenZarf\'tan geçer; yol ve oturum kuralları', (t) => {
  const asil = core.giris.gelenZarf
  const gorulen = []
  core.giris.gelenZarf = (o) => { gorulen.push([o.type, o.yol]); return asil(o) }
  try {
    const L = new core.ledger.Ledger({ now: () => V.TS0 })
    for (const f of V.anaAdimlar(L)) L.apply(f())
    const giden = []
    const d = new DugumZarf({ L, me: V.C.isci1, denetciye: (f) => giden.push(f) })
    const have = c.encode(updateHave, { product: 'havenfold-node', versionCode: 1002003, manifest: b4a.from('m'), have: [] })
    const isci2 = b4a.toString(V.C.isci2 ? V.C.isci2.memberId : V.C.uc1.memberId, 'hex')
    d.al({ peerRole: 'cihaz', gonderen: isci2, type: Z.UPDATE_HAVE, bytes: have, yol: 'dogrudan' })
    t.alike(mesajCoz(giden[0].subarray(4)), { type: IPC.GUNCELLEME_BILDIRIMI, reqId: 0, mesaj: { manifest: b4a.from('m') } })
    t.is(hataOf(() => d.al({ peerRole: 'cihaz', gonderen: isci2, type: Z.UPDATE_HAVE, bytes: have, yol: 'emanet' })), 'DIRECT_ONLY')
    t.is(hataOf(() => d.al({ peerRole: 'cihaz', gonderen: isci2, type: Z.UPDATE_HAVE, bytes: b4a.concat([have, b4a.from([0])]), yol: 'dogrudan' })), 'INVALID_MESSAGE', 'kanonik')
    t.is(hataOf(() => d.al({ peerRole: 'cihaz', gonderen: isci2, type: Z.UPDATE_APPROVE, bytes: b4a.alloc(80), yol: 'dogrudan' })), 'TYPE_NOT_ALLOWED', 'cihaz onay göndermez')
    t.is(hataOf(() => d.al({ peerRole: 'misafir', gonderen: isci2, type: Z.UPDATE_HAVE, bytes: have, yol: 'dogrudan' })), 'TYPE_NOT_ALLOWED')
    // Ebeveynden onay: çekirdek rolü defterden ekler
    const onay = S.onayYaz(L.familyId, V.K.kerem, { nodeId: V.C.isci1.memberId, op: 'kanal', product: 'havenfold-node', toVersionCode: 0, manifestHash: b4a.alloc(32), channel: 'deneme', expiresAt: V.TS0 + 3_600_000, ledgerSeq: L.len - 1 })
    d.al({ peerRole: 'uye', gonderen: b4a.toString(V.K.kerem.memberId, 'hex'), type: Z.UPDATE_APPROVE, bytes: onay, yol: 'emanet' })
    const m = mesajCoz(giden[1].subarray(4)).mesaj
    t.alike([m.signerRole, b4a.equals(m.approve, onay)], ['ebeveyn', true])
    t.is(hataOf(() => d.al({ peerRole: 'uye', gonderen: b4a.toString(V.K.irem.memberId, 'hex'), type: Z.UPDATE_APPROVE, bytes: onay, yol: 'dogrudan' })), 'UNAUTHORIZED', 'imzacı gönderen olmalı')
    t.ok(gorulen.length >= 7 && gorulen.every(([type]) => [Z.UPDATE_HAVE, Z.UPDATE_APPROVE].includes(type)))
  } finally { core.giris.gelenZarf = asil }
})
