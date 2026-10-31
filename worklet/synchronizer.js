// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// synchronizer.js — telefondaki çekirdeğin cihazlar arası eşitlemesi (D34)
//
// Taşıyıcıdan bağımsızdır: platformun ağ kancası (HyperDHT üstünde doğrulanmış oturumlar; testte süreçler arası boru)
// yalnız zarf taşır, karşı ucun kimliğini (memberId) doğrular. Bu dosya hangi zarfın ne zaman gideceğini ve gelen
// zarfın nereye gideceğini bilir; mesajların kendisi çekirdeğin ve SDK'nın işlevleridir:
//   defter      LEDGER_REQ / LEDGER_EVENTS (sync.answerReq, sync.ingest), LEDGER_PROPOSE (LedgerApi.receiveProposal)
//   kayıt       telefon ↔ telefon REC_VV → REC_IDS → REC_OPS ve REC_KEY_REQ (esitleme), telefon ↔ kutu 256 kovalı
//               özet REC_BUCKETS → REC_BUCKET_IDS → REC_OPS (kutunun kör emaneti, kutu.js); replikanın çıkış kutusu
//   dosya       BLOB_DATA (yükleme kutuya), BLOB_REQ (eksik dosya), BLOB_HAVE (kutu tuttuğunu bildirir)
//   kasa        KASA_SHARE_PUT / KASA_SHARE_ACK (VaultApi.outgoing, payAl, ackAl); kurtarma (D67) KASA_VERSION_REQ/RES,
//               KASA_SHARE_REQ/RES (VaultApi.recoveryOutgoing, surumIstegiAl, surumCevabiAl, payIstegiAl, payCevabiAl;
//               kutuda KutuPaylari.surumIstegiAl, payIstegiAl: sormadan cevap)
//   düğüm      NODE_RECOVERY (RFC-0007 §13.6): töreni yapan ebeveynin telefonu düğümün kurtarma anahtarını kaydeder,
//               alındı döner (_kurtarmaAl)
// Gelen her zarf önce giris.gelenZarf'tan geçer (oturum süzgeci ve kanonik çözme); SDK'nın kendi giriş noktası olan
// türler (dosya, öneri, kasa payı) doğrudan oraya gider, o da aynı girişten geçirir. Giden her zarf typeAllowed
// ('giden') süzgecinden geçer: defterden çıkarılmış ya da bekleyen kimliğe hiçbir şey gitmez.
//
// Ağ kancası: { gonder(peerHex, type, bytes) → false ise gitmedi }. Platform şunları çağırır:
//   baglandi(peerHex, { caps }?)  doğrudan oturum açıldı (caps: karşının HELLO.caps'i)   koptu(peerHex)  oturum kapandı
// Oturumlar çevrimiçi bilgisini de besler (D77): Presence.sessionOpened/oturumKapandi, HELLO.caps CapsBook'a
// (HIDE_PRESENCE), değişiklikte LedgerApi 'presence' olayı { memberId, online }.
//   al(peerHex, type, bytes, yol)  gelen zarf ('dogrudan' | 'emanet' | 'posta')
// Bellekte bekleyenler (çevrimdışı alıcıya anahtar, kutuya yükleme) kalıcı değildir: yeniden bağlanınca özetler
// (REC_VV, REC_BUCKETS) eksikleri yeniden bulur.
// Bağlı cihaz (işçi; RFC-0003 §6.1 üye ↔ cihaz): oturumda yalnız defter eşitlemesi, görev ve dosya; kayıt özeti ve
// öneri gitmez. Telefonda işçiden gelen NODE_CAPS yetenek defterine, görev cevapları TaskApi'ye gider; işçinin girdi
// isteği (BLOB_REQ) ve çıktısı (BLOB_DATA) dosya yolundan. Bu çekirdek işçi kimliğiyse (düğüm, node/worker.js) kendi rolü
// 'cihaz'dır; görev zarflarını düğüm ağ kancasında ayırır, buraya defter ve dosya kalır.
'use strict'
const b4a = require('b4a')
const sodium = require('sodium-native')
const c = require('compact-encoding')
const { giris, zarf: { Z, typeAllowed }, sync: S, ledger: { encodeEvent, T }, kurtarma: R, guestView: GV, encoding: { decodeBody } } = require('@havenfold/core')
const { esitleme: E, dosya: D, kutu: { Kutu }, islem: { peekOp } } = require('@havenfold/records')

const hex = (b) => (typeof b === 'string' ? b : b4a.toString(b, 'hex'))
// NODE_CAPS yalnız telefonda ve bağlı cihazdan ya da kutudan (YetenekDefteri imzacıyı ayrıca denetler)
const capsKabul = (e, p) => e.benimRol === 'uye' && ['cihaz', 'uye'].includes(e.L.sessionRole(p))

// SDK'nın kendi giriş noktası olan türler: gelenZarf'ı onlar çağırır
// Kutunun pay tutucusu da kendi giriş noktasıdır (KutuPaylari.payAl, gelenZarf'tan geçirir)
const SDK_GIRISLI = new Set([Z.BLOB_DATA, Z.BLOB_HAVE, Z.LEDGER_PROPOSE, Z.TASK_ACCEPT, Z.TASK_REJECT, Z.TASK_PROGRESS, Z.TASK_RESULT, Z.KASA_SHARE_PUT, Z.KASA_SHARE_ACK, Z.KASA_VERSION_REQ, Z.KASA_VERSION_RES, Z.KASA_SHARE_REQ, Z.KASA_SHARE_RES, Z.KASA_ENV_PUT, Z.KASA_ENV_ACK, Z.KASA_ENV_REQ, Z.KASA_ENV_RES,
  Z.SHARE_PREVIEW]) // ürün zarfı: işleyicisi (ServiceApi.receivePreview) gelenZarf'ı kendisi çağırır
// Ürünün kendi işlediği topluluk zarfları (RFC-0010 §8.1): urunZarfi ile işleyici, zarfGonder ile gönderim
// AFET_MSG: afet mesajının normal yolu (RFC-0031 §8.4, RFC-0012 §8.4; D104), DisasterApi.setupNormalPath bağlanır
const URUN_ZARFLARI = new Set([Z.SHARE_PREVIEW, Z.AFET_MSG])
const URUN_KUYRUK_EN_COK = 64

