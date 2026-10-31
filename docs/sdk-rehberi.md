# Havenfold SDK rehberi (ürün ekipleri için)

> dell, D42, 24 Ekim 2026. Bu rehber bir ürün uygulamasının (Yuva Defteri, Mekan) telefondaki çekirdeği nasıl
> kullandığını anlatır. Komut ve hata kodu tabloları elle yazılmaz: `node scripts/guide-gen.js` onları
> `protocol/vectors/channel-v4.json`'dan ve kaynaktan üretir, `scripts/check.sh` güncel olduklarını denetler.
> Her `js örnek:` bloğu `sdk/test/guide.js` ile Node'da ve Bare'de koşar; örneklerde `ornekKanal()`, `ornekAile()` ve
> `geciciDizin()` test yardımcısıdır (uygulamada sırasıyla Bare Kit IPC, gerçek aile ve uygulamanın klasörü).
> Bağlayıcı belgeler RFC'lerdir (RFC-0024 kanal, RFC-0027 ekler); bu rehber onların kullanım yüzüdür.

## 1. Yapı

Uygulama (React Native) ile çekirdek ayrı çalışır: çekirdek bir Bare Worklet'te (`@havenfold/worklet`), uygulama onunla
Bare Kit IPC üstünde RFC-0024 çerçeveleriyle konuşur. Ürünün sunucusu (`urunSunucusu`) worklet'te koşar ve komutları
SDK nesnelerine (`RecordApi`, `LedgerApi`, `VaultApi`, `ExportApi`, `CeremonyApi`, …) bağlar. Cihazlar arası eşitleme
(`synchronizer.js`) platformun ağ kancasıyla çalışır; ürün bunu görmez.

## 2. Başlatma ve el sıkışma

Worklet'in ilk IPC çerçevesi başlangıçtır (komut 1 `START`): platform anahtarı, Arşiv açık anahtarı ve son sayaç.
Sırlar argv'ye, dosyaya ya da derin bağlantıya yazılmaz. Worklet açılınca `{ id, sonuc: { hazir: true } }` döner;
açılamazsa `{ id, hata }` (`NO_KEY`, `STATE_CORRUPT`, `STATE_ROLLED_BACK`, `STATE_MODE_MISMATCH`,
`ARCHIVE_KEY_MISMATCH`, `DIR_LOCKED`, `ALREADY_STARTED` …). Her yazımdan sonra (ve bağlanınca bir kez)
`{ olay: 'persisted', veri: { sayac } }` gelir: uygulama son sayacı platform kasasında saklar, sonraki başlatmada verir
(geri alınmış dizin `STATE_ROLLED_BACK`).

```js örnek: baslatma
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
```

## 3. Platform ve Arşiv anahtarı

- **Platform anahtarı** (32 bayt): çekirdeğin dizinindeki her dosyayı şifreler (XChaCha20-Poly1305). Zorunludur.
- **Arşiv anahtar çifti**: kasa koleksiyonlarının dönem anahtarları, bekleyen kasa yazımları ve tutulan paylar Arşiv açık
  anahtarına mühürlenir (`arsiv` dosyası). Gizli anahtar biyometriyle açılan platform anahtarlığındadır; çekirdek onu
  yalnız 224 `UNLOCK` anında görür.
- **Anahtar değişimi** (cihaz değişimi, biyometri sıfırlama): 389 `VAULT_ARCHIVE_MOVE { eskiArchiveKeyHex, yeniArchivePubHex }`.
  Taşıma atomiktir; uygulama yeni anahtarı saklamadan çökerse sonraki başlatma eski açık anahtarla
  `ARCHIVE_KEY_MISMATCH` verir, uygulama yeni anahtarla yeniden başlatır.

```js örnek: arsiv-anahtari
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
```

## 4. Kanal çerçevesi

- Çerçeve: 4 bayt uzunluk öneki (büyük uçlu) ‖ UTF-8 JSON; en çok 1 MiB. Sınır dışı uzunlukta worklet
  `{ id: null, olay: 'channel', govde: { hata: 'INVALID_FRAME' } }` yollar ve akışı kapatır.
- İstek `{ id, komut, govde }` → cevap `{ id, sonuc }` ya da `{ id, hata: '<KOD>' }`.
- Baytlar `{ "$b": "<base64>" }`; kimlikler hex dizgi.
- Olay `{ olay, veri }`: `persisted` (sayaç), `core-error` (yakalanmamış çekirdek hatası), `ceremony` (tören adımları:
  `qr`, `sas`, `tamam`, `kapandi`), `task` (görev ilerlemesi ve sonucu, §11.1.1), ürün sunucusunun kendi olayları
  (ör. `kayit-degisim`).
- Geri çağrı `{ cagri, id, komutId, veri }` → `{ cagriId, sonuc }`; 1 MiB'ı aşan geri çağrının komutu `INVALID_FRAME`.

```js örnek: cerceve
const { ipc: { cerceveYaz, Ayirici } } = require('@havenfold/worklet')
const cerceve = cerceveYaz(JSON.stringify({ id: 7, komut: 241, govde: { collectionId: 'aa', recordId: 'bb' } }))
const onek = new DataView(cerceve.buffer, cerceve.byteOffset, 4).getUint32(0) // büyük uçlu
assert(onek === cerceve.byteLength - 4, 'uzunluk öneki')
const gelen = []
const ayir = new Ayirici({ tamam: (m) => gelen.push(JSON.parse(m)), gecersiz: () => gelen.push('gecersiz') })
ayir.yaz(cerceve.subarray(0, 3)) // parça parça gelebilir
ayir.yaz(cerceve.subarray(3))
assert(gelen.length === 1 && gelen[0].komut === 241)
```

## 5. Komut numaraları

Numaralar RFC-0003 §10 aralıklarındadır (`protocol/command-ranges.json`); 0–239 Yuva Hat çizelgesinin adlarıyla.
Gövde, SDK yönteminin adlandırılmış bağımsız değişkenleridir; sonuç yöntemin döndürdüğüdür (RFC-0024 §3).

