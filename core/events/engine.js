// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// engine.js — telefon motoru: bir koleksiyonun olaylarından rutin, kural, vaka, merdiven ve kart (RFC-0006 §12)
//
// Saf bir işlevdir: aynı defter ve aynı kayıtlarla her telefon aynı vakalara, aynı basamaklara ve aynı sorumlulara
// varır. Saat yalnız hangi pencerenin değerlendirileceğine ve bir sonraki basamağın ne zaman yazılacağına karar verir.
// Kayıtları yazmak (put) ve uyandırma zarfı göndermek çağıranın işidir.
const b4a = require('b4a')
const { olaylar: olaylarOf, ilkOnce } = require('./event')
const R = require('./routine')
const Kr = require('./rule')
const V = require('./case')
const M = require('./escalation')
const { kartlar } = require('./card')
const S = require('./sos')

const hex = (b) => (typeof b === 'string' ? b : b4a.toString(b, 'hex'))

// uye: öznelerini kişiye çözerek karşılaştırır (rotatedTo zinciri, RFC-0003 §5.13)
function ozneNormal (L, subj) {
  if (typeof subj !== 'string' || !subj.startsWith('uye:')) return subj
  const id = L.resolveMember(subj.slice(4))
  return id ? 'uye:' + id : subj
}

