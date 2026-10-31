// SPDX-License-Identifier: Apache-2.0
// D12 sabitleyici test: ağdan ya da yerel kanaldan gelen her zarf core giris.gelenZarf'tan geçer (oturum süzgeci,
// kanonik çözme). (1) Kaynakta bayt alan her yöntem kayıtlı giriş listesinde ya da gerekçeli dışlama listesindedir;
// yeni bir yol eklenip listeye yazılmazsa bu test kırılır. (2) Her giriş çağrılınca gelenZarf gerçekten çalışır ve
// izinsiz tür reddedilir. Düğüm tarafı node/test/ingress.js'tedir.
const test = require('brittle')
// Kaynak taraması Node'da yapılır (kaynak platformdan bağımsızdır); Bare'de yalnız dinamik denetim koşar. Modül adları
// birleştirilerek yazılır: Bare yükleyicisi düz yazılmış require('fs')'i yüklemeden önce çözmeye çalışır.
const NODE = typeof Bare === 'undefined' // eslint-disable-line no-undef
const fs = NODE ? require('f' + 's') : null
const path = NODE ? require('pa' + 'th') : null
const b4a = require('b4a')
const core = require('@havenfold/core')
const S = require('..')
const A = require('../../core/records/test/helpers/family')

const { Z } = core.zarf
const hataOf = (fn) => { try { fn(); return null } catch (err) { return err.message } }

// Bayt alan ama ağ zarfı işlemeyen yöntemler (gerekçe): giden ya da yerel üretim
const DISLANAN = {
  'RecordApi.attach': 'kullanıcının eklediği dosyayı şifreleyip giden BLOB_DATA üretir; gelen zarf değil',
  'ExportApi.import': 'kişinin seçtiği kap dosyası (RFC-0014); ağ zarfı değil, kap kendi kanonik biçimiyle ve parolayla açılır',
  'ServiceApi.directory': 'Eser\'in hizmet dizini (RFC-0010 §5.1): platformun HTTPS ile indirdiği dosya, topluluk zarfı değil; dizin anahtarıyla imzalı ve kanonik çözülür'
}

function yontemler (dosya) {
  const s = fs.readFileSync(dosya, 'utf8')
  const out = []
  let sinif = null
  for (const satir of s.split('\n')) {
    const k = /^class (\w+)/.exec(satir)
    if (k) sinif = k[1]
    const m = /^ {2}(?:async )?([a-zA-Z_]\w*) \(([^)]*)\) \{/.exec(satir)
    if (m && /bytes|Bytes/.test(m[2])) out.push(sinif + '.' + m[1])
  }
  return out
}

test('SDK: bayt alan her yöntem kayıtlı giriş noktası ya da gerekçeli dışlama', (t) => {
  if (!NODE) { t.pass('kaynak taraması Node koşusunda'); return }
  const kaynak = fs.readdirSync(path.join(__dirname, '..')).filter((f) => f.endsWith('.js')).flatMap((f) => yontemler(path.join(__dirname, '..', f)))
  for (const y of kaynak) t.ok(S.ENTRY_POINTS.includes(y) || DISLANAN[y], y)
  for (const g of S.ENTRY_POINTS) t.ok(kaynak.includes(g), 'liste kaynağa uyar: ' + g)
})

test('SDK: her giriş noktası gelenZarf\'tan geçer; izinsiz tür ve bozuk bayt reddedilir', (t) => {
  const asil = core.giris.gelenZarf
  const gorulen = []
  core.giris.gelenZarf = (o) => { gorulen.push(o.kanal === 'yerel' ? 'yerel:' + o.type : o.type); return asil(o) }
  try {
    const L = A.anaDefter()
    const r = A.replika(L, A.K.husniye)
    const kayit = new S.RecordApi({ replika: r })
    const kerem = b4a.toString(A.K.kerem.memberId, 'hex')
    t.is(hataOf(() => kayit.blobReceived(kerem, b4a.from([1, 2, 3]), 'dogrudan')), 'INVALID_MESSAGE')
    const gorev = new S.TaskApi({ ledger: L, me: A.K.husniye, yetenekler: new (require('@havenfold/tasks').yetenek.YetenekDefteri)({ ledger: L }) })
    t.is(hataOf(() => gorev.receive(kerem, Z.TASK_RESULT, b4a.from([9]), 'dogrudan')), 'INVALID_MESSAGE')
    const defter = new S.LedgerApi({ ledger: L, me: A.K.husniye })
    t.is(hataOf(() => defter.receiveProposal(kerem, b4a.from([0]), 'dogrudan')), 'INVALID_MESSAGE')
    t.is(hataOf(() => defter.pairApprove(b4a.from([0]), { approved: true })), 'INVALID_MESSAGE')
    t.is(hataOf(() => defter.pairAccept(b4a.from([0]))), 'PAIRING_STATUS', 'eşleşme durumu yoksa önce durum')
    defter.pairRequest('yuva-defteri')
    t.is(hataOf(() => defter.pairAccept(b4a.from([0]))), 'INVALID_MESSAGE')
    t.alike(gorulen, [Z.BLOB_DATA, Z.TASK_RESULT, Z.LEDGER_PROPOSE, 'yerel:' + Z.APP_PAIR_REQ, 'yerel:' + Z.APP_PAIR_OK])
    // Ağdan gelen eşleşme türü ve yerel kanalda ağ türü reddedilir
    t.is(hataOf(() => asil({ myRole: 'uye', peerRole: 'uye', type: Z.APP_PAIR_REQ, bytes: b4a.alloc(0), yol: 'dogrudan' })), 'TYPE_NOT_ALLOWED')
    t.is(hataOf(() => asil({ kanal: 'yerel', type: Z.LEDGER_PROPOSE, bytes: b4a.alloc(0) })), 'TYPE_NOT_ALLOWED')
    t.is(hataOf(() => asil({ myRole: 'uye', peerRole: 'cihaz', type: Z.NODE_HEALTH, bytes: b4a.alloc(0), yol: 'posta' })), 'DIRECT_ONLY', 'Posta Kutusu\'ndan düğüm zarfı yok')
  } finally { core.giris.gelenZarf = asil }
})

