// SPDX-License-Identifier: Apache-2.0
// team.js — ekip topluluğunun ürün yüzü (RFC-0005, RFC-0022; Mekan için): kuruluş, rol, yere atama, geçicinin süresi,
// kamera aydınlatması, çıkarma ve ayrılış makbuzu, yerler. Kanal komutları 280–287 (RFC-0005 §17; 288–289 köprü).
//
// Defter katmanı (yeter sayı, ASSIGN/TERM/NOTICE, EKIP_CIKIS) çekirdekte (core/core/ledger/team.js,
// protocol/team-exit.js); burada yalnız olayları kuran, yazan tarafın kurallarını uygulayan ve durumu okuyan yüz var.
// Yazımlar LedgerApi üstündendir: yeter sayı eksikse öneri olur (oneriId, waitingFor), diğer imzacılar sign() ile ekler.
const b4a = require('b4a')
const sodium = require('sodium-native')
const { giris, ledger: { T, eventHash }, encoding: { decodeBody }, ekipCikis: EC, policy: { DEFAULT_POLICY, HARD_MAX_MEMBERS_EKIP } } = require('@havenfold/core')
const { Emitter, LedgerApi } = require('./api')

const hex = (b) => (typeof b === 'string' ? b : b4a.toString(b, 'hex'))
const unhex = (h) => (typeof h === 'string' ? b4a.from(h, 'hex') : h)
function fail (code) { throw new Error(code) }
const rastgele16 = () => { const b = b4a.alloc(16); sodium.randombytes_buf(b); return b }

const DAY_MS = 86_400_000
const MAX_TERM_MS = 90 * DAY_MS // TERM'i yazan tarafın sınırı (RFC-0005 §7.2)
const YER_TURLERI = ['sube', 'depo', 'ciftlik', 'ofis', 'diger']
const ROLLER = ['sahip', 'yonetici', 'calisan', 'gecici']
const TEAM_COMMAND = {
  TEAM_CREATE: 280, TEAM_ROLE: 281, TEAM_ASSIGN: 282, TEAM_TERM: 283, TEAM_NOTICE: 284, TEAM_REMOVE: 285, TEAM_EXIT_STATUS: 286, TEAM_PLACES: 287
}

// Yerin varsayılan koleksiyonları (RFC-0005 §8.4): Yer:<ad> ve Olaylar:<ad>
function yerKoleksiyonlari (d, placeId, ad, birakma) {
  const y = 'yer:' + hex(placeId)
  const yerdekiler = [y + '/rol:yonetici', y + '/rol:calisan', y + '/rol:gecici']
  return [
    d.openCollection({ name: 'Yer:' + ad, readers: ['rol:sahip', ...yerdekiler], writers: ['rol:sahip', ...yerdekiler], taskAccess: true }),
    olaylarAc(d, birakma, { name: 'Olaylar:' + ad, readers: ['rol:sahip', y + '/rol:yonetici'], writers: ['rol:sahip', y + '/rol:yonetici'], taskAccess: true })
  ]
}

// Olaylar koleksiyonunun bırakma anahtarı (RFC-0001 §10.1; inceleme 16 K6): crypto_box anahtar çifti. Açık yarısı
// defterde; gizlisi açan telefonun replikasına (addDropSecret) verilir, oradan okuyuculara anahtar mesajıyla gider.
const birakmaCifti = () => { const pk = b4a.alloc(32); const sk = b4a.alloc(32); sodium.crypto_box_keypair(pk, sk); return { pk, sk } }

// Olaylar türündeki koleksiyonu açar; uygulanırsa gizli yarı birakma listesine eklenir
function olaylarAc (d, birakma, o) {
  const { pk, sk } = birakmaCifti()
  const r = d.openCollection({ ...o, kind: 'olaylar', dropKey: pk })
  if (r.durum === 'uygulandi') birakma.push({ collectionId: hex(decodeBody(T.COLLECTION, r.event.body).collectionId), secret: sk })
  else sodium.sodium_memzero(sk)
  return r
}