<!-- KOMUTLAR:BAS (scripts/guide-gen.js üretir; elle değiştirmeyin) -->
| No | Ad | SDK yöntemi | Grup | Aralık |
|----|----|-------------|------|--------|
| 3 | `INVITE_START` | `CeremonyApi.startInvite` | kanal | Yuva Hat çizelgesi |
| 4 | `INVITE_CONFIRM` | `CeremonyApi.confirm` | kanal | Yuva Hat çizelgesi |
| 5 | `JOIN` | `CeremonyApi.join` | kanal | Yuva Hat çizelgesi |
| 14 | `LEDGER_SIGN` | `LedgerApi.sign` | kanal | Yuva Hat çizelgesi |
| 19 | `LOCK` | `VaultApi.lock` | kasa kilidi | Yuva Hat çizelgesi |
| 205 | `INVITE_CANCEL` | `CeremonyApi.cancel` | kanal | Yuva Hat çizelgesi |
| 224 | `UNLOCK` | `VaultApi.unlock` | kasa kilidi | Yuva Hat çizelgesi |
| 225 | `PROPOSALS` | `LedgerApi.listProposals` | kanal | Yuva Hat çizelgesi |
| 226 | `PROPOSAL_REJECT` | `LedgerApi.rejectProposal` | kanal | Yuva Hat çizelgesi |
| 249 | `RECORD_MOVE` | `RecordApi.move` | kanal | RFC-0001 kayıt (RFC-0024 §3) |
| 250 | `TASK_REQUEST` | `TaskApi.run` | kanal | RFC-0002 görev |
| 251 | `TASK_CANCEL` | `TaskApi.cancel` | kanal | RFC-0002 görev |
| 252 | `MACHINE` | `TaskApi.machine` | kanal | RFC-0002 görev |
| 253 | `DEVICES` | `TaskApi.devices` | kanal | RFC-0002 görev |
| 254 | `TASK_CONSENT` | `TaskApi.consent` | kanal | RFC-0002 görev |
| 255 | `STANDING_START` | `TaskApi.startStanding` | kanal | RFC-0002 görev |
| 270 | `AI_STATUS` | — | yapay zeka | RFC-0013 yapay zeka |
| 271 | `AI_ASK` | — | yapay zeka | RFC-0013 yapay zeka |
| 272 | `AI_EXTRACT` | — | yapay zeka | RFC-0013 yapay zeka |
| 273 | `AI_SAVE` | — | yapay zeka | RFC-0013 yapay zeka |
| 274 | `AI_SEARCH` | — | yapay zeka | RFC-0013 yapay zeka |
| 275 | `AI_INDEX` | — | yapay zeka | RFC-0013 yapay zeka |
| 276 | `AI_MODEL` | — | yapay zeka | RFC-0013 yapay zeka |
| 277 | `AI_EXTERNAL` | — | yapay zeka | RFC-0013 yapay zeka |
| 278 | `AI_SETTINGS` | — | yapay zeka | RFC-0013 yapay zeka |
| 279 | `AI_QUOTA` | — | yapay zeka | RFC-0013 yapay zeka |
| 280 | `TEAM_CREATE` | `TeamApi.create` | kanal | RFC-0005 ekip (280–287 TeamApi, 288–289 köprü) |
| 281 | `TEAM_ROLE` | `TeamApi.role` | kanal | RFC-0005 ekip (280–287 TeamApi, 288–289 köprü) |
| 282 | `TEAM_ASSIGN` | `TeamApi.assign` | kanal | RFC-0005 ekip (280–287 TeamApi, 288–289 köprü) |
| 283 | `TEAM_TERM` | `TeamApi.setTerm` | kanal | RFC-0005 ekip (280–287 TeamApi, 288–289 köprü) |
| 284 | `TEAM_NOTICE` | `TeamApi.privacyNotice` | kanal | RFC-0005 ekip (280–287 TeamApi, 288–289 köprü) |
| 285 | `TEAM_REMOVE` | `TeamApi.remove` | kanal | RFC-0005 ekip (280–287 TeamApi, 288–289 köprü) |
| 286 | `TEAM_EXIT_STATUS` | `TeamApi.exitStatus` | kanal | RFC-0005 ekip (280–287 TeamApi, 288–289 köprü) |
| 287 | `TEAM_PLACES` | `TeamApi.places` | kanal | RFC-0005 ekip (280–287 TeamApi, 288–289 köprü) |
| 288 | `BRIDGE_PREPARE` | `BridgeApi.prepare` | kanal | RFC-0005 ekip (280–287 TeamApi, 288–289 köprü) |
| 289 | `BRIDGE_RECEIVE` | `BridgeApi.receive` | kanal | RFC-0005 ekip (280–287 TeamApi, 288–289 köprü) |
| 350 | `PRESENCE_GET` | — | SDK ortak | RFC-0015 SDK ortak (352–359 ürün yöntemleri, RFC-0027 §1a) |
| 351 | `MEMBER_RESOLVE` | — | SDK ortak | RFC-0015 SDK ortak (352–359 ürün yöntemleri, RFC-0027 §1a) |
| 352 | `LOCAL_DRAFT` | `LocalApi.dropDraft` | kanal | RFC-0015 SDK ortak (352–359 ürün yöntemleri, RFC-0027 §1a) |
| 353 | `PERSONAL_MODE_START` | `PersonalMode.start` | kanal | RFC-0015 SDK ortak (352–359 ürün yöntemleri, RFC-0027 §1a) |
| 354 | `PERSONAL_MODE_MOVE` | `PersonalMode.move` | kanal | RFC-0015 SDK ortak (352–359 ürün yöntemleri, RFC-0027 §1a) |
| 355 | `CARE_PROCESS` | `CareDeskApi.process` | kanal | RFC-0015 SDK ortak (352–359 ürün yöntemleri, RFC-0027 §1a) |
| 356 | `CARE_MISSED` | `CareDeskApi.missed` | kanal | RFC-0015 SDK ortak (352–359 ürün yöntemleri, RFC-0027 §1a) |
| 357 | `CARE_CLAIM` | `CareDeskApi.imHandling` | kanal | RFC-0015 SDK ortak (352–359 ürün yöntemleri, RFC-0027 §1a) |
| 358 | `SHIELD_ENABLE` | `ShieldApi.enable` | kanal | RFC-0015 SDK ortak (352–359 ürün yöntemleri, RFC-0027 §1a) |
| 359 | `SHIELD_REPORT` | `ShieldApi.report` | kanal | RFC-0015 SDK ortak (352–359 ürün yöntemleri, RFC-0027 §1a) |
| 365 | `VAULT_STATUS` | `VaultApi.status` | kanal | RFC-0027 §1a kasa ürün yöntemleri |
| 366 | `VAULT_PAPER_SHARE` | `VaultApi.paperShare` | kanal | RFC-0027 §1a kasa ürün yöntemleri |
| 367 | `VAULT_PAPER_PRINTED` | `VaultApi.paperPrinted` | kanal | RFC-0027 §1a kasa ürün yöntemleri |
| 368 | `VAULT_PERSONAL` | `LedgerApi.myPersonalVault` | kanal | RFC-0027 §1a kasa ürün yöntemleri |
| 369 | `VAULT_CHILD_BACKUP` | `VaultApi.childBackup` | kanal | RFC-0027 §1a kasa ürün yöntemleri |
| 370 | `CARE_STATUS` | `CareDeskApi.status` | kanal | RFC-0027 §1a bakım, Kalkan, yerel kanal ve kalan ürün yöntemleri |
| 371 | `CARE_DOSES` | `CareDeskApi.doses` | kanal | RFC-0027 §1a bakım, Kalkan, yerel kanal ve kalan ürün yöntemleri |
| 372 | `CARE_DOSE_MARK` | `CareDeskApi.markDose` | kanal | RFC-0027 §1a bakım, Kalkan, yerel kanal ve kalan ürün yöntemleri |
| 373 | `CARE_HEALTH_SETUP` | `CareDeskApi.setupHealthCollection` | kanal | RFC-0027 §1a bakım, Kalkan, yerel kanal ve kalan ürün yöntemleri |
| 374 | `SHIELD_STATUS` | `ShieldApi.status` | kanal | RFC-0027 §1a bakım, Kalkan, yerel kanal ve kalan ürün yöntemleri |
| 375 | `SHIELD_DISABLE` | `ShieldApi.close` | kanal | RFC-0027 §1a bakım, Kalkan, yerel kanal ve kalan ürün yöntemleri |
| 376 | `SHIELD_GUARDIANS` | `ShieldApi.setGuardians` | kanal | RFC-0027 §1a bakım, Kalkan, yerel kanal ve kalan ürün yöntemleri |
| 377 | `SHIELD_INVITE_ANSWER` | `ShieldApi.answerInvite` | kanal | RFC-0027 §1a bakım, Kalkan, yerel kanal ve kalan ürün yöntemleri |
| 378 | `SHIELD_RESULT` | `ShieldApi.writeResult` | kanal | RFC-0027 §1a bakım, Kalkan, yerel kanal ve kalan ürün yöntemleri |
| 379 | `SHIELD_NOTIFICATIONS` | `ShieldApi.notifications` | kanal | RFC-0027 §1a bakım, Kalkan, yerel kanal ve kalan ürün yöntemleri |
| 380 | `SHIELD_VISIBILITY` | `ShieldApi.setVisibility` | kanal | RFC-0027 §1a bakım, Kalkan, yerel kanal ve kalan ürün yöntemleri |
| 381 | `LOCAL_MESSAGE` | `LocalApi.dropMessage` | kanal | RFC-0027 §1a bakım, Kalkan, yerel kanal ve kalan ürün yöntemleri |
| 382 | `VAULT_PENDING_CHANGES` | `LedgerApi.departed` | kanal | RFC-0027 §1a bakım, Kalkan, yerel kanal ve kalan ürün yöntemleri |
| 383 | `COLLECTION_SENSITIVITY` | `LedgerApi.setSensitivity` | kanal | RFC-0027 §1a bakım, Kalkan, yerel kanal ve kalan ürün yöntemleri |
| 384 | `AI_PLAN_EXTRACT` | `AiApi.extractPlan` | kanal | RFC-0027 §1a bakım, Kalkan, yerel kanal ve kalan ürün yöntemleri |
| 385 | `CAREGIVER_PREPARE` | `LedgerApi.prepareCaregiver` | kanal | RFC-0027 §1a bakım, Kalkan, yerel kanal ve kalan ürün yöntemleri |
| 386 | `CAREGIVER_PROPOSE` | `LedgerApi.proposeCaregiver` | kanal | RFC-0027 §1a bakım, Kalkan, yerel kanal ve kalan ürün yöntemleri |
| 387 | `VAULT_SETUP_BK` | `VaultApi.setupBackupKey` | kanal | RFC-0027 §1a bakım, Kalkan, yerel kanal ve kalan ürün yöntemleri |
| 388 | `VAULT_SETUP_VRK` | `VaultApi.setupRecoveryKey` | kanal | RFC-0027 §1a bakım, Kalkan, yerel kanal ve kalan ürün yöntemleri |
| 389 | `VAULT_ARCHIVE_MOVE` | `VaultApi.moveArchive` | kanal | RFC-0027 §1a bakım, Kalkan, yerel kanal ve kalan ürün yöntemleri |
| 390 | `EXPORT` | `ExportApi.export` | kanal | RFC-0027 §2 kap ve dışa aktarma |
| 391 | `IMPORT` | `ExportApi.import` | kanal | RFC-0027 §2 kap ve dışa aktarma |
| 400 | `VAULT_RECOVERY_START` | `VaultApi.startRecovery` | kanal | RFC-0027 §1a kasa kurtarma ve döndürme (RFC-0004 §5–§6, D67; 405 tabloda) |
| 401 | `VAULT_RECOVERY_SHARE` | `VaultApi.recoveryShare` | kanal | RFC-0027 §1a kasa kurtarma ve döndürme (RFC-0004 §5–§6, D67; 405 tabloda) |
| 402 | `VAULT_RECOVERY_FINISH` | `VaultApi.finishRecovery` | kanal | RFC-0027 §1a kasa kurtarma ve döndürme (RFC-0004 §5–§6, D67; 405 tabloda) |
| 403 | `VAULT_ROTATE` | `VaultApi.rotateVault` | kanal | RFC-0027 §1a kasa kurtarma ve döndürme (RFC-0004 §5–§6, D67; 405 tabloda) |
| 404 | `VAULT_RECOVERY_STATUS` | `VaultApi.recoveryStatus` | kanal | RFC-0027 §1a kasa kurtarma ve döndürme (RFC-0004 §5–§6, D67; 405 tabloda) |
| 405 | `VAULT_SHARE_APPROVE` | `VaultApi.approveShare` | kanal | RFC-0027 §1a kasa kurtarma ve döndürme (RFC-0004 §5–§6, D67; 405 tabloda) |
| 410 | `CAREGIVER_WRITE_GRANT` | `LedgerApi.grantCaregiverWrite` | kanal | RFC-0030 misafirin sınırlı yazması (410–413, 414–419 ayrılmış) |
| 411 | `GUEST_PERMISSIONS` | `GuestWriteApi.permissions` | kanal | RFC-0030 misafirin sınırlı yazması (410–413, 414–419 ayrılmış) |
| 412 | `GUEST_DROP` | `GuestWriteApi.drop` | kanal | RFC-0030 misafirin sınırlı yazması (410–413, 414–419 ayrılmış) |
| 413 | `GUEST_MY_WRITES` | `GuestWriteApi.myWrites` | kanal | RFC-0030 misafirin sınırlı yazması (410–413, 414–419 ayrılmış) |
| 420 | `FAMILIES` | `worklet` | aile örnekleri | RFC-0034 bir telefonda birden çok aile (420–422; 423–425 D93–D94; 426–429 ayrılmış) |
| 421 | `FAMILY_ADD` | `worklet` | aile örnekleri | RFC-0034 bir telefonda birden çok aile (420–422; 423–425 D93–D94; 426–429 ayrılmış) |
| 422 | `JOIN_PREPARE` | `worklet` | aile örnekleri | RFC-0034 bir telefonda birden çok aile (420–422; 423–425 D93–D94; 426–429 ayrılmış) |
| 423 | `FAMILY_LEAVE` | `worklet` | aile örnekleri | RFC-0034 bir telefonda birden çok aile (420–422; 423–425 D93–D94; 426–429 ayrılmış) |
| 424 | `FAMILY_LOCAL_REMOVE` | `worklet` | aile örnekleri | RFC-0034 bir telefonda birden çok aile (420–422; 423–425 D93–D94; 426–429 ayrılmış) |
| 425 | `FAMILY_PERMIT_GRANT` | `worklet` | aile örnekleri | RFC-0034 bir telefonda birden çok aile (420–422; 423–425 D93–D94; 426–429 ayrılmış) |
| 430 | `BEING_ADD` | `LedgerApi.addBeing` | varlık | RFC-0003 §5.4 defter: varlık (430 BEING_ADD, 431 BEING_REMOVE; 432–439 ayrılmış) |
| 431 | `BEING_REMOVE` | `LedgerApi.removeBeing` | varlık | RFC-0003 §5.4 defter: varlık (430 BEING_ADD, 431 BEING_REMOVE; 432–439 ayrılmış) |
| 440 | `CAREGIVER_LIST` | `LedgerApi.caregivers` | bakıcı | RFC-0003 §5.5 defter: bakıcı (440 CAREGIVER_LIST, 441 CAREGIVER_REMOVE; 442–449 ayrılmış) |
| 441 | `CAREGIVER_REMOVE` | `LedgerApi.removeCaregiver` | bakıcı | RFC-0003 §5.5 defter: bakıcı (440 CAREGIVER_LIST, 441 CAREGIVER_REMOVE; 442–449 ayrılmış) |
<!-- KOMUTLAR:SON -->

