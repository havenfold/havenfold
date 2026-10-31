// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// example/product.js — örnek ürün sunucusu: başlatıcının (start.js) nasıl kullanıldığını gösterir ve testlerde kullanılır.
//
// Gerçek ürünün sunucusu kendi deposundadır (Yuva Defteri: apps/mobile/worklet/server.js). Bu örnek yalnız birkaç RFC-0024
// komutunu taşır: 2 CREATE_FAMILY, 200 FAMILY_INFO, 240 RECORD_COLLECTIONS, 241 RECORD_GET, 243 RECORD_PUT, 245 RECORD_ATTACH,
// 242 RECORD_QUERY, 246 RECORD_OPEN; görev 250–255 (task-channel.js, 'task' olayı); kasa 19, 224, 365, 387, 388, 389;
// tören 3 INVITE_START, 4 INVITE_CONFIRM, 5 JOIN, 205 INVITE_CANCEL ('ceremony' olayı), 13 MEMBER_REMOVE, 14 LEDGER_SIGN,
// 201 MEMBERS, 225 PROPOSALS (Yuva Hat çizelgesinin adlarıyla; D34); varlık 430 BEING_ADD, 431 BEING_REMOVE (D98).
// 9000 (örneğe özel) bir geri çağrı açar ve uygulamanın cevabını döner (onay ekranı akışının benzeri).
'use strict'
const b4a = require('b4a')

const KOMUT = { CREATE_FAMILY: 2, INVITE_START: 3, INVITE_CONFIRM: 4, JOIN: 5, MEMBER_REMOVE: 13, LEDGER_SIGN: 14, LOCK: 19, FAMILY_INFO: 200, MEMBERS: 201, PRESENCE_GET: 350, INVITE_CANCEL: 205, UNLOCK: 224, PROPOSALS: 225, RECORD_COLLECTIONS: 240, RECORD_GET: 241, RECORD_QUERY: 242, RECORD_PUT: 243, RECORD_ATTACH: 245, RECORD_OPEN: 246, VAULT_STATUS: 365, VAULT_SETUP_BK: 387, VAULT_SETUP_VRK: 388, VAULT_ARCHIVE_MOVE: 389, VAULT_RECOVERY_START: 400, VAULT_RECOVERY_SHARE: 401, VAULT_RECOVERY_FINISH: 402, VAULT_ROTATE: 403, VAULT_RECOVERY_STATUS: 404, VAULT_SHARE_APPROVE: 405, BEING_ADD: 430, BEING_REMOVE: 431, CAREGIVER_WRITE_GRANT: 410, GUEST_PERMISSIONS: 411, GUEST_DROP: 412, GUEST_MY_WRITES: 413, CAREGIVER_LIST: 440, CAREGIVER_REMOVE: 441, REMOTE_MEMBER_ACTIVATE: 450, MEMBER_REVOKE: 451, EXAMPLE_CALLBACK: 9000, EXAMPLE_LEVEL: 9001 }
const hex = (b) => (typeof b === 'string' ? b : b4a.toString(b, 'hex'))
const { kodla, coz, baytMi } = require('../channel-json')
const { taskChannel } = require('../task-channel')

function sirGovde (sir, sirHex) {
  if (baytMi(sir)) return sir
  if (typeof sirHex === 'string' && /^[0-9a-f]{64}$/.test(sirHex)) return b4a.from(sirHex, 'hex')
  throw new Error('INVALID_SECRET')
}