class Esitleyici {
  // kalici: Kalici (nesneler aile kurulunca ya da bağlanınca değişir); ag: ağ kancası; degisti(): durum kirlendi
  // kutuPay: bu çekirdek ailenin kutusuysa pay tutucusu ({ payAl, surumIstegiAl, payIstegiAl }; node/box-share.js, TPM
  // mühürlü; D39, D67)
  // tasiyiciAcik(): taşıyıcı başlamış ve askıda değil mi; olay(ad, veri): uygulamaya olay (eşitleme durumu, D100)
  // ayrilmaAlindi(p): kendi LEAVE'imizin yankısı geldi (RFC-0034 §4.5 açıklama; start.js)
  // davetIptal({ grantId, reason }): bekleyen uzaktan üyeyken davetimiz iptal edildi, iptal doğrulandı (D106 K4; start.js)
  constructor ({ kalici, ag, kutuPay = null, degisti = () => {}, hata = () => {}, tasiyiciAcik = () => true, olay = () => {}, ayrilmaAlindi = null, davetIptal = null }) {
    this.ayrilmaAlindi = ayrilmaAlindi
    this.davetIptal = davetIptal
    if (!ag || typeof ag.gonder !== 'function') throw new Error('NO_NETWORK')
    this.kalici = kalici
    this.ag = ag
    this.kutuPay = kutuPay
    this.degisti = degisti
    this.hata = hata
    this.tasiyiciAcik = tasiyiciAcik
    this.olay = olay
    this._esitlemeDinlenen = null
    this.acik = new Set() // oturumu açık uçlar
    this.selamlanan = new Set() // aile içinde eşitlemesi başlatılan uçlar
    this.beklerkenAcilan = new Map() // peerHex → HELLO caps: bekleyen uzaktan üyeyken açılan oturumlar; bekleme bitince eşitlemeye girer
    this.bekleyen = new Map() // peerHex → [{ type, bytes }] (çevrimdışı alıcıya yazılmış anahtar ve kesimler)
    this.urunZarflari = new Map() // tür → { isle(peerHex, bytes, yol, peerRole), teslim(peerHex, id) } (ürün sunucusu kaydeder)
    this.yuklenecek = [] // kutuya gidecek BLOB_DATA baytları (kutu çevrimdışıyken)
    this.istenen = new Set() // istenmiş eksik dosyalar (blobId hex)
    this.oneriGiden = new Set() // "peer|oneriId|imzaSayisi"
    this._uzunluk = null // son yayılan defter uzunluğu
    this._isliyor = 0
    this.reddedilen = 0 // oturum süzgecinin attığı zarflar (ör. çıkarılmış üyeden); uygulamaya hata olarak gitmez
  }

  get n () { return this.kalici.nesneler }
  get L () { return this.n.aile ? this.n.ledger : null }
  get meHex () { return hex(this.kalici.kimlik.memberId) }
  _rol (id) { return this.L?.members.get(id)?.role || null }
  get kutuyum () { return this._rol(this.meHex) === 'kutu' }
  // Bu çekirdeğin oturum rolü ('uye'; işçi düğümünde 'cihaz'; bekleyen uzaktan üye beklerken 'davetli') ve karşı tarafın
  // cihaz olup olmadığı. Bekleyenin defterde oturum rolü yok (null); 'uye' sayılırsa gelen süzgeci üye gibi açılırdı
  // (Codex 11. tur)
  get benimRol () {
    if (this._davetliyim()) return 'davetli'
    return (this.L && this.L.sessionRole(this.meHex)) || 'uye'
  }
  _cihaz (p) { return this.L.sessionRole(p) === 'cihaz' || this.benimRol === 'cihaz' }

  // Kutunun kör emaneti (bu çekirdek ailenin kutusuysa); kalıcı durumu kalici tutar
  get kutu () { return this.kutuyum ? this.kalici.kutu() : null }

  // ---------------------------------------------------------------- oturumlar

  baglandi (peerHex, { caps = null } = {}) {
    const p = hex(peerHex)
    // Sınırlı iptal oturumu (D106; Codex 10. tur): eşitleme, çevrimiçi bilgisi ve selam yok. Aile tarafında yetkili
    // telefon iptal edilen davetliye imzalı iptali yollar; bekleyen telefon yalnız onu bekler
    if (this.L && this.L.davetliMi(p)) { this._davetIptaliYolla(p); return }
    if (this._davetliyim()) { this.beklerkenAcilan.set(p, caps); return }
    this._oturumAcildi(p, caps)
    this.akit()
  }

  _oturumAcildi (p, caps = null) {
    this.acik.add(p)
    this._cevrimici(p, true, caps)
    if (this.L && this.L.sessionRole(p) === 'misafir') this._misafirGorunumu(p)
  }

  // Bekleme süremiz doldu (Codex 12. tur): süre her telefonda kendi kabul anından sayılır; daveti başlatan ebeveynin
  // süresi önce dolup ACTIVATE_MEMBER'ı yollamışsa o defter beklerken süzgeçte düşmüştür ve karşı taraf bizi selamlanmış
  // sayar. Beklerken açılan oturumlar burada eşitlemeye girer ve selamla biz defter isteriz. start.js düzenli yoklar
  beklemeYokla () {
    if (!this.beklerkenAcilan.size || this._davetliyim()) return false
    this.akit()
    return true
  }

  _beklemeBitti () {
    if (!this.beklerkenAcilan.size || this._davetliyim()) return
    const l = [...this.beklerkenAcilan]
    this.beklerkenAcilan.clear()
    for (const [p, caps] of l) this._oturumAcildi(p, caps) // karşı tarafın HIDE_PRESENCE ve UZAKTAN_IPTAL bitleri kaybolmasın
  }

  // Bekleyen uzaktan üyeyiz ve bekleme süremiz dolmadı (çift defterinin 'davetli' rolü): oturum yalnız iptal içindir
  _davetliyim () {
    const L = this.L
    return !!L && L.isPending(this.meHex) && !!L.members.get(this.meHex)?.pendingRemote && L.now() < L.readyAt(this.meHex)
  }

  // Daveti iptal eden REVOKE (bu üyenin removedSeq'i) GUEST_REVOKED zarfında; yalnız yetkili yollar (davetli başka imzacıyı
  // NOT_SIGNER ile reddeder). Zarfın imzası bu telefonun
  _davetIptaliYolla (p) {
    const L = this.L
    const me = this.kalici.kimlik
    if (!L.authorityIds().includes(this.meHex)) return
    const e = L.events[L.members.get(p).removedSeq]
    try { this.ag.gonder(p, Z.GUEST_REVOKED, GV.encodeGuestRevoked(L.familyId, b4a.from(p, 'hex'), e, me)) } catch (err) { this.hata(err) }
  }

