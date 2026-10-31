// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// seed.js — tanıtım ailesini gerçek çekirdekte kurar (D35): ekran turu gerçek çekirdek kipinde de dolu görünsün.
//
//   node worklet/scripts/seed.js <dizin> <senaryo> --anahtar <64 hex> --arsiv <64 hex>
//
// <dizin> telefonun worklet dizini olur (uygulama bu dizin ve aynı platform anahtarıyla açınca aile dolu görünür).
// --anahtar platform anahtarı, --arsiv Arşiv katmanının açık anahtarı; ikisi de yalnız parametredir, hiçbir dosyaya
// yazılmaz (dizindeki dosyalar platform anahtarıyla şifreli, kasa anahtarları Arşiv açık anahtarına mühürlü).
// Senaryolar (Yuva Defteri taklit çekirdeğinin adları):
//   ana       bu telefon Alex'in ana kimliği (Yuva Hat yok)
//   ek        bu telefon Alex'in ek kimliği; ana kimlik (Yuva Hat) başka uygulamada
//   cocuk     bu telefon Lina'nın ek kimliği
//   yetiskin  bu telefon Rosa'nın ana kimliği
//   yok       ailesiz yeni kurulum (yalnız kimlik)
// Ailenin öbür kimlikleri bu süreçte bellekte üretilir, olayları imzalar ve kayıtlarını yazar; işlemleri telefona
// eşitlenir, gizli anahtarları süreçle birlikte gider. Kayıt saatleri örnek verideki tarihlerdir.
'use strict'
/* global Bare */
const fs = require('#fs')
const b4a = require('b4a')
const sodium = require('sodium-native')
const { ledger: { Ledger, T, createEvent, signEvent }, identity: { createIdentity }, zarf: { Z } } = require('@havenfold/core')
const { Replika, hlc: { Hlc } } = require('@havenfold/records')
const S = require('@havenfold/sdk')
const { Kalici } = require('../persistence')
const V = require('./seed-family')

const hex = (b) => (typeof b === 'string' ? b : b4a.toString(b, 'hex'))
function fail (code) { throw new Error(code) }
const SENARYOLAR = ['ana', 'ek', 'cocuk', 'yetiskin', 'yok']
const HEDEF = { ana: ['alex', 'ana'], ek: ['alex', 'ek'], cocuk: ['lina', 'ek'], yetiskin: ['rosa', 'ana'] }
const T0 = '2023-05-01 09:00' // ailenin kuruluşu: en eski kayıttan önce

// Türkiye saati (UTC+3, yaz saati yok) → ms
function ms (s) {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(s)
  if (!m) fail('INVALID_TIME')
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 3, +m[5])
}

