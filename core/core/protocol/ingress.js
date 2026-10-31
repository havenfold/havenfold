// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// protocol/ingress.js — oturumdan gelen her zarfın tek giriş noktası (inceleme 3 S7, RFC-0003 §6.1, RFC-0019 §11.3 d)
//
// Sıra: önce oturum süzgeci (typeAllowed, yön 'gelen'), sonra türün kanonik çözücüsü. Çekirdeğin türleri burada
// kayıtlıdır; üst katmanlar (kayıt, görev, kasa, olay) kendi türlerinin çözücüsünü kaydet() ile ekler. Çözücüsü
// olmayan tür izinliyse ham baytlarıyla döner; işleyen katman kendi kanonik çözücüsünü kullanır.
const { Z, typeAllowed, YALNIZ_DOGRUDAN_DUGUM, POSTASIZ } = require('./envelope')
const { decodeRetireBegin, decodeRetireList } = require('./retirement')
const { decodeNodeRecovery } = require('./recovery')

function fail (code) { throw new Error(code) }

const COZUCU = new Map([
  [Z.RETIRE_BEGIN, decodeRetireBegin],
  [Z.RETIRE_LIST, decodeRetireList],
  [Z.NODE_RECOVERY, decodeNodeRecovery], // RFC-0007 §13.6
  // Defter eşitlemesi (RFC-0003 §9): öneri gövdesi kodlanmış olaydır
  [Z.LEDGER_PROPOSE, (b) => require('../ledger/encoding').decodeEvent(b)],
  [Z.LEDGER_REQ, (b) => require('../ledger/encoding').canonical(require('../ledger/sync').ledgerReq, b, 'CORRUPT_LEDGER')],
  [Z.LEDGER_EVENTS, (b) => require('../ledger/encoding').canonical(require('../ledger/sync').ledgerEvents, b, 'CORRUPT_LEDGER')]
])

// Üst katmanın kanonik çözücüsü; ilk kayıt geçerlidir (paket iki yoldan yüklenirse ikincisi yok sayılır)
function kaydet (type, cozucu) {
  if (!COZUCU.has(type)) COZUCU.set(type, cozucu)
}

// Kayıtlı çözücü (salt okunur): bulanık test gerçek çözücüyü hata türünü kaybetmeden çağırır (D54, inceleme 18)
const cozucu = (type) => COZUCU.get(type) || null

// Yerel kanal (RFC-0017 §6.2): yalnız eşleşme ve APP_LOCAL_SYNC; ağdan gelen eşleşme türleri ağ süzgecinde atılır
const YEREL_KANAL = new Set([Z.APP_PAIR_REQ, Z.APP_PAIR_OK, Z.APP_LOCAL_SYNC, Z.APP_PAIR_REQ2])
const DUGUM_ARALIGI = (t) => t >= 0xd8 && t <= 0xdf

function kanonikYerel (type, bytes) {
  const Y = require('./local-channel')
  const { canonical } = require('../ledger/encoding')
  if (type === Z.APP_PAIR_REQ) return canonical(Y.pairReq, bytes, 'INVALID_MESSAGE')
  if (type === Z.APP_PAIR_REQ2) return canonical(Y.pairReq2, bytes, 'INVALID_MESSAGE')
  if (type === Z.APP_PAIR_OK) return canonical(Y.pairOk, bytes, 'INVALID_MESSAGE')
  return bytes // APP_LOCAL_SYNC mühürlüdür; açılınca içteki tür yeniden bu girişten (ağ kipi, üye ↔ üye) geçer
}

// myRole, peerRole: oturumdaki roller ('uye' | 'cihaz' | 'misafir'). Dönüş: { type, mesaj }; izinsiz tür TYPE_NOT_ALLOWED,
// çözülemeyen INVALID_MESSAGE. L ve gonderen (hex) verilirse: ekipte çıkarılmış üyeden (Posta Kutusu'nda bekleyen
// zarflar) yalnız EKIP_CIKIS_OK (0xC9) kabul edilir (RFC-0022 e).
// kanal: 'ag' (varsayılan) | 'yerel'. yol (ağda zorunlu; varsayılanı yok, inceleme 11 bulgu 9): 'dogrudan' | 'emanet' |
// 'posta'; RFC-0007 §14: NODE_HEALTH, UPDATE_HAVE/REQ/DATA ve NODE_RECOVERY yalnız doğrudan oturumda; Posta Kutusu'ndan
// 0xD8–0xDF hiç gelmez. Verilmeyen yol INVALID_CHANNEL.
function gelenZarf ({ myRole, peerRole, type, bytes, L = null, gonderen = null, kanal = 'ag', yol }) {
  if (kanal === 'yerel') {
    if (!YEREL_KANAL.has(type)) fail('TYPE_NOT_ALLOWED')
    let mesaj
    try { mesaj = kanonikYerel(type, bytes) } catch { fail('INVALID_MESSAGE') }
    return { type, mesaj }
  }
  if (kanal !== 'ag' || !['dogrudan', 'emanet', 'posta'].includes(yol)) fail('INVALID_CHANNEL')
  if (yol === 'emanet' && YALNIZ_DOGRUDAN_DUGUM.has(type)) fail('DIRECT_ONLY')
  if (yol === 'posta' && DUGUM_ARALIGI(type)) fail('DIRECT_ONLY')
  if (yol === 'posta' && POSTASIZ.has(type)) fail('MAILBOX_FORBIDDEN') // pay teslimi (RFC-0027 §1b)
  if (L && gonderen && L.kind === 'ekip') {
    const u = L.members.get(gonderen)
    if (u && !u.active && type !== Z.EKIP_CIKIS_OK) fail('TYPE_NOT_ALLOWED')
  }
  // RFC-0030 §4: misafirin REC_OPS'u yön kısıtının tek istisnası; aşağıda öğelerin hepsi REC_DROP olmalı
  const misafirOps = type === Z.REC_OPS && peerRole === 'misafir' && typeAllowed(myRole, peerRole, type)
  if (!misafirOps && !typeAllowed(myRole, peerRole, type, 'gelen')) fail('TYPE_NOT_ALLOWED')
  const coz = COZUCU.get(type)
  if (!coz) {
    if (misafirOps) fail('TYPE_NOT_ALLOWED') // çözücü yoksa öğeler denetlenemez
    return { type, mesaj: bytes }
  }
  let mesaj
  try { mesaj = coz(bytes) } catch { fail(misafirOps ? 'TYPE_NOT_ALLOWED' : 'INVALID_MESSAGE') }
  // Misafir yalnız bırakır (RFC-0030 §4): REC_OPS'taki öğelerin hepsi REC_DROP (kind 1); çözülemeyen de izinsiz sayılır
  if (misafirOps && !(Array.isArray(mesaj?.items) && mesaj.items.length > 0 && mesaj.items.every((it) => it.kind === 1))) fail('TYPE_NOT_ALLOWED')
  return { type, mesaj }
}

module.exports = { gelenZarf, kaydet, cozucu }