  // Eşitleme durumu (D100; sdk/sync.js): taşıyıcı ve çevrimiçi üyeler buradan; aile kurulunca ya da bağlanınca
  // yeni nesnenin olayı uygulamaya bağlanır
  esitlemeGuncelle () {
    const d = this.n && this.n.esitleme
    if (!d) return
    if (this._esitlemeDinlenen !== d) {
      d.on('sync-status', (x) => this.olay('sync-status', x))
      this._esitlemeDinlenen = d
    }
    d.tasiyici = !!this.tasiyiciAcik()
    d.cevrimici = new Set([...this.acik].filter((p) => this._gecerli(p) && this.L.sessionRole(p) === 'uye' && this._rol(p) !== 'kutu'))
    d.changed()
  }

  // Misafirin oturumu (D99; RFC-0019 §11.3): defter gitmez; misafirliği veren ebeveyn güncel GUEST_VIEW'i yollar
  // (izinler, bırakma anahtarları, süre). Başka ebeveyn kuramaz (NOT_SIGNER): o zaman hiçbir şey gitmez
  _misafirGorunumu (p) {
    try { this.ag.gonder(p, Z.GUEST_VIEW, GV.buildGuestView(this.L, p, this.kalici.kimlik, { now: () => this.kalici.now() })) } catch {}
  }

  // Defter büyüdü: açık misafir oturumlarına yeni görünüm; misafirliği düşüren REVOKE için GUEST_REVOKED (misafir artık
  // oturum rolü taşımadığı için oturum süzgecinden geçmez, açık oturumdan bir kez doğrudan gider; RFC-0019 §11.3 b)
  //
  // Açılış öncesi inceleme: misafirliği veren ebeveynin ayrılması (LEAVE), çıkarılması (REMOVE_MEMBER) ya da
  // ebeveynlikten inmesi (SET_ROLE) de misafirliği düşürür (RFC-0020 e, RFC-0003 §5.12); o olayla da GUEST_REVOKED gider.
  // Yalnız ebeveyn yollar (misafir başka imzacıyı NOT_SIGNER ile reddeder). O an bağlı olmayan misafir öğrenmez:
  // düşen misafirlikle oturum kurulmaz; misafir görünümün süresi dolunca durur (sinirlar-ve-kapsam-disi.md).
  _misafirleriGuncelle (L, onceki) {
    const me = this.kalici.kimlik
    const benEbeveyn = L.members.get(hex(me.memberId))?.role === 'ebeveyn'
    const yolla = (grantId, e) => {
      const p = hex(grantId)
      if (!benEbeveyn || !this.acik.has(p)) return
      try { this.ag.gonder(p, Z.GUEST_REVOKED, GV.encodeGuestRevoked(L.familyId, grantId, e, me)) } catch (err) { this.hata(err) }
    }
    for (const e of L.eventsFrom(onceki)) {
      if (e.type === T.REVOKE) { yolla(decodeBody(T.REVOKE, e.body).grantId, e); continue }
      if (e.type !== T.LEAVE && e.type !== T.REMOVE_MEMBER && e.type !== T.SET_ROLE) continue
      // Bu olayla düşen misafirlikler (dropOrphanGrants removedSeq = olayın sırası): veren cihaz değiştirmişse (halef)
      // grantedBy eski kimlikte kalır, olaydaki kimlikle karşılaştırılmaz (Codex 5. tur)
      for (const g of L.grants.values()) if (!g.active && g.orphaned && g.removedSeq === e.seq) yolla(g.id, e)
    }
    for (const p of this.acik) if (L.sessionRole(p) === 'misafir') this._misafirGorunumu(p)
  }

  koptu (peerHex) {
    const p = hex(peerHex)
    if (this.acik.has(p)) this._cevrimici(p, false)
    this.acik.delete(p)
    this.beklerkenAcilan.delete(p)
    this.selamlanan.delete(p)
    for (const k of [...this.oneriGiden]) if (k.startsWith(p + '|')) this.oneriGiden.delete(k)
    this.esitlemeGuncelle()
  }

  // Çevrimiçi bilgisi (D77): son görülme ve açık oturum Presence'de; HELLO.caps CapsBook'ta (HIDE_PRESENCE). Aile yoksa ya
  // da karşı taraf defterde yoksa yalnız kayıt düşülmez
  _cevrimici (p, acik, caps = null) {
    const n = this.n
    if (!n || !n.aile || !n.gorulme) return
    try {
      if (acik && Number.isSafeInteger(caps) && n.caps) n.caps.record(p, caps, this.kalici.now())
      if (acik) n.gorulme.sessionOpened(p)
      else n.gorulme.sessionClosed(p)
      if (n.defter && typeof n.defter.emit === 'function') n.defter.emit('presence', { memberId: p, online: acik })
    } catch (err) { this.hata(err) }
  }

  // Oturum hem açık hem de defterde geçerli (aktif ve bekleyen değil) mi
  _gecerli (p) {
    if (!this.acik.has(p) || !this.L || p === this.meHex) return false
    const r = this.L.sessionRole(p)
    return r === 'uye' || (r === 'cihaz' && this.benimRol === 'uye')
  }

  _gonder (p, type, bytes) {
    if (!this._gecerli(p) || !typeAllowed(this.benimRol, this.L.sessionRole(p), type, 'giden')) return false
    try { return this.ag.gonder(p, type, bytes) !== false } catch (err) { this.hata(err); return false }
  }

  // Aile içinde ilk karşılaşma: defter isteği ve kayıt özetleri
  _selamla (p) {
    this.selamlanan.add(p)
    this._gonder(p, Z.LEDGER_REQ, S.encodeReq({ fromSeq: this.L.len }))
    // Karşı taraf bizden kısaysa bizim olaylarımızı da alsın (istemesini beklemeden)
    this._gonder(p, Z.LEDGER_EVENTS, S.encodeEvents({ fromSeq: 0, events: this.L.eventsFrom(0).map(encodeEvent) }))
    this._ozetGonder(p)
    for (const m of this.bekleyen.get(p) || []) this._gonder(p, m.type, m.bytes)
    this.bekleyen.delete(p)
  }