test('açılış öncesi inceleme: telefonda BLOB_DATA sınırları — dev total reddedilir; yarım dosya sayısı sınırlı; parçalar tamamlanınca doğrulanır', (t) => {
  const c = require('compact-encoding')
  const D = require('@havenfold/records').dosya
  const L = A.anaDefter()
  const kayit = new S.RecordApi({ replika: A.replika(L, A.K.husniye) })
  const kerem = b4a.toString(A.K.kerem.memberId, 'hex')
  const parca = (blobId, index, total, chunk = b4a.alloc(10, index)) => c.encode(D.blobData, { blobId, index, total, chunk })
  t.is(hataOf(() => kayit.blobReceived(kerem, parca(b4a.alloc(32, 1), 0, 2 ** 32 - 1), 'dogrudan')), 'INVALID_MESSAGE', 'total sınırın üstünde')
  t.is(hataOf(() => kayit.blobReceived(kerem, parca(b4a.alloc(32, 1), 3, 2), 'dogrudan')), 'INVALID_MESSAGE', 'index ≥ total')
  t.is(hataOf(() => kayit.blobReceived(kerem, parca(b4a.alloc(32, 1), 0, 2, b4a.alloc(D.CHUNK + 1000)), 'dogrudan')), 'INVALID_MESSAGE', 'parça boyu')
  for (let i = 0; i < 9; i++) t.is(kayit.blobReceived(kerem, parca(b4a.alloc(32, 10 + i), 0, 2), 'dogrudan'), 'eksik')
  t.is(kayit._gelen.size, 8, 'en çok 8 yarım dosya; en eskisi düştü')
  t.absent(kayit._gelen.has(b4a.toString(b4a.alloc(32, 10), 'hex')))
  // Tamamlanan ama özeti tutmayan dosya reddedilir
  t.is(hataOf(() => kayit.blobReceived(kerem, parca(b4a.alloc(32, 18), 1, 2), 'dogrudan')), 'INVALID_FILE')
  t.is(kayit._gelenToplam, 7 * 10, 'düşen ve tamamlanan dosyalar bütçeden çıktı')
})

test('Codex 5. tur: telefonda yarım dosyaların toplam baytı sınırlı; aşınca en eski öbür yarım dosyalar düşer', (t) => {
  const c = require('compact-encoding')
  const D = require('@havenfold/records').dosya
  const L = A.anaDefter()
  const kayit = new S.RecordApi({ replika: A.replika(L, A.K.husniye) })
  t.ok(kayit._gelenBayt >= D.MAX_SIZE && kayit._gelenBayt < 1.01 * D.MAX_SIZE, 'varsayılan: tek bir en büyük dosya kadar')
  kayit._gelenBayt = 250
  const kerem = b4a.toString(A.K.kerem.memberId, 'hex')
  const parca = (blobId, index, total, n = 100) => c.encode(D.blobData, { blobId, index, total, chunk: b4a.alloc(n, index) })
  const id = (i) => b4a.toString(b4a.alloc(32, i), 'hex')
  t.is(kayit.blobReceived(kerem, parca(b4a.alloc(32, 1), 0, 3), 'dogrudan'), 'eksik')
  t.is(kayit.blobReceived(kerem, parca(b4a.alloc(32, 2), 0, 3), 'dogrudan'), 'eksik')
  t.is(kayit._gelenToplam, 200)
  t.is(kayit.blobReceived(kerem, parca(b4a.alloc(32, 2), 0, 3), 'dogrudan'), 'eksik', 'aynı parça yeniden: iki kez sayılmaz')
  t.is(kayit._gelenToplam, 200)
  t.is(kayit.blobReceived(kerem, parca(b4a.alloc(32, 3), 0, 3), 'dogrudan'), 'eksik')
  t.absent(kayit._gelen.has(id(1)), 'en eskisi düştü')
  t.ok(kayit._gelen.has(id(2)) && kayit._gelen.has(id(3)))
  t.is(kayit._gelenToplam, 200)
  t.is(hataOf(() => kayit.blobReceived(kerem, parca(b4a.alloc(32, 4), 0, 3, 300), 'dogrudan')), 'INVALID_MESSAGE', 'tek başına bütçeden büyük')
  t.is(kayit._gelenToplam, 0, 'hepsi düştü, sayaç sıfır')
})
