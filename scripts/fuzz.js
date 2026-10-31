// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// fuzz.js — dışarıdan bayt alan çözücülerin bulanık testi (fuzz; D50)
//
// Çalıştırma (Node ve Bare):
//   node scripts/fuzz.js [--sayi 200000] [--tohum 1] [--hedef ad] [--kisa]
//   bare scripts/fuzz.js …
//   node scripts/fuzz.js --ornekler        test/fuzz/corpus/ altındaki kalıcı girdileri koşar
// Her hedef ayrı bir süreçte koşar (sonsuz döngü süre aşımıyla yakalanır). Girdi başına: beklenen sonuç ya kabul ya da
// kodlu hata (BUYUK_HARF_KODU); başka her hata (TypeError, RangeError, kodsuz mesaj) çökmedir. Tek girdi 100 ms'yi,
// bellek artışı 64 MiB'ı aşamaz. Bulunan girdi test/fuzz/corpus/<hedef>-<özet>.hex olarak yazılır; düzeltildikten
// sonra --ornekler onu her koşuda yeniden dener (check.sh).
// Mutasyonlar belirlenimci (tohum); tohum derlemi: hedefin geçerli örnekleri ve protocol/vectors/*.json'daki bütün
// onaltılık değerler. Ağ yok, dosyalar yalnız geçici dizinde.
/* global Bare */
'use strict'
const BARE = typeof Bare !== 'undefined'
const ARGV = (BARE ? Bare.argv : process.argv).slice(2)
const fs = require(BARE ? '../worklet/node_modules/bare-fs' : 'f' + 's')
const b4a = require('b4a')

const KOK = __dirname + '/..'
const ORNEK_DIZINI = KOK + '/test/fuzz/corpus'
const MAX_TERM_MS = 100
const BELLEK_SINIRI = 64 * 1024 * 1024
const deger = (ad, v) => { const i = ARGV.indexOf(ad); return i >= 0 ? ARGV[i + 1] : v }
const cik = (kod) => (BARE ? Bare.exit(kod) : process.exit(kod))
const rss = () => (BARE ? require('bare-os').memoryUsage() : process.memoryUsage()).heapUsed // anlık yığın (RSS geri düşmez)
const hex = (b) => b4a.toString(b, 'hex')
const kodluMu = (err) => err instanceof Error && /^[A-Z][A-Z0-9_]{2,63}$/.test(err.message) && !(err instanceof TypeError) && !(err instanceof RangeError)

// --- Belirlenimci rastgele (xorshift32) ---------------------------------------------------------------------------

function rastgele (tohum) {
  let x = (tohum >>> 0) || 0x9e3779b9
  const r = () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296 }
  return { r, n: (k) => Math.floor(r() * k), bayt: () => Math.floor(r() * 256) }
}

const UC = [0x00, 0x01, 0x7f, 0x80, 0xfc, 0xfd, 0xfe, 0xff]
function mutasyon (R, tohumlar) {
  const t = tohumlar[R.n(tohumlar.length)]
  let b = b4a.from(t)
  const adim = 1 + R.n(4)
  for (let i = 0; i < adim; i++) {
    const s = R.n(11)
    const yer = () => R.n(b.byteLength + 1)
    if (s === 0 && b.byteLength) { const k = R.n(b.byteLength); b[k] ^= 1 << R.n(8) } // bit çevir
    else if (s === 1 && b.byteLength) b[R.n(b.byteLength)] = UC[R.n(UC.length)] // uç değer
    else if (s === 2 && b.byteLength) b[R.n(b.byteLength)] = R.bayt()
    else if (s === 3) { const k = yer(); const ek = b4a.alloc(1 + R.n(16)); for (let j = 0; j < ek.length; j++) ek[j] = R.bayt(); b = b4a.concat([b.subarray(0, k), ek, b.subarray(k)]) } // ekle
    else if (s === 4 && b.byteLength) { const k = R.n(b.byteLength); b = b4a.concat([b.subarray(0, k), b.subarray(k + 1 + R.n(16))]) } // sil
    else if (s === 5) b = b.subarray(0, R.n(b.byteLength + 1)) // kes
    else if (s === 6 && b.byteLength) { const k = R.n(b.byteLength); const l = 1 + R.n(Math.min(64, b.byteLength - k)); b = b4a.concat([b.subarray(0, k + l), b.subarray(k, k + l), b.subarray(k + l)]) } // çoğalt
    else if (s === 7) { const k = yer(); b = b4a.concat([b.subarray(0, k), b4a.from([0xfe, 0xff, 0xff, 0xff, 0xff].slice(0, 1 + R.n(5))), b.subarray(k)]) } // büyük uzunluk öneki
    else if (s === 8) { const o = tohumlar[R.n(tohumlar.length)]; const k = yer(); b = b4a.concat([b.subarray(0, k), o.subarray(R.n(o.byteLength + 1))]) } // iki tohumu ek
    else if (s === 9) { const l = R.n(R.n(2) ? 64 : 2048); b = b4a.alloc(l); for (let j = 0; j < l; j++) b[j] = R.bayt() } // tümüyle rastgele
    else if (s === 10 && b.byteLength >= 4) { const k = R.n(b.byteLength - 3); new DataView(b.buffer, b.byteOffset, b.byteLength).setUint32(k, [0, 1, 0x7fffffff, 0xffffffff, R.n(1 << 20)][R.n(5)]) } // 32 bit alan
  }
  return b
}

