// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// node-envelope.js — düğüm çekirdeğinin ağ zarfı girişi (RFC-0007 §12.4, §12.5, §14)
//
// Ağdan gelen her zarf önce giris.gelenZarf'tan geçer (oturum süzgeci, yol kuralı, ekipte çıkarılmış üye süzgeci,
// kanonik çözme); bu dosyadaki işleyiciler yalnız çözülmüş mesajı görür. Düğüme özgü türlerin kanonik çözücüleri
// burada kaydedilir. Çekirdek (Bare) bu dosyayı kullanır; fs ya da net kullanmaz.
const c = require('compact-encoding')
const b4a = require('b4a')
const { giris, zarf: { Z }, encoding: { canonical } } = require('@havenfold/core')
const { struct } = require('./health')
const S = require('./release')
const H = require('./health')
const { IPC } = require('./ipc/types')
const { cerceveYaz } = require('./ipc/frame')

function fail (code) { throw new Error(code) }
const hex = (b) => b4a.toString(b, 'hex')

// §12.5
const updateHave = struct([['product', c.string], ['versionCode', c.uint], ['manifest', c.buffer], ['have', c.array(c.fixed32)]])
const updateReq = struct([['digest', c.fixed32], ['offset', c.uint], ['length', c.uint]])
const updateData = struct([['digest', c.fixed32], ['offset', c.uint], ['data', c.buffer]])
const EN_COK_PARCA = 256 * 1024

// İmzalı gövde ‖ imza (64): gövde kanonik çözülür, imza ayrı döner
const imzali = (enc) => (b) => {
  if (!b4a.isBuffer(b) || b.byteLength < 65) fail('INVALID_MESSAGE')
  return { govde: canonical(enc, b.subarray(0, -64), 'INVALID_MESSAGE'), sig: b.subarray(-64), bytes: b }
}

giris.kaydet(Z.UPDATE_HAVE, (b) => canonical(updateHave, b, 'INVALID_MESSAGE'))
giris.kaydet(Z.UPDATE_REQ, (b) => { const m = canonical(updateReq, b, 'INVALID_MESSAGE'); if (m.length > EN_COK_PARCA) fail('INVALID_MESSAGE'); return m })
giris.kaydet(Z.UPDATE_DATA, (b) => { const m = canonical(updateData, b, 'INVALID_MESSAGE'); if (m.data.byteLength > EN_COK_PARCA) fail('INVALID_MESSAGE'); return m })
giris.kaydet(Z.UPDATE_APPROVE, imzali(S.onayGovde))
giris.kaydet(Z.NODE_HEALTH, imzali(H.govdeEnc))

// Düğüm çekirdeğinin zarf işleyicisi. L: defter kopyası; me: kendi kimliği (hex); denetciye(çerçeve): IPC gönderimi
class DugumZarf {
  constructor ({ L, me, denetciye }) {
    this.L = L
    this.me = hex(me.memberId || me)
    this.denetciye = denetciye
  }

  // Tek giriş: { peerRole, gonderen (hex), type, bytes, yol: 'dogrudan' | 'emanet' | 'posta' (zorunlu) }
  al ({ peerRole, gonderen, type, bytes, yol }) {
    const { mesaj } = giris.gelenZarf({ myRole: 'cihaz', peerRole, type, bytes, L: this.L, gonderen, yol })
    if (type === Z.UPDATE_HAVE) return this.denetciye(cerceveYaz(IPC.GUNCELLEME_BILDIRIMI, 0, { manifest: mesaj.manifest }))
    if (type === Z.UPDATE_APPROVE) {
      // Çekirdek imzacının rolünü defterden doğrular; denetçi imzayı signerPub ile yeniden doğrular (§6.3 tür 15)
      const sid = hex(mesaj.govde.signerId)
      if (sid !== gonderen) fail('UNAUTHORIZED')
      const u = this.L.members.get(sid)
      if (!u || !u.active) fail('UNAUTHORIZED')
      return this.denetciye(cerceveYaz(IPC.GUNCELLEME_ONAYI, 0, { approve: mesaj.bytes, signerPub: u.signPub, signerRole: u.role }))
    }
    if (type === Z.UPDATE_REQ || type === Z.UPDATE_DATA) fail('NOT_IN_THIS_VERSION') // topluluk içi paylaşım: RFC-0007 §19 adım 7
    fail('TYPE_NOT_ALLOWED')
  }
}

// Ağ zarfı alan düğüm giriş noktaları; her biri giris.gelenZarf'tan geçer (node/test/ingress.js denetler)
const ENTRY_POINTS = ['DugumZarf.al']

module.exports = { DugumZarf, updateHave, updateReq, updateData, ENTRY_POINTS }
