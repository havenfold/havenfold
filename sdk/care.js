// SPDX-License-Identifier: Apache-2.0
// care.js — Bakım Masası'nın çekirdek tarafı (Yuva Defteri 01 §4.11, 06 §3; RFC-0006 §9–§11; D24)
//
// Tıbbi tavsiye yok, doz hesabı yok: yalnız kayıt ve hatırlatma. Kaçırılan doz, var olan olay motoruyla modellenir:
// planlanan + 30 dakika geçip doz kaydı yoksa ilacın koleksiyonuna 'yuva.defter.doz-kacirildi' olayı yazılır; ilaç
// başına bir 'hf.kural' (özne kayit:<ilaç>, önem 2 dikkat) vakayı açar; merdiven RFC-0006 §11.2'deki gibi işler
// (2 → 3: 30 dk, 3 → 4: 60 dk). "Ben bakıyorum" vakayı sahiplenir ve sonraki basamaklar durur (§10.3 madde 4).
// Bütün yazımlar isle() ile, koleksiyonun yazarı olan telefondan; aynı defter ve kayıtlarla her telefon aynı vakaya varır.
const b4a = require('b4a')
const Ol = require('@havenfold/events')
const { yetki: { readerSet } } = require('@havenfold/records')
const { Emitter } = require('./api')

const hex = (b) => (typeof b === 'string' ? b : b4a.toString(b, 'hex'))
function fail (code) { throw new Error(code) }

const MIN = 60_000
const DAY = 86_400_000
const OFSET_MS = 180 * MIN // ilaç saatleri Türkiye saatiyle
const GECIKME_MS = 30 * MIN // planlanan + 30 dk (M05)
const PENCERE_MS = 48 * 3_600_000 // son 48 saat
// Yuva Defteri'nin Bakım Masası kendi ad alanını kullanır; yuva.bakim Yuva Bakım uygulamasınındır (RFC-0029 §6, D77)
const DOSE_TYPE = 'yuva.defter.doz-kacirildi'
const RULE_SOURCE = 'yuva.defter'
const DOZ_KEEP = 365

// Ürün olay türü (RFC-0006 §5.3: ürün türünü SDK başlangıçta kaydeder)
const CARE_TYPES = [
  { tur: DOSE_TYPE, v: 1, olay: true, yazar: 'uye', ozne: ['kayit'], alanlar: [{ ad: 'planlanan', deger: 'int' }, { ad: 'kisi', deger: 'string' }], kapsam: 'topluluk', keep: 365, ozel: false, onem: 2 }
]

const ilacRef = (cid, rid) => 'kayit:' + cid + '/' + rid
const scheduledOf = (gun, saat) => {
  const [y, a, g] = gun.split('-').map(Number)
  const [sa, dk] = saat.split(':').map(Number)
  return Date.UTC(y, a - 1, g, sa, dk) - OFSET_MS
}
const gunOf = (ms) => new Date(ms + OFSET_MS).toISOString().slice(0, 10)

class CareDeskApi extends Emitter {
  // kayit: RecordApi; olay: EventApi; defter: LedgerApi (sağlık koleksiyonu kurmak için)
  constructor ({ kayit, olay, defter = null, now = Date.now }) {
    super()
    this.kayit = kayit
    this.olay = olay
    this.defter = defter
    this.now = now
    for (const t of CARE_TYPES) if (!olay.katalog.get(t.tur)) olay.registerType(t)
    this._bilinen = new Set() // bildirilmiş vakalar
  }

  get _L () { return this.kayit._L }
  get _me () { return this._L.canonical(this.kayit.r.meHex) }

  // İlaç kaydı olan ve okuyabildiğim koleksiyonlar
  _koleksiyonlar () {
    return this.kayit.collections().filter((c) => c.okur && (c.sensitivity !== 'kasa' || !this.kayit.kasa || !this.kayit.kasa.locked()))
  }

  _ilaclar (cid) { return this.kayit.query(cid, { type: 'yuva.defter.ilac' }) }

  _dozlar (cid) { return this.kayit.query(cid, { type: 'yuva.defter.doz' }) }