// Yer tutucu dosya içerikleri: 1×1 GIF ve tek sayfalık PDF
const GIF = b4a.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')
function pdf (baslik) {
  const metin = `BT /F1 18 Tf 72 720 Td (${baslik.replace(/[()\\]/g, '')}) Tj ET`
  const nesneler = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${metin.length} >>\nstream\n${metin}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']
  let out = '%PDF-1.4\n'
  const yer = []
  nesneler.forEach((n, i) => { yer.push(out.length); out += `${i + 1} 0 obj\n${n}\nendobj\n` })
  const xref = out.length
  out += `xref\n0 ${nesneler.length + 1}\n0000000000 65535 f \n` + yer.map((y) => String(y).padStart(10, '0') + ' 00000 n \n').join('')
  out += `trailer\n<< /Size ${nesneler.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return b4a.from(out, 'latin1')
}

function rastgele (n) { const b = b4a.alloc(n); sodium.randombytes_buf(b); return b }

/**
 * @param {object} o
 * @param {string} o.dizin           boş (ya da olmayan) dizin
 * @param {string} o.senaryo         ana | ek | cocuk | yetiskin | yok
 * @param {Uint8Array} o.anahtar     32 B platform anahtarı
 * @param {string} o.archivePubHex   Arşiv açık anahtarı
 * Dönüş: özet { senaryo, me, kisi, koleksiyonlar: { ad: kayıt sayısı }, dosya, doz }
 */
async function tohumla ({ dizin, senaryo, anahtar, archivePubHex }) {
  if (!SENARYOLAR.includes(senaryo)) fail('NO_SCENARIO')
  try { if (fs.readdirSync(dizin).some((f) => !String(f).startsWith('.'))) fail('DIR_NOT_EMPTY') } catch (err) { if (err.message === 'DIR_NOT_EMPTY') throw err }
  const saat = { t: ms(T0) }
  const now = () => saat.t
  const k = new Kalici({ dizin, anahtar, archivePubHex, now, appId: 'yuva-defteri' })
  try {
    if (senaryo === 'yok') { k.kaydet(); return { senaryo, me: hex(k.kimlik.memberId), kisi: 0, koleksiyonlar: {}, dosya: 0, doz: 0 } }
    return await kur(k, senaryo, saat, now)
  } finally {
    k.kapat()
  }
}

async function kur (k, senaryo, saat, now) {
  const [hedefKisi, hedefTur] = HEDEF[senaryo]
  // --- Kimlikler: hedef kişinin ana kimliği bu telefonsa Kalici'nin kimliği, değilse bellekte
  const ana = {}
  for (const x of V.KISILER) ana[x.ad] = hedefTur === 'ana' && x.ad === hedefKisi ? k.kimlik : createIdentity({ platform: 'bare', createdAt: now() })
  const personOf = (ad) => V.KISILER.find((x) => x.ad === ad)

  // --- Defter: aile ve varsayılan koleksiyonlar, üyeler, ek kimlik, kişisel koleksiyonlar
  const { ledger: L } = S.LedgerApi.createFamily({ Ledger, me: ana.alex, familyName: 'Rivera', displayName: 'Alex', ts: now() })
  L.now = now
  const oylar = () => [...L.members.values()].filter((m) => m.active && ['ebeveyn', 'yetiskin'].includes(m.role) && !m.extra).map((m) => Object.values(ana).find((x) => hex(x.memberId) === hex(m.id))).filter(Boolean)
  for (const ad of ['maya', 'rosa', 'lina']) {
    saat.t += 60_000
    const x = personOf(ad)
    const e = createEvent(L, T.ADD_MEMBER, { deviceCert: ana[ad].deviceCert, displayName: x.gorunen, role: x.rol, inviterId: ana.alex.memberId, ceremonyTranscriptHash: rastgele(32), remote: false, activatesAt: 0 }, now())
    for (const imzaci of [...new Set([ana.alex, ana[ad], ...oylar()])]) signEvent(e, imzaci)
    L.apply(e)
  }
  if (hedefTur === 'ek') {
    saat.t += 60_000
    const ailesiz = S.LedgerApi.withoutFamily({ Ledger, me: k.kimlik, appId: 'yuva-defteri', now })
    const anaDefter = new S.LedgerApi({ ledger: L, me: ana[hedefKisi], now })
    const { event } = ailesiz.pairAccept(anaDefter.pairApprove(ailesiz.pairRequest('yuva-defteri'), { approved: true }))
    L.apply(event)
  }
  for (const ad of ['maya', 'rosa', 'lina']) {
    saat.t += 60_000
    const d = new S.LedgerApi({ ledger: L, me: ana[ad], now })
    uygula(d, d.openCollection({ name: 'Kişisel', kind: 'kisisel', readers: ['uye:' + hex(ana[ad].memberId)], writers: ['uye:' + hex(ana[ad].memberId)], sensitivity: 'normal', taskAccess: false, history: true }), [])
  }

  // --- Üyelerin çekirdekleri: bu telefon Kalici'de, öbürleri bellekte
  const n = k.aileBagla(L)
  const uyeler = []
  const bellekte = (kimlik) => {
    const replika = new Replika({ ledger: L, me: kimlik, now, hlc: new Hlc() })
    const kayit = new S.RecordApi({ replika, depo: new S.MemoryBlobStore() })
    return { kimlik, replika, kayit, defter: new S.LedgerApi({ ledger: L, me: kimlik, now }) }
  }
  const yazar = {}
  for (const x of V.KISILER) {
    const u = hex(ana[x.ad].memberId) === hex(k.kimlik.memberId) ? { kimlik: k.kimlik, replika: n.replika, kayit: n.kayit, defter: n.defter, kasa: n.kasa, telefon: true } : bellekte(ana[x.ad])
    uyeler.push(u)
    yazar[x.ad] = u
  }
  if (hedefTur === 'ek') uyeler.push({ kimlik: k.kimlik, replika: n.replika, kayit: n.kayit, defter: n.defter, kasa: n.kasa, telefon: true })
  const telefon = uyeler.find((u) => u.telefon)
  const esitle = () => esitleHepsi(uyeler)
  esitle()

  // --- Kasa (05 §2.2): Kasa koleksiyonu iki ebeveynin imzasıyla, KRA (Alex, Maya ve bir kâğıt), kâğıt basıldı
  const alexKasa = yazar.alex.kasa || new S.VaultApi({ ledger: L, me: ana.alex, now, defter: yazar.alex.defter })
  const oneri = alexKasa.defter.openCollection({ name: 'Kasa', kind: 'genel', readers: ['rol:ebeveyn'], writers: ['rol:ebeveyn'], sensitivity: 'kasa', taskAccess: false, history: true })
  uygula(alexKasa.defter, oneri, [ana.maya])
  esitle()
  const kasaCid = [...L.collections.values()].find((c) => c.name === 'Kasa' && c.sensitivity === 'kasa').id
  // Kalkan (04 §6.1): güvenlik kelimesi koleksiyonu (çocuklar da okur); Rosa'nın Kalkan'ı Alex ve Maya koruyucu
  const kalkanlar = new Map()
  const kalkan = (ad) => { if (!kalkanlar.has(ad)) kalkanlar.set(ad, new S.ShieldApi({ kayit: yazar[ad].kayit, defter: yazar[ad].defter, now })); return kalkanlar.get(ad) }
  uygula(yazar.alex.defter, kalkan('alex').wordCollection({ cocuklarOkur: true }), [ana.maya])
  esitle()
  // Sağlık: Rosa (01 §2.2): kişisel, okuyucular Rosa, Alex ve Maya
  const bakimH = new S.CareDeskApi({ kayit: yazar.rosa.kayit, olay: new S.EventApi({ kayit: yazar.rosa.kayit, now }), defter: yazar.rosa.defter, now })
  bakimH.setupHealthCollection([hex(ana.alex.memberId), hex(ana.maya.memberId)], false, false)
  esitle()
  const saglikCid = [...L.collections.values()].find((c) => c.name.startsWith('Sağlık:') && L.canonical(c.owner) === hex(ana.rosa.memberId)).id

  // --- Koleksiyonlar ve kayıtlar
  const kol = {
    tumAile: koleksiyon(L, 'Tüm Aile'),
    ebeveynler: koleksiyon(L, 'Ebeveynler'),
    kasa: kasaCid,
    saglik: saglikCid,
    kalkan: [...L.collections.values()].find((c) => c.name === 'Kalkan' && c.sensitivity === 'kasa').id
  }
  for (const x of V.KISILER) kol['kisisel:' + x.ad] = [...L.collections.values()].find((c) => c.kind === 'kisisel' && c.name === 'Kişisel' && L.canonical(c.owner) === hex(ana[x.ad].memberId)).id
  const idler = new Map()
  const dosyalar = new Map()
  const coz = (v) => {
    if (Array.isArray(v)) return v.map(coz)
    if (typeof v !== 'string' || !v.startsWith('@')) return v
    const [tur, deger] = [v.slice(1, v.indexOf(':')), v.slice(v.indexOf(':') + 1)]
    if (tur === 'kisi') return 'uye:' + hex(ana[deger].memberId)
    if (tur === 'zaman') return ms(deger)
    if (tur === 'kayit') {
      const [c, r] = [deger.slice(0, deger.lastIndexOf('/')), deger.slice(deger.lastIndexOf('/') + 1)]
      if (!idler.has(c + '/' + r)) fail('SEED_REFERENCE_FAILED')
      return 'kayit:' + kol[c] + '/' + idler.get(c + '/' + r)
    }
    if (tur === 'dosya') {
      if (!dosyalar.has(deger)) {
        const d = V.DOSYALAR[deger]
        const bytes = d.mime === 'application/pdf' ? pdf(d.name) : GIF
        dosyalar.set(deger, telefon.kayit.attach({ bytes, mime: d.mime, name: d.name }).blobRef)
      }
      return dosyalar.get(deger)
    }
    fail('SEED_REFERENCE_FAILED')
  }
  const alanlar = (f) => Object.fromEntries(Object.entries(f).map(([a, v]) => [a, coz(v)]))
  // Bu telefonun kendi kasa yazımı: kasa kilitli (Arşiv gizli anahtarı burada yok); replikaya alan denetimiyle
  const yaz = (u, cid, rid, tur, f) => {
    if (u.telefon && cid === kasaCid) { S.validateFields(f, { col: L.collections.get(cid) }); return u.replika.put(cid, rid, tur, f) }
    return u.kayit.put(cid, rid, tur, f)
  }

  const isler = []
  for (const [c, ad, tur, f, kim, zaman, sonra = []] of [...V.KAYITLAR, ...V.KASA_KAYITLARI, ...V.SAGLIK_KAYITLARI]) {
    isler.push([zaman, () => idler.set(c + '/' + ad, yaz(yazar[kim], kol[c], null, tur, alanlar(f)))])
    for (const [kim2, zaman2, f2] of sonra) isler.push([zaman2, () => yaz(yazar[kim2], kol[c], idler.get(c + '/' + ad), '', alanlar(f2))])
  }
  let doz = 0
  for (const [ilac, planlanan, isaret] of V.DOZLAR) isler.push([isaret, () => { bakimH.markDose(saglikCid, idler.get('saglik/' + ilac), ms(planlanan), 'alindi'); doz++ }])
  const K = V.KALKAN
  isler.push([K.kelime.zaman, () => yaz(yazar[K.kelime.yazan], kol.kalkan, null, 'yuva.defter.guvenlik_kelimesi', { sema: 1, kelime: K.kelime.kelime, degisim: ms(K.kelime.zaman), belirleyen: 'uye:' + hex(ana[K.kelime.yazan].memberId) })])
  isler.push([K.acilis, () => { kalkan(K.korunan).enable(K.koruyucular.map((x) => hex(ana[x].memberId))); esitle() }])
  for (const [kim, zaman] of K.kabuller) isler.push([zaman, () => kalkan(kim).answerInvite(hex(ana[K.korunan].memberId), true)])
  isler.push([K.bildirim.zaman, () => {
    const cid = [...L.collections.values()].find((c) => c.kind === 'kisisel' && c.name.startsWith('Kalkan:') && L.canonical(c.owner) === hex(ana[K.korunan].memberId)).id
    yaz(yazar[K.korunan], cid, null, 'yuva.defter.kalkan_bildirimi', { sema: 1, tur: K.bildirim.tur, anlatim: K.bildirim.anlatim, isaretler: K.bildirim.isaretler, sonuc: 'acik', zaman: ms(K.bildirim.zaman), _t: ms(K.bildirim.zaman), _keep: 365 })
  }])
  isler.sort((a, b) => ms(a[0]) - ms(b[0]))
  for (const [zaman, is] of isler) {
    saat.t = Math.max(saat.t + 1, ms(zaman))
    is()
    esitle()
  }

  // KRA: kurulum ve kâğıt basıldı (2 Mart 2026)
  saat.t = Math.max(saat.t + 1, Date.now() - 60_000)
  await alexKasa.setupRecoveryKey(kasaCid, null, { kagit: 1 })
  alexKasa.paperPrinted('kra:' + kasaCid, 1)
  esitle()
  // Sayım yazımdan önce: yazımda bu telefonun kasa anahtarları arsive mühürlenip bellekten çıkar
  const say = {}
  for (const c of telefon.kayit.collections()) {
    if (!c.okur) continue
    const sahip = c.owner ? V.KISILER.find((x) => L.canonical(hex(ana[x.ad].memberId)) === L.canonical(c.owner)) : null
    say[c.name + (c.name === 'Kişisel' && sahip ? ' · ' + sahip.gorunen : '')] = telefon.replika.records(c.collectionId).length
  }
  saat.t = Math.max(saat.t + 1, Date.now() - 30_000)
  k.kaydet()
  return { senaryo, me: hex(k.kimlik.memberId), kisi: L.personIds().length, koleksiyonlar: say, dosya: dosyalar.size, doz }
}

const koleksiyon = (L, ad) => [...L.collections.values()].find((c) => c.name === ad && c.kind === 'genel').id

// Öneri olduysa öbür imzacılarla tamamlanır
function uygula (defter, r, digerleri) {
  if (r.durum === 'uygulandi') { defter.changed(); return }
  for (const x of digerleri) if (defter.oneriler.items.has(r.oneriId)) defter.oneriler.sign(r.oneriId, x)
  const s = defter.oneriler.tryApply(r.oneriId)
  if (s !== 'applied') fail('SEED_PROPOSAL_FAILED')
  defter.changed()
}

// Replikaların çıkış kutuları birbirine (bellek içi taşıyıcı), sessizleşene kadar
function esitleHepsi (uyeler) {
  for (const u of uyeler) u.kayit.sync()
  for (let tur = 0; tur < 1000; tur++) {
    let n = 0
    for (const u of uyeler) {
      const msgs = u.replika.outbox.splice(0)
      n += msgs.length
      for (const m of msgs) {
        for (const o of uyeler) {
          if (o === u || o.replika === u.replika || (Array.isArray(m.to) && !m.to.includes(o.replika.meHex))) continue
          if (m.type === Z.REC_OPS) o.replika.receiveOp(m.bytes, m.kind || 0)
          else if (m.type === Z.REC_KEY) o.replika.receiveKey(m.bytes)
          else if (m.type === Z.REC_CUTOFF) o.replika.receiveCutoff(m.bytes)
        }
      }
    }
    if (!n) return
  }
  fail('SEED_SYNC_FAILED')
}

module.exports = { tohumla, SENARYOLAR, ms }

// Komut satırı
const argv = typeof Bare !== 'undefined' ? Bare.argv : (typeof process !== 'undefined' ? process.argv : [])
if (argv[1] && /seed\.js$/.test(argv[1]) && require.main === module) {
  const arg = argv.slice(2)
  const bayrak = (ad) => { const i = arg.indexOf(ad); return i >= 0 ? arg[i + 1] : null }
  const [dizin, senaryo] = arg.filter((x, i) => !x.startsWith('--') && !(i > 0 && arg[i - 1].startsWith('--')))
  const anahtarHex = bayrak('--anahtar')
  const arsiv = bayrak('--arsiv')
  if (!dizin || !senaryo || !/^[0-9a-f]{64}$/.test(anahtarHex || '') || !/^[0-9a-f]{64}$/.test(arsiv || '')) {
    console.error('Kullanım: seed.js <dizin> <' + SENARYOLAR.join('|') + '> --anahtar <64 hex> --arsiv <64 hex>')
    if (typeof process !== 'undefined' && process.exit) process.exit(2)
  } else {
    fs.mkdirSync(dizin, { recursive: true })
    Promise.resolve(tohumla({ dizin, senaryo, anahtar: b4a.from(anahtarHex, 'hex'), archivePubHex: arsiv }))
      .then((ozet) => console.log(JSON.stringify(ozet, null, 1)))
      .catch((err) => { console.error('HATA: ' + err.message); if (typeof process !== 'undefined' && process.exit) process.exit(1) })
  }
}