class TeamApi extends Emitter {
  // defter: LedgerApi (ekip defteri, kendi kimliğiyle). kayit: RecordApi (iş kapsamı silmede ve makbuz kaydında).
  // saklama: { get(k), set(k, v) } kalıcı küçük durum (makbuzlar, görülen makbuzlar); verilmezse bellekte.
  // kopru: bu uygulamanın BridgeApi'si (verilirse ayrılışta ve iş kapsamı silinince kapatılır; RFC-0027 §7 d)
  constructor ({ defter, kayit = null, now = null, saklama = null, kopru = null }) {
    super()
    if (!(defter instanceof LedgerApi)) fail('NO_LEDGER')
    this.d = defter
    this.kayit = kayit
    this.now = now || defter.now
    const m = new Map()
    this.saklama = saklama || { get: (k) => (m.has(k) ? m.get(k) : null), set: (k, v) => m.set(k, v) }
    this.kopru = kopru
    defter.on('ledger', (e) => this._olay(e))
  }

  get L () { return this.d.L }

  _ekipMi () { if (this.L.kind !== 'ekip') fail('TEAM_ONLY') }

  // 280 TEAM_CREATE (RFC-0005 §4.1): GENESIS, KIND ekip, PROTOCOL_LEVEL 2.1 (ve duzey), POLICY, ilk PLACE, kurucunun
  // ASSIGN'ı ve varsayılan koleksiyonlar (§8.4: Ekip, Yönetim, Kasa, Yer:<ad>, Olaylar:<ad>, Paylaşımlar).
  // GENESIS politikası aile kuralıyla doğrulandığı için en çok 8 kişi; ekip sınırı hemen ardından POLICY ile.
  static create ({ Ledger, me, isletmeAdi, displayName, yer = { ad: 'Merkez', tur: 'sube' }, maxMembers = HARD_MAX_MEMBERS_EKIP, ts = Date.now(), duzey = '2.2', placeId = null }) {
    if (typeof isletmeAdi !== 'string' || !isletmeAdi.trim()) fail('NAME_REQUIRED')
    if (!yer || typeof yer.ad !== 'string' || !yer.ad.trim()) fail('NAME_REQUIRED')
    const { ledger: L, event } = LedgerApi.createFamily({ Ledger, me, familyName: isletmeAdi.trim(), displayName, policy: { ...DEFAULT_POLICY, maxMembers: Math.min(8, DEFAULT_POLICY.maxMembers) }, ts, hazirla: false })
    let saat = ts
    const d = new LedgerApi({ ledger: L, me, now: () => ++saat })
    const yaz = (type, body) => { const r = d._yaz(type, body); if (r.durum !== 'uygulandi') fail('SETUP_INCOMPLETE'); return r }
    const olaylar = []
    const ekle = (r) => { olaylar.push(r.event); return r }
    ekle(yaz(T.KIND, { kind: 'ekip' }))
    ekle(yaz(T.PROTOCOL_LEVEL, { level: '2.1' }))
    if (duzey !== '2.1') ekle(d.raiseLevel(duzey))
    ekle(yaz(T.POLICY, { policy: { ...DEFAULT_POLICY, maxMembers } }))
    const p = placeId ? unhex(placeId) : rastgele16()
    ekle(yaz(T.PLACE, { placeId: p, name: yer.ad.trim(), kind: yer.tur || 'sube', remove: false }))
    ekle(yaz(T.ASSIGN, { subjectId: me.memberId, placeIds: [p] }))
    const ekip = ['rol:sahip', 'rol:yonetici', 'rol:calisan']
    const yonetim = ['rol:sahip', 'rol:yonetici']
    const birakma = []
    for (const r of [
      d.openCollection({ name: 'Ekip', readers: ekip, writers: ekip, taskAccess: true }),
      d.openCollection({ name: 'Yönetim', readers: yonetim, writers: yonetim, taskAccess: true }),
      d.openCollection({ name: 'Kasa', readers: ['rol:sahip'], writers: ['rol:sahip'], sensitivity: 'kasa', taskAccess: false }),
      ...yerKoleksiyonlari(d, p, yer.ad.trim(), birakma),
      olaylarAc(d, birakma, { name: 'Paylaşımlar', readers: yonetim, writers: yonetim, taskAccess: false })
    ]) ekle(r)
    // birakma: [{ collectionId, secret }] — kurucunun replikasına replika.addDropSecret(collectionId, secret) ile verilir
    return { ledger: L, event, olaylar, placeId: hex(p), birakma }
  }