  // Bakım Masası'nda görebildiğim kişiler: okuyabildiğim Sağlık:<üye> koleksiyonları ve öbür koleksiyonlardaki (ör.
  // Ebeveynler) ilaçların sahipleri (Yuva Defteri 01 §4.11; D32). gorenler: koleksiyonu okuyan kişiler
  status () {
    const L = this._L
    const kisiler = []
    let benim = null
    const okuyanlar = (c) => [...new Set([...readerSet(L, L.collections.get(c.collectionId)).keys()].map((id) => L.canonical(id)).filter(Boolean))].sort()
    const ekle = (personId, c) => {
      if (!personId || kisiler.some((x) => x.personId === personId && x.collectionId === c.collectionId)) return
      kisiler.push({ personId, ad: L.members.get(personId)?.name || '', collectionId: c.collectionId, koleksiyonAdi: c.name, gorenler: okuyanlar(c), kasaGibi: c.sensitivity === 'kasa' })
    }
    for (const c of this._koleksiyonlar()) {
      if (c.name.startsWith('Sağlık:') && c.kind === 'kisisel') {
        const sahip = L.canonical(c.owner)
        if (sahip === this._me) benim = c.collectionId
        ekle(sahip, c)
        continue
      }
      for (const k of this._ilaclar(c.collectionId)) if (typeof k.fields.kisi === 'string' && k.fields.kisi.startsWith('uye:')) ekle(L.canonical(k.fields.kisi.slice(4)), c)
    }
    return { kisiler, benimSaglikKoleksiyonum: benim, kacirilanSayisi: this.missed().filter((v) => !v.sahip).length }
  }