// ctx: { ledger, collectionId, katalog, kayitlar, me? }. Gözlem kesintisi yalnız bu koleksiyondaki hf.device.offline/
// online olaylarından (Ebeveynler'deki olayların içeriksiz kopyaları, RFC-0019 §11.5 e) hesaplanır.
function degerlendir (ctx, simdi) {
  const L = ctx.ledger
  const cid = hex(ctx.collectionId)
  const cidBuf = b4a.from(cid, 'hex')
  const col = L.collections.get(cid)
  if (!col) throw new Error('NO_COLLECTION')
  const c = { ...ctx, col }
  const ol = olaylarOf(c)
  const sayilir = ol.sayilir.map((e) => ({ ...e, subj: ozneNormal(L, e.subj) }))
  const araliklar = R.kesintiAraliklari(sayilir)
  // Kaldırılmış cihaz gözlem kaynağı sayılmaz (inceleme olay 7)
  const kaynakAktif = (id) => L.devices.get(id)?.active !== false
  const opts = { araliklar, kaynakAktif }
  // Tanım kayıtlarını (rutin, kural, kart, not) yalnız üye yazar (RFC-0019 §11.5 a)
  const uyeKayitlari = ctx.kayitlar.filter((k) => k.yazar === 'uye')
  const kart = kartlar(uyeKayitlari, (subj) => ozneNormal(L, subj))
  const okuyucular = M.okuyucuKisiler(L, col)
  const sorumluOf = (subj) => M.sorumluListesi(L, col, kart.get(ozneNormal(L, subj))?.kart.sorumlu || null)

  // Tanımlar
  const rutinler = R.asilRutinler(uyeKayitlari.filter((k) => k.type === 'hf.rutin').map(R.rutinTanimi).filter(Boolean)
    .map((r) => ({ ...r, subj: ozneNormal(L, r.subj) })), ilkOnce)
  const rutinById = new Map(rutinler.map((x) => [x.asil.id, x.asil]))
  const kurallar = uyeKayitlari.filter((k) => k.type === 'hf.kural').map(Kr.kuralTanimi).filter(Boolean)
    .map((k) => (k.subj === '*' ? k : { ...k, subj: ozneNormal(L, k.subj) }))
  const kuralById = new Map(kurallar.map((k) => [k.id, k]))

  // Vakanın önemi kaynaktan (RFC-0019 §11.5 b). Cihaz yalnız kural vakası açar (görev parametresindeki kurallar).
  const kaynakOf = (kaynak, subj, acanCihaz, acanId) => {
    if (typeof kaynak !== 'string') return null
    if (kaynak.startsWith('kural:')) {
      const k = kuralById.get(kaynak.slice(6))
      if (!k || k.eylem !== 'vaka') return null
      if (acanCihaz && !k.cihazlar.includes(acanId)) return null // yalnız kuralı görevle çalıştıran cihaz
      return { onem: k.onem, hizmet: k.hizmet }
    }
    if (acanCihaz) return null
    if (kaynak.startsWith('rutin:')) {
      const r = rutinById.get(kaynak.slice(6))
      return r ? { onem: r.onem, hizmet: false } : null
    }
    if (kaynak.startsWith('cekirdek:')) {
      const tur = kaynak.slice(9)
      const def = ctx.katalog.get(tur)
      return def && def.olay && tur.startsWith('hf.') ? { onem: Kr.cekirdekOnemi(def, L, subj), hizmet: tur === 'hf.sos' } : null
    }
    return null
  }

  // Var olan vakalar
  const durumlar = V.vakaDurumlari(ctx.kayitlar, cidBuf, { sorumluOf, kaynakOf })
  // Biçim 2 kuralının vakası çözülebilir (RFC-0032 §6): kapatan olay ya da koşulun bozulması; hesaplanan durumdur.
  // Çözülme, vakayı açan hesapla aynı olay kümesine bakar: sayılır olaylar (§6.1 açıklama 1, inceleme 20 B5). Vakanın
  // öznesi de normalleştirilir: telefon değişince eski kimlikle açılmış vaka yeni kimliğin olayıyla çözülür (B7).
  const kayitById = new Map(ctx.kayitlar.map((k) => [k.recordId, k]))
  for (const d of durumlar.values()) {
    const k = d.kaynak.startsWith('kural:') ? kuralById.get(d.kaynak.slice(6)) : null
    if (!k || k.bicim !== 2) continue
    const dSubj = ozneNormal(L, d.subj)
    const c = Kr.cozulme(k, { ...d, subj: dSubj }, sayilir, opts)
    d.cozuldu = !!c
    d.cozen = c ? { neden: c.neden, recordId: c.olay ? c.olay.recordId : null, type: c.olay ? c.olay.type : null, yazar: c.olay ? c.olay.yazar : null, authorHex: c.olay ? c.olay.authorHex : null, t: c.olay ? c.olay.t : null } : null
    if (c) continue
    // Düzeltmeyle geri alınan kapatan olay: merdiven ulaşılan basamaktan, düzeltme anından yeniden başlar. Düzeltme E + 24
    // saatten sonra yapıldıysa başlamaz (§6.2; düzeltmenin anına göre, inceleme 20 B6). Vaka açılmadan önce yapılan
    // düzeltme merdiveni etkilemez: vaka zaten o olay sayılmadan açılmıştır.
    let geri = null
    for (const g of ol.gecersiz) {
      if (g.neden !== 'DUZELTILDI') continue
      const x = kayitById.get(g.recordId)
      if (!x || !k.kapatan.includes(x.type) || ozneNormal(L, x.tf._subj) !== dSubj || !(x.tf._t >= d.pencere[1])) continue
      for (const z of ctx.kayitlar) {
        if (z.type === 'hf.olay.duzelt' && z.yazar === 'uye' && z.fields.hedef === g.recordId && Number.isSafeInteger(z.tf._t) && z.tf._t >= d.t) geri = Math.max(geri ?? -Infinity, z.tf._t)
      }
    }
    if (geri !== null) {
      d.yenidenBasla = geri
      if (geri > d.pencere[1] + R.GEC_MS) d.merdivenDurdu = true
    }
  }
  const gercek = new Set([...durumlar.values()].filter((d) => d.kapali && d.sonuc === 'gercek').map((d) => d.vaka))

  // Adaylar
  const adaylar = []
  for (const { asil: r } of rutinler) {
    const kendi = sayilir.filter((e) => e.type === r.olay && e.subj === r.subj)
    const kaynakId = b4a.from(r.id, 'hex')
    const gercekGun = (g, pi) => {
      const [bas] = R.pencereAraligi(g, r.pencereler[pi], r)
      return [1, 2].some((yon) => gercek.has(hex(V.vakaAnahtari(cidBuf, kaynakId, r.subj, bas, yon))))
    }
    for (const s of R.sapmalar(r, kendi, simdi, { ...opts, gercek: gercekGun })) {
      adaylar.push({ kaynak: 'rutin:' + r.id, olay: r.olay, subj: r.subj, yon: s.yon, onem: r.onem, hizmet: false, pencereBasi: s.pencereBasi, pencereSonu: s.pencereSonu, deger: s.deger, alt: s.alt, ust: s.ust, olaylar: s.olaylar })
    }
  }
  for (const k of kurallar) {
    if (k.eylem !== 'vaka') continue
    for (const t of Kr.tetikler(k, sayilir, simdi, opts)) {
      // Daha açılmadan çözülmüş biçim 2 vakası (kapatan olay pencere bittikten sonra geldi) açılmaz
      if (k.bicim === 2 && Kr.cozulme(k, { subj: t.subj, pencere: [t.pencereBasi, t.pencereSonu] }, sayilir, opts)) continue
      // Aynı kural, özne ve yerel gün için ikinci vaka yok: utc_dk değişince (yaz saati) pencere kaysa da (inceleme 20 B8)
      if (k.bicim === 2) {
        const g = Kr.pencereGunu(k, t.pencereBasi)
        const ayni = (kaynak, subj, S) => kaynak === 'kural:' + k.id && ozneNormal(L, subj) === t.subj && Kr.pencereGunu(k, S) === g
        if ([...durumlar.values()].some((d) => ayni(d.kaynak, d.subj, d.pencere[0])) || adaylar.some((a) => ayni(a.kaynak, a.subj, a.pencereBasi))) continue
      }
      adaylar.push({ kaynak: 'kural:' + k.id, subj: t.subj, yon: 0, onem: k.onem, hizmet: k.hizmet, pencereBasi: t.pencereBasi, pencereSonu: t.pencereSonu, deger: t.deger, olaylar: t.katki.slice(0, 16).map((e) => e.recordId) })
    }
  }
  for (const t of Kr.cekirdekTetikler(ctx.katalog, L, sayilir)) {
    adaylar.push({ kaynak: 'cekirdek:' + t.tur, subj: t.subj, yon: 0, onem: t.onem, hizmet: t.tur === 'hf.sos', pencereBasi: t.pencereBasi, pencereSonu: t.pencereSonu, deger: t.katki.length, olaylar: t.katki.slice(0, 16).map((e) => e.recordId) })
  }

  // Bastırma (§9.3): rutin vakası, aynı özne ve olay türünde örtüşen kural vakası (var olan ya da aday) ya da
  // susturma varsa. Bastırılacak aday açılmaz (inceleme olay 5); var olan vakada karar kayda yazılır (olay 6).
  const susturma = Kr.susturmaPencereleri(kurallar, sayilir, simdi, opts)
  const kuralVakalari = []
  for (const d of durumlar.values()) {
    if (!d.kaynak.startsWith('kural:')) continue
    const k = kuralById.get(d.kaynak.slice(6))
    if (k) kuralVakalari.push({ subj: d.subj, turler: Kr.turleri(k), pencere: d.pencere })
  }
  for (const a of adaylar) {
    if (!a.kaynak.startsWith('kural:')) continue
    kuralVakalari.push({ subj: a.subj, turler: Kr.turleri(kuralById.get(a.kaynak.slice(6))), pencere: [a.pencereBasi, a.pencereSonu] })
  }
  const bastirilir = (subj, olay, pencere) => Kr.rutinBastirildi({ subj, olay, pencere }, kuralVakalari, susturma)
  const bastirmalar = []
  for (const d of durumlar.values()) {
    if (!d.kaynak.startsWith('rutin:') || d.bastirmaKayitli) continue
    const r = rutinById.get(d.kaynak.slice(6))
    if (r && bastirilir(d.subj, r.olay, d.pencere)) {
      d.bastirilmis = true
      bastirmalar.push({ vaka: d.vaka, recordId: d.acilis.recordId, alanlar: { bastirildi: true } })
    }
  }

  // Yeni vakalar: yalnız koleksiyonun yazarı olan telefona önerilir; ilk basamak da yazma sırasındaki yere göre
  // r × 2 dakika gecikir (§11.4, inceleme olay 17). me verilmezse sıra 0.
  const yeni = []
  for (const a of adaylar) {
    if (a.olay && bastirilir(a.subj, a.olay, [a.pencereBasi, a.pencereSonu])) continue
    const { ilk, son } = V.basamaklar(a.onem, a.hizmet)
    const alanlar = V.vakaAlanlari({ ...a, collectionId: cidBuf, ilk, son, t: simdi, ozet: a.kaynak.startsWith('cekirdek:') ? a.kaynak.slice(9) + '.ozet' : '' })
    const v = hex(alanlar.vaka)
    if (durumlar.has(v) || yeni.some((y) => hex(y.alanlar.vaka) === v)) continue
    let r = 0
    if (ctx.me) {
      r = M.yazmaSirasi(L, col, { sorumlu: sorumluOf(a.subj), acanCihaz: false }, ctx.me)
      if (r === null) continue
    }
    const basamaklar = [[ilk, 0]]
    if (a.onem === 3) basamaklar.push([3, 0]) // acilde 2. ve 3. basamak birlikte
    yeni.push({ alanlar, basamaklar, zaman: simdi + r * 2 * M.MIN })
  }

  // Vaka ayrıntıları ve bu telefonun yazımları
  const vakalar = []
  const yazimlar = []
  for (const d of durumlar.values()) {
    const k = d.kaynak.startsWith('kural:') ? kuralById.get(d.kaynak.slice(6)) : null
    const sos = d.kaynak === 'cekirdek:hf.sos'
    const kd = kart.get(d.subj)?.kart
    const opts = { sureler: k?.sureler || null, sessiz: kd?.sessiz || null, utcDk: kd?.utc_dk ?? 180, sessizDisi: sos || !!k?.sessiz_disi }
    // SOS vakasının afet bağı (RFC-0031 §6): Bildirimci aynı afet için ikinci bildirimi göstermez. Bağlar SOS'u yazanın
    // kaydı açan işleminden (tf) okunur, birleşmiş alanlardan değil: başka üye sonradan afet_mid(ler)/ortak_mid ekleyip
    // görülmüş bir mid'le gerçek SOS bildirimini bastıramaz (Codex 6. tur)
    const sosOlay = sos ? kayitById.get((d.acilis.fields.olaylar || [])[0]) : null
    const tf = sosOlay ? sosOlay.tf || {} : {}
    const afetMid = b4a.isBuffer(tf.afet_mid) && tf.afet_mid.byteLength === 16 ? hex(tf.afet_mid) : null
    const afetMidler = sosOlay ? S.afetMidlerOf(tf) : [] // D103: alıcı başına mid'ler
    const ortakMid = b4a.isBuffer(tf.ortak_mid) && tf.ortak_mid.byteLength === 16 ? hex(tf.ortak_mid) : null
    vakalar.push({ ...d, okuyucular, sos, afetMid, afetMidler, ortakMid, ...opts, sessizSimdi: M.sessizde(simdi, opts.sessiz, opts.utcDk) })
    if (ctx.me && !d.merdivenDurdu) {
      const r = M.yazmaSirasi(L, col, d, ctx.me)
      if (r === null) continue
      const x = M.sonrakiYazim(d, { ...opts, r })
      if (x) yazimlar.push({ vaka: d.vaka, ...x })
    }
  }
  vakalar.sort((a, b) => (a.vaka < b.vaka ? -1 : 1))

  return { olaylar: ol, kartlar: kart, rutinler, kurallar, vakalar, yeni, yazimlar, bastirmalar, okuyucular }
}

// Bildirimci için: telefonun gördüğü vakaların bildirim girdisi
const bildirimGirdisi = (vakalar) => vakalar.map((v) => ({ ...v, sessiz: v.sessizSimdi }))

module.exports = { degerlendir, bildirimGirdisi, ozneNormal }