  // LEAVE alındısı (RFC-0034 §4.5 açıklama, açılış öncesi inceleme): gönderenin kendi LEAVE'i bu gelişle defterimize
  // girdiyse, o olay aynı oturumdan gönderene bir kez geri gönderilir. Gönderen artık üye olmadığı için _gonder'in
  // denetiminden geçmez; doğrudan ağa yazılır (oturum açık ve doğrulanmış; taşıyıcı üyeliği yeniden sormaz). Yeni
  // protokol türü yok: yankı sıradan bir LEDGER_EVENTS'tir, eski sürüm onu zaten bildiği olay olarak yok sayar.
  _leaveYankisi (p, once) {
    const L = this.L
    const m = L.members.get(p) // LEAVE'in memberId'si ham kimliktir (ek kimlik ana kimliğe çözülmez; RFC-0017)
    if (!m || m.active || !Number.isSafeInteger(m.removedSeq) || m.removedSeq < once) return
    const e = L.events[m.removedSeq]
    if (!e || e.type !== T.LEAVE) return
    try { this.ag.gonder(p, Z.LEDGER_EVENTS, S.encodeEvents({ fromSeq: m.removedSeq, events: [encodeEvent(e)] })) } catch (err) { this.hata(err) }
  }

  // Çıkarılan uç kendi çıkarılmasını görür (kurucu §6.8; RFC-0034 §4.5; Codex 12. tur): yeni olaylarla çıkarılan (REMOVE_MEMBER,
  // DEVICE_DETACH, imzasız ROTATE_DEVICE, ana kimlikle düşen ek kimlik) ve oturumu açık, selamlaşılmış uca, çıkarılmasına
  // kadarki olaylar bir kez gider; wipe: true ise o uç kendini siler. Uç artık geçerli olmadığı için _gonder'den geçmez,
  // doğrudan ağa yazılır (LEAVE yankısıyla aynı; yeni protokol türü yok). Çıkarılmadan sonraki olaylar gitmez. Selamlaşılmış
  // uç önceki olayların hepsini almıştır (önceki uzunluktan başlanır). LEAVE'in yankısı _leaveYankisi'nde
  _cikarilanaBildir (L, onceki) {
    for (const p of this.selamlanan) {
      if (!this.acik.has(p) || this._gecerli(p)) continue
      const x = L.members.get(p) || L.devices.get(p)
      if (!x || x.active || !Number.isSafeInteger(x.removedSeq) || x.removedSeq < onceki || x.removedSeq >= L.len) continue
      if (L.events[x.removedSeq]?.type === T.LEAVE) continue
      const events = L.events.slice(onceki, x.removedSeq + 1).map(encodeEvent)
      try { this.ag.gonder(p, Z.LEDGER_EVENTS, S.encodeEvents({ fromSeq: onceki, events })) } catch (err) { this.hata(err) }
    }
  }

  // Ayrılma bekleyen tarafta: gelen olaylar bizim LEAVE'imizi aynen içeriyorsa karşı taraf onu defterine almıştır. Yalnız
  // aktif bir üyenin ya da kutunun yankısı sayılır (§4.5: LEAVE üyeye ya da kutuya ulaşmalı); işçi olayı saklamadan geri
  // gönderebilir (açılış öncesi inceleme, Codex 4. tur)
  _leaveYankisiMi (p, m) {
    if (!this.ayrilmaAlindi) return
    const L = this.L
    if (L.sessionRole(p) !== 'uye') return
    const ben = L.members.get(this.meHex)
    if (!ben || ben.active || !Number.isSafeInteger(ben.removedSeq) || L.events[ben.removedSeq]?.type !== T.LEAVE) return
    const i = ben.removedSeq - m.fromSeq
    if (i < 0 || i >= m.events.length) return
    if (b4a.equals(b4a.from(m.events[i]), encodeEvent(L.events[ben.removedSeq]))) this.ayrilmaAlindi(p)
  }

  // Kayıt özetleri: telefon ↔ telefon REC_VV, telefon ↔ kutu her ortak koleksiyon için REC_BUCKETS
  _ozetGonder (p) {
    if (this._cihaz(p)) return // cihazla kayıt eşitlemesi yok
    const L = this.L
    const r = this.n.replika
    const seq = L.len - 1
    if (this.kutuyum) {
      const k = this.kutu
      k.yetki.update(L)
      for (const cid of k.yetki.cols.keys()) if (k.yetki.isReader(cid, p, seq)) this._gonder(p, Z.REC_BUCKETS, k.bucketsMsg(cid))
      return
    }
    if (this._rol(p) === 'kutu') {
      r._catchUp()
      for (const cid of r.yetki.cols.keys()) if (r.yetki.isReader(cid, this.meHex, seq)) this._gonder(p, Z.REC_BUCKETS, E.bucketsMsg(cid, E.phoneSet(r, cid)))
      for (const b of this.yuklenecek.splice(0)) this._gonder(p, Z.BLOB_DATA, b)
      return
    }
    this._gonder(p, Z.REC_VV, E.vvFor(r, p))
  }

  // ---------------------------------------------------------------- giden işler

  // Yerel değişiklikten (komut, gelen zarf, bağlantı) sonra: defter, öneriler, çıkış kutusu, kasa payları, dosyalar
  akit () {
    const L = this.L
    if (!L) return
    this._beklemeBitti()
    if (this._uzunluk === null) this._uzunluk = L.len
    // Defter büyüdüyse yeni olaylar ve yeni yetkilerle kayıt özetleri, önceden selamlanan uçlara
    if (L.len > this._uzunluk) {
      const onceki = this._uzunluk
      const msg = S.encodeEvents({ fromSeq: this._uzunluk, events: L.eventsFrom(this._uzunluk).map(encodeEvent) })
      this._uzunluk = L.len
      this._misafirleriGuncelle(L, onceki)
      for (const p of this.selamlanan) if (this._gonder(p, Z.LEDGER_EVENTS, msg)) this._ozetGonder(p)
      this._cikarilanaBildir(L, onceki)
    }
    for (const p of this.acik) if (!this.selamlanan.has(p) && this._gecerli(p)) this._selamla(p)
    this._oneriler()
    this._kasaZarf()
    this._cikis()
    this._urunKuyrugu()
    this._kasa()
    this._dosyalar()
    this.esitlemeGuncelle()
  }

  // Kasa açıkken KRA'yı bilen telefon dönem değişiminde zarf kaydını yeniden yazar (RFC-0027 §9 b); yazılan kayıt aynı
  // turda çıkış kutusundan gider
  _kasaZarf () {
    const k = this.n.kasa
    if (!k || this.kutuyum || k.locked()) return
    try { k.renewEnvelope() } catch (err) { this.hata(err) }
  }