RFC-0024'ün kayıt (240–248) ve defter (2, 13, 200, 201) komutları ürün sunucusundadır; SDK'nın `RecordApi` ve
`LedgerApi` yöntemlerine bağlanır.

## 6. Kasa kilidi

Kasa duyarlılıklı koleksiyonlar telefonda kilitli başlar. 224 `UNLOCK { archiveKeyHex }` açar, 19 `LOCK` kapatır,
5 dakika işlemsizlik kendiliğinden kilitler. Kilitliyken kasa koleksiyonunda okuma, yazma, geçmiş ve kasa kaydındaki
dosyayı açma `VAULT_LOCKED`. Uygulama arka plana geçince (60 sn) LOCK yollar. Kasa kurulumu: 388 `VAULT_SETUP_VRK`
(koleksiyon yoksa kurulur; iki ebeveynde öneri olur), 387 `VAULT_SETUP_BK` (sır bayt olarak, `{ sir: { $b } }`).

```js örnek: kasa-kilidi
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
```

## 7. Kap: dışa aktarma ve içe alma (390, 391)

Tek seferlik ve açık onaylıdır (biyometri ürünün akışında). Kişiler görünen adla yazılır, iç kimlikler dışarı çıkmaz;
yapay zekanın doldurduğu alanlar kayıt düzeyinde işaretlenir. Gizli alanlar (ürünün şeması, `gizliAlanlar` kancası)
yalnız istenirse yazılır; kanca verilmezse `NO_EXPORT_SECRET_HOOK`. Telefonda kap akışla yazılır: `yaz` kancası şifreli
parçaları dosyaya verir, bellekte bütün kap tutulmaz (D41). 390'ın sonucu IPC çerçevesine sığmayabilir: ürün sunucusu
dosyaya yazıp yolunu döner.

```js örnek: kap
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
```

## 8. Taşıma (249 `RECORD_MOVE`)

Kayıt başka koleksiyona yapay zeka alanları korunarak taşınır (yeni kayıt, eskisi silinir); kasa kaynaklı kayıt yalnız
kasaya. Gövde `{ collectionId, recordId, hedefCollectionId, degisiklik? }` → yeni `recordId`.

```js örnek: tasima
const { kayit, TA, bakici } = ornekAile()
const rid = kayit.put(TA, null, 'yuva.defter.wifi', { baslik: 'Misafir ağı', sifre: 'misafir-2026' })
const yeni = kayit.move(TA, rid, bakici, { baslik: 'Misafir ağı (bakıcı)' })
assert(kayit.get(TA, rid) === null, 'eskisi silindi')
const k = kayit.get(bakici, yeni)
assert(k.fields.baslik === 'Misafir ağı (bakıcı)' && k.fields._src[0] === 'kayit:' + TA + '/' + rid, 'kaynağa başvuru')
```

## 9. Pay teslimi (0xF1 `KASA_SHARE_PUT`, 0xF2 `KASA_SHARE_ACK`)

Kasa kurulumunda başkalarına düşen paylar `VaultApi.outgoing()` ile listelenir ve eşitleyici sahibine doğrudan oturumda
ya da emanetle yollar (Posta Kutusu yasak: `MAILBOX_FORBIDDEN`). Sahip payı alınca (önce diske, kutuda TPM mühürlü
dosyaya yazar) alındı döner; gönderen `teslim` olarak işaretler. Ürün bu akışı görmez; durum `365 VAULT_STATUS`'da.

```js örnek: pay-teslimi
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
```

### 9.1 Kurtarma ve döndürme (400–405, RFC-0004 §5–§6)