  // Günün doz kartları: aktif ilaçların saatleri; kisi verilirse yalnız onunkiler (gun: 'YYYY-MM-DD', TR saati)
  doses (gun, kisi = null) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(gun)) fail('INVALID_DAY')
    const out = []
    for (const c of this._koleksiyonlar()) {
      const dozlar = this._dozlar(c.collectionId)
      for (const k of this._ilaclar(c.collectionId)) {
        const f = k.fields
        if (f.aktif === false || (kisi && f.kisi !== 'uye:' + kisi)) continue
        if ((f.baslangic && gun < f.baslangic) || (f.bitis && gun > f.bitis)) continue
        for (const saat of Array.isArray(f.saatler) ? f.saatler : []) {
          if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(saat)) continue
          const planlanan = scheduledOf(gun, saat)
          const d = this._dozDurumu(dozlar, ilacRef(c.collectionId, k.recordId), planlanan, f.kisi)
          out.push({ collectionId: c.collectionId, ilacRecordId: k.recordId, kisi: f.kisi ? f.kisi.slice(4) : null, baslik: f.baslik || '', dozMetni: f.doz_metni || '', saat, planlanan, durum: d ? d.fields.durum : null, dozRecordId: d ? d.recordId : null })
        }
      }
    }
    return out.sort((a, b) => a.planlanan - b.planlanan || (a.baslik < b.baslik ? -1 : 1))
  }

  // Aynı doz için iki kayıt: isaretleyen ilaç sahibi olan, yoksa en eski (Yuva Defteri 01 §4.11)
  _dozDurumu (dozlar, ref, planlanan, sahip) {
    const ayni = dozlar.filter((d) => d.fields.ilac === ref && d.fields.planlanan === planlanan)
    if (!ayni.length) return null
    return ayni.find((d) => sahip && d.fields.isaretleyen === sahip) || ayni.sort((a, b) => a.olusturma - b.olusturma || (a.recordId < b.recordId ? -1 : 1))[0]
  }

  // "Aldım" / "Atladım": her doz ayrı kayıt, ilacın koleksiyonuna
  markDose (collectionId, ilacRecordId, planlanan, durum) {
    if (!['alindi', 'atlandi'].includes(durum)) fail('INVALID_STATUS')
    if (!Number.isSafeInteger(planlanan)) fail('INVALID_TIME')
    const cid = hex(collectionId)
    if (!this.kayit.get(cid, ilacRecordId)) fail('NO_RECORD')
    const rid = this.kayit.put(cid, null, 'yuva.defter.doz', { ilac: ilacRef(cid, hex(ilacRecordId)), planlanan, durum, isaretleyen: 'uye:' + this._me, zaman: this.now(), _keep: DOZ_KEEP })
    this.emit('care', { type: 'doz', collectionId: cid, recordId: rid, planlanan })
    return rid
  }

  // Motorun işi (zamanlayıcıyla ve değişiklikte çağrılır): kaçırılan doz olayları, ilaç kuralları, vakalar ve zamanı
  // gelen basamaklar. Yalnız yazar olduğum koleksiyonlarda yazar. Dönüş: yazılan kayıt sayısı
  process () {
    const simdi = this.now()
    let n = 0
    for (const c of this._koleksiyonlar()) {
      if (!c.writable) continue
      const cid = c.collectionId
      const ilaclar = this._ilaclar(cid)
      if (!ilaclar.length) continue
      const kurallar = this.kayit.query(cid, { type: 'hf.kural' }).filter((k) => k.fields.kaynak === RULE_SOURCE)
      const olaylar = this.olay.query(cid, { tur: DOSE_TYPE, from: simdi - PENCERE_MS - DAY })
      const dozlar = this._dozlar(cid)
      for (const k of ilaclar) {
        const subj = 'kayit:' + k.recordId
        if (k.fields.aktif !== false && !kurallar.some((x) => x.fields.ilac === k.recordId)) {
          this.olay.writeRule(cid, null, { _subj: subj, kosullar: [[DOSE_TYPE, 'sayi', '', 60, 'ge', 1]], eylem: 'vaka', onem: 2, aktif: true, kaynak: RULE_SOURCE, ilac: k.recordId })
          n++
        }
        for (const d of this._kacirilanPlan(k, dozlar, cid, simdi)) {
          if (olaylar.some((e) => e.subj === subj && e.fields?.planlanan === d)) continue
          this.olay.write(cid, DOSE_TYPE, { t: simdi, subj, planlanan: d, kisi: k.fields.kisi || '' })
          n++
        }
      }
      n += this._vakalariYaz(cid, simdi)
    }
    return n
  }

  // Son 48 saatte planlanan + 30 dk geçmiş, doz kaydı olmayan zamanlar
  _kacirilanPlan (k, dozlar, cid, simdi) {
    const f = k.fields
    if (f.aktif === false || !Array.isArray(f.saatler)) return []
    const out = []
    for (let g = simdi - PENCERE_MS - DAY; g <= simdi; g += DAY) {
      const gun = gunOf(g)
      if ((f.baslangic && gun < f.baslangic) || (f.bitis && gun > f.bitis)) continue
      for (const saat of f.saatler) {
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(saat)) continue
        const p = scheduledOf(gun, saat)
        if (p < simdi - PENCERE_MS || p + GECIKME_MS > simdi || p < k.olusturma) continue
        if (!this._dozDurumu(dozlar, ilacRef(cid, k.recordId), p, f.kisi)) out.push(p)
      }
    }
    return [...new Set(out)].sort((a, b) => a - b)
  }

  // Motorun önerdiği yeni vakaları ve zamanı gelen basamakları yazar
  _vakalariYaz (cid, simdi) {
    let n = 0
    const s = this.olay.evaluate(cid)
    for (const y of s.yeni) {
      if (y.zaman > simdi || !this._bizim(cid, y.alanlar.kaynak)) continue
      this.kayit.put(cid, null, 'hf.vaka', y.alanlar)
      for (const [b, sira] of y.basamaklar) this.kayit.put(cid, null, 'hf.vaka.basamak', Ol.vaka.basamakAlanlari(y.alanlar.vaka, b, sira, simdi))
      n += 1 + y.basamaklar.length
      this.emit('care', { type: 'kacirilan', vakaId: hex(y.alanlar.vaka) })
    }
    for (const x of s.yazimlar) {
      if (x.zaman > simdi) continue
      const v = s.vakalar.find((d) => d.vaka === x.vaka)
      if (!v || !this._bizim(cid, v.kaynak)) continue
      this.kayit.put(cid, null, 'hf.vaka.basamak', Ol.vaka.basamakAlanlari(b4a.from(x.vaka, 'hex'), x.basamak, x.sira, simdi))
      n++
    }
    return n
  }

  // Vaka bu modülün ilaç kuralından mı (başka kuralların vakalarını ürünün kendi motoru yazar)
  _bizim (cid, kaynak) {
    if (typeof kaynak !== 'string' || !kaynak.startsWith('kural:')) return false
    return this.kayit.get(cid, kaynak.slice(6))?.fields.kaynak === RULE_SOURCE
  }

  // Kaçırılan dozlar (M05): açık ya da sahipli vakalar, basamaklarıyla
  missed () {
    const L = this._L
    const out = []
    for (const c of this._koleksiyonlar()) {
      const cid = c.collectionId
      const kurallar = new Map(this.kayit.query(cid, { type: 'hf.kural' }).filter((k) => k.fields.kaynak === RULE_SOURCE).map((k) => [k.recordId, k.fields.ilac]))
      if (!kurallar.size) continue
      const olaylar = this.olay.query(cid, { tur: DOSE_TYPE })
      for (const v of this.olay.cases(cid)) {
        if (v.kapali || !v.kaynak.startsWith('kural:') || !kurallar.has(v.kaynak.slice(6))) continue
        const ilacId = kurallar.get(v.kaynak.slice(6))
        const ilac = this.kayit.get(cid, ilacId)
        const e = olaylar.filter((x) => x.subj === v.subj && x.t >= v.pencere[0] && x.t < v.pencere[1]).sort((a, b) => a.fields.planlanan - b.fields.planlanan)[0]
        const basamaklar = [2, 3, 4].filter((b) => b <= v.son).map((b) => {
          const an = Object.entries(v.basamakAni || {}).filter(([k]) => k.startsWith(b + ',')).map(([, t]) => t)
          const oldu = v.ulasilan && (v.ulasilan[0] > b || (v.ulasilan[0] === b))
          const kime = b === 2 ? v.okuyucular : b === 3 ? v.sorumlu.slice(0, 1) : v.sorumlu.slice(1, 2)
          return { basamak: b, zaman: an.length ? Math.min(...an) : null, kime, kitle: b === 2 ? 'okuyucular' : b === 3 ? 'sorumlu' : 'siradaki', durum: oldu ? 'oldu' : v.sahipli ? 'durdu' : 'sonra' }
        })
        out.push({
          vakaId: v.vaka, collectionId: cid, recordId: ilacId, kisi: ilac?.fields.kisi ? L.canonical(ilac.fields.kisi.slice(4)) : null, baslik: ilac?.fields.baslik || '',
          planlanan: e ? e.fields.planlanan : null, onem: 'dikkat', basamaklar, sahip: v.sahip ? L.canonical(v.sahip) : null, benYazabilirim: c.writable
        })
      }
    }
    return out.sort((a, b) => (a.planlanan || 0) - (b.planlanan || 0))
  }

  // "Ben bakıyorum": okuyucu olup yazar olmayan sahiplenemez (§11.4)
  imHandling (vakaId) {
    const v = this.missed().find((x) => x.vakaId === vakaId)
    if (!v) fail('NO_CASE')
    if (!v.benYazabilirim) fail('NOT_WRITER')
    return this.olay.claim(v.collectionId, vakaId)
  }

  // M08: Sağlık:<ad> (kisisel, yalnız sahibi imzalar; görev erişimi kapalı). Önce yalnız sahip okuyucuyla açılır, sonra
  // okuyucular eklenir. ozetiTasi: Kişisel'deki saglik_ozeti yeni koleksiyona taşınır. Dönüş: collectionId
  setupHealthCollection (okuyucular, kasaGibi, ozetiTasi) {
    if (!this.defter) fail('NO_LEDGER')
    const L = this._L
    const ben = this._me
    if (this.status().benimSaglikKoleksiyonum) fail('ALREADY_EXISTS')
    const kisiler = [...new Set((okuyucular || []).map((x) => L.canonical(hex(x))).filter((x) => x && x !== ben))]
    if (kisiler.some((x) => !L.members.get(x)?.active)) fail('INVALID_MEMBER')
    const ad = 'Sağlık:' + (L.members.get(ben)?.name || '')
    const r = this.defter.openCollection({ name: ad, kind: 'kisisel', readers: ['uye:' + ben], writers: ['uye:' + ben], sensitivity: kasaGibi ? 'kasa' : 'normal', taskAccess: false, history: true })
    const cid = [...L.collections.values()].find((c) => c.name === ad && L.canonical(c.owner) === ben).id
    if (kisiler.length) {
      const col = L.collections.get(cid)
      this.defter._yaz(require('@havenfold/core').ledger.T.COLLECTION, {
        collectionId: b4a.from(cid, 'hex'), name: col.name, kind: col.kind, readers: ['uye:' + ben, ...kisiler.map((x) => 'uye:' + x)], writers: ['uye:' + ben],
        sensitivity: col.sensitivity, taskAccess: false, history: col.history, dropKey: b4a.alloc(32)
      })
    }
    this.kayit.sync()
    if (ozetiTasi) {
      for (const c of this.kayit.collections()) {
        if (c.kind !== 'kisisel' || c.name !== 'Kişisel' || L.canonical(c.owner) !== ben) continue
        for (const k of this.kayit.query(c.collectionId, { type: 'yuva.defter.saglik_ozeti' })) this.kayit.move(c.collectionId, k.recordId, cid)
      }
    }
    this.emit('care', { type: 'degisti' })
    return r.durum === 'uygulandi' ? cid : fail('COLLECTION_OPEN_FAILED')
  }
}

// BakimApi: eski ad, bir sürüm takma ad olarak kalır (D77)
module.exports = { CareDeskApi, BakimApi: CareDeskApi, CARE_TYPES, DOSE_TYPE, RULE_SOURCE, scheduledOf: scheduledOf }