  // Bekleyen öneriler (imza toplayan defter olayları) bütün uçlara; imza sayısı arttıkça yeniden
  _oneriler () {
    const o = this.n.defter.oneriler
    for (const [id, it] of o.items) {
      const bytes = encodeEvent(it.event)
      for (const p of this.selamlanan) {
        if (this._cihaz(p)) continue
        const k = p + '|' + id + '|' + it.event.sigs.length
        if (this.oneriGiden.has(k)) continue
        if (this._gonder(p, Z.LEDGER_PROPOSE, bytes)) this.oneriGiden.add(k)
      }
    }
  }

  // Replikanın çıkış kutusu: işlemler koleksiyonun çevrimiçi okuyucularına ve kutuya, anahtar ve kesimler alıcılarına
  _cikis () {
    const r = this.n.replika
    if (!r || this.kutuyum) { if (r) r.outbox.length = 0; return }
    const L = this.L
    const seq = L.len - 1
    const kasa = this.kalici._kasaCidleri()
    const gerikonan = []
    const es = this.n.esitleme
    for (const m of r.outbox.splice(0)) {
      const okuyucular = [...L.members.keys()].filter((id) => id !== this.meHex && L.sessionRole(id) === 'uye' && this._rol(id) !== 'kutu' && r.yetki.isReader(m.cid, id, seq))
      if (m.type === Z.REC_OPS) {
        // Kendi yazımım (çıkış kutusuna yalnız kendi işlemlerim girer): başka okuyucusu varsa teyide kadar bekler (D100)
        if (es && !m.kind && okuyucular.length) { try { es.bekleyen.add(hex(peekOp(m.bytes).opId)) } catch {} }
        const bytes = E.packOps([{ kind: m.kind || 0, bytes: m.bytes }])[0]
        for (const p of okuyucular) this._gonder(p, Z.REC_OPS, bytes)
        for (const p of this.acik) if (this._rol(p) === 'kutu') this._gonder(p, Z.REC_OPS, bytes)
        continue
      }
      // REC_KEY ve REC_CUTOFF: to yoksa koleksiyonun okuyucuları. Çevrimdışı alıcıya bellekte bekler; kasa koleksiyonunun
      // anahtar ve kesim mesajları ise bellekteki bekleyen kuyruğuna hiç girmez: gönderilemeyen alıcılarla çıkışta kalır,
      // yazımda arsive mühürlenir, LOCK'ta sıfırlanıp silinir, kilit açılınca geri gelir (RFC-0027 §5 g; inceleme 15 B2)
      const alicilar = Array.isArray(m.to) ? m.to : okuyucular
      const kalan = []
      for (const p of alicilar) {
        if (this.selamlanan.has(p) && this._gonder(p, m.type, m.bytes)) continue
        if (kasa.has(m.cid)) { kalan.push(p); continue }
        if (!this.bekleyen.has(p)) this.bekleyen.set(p, [])
        this.bekleyen.get(p).push({ type: m.type, bytes: m.bytes, cid: m.cid })
      }
      if (kalan.length) gerikonan.push({ ...m, to: kalan })
    }
    r.outbox.push(...gerikonan)
    this._kasaBekleyenSil(kasa)
  }

  // Bekleyen kuyruğunda kalmış kasa anahtar ve kesim mesajları (önceki sürümden ya da koleksiyon sonradan kasaya alındıysa)
  // sıfırlanıp silinir
  _kasaBekleyenSil (kasa) {
    if (!kasa.size) return
    for (const [p, liste] of this.bekleyen) {
      const kal = liste.filter((m) => {
        if (!kasa.has(m.cid)) return true
        if (m.type === Z.REC_KEY) sodium.sodium_memzero(m.bytes)
        return false
      })
      if (kal.length) this.bekleyen.set(p, kal)
      else this.bekleyen.delete(p)
    }
  }

  // Kalıcı katman yazmadan ve kilitlemeden önce çağırır (start): çıkış kutusu gönderilir
  // Kilitlenmeden önce onaylanmış pay (KASA_SHARE_RES) da gider; LOCK onu bellekten siler (inceleme 19 B10)
  cikisiBosalt () { if (this.L) { this._cikis(); this._kasa() } }

  // Teslim edilmemiş kasa payları (D31): sahibi çevrimiçiyse KASA_SHARE_PUT
  _kasa () {
    const k = this.n.kasa
    if (!k) return
    for (const g of k.outgoing()) if (this.selamlanan.has(g.to)) this._gonder(g.to, g.type, g.bytes)
    // Kasa zarfının kutudaki opak kopyası (RFC-0027 §9 g): alındı gelene kadar
    for (const g of k.outgoingEnvelopes()) if (this.selamlanan.has(g.to)) this._gonder(g.to, g.type, g.bytes)
    // Kurtarma zarfları (D67): oturumu açık olana gider, gidemeyen sonraki fırsatta
    for (const g of k.recoveryOutgoing()) if (this.selamlanan.has(g.to) && this._gonder(g.to, g.type, g.bytes)) k.sent(g)
  }

  // Okunur kayıtların andığı ve bu telefonda olmayan dosyalar: kutudan, yoksa telefonlardan istenir
  _dosyalar () {
    const n = this.n
    if (this.kutuyum || !n.kayit) return
    const eksik = []
    for (const col of n.kayit.collections()) {
      if (!col.okur) continue
      let kayitlar
      try { kayitlar = n.replika.records(col.collectionId) } catch { continue }
      for (const id of D.referencedBlobs(kayitlar)) if (!this.istenen.has(id) && !n.kayit.depo.get(id)) eksik.push({ id, kayitlar })
    }
    if (!eksik.length) return
    const uclar = [...this.selamlanan].filter((p) => !this._cihaz(p)).sort((a, b) => (this._rol(b) === 'kutu') - (this._rol(a) === 'kutu'))
    for (const { id, kayitlar } of eksik) {
      const ref = this._ref(kayitlar, id)
      if (!ref) continue
      const istek = n.kayit.fetchRequest(ref)
      let giden = false
      for (const p of uclar) giden = this._gonder(p, istek.type, istek.bytes) || giden
      if (giden) this.istenen.add(id)
    }
  }

  _ref (kayitlar, id) {
    let bulunan = null
    const bak = (v) => {
      if (bulunan) return
      if (Array.isArray(v)) v.forEach(bak)
      else if (v && typeof v === 'object' && b4a.isBuffer(v.blobId) && hex(v.blobId) === id) bulunan = v
    }
    for (const x of kayitlar) Object.values(x.fields).forEach(bak)
    return bulunan
  }