// Vektör dosyalarındaki bütün onaltılık değerler (çift uzunluklu, 2–8192 karakter)
function vektorDerlemi () {
  const out = []
  const dizin = KOK + '/protocol/vectors'
  const gez = (x) => {
    if (typeof x === 'string') { if (x.length >= 2 && x.length <= 8192 && x.length % 2 === 0 && /^[0-9a-f]+$/.test(x)) out.push(b4a.from(x, 'hex')) } else if (Array.isArray(x)) x.forEach(gez)
    else if (x && typeof x === 'object') Object.values(x).forEach(gez)
  }
  for (const f of fs.readdirSync(dizin)) if (f.endsWith('.json')) gez(JSON.parse(b4a.toString(fs.readFileSync(dizin + '/' + f))))
  return out
}

// --- Hedefler -----------------------------------------------------------------------------------------------------
// Her hedef: { tohumlar: () => [bayt], dene: (bayt) => void | Promise } ; kurulum hedef seçilince yapılır

const HEDEFLER = {
  // Kanal çerçevesi (RFC-0027 §5 a; 1 MiB sınırı): ayırıcı ve bağlayıcı, gelişigüzel parçalanmış akış
  ipc () {
    const { ipcBagla, cerceveYaz, Ayirici, EN_COK } = require('../worklet/ipc')
    const ornek = ['{"id":1,"komut":200,"govde":{}}', '{"id":"a","komut":241,"govde":{"collectionId":"' + 'ab'.repeat(16) + '"}}', 'x']
    return {
      tohumlar: () => ornek.map((m) => cerceveYaz(m)).concat([b4a.concat(ornek.map((m) => cerceveYaz(m)))]),
      dene (b) {
        let toplam = 0
        const a = new Ayirici({ tamam: (m) => { toplam += m.length; if (b4a.byteLength(m) > EN_COK) throw new Error('LIMIT_EXCEEDED') }, gecersiz: () => {}, durOnGecersiz: b[0] & 1 })
        const giden = []
        const ipc = { on (e, f) { this.f = f }, off () { this.f = null }, write: (c) => giden.push(c) }
        const k = ipcBagla({ ipc, sunucu: { isle: (m) => { JSON.parse(m); return JSON.stringify({ id: 1, sonuc: m.length }) }, olaylariBagla: () => () => {} } })
        let o = 0
        while (o < b.byteLength) { const l = 1 + (b[o] % 97); a.yaz(b.subarray(o, o + l)); if (ipc.f) ipc.f(b.subarray(o, o + l)); o += l }
        for (const c of giden) {
          const n = new DataView(c.buffer, c.byteOffset, 4).getUint32(0)
          if (n === 0 || n > EN_COK || n + 4 !== c.byteLength) throw new Error('OUTGOING_FRAME_CORRUPT')
        }
        k.kapat()
        return toplam
      }
    }
  },

  // RFC-0003 zarfları: tek giriş noktası, bütün türler (SDK yüklü: kayıt, görev, kasa çözücüleri kayıtlı)
  zarf () {
    require('@havenfold/sdk')
    require('../node/node-envelope') // düğüm zarflarının çözücüleri (UPDATE_*, NODE_HEALTH)
    const core = require('@havenfold/core')
    const A = require('../core/records/test/helpers/family')
    const L = A.anaDefter()
    const turler = [...new Set(Object.values(core.zarf.Z))]
    const yollar = ['dogrudan', 'emanet', 'posta']
    const roller = ['uye', 'cihaz', 'misafir']
    return {
      tohumlar: () => [...L.events.map((e) => core.ledger.encodeEvent(e)), b4a.alloc(0)],
      dene (b) {
        const t = turler[b.byteLength % turler.length]
        // Gerçek çözücü, hata türü korunarak (gelenZarf her hatayı INVALID_MESSAGE'e çevirir; inceleme 18)
        for (const tur of turler) {
          const coz = core.giris.cozucu(tur)
          if (coz) { try { coz(b) } catch (err) { if (!kodluMu(err)) throw err } }
        }
        for (const yol of yollar) {
          for (const peerRole of roller) {
            try { core.giris.gelenZarf({ myRole: 'uye', peerRole, type: t, bytes: b, L, gonderen: b4a.toString(A.K.kerem.memberId, 'hex'), yol }) } catch (err) { if (!kodluMu(err)) throw err }
          }
        }
        try { core.giris.gelenZarf({ kanal: 'yerel', type: [0xe8, 0xe9, 0xea][b.byteLength % 3], bytes: b }) } catch (err) { if (!kodluMu(err)) throw err }
      }
    }
  },

  // HELLO: çözme (kanonik) ve doğrulama
  hello () {
    const c = require('compact-encoding')
    const core = require('@havenfold/core')
    const A = require('../core/records/test/helpers/family')
    const L = A.anaDefter()
    const soket = { handshakeHash: b4a.alloc(32, 7) }
    const beklenen = b4a.toString(A.K.kerem.memberId, 'hex')
    return {
      tohumlar: () => [c.encode(core.messages.hello, core.hello.createHello(A.K.kerem, soket, L, core.hello.CAPS.LEDGER_V21))],
      dene (b) {
        let h
        try { h = core.encoding.canonical(core.messages.hello, b, 'INVALID_MESSAGE') } catch (err) { if (kodluMu(err)) return; throw err }
        const r = core.hello.verifyHello(h, soket, L, beklenen)
        if (r.ok && !b4a.equals(h.memberId, A.K.kerem.memberId)) throw new Error('FALSE_ACCEPT')
      }
    }
  },

  // Kap başlığı (KDF'den önce: maliyet parametreleri sınırlı mı)
  'kap-baslik' () {
    const K = require('../core/export/export')
    const kap = K.kapla(b4a.from('icerik'), 'bulanik-test-parolasi-24k', { urun: 'yuva-defteri', bicim: 'yuva-defteri', opslimit: 3, memlimit: 64 * 1024 * 1024 })
    return {
      tohumlar: () => [kap, kap.subarray(0, 300)],
      dene (b) {
        const { baslik } = K.baslikOku(b)
        K.telefonSiniri(baslik)
        if (baslik.memlimit > 4 * 1024 * 1024 * 1024) throw new Error('NO_MEMORY_LIMIT')
      }
    }
  },

  // Kap akışı: anahtar bir kez türetilir; şifreli parçalar parçalı beslenir
  'kap-akis' () {
    const K = require('../core/export/export')
    const icerik = b4a.alloc(K.CHUNK * 2 + 100, 0x61)
    const parola = 'bulanik-test-parolasi-24k'
    const kap = K.kapla(icerik, parola, { urun: 'yuva-defteri', bicim: 'yuva-defteri', opslimit: 3, memlimit: 64 * 1024 * 1024 })
    const { baslik, salt, on, govde } = K.baslikOku(kap)
    const anahtar = K.anahtarTuret(parola, salt, baslik.opslimit, baslik.memlimit)
    return {
      tohumlar: () => [govde, govde.subarray(0, K.HEADERBYTES + K.CHUNK + K.ABYTES)],
      dene (b) {
        const ok = new K.KapOkuyucu(b4a.from(anahtar), baslik, on, b.subarray(0, K.HEADERBYTES))
        const kalan = b.subarray(K.HEADERBYTES)
        let o = 0
        while (o < kalan.byteLength) { const l = 1 + (kalan[o] * 977) % 40000; ok.besle(kalan.subarray(o, o + l)); o += l }
        ok.bitir()
      }
    }
  },

  // Kabın içindeki ZIP ve arşiv (parolayı bilen biri kurmuş olabilir)
  'kap-zip' () {
    const Z = require('../core/export/zip')
    const Ar = require('../core/export/archive')
    const zip = Z.zipYaz([{ ad: 'icerik.json', bytes: b4a.from(JSON.stringify({ bicim: 'yuva-defteri', bicimSurum: 1, olusturma: 1, koleksiyonlar: [{ ad: 'Tüm Aile', tur: 'genel', kasa: false, kayitlar: [{ tur: 'yuva.defter.not', olusturma: 1, degisme: 1, alanlar: { baslik: 'x' }, yapay_zeka_alanlari: [] }] }] })) }, { ad: 'BENIOKU.txt', bytes: b4a.from('oku') }, { ad: 'dosyalar/a.bin', bytes: b4a.alloc(300, 1) }])
    return {
      tohumlar: () => [zip],
      dene (b) {
        try { Z.zipOku(b) } catch (err) { if (!kodluMu(err)) throw err }
        Ar.arsivOku(b)
      }
    }
  },

  // Kişisel köprü (RFC-0005 §15, RFC-0027 §7)
  kopru () {
    const K = require('../core/core/protocol/bridge')
    const F = JSON.parse(b4a.toString(fs.readFileSync(KOK + '/protocol/vectors/bridge.json')))
    const ham = (b) => K.ON_EK + K.b64Yaz(b)
    return {
      tohumlar: () => F.gecerli.map((g) => b4a.from(g.bytes, 'hex')),
      dene (b) {
        const n = new K.NonceDefteri({ now: () => 1_790_000_000_000 })
        for (const metin of [ham(b), K.ON_EK + b4a.toString(b, 'latin1')]) {
          let m
          try { m = K.kopruCoz(metin, { kendi: 'aile', simdi: 1_790_000_000_000 }) } catch (err) { if (!kodluMu(err)) throw err; continue }
          if (!K.TURLER.ekip.includes(m.type) || b4a.byteLength(m.text) > K.METIN_MAX) throw new Error('FALSE_ACCEPT')
          n.gor(m.nonce)
        }
      }
    }
  },

  // Pay teslimi (RFC-0027 §1b; 0xF1, 0xF2)
  pay () {
    const T = require('../core/vault/delivery')
    const I = require('../core/vault/request')
    const A = require('../core/records/test/helpers/family')
    const F = JSON.parse(b4a.toString(fs.readFileSync(KOK + '/protocol/vectors/vault-share.json')))
    const L = A.anaDefter()
    const bellek = () => { const m = new Map(); return { get: (k) => m.get(k), has: (k) => m.has(k), set: (k, v) => m.set(k, v) } }
    let tutucu = null
    let i = 0
    return {
      tohumlar: () => [...F.durumlar.map((d) => b4a.from(d.bytes, 'hex')), b4a.from(F.ack, 'hex')],
      dene (b) {
        if (!tutucu || ++i % 500 === 0) tutucu = new I.PayTutucu({ ledger: L, me: A.K.husniye, now: () => A.TS0, ilkGorulme: bellek(), sayac: bellek() })
        try { T.alindiCoz(b) } catch (err) { if (!kodluMu(err)) throw err }
        try { T.payTeslimiCoz(b) } catch (err) { if (!kodluMu(err)) throw err }
        T.teslimAl(tutucu, b4a.toString(A.K.kerem.memberId, 'hex'), b)
      }
    }
  },

  // Kalıcı dosyalar (durum, kimlik, arsiv, hlc): telefondaki açılış yolu, bellekte (çözülmüş içerik bozuk)
  dosya () {
    const { Kalici } = require('../worklet/persistence')
    const W = require('../worklet/test/helpers/common')
    const dizin = W.geciciDizin(null, 'bulanik')
    const arsiv = W.arsivAnahtari(61)
    const k = new Kalici({ dizin, anahtar: b4a.alloc(32, 0x61), archivePubHex: arsiv.pubHex, now: () => 1_800_000_000_000 })
    const n = k.aileKur({ aileAdi: 'Rivera', benimAdim: 'Alex' })
    n.defter.myPersonalVault()
    n.kasa.unlock(arsiv.skHex)
    n.kayit.put(n.kayit.collections().find((x) => x.name === 'Tüm Aile').collectionId, null, 'yuva.defter.not', { baslik: 'not' })
    k.kaydet()
    n.kasa.lock()
    const dosyalar = {}
    for (const ad of ['kimlik', 'durum', 'arsiv', 'hlc']) dosyalar[ad] = k.depo.oku(ad)
    k.kapat()
    fs.rmSync(dizin, { recursive: true, force: true })
    const durumJson = JSON.parse(b4a.toString(dosyalar.durum))
    const yollar = []
    const gez = (x, yol) => { yollar.push(yol); if (x && typeof x === 'object') for (const [a, v] of Object.entries(x)) if (yollar.length < 4000) gez(v, [...yol, a]) }
    gez(durumJson, [])
    const ac = (d) => {
      const o = Object.create(Kalici.prototype)
      Object.assign(o, {
        depo: { oku: (ad) => d[ad] || null, yaz: (ad, b) => { d[ad] = b }, gocEdilen: null, kip: 2 },
        dosyalar: null, now: () => 1_800_000_000_000, appId: null, kancalar: {}, kaydedildi: null, uygunCihaz: () => false,
        arsivPub: b4a.from(arsiv.pubHex, 'hex'), arsivAcik: false, arsivOzet: null, _arsivGecis: null, sonOzet: null, sayac: 0
      })
      o._ac('bare', null, null)
    }
    ac({ ...dosyalar }) // geçerli kopya açılmalı
    // Girdi: dört dosyanın paketi (örnek tek başına yeniden koşabilsin)
    const paketle = (d) => b4a.from(JSON.stringify(Object.fromEntries(Object.entries(d).map(([a, v]) => [a, v ? hex(v) : null]))))
    const ac2 = (b) => { const j = JSON.parse(b4a.toString(b)); ac(Object.fromEntries(Object.entries(j).map(([a, v]) => [a, v === null ? null : b4a.from(v, 'hex')]))) }
    return {
      tohumlar: () => [dosyalar.durum],
      dene: ac2,
      // Paket üretimi: tek bir dosyayı bayt düzeyinde ya da durumu yapı düzeyinde bozar
      uret (R, tohumlar) {
        const b = mutasyon(R, tohumlar)
        const d = { ...dosyalar }
        const s = R.n(8)
        if (s === 0) d.arsiv = b
        else if (s === 1) d.hlc = b.subarray(0, R.n(2) ? 8 : b.byteLength)
        else if (s === 2) d.kimlik = b
        else if (s <= 4) d.durum = b // bayt düzeyinde
        else {
          // Yapı düzeyinde: bir alanı başka türle değiştir ya da sil
          const j = JSON.parse(b4a.toString(dosyalar.durum))
          for (let t = 0; t < 1 + R.n(3); t++) {
            const yol = yollar[1 + R.n(yollar.length - 1)]
            let x = j
            for (const a of yol.slice(0, -1)) { if (!x || typeof x !== 'object') break; x = x[a] }
            if (!x || typeof x !== 'object') continue
            const son = yol[yol.length - 1]
            const secenek = [undefined, null, 0, -1, 2 ** 53, '', 'x', [], {}, { $h: 'zz' }, { $n: 'x' }, { $m: 5 }, { $s: [1] }, true]
            const v = secenek[R.n(secenek.length)]
            if (v === undefined) delete x[son]; else x[son] = v
          }
          d.durum = b4a.from(JSON.stringify(j))
        }
        return paketle(d)
      },
      tohumPaketi: () => paketle(dosyalar)
    }
  },

  // Tek giriş noktasının tablosunda olmayan, modülün kendisinin çözdüğü zarflar ve iç biçimler (inceleme 18 kapsamı)
  cozuculer () {
    const core = require('@havenfold/core')
    const J = core.joinHello
    const E = core.emeklilik
    const GV = core.guestView
    const EC = core.ekipCikis
    const I = require('../core/vault/request')
    const OZ = require('../core/events/envelope')
    const KK = require('../core/records/encoding')
    const S = core.sync
    const A = require('../core/records/test/helpers/family')
    const L = A.anaDefter()
    const D0 = require('../core/core/test/helpers/ledger')
    const Sdk = require('@havenfold/sdk')
    const { ledger: LE } = Sdk.TeamApi.create({ Ledger: core.ledger.Ledger, me: D0.K.kerem, isletmeAdi: 'E', displayName: 'K', ts: D0.TS0 })
    const coz = [
      (b) => J.decodeJoinHello(b),
      (b) => E.decodeRetireBegin(b),
      (b) => E.decodeRetireList(b),
      (b) => E.base45Decode(b4a.toString(b, 'latin1')),
      (b) => GV.acceptGuestView(null, b, b4a.alloc(16, 1)),
      (b) => EC.cikisDenetle(LE, b, b4a.toString(D0.K.ecem.memberId, 'hex'), { simdi: D0.TS0 }),
      (b) => EC.makbuzDenetle(LE, b, { simdi: D0.TS0 }),
      (b) => I.payIstegiCoz(b),
      (b) => I.payCevabiCoz(b),
      (b) => I.surumCevabiCoz(b),
      (b) => OZ.decodeUyandir(b),
      (b) => OZ.decodeDur(b),
      (b) => KK.decodeInner(b),
      (b) => KK.decodeRecOp(b),
      (b) => KK.decodeRecDrop(b),
      (b) => core.ledger.decodeEvent(b),
      (b) => S.decodeEvents(b),
      (b) => S.decodeReq(b)
    ]
    return {
      tohumlar: () => L.events.map((e) => core.ledger.encodeEvent(e)),
      dene (b) {
        for (const f of coz) { try { f(b) } catch (err) { if (!kodluMu(err)) throw err } }
      }
    }
  },

  // Taşıyıcı: kimliği doğrulanmamış eşten gelen çerçeveler (core/transport/transport.js _oturum, bayrak arkasında)
  tasiyici () {
    const { DhtTasiyici } = require('@havenfold/transport')
    const A = require('../core/records/test/helpers/family')
    const L = A.anaDefter()
    const dht = { createServer: () => ({ listen: async () => {}, close: async () => {} }), connect: () => ({ on () {}, once () {} }) }
    const t = new DhtTasiyici({ dht, cihaz: () => ({ kimlik: A.K.kerem, ledger: L }), deneysel: true, now: () => 1_800_000_000_000 })
    const isl = { baglandi: () => {}, koptu: () => {}, al: () => {} }
    t.isl = isl
    const soket = () => {
      const d = new Map()
      return {
        handshakeHash: b4a.alloc(32, 3), remotePublicKey: b4a.alloc(32, 4),
        on (a, f) { if (!d.has(a)) d.set(a, []); d.get(a).push(f) }, once (a, f) { this.on(a, f) },
        emit (a, ...x) { for (const f of d.get(a) || []) f(...x) },
        write () {}, destroy () { this.emit('close') }
      }
    }
    return {
      tohumlar: () => [b4a.from([1]), b4a.from([1, 2, 3])],
      dene (b) {
        const s = soket()
        t._oturum(b4a.toString(A.K.husniye.memberId, 'hex'), s, 1)
        s.emit('data', b)
        s.emit('data', b.subarray(0, Math.max(1, b.byteLength >> 1)))
        s.destroy()
        t.basarisiz.clear()
        t.kapali.clear()
      }
    }
  },

  // Gömme dizini dosyası (D52): bozuk dosya silinir, hata dışarı çıkmaz (inceleme 18 W1/W2)
  async 'gomme-dosya' () {
    const { GommeDizini } = require('../core/ai/embedding')
    const m = new Map()
    const saklama = { oku: (ad) => m.get(ad) || null, yaz: (ad, b) => m.set(ad, b4a.from(b)), sil: (ad) => m.delete(ad) }
    const cid = 'ab'.repeat(16)
    const ad = 'gomme-' + cid
    const anahtarOf = () => ({ key: b4a.alloc(32, 7), kimlik: '1:aa:bb' })
    const gom = (ms) => ms.map((x) => { const v = new Float32Array(8); v[x.length % 8] = 1; v[7] += 0.1; return v })
    const yeni = () => new GommeDizini({ gom, onEkler: ['q', 'p'], modelHash: 'cd'.repeat(32), saklama, anahtarOf })
    const g0 = yeni()
    for (let i = 0; i < 3; i++) g0.ekle({ id: cid + '|' + i + '#0', collectionId: cid, recordId: 'ef'.repeat(16), hlc: i, metin: 'kombi ' + i })
    await g0.isle()
    const gecerli = m.get(ad)
    return {
      tohumlar: () => [gecerli],
      dene (b) {
        m.set(ad, b)
        yeni().yukle(cid) // açılamayan dosya silinir; hata çıkmaz
      }
    }
  },

  // Kutunun pay alması (node/box-share.js; 0xF1 kutuya). Kutu çekirdeği Bare'de de çalışır (D62)
  'kutu-pay' () {
    const { KutuPaylari } = require('../node/box-share')
    const { taklitTpm } = require('../node/tpm')
    const A = require('../core/records/test/helpers/family')
    const W = require('../worklet/test/helpers/common')
    const F = JSON.parse(b4a.toString(fs.readFileSync(KOK + '/protocol/vectors/vault-share.json')))
    const L = A.anaDefter()
    const dizin = W.geciciDizin(null, 'bulanik-kutu')
    const kp = new KutuPaylari({ ledger: L, me: A.K.kutu, dizin, tpm: taklitTpm({ test: true, anahtar: b4a.alloc(32, 9) }), testKipi: true, now: () => A.TS0 })
    return {
      tohumlar: () => F.durumlar.map((d) => b4a.from(d.bytes, 'hex')),
      dene (b) { kp.payAl(b4a.toString(A.K.kerem.memberId, 'hex'), b, 'dogrudan') },
      // Kutunun pay dizini koşu bitince silinir (Codex 12. tur: her koşu worklet/.gecici/bulanik-kutu-* bırakıyordu)
      kapat () { fs.rmSync(dizin, { recursive: true, force: true }) }
    }
  },

  // Düğümün yerel IPC çerçevesi (node/ipc/frame.js): akış okuyucusu ve mesaj çözücüsü
  'node-ipc' () {
    const C = require('../node/ipc/frame')
    return {
      tohumlar: () => { try { return [C.cerceveYaz(1, 7, {})] } catch { return [b4a.from([0, 0, 0, 3, 1, 7, 0])] } },
      dene (b) {
        const o = new C.CerceveOkuyucu()
        let msgs = []
        try { msgs = o.besle(b) } catch (err) { if (!kodluMu(err)) throw err }
        for (const m of [b.subarray(4), ...msgs]) {
          for (const yon of ['istek', 'cevap']) { try { C.mesajCoz(m, yon) } catch (err) { if (!kodluMu(err)) throw err } }
        }
      }
    }
  },

  // Tören QR'ı (yuva://j/2/)
  // RFC-0012 afet çerçeveleri: her türün çözücüsü (WANT, DONE ve HAVE öğe sınırları dahil) ve keşif duyurusu
  afet () {
    const M = require('../core/disaster/message')
    const Y = require('../core/disaster/local')
    const turler = Object.values(M.Z)
    const mid = b4a.alloc(16, 1)
    const cer = (tur, m) => b4a.concat([b4a.from([tur]), M.kodla(tur, m)])
    return {
      tohumlar: () => [
        cer(M.Z.AFET_HAVE, { items: [{ mid, toTag: b4a.alloc(8, 2), prio: 0, hops: 3 }] }),
        cer(M.Z.AFET_WANT, { mids: [mid] }),
        cer(M.Z.AFET_DONE, { items: [{ mid, doneSecret: b4a.alloc(32, 3) }] }),
        Y.duyuruKodla({ v: 1, slot: 0, tags: Array.from({ length: M.SINIR.etiket }, () => b4a.alloc(4, 4)) }, 4242)
      ],
      dene (b) {
        if (b.byteLength < 1) return
        for (const tur of turler) { try { M.coz(tur, b.subarray(1)) } catch (err) { if (!kodluMu(err)) throw err } }
        Y.duyuruCoz(b)
      }
    }
  },

  // Uç (RFC-0008): imzalı gövdeler (profil, akış açma, durum, silme raporu), düz gövdeler ve şifreli kare açıcı
  uc () {
    const K = require('../core/edge/encoding')
    const C = require('../core/edge/frame')
    const pair = b4a.alloc(32, 5)
    const streamId = b4a.alloc(16, 6)
    const m = new C.AkisMuhurleyici({ pair, streamId, ssrc: 7 })
    const kare = m.muhurle(b4a.from('kare'), { ts: 1 }).cerceve
    const imzali = [[K.profilGovde, K.profilDenetle], [K.akisAcGovde, K.akisAcDenetle], [K.durumGovde, K.durumDenetle], [K.silmeGovde, K.silmeDenetle]]
    return {
      tohumlar: () => [kare, b4a.concat([b4a.alloc(40, 1), b4a.alloc(64)])],
      dene (b) {
        for (const [enc, denetle] of imzali) { try { K.imzaliCoz(enc, b, denetle) } catch (err) { if (!kodluMu(err)) throw err } }
        for (const coz of [K.kabulCoz, K.kapatCoz]) { try { coz(b) } catch (err) { if (!kodluMu(err)) throw err } }
        new C.AkisAcici({ pair, streamId, ssrc: 7 }).ac(b)
      }
    }
  },

  // Hizmet paylaşımı (RFC-0010): kart, dizin, QR ve cevap çözücüleri
  hizmet () {
    const H = require('../core/services/card')
    const R = require('../core/services/reply')
    const anahtar = b4a.alloc(32, 8)
    return {
      tohumlar: () => [b4a.alloc(64, 1), b4a.from(H.QR_PREFIX + 'abc')],
      dene (b) {
        try { H.kartCoz(b) } catch (err) { if (!kodluMu(err)) throw err }
        try { H.dizinCoz(b, [anahtar]) } catch (err) { if (!kodluMu(err)) throw err }
        try { H.qrCoz(H.QR_PREFIX + b4a.toString(b, 'base64url')) } catch (err) { if (!kodluMu(err)) throw err }
        try { H.qrCoz(b4a.toString(b, 'latin1')) } catch (err) { if (!kodluMu(err)) throw err }
        R.cevapCoz(b)
      }
    }
  },

  qr () {
    const { qrCoz } = require('@havenfold/transport/ceremony')
    const { qrKind } = require('../sdk/ceremony')
    const c = require('compact-encoding')
    const govde = b4a.concat([c.encode(c.uint, 2), b4a.from([1]), b4a.alloc(8, 1), b4a.alloc(16, 2), b4a.alloc(32, 3), b4a.alloc(16, 4), c.encode(c.uint, 1_800_000_000)])
    return {
      tohumlar: () => [govde],
      dene (b) {
        const kod = 'yuva://j/2/' + b4a.toString(b, 'base64url')
        try { qrKind(kod) } catch (err) { if (!kodluMu(err)) throw err }
        try { qrCoz(kod) } catch (err) { if (!kodluMu(err)) throw err }
        qrCoz('yuva://j/2/' + b4a.toString(b, 'latin1'))
      }
    }
  }
}