Telefon kaybolunca yeni telefon kasayı paylardan kurtarır. `400 VAULT_RECOVERY_START` ailenin etkin kimliklerine sürüm
sorar (0x9E); payı tutan ve soranı yetkili bulan (YA'da sırrın sahibi, KRA'da kasanın okuyucusu) sürümle cevap verir
(0x9F), yeni telefon o sürümün payını imzalı ister (0x9B). Sürüm cevabı yalnız sorulan ve pay tutabilecek kimlikten, pay
yalnız istenen tutucudan alınır; tutucu başına bir pay. Kutu ve TPM'li işçi denetimler geçince sormadan verir; telefon
kullanıcıya sorar: `404 VAULT_RECOVERY_STATUS`'un `istekler`'inde görünür (aynı istekçi ve sürüm için tek istek, 10 dakika),
`405 VAULT_SHARE_APPROVE` yalnız kasa açıkken (biyometriyle `224 UNLOCK`; kilitliyse `VAULT_LOCKED`) payı gönderir (0x9C;
RFC-0027 §9 a). Cihaz değişiminden gelen istekçi 72 saat bekletilir; bu sürede pay dağıtamaz da (`ON_HOLD`), tutucular
ilk gördükleri anda `security-alert` olayıyla `rotate_pending_share` uyarısı verir. Kâğıt pay `401 VAULT_RECOVERY_SHARE` ile okutulur.
`402 VAULT_RECOVERY_FINISH` payları birleştirir: YA platforma döner (`sirHex`); KRA kanala çıkmaz, verilen zarfları ve kasa
koleksiyonundaki `hf.kasa.zarf` kayıtlarını açar, dönem anahtarları replikaya girer (kasa açık olmalı). Bilinen daha yeni
sürüm varken eski sürümle kurtarma `STALE_VERSION` (§9 f). Hemen ardından `403 VAULT_ROTATE`: yeni sır, sürüm görülen en
büyük sürümden bir fazla, paylar bugünkü sahiplere; tutucular eski sürümü siler, eski kâğıt `STALE_VERSION` olur. Döndürmek
için eski sır bilinmeli: YA bu telefonda kurulmuş ya da kurtarılmış, KRA kurtarılmış, bu telefonda saklı ya da kasa açık
olmalı. İki okuyucu aynı anda döndürürse `commit`'i küçük dağıtım kazanır; kaybeden geri çeker (`365`'te
`kurulu.kaybetti`, `vault` olayı `dondurme_geri_cekildi`; §9 e). KRA'yı bilen telefon kasa açıkken her dönem
değişiminde zarfı yeniden yazar (`365`'te `zarf { version, envSeq, sonDonem, donem, kutu }`; §9 b). Ailede kutu varsa
zarfın opak kopyası kutuya da gider (0xF3/0xF4); KRA'yı kurtaran telefon 402'de kopyayı KRA'dan türetilen etiketle
kutudan ister (0xF5/0xF6), gelince dönem anahtarları replikaya girer (`404`'te `kutuZarfi`, §9 g). Kutusu olmayan ailede
hiçbir zarf okunamıyorsa 402 `NO_ENVELOPE`: ürün kurulumda kutusuz ailede tam felaketin kurtarılamayacağını söyler. LOCK kurtarılan sırrı,
toplanan payları ve gönderilmemiş onaylı payları siler. Zarfları eşitleyici taşır (`recoveryOutgoing`); ürün yalnız
komutları ve durumu görür.

```js örnek: kasa-kurtarma
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
```

## 10. Ekip (280–287, RFC-0005)

Mekan gibi işletme ürünleri `TeamApi` ile çalışır. `TeamApi.create` (280) ekibi kurar: `GENESIS`, `KIND ekip` (kurucu
sahip olur), düzey, ekip politikası (en çok 32 kişi), ilk yer, kurucunun ataması ve varsayılan koleksiyonlar (Ekip,
Yönetim, Kasa, `Yer:<ad>`, `Olaylar:<ad>`, Paylaşımlar). Yazımlar `LedgerApi` üstündendir: yeter sayı eksikse sonuç
`{ durum: 'oneri', oneriId, waitingFor }` olur, `waitingFor` yalnız sahip ve yöneticileri sayar; diğerleri `sign()` ile
ekler. Geçiciye geçişte süre zorunludur (`TERM_REQUIRED`) ve en çok 90 gün sonrası (`TERM_LIMIT`). Çıkarma (285)
uygulanınca çıkarılan cihaza gidecek `EKIP_CIKIS` (0xC8) döner; o cihaz `receiveExit` ile olayı kendi kopyasıyla doğrular, iş
kapsamını siler ve makbuz (0xC9) verir; yönetim `receiveReceipt` ile alır, `exitStatus` (286) "geldi / bekleniyor / gelmedi"
gösterir. İkisi de ağ zarfı giriş noktasıdır (`giris.gelenZarf`).

```js örnek: ekip
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
```

## 11. Kişisel köprü (288, 289, RFC-0005 §15)

Aynı telefonda hem ekipte (Mekan Hat) hem ailede (Yuva Hat) olan kişi, yalnız kendi yazdığı kendi durumunu öbür uygulamaya
elle geçirebilir: ekipten aileye `mekan.durum.*`, aileden ekibe `yuva.durum.*`. Otomatik akış yok: düğmeler varsayılan
kapalıdır (`BRIDGE_DISABLED`), kişi açar; alan uygulama `receive` (289) ile önizler, kişi onaylarsa kendi mesajı olarak gönderir.
Paket iş verisi, ad, işletme ve yer taşımaz; metin en çok 280 bayt, aynı paket 7 gün içinde ikinci kez `BRIDGE_REPLAY`.
Taşıma işletim sisteminin aynı geliştiricinin uygulamaları arasındaki yoludur (RFC-0027 §7): gönderen yalnız kendi yön
klasörüne yazar (`kanal.birak(metin)`), alan yalnız karşı yönden okur ve `receive(metin, { kaynak, uygulama, sil })` ile
yazan uygulamayı platformdan verir (paketteki `from` uyuşmazsa `BRIDGE_SOURCE`); başarıyla alınan paket `sil` ile kanaldan
silinir. Paket geçmişe 7 gün, ileriye 5 dakika içinde olmalı (`BRIDGE_STALE`, `BRIDGE_AHEAD`). Paket derin bağlantıya,
panoya ya da bildirime yazılmaz. Ekipten ayrılınca `BridgeApi.close()` düğmeleri kapatır, gönderilmemiş paketleri siler
(`TeamApi`'ye `kopru` verilirse kendisi çağırır).

```js örnek: kopru
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
```

## 11.1 Aile Kutusu ekleme (RFC-0007 §9, RFC-0028 §7 d, j; D76)

Aile Kutusu ekransız bir Linux makinesidir (TPM 2.0); kurulum `node/deploy/havenfold-install-sudo.sh` ile yapılır
(RFC-0007 §8.6 "Var olan Ubuntu"). Telefon tarafında "Cihaz ekle → Aile Kutusu" akışı:

1. **Taşıyıcı (tek ayar).** Uygulama çekirdeği `start({ ..., tasiyici: { deneysel: true, ad, cihazAdi } })` ile
   başlatır. Çekirdek uygulamaya ait HyperDHT düğümünü (önyükleme: `@havenfold/transport` `bootstrap.json`), ağ
   kancasını ve tören taşıyıcısını kendisi kurar; `ag` ve `torenTasiyici` ayrıca verilmez. Bayrak verilmezse taşıyıcı
   kapalıdır; `deneysel: true` olmadan `EXPERIMENTAL_DISABLED`. Kutu her zaman dinler, telefon kutuyu arar.
2. **QR.** Kutuda `havenfold katil --rol kutu` QR'ı terminale çizer ve `~/havenfold-katil.png` olarak yazar (en çok 10
   dakika; tek QR 180 sn, süresi dolunca yenisi). Telefon QR'ı okutur: `5 JOIN { kod }` → `{ tur: 'kutu' }` (kutu QR'ında
   telefon aile tarafıdır; yetki: ebeveyn, `CeremonyApi._aileTarafi`). Ailede zaten kutu varsa defter `BOX_LIMIT` der.
3. **5 resim.** Telefonda `ceremony { adim: 'sas', resimler }` (0–63 dizinleri); kutu aynı resimlerin adlarını metin
   olarak yazar (`node/sas-names.json`, Yuva Hat `sas-listesi` ile aynı sıra). Kişi karşılaştırır ve
   `4 INVITE_CONFIRM { ayni: true }` der (biyometri platformda; "Farklı" derse tören kapanır).
4. **Defter.** Telefon davet edenin imzalı `ADD_MEMBER(kutu)`'yu gönderir (`TOREN.KUTU`), kutu imzalar, telefon uygular
   ve defteri kutuya verir. Tören anahtarı iki tarafta çift sırrına girer (RFC-0028 §7 c). Ebeveynin tek imzası yeter
   (kutu eklemek `NO_PARENT_SIGNATURE` dışında yeter sayı istemez).
5. **Sonrası.** Kutu ailenin kayıtlarını kör emanette tutar (çevrimdışı telefon kutudan eşitlenir), kasa dağıtımında
   cihaz payı alır (`uygunCihaz`), kasa zarfının opak kopyasını tutar. Kutunun durumu: `havenfold durum` (TPM, taşıyıcı,
   aile, depolama).

Kök parmak izi denetimi (RFC-0007 §9 adım 9: `NODE_HEALTH.software.rootFp` resmî listeyle karşılaştırılır) bu sürümde
yok: kutu çekirdeği henüz `NODE_HEALTH` göndermiyor (İstek 151). Uçtan uca test: `worklet/test/d76-box.js` (gerçek kutu
süreci `node/box.js` ve telefon, yerel testnet).

## 11.1.1 İşçi ekleme (RFC-0002, RFC-0003 §5.1, RFC-0007 §9 adım 8)

İşçi (Ev Makinesi) evdeki eski bir Linux makinesidir; OCR gibi görevleri çalıştırır. Kurulum USB'si ya da var olan
Ubuntu'da `havenfold ilk-ayar --rol isci` kimliği üretir (kutuyla aynı kalıcı katman, TPM varsa mühürlü). Telefon
tarafında "Cihaz ekle → Ev Makinesi" akışı Aile Kutusu'nunkiyle aynıdır, defter olayı farklıdır:

1. **Taşıyıcı.** `start({ ..., tasiyici: { deneysel: true } })` taşıyıcıyı ailedeki işçilerle de açar (telefon arar,
   işçi dinler; `tasiyici.cihazlar: false` kapatır). Defterde aktif cihaz yoksa etkisi yoktur.
2. **QR.** İşçide `havenfold katil --rol isci` QR'ı terminale ve `~/havenfold-katil.png`'ye yazar. Telefon okutur:
   `5 JOIN { kod }` → `{ tur: 'cihaz' }` (yetki: ebeveyn).
3. **5 resim.** Telefonda `ceremony { adim: 'sas', resimler, karsiAd }`, işçide aynı resimlerin adları; ebeveyn
   `4 INVITE_CONFIRM { ayni: true }` der.
4. **Defter.** Telefon `DEVICE_ATTACH { class: 'isci' }` taslağını imzalar (`TOREN.CIHAZ`), işçi kendi imzasını ekler,
   telefon uygular ve defteri işçiye verir. Tören anahtarı iki tarafta çift sırrına girer. Sonra işçinin defteri
   eşitleyiciyle (LEDGER_REQ / LEDGER_EVENTS) güncel kalır; işçiyle kayıt eşitlemesi yoktur.
5. **Görev.** İşçi bağlanınca imzalı `NODE_CAPS` gönderir; çekirdek onu `TaskApi`'nin yetenek defterine koyar
   (`TaskApi.devices()`, `machine()`). Kanal komutları (RFC-0002 Ek: RFC-0033 §9 s; `protocol/vectors/channel-task.json`):
   `252 MACHINE {}` → Ev Makinesi kartı, `253 DEVICES {}` → cihaz listesi, `254 TASK_CONSENT { deviceId, allow }` ilk
   kullanım onayı, `250 TASK_REQUEST { type, version, inputs, params, opts }` → `{ id, yer: 'isci', taskIds }` (aday
   yoksa `{ yer: null, hata: 'NO_ELIGIBLE_DEVICE' }`), `251 TASK_CANCEL { id }`, `255 STANDING_START { type, version,
   deviceId, params, opts }` → `{ id, taskId }`. `params` bayt ya da JSON nesnesidir (UTF-8 JSON olarak gider);
   `opts`: `collectionId`, `ramMB`, `minutes`, `deadline`, `diskMB`, `telefondaYapilabilir` (kanalda bölme yok).
   İlerleme ve sonuç `task` olayıyla gelir: `{ id, tur: 'progress', pct, note }`, `{ id, tur: 'result', status,
   inline, outputs, log }` (`status`: `ok`, `hata`, `iptal`, `sure`), `{ id, tur: 'hata', hata }`. Sunucu tarafı
   `@havenfold/worklet`'in `taskChannel(c)`'sidir; ürün sunucusu `isleyiciler`'ini kendi komutlarına katar,
   `olaylariBagla(gonder)`'ı kendi olay bağlamasında çağırır (`worklet/example/product.js`). Zaman aşımı ve yeniden deneme
   (`TaskApi.tick`) çekirdekte 5 saniyede bir yürür; ürün sunucusu zamanlamaz. Girdi dosyası
   `RecordApi.attach` (245) ile eklenmiş olmalı: işçi onu `BLOB_REQ` ile telefondan çeker. İşçi işe başlayınca
   `TASK_PROGRESS { pct: 0, note: 'basladi' }` gönderir (telefonda `task` olayı, `tur: 'progress'`); gördüğü
   taskId'leri diske yazar, yeniden başlasa da aynı görevi ikinci kez çalıştırmaz (`REPLAY`).

Uçtan uca test: `node/test/task-network.js` (worklet telefon çekirdeği ve örnek ürün sunucusu, uygulama tarafı yalnız kanal
komutları ve `task` olayı; paketteki işçi süreci, sahte podman; yerel testnet).

## 11.2 Çevrimiçi ve son görülme (350 `PRESENCE_GET`; D77)

`LedgerApi.presence(memberId)` → `{ lastSeenMs, via: 'dogrudan' | 'emanet' | 'yok', online }`. `online`, kişinin (ya da
kutunun) herhangi bir kimliğiyle şu an açık doğrudan oturum varsa doğrudur. Oturumu telefondaki çekirdek bilir:
taşıyıcı (ya da platformun ağ kancası) oturum açılınca eşitleyiciye `baglandi(peer, { caps })`, kapanınca `koptu(peer)`
der; çekirdek bunları görülme kaydına ve karşının HELLO.caps değerine (HIDE_PRESENCE, RFC-0019 §11.7 a) yazar. Kendi ağ
kancasını veren platform `caps`'i de vermelidir; vermezse üye gizli sayılmaz. Her açılış ve kapanışta `LedgerApi`
`'presence'` olayı `{ memberId, online }` yayar: uygulamanın Aile ekranı bu olayla `PRESENCE_GET`'i yeniden okur. Yerel
kanal (aynı telefondaki uygulamalar) çevrimiçi bilgisine girmez: aynı kişidir.

## 11.3 Bakıcının sınırlı yazması (RFC-0030; D78)

Bakıcı (misafir) ailenin koleksiyonunu okumaz; ebeveynin izin verdiği koleksiyona, izinli tür ve özne için mühürlü olay
**bırakır**. Düzey 2.3 ister (`HELLO.caps` `MISAFIR_YAZAR = 16384`; herkes bildirince `LedgerApi.raiseLevel('2.3')`).

- **Ebeveyn telefonu.** Koleksiyonda bırakma anahtarı yoksa önce `LedgerApi.openDropKey(collectionId)`; dönen
  `birakma.secret` aynı telefonun replikasına verilir (`kayit.r.addDropSecret(birakma.collectionId, birakma.secret)`).
  Sonra `LedgerApi.grantCaregiverWrite({ grantId, collectionId, types, subjects })` (olay 36 `GRANT_WRITE`). Kurallar:
  koleksiyon normal ve kişisel değil (`NOT_COLLECTION_ELIGIBLE`), anahtar var (`NO_DROP_KEY`), en çok 16 ürün
  türü (`yuva.`, `mekan.`; `hf.` olmaz), 1–8 özne (`uye:`, `varlik:`, `yer:`), bir bakıcıya en çok 2 koleksiyon
  (`GUEST_LIMIT`). `types: []` izni kaldırır; `REVOKE` bütün izinleri bitirir. İzinler: `caregiverWriteGrants(grantId)`
  ve `familyInfo().misafirler[].yazma`.
- **Bakıcının telefonu.** `new GuestWriteApi({ kimlik, gorunum, katalog, saklama })`: `gorunum` kabul edilen
  `GUEST_VIEW`'dir (`drops` alanı izinleri ve güncel anahtarı taşır; yenisi gelince `updateView`). `permissions()`,
  `drop(collectionId, tur, { subj, t?, ...alanlar })` → `{ opId, recordId, mesaj }`; `mesaj` (`REC_OPS`, yalnız
  bırakma öğesi) ailenin telefonlarına gönderilir. "Senin yazdıkların": `myDrops({ collectionId?, limit? })` (tam kayıt) ve komut 413'ün biçimiyle `myWrites({ collectionId? })`,
  olay `dropped`. İzinsiz tür, özne, dosya eki ya da 4 KB'tan büyük olay gönderilmeden reddedilir (`TYPE_NOT_ALLOWED`,
  `SUBJECT_NOT_ALLOWED`, `EXTRA_FORBIDDEN`, `DROP_TOO_LARGE`, izin yoksa `NOT_PERMITTED`).