  // RecordApi.attach'ın dosyaYuklendi kancası: yükleme kutuya gider (kutu çevrimdışıysa bağlanınca)
  yuklendi (blobRef, mesajlar) {
    const kutular = [...this.selamlanan].filter((p) => this._rol(p) === 'kutu')
    for (const b of mesajlar) {
      let giden = false
      for (const p of kutular) giden = this._gonder(p, Z.BLOB_DATA, b) || giden
      if (!giden) this.yuklenecek.push(b)
    }
  }

  // ---------------------------------------------------------------- düğümün kurtarma anahtarı

  // NODE_RECOVERY (RFC-0007 §8.5 adım 5, §13.6): düğüm LUKS kurtarma anahtarını töreni yapan ebeveynin telefonuna
  // yollar. Yalnız o telefon kaydeder: ailenin Kasa koleksiyonuna, yoksa Ebeveynler'e hf.node.luks-kurtarma kaydı
  // ({ node_id, ad, anahtar }); aynı anahtar ikinci kez yazılmaz. Yazınca imzalı alındı döner, düğüm dosyayı siler. Kasa
  // kilitliyse ya da yazılacak koleksiyon yoksa alındı verilmez: düğüm sonraki bağlanışta yeniden yollar. Kasa sonradan
  // kurulunca Ebeveynler'deki kaydın taşınması bu sürümde yok.
  _kurtarmaAl (p, d) {
    const L = this.L
    if (this.benimRol !== 'uye' || d.m.kind !== 'luks-kurtarma' || hex(d.m.nodeId) !== p) return
    const dev = L.devices.get(p)
    if (!dev || !dev.active) return
    if (!R.verifyNodeRecovery(L.familyId, d, dev.signPub)) throw new Error('INVALID_SIGNATURE')
    if (!R.torenEbeveyni(L, p).includes(this.meHex)) return
    const kayit = this.n.kayit
    const { olay: { ebeveynlerMi } } = require('@havenfold/events')
    const cols = kayit.collections().filter((col) => col.writable)
    const yer = cols.find((col) => col.kind === 'genel' && col.sensitivity === 'kasa') || cols.find((col) => ebeveynlerMi(col))
    if (!yer) return
    try {
      const ayni = kayit.query(yer.collectionId, { type: R.KAYIT_TURU }).some((k) => k.fields.node_id === p && b4a.isBuffer(k.fields.anahtar) && b4a.equals(k.fields.anahtar, d.m.secret))
      if (!ayni) kayit.put(yer.collectionId, null, R.KAYIT_TURU, { node_id: p, ad: dev.name || '', anahtar: b4a.from(d.m.secret) })
    } catch (err) {
      if (err && err.message === 'VAULT_LOCKED') return
      throw err
    }
    this._gonder(p, Z.NODE_RECOVERY, R.encodeNodeRecovery(L.familyId, { nodeId: d.m.nodeId, kind: 'alindi' }, this.kalici.kimlik))
  }

  // ---------------------------------------------------------------- gelen zarflar

  // Ürün zarfının işleyicisi (yalnız URUN_ZARFLARI; ör. SHARE_PREVIEW → ServiceApi.receivePreview). İşleyici gelenZarf'ı kendisi
  // oturum rolüyle çağırır (dördüncü argüman); hata atarsa al() onu hata olarak döndürür. teslim(peerHex, id): kuyruktaki zarf
  // alıcıya gittiğinde (RFC-0010 açıklama 3 madde 3: "önizleme gitti" yalnız teslimde)
  urunZarfi (type, fn, teslim = null) {
    if (!URUN_ZARFLARI.has(type) || typeof fn !== 'function') throw new Error('TYPE_NOT_ALLOWED')
    this.urunZarflari.set(type, { isle: fn, teslim: typeof teslim === 'function' ? teslim : null })
  }

  // Ürün zarfı kalıcı kuyruğa girer ve kuyruk hemen denenir. Alıcı yalnız aktif üye telefonu (kutu, cihaz, misafir, bekleyen
  // ve çıkarılmış üye değil; açıklama 3 madde 3). Zarf, o alıcıyla selamlaşma ve kayıt çıkışı gönderildikten sonra gider:
  // önizlemenin andığı kayıtlar önce yola çıkar. Aynı alıcı ve kimlikle ikinci zarf öncekinin yerine geçer. Kuyrukta en çok
  // URUN_KUYRUK_EN_COK zarf; doluysa QUEUE_FULL. Dönüş: şimdi gitti mi
  zarfGonder (peerHex, type, bytes, id = '') {
    if (!URUN_ZARFLARI.has(type)) throw new Error('TYPE_NOT_ALLOWED')
    const p = hex(peerHex)
    if (!this._urunAlicisi(p)) throw new Error('INVALID_RECEIVER')
    const k = this._kuyrukDepo()
    const l = (k.get('kuyruk') || []).filter((x) => !(x.p === p && x.type === type && x.id === id))
    // Kuyruk doluysa en eskisi sessizce atılmaz (Codex 7. tur: önce giren SOS düşüyordu); yeni zarf reddedilir, çağıran
    // sonra yeniden dener
    if (l.length >= URUN_KUYRUK_EN_COK) throw new Error('QUEUE_FULL')
    l.push({ p, type, bytes: hex(bytes), id })
    k.set('kuyruk', l)
    return this._urunKuyrugu().has(p + '|' + type + '|' + id)
  }

  _kuyrukDepo () { return this.kalici.urunSaklama('esitleyici/') }

  _urunAlicisi (p) {
    const L = this.L
    const m = L && L.members.get(p)
    return !!m && m.active && m.role !== 'kutu' && !L.isPending(p) && L.sessionRole(p) === 'uye'
  }

  // Kuyruktaki ürün zarflarını selamlaşılmış alıcılara gönderir; geçersizleşen alıcının zarfı düşer. Dönüş: gidenlerin anahtarları
  _urunKuyrugu () {
    const giden = new Set()
    if (!this.L || typeof this.kalici.urunSaklama !== 'function') return giden
    const k = this._kuyrukDepo()
    const l = k.get('kuyruk') || []
    if (!l.length) return giden
    const kalan = []
    for (const x of l) {
      if (!this._urunAlicisi(x.p)) continue
      if (this.selamlanan.has(x.p) && this._gonder(x.p, x.type, b4a.from(x.bytes, 'hex'))) {
        giden.add(x.p + '|' + x.type + '|' + x.id)
        const h = this.urunZarflari.get(x.type)
        if (h && h.teslim) { try { h.teslim(x.p, x.id) } catch (err) { this.hata(err) } }
      } else kalan.push(x)
    }
    if (kalan.length !== l.length) k.set('kuyruk', kalan)
    return giden
  }