  // 281 TEAM_ROLE: SET_ROLE (§6.2 satır 8). Geçiciye geçişte süre birlikte yazılır (süresiz geçici yoktur, §9.1 kural 1)
  role (memberId, role, { sureSonu = null } = {}) {
    this._ekipMi()
    if (!ROLLER.includes(role)) fail('INVALID_ROLE')
    if (role === 'gecici') this._sureDenetle(sureSonu)
    const r = this.d.changeRole(memberId, role)
    if (role === 'gecici' && r.durum === 'uygulandi') return { ...r, sure: this.setTerm(memberId, sureSonu) }
    // Öneri olduysa süre unutulmaz: SET_ROLE uygulanınca bu telefon TERM'i yazar (inceleme 16 şüpheli)
    if (role === 'gecici' && r.durum === 'oneri') this.saklama.set('ekip/bekleyen-sure', { ...this._bekleyenSure(), [hex(memberId)]: sureSonu })
    return r
  }

  _bekleyenSure () { return this.saklama.get('ekip/bekleyen-sure') || {} }

  // Defterde yeni olay (LedgerApi 'ledger'): öneriyle uygulanan geçiciye geçişin süresi
  _olay (e) {
    if (e.type !== T.SET_ROLE) return
    const bek = this._bekleyenSure()
    let b
    try { b = decodeBody(T.SET_ROLE, e.body) } catch { return }
    const id = hex(b.memberId)
    if (!(id in bek)) return
    const { [id]: sureSonu, ...kalan } = bek
    this.saklama.set('ekip/bekleyen-sure', kalan)
    if (b.role !== 'gecici') return
    try { this.emit('term', { memberId: id, sonuc: this.setTerm(id, sureSonu) }) } catch (err) { this.emit('term', { memberId: id, hata: err.message }) }
  }

  // 282 TEAM_ASSIGN: ASSIGN (§7.1); yeni liste öncekinin yerine geçer. Telefon üyesi 0–8 yer, kutu ve cihaz tam 1 yer.
  assign (subjectId, placeIds) {
    this._ekipMi()
    if (!Array.isArray(placeIds)) fail('INVALID_BODY')
    return this.d._yaz(T.ASSIGN, { subjectId: unhex(subjectId), placeIds: placeIds.map(unhex) })
  }