// --- Koşu ---------------------------------------------------------------------------------------------------------

function ornekYaz (ad, b) {
  fs.mkdirSync(ORNEK_DIZINI, { recursive: true })
  const ozet = hex(require('@havenfold/core').kdf.hash('hf/bulanik', b)).slice(0, 16)
  const yol = ORNEK_DIZINI + '/' + ad + '-' + ozet + '.hex'
  fs.writeFileSync(yol, hex(b) + '\n')
  return yol
}

async function bir (ad, h, b) {
  const t0 = Date.now()
  let sonuc = null
  try { await h.dene(b) } catch (err) { if (!kodluMu(err)) sonuc = 'COKME ' + (err && err.constructor && err.constructor.name) + ': ' + (err && err.message) }
  const sure = Date.now() - t0
  if (!sonuc && sure > MAX_TERM_MS) sonuc = 'YAVAS ' + sure + ' ms'
  return sonuc
}

async function hedefKos (ad, sayi, tohum) {
  const h = await HEDEFLER[ad]()
  if (h.atla) return { ad, sayi: 0, ms: 0, bellekMiB: 0, bulgular: [], atla: h.atla }
  const R = rastgele(tohum ^ ad.split('').reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7))
  const tohumlar = [...h.tohumlar(), ...vektorDerlemi()]
  const uret = h.uret ? () => h.uret(R, tohumlar) : () => mutasyon(R, tohumlar)
  const bellek0 = rss()
  const bulgular = []
  const ornekler = []
  const t0 = Date.now()
  // Önce tohumların kendisi
  for (const b of h.uret ? [h.tohumPaketi()] : tohumlar) { const s = await bir(ad, h, b); if (s && bulgular.length < 20) bulgular.push({ s, yol: ornekYaz(ad, b) }) }
  for (let i = 0; i < sayi; i++) {
    const b = uret()
    const s = await bir(ad, h, b)
    // Olay döngüsü 1000 girdide bir döner: Bare iptal edilen zamanlayıcıları (clearTimeout) ancak döngü dönünce bırakır;
    // telefonda döngü sürekli döner (D54: aksi hâlde taşıyıcının HELLO zamanlayıcıları yalancı sızıntı gösterir)
    if (i % 1000 === 999) await new Promise((resolve) => setTimeout(resolve, 0))
    if (s && bulgular.length < 20) bulgular.push({ s, yol: ornekYaz(ad, b) })
    // Bellek: çöp toplama geç çalışır (testere dişi; Bare'de 100 000 girdiye kadar); sızıntıda taban da yükselir. Son 50
    // örneğin (100 000 girdi) en küçüğü sınırı aşarsa bulgu
    if (i % 2000 === 0) {
      ornekler.push(rss() - bellek0)
      if (ornekler.length > 50) ornekler.shift()
      if (ornekler.length === 50 && Math.min(...ornekler) > BELLEK_SINIRI) { bulgular.push({ s: 'BELLEK ' + Math.round(Math.min(...ornekler) / 1048576) + ' MiB (taban)', yol: null }); break }
    }
  }
  if (h.kapat) h.kapat()
  return { ad, sayi, ms: Date.now() - t0, bellekMiB: Math.round(Math.min(...(ornekler.length ? ornekler : [rss() - bellek0])) / 1048576), bulgular }
}