  al (peerHex, type, bytes, yol = 'dogrudan') {
    const p = hex(peerHex)
    const L = this.L
    if (!L) return { hata: 'NO_FAMILY' }
    // Sınırlı iptal oturumu (D106): beklerken yalnız imzalı iptal kabul edilir; SDK'nın kendisi çözdüğü türler dahil
    // hiçbir şey süzgeci atlamaz (Codex 11. tur)
    if (type !== Z.GUEST_REVOKED && this._davetliyim()) { this.reddedilen++; return { hata: 'TYPE_NOT_ALLOWED' } }
    this._isliyor++
    try {
      let mesaj = bytes
      if (!SDK_GIRISLI.has(type)) mesaj = giris.gelenZarf({ myRole: this.benimRol, peerRole: L.sessionRole(p), type, bytes, L, gonderen: p, yol }).mesaj
      this._isle(p, type, bytes, mesaj, yol)
      return { hata: null }
    } catch (err) {
      if (err && err.message === 'TYPE_NOT_ALLOWED') this.reddedilen++
      else this.hata(err)
      return { hata: (err && err.message) || 'INTERNAL_ERROR' }
    } finally {
      this._isliyor--
      if (!this._isliyor) { this.degisti(); this.akit() }
    }
  }

  _isle (p, type, bytes, m, yol) {
    const n = this.n
    const r = n.replika
    if (URUN_ZARFLARI.has(type)) {
      const f = this.urunZarflari.get(type)
      if (f) f.isle(p, bytes, yol, this.L.sessionRole(p))
      return
    }
    switch (type) {
      case Z.GUEST_REVOKED: {
        // Bekleyen uzaktan üyenin daveti iptal edildi (D106 K4; Codex 10. tur): törende alınan defterle doğrulanır, örnek
        // silinir (start.js). Bekleyen değilsek (etkin üye) zarfın burada işi yok
        const L = this.L
        if (!L.isPending(this.meHex) || !L.members.get(this.meHex)?.pendingRemote) return
        const r = GV.verifyInviteRevoked(L, bytes, this.meHex)
        if (this.davetIptal) this.davetIptal(r)
        return
      }
      case Z.LEDGER_REQ: {
        const cevap = S.answerReq(this.L, m)
        this._gonder(p, Z.LEDGER_EVENTS, S.encodeEvents(cevap))
        return
      }
      case Z.LEDGER_EVENTS: {
        if (!m.events.length) return
        this._leaveYankisiMi(p, m)
        const once = this.L.len
        const sonuc = S.ingest(this.L, m)
        if (sonuc.needFrom !== undefined) this._gonder(p, Z.LEDGER_REQ, S.encodeReq({ fromSeq: sonuc.needFrom }))
        if (sonuc.added || sonuc.replaced) {
          if (sonuc.replaced) this._uzunluk = 0
          else if (this._uzunluk === null || this._uzunluk > once) this._uzunluk = once
          this._leaveYankisi(p, once)
          this._defterDegisti()
        }
        return
      }
      case Z.LEDGER_PROPOSE: {
        const once = this.L.len
        n.defter.receiveProposal(p, bytes, yol)
        if (this.L.len !== once) this._defterDegisti()
        return
      }
      // İşçiden (RFC-0002 §4, §6.3): yetenek bildirimi ve görev cevapları; TaskApi.receive kendi girişinden geçirir
      case Z.NODE_CAPS:
        if (n.gorev && capsKabul(this, p)) n.gorev.y.al(bytes, { from: p })
        return
      case Z.TASK_ACCEPT: case Z.TASK_REJECT: case Z.TASK_PROGRESS: case Z.TASK_RESULT:
        if (n.gorev) n.gorev.receive(p, type, bytes, yol)
        return
      case Z.NODE_RECOVERY:
        this._kurtarmaAl(p, m)
        return
      case Z.REC_VV:
        if (n.esitleme) { try { n.esitleme.confirmed(E.teyitler(r, p, bytes)) } catch (err) { this.hata(err) } }
        for (const x of E.onVv(r, p, bytes)) this._gonder(p, x.type, x.bytes)
        return
      case Z.REC_IDS:
        for (const x of E.onIds(r, p, bytes)) this._gonder(p, x.type, x.bytes)
        return
      case Z.REC_OPS: {
        if (this.kutuyum) {
          for (const it of m.items) this.kutu.accept(p, it.kind, it.bytes)
          return
        }
        this._islemler(E.onOps(r, bytes))
        // Gönderene güncel özet (D100): işlemlerinin ulaştığını REC_VV'den teyit eder (eşitleme durumu). Yeni mesaj türü
        // yok; özet zaten ortak koleksiyonlarda gidiyor. Özet özete cevap üretmez (döngü yok)
        if (this._rol(p) !== 'kutu') this._gonder(p, Z.REC_VV, E.vvFor(r, p))
        return
      }
      case Z.REC_KEY: {
        const s = r.receiveKey(bytes)
        if (s.status === 'tamam') { n.kayit.sync(); this._yenidenOzet() }
        return
      }
      case Z.REC_KEY_REQ:
        try { for (const x of r.answerKeyReq(p, bytes)) this._gonder(p, x.type, x.bytes) } catch (err) { this.hata(err) }
        return
      case Z.REC_CUTOFF:
        r.receiveCutoff(bytes)
        n.kayit.sync()
        return
      case Z.REC_BUCKETS: {
        const cid = hex(m.collectionId)
        const out = this.kutuyum ? this.kutu.onBuckets(cid, bytes) : E.onBuckets(cid, E.phoneSet(r, cid), bytes)
        for (const x of out) this._gonder(p, x.type, x.bytes)
        return
      }
      case Z.REC_BUCKET_IDS: {
        const cid = hex(m.collectionId)
        const out = this.kutuyum ? this.kutu.onBucketIds(cid, bytes) : E.onBucketIds(cid, E.phoneSet(r, cid), bytes)
        for (const x of out) this._gonder(p, x.type, x.bytes)
        return
      }
      case Z.BLOB_REQ: {
        const parcalar = n.kayit.depo.get(hex(m.blobId))
        if (!parcalar) return
        const son = Math.min(parcalar.length, m.from + m.count)
        for (let i = m.from; i < son; i++) this._gonder(p, Z.BLOB_DATA, c.encode(D.blobData, { blobId: m.blobId, index: i, total: parcalar.length, chunk: parcalar[i] }))
        return
      }
      case Z.BLOB_DATA: {
        // Misafirden dosya alınmaz (Codex 12. tur): telefon dosyayı yalnız selamlaştığı üyelerden ister ve misafirin
        // bırakmasında dosya eki yoktur (RFC-0030 madde 5, v1). İstenmemiş dosyalarla ebeveyn telefonunun diski dolmasın
        if (this.L.sessionRole(p) === 'misafir') throw new Error('TYPE_NOT_ALLOWED')
        const durum = n.kayit.blobReceived(p, bytes, yol)
        if (durum !== 'tamam') return
        const blobId = D.decodeBlobData(bytes).blobId
        this.istenen.delete(hex(blobId))
        // Kutu tuttuğunu telefonlara bildirir (RFC-0019 §9)
        if (this.kutuyum) {
          const have = D.makeBlobHave(this.L.familyId, [blobId], this.kalici.kimlik)
          for (const u of this.selamlanan) this._gonder(u, Z.BLOB_HAVE, have)
        } else n.kayit.emit('dosya', hex(blobId))
        return
      }
      case Z.BLOB_HAVE:
        if (!this.kutuyum) n.kayit.blobHaveReceived(p, bytes, yol)
        return
      case Z.KASA_SHARE_PUT: {
        // Beklenen retler alındısız kalır, çekirdek hatası değildir: eşzamanlı döndürmede kaybeden dağıtımın payı ve
        // 72 saat beklemesindeki göndericinin payı (RFC-0027 §9 e, inceleme 19 B1); gönderen geri çeker ya da bekler
        const beklenen = (err) => { if (!['ROTATION_LOST', 'ON_HOLD'].includes(err && err.message)) throw err; return null }
        // Kutu: pay TPM mühürlü dosyaya yazılınca alındı (kutuPay içinde); mühürleyemeyen kutu pay tutmaz
        if (this.kutuyum) {
          if (!this.kutuPay) return
          let a
          try { a = this.kutuPay.payAl(p, bytes, yol) } catch (err) { a = beklenen(err) }
          if (a) this._gonder(p, a.type, a.bytes)
          return
        }
        if (!n.kasa) return
        let a
        try { a = n.kasa.receiveShare(p, bytes, yol) } catch (err) { a = beklenen(err) }
        if (!a) return
        // Alındı, pay diske (kilitliyken arsive) yazılmadan gitmez: yazım düşerse gönderen yeniden dener
        if (a.durum === 'yeni' || a.durum === 'degisti') this.kalici.kaydet()
        this._gonder(p, a.type, a.bytes)
        return
      }
      case Z.KASA_SHARE_ACK:
        if (n.kasa) n.kasa.receiveAck(p, bytes, yol)
        return
      // Kurtarma (RFC-0004 §5; D67): kutu sormadan cevap verir; telefon sürümü söyler, pay isteğini kullanıcıya sorar
      case Z.KASA_VERSION_REQ: {
        const a = this.kutuyum ? (this.kutuPay && this.kutuPay.surumIstegiAl ? this.kutuPay.surumIstegiAl(p, bytes, yol) : null) : (n.kasa ? n.kasa.receiveVersionRequest(p, bytes, yol) : null)
        if (a) this._gonder(p, a.type, a.bytes)
        return
      }
      case Z.KASA_SHARE_REQ: {
        if (this.kutuyum) {
          const a = this.kutuPay && this.kutuPay.payIstegiAl ? this.kutuPay.payIstegiAl(p, bytes, yol) : null
          if (a) this._gonder(p, a.type, a.bytes)
          return
        }
        if (n.kasa) n.kasa.receiveShareRequest(p, bytes, yol)
        return
      }
      case Z.KASA_VERSION_RES:
        if (n.kasa) n.kasa.receiveVersionReply(p, bytes, yol)
        return
      case Z.KASA_SHARE_RES:
        if (n.kasa) n.kasa.receiveShareReply(p, bytes, yol)
        return
      // Zarfın kutudaki opak kopyası (RFC-0027 §9 g): kutu tutar ve etiketle verir; telefon alındıyı ve zarfı alır
      case Z.KASA_ENV_PUT: {
        if (!this.kutuyum || !this.kutuPay || !this.kutuPay.zarfAl) return
        let a
        try { a = this.kutuPay.zarfAl(p, bytes, yol) } catch (err) { if (!['STALE_VERSION', 'STALE_ENVELOPE', 'ON_HOLD'].includes(err && err.message)) throw err; return }
        this._gonder(p, a.type, a.bytes)
        return
      }
      case Z.KASA_ENV_REQ: {
        if (!this.kutuyum || !this.kutuPay || !this.kutuPay.zarfIstegiAl) return
        const a = this.kutuPay.zarfIstegiAl(p, bytes, yol)
        if (a) this._gonder(p, a.type, a.bytes)
        return
      }
      case Z.KASA_ENV_ACK:
        if (n.kasa) n.kasa.receiveEnvelopeAck(p, bytes, yol)
        return
      case Z.KASA_ENV_RES:
        // Açılan dönem anahtarlarıyla okunabilir olan kayıtlar uçlardan (kutu kovaları dahil) yeniden istenir
        if (n.kasa && n.kasa.receiveEnvelopeReply(p, bytes, yol) === 'acildi') { n.kayit.sync(); this._yenidenOzet() }
    }
  }

  // Gelen işlemlerin değiştirdiği kayıtlar uygulamaya bildirilir
  _islemler (sonuclar) {
    const r = this.n.replika
    const degisen = new Map()
    for (const s of sonuclar) {
      const o = s.opId && r.ops.get(s.opId)
      if (!o || s.status === 'reddedildi') continue
      if (!degisen.has(o.cid)) degisen.set(o.cid, new Set())
      if (o.inner && o.inner.recordId) degisen.get(o.cid).add(hex(o.inner.recordId))
    }
    for (const [cid, ids] of degisen) this.n.kayit.changed(cid, [...ids])
  }

  // Yeni anahtar: önce gönderilemeyen (anahtarsız dönem) işlemler için özet yeniden
  _yenidenOzet () {
    for (const p of this.selamlanan) if (this._gecerli(p) && this._rol(p) !== 'kutu' && !this.kutuyum) this._gonder(p, Z.REC_VV, E.vvFor(this.n.replika, p))
  }

  _defterDegisti () {
    const n = this.n
    if (n.kayit) n.kayit.sync()
    n.defter.changed()
    if (this.kutuyum) this.kutu.yetki.update(this.L)
  }
}

module.exports = { Esitleyici, SDK_GIRISLI, Kutu }