function urunSunucusu (c) {
  let gonder = null
  let sayac = 0
  const bekleyen = new Map()
  const gerek = () => { if (!c.nesneler.aile) throw new Error('NO_IDENTITY'); return c.nesneler }
  // KASA_YOK İngilizceye çevrilmez: ürün çerçevesinin hata alanıyla uygulamaya gider (tel değeri)
  const kasaGerek = () => { const k = gerek().kasa; if (!k) throw new Error('KASA_YOK'); return k }
  // Tören (CeremonyApi): tek oturum; defter ve kimlik her komutta güncel olanla (ailesizken boş defter)
  let toren = null
  const torenGerek = () => {
    if (!c.torenTasiyici) throw new Error('NO_CEREMONY_TRANSPORT')
    if (!toren) {
      toren = new c.S.CeremonyApi({ ledger: c.nesneler.defter.L, me: c.kimlik, tasiyici: c.torenTasiyici })
      toren.on('ceremony', (x) => { if (gonder) gonder(JSON.stringify({ olay: 'ceremony', veri: kodla(x) })) })
    }
    toren.L = c.nesneler.defter.L
    toren.me = c.kimlik
    return toren
  }

  const gorev = taskChannel(c) // 250–255 ve 'task' olayı
  // Örnek ürünün olay türü (bakıcının izinli bırakması için; Ol.tur.Katalog çekirdek türleriyle başlar)
  const katalog = new (require('@havenfold/events').tur.Katalog)()
  katalog.turKaydet({ tur: 'yuva.ornek.not', v: 1, olay: true, yazar: 'uye', ozne: ['topluluk', 'varlik'], alanlar: [{ ad: 'metin', deger: 'string', zorunlu: false }], kapsam: 'topluluk', keep: 30, ozel: false, ozet: 'yuva.ornek.not.ozet' })
  // Misafirin telefonu (D99): GuestWriteApi her çağrıda güncel görünümle (ürün kataloğu burada varsayılan)
  const misafir = () => {
    const m = c.nesneler.misafir
    if (!m) throw new Error('NOT_GUEST')
    return new c.S.GuestWriteApi({ kimlik: c.kimlik, gorunum: m.gorunum, katalog, saklama: m.saklama, hlc: m.hlc, now: c.now })
  }

  const isleyiciler = {
    ...gorev.isleyiciler,
    [KOMUT.CREATE_FAMILY]: ({ aileAdi, benimAdim }) => { c.aileKur({ aileAdi, benimAdim }); return null },
    [KOMUT.FAMILY_INFO]: () => {
      const n = c.nesneler
      const m = n.misafir
      return {
        me: hex(c.kimlik.memberId), aile: n.aile, ad: n.aile ? n.ledger.familyName : null, uzunluk: n.aile ? n.ledger.len : 0, varliklar: n.aile ? n.defter.beings() : [],
        misafir: m ? { bitis: m.gorunum.grant.expiresAt, bitti: !!m.iptal || c.now() >= m.gorunum.expiresAt, izinler: m.gorunum.drops.length, aileAdi: m.aileAdi } : null,
        esitleme: n.aile && n.esitleme ? n.esitleme.status() : null // D100: bağlantı şeridi (olay 'sync-status')
      }
    },
    [KOMUT.INVITE_START]: ({ tur = 'uye', rol = null, bitis = null, uzaktan = false }) => torenGerek().startInvite(tur, rol, { bitis, uzaktan }),
    [KOMUT.INVITE_CONFIRM]: ({ ayni }) => { torenGerek().confirm(ayni); return null },
    [KOMUT.JOIN]: ({ kod }) => torenGerek().join(kod),
    [KOMUT.INVITE_CANCEL]: () => { torenGerek().iptal(); return null },
    [KOMUT.MEMBER_REMOVE]: ({ memberId, wipe = false }) => { const r = gerek().defter.removeMember(memberId, { wipe }); return { durum: r.durum, oneriId: r.oneriId || null } },
    [KOMUT.LEDGER_SIGN]: ({ oneriId }) => { const r = gerek().defter.sign(oneriId); return { durum: r.durum } },
    [KOMUT.MEMBERS]: () => gerek().defter.persons(),
    // Bakıcı (D99): ebeveynde izin, liste ve kaldırma; misafirin telefonunda izinler, bırakma ve bıraktıkları
    [KOMUT.CAREGIVER_WRITE_GRANT]: (g) => { const { event, ...r } = gerek().defter.grantCaregiverWrite(g); return r },
    [KOMUT.CAREGIVER_LIST]: () => gerek().defter.caregivers(),
    // D106: uzaktan üyeyi etkinleştir (davet eden kendiliğinden yazar; öbür ebeveyn 1 saat sonra) ve davet iptali
    [KOMUT.REMOTE_MEMBER_ACTIVATE]: ({ memberId }) => { const { event, ...r } = gerek().defter.activateMember(memberId); return r },
    [KOMUT.MEMBER_REVOKE]: ({ memberId, neden = 'iptal' }) => { const { event, ...r } = gerek().defter.revokeMember(memberId, { reason: neden }); return r },
    [KOMUT.CAREGIVER_REMOVE]: ({ grantId, neden = '' }) => { const { event, iptal, ...r } = gerek().defter.removeCaregiver(grantId, { neden }); return r },
    [KOMUT.GUEST_PERMISSIONS]: () => misafir().permissions(),
    [KOMUT.GUEST_DROP]: ({ collectionId, type, alanlar = {} }) => {
      const api = misafir()
      if (c.nesneler.misafir.iptal) throw new Error('GUEST_ACCESS_ENDED')
      const r = api.drop(collectionId, type, alanlar)
      const ulasti = c.misafirGonder(r.mesaj)
      return { recordId: r.recordId, ulasti }
    },
    [KOMUT.GUEST_MY_WRITES]: ({ collectionId = null } = {}) => misafir().myWrites({ collectionId }),
    // Yalnız örnek ve test: ailenin düzeyini yükseltir (düzey 2.3 bakıcının bırakması için)
    [KOMUT.EXAMPLE_LEVEL]: ({ duzey }) => { const { event, ...r } = gerek().defter.raiseLevel(duzey); return r },
    // RFC-0003 §5.4 varlık (D98): ebeveyn hemen, yetişkin öneriyle; olay nesnesi kanala gitmez
    [KOMUT.BEING_ADD]: (g) => { const { event, ...r } = gerek().defter.addBeing(g); return r },
    [KOMUT.BEING_REMOVE]: ({ varlikId }) => { const { event, ...r } = gerek().defter.removeBeing(varlikId); return r },
    [KOMUT.PRESENCE_GET]: ({ memberId }) => gerek().defter.presence(memberId), // D77: çevrimiçi ve son görülme
    [KOMUT.PROPOSALS]: () => gerek().defter.listProposals(),
    [KOMUT.RECORD_COLLECTIONS]: () => gerek().kayit.collections(),
    [KOMUT.RECORD_GET]: ({ collectionId, recordId }) => gerek().kayit.get(collectionId, recordId),
    [KOMUT.RECORD_QUERY]: ({ collectionId, type = null, limit = Infinity }) => gerek().kayit.query(collectionId, { type, limit: limit ?? Infinity }),
    [KOMUT.RECORD_PUT]: ({ collectionId, recordId = null, type = '', fields }) => gerek().kayit.put(collectionId, recordId, type, fields),
    [KOMUT.RECORD_ATTACH]: ({ bytes, mime, name }) => gerek().kayit.attach({ bytes, mime, name }).blobRef,
    [KOMUT.RECORD_OPEN]: ({ blobRef }) => gerek().kayit.open(blobRef),
    // Kasa (RFC-0027 §1, §1a): kilit worklet'te (VaultApi); kurulum kanaldan (D33)
    [KOMUT.LOCK]: () => { kasaGerek().lock(); return null },
    [KOMUT.UNLOCK]: ({ archiveKeyHex }) => { kasaGerek().unlock(archiveKeyHex); return null },
    [KOMUT.VAULT_STATUS]: () => kasaGerek().status(),
    // Sır bayt olarak ({ sir: { $b } }) gelmeli: çözülen tampon kurulumdan sonra sıfırlanır; sirHex (JS dizgisi,
    // sıfırlanamaz) eski uygulamalar için kabul (inceleme 13)
    [KOMUT.VAULT_SETUP_BK]: ({ sir = null, sirHex = null, ...secenek }) => kasaGerek().setupBackupKey(sirGovde(sir, sirHex), secenek),
    [KOMUT.VAULT_SETUP_VRK]: ({ collectionId = null, sir = null, sirHex = null, kagit = 0 }) => kasaGerek().setupRecoveryKey(collectionId, sir || sirHex ? sirGovde(sir, sirHex) : null, { kagit }),
    [KOMUT.VAULT_ARCHIVE_MOVE]: ({ eskiArchiveKeyHex, yeniArchivePubHex }) => kasaGerek().moveArchive(eskiArchiveKeyHex, yeniArchivePubHex),
    // Kurtarma ve döndürme (RFC-0004 §5–§6, D67)
    [KOMUT.VAULT_RECOVERY_START]: ({ tur = 'ya', collectionId = null } = {}) => kasaGerek().startRecovery({ tur, collectionId }),
    [KOMUT.VAULT_RECOVERY_SHARE]: ({ kagit } = {}) => kasaGerek().recoveryShare({ kagit }),
    [KOMUT.VAULT_RECOVERY_FINISH]: ({ zarflar = [] } = {}) => kasaGerek().finishRecovery({ zarflar }),
    [KOMUT.VAULT_ROTATE]: (g = {}) => kasaGerek().rotateVault(g),
    [KOMUT.VAULT_RECOVERY_STATUS]: () => kasaGerek().recoveryStatus(),
    [KOMUT.VAULT_SHARE_APPROVE]: ({ jeton, onay = false } = {}) => kasaGerek().approveShare({ jeton, onay }),
    // Geri çağrı çerçevesi ait olduğu komutun kimliğini taşır (komutId; RFC-0027 §5 d)
    [KOMUT.EXAMPLE_CALLBACK]: (veri, komutId) => new Promise((resolve, reject) => {
      if (!gonder) return reject(new Error('NO_APPROVAL_SCREEN'))
      const id = ++sayac
      bekleyen.set(id, { resolve, reject })
      gonder(JSON.stringify({ cagri: 'ornek', id, komutId, veri: kodla(veri) }))
    })
  }

  async function isle (metin) {
    let id = null
    try {
      const j = JSON.parse(metin)
      if (j && typeof j === 'object' && 'cagriId' in j) {
        const b = bekleyen.get(j.cagriId)
        if (b) { bekleyen.delete(j.cagriId); if (j.hata) b.reject(new Error(j.hata)); else b.resolve(coz(j.sonuc)) }
        return null
      }
      id = j.id
      const f = isleyiciler[j.komut]
      if (!f) return JSON.stringify({ id, hata: 'NO_COMMAND' })
      const sonuc = await f(coz(j.govde || {}), id)
      return JSON.stringify({ id, sonuc: kodla(sonuc) })
    } catch (err) {
      return JSON.stringify({ id, hata: err && /^[A-Z][A-Z0-9_]{1,63}$/.test(err.message) ? err.message : 'INVALID_FRAME' })
    }
  }

  // Kayıt değişince uygulamaya olay (RFC-0024 §2 kayit-degisim)
  function olaylariBagla (g) {
    gonder = g
    const gorevBirak = gorev.olaylariBagla(g)
    return () => {
      gorevBirak()
      gonder = null
      for (const b of bekleyen.values()) b.reject(new Error('NO_APPROVAL_SCREEN'))
      bekleyen.clear()
    }
  }

  // Çerçeveye sığmayan geri çağrı (ipc.js): bekleyen çağrı reddedilir, komut { id, hata } ile döner
  function reddet (cagriId, kod) {
    const b = bekleyen.get(cagriId)
    if (!b) return
    bekleyen.delete(cagriId)
    b.reject(new Error(kod))
  }

  return { isle, olaylariBagla, reddet }
}

module.exports = { urunSunucusu, KOMUT, kodla, coz }