async function ornekleriKos () {
  let hata = 0
  let n = 0
  const dosyalar = fs.existsSync(ORNEK_DIZINI) ? fs.readdirSync(ORNEK_DIZINI).filter((f) => f.endsWith('.hex')).sort() : []
  const kurulu = new Map()
  for (const f of dosyalar) {
    const ad = f.slice(0, f.lastIndexOf('-'))
    if (!HEDEFLER[ad]) { console.log('NO_TARGET ' + f); hata++; continue }
    if (!kurulu.has(ad)) kurulu.set(ad, await HEDEFLER[ad]())
    if (kurulu.get(ad).atla) continue
    const b = b4a.from(b4a.toString(fs.readFileSync(ORNEK_DIZINI + '/' + f)).trim(), 'hex')
    const s = await bir(ad, kurulu.get(ad), b)
    n++
    if (s) { console.log('ORNEK ' + f + ': ' + s); hata++ }
  }
  for (const h of kurulu.values()) if (h.kapat) h.kapat()
  console.log(hata ? 'BULANIK_ORNEKLER HATA ' + hata : 'BULANIK_ORNEKLER TAMAM ' + n)
  return hata
}

function surecKos (args, sinirMs) {
  const { spawn } = BARE ? require('../worklet/node_modules/bare-subprocess') : require('child_process')
  const yurutucu = BARE ? Bare.argv[0] : process.execPath
  return new Promise((resolve) => {
    const p = spawn(yurutucu, [__filename, ...args], { stdio: ['ignore', 'pipe', 'inherit'] })
    let cikti = ''
    let doldu = false
    const z = setTimeout(() => { doldu = true; try { p.kill() } catch {} }, sinirMs)
    p.stdout.on('data', (d) => { cikti += d.toString() })
    p.on('exit', (kod) => {
      clearTimeout(z)
      const s = cikti.split('\n').find((x) => x.startsWith('SONUC '))
      if (doldu) resolve({ ad: args[1], bulgular: [{ s: 'SURE_ASIMI (sonsuz döngü?) ' + sinirMs + ' ms', yol: null }] })
      else if (!s) resolve({ ad: args[1], bulgular: [{ s: 'SUREC_DUSTU ' + kod + ' ' + cikti.slice(-300), yol: null }] })
      else resolve(JSON.parse(s.slice(6)))
    })
  })
}