  _sureDenetle (expiresAt) {
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= 0) fail('TERM_REQUIRED')
    if (expiresAt > this.now() + MAX_TERM_MS) fail('TERM_LIMIT')
  }

  // 283 TEAM_TERM: TERM (§7.2). Yazan tarafın kuralı: en çok 90 gün sonrası. Süre uzatma ya da kısaltma yeni TERM'dir.
  setTerm (memberId, expiresAt) {
    this._ekipMi()
    this._sureDenetle(expiresAt)
    return this.d._yaz(T.TERM, { memberId: unhex(memberId), expiresAt })
  }

  // 284 TEAM_NOTICE: NOTICE (§7.3); herhangi bir sahip imzalar. remove: true yerin aydınlatmasını kaldırır
  privacyNotice ({ placeId, textBlobId, signBlobId, textVersion, cameraCount = 0, outbound = [], remove = false }) {
    this._ekipMi()
    if (!remove && (!textBlobId || !signBlobId)) fail('NOTICE_MISSING')
    const z = b4a.alloc(32)
    return this.d._yaz(T.NOTICE, {
      placeId: unhex(placeId), textBlobId: textBlobId ? unhex(textBlobId) : z, signBlobId: signBlobId ? unhex(signBlobId) : z,
      textVersion: textVersion || '', cameraCount, outbound, remove
    })
  }

  // 285 TEAM_REMOVE: REMOVE_MEMBER (§6.2 satır 2, §10.3). wipe: false iş kapsamı (işten çıkış), true tam (kayıp telefon).
  // Uygulanınca cikis: çıkarılan cihaza gidecek EKIP_CIKIS (0xC8) baytları; öneri olursa uygulandığında cikisMesaji().
  remove (memberId, { wipe = false, reason = '' } = {}) {
    this._ekipMi()
    const r = this.d.removeMember(memberId, { wipe, reason })
    return r.durum === 'uygulandi' ? { ...r, cikis: { type: EC.Z.EKIP_CIKIS, bytes: EC.encodeCikis(this.L, r.event) } } : r
  }

  // Defterdeki REMOVE_MEMBER için EKIP_CIKIS (yeniden gönderim ya da öneriyle uygulanan çıkarma)
  exitMessage (memberId) {
    const m = this.L.members.get(hex(memberId))
    const e = m && !m.active && this.L.events[m.removedSeq]
    if (!e || e.type !== T.REMOVE_MEMBER) fail('NO_TARGET')
    return { type: EC.Z.EKIP_CIKIS, bytes: EC.encodeCikis(this.L, e) }
  }

  _makbuzlar () { return this.saklama.get('ekip/makbuz') || {} }

  // Yönetim tarafı: gelen EKIP_CIKIS_OK (0xC9; tek giriş noktası). Çıkarılan üye HELLO yapamaz, makbuz Posta Kutusu'ndan
  // çift oturumuyla gelir: oturum rolü üye, ekipte çıkarılmış üyeden yalnız bu tür geçer (giris.gelenZarf). Denetlenir
  // (RFC-0022 e: tek kullanımlık, olaya bağlı, eski kimlikten değil); kabul edilirse saklanır ve kayit verildiyse Yönetim
  // koleksiyonuna hf.ekip.cikis kaydı yazılır (§10.3).
  receiveReceipt (fromHex, bytes, yol) {
    this._ekipMi()
    const from = hex(fromHex)
    giris.gelenZarf({ myRole: 'uye', peerRole: this.L.members.has(from) ? 'uye' : null, type: EC.Z.EKIP_CIKIS_OK, bytes, L: this.L, gonderen: from, yol })
    const hepsi = this._makbuzlar()
    const m = EC.makbuzDenetle(this.L, b4a.from(bytes), { simdi: this.now() })
    const id = hex(m.memberId)
    if (id !== from) fail('UNAUTHORIZED') // makbuz yalnız kendi oturumundan
    if (hepsi[id + '|' + hex(m.eventHash)]) fail('DUPLICATE_RECEIPT')
    const kayit = { memberId: id, eventHash: hex(m.eventHash), scope: m.scope, collections: m.collections, convs: m.convs, blobs: m.blobs, finishedAt: m.finishedAt, alindi: this.now() }
    this.saklama.set('ekip/makbuz', { ...hepsi, [id + '|' + kayit.eventHash]: kayit })
    if (this.kayit) {
      const y = [...this.L.collections.values()].find((c) => c.name === 'Yönetim' && c.kind === 'genel')
      if (y) {
        try {
          this.kayit.put(y.id, null, 'hf.ekip.cikis', { uye: id, kapsam: m.scope === EC.KAPSAM.TAM ? 'tam' : 'is', koleksiyon: m.collections, sohbet: m.convs, dosya: m.blobs, bitti: m.finishedAt })
        } catch {}
      }
    }
    this.emit('receipt', kayit)
    return kayit
  }

  // 286 TEAM_EXIT_STATUS (§10.4 "Makbuzun anlamı"): çıkarılan ve ayrılan üyeler ile makbuz durumu: geldi, bekleniyor,
  // gelmedi (30 gün). Makbuz kanıt değil, uygulamanın imzalı beyanıdır.
  exitStatus () {
    this._ekipMi()
    const L = this.L
    const mk = Object.values(this._makbuzlar())
    const simdi = this.now()
    const out = []
    for (const [id, m] of L.members) {
      if (m.active || m.rotatedTo || m.extra || m.removedSeq === undefined || m.removedSeq === null) continue // ek kimlik kişi değildir
      const e = L.events[m.removedSeq]
      if (!e || (e.type !== T.REMOVE_MEMBER && e.type !== T.LEAVE)) continue
      const eh = e.type === T.REMOVE_MEMBER ? hex(eventHash(e)) : '00'.repeat(32)
      const makbuz = mk.find((x) => x.memberId === id && x.eventHash === eh) || null
      const wipe = e.type === T.REMOVE_MEMBER ? decodeBody(T.REMOVE_MEMBER, e.body).wipe : false
      out.push({
        memberId: id, name: m.name, role: m.role, tur: e.type === T.LEAVE ? 'ayrildi' : 'cikarildi', cikis: e.ts, wipe,
        makbuz: makbuz ? { durum: 'geldi', ...makbuz } : { durum: simdi - e.ts > EC.MAKBUZ_MS ? 'gelmedi' : 'bekleniyor' }
      })
    }
    return out.sort((a, b) => b.cikis - a.cikis)
  }

  // Ayrılan cihaz: gelen EKIP_CIKIS (0xC8; tek giriş noktası). Olay kendi defter kopyasıyla doğrulanır (§10.4, RFC-0022 d); geçerliyse
  // iş kapsamı silinir (§10.2) ve makbuz (0xC9) döner. Sahip kendiliğinden silmez (§10.3 sahip istisnası).
  // sil({ kapsam }) → { collections, convs, blobs }: platformun silmesi (sohbetler, dosyalar); verilmezse kayıt
  // katmanının iş kapsamı ve dosya deposu. sonBaglanti: son başarılı bağlantı (kopya eskiyse 7 gün kuralı).
  receiveExit (fromHex, bytes, yol, { sil = null, sonBaglanti = null } = {}) {
    this._ekipMi()
    const me = this.d.me
    if (!me) fail('NO_IDENTITY')
    giris.gelenZarf({ myRole: 'uye', peerRole: this.L.sessionRole(hex(fromHex)), type: EC.Z.EKIP_CIKIS, bytes, L: this.L, gonderen: hex(fromHex), yol })
    const r = EC.cikisDenetle(this.L, b4a.from(bytes), hex(me.memberId), { simdi: this.now(), sonBaglanti: sonBaglanti ?? this.now() })
    if (r.bekle) return { durum: 'bekliyor' }
    if (!r.sil) return { durum: 'sahip' }
    const { yapilan, ...sayi } = this._sil(r.kapsam, sil)
    // Makbuz yapılan silmeyi söyler: tam kapsam isteyip yalnız iş kapsamını silen (platform kancası yok) TAM demez;
    // yönetim dar makbuzu kabul etmez (INVALID_RECEIPT), "gelmedi" görünür (inceleme 16 şüpheli)
    const makbuz = EC.makbuzYaz(this.L.familyId, me, { eventHash: eventHash(r.event), scope: yapilan, ...sayi, finishedAt: this.now() })
    return { durum: 'silindi', kapsam: yapilan === EC.KAPSAM.TAM ? 'tam' : 'is', istenen: r.kapsam === EC.KAPSAM.TAM ? 'tam' : 'is', ...sayi, makbuz: { type: EC.Z.EKIP_CIKIS_OK, bytes: makbuz } }
  }

  _sil (kapsam, sil) {
    if (this.kopru) this.kopru.close()
    if (typeof sil === 'function') {
      const s = sil({ kapsam: kapsam === EC.KAPSAM.TAM ? 'tam' : 'is' }) || {}
      return { yapilan: kapsam, collections: s.collections | 0, convs: s.convs | 0, blobs: s.blobs | 0 }
    }
    let collections = 0
    let blobs = 0
    // Bekleyen öneriler ve reddedilenler (RFC-0005 §10.2 madde 6; inceleme 16 K7). Defter kopyasını platform siler
    // ('job-scope' olayında defter: true)
    this.d.oneriler.items.clear()
    this.d.oneriler.rejected.clear()
    if (this.kayit) {
      collections = this.kayit.r.isKapsaminiSil()
      const depo = this.kayit.depo
      if (depo && depo.m instanceof Map) { blobs = depo.m.size; for (const k of [...depo.m.keys()]) depo.delete(k) }
      this.kayit.kasaDosyalari.clear()
      this.kayit.eklenen.clear()
    }
    this.emit('job-scope', { defter: true, collections, blobs })
    // Kancasız yol sohbetleri silemez: yalnız iş kapsamı
    return { yapilan: EC.KAPSAM.IS, collections, convs: 0, blobs }
  }

  // Kendi isteğiyle ayrılış (§10.3 LEAVE): LEAVE yazılır, iş kapsamı silinir, makbuz (eventHash 32 sıfır) yönetime
  // gider. Sahip için silme isteğe bağlıdır (varsayılan evet).
  leave ({ sil = null, isVerisiniSil = true } = {}) {
    this._ekipMi()
    const me = this.d.me
    if (!me) fail('NO_IDENTITY')
    const sahip = this.L.members.get(hex(me.memberId))?.role === 'sahip'
    // Önce LEAVE (son sahip vb. hatada hiçbir şey silinmez), sonra silme (inceleme 16). Makbuz LEAVE'de sıfır özetli.
    // Silme yapılmadıysa (sahip "silme" dedi) makbuz yoktur (K5)
    const r = this.d.leave()
    if (this.kopru) this.kopru.close()
    if (sahip && !isVerisiniSil) return { ...r, collections: 0, convs: 0, blobs: 0, makbuz: null }
    const { yapilan, ...sayi } = this._sil(EC.KAPSAM.IS, sil)
    const makbuz = EC.makbuzYaz(this.L.familyId, me, { scope: yapilan, ...sayi, finishedAt: this.now() })
    return { ...r, ...sayi, makbuz: { type: EC.Z.EKIP_CIKIS_OK, bytes: makbuz } }
  }

  // 287 TEAM_PLACES: yerler ve her yerin kişileri, kutusu, cihaz sayısı, aydınlatması. ekle: { ad, tur } yeni yer ve
  // varsayılan koleksiyonları (Yer:<ad>, Olaylar:<ad>); kaldir: placeId (PLACE remove; atamalardan okumada düşer).
  places ({ ekle = null, kaldir = null } = {}) {
    this._ekipMi()
    let sonuc = null
    if (ekle) {
      if (typeof ekle.ad !== 'string' || !ekle.ad.trim()) fail('NAME_REQUIRED')
      const tur = ekle.tur || 'sube'
      if (!YER_TURLERI.includes(tur)) fail('INVALID_BODY')
      const p = ekle.placeId ? unhex(ekle.placeId) : rastgele16()
      // Etkin yer yeniden eklenmez (inceleme 16 K8: yeniden adlandırır ve ikinci koleksiyonları açardı)
      if (this.L.places.get(hex(p))?.active) fail('PLACE_ALREADY_EXISTS')
      const r = this.d._yaz(T.PLACE, { placeId: p, name: ekle.ad.trim(), kind: tur, remove: false })
      const birakma = []
      const koleksiyonlar = r.durum === 'uygulandi' ? yerKoleksiyonlari(this.d, p, ekle.ad.trim(), birakma) : []
      // Bırakma anahtarının gizlisi bu telefonun replikasına (kayit verildiyse); verilmediyse çağırana
      if (this.kayit) for (const b of birakma.splice(0)) this.kayit.r.addDropSecret(b.collectionId, b.secret)
      sonuc = { ...r, placeId: hex(p), koleksiyonlar, birakma }
    } else if (kaldir) {
      const y = this.L.places.get(hex(kaldir))
      if (!y || !y.active) fail('NO_PLACE')
      sonuc = this.d._yaz(T.PLACE, { placeId: unhex(kaldir), name: y.name, kind: y.kind, remove: true })
    }
    return { yerler: this._yerListesi(), sonuc }
  }

  _yerListesi () {
    const L = this.L
    const out = []
    for (const [pid, y] of L.places) {
      if (!y.active) continue
      const kisiler = []
      let kutu = null
      for (const [id, m] of L.members) {
        if (!m.active || m.rotatedTo) continue
        const a = L.assignments.get(L.personIdOf(id) || id)
        if (!a || !a.placeIds.includes(pid)) continue
        if (m.role === 'kutu') kutu = id
        else if (!m.extra) kisiler.push({ memberId: id, name: m.name, role: m.role })
      }
      const cihazlar = [...L.devices.values()].filter((d) => d.active && d.placeId === pid).length
      const n = L.notices.get(pid)
      out.push({ placeId: pid, ad: y.name, tur: y.kind, kisiler, kutu, cihazlar, aydinlatma: !!n && !n.remove })
    }
    return out
  }
}

module.exports = { TeamApi, TEAM_COMMAND, MAX_TERM_MS }