- **Ailenin telefonları.** Bakıcının olayı koleksiyondaki diğer olaylar gibi rutine ve kurala girer; `EventApi.query`
  sonucunda `yazar: 'misafir'`. Bakıcı vaka sahiplenemez ve kapatamaz, olay düzeltemez, kart ve kural yazamaz.

Uçtan uca test: `sdk/test/d78.js`.

## 12. Hata kodları

Kanal cevabındaki `hata` alanı bu kodlardan biridir; çekirdek başka bir şey fırlatırsa `INTERNAL_ERROR`. Tablo kaynaktaki
`fail('…')` ve `hata('…')` çağrılarından üretilir (paket ve dosya). Anlamları kodu üreten RFC'de ve kaynağın yorumunda.

<!-- HATALAR:BAS (scripts/guide-gen.js üretir; elle değiştirmeyin) -->
| Kod | Kaynak |
|-----|--------|
| `ABROAD_CONSENT_REQUIRED` | sdk/service.js |
| `AI_APPROVAL_REQUIRED` | sdk/api.js, sdk/local.js |
| `ALREADY_EXISTS` | sdk/care.js |
| `ALREADY_IN_FAMILY` | sdk/ceremony.js |
| `ALREADY_MOVED` | sdk/local.js |
| `ALREADY_STARTED` | worklet/start.js |
| `APPROVAL_EXISTS` | sdk/service.js |
| `APPROVAL_EXPIRED` | core/ai/extraction.js, sdk/ai.js |
| `APPROVAL_MISMATCH` | core/ai/extraction.js |
| `ARCHIVE_KEY_MISMATCH` | worklet/persistence.js |
| `ARCHIVE_LOCKED` | worklet/persistence.js |
| `ARCHIVE_MOVED_STATE_WRITE_FAILED` | worklet/persistence.js |
| `BEING_LIMIT` | core/core/ledger/team.js, core/core/ledger/v21.js |
| `BODY_AMBIGUOUS` | core/ai/assistant.js |
| `BODY_CORRUPT` | core/services/package.js |
| `BOX_CANNOT_VOTE` | core/core/ledger/ledger.js |
| `BOX_LIMIT` | core/core/ledger/quorum.js, core/core/ledger/team.js |
| `BOX_REQUIRED` | core/core/ledger/team.js |
| `BRIDGE_AHEAD` | core/core/protocol/bridge.js |
| `BRIDGE_DIRECTION` | core/core/protocol/bridge.js |
| `BRIDGE_DISABLED` | sdk/bridge.js |
| `BRIDGE_REPLAY` | core/core/protocol/bridge.js |
| `BRIDGE_SOURCE` | core/core/protocol/bridge.js |
| `BRIDGE_STALE` | core/core/protocol/bridge.js |
| `BRIDGE_TEXT` | core/core/protocol/bridge.js |
| `BRIDGE_TYPE` | core/core/protocol/bridge.js, sdk/bridge.js |
| `BRIDGE_VERSION` | core/core/protocol/bridge.js |
| `CANNOT_ASSIGN_TASK` | sdk/api.js |
| `CANNOT_REPLACE` | core/core/ledger/v22.js |
| `CAPS_REQUIRED` | sdk/common.js |
| `CARD_CORRUPT` | core/services/card.js |
| `CARD_COUNT` | core/edge/screen.js |
| `CARD_STALE` | core/services/card.js |
| `CEREMONY_IN_PROGRESS` | sdk/ceremony.js |
| `CERTIFICATE_INTERNAL_INCONSISTENT` | core/core/protocol/hello.js |
| `CERTIFICATE_MISMATCH` | core/core/protocol/hello.js |
| `CHAIN_BROKEN` | core/core/ledger/ledger.js, core/core/ledger/sync.js |
| `CHANGE_DROPPED` | core/core/ledger/quorum.js, core/core/ledger/team.js, core/core/ledger/v22.js |
| `CHILD_IN_OTHER_APP` | worklet/start.js |
| `CHILD_PERSONAL` | core/services/approval.js |
| `CHUNK_LIMIT` | core/tasks/coordinator.js |
| `CHUNK_MISSING` | core/core/protocol/retirement.js |
| `CHUNK_TOO_LARGE` | core/core/crypto/kdf.js |
| `CLOSED` | sdk/api.js |
| `COLLECTION_LIMIT` | core/core/ledger/v21.js |
| `COLLECTION_OPEN_FAILED` | sdk/care.js |
| `COLLECTION_REQUIRED` | sdk/api.js, sdk/export.js |
| `CONSENT_TEXT_REQUIRED` | sdk/service.js |
| `CORRUPT_LEDGER` | core/core/ledger/sync.js |
| `COUNTER_EXHAUSTED` | core/edge/frame.js |
| `DAILY_LIMIT` | sdk/ai.js |
| `DECRYPT_FAILED` | core/records/operation.js, core/records/replica.js |
| `DELETED` | sdk/edge.js |
| `DEVICE_CANNOT_VOTE` | core/core/ledger/ledger.js |
| `DEVICE_LIMIT` | core/core/ledger/team.js, core/core/ledger/v21.js |
| `DEVICE_SINGLE_COMMUNITY` | worklet/start.js |
| `DEVICE_WRITER_FORBIDDEN` | core/core/ledger/v21.js |
| `DIRECT_ONLY` | core/core/messaging/seal.js, core/core/protocol/ingress.js |
| `DIR_LOCKED` | worklet/persistence.js |
| `DISASTER_ALERT_TYPE` | sdk/disaster.js |
| `DISASTER_CANNOT_SEND` | core/disaster/engine.js |
| `DISASTER_CAPS` | core/disaster/local.js |
| `DISASTER_CORRUPT` | core/disaster/engine.js, core/disaster/local.js, core/disaster/message.js |
| `DISASTER_FIELD_ALARM` | sdk/disaster.js |
| `DISASTER_HELLO_` | core/disaster/local.js |
| `DISASTER_HELLO_CORRUPT` | core/disaster/local.js |
| `DISASTER_HELLO_TIMEOUT` | core/disaster/local.js |
| `DISASTER_LABEL` | core/disaster/local.js |
| `DISASTER_LENGTH` | core/disaster/message.js |
| `DISASTER_LIMIT` | core/disaster/message.js |
| `DISASTER_NOISE` | core/disaster/local.js |
| `DISASTER_NOT_IN_FAMILY` | core/disaster/engine.js |
| `DISASTER_PORT` | core/disaster/local.js |
| `DISASTER_TARGET` | sdk/disaster.js |
| `DISASTER_TYPE_FORBIDDEN` | core/disaster/local.js |
| `DROP_TOO_LARGE` | core/records/guest.js |
| `DUPLICATE_HOLDER` | core/vault/delivery.js, core/vault/share.js, sdk/vault.js |
| `DUPLICATE_RECEIPT` | core/core/protocol/team-exit.js, sdk/team.js |
| `DUPLICATE_SIGNATURE` | core/core/ledger/ledger.js |
| `ENVELOPE_EMPTY` | core/vault/envelope.js |
| `ENVELOPE_OPEN_FAILED` | core/vault/envelope.js |
| `ERASE_REQUIRED` | core/ai/search-index.js |
| `ERASURE_INCOMPLETE` | worklet/start.js |
| `EXPERIMENTAL_DISABLED` | core/transport/ceremony.js, core/transport/transport.js, worklet/start.js |
| `EXPIRED` | core/core/protocol/guest-view.js |
| `EXPORT_EXCESS` | core/export/export.js |
| `EXPORT_MEMORY` | core/export/export.js |
| `EXPORT_PARAMETER` | core/export/export.js |
| `EXPORT_TRUNCATED` | core/export/export.js |
| `EXPORT_VERSION` | core/export/export.js |
| `EXTRA_FORBIDDEN` | core/records/guest.js |
| `FAMILY_AMBIGUOUS` | worklet/start.js |
| `FAMILY_EXISTS` | worklet/local-pairing.js, worklet/persistence.js, worklet/start.js |
| `FAMILY_LIMIT` | worklet/start.js |
| `FAMILY_MISMATCH` | core/core/protocol/hello.js, core/services/preview.js |
| `FAMILY_NAME_MISMATCH` | core/transport/ceremony.js |
| `FAMILY_PERMISSION_REQUIRED` | worklet/start.js |
| `FAMILY_SETUP_FAILED` | worklet/start.js |
| `FIELD_LIMIT` | core/records/replica.js |
| `FILE_TOO_LARGE` | core/records/file.js |
| `FORMAT_MISMATCH` | sdk/export.js |
| `FRAME_DECODE_FAILED` | core/edge/frame.js |
| `FRAME_TOO_LARGE` | core/transport/ceremony.js, core/transport/transport.js |
| `FRAME_TOO_SHORT` | core/edge/frame.js |
| `FRAME_TYPE` | core/edge/frame.js |
| `FRAME_VERSION` | core/edge/frame.js |
| `GENESIS_ERROR` | core/core/ledger/ledger.js, core/core/ledger/quorum.js |
| `GOREV_YOK` | core/tasks/audit.js |
| `GUARDIAN_COUNT` | sdk/shield.js |
| `GUEST_ACCESS_ENDED` | worklet/guest-synchronizer.js |
| `GUEST_CANNOT_WRITE` | core/core/ledger/v21.js, core/records/guest.js |
| `GUEST_FORBIDDEN` | core/core/ledger/v21.js |
| `GUEST_LIMIT` | core/core/ledger/team.js, core/core/ledger/v21.js, core/core/ledger/v23.js |
| `IDENTITY_ALREADY_EXISTS` | core/core/ledger/ledger.js, core/transport/ceremony.js |
| `IDENTITY_IN_PACKAGE` | core/services/package.js |
| `IDENTITY_MISMATCH` | worklet/persistence.js |
| `IMZA_GECERSIZ` | core/tasks/audit.js, core/tasks/capability.js |
| `INDEX_CORRUPT` | core/ai/embedding.js, core/ai/search-index.js, core/services/card.js |
| `INDEX_EPOCH` | core/ai/embedding.js |
| `INDEX_OPEN_FAILED` | core/vault/backup.js |
| `INDEX_STALE` | core/services/card.js, sdk/service.js |
| `INITIATOR_SENDS` | sdk/service.js |
| `INSUFFICIENT_SHARE` | core/vault/share.js, sdk/vault.js |
| `INVALID_APPROVAL_TOKEN` | sdk/ai.js |
| `INVALID_ARCHIVE` | core/export/archive.js |
| `INVALID_BASE45` | core/core/protocol/retirement.js |
| `INVALID_BLOCK` | core/ai/search-index.js |
| `INVALID_BODY` | core/core/ledger/team.js, core/core/ledger/v21.js, core/core/ledger/v23.js, core/core/protocol/caps.js, core/core/protocol/retirement.js, core/edge/config.js, core/tasks/coordinator.js, sdk/api.js, sdk/guest.js, sdk/team.js, sdk/vault.js, worklet/channel-json.js, worklet/guest-synchronizer.js, worklet/local-pairing.js, worklet/start.js, worklet/task-channel.js |
| `INVALID_BOOTSTRAP` | core/transport/network.js |
| `INVALID_BRIDGE` | core/core/ledger/quorum.js, core/core/ledger/team.js, core/core/protocol/bridge.js, sdk/bridge.js |
| `INVALID_CEREMONY` | core/transport/ceremony.js |
| `INVALID_CERTIFICATE` | core/core/ledger/ledger.js, core/core/protocol/local-channel.js |
| `INVALID_CHANNEL` | core/core/protocol/ingress.js |
| `INVALID_CLASS` | core/ai/block-filter.js, core/ai/capability.js, sdk/ai.js |
| `INVALID_CLOSE` | core/core/ledger/v21.js |
| `INVALID_COVERAGE` | core/services/approval.js |
| `INVALID_DAY` | sdk/care.js |
| `INVALID_DIRECTION` | core/edge/frame.js |
| `INVALID_DISASTER_KIND` | sdk/disaster.js |
| `INVALID_DISASTER_SETTINGS` | sdk/disaster.js |
| `INVALID_DISASTER_TYPE` | core/disaster/message.js |
| `INVALID_DIVISION` | core/tasks/placement.js |
| `INVALID_DURATION` | core/services/approval.js, core/services/package.js, core/transport/ceremony.js |
| `INVALID_EMBEDDING` | core/ai/embedding.js |
| `INVALID_ENVELOPE` | core/vault/box-envelope.js, core/vault/envelope.js |
| `INVALID_EVENT` | sdk/local.js |
| `INVALID_EXPORT` | core/export/export.js |
| `INVALID_EXTRA_FIELD` | sdk/ai.js |
| `INVALID_FIELD` | core/ai/extraction.js, core/services/package.js |
| `INVALID_FIELD_NAME` | core/records/encoding.js |
| `INVALID_FIELD_VALUE` | core/events/case.js, core/events/event.js, core/records/fields.js, sdk/guest.js |
| `INVALID_FILE` | core/records/file.js, sdk/api.js |
| `INVALID_FRAME` | worklet/ipc.js |
| `INVALID_GROUNDING` | core/ai/extraction.js |
| `INVALID_GUARDIAN` | sdk/shield.js |
| `INVALID_INDEX` | core/vault/backup.js |
| `INVALID_INPUT` | core/ai/plan.js, sdk/ai.js, sdk/export.js, sdk/shield.js |
| `INVALID_JOB` | core/ai/capability.js |
| `INVALID_KEY` | core/records/key.js, core/services/package.js, core/services/reply.js, sdk/vault.js, worklet/persistence.js, worklet/start.js |
| `INVALID_LIMIT` | core/ai/assistant.js |
| `INVALID_LIST` | core/records/cutoff.js |
| `INVALID_MEMBER` | core/core/ledger/v21.js, sdk/care.js, sdk/vault.js |
| `INVALID_MESSAGE` | core/core/protocol/ingress.js, core/core/protocol/join-hello.js, core/core/protocol/local-channel.js, core/core/protocol/messages.js, core/core/protocol/recovery.js, core/core/protocol/team-exit.js, core/edge/encoding.js, core/edge/screen.js, core/events/envelope.js, core/records/cutoff.js, core/records/file.js, core/records/sync.js, core/tasks/encoding.js, core/vault/delivery.js, core/vault/request.js, sdk/api.js, sdk/edge.js |
| `INVALID_MODEL` | core/ai/embedding.js |
| `INVALID_NAME` | worklet/persistence.js |
| `INVALID_OPERATION` | core/records/encoding.js, sdk/ai.js |
| `INVALID_OPERATION_TYPE` | core/records/replica.js |
| `INVALID_OPTION` | sdk/ai.js |
| `INVALID_ORDER` | core/tasks/delivery.js |
| `INVALID_PAIR` | core/edge/frame.js |
| `INVALID_PAPER` | core/vault/share.js |
| `INVALID_PATH` | core/ai/assistant.js, core/ai/extraction.js |
| `INVALID_PLACE` | core/ai/search-index.js |
| `INVALID_PLATFORM` | core/ai/capability.js |
| `INVALID_POLICY` | core/core/ledger/policy.js, core/core/ledger/quorum.js, core/core/ledger/team.js |
| `INVALID_PREFIX` | core/ai/embedding.js |
| `INVALID_QR` | core/core/protocol/retirement.js, core/services/card.js, core/transport/ceremony.js, sdk/ceremony.js |
| `INVALID_QUESTION` | core/ai/assistant.js |
| `INVALID_RECEIPT` | core/core/protocol/team-exit.js |
| `INVALID_RECEIVER` | worklet/synchronizer.js |
| `INVALID_REPORT` | core/core/protocol/retirement.js |
| `INVALID_ROLE` | core/core/ledger/quorum.js, core/core/ledger/team.js, sdk/ceremony.js, sdk/team.js |
| `INVALID_ROOT` | core/vault/request.js |
| `INVALID_RULE` | sdk/api.js |
| `INVALID_SCHEMA` | core/ai/extraction.js |
| `INVALID_SECRET` | core/vault/share.js, sdk/vault.js |
| `INVALID_SENSOR` | core/edge/sensor.js |
| `INVALID_SETTINGS` | core/ai/assistant.js, sdk/ai.js |
| `INVALID_SHARE` | core/vault/share.js, sdk/vault.js |
| `INVALID_SIGNATURE` | core/core/ledger/ledger.js, core/core/protocol/guest-view.js, core/core/protocol/retirement.js, core/core/protocol/team-exit.js, core/edge/erasure.js, core/edge/profile.js, core/edge/screen.js, core/edge/status.js, core/records/file.js, core/records/key.js, core/services/card.js, core/services/package.js, core/services/preview.js, core/services/reply.js, core/vault/box-envelope.js, core/vault/envelope.js, worklet/synchronizer.js |
| `INVALID_SOURCE` | core/ai/extraction.js, core/events/case.js, sdk/ai.js |
| `INVALID_STATUS` | sdk/care.js |
| `INVALID_SUMMARY` | core/services/approval.js |
| `INVALID_TARGET` | core/edge/config.js, core/edge/edge.js, sdk/local.js |
| `INVALID_TEXT` | core/ai/block-filter.js, core/ai/text.js, sdk/local.js |
| `INVALID_THRESHOLD` | core/vault/share.js |
| `INVALID_TIME` | sdk/care.js |
| `INVALID_TRANSCRIPT` | core/core/ledger/quorum.js, core/core/ledger/team.js, core/core/ledger/v21.js, core/core/ledger/v22.js |
| `INVALID_TYPE` | core/events/type.js, core/transport/ceremony.js, sdk/ceremony.js, sdk/local.js, sdk/vault.js |
| `INVALID_VALUE` | core/edge/sensor.js, core/export/archive.js, core/records/encoding.js, core/records/hlc.js, sdk/common.js, worklet/persistence.js |
| `INVALID_VECTOR` | core/ai/crisis-semantic.js, core/ai/search-index.js |
| `INVALID_VIEW` | core/core/protocol/guest-view.js |
| `INVALID_ZIP` | core/export/zip.js |
| `INVALID_ZIP_NAME` | core/export/archive.js, core/export/zip.js |
| `INVITE_ER_PENDING` | sdk/api.js |
| `INVITE_EXPIRED` | core/core/protocol/guest-view.js |
| `IN_GUEST_MODE` | worklet/persistence.js |
| `JOIN_IN_PROGRESS` | worklet/start.js |
| `KEY_CHUNK` | core/events/event.js |
| `KEY_UNAUTHORIZED` | core/records/key.js, core/records/replica.js |
| `KIND_ERROR` | core/core/ledger/team.js, core/core/ledger/v21.js |
| `KOLEKSIYON_KAPALI` | core/tasks/request.js |
| `LAST_OWNER` | core/core/ledger/team.js |
| `LAST_PARENT` | core/core/ledger/quorum.js |
| `LEAVE_ERROR` | core/core/ledger/quorum.js, core/core/ledger/team.js |
| `LEAVE_NOT_APPLIED` | worklet/start.js |
| `LEDGER_BEHIND` | core/edge/config.js, sdk/common.js |
| `LEDGER_FORK` | core/core/protocol/team-exit.js |
| `LEVEL_CANNOT_DOWNGRADE` | core/core/ledger/v21.js |
| `LEVEL_TOO_LOW` | core/core/ledger/ledger.js |
| `LINK_ALREADY_EXISTS` | core/core/ledger/quorum.js, core/core/ledger/team.js |
| `MAILBOX_FORBIDDEN` | core/core/protocol/ingress.js |
| `MEMBERSHIP_IN_PROGRESS` | worklet/start.js |
| `MEMBER_LIMIT` | core/core/ledger/quorum.js, core/core/ledger/team.js |
| `MIXED_IDENTITY` | core/core/protocol/hello.js |
| `MIXED_OWNER` | sdk/service.js |
| `MIXED_SOURCE` | core/services/approval.js |
| `MODE_MISMATCH` | core/core/ledger/quorum.js, core/core/ledger/v22.js |
| `NAME_REQUIRED` | sdk/api.js, sdk/team.js |
| `NONCE_REPLAY` | core/services/reply.js |
| `NOTICE_MISSING` | core/core/ledger/team.js, sdk/team.js |
| `NOT_CHILD` | sdk/vault.js, worklet/start.js |
| `NOT_COLLECTION_ELIGIBLE` | core/core/ledger/team.js, core/core/ledger/v21.js, core/core/ledger/v23.js, core/tasks/standing.js |
| `NOT_EDGE` | sdk/edge.js |
| `NOT_GUEST` | worklet/guest-synchronizer.js, worklet/persistence.js |
| `NOT_INITIATOR` | sdk/service.js |
| `NOT_MEMBER` | core/core/protocol/hello.js |
| `NOT_MODE_SCREEN` | core/edge/screen.js, sdk/edge.js |
| `NOT_MODE_SENSOR` | core/edge/edge.js |
| `NOT_PERMITTED` | core/records/guest.js, sdk/guest.js |
| `NOT_PRIMARY_IDENTITY` | core/core/protocol/local-channel.js |
| `NOT_SERVICE_ELIGIBLE` | core/services/card.js, sdk/service.js |
| `NOT_SHARE_OWNER_ELIGIBLE` | core/vault/threshold.js |
| `NOT_SIGNER` | core/core/protocol/guest-view.js, sdk/service.js |
| `NOT_TARGET_TEMPORARY` | core/core/ledger/team.js |
| `NOT_WAITING` | core/core/ledger/quorum.js, core/core/ledger/team.js, sdk/api.js |
| `NOT_WORKER` | sdk/api.js |
| `NOT_WRITER` | sdk/care.js |
| `NOT_WRITER_READER` | core/core/ledger/v21.js |
| `NO_ALERT_APPROVAL` | sdk/edge.js |
| `NO_APPROVAL` | core/ai/extraction.js, core/core/protocol/local-channel.js, core/services/approval.js, core/tasks/coordinator.js, core/tasks/request.js, sdk/service.js |
| `NO_APPROVAL_SCREEN` | sdk/ai.js |
| `NO_ARCHIVE` | sdk/vault.js |
| `NO_CASE` | sdk/care.js |
| `NO_CEREMONY` | sdk/ceremony.js |
| `NO_CHANGE` | sdk/api.js |
| `NO_COLLECTION` | core/events/engine.js, core/records/replica.js, core/services/approval.js, core/vault/threshold.js, sdk/ai.js, sdk/api.js, sdk/export.js, sdk/local.js, sdk/vault.js, worklet/start.js |
| `NO_CONFIG` | sdk/edge.js |
| `NO_DELIVERY` | sdk/service.js |
| `NO_DHT` | core/transport/transport.js |
| `NO_DIR` | core/vault/backup.js, worklet/persistence.js |
| `NO_DISASTER_PAIR` | core/disaster/engine.js, sdk/disaster.js |
| `NO_DISASTER_RECEIVER` | sdk/disaster.js |
| `NO_DISPLAY` | core/ai/extraction.js |
| `NO_DRAFT` | sdk/service.js |
| `NO_DROP_KEY` | core/core/ledger/v23.js |
| `NO_DROP_PERMISSION` | core/edge/edge.js, core/edge/sensor.js |
| `NO_ELIGIBLE_DEVICE` | sdk/ai.js |
| `NO_EMBEDDING` | core/ai/crisis-semantic.js, core/ai/embedding.js |
| `NO_ENVELOPE` | sdk/vault.js |
| `NO_EPOCH` | core/records/replica.js |
| `NO_EXPORT_SECRET_HOOK` | sdk/export.js |
| `NO_EXTERNAL_APPROVAL` | sdk/ai.js |
| `NO_FAMILY` | core/core/protocol/local-channel.js, sdk/api.js, sdk/local.js, worklet/local-pairing.js, worklet/start.js |
| `NO_FILE` | sdk/api.js |
| `NO_FILE_READ` | sdk/api.js |
| `NO_GATEWAY` | sdk/ai.js |
| `NO_IDENTITY` | sdk/api.js, sdk/ceremony.js, sdk/team.js, worklet/task-channel.js |
| `NO_INVITE_ER_SIGNATURE` | core/core/ledger/quorum.js, core/core/ledger/team.js |
| `NO_INVITE_PERMISSION` | core/core/ledger/team.js |
| `NO_IN_TEAM_PERSONAL` | core/core/ledger/v21.js |
| `NO_IPC` | worklet/ipc.js, worklet/start.js |
| `NO_KEY` | core/records/replica.js, worklet/persistence.js |
| `NO_KEY_VERSION` | core/services/package.js |
| `NO_LEDGER` | sdk/care.js, sdk/team.js, sdk/vault.js |
| `NO_LEVEL` | sdk/local.js |
| `NO_LINK` | core/core/ledger/quorum.js, core/core/ledger/team.js |
| `NO_MANAGEMENT_SIGNATURE` | core/core/ledger/team.js |
| `NO_MEMBER` | sdk/api.js, worklet/local-pairing.js |
| `NO_MEMBERSHIP` | worklet/start.js |
| `NO_MODEL` | sdk/ai.js |
| `NO_NETWORK` | worklet/start.js, worklet/synchronizer.js |
| `NO_NEW_DEVICE_APPROVAL` | core/core/ledger/team.js, core/core/ledger/v21.js |
| `NO_NEW_MEMBER_APPROVAL` | core/core/ledger/quorum.js, core/core/ledger/team.js, core/core/ledger/v22.js |
| `NO_OLD_KEY` | sdk/vault.js |
| `NO_OWNER` | core/services/reply.js |
| `NO_OWNER_APPROVAL` | core/core/ledger/team.js, core/core/ledger/v21.js |
| `NO_OWNER_SIGNATURE` | core/core/ledger/team.js, core/core/ledger/v21.js |
| `NO_PACKAGE` | sdk/service.js |
| `NO_PAIR` | sdk/edge.js |
| `NO_PAPER` | sdk/vault.js |
| `NO_PARENT_APPROVAL` | core/core/ledger/quorum.js, core/core/ledger/v21.js |
| `NO_PARENT_READER` | core/core/ledger/team.js, core/core/ledger/v21.js |
| `NO_PARENT_SIGNATURE` | core/core/ledger/quorum.js, core/core/ledger/v21.js, core/core/ledger/v23.js |
| `NO_PERMISSION` | core/records/replica.js, core/services/approval.js, core/services/reply.js, sdk/service.js |
| `NO_PERSON` | core/core/ledger/v22.js |
| `NO_PERSONAL` | core/services/approval.js |
| `NO_PERSON_APPROVAL` | core/core/ledger/v22.js |
| `NO_PLACE` | core/core/ledger/team.js, core/core/ledger/v21.js, sdk/team.js |
| `NO_PRESENCE` | sdk/api.js |
| `NO_PRODUCT_SERVER` | worklet/start.js |
| `NO_PROPOSAL` | core/core/ledger/proposals.js, sdk/api.js |
| `NO_READER_APPROVAL` | core/core/ledger/v21.js |
| `NO_READER_CHECK` | core/vault/envelope.js |
| `NO_RECORD` | core/events/receipt.js, sdk/ai.js, sdk/api.js, sdk/care.js, sdk/local.js, sdk/service.js, sdk/shield.js |
| `NO_RECOVERY` | sdk/vault.js |
| `NO_REPORT` | core/core/protocol/retirement.js |
| `NO_REQUIRED_FIELD` | core/ai/extraction.js |
| `NO_ROUTINE` | sdk/api.js |
| `NO_SCHEMA` | core/ai/plan.js, sdk/ai.js |
| `NO_SEAL_TYPE` | core/core/messaging/seal.js |
| `NO_SERVICE` | core/services/card.js, sdk/service.js |
| `NO_SHARE` | sdk/service.js |
| `NO_SHARES` | core/services/approval.js |
| `NO_SHIELD` | sdk/shield.js |
| `NO_SIGNATURE` | core/core/ledger/ledger.js |
| `NO_START` | worklet/ipc.js |
| `NO_STREAM` | core/edge/edge.js, sdk/edge.js |
| `NO_TARGET` | core/core/ledger/quorum.js, core/core/ledger/team.js, core/core/ledger/v21.js, core/core/ledger/v22.js, core/core/ledger/v23.js, core/core/protocol/guest-view.js, core/tasks/coordinator.js, core/tasks/standing.js, sdk/api.js, sdk/service.js, sdk/team.js |
| `NO_TASK` | sdk/api.js |
| `NO_TEST_MODE` | worklet/persistence.js |
| `NO_TYPE` | core/events/event.js, core/records/replica.js, sdk/api.js |
| `NO_WITNESS` | core/core/ledger/team.js |
| `ON_HOLD` | core/vault/delivery.js |
| `ON_PLATFORM` | sdk/ai.js |
| `OPERATION_TOO_LARGE` | core/records/box.js, core/records/encoding.js, core/records/operation.js, core/records/replica.js |
| `ORDER_ERROR` | core/core/ledger/ledger.js, core/core/ledger/sync.js |
| `OUT_OF_GROUP` | core/core/protocol/local-channel.js, worklet/local-pairing.js |
| `OUT_OF_SCOPE` | core/core/ledger/team.js, core/core/ledger/v21.js, core/core/protocol/team-exit.js |
| `OUT_OF_WINDOW` | core/edge/edge.js |
| `OWNER_LIMIT` | core/core/ledger/team.js |
| `PACKAGE_MISMATCH` | core/services/reply.js |
| `PACKAGE_OPEN_FAILED` | core/services/package.js |
| `PAIRING_EVENT` | core/core/protocol/local-channel.js, worklet/local-pairing.js |
| `PAIRING_EXPIRED` | core/core/protocol/local-channel.js |
| `PAIRING_NONCE` | core/core/protocol/local-channel.js |
| `PAIRING_STATUS` | core/core/protocol/local-channel.js, sdk/api.js |
| `PAIR_SECRET_REQUIRED` | sdk/edge.js |
| `PAPER_CHECKSUM` | core/vault/share.js |
| `PAPER_LIMIT` | core/vault/threshold.js |
| `PARENT_LIMIT` | core/core/ledger/quorum.js |
| `PARENT_REQUIRED` | sdk/api.js, worklet/start.js |
| `PASSWORD_TOO_SHORT` | core/export/export.js, sdk/export.js |
| `PATH_FORBIDDEN` | core/tasks/delivery.js |
| `PENDING_CHANGE` | core/core/ledger/quorum.js, core/core/ledger/team.js, core/core/ledger/v22.js |
| `PENDING_MEMBER` | core/core/ledger/ledger.js, core/core/ledger/quorum.js, core/core/ledger/team.js |
| `PERSONAL_COLLECTION` | core/core/ledger/v21.js |
| `PERSONAL_MODE_DISABLED` | sdk/local.js |
| `PLACE_ALREADY_EXISTS` | sdk/team.js |
| `PLACE_BOX_LIMIT` | core/core/ledger/team.js |
| `PLACE_DEVICE_LIMIT` | core/core/ledger/team.js |
| `PLACE_LIMIT` | core/core/ledger/team.js, core/core/ledger/v21.js |
| `PLACE_REQUIRED` | core/core/ledger/team.js |
| `PLAN_PRODUCT` | core/core/ledger/quorum.js, core/core/ledger/team.js |
| `PLAN_SIGNER` | core/core/ledger/quorum.js, core/core/ledger/team.js |
| `PREKEY_IDENTITY` | core/core/ledger/quorum.js |
| `PREKEY_OWNER` | core/core/ledger/quorum.js |
| `PREKEY_SIGNATURE` | core/core/ledger/quorum.js |
| `PREKEY_SIGNER` | core/core/ledger/quorum.js |
| `PREKEY_STALE` | core/core/ledger/quorum.js |
| `PREVIEW_CORRUPT` | core/services/preview.js |
| `PREVIEW_EXISTS` | sdk/service.js |
| `PREVIEW_UNNEEDED` | sdk/service.js |
| `PROPOSAL_EXPIRED` | core/core/ledger/proposals.js |
| `PROPOSAL_NOT_ALLOWED` | sdk/api.js |
| `QR_EXPIRY_EXPIRED` | core/transport/ceremony.js |
| `QR_TYPE` | sdk/ceremony.js |
| `QR_VERSION` | core/transport/ceremony.js, sdk/ceremony.js |
| `QUEUE_FULL` | worklet/synchronizer.js |
| `RANDOM_PATCH_NOT_APPLIED` | core/vault/random.js |
| `RANDOM_SOURCE_CORRUPT` | core/vault/random.js |
| `RECORD_REQUIRED` | sdk/service.js |
| `REFERENCE_REQUIRED` | core/ai/assistant.js, sdk/ai.js |
| `REMOTE_WAITING` | core/core/ledger/quorum.js, core/core/ledger/team.js |
| `REMOVAL_NOT_REQUESTED` | sdk/edge.js |
| `REPLAY` | core/edge/frame.js |
| `REPLY_CORRUPT` | core/services/reply.js |
| `REPLY_LIMIT` | core/services/reply.js |
| `REPLY_OPEN_FAILED` | core/services/reply.js |
| `REPORT_COUNT_MISMATCH` | core/core/protocol/retirement.js |
| `REPORT_KEY_MISMATCH` | core/core/protocol/retirement.js |
| `RESERVED_FIELD` | core/events/event.js, core/records/fields.js, sdk/api.js |
| `ROOT_CORRUPT` | worklet/start.js |
| `ROTATION_LOST` | core/vault/delivery.js |
| `SCHEMA_MISMATCH` | core/ai/extraction.js |
| `SECONDARY_IDENTITY_CANNOT_JOIN` | sdk/ceremony.js |
| `SECONDARY_IDENTITY_CANNOT_VOTE` | core/core/ledger/ledger.js |
| `SECONDARY_IDENTITY_LIMIT` | core/core/ledger/v22.js |
| `SENDER_MISMATCH` | core/services/preview.js |
| `SENSOR_DISABLED` | core/edge/edge.js |
| `SERVICE_MISMATCH` | core/services/approval.js, core/services/card.js, core/services/package.js |
| `SETUP_INCOMPLETE` | sdk/team.js |
| `SHIELD_DISABLED` | sdk/shield.js |
| `SHIELD_ENABLED` | sdk/shield.js |
| `SIGNATURE_ERROR` | core/core/protocol/hello.js |
| `SIZE_MISMATCH` | core/ai/crisis-semantic.js, core/ai/embedding.js, core/ai/search-index.js |
| `SIZE_OVERRUN` | core/services/package.js, core/services/reply.js |
| `SOURCE_MISMATCH` | sdk/service.js |
| `SOURCE_NOT_ALLOWED` | core/edge/screen.js, sdk/edge.js |
| `SOURCE_REQUIRED` | core/services/approval.js |
| `STALE_CARD` | core/edge/edge.js |
| `STALE_ENVELOPE` | core/vault/box-envelope.js |
| `STALE_MANIFEST` | core/edge/profile.js, core/edge/status.js, core/tasks/capability.js |
| `STALE_VERSION` | core/vault/box-envelope.js, core/vault/request.js, sdk/vault.js |
| `STATE_CLOSED` | worklet/persistence.js |
| `STATE_CORRUPT` | worklet/persistence.js |
| `STATE_MODE_MISMATCH` | worklet/persistence.js |
| `STATE_ROLLED_BACK` | worklet/persistence.js, worklet/start.js |
| `STATE_STORE_REQUIRED` | core/vault/request.js |
| `STATE_VERSION` | worklet/persistence.js |
| `STATUS_NOT_PUBLISHED` | core/edge/edge.js, sdk/edge.js |
| `STORAGE_REQUIRED` | core/edge/edge.js, sdk/service.js |
| `SUBJECT_NOT_ALLOWED` | core/records/guest.js |
| `SUMMARY_MISMATCH` | core/services/approval.js, sdk/service.js |
| `SUMMARY_REQUIRED` | sdk/service.js |
| `SURE_GECERSIZ` | core/tasks/coordinator.js, core/tasks/request.js |
| `TARGET_CANNOT_SELF_VOTE` | core/core/ledger/quorum.js, core/core/ledger/team.js |
| `TARGET_NOT_ME` | core/core/protocol/team-exit.js |
| `TEAM_ONLY` | core/core/ledger/quorum.js, sdk/team.js |
| `TEMPORARY_CANNOT_VOTE` | core/core/ledger/ledger.js |
| `TERM_EXPIRED` | core/services/approval.js |
| `TERM_LIMIT` | core/core/ledger/team.js, sdk/api.js, sdk/team.js |
| `TERM_REQUIRED` | sdk/team.js |
| `THRESHOLD_TOO_LOW` | core/ai/extraction.js |
| `TOO_LARGE` | core/edge/screen.js |
| `TRANSPORT_TWICE` | worklet/start.js |
| `TUR_IZNI_YOK` | core/tasks/request.js |
| `TYPE_CANNOT_CHANGE` | core/records/replica.js |
| `TYPE_IMMUTABLE` | core/core/ledger/v21.js |
| `TYPE_MISMATCH` | sdk/api.js |
| `TYPE_NAME_FIELD` | core/events/type.js |
| `TYPE_NOT_ALLOWED` | core/core/protocol/ingress.js, core/records/guest.js, worklet/synchronizer.js |
| `U64_OUT_OF_RANGE` | core/core/crypto/kdf.js |
| `UNAUTHORIZED` | core/core/protocol/team-exit.js, core/edge/config.js, core/edge/erasure.js, core/edge/profile.js, core/edge/screen.js, core/edge/status.js, core/records/box.js, core/records/file.js, core/records/replica.js, core/services/preview.js, core/vault/box-envelope.js, core/vault/delivery.js, core/vault/envelope.js, sdk/ai.js, sdk/ceremony.js, sdk/common.js, sdk/edge.js, sdk/service.js, sdk/team.js, sdk/vault.js |
| `UNKNOWN_EVENT` | core/core/ledger/encoding.js, core/core/ledger/quorum.js, core/core/ledger/team.js, core/core/ledger/v21.js, core/core/ledger/v22.js, core/core/ledger/v23.js |
| `UNKNOWN_FIELD` | core/core/protocol/messages.js |
| `UNKNOWN_MEMBER` | core/core/ledger/ledger.js |
| `UNKNOWN_SIGNER` | core/core/ledger/ledger.js |
| `UNSUPPORTED` | worklet/start.js |
| `UPDATE_PENDING` | sdk/api.js |
| `UPDATE_REQUIRED` | core/core/protocol/join-hello.js, core/transport/ceremony.js |
| `VALUE_TOO_LARGE` | worklet/persistence.js |
| `VAULT_LOCKED` | sdk/vault.js |
| `VAULT_RULE` | core/core/ledger/v21.js |
| `VAULT_SOURCE` | core/ai/extraction.js, sdk/ai.js, sdk/api.js |
| `VERSION` | core/core/protocol/hello.js |
| `VERSION_REQUIRED` | core/vault/share.js |
| `VERSION_UNKNOWN` | sdk/vault.js |
| `VERSION_UNSUPPORTED` | core/core/ledger/ledger.js, core/records/encoding.js |
| `VIEW_NOT_FOR_CEREMONY` | worklet/persistence.js |
| `VIEW_STALE` | core/core/protocol/guest-view.js |
| `WAITING_IN_PROGRESS` | sdk/api.js |
| `WEAK_KEY` | core/core/crypto/pair.js, core/transport/ceremony.js |
| `WRITE_STOPPED` | worklet/persistence.js |
| `WRONG_EDGE` | core/edge/config.js, core/edge/screen.js, sdk/edge.js |
| `WRONG_HOLDER` | core/vault/delivery.js |
| `WRONG_LOCK_KEY` | sdk/vault.js, worklet/persistence.js |
| `YETKISIZ` | core/tasks/audit.js, core/tasks/capability.js, core/tasks/coordinator.js |
| `ZIP_CHECKSUM` | core/export/zip.js |
| `ZIP_COMPRESSION` | core/export/zip.js |
| `ZIP_ENCRYPTED` | core/export/zip.js |
| `ZIP_TOO_LARGE` | core/export/export.js, core/export/zip.js |
<!-- HATALAR:SON -->