async function main () {
  if (ARGV.includes('--ornekler')) cik(await ornekleriKos() ? 1 : 0)
  const kisa = ARGV.includes('--kisa')
  const sayi = parseInt(deger('--sayi', kisa ? '3000' : '200000'), 10)
  const tohum = parseInt(deger('--tohum', '1'), 10)
  if (ARGV[0] === '--tek') { console.log('SONUC ' + JSON.stringify(await hedefKos(ARGV[1], sayi, tohum))); cik(0) }
  const secili = deger('--hedef', null)
  const adlar = secili ? [secili] : Object.keys(HEDEFLER)
  let hata = 0
  console.log(`Bulanık test: ${BARE ? 'Bare ' + Bare.version : 'Node ' + process.version}, hedef başına ${sayi} girdi, tohum ${tohum}`)
  for (const ad of adlar) {
    const r = await surecKos(['--tek', ad, '--sayi', String(sayi), '--tohum', String(tohum)], Math.max(120000, sayi * 20))
    const durum = r.atla ? 'atlandı: ' + r.atla : r.bulgular.length ? 'BULGU ' + r.bulgular.length : 'temiz'
    console.log(`| ${ad} | ${r.sayi ?? '—'} | ${r.ms ?? '—'} ms | ${r.bellekMiB ?? '—'} MiB | ${durum} |`)
    for (const g of r.bulgular) console.log('    ' + g.s + (g.yol ? ' → ' + g.yol.slice(KOK.length + 1) : ''))
    if (r.bulgular.length) hata++
  }
  console.log(hata ? 'BULANIK HATA ' + hata : 'BULANIK TAMAM')
  cik(hata ? 1 : 0)
}

main().catch((err) => { console.error('HATA', err && err.stack); cik(1) })
