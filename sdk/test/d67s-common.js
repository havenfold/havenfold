// SPDX-License-Identifier: Apache-2.0
// D67 saldırı testlerinin ortak yardımcıları. Dosyalar `sdk/test/` altına kopyalanıp oradan koşar (göreli yollar
// sdk/test/d67.js ile aynı). Beklenenler elle.
'use strict'
const b4a = require('b4a')
const sodium = require('sodium-native')
const c = require('compact-encoding')
const S = require('..')
const K = require('@havenfold/vault')
const { ledger: { T } } = require('@havenfold/core')
const A = require('../../core/records/test/helpers/family')
const { KutuPaylari } = require('../../node/box-share')
const { taklitTpm } = require('../../node/tpm')

const hex = (b) => b4a.toString(b, 'hex')
const H = 3_600_000
const DK = 60_000
const Z = { ...K.istek.Z, ...K.teslim.Z }
const hataOf = async (fn) => { try { await fn(); return null } catch (err) { return err.message } }
const rastgele = (n) => { const b = b4a.alloc(n); sodium.randombytes_buf(b); return b }
const id = (k) => hex(A.K[k].memberId)
const ANAHTAR = 'ef'.repeat(32)

function kutuKur (t, L, saat, { dizin = null, tpm = null } = {}) {
  dizin = dizin || require('../../worklet/test/helpers/common').geciciDizin(t, 'd67s-kutu')
  tpm = tpm || taklitTpm({ test: true, anahtar: rastgele(32) })
  return { kutu: new KutuPaylari({ ledger: L, me: A.K.kutu, dizin, tpm, now: () => saat.v, testKipi: true }), dizin, tpm }
}

// d67.js'deki bellek içi ağ; hata yakalayan sürüm (hatalar dizisine yazar, akış sürer)
function ag (cihazlar, hatalar = []) {
  const teslim = (from, x) => {
    const cc = cihazlar[x.to]
    if (!cc) return []
    const { tur, api } = cc
    try {
      if (tur === 'kutu') {
        if (x.type === Z.KASA_SHARE_PUT) return [api.payAl(from, x.bytes, 'dogrudan')]
        if (x.type === Z.KASA_VERSION_REQ) return [api.surumIstegiAl(from, x.bytes, 'dogrudan')].filter(Boolean)
        if (x.type === Z.KASA_SHARE_REQ) return [api.payIstegiAl(from, x.bytes, 'dogrudan')].filter(Boolean)
        return []
      }
      switch (x.type) {
        case Z.KASA_SHARE_PUT: return [api.receiveShare(from, x.bytes, 'dogrudan')]
        case Z.KASA_SHARE_ACK: api.receiveAck(from, x.bytes, 'dogrudan'); return []
        case Z.KASA_VERSION_REQ: return [api.receiveVersionRequest(from, x.bytes, 'dogrudan')].filter(Boolean)
        case Z.KASA_VERSION_RES: api.receiveVersionReply(from, x.bytes, 'dogrudan'); return []
        case Z.KASA_SHARE_REQ: api.receiveShareRequest(from, x.bytes, 'dogrudan'); return []
        case Z.KASA_SHARE_RES: api.receiveShareReply(from, x.bytes, 'dogrudan'); return []
      }
    } catch (err) { hatalar.push({ from, to: x.to, type: x.type, hata: err.message }) }
    return []
  }
  const gonderilen = new Set()
  return function akit () {
    for (let tur = 0; tur < 20; tur++) {
      let is = 0
      for (const [kim, cc] of Object.entries(cihazlar)) {
        if (cc.tur === 'kutu' || cc.cevrimdisi) continue
        const gid = [...cc.api.outgoing(), ...cc.api.recoveryOutgoing()]
        for (const x of gid) {
          if (!cihazlar[x.to] || cihazlar[x.to].cevrimdisi) continue
          // Alındısı gelmeyen (hata veren) PUT her turda yeniden denenmesin
          const anahtar = x.anahtar !== undefined ? kim + x.to + hex(x.bytes) : null
          if (anahtar && gonderilen.has(anahtar)) continue
          if (anahtar) gonderilen.add(anahtar)
          if (x.anahtar === undefined) cc.api.sent(x)
          for (const cev of teslim(kim, x)) { is++; teslim(x.to, cev) }
          is++
        }
      }
      if (!is) return
    }
  }
}

// Aile, kasa koleksiyonu, Kerem ve Hüsniye'nin VaultApi'si, kutu. kraKur ayrı çağrılır.
function aile (t, { husniyeKilitli = false } = {}) {
  const saat = { v: A.TS0 + H }
  const now = () => saat.v
  const L = A.anaDefter()
  const kasaCid = [...L.collections.values()].find((x) => x.sensitivity === 'kasa').id
  const kutuId = id('kutu')
  const uygunCihaz = (x) => x === kutuId
  const kerem = new S.VaultApi({ ledger: L, me: A.K.kerem, now, uygunCihaz, anahtarDogrula: (h) => h === ANAHTAR })
  const husniye = new S.VaultApi({ ledger: L, me: A.K.husniye, now, uygunCihaz, anahtarDogrula: (h) => h === ANAHTAR })
  const { kutu } = kutuKur(t, L, saat)
  const cihazlar = { [id('kerem')]: { api: kerem }, [id('husniye')]: { api: husniye }, [kutuId]: { tur: 'kutu', api: kutu } }
  return { saat, now, L, kasaCid, kutuId, uygunCihaz, kerem, husniye, kutu, cihazlar }
}

const sahtePay = async ({ secretId, kind, version, holderler, t = 2 }) =>
  K.pay.paylariUret(rastgele(32), { secretId: b4a.from(secretId, 'hex'), kind, version, dagitim: { kurulur: true, t, n: holderler.length, sahipler: holderler.map((h) => ({ id: h })) } })
const payCevabi = (share) => c.encode(K.istek.shareRes, { share })
const surumCevabi = (secretId, version, threshold = 2, total = 3) => c.encode(K.istek.versionRes, { secretId: b4a.from(secretId, 'hex'), version, threshold, total })

// İmzayı başka bir anahtarla atan (başkası adına) istek
function sahteIstek (familyId, { secretId, kind, version, requesterId, holderId, at, reason = 'restore' }, imzalayan) {
  const body = c.encode(K.istek.shareReqBody, { secretId: b4a.from(secretId, 'hex'), kind, version, requesterId: b4a.from(requesterId, 'hex'), holderId: b4a.from(holderId, 'hex'), at, reason })
  const sig = b4a.alloc(64)
  sodium.crypto_sign_detached(sig, K.istek.reqDigest(familyId, body), imzalayan.signKeyPair.secretKey)
  return b4a.concat([body, sig])
}

module.exports = { S, K, A, T, hex, H, DK, Z, hataOf, rastgele, id, ANAHTAR, kutuKur, ag, aile, sahtePay, payCevabi, surumCevabi, sahteIstek, KutuPaylari, taklitTpm }
