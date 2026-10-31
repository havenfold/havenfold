// SPDX-License-Identifier: Apache-2.0
// Üretildi: scripts/guide-gen.js (docs/sdk-rehberi.md'deki "js örnek:" bloklarından); elle değiştirmeyin.
'use strict'
module.exports = {
  'baslatma': async ({ require, assert, ornekKanal, ornekAile, geciciDizin }) => {
    const b4a = require('b4a')
    const { start } = require('@havenfold/worklet')
    const { urunSunucusu } = require('@havenfold/worklet/example/product')
    const { ipc, iste, olaylar } = ornekKanal() // uygulamada BareKit.IPC
    const w = await start({
      urunSunucusu,
      dizin: geciciDizin(), // yazılabilir, yedeğe girmeyen klasör
      anahtar: b4a.alloc(32, 1), // platform anahtarı (iOS Keychain, Android Keystore)
      archivePubHex: ornekAile().arsiv.pubHex, // Arşiv katmanının açık anahtarı
      sayac: null, // ilk kurulum
      ipc
    })
    assert(olaylar.some((o) => o.olay === 'persisted' && o.veri.sayac === 1), 'bağlanınca son sayaç')
    await iste(2, { aileAdi: 'Rivera', benimAdim: 'Alex' }) // CREATE_FAMILY (örnek sunucu)
    const bilgi = await iste(200, {})
    assert(bilgi.aile === true && bilgi.ad === 'Rivera')
    w.kapat()
  },
  'arsiv-anahtari': async ({ require, assert, ornekKanal, ornekAile, geciciDizin }) => {
    const b4a = require('b4a')
    const { start } = require('@havenfold/worklet')
    const { urunSunucusu } = require('@havenfold/worklet/example/product')
    const { eski, yeni } = ornekAile().arsivCifti
    const dizin = geciciDizin()
    const k1 = ornekKanal()
    let w = await start({ urunSunucusu, dizin, anahtar: b4a.alloc(32, 2), archivePubHex: eski.pubHex, ipc: k1.ipc })
    await k1.iste(2, { aileAdi: 'Rivera', benimAdim: 'Alex' })
    await k1.iste(389, { eskiArchiveKeyHex: eski.skHex, yeniArchivePubHex: yeni.pubHex }) // VAULT_ARCHIVE_MOVE
    w.kapat()
    const k2 = ornekKanal()
    let hata = null
    try { await start({ urunSunucusu, dizin, anahtar: b4a.alloc(32, 2), archivePubHex: eski.pubHex, ipc: k2.ipc }) } catch (err) { hata = err.message }
    assert(hata === 'ARCHIVE_KEY_MISMATCH', 'eski açık anahtarla açılmaz')
    const k3 = ornekKanal()
    w = await start({ urunSunucusu, dizin, anahtar: b4a.alloc(32, 2), archivePubHex: yeni.pubHex, ipc: k3.ipc })
    await k3.iste(224, { archiveKeyHex: yeni.skHex }) // UNLOCK yeni anahtarla
    w.kapat()
  },
  'cerceve': async ({ require, assert, ornekKanal, ornekAile, geciciDizin }) => {
    const { ipc: { cerceveYaz, Ayirici } } = require('@havenfold/worklet')
    const cerceve = cerceveYaz(JSON.stringify({ id: 7, komut: 241, govde: { collectionId: 'aa', recordId: 'bb' } }))
    const onek = new DataView(cerceve.buffer, cerceve.byteOffset, 4).getUint32(0) // büyük uçlu
    assert(onek === cerceve.byteLength - 4, 'uzunluk öneki')
    const gelen = []
    const ayir = new Ayirici({ tamam: (m) => gelen.push(JSON.parse(m)), gecersiz: () => gelen.push('gecersiz') })
    ayir.yaz(cerceve.subarray(0, 3)) // parça parça gelebilir
    ayir.yaz(cerceve.subarray(3))
    assert(gelen.length === 1 && gelen[0].komut === 241)
  },
  'kasa-kilidi': async ({ require, assert, ornekKanal, ornekAile, geciciDizin }) => {
    const b4a = require('b4a')
    const { start } = require('@havenfold/worklet')
    const { urunSunucusu } = require('@havenfold/worklet/example/product')
    const { arsiv } = ornekAile()
    const { ipc, iste } = ornekKanal()
    const w = await start({ urunSunucusu, dizin: geciciDizin(), anahtar: b4a.alloc(32, 3), archivePubHex: arsiv.pubHex, ipc })
    await iste(2, { aileAdi: 'Rivera', benimAdim: 'Alex' })
    const kur = await iste(388, { collectionId: null, kagit: 2 }) // tek ebeveyn: Kasa koleksiyonu hemen kurulur
    const kayit = { collectionId: kur.collectionId, type: 'yuva.defter.sifre', fields: { ad: 'Banka', parola: 'p4r0l4' } }
    let hata = null
    try { await iste(243, kayit) } catch (err) { hata = err.message }
    assert(hata === 'VAULT_LOCKED', 'kilitli başlar')
    await iste(224, { archiveKeyHex: arsiv.skHex }) // UNLOCK
    const rid = await iste(243, kayit)
    await iste(19, {}) // LOCK
    hata = null
    try { await iste(241, { collectionId: kur.collectionId, recordId: rid }) } catch (err) { hata = err.message }
    assert(hata === 'VAULT_LOCKED')
    w.kapat()
  },
  'kap': async ({ require, assert, ornekKanal, ornekAile, geciciDizin }) => {
    const b4a = require('b4a')
    const S = require('@havenfold/sdk')
    const { kayit, TA } = ornekAile()
    kayit.put(TA, null, 'yuva.defter.sifre', { ad: 'Ev wifi', parola: 'ornek-2026' })
    const kap = new S.ExportApi({ kayit, kdf: { opslimit: 3, memlimit: 64 * 1024 * 1024 }, gizliAlanlar: (tur) => (tur === 'yuva.defter.sifre' ? ['parola'] : []) })
    const parcalar = []
    const r = await kap.export({ koleksiyonlar: [TA], parola: 'yirmi-dort-karakterli-p', yaz: (b) => parcalar.push(b4a.from(b)) })
    assert(r.boy === parcalar.reduce((a, b) => a + b.byteLength, 0) && r.ogeSayisi === 1)
    const a = await kap.import({ bytes: b4a.concat(parcalar), parola: 'yirmi-dort-karakterli-p' })
    const k = a.icerik.koleksiyonlar[0].kayitlar[0]
    assert(k.alanlar.ad === 'Ev wifi' && !('parola' in k.alanlar), 'gizli alan istenmedi')
  },
  'tasima': async ({ require, assert, ornekKanal, ornekAile, geciciDizin }) => {
    const { kayit, TA, bakici } = ornekAile()
    const rid = kayit.put(TA, null, 'yuva.defter.wifi', { baslik: 'Misafir ağı', sifre: 'misafir-2026' })
    const yeni = kayit.move(TA, rid, bakici, { baslik: 'Misafir ağı (bakıcı)' })
    assert(kayit.get(TA, rid) === null, 'eskisi silindi')
    const k = kayit.get(bakici, yeni)
    assert(k.fields.baslik === 'Misafir ağı (bakıcı)' && k.fields._src[0] === 'kayit:' + TA + '/' + rid, 'kaynağa başvuru')
  },
  'pay-teslimi': async ({ require, assert, ornekKanal, ornekAile, geciciDizin }) => {
    const b4a = require('b4a')
    const S = require('@havenfold/sdk')
    const { ledger, alex, maya } = ornekAile()
    const id = (k) => b4a.toString(k.memberId, 'hex')
    const kasaK = new S.VaultApi({ ledger, me: alex })
    const kasaI = new S.VaultApi({ ledger, me: maya })
    await kasaK.setupBackupKey(b4a.alloc(32, 4)) // Alex'in YA'sı: Maya pay sahibi (+ kâğıt)
    const giden = kasaK.outgoing().find((g) => g.to === id(maya))
    const alindi = kasaI.receiveShare(id(alex), giden.bytes, 'dogrudan')
    assert(kasaK.receiveAck(id(maya), alindi.bytes, 'dogrudan') === 'teslim')
    let hata = null
    try { kasaI.receiveShare(id(alex), giden.bytes, 'posta') } catch (err) { hata = err.message }
    assert(hata === 'MAILBOX_FORBIDDEN')
  },
  'kasa-kurtarma': async ({ require, assert, ornekKanal, ornekAile, geciciDizin }) => {
    const b4a = require('b4a')
    const S = require('@havenfold/sdk')
    const { ledger, alex, maya } = ornekAile()
    const id = (k) => b4a.toString(k.memberId, 'hex')
    const kilit = 'ab'.repeat(32) // Maya'nın Arşiv anahtarı (platform)
    const kasaI = new S.VaultApi({ ledger, me: maya, anahtarDogrula: (h) => h === kilit })
    const kur = await new S.VaultApi({ ledger, me: alex }).setupBackupKey(b4a.alloc(32, 4), { kisiler: [id(maya)], kagit: 1 })
    kasaI.receiveShare(id(alex), kur.paylar[0].teslim.bytes, 'dogrudan')
    // Alex'in telefonu sıfırlandı: aynı kimlik, boş kasa
    const yeni = new S.VaultApi({ ledger, me: alex })
    yeni.startRecovery({ tur: 'ya' })
    const soru = yeni.recoveryOutgoing().find((g) => g.to === id(maya))
    yeni.receiveVersionReply(id(maya), kasaI.receiveVersionRequest(id(alex), soru.bytes, 'dogrudan').bytes, 'dogrudan')
    const istek = yeni.recoveryOutgoing().find((g) => g.type === 0x9b)
    const { jeton } = kasaI.receiveShareRequest(id(alex), istek.bytes, 'dogrudan') // Maya'ya sorulur
    kasaI.unlock(kilit) // onay yalnız kasa açıkken (biyometri)
    kasaI.approveShare({ jeton, onay: true })
    yeni.receiveShareReply(id(maya), kasaI.recoveryOutgoing()[0].bytes, 'dogrudan')
    yeni.recoveryShare({ kagit: kur.kagitlar[0].metin })
    const acik = await yeni.finishRecovery()
    assert(acik.sirHex === '04'.repeat(32))
    const don = await yeni.rotateVault({ tur: 'ya', kisiler: [id(maya)] })
    assert(don.version === 2 && don.sirHex !== acik.sirHex)
  },
  'ekip': async ({ require, assert, ornekKanal, ornekAile, geciciDizin }) => {
    const b4a = require('b4a')
    const { ledger: { Ledger } } = require('@havenfold/core')
    const S = require('@havenfold/sdk')
    const { alex, maya } = ornekAile() // örnek kimlikler
    let t = Date.now()
    const now = () => ++t
    const { ledger } = S.TeamApi.create({ Ledger, me: alex, isletmeAdi: 'Rivera Kuyum', displayName: 'Alex', yer: { ad: 'Merkez', tur: 'sube' }, ts: now() })
    const defter = new S.LedgerApi({ ledger, me: alex, now })
    const ekip = new S.TeamApi({ defter, now })
    const { yerler } = ekip.places()
    assert(yerler.length === 1 && yerler[0].kisiler[0].role === 'sahip', 'kurucu sahip, ilk yerde')
    // Maya'yı çalışan olarak ekle (tören: yeni üyenin imzası aynı öneriye)
    const r = defter.addMember({ deviceCert: maya.deviceCert, displayName: 'Maya', role: 'calisan', ceremonyTranscriptHash: b4a.alloc(32, 7) })
    const mayaDefter = new S.LedgerApi({ ledger, me: maya, now })
    mayaDefter.oneriler = defter.oneriler
    assert(mayaDefter.sign(r.oneriId).durum === 'uygulandi', 'çalışan eklendi')
    const mayaId = b4a.toString(maya.memberId, 'hex')
    assert(ekip.assign(mayaId, [yerler[0].placeId]).durum === 'uygulandi', 'yere atandı')
    const c = ekip.remove(mayaId, { reason: 'işten ayrıldı' })
    assert(c.cikis.type === 0xc8, 'çıkarılan cihaza EKIP_CIKIS')
    assert(ekip.exitStatus()[0].makbuz.durum === 'bekleniyor', 'makbuz bekleniyor')
  },
  'kopru': async ({ require, assert, ornekKanal, ornekAile, geciciDizin }) => {
    const S = require('@havenfold/sdk')
    const mekan = new S.BridgeApi({ kendi: 'ekip' })
    const yuva = new S.BridgeApi({ kendi: 'aile' })
    mekan.buttons(['mekan.durum.cikis']) // kişinin ayarı, yalnız bu telefonda
    const { metin } = mekan.prepare({ type: 'mekan.durum.cikis', text: 'İşten çıktım' })
    const onizleme = yuva.receive(metin)
    assert(onizleme.text === 'İşten çıktım' && onizleme.etiket === 'is', 'Yuva Hat önizler')
    let tekrar = null
    try { yuva.receive(metin) } catch (err) { tekrar = err.message }
    assert(tekrar === 'BRIDGE_REPLAY', 'aynı paket ikinci kez')
  }
}
