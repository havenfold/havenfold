# @havenfold/worklet — telefondaki çekirdek paketi

Havenfold çekirdeğinin telefonda (Bare Worklet) çalışan hâli. Ürünlerden bağımsızdır. Ürün kendi RFC-0024 komut
sunucusunu verir; bu paket çekirdeği diskteki durumdan kurar, sunucuyu Bare Kit IPC'ye bağlar ve her komuttan sonra
durumu yazar.

| Dosya | Ne yapar |
|-------|----------|
| `persistence.js` | Kimlik, defter, replika, anahtar deposu, görülme, onaylar ve dosya deposu diske yazılır ve açılışta okunur. Kasa koleksiyonlarının anahtarları ayrı `arsiv` dosyasında, Arşiv açık anahtarıyla mühürlü (RFC-0027 §5 b). Yazım atomiktir. Bozuk, silinmiş ya da geri alınmış dosyada açılış hata koduyla durur. |
| `ipc.js` | Bare Kit IPC üstünde RFC-0024 çerçeveleri taşır. Her çerçevenin başında 4 baytlık uzunluk vardır (büyük sonlu, `node/ipc/frame.js` ile aynı). Çerçeve 1..1 MiB'tır; sınır dışı uzunlukta kanal olayı gider ve akış kapanır (RFC-0027 §5 d). Çerçeveler sıraya sokulmaz. Olaylar ve geri çağrılar aynı kanaldan gider. `baslangicBekle`: ilk çerçeveyle platform anahtarı. |
| `start.js` | `start({ urunSunucusu, dizin, anahtar, archivePubHex, sayac, sayaclar, appId, acilanDizin })`; tek örnek (`ALREADY_STARTED`); içinde aile örnekleri (RFC-0034, aşağıda). |
| `scripts/pack.sh` | Ürünün giriş dosyasından tek `app.bundle.mjs` üretir (`bare-pack` 2.2.5, `--preset mobile`). |
| `scripts/check.sh` | Node'a özel modül denetimini, Node ve Bare testlerini ve paketin Bare'de çalışıp çalışmadığını dener. |

## Kullanım (ürünün worklet girişi)

```js
/* global Bare */
const { start } = require('@havenfold/worklet')
const S = require('@havenfold/sdk')
const { komutSunucusu } = require('./sunucu')   // ürünün RFC-0024 sunucusu
const { SEMALAR } = require('./semalar')

const { ipc: { baslangicBekle, cerceveYaz } } = require('@havenfold/worklet')
// İlk IPC çerçevesi: { id, komut: 1, govde: { anahtarHex, archivePubHex, sayac } } (sır argv'ye yazılmaz)
const { id, anahtar, archivePubHex, sayac } = await baslangicBekle({ ipc: BareKit.IPC })
await start({
  dizin: argDizin,            // uygulamanın yazılabilir ve yedeğe girmeyen klasörü (iOS: Library/Application Support, Android: filesDir)
  acilanDizin: argGecici,     // RECORD_OPEN'ın { path } döndüğü geçici klasör; başlatmada, kapatışta, LOCK'ta ve 15 dk'da silinir
  appId: 'yuva-defteri',
  anahtar,                    // 32 B platform anahtarı (iOS Keychain AfterFirstUnlockThisDeviceOnly, Android Keystore); zorunlu
  archivePubHex,              // Arşiv katmanının açık anahtarı: kasa anahtarlarını mühürler; zorunlu
  sayac,                      // son 'persisted' olayındaki sayaç (platform kasasında); geri alma denetimi
  urunSunucusu: (c) => {
    let sunucu = null
    const yzKur = (n) => n.aile ? new S.AiApi({
      kayit: n.kayit, me: c.kimlik, now: c.now, semalar: SEMALAR,
      onayEkrani: (g) => sunucu.onayEkrani(g), kasaAcik: () => sunucu.kasaAcik(), onay: n.gorev.onay
    }) : null
    const n = c.nesneler
    sunucu = komutSunucusu({
      kayit: n.kayit, defter: n.defter, gorev: n.gorev, yz: yzKur(n),
      aileKur: (o) => { const y = c.aileKur(o); return { kayit: y.kayit, defter: y.defter, gorev: y.gorev, yz: yzKur(y) } }
    })
    return sunucu   // 224 UNLOCK → c.nesneler.kasa.unlock(archiveKeyHex), 19 LOCK → c.nesneler.kasa.lock()
  }
})
BareKit.IPC.write(cerceveYaz(JSON.stringify({ id, sonuc: { hazir: true } })))
```

Paketlemek için: `worklet/scripts/pack.sh <giriş> <çıktı>`. Ürün deposu `havenfold` ile aynı üst klasörde olmalıdır
(ör. `projeler/urun-uygulamasi` ve `projeler/havenfold`). Böylece pakette makinenin mutlak yolu geçmez; geçerse betik
durur. Betik `@havenfold/*` adlarını bu paketin kopyalarına çözer: `b4a`, `sodium-native` ve `bare-fs` pakette tek
kopyadır. Eklentiler `linked:` olarak kalır; uygulama bunları Yuva Hat'taki gibi `bare-link` ile bağlar.

## Cihazlar arası eşitleme (`synchronizer.js`, D34)

`start({ ag })` ile platformun ağ kancası verilirse eşitleyici kurulur. Kanca yalnız zarf taşır ve karşı ucun kimliğini
(memberId) doğrular (gerçekte HyperDHT üstünde Noise oturumu): `ag.gonder(peerHex, type, bytes)`; platform
`ag.dinle({ baglandi, koptu, al })` ile verilen işlevleri çağırır (`al(peerHex, type, bytes, yol)`, yol `dogrudan` |
`emanet` | `posta`). Eşitleyici:

- Aile içinde bağlanan uca `LEDGER_REQ` ve defteri, telefona `REC_VV`, kutuya her ortak koleksiyon için `REC_BUCKETS`
  yollar; defter büyüdükçe yeni olayları ve özetleri yeniden yollar.
- Replikanın çıkış kutusunu boşaltır: işlemler koleksiyonun çevrimiçi okuyucularına ve kutuya, anahtar ve kesimler
  alıcılarına (çevrimdışı alıcıya bellekte bekler; yeniden bağlanınca özet eksikleri zaten bulur).
- İmza toplayan önerileri (`LEDGER_PROPOSE`), teslim edilmemiş kasa paylarını (`KASA_SHARE_PUT`) yollar; eklenen dosyanın
  `BLOB_DATA`'sı kutuya gider, kayıtların andığı eksik dosya `BLOB_REQ` ile istenir. Kutu tuttuğu dosyayı `BLOB_HAVE` ile
  bildirir.
- Gelen her zarf önce `giris.gelenZarf`'tan geçer (SDK'nın kendi giriş noktası olan dosya, öneri ve kasa türleri oradan);
  giden her zarf `typeAllowed` süzgecinden. Defterden çıkarılmış ya da bekleyen kimliğe hiçbir şey gitmez, ondan gelen
  atılır (`esitleyici.reddedilen`).
- Çekirdek ailenin kutusuysa (`ADD_MEMBER` rolü `kutu`) kör emanet (`@havenfold/records` `Kutu`) `durum`'da saklanır;
  açılışta her kopyanın opId'si ve koleksiyonu baytlarından yeniden hesaplanır.

**Eşitleme durumu (D100):** `nesneler.esitleme` (`@havenfold/sdk` `SyncStatus`) bağlantı şeridinin tek kaynağıdır:
`status()` → `{ tasiyici, cevrimici, bekleyenYazim, sonEsitleme }`; değişince uygulamaya `{ olay: 'sync-status', veri }`.
`tasiyici`: taşıyıcı başlamış ve askıda değil. `cevrimici`: oturumu açık üyeler (misafir, cihaz, kutu hariç).
`bekleyenYazim`: anahtar bekleyen yazımlar + hiçbir üyeye ulaştığı teyit edilmemiş kendi işlemlerim (okuyucusu yalnız ben
olan koleksiyondaki işlem beklemez). Teyit: karşı telefonun `REC_VV`'sinde benim yazar grubum benimkiyle aynı; bunun için
işlem alan telefon gönderene güncel `REC_VV` yollar (yeni mesaj türü yok). `sonEsitleme`: bekleyen kalmadığı son teyit
anı. Bekleyenler ve son an `durum`'da saklanır. Kutuya (kör emanet) ulaşmak teyit sayılmaz. Örnek ürün `FAMILY_INFO.esitleme`.

Tören taşıyıcısı (davet sırrı, rendezvous, mühürlü JOIN_HELLO) bu pakette değil; `CeremonyApi` platformun
`torenTasiyici`'sını kullanır. Testteki kanca `test/helpers/ceremony-transport.js`. Törenle gelen defter `c.aileBagla(L)` ile
bağlanır. Çok cihazlı uçtan uca test: `test/multi-device.js` (üç ayrı süreç, boru yönlendiricisi).

## SOS alındısı (RFC-0037; D102)

Çekirdek, Tüm Aile'de görünüme giren bir `hf.sos` için kendi `hf.sos.alindi` kaydını kendisi yazar (her durum kaydında
denenir; bir kez): SOS'u gönderen kişi bu kimlik değilse, sessiz değilse, son 24 saatteyse, vakası kapalı değilse ve bu
cihazda `hf.sos`'u bildiren uygulama bu kimlikse (`start({ sosBildiren(familyIdHex) })`; verilmezse her kimlik yazar).
Uyandırma zarfı yok. Yeni geçerli alındı uygulamaya `{ olay: 'sos-received', veri: { collectionId, sos, personId } }`.
Kimliğin `hf.uygulama` kaydı `yetenek: ['sos-alindi']` bildirir. Ürün gönderen ekranını `EventApi.sosRecipients` ile kurar.

## Aynı telefonda ikinci uygulama (RFC-0017 §6.2 adım 6; D105)

Ürün sunucusu `c` üstünden (`worklet/local-pairing.js`):
- Yeni uygulama `c.nesneler.defter.pairRequest(appId)` (360) ile isteği yerel kanala bırakır; eski uygulama
  `pairApprove` (361) ile `APP_PAIR_OK`'i bırakır.
- **ESLES_KABUL** `c.eslesKabul(okBytes)` (yeni uygulama): nonce kendi isteğiyle aynı ve 5 dakikadan genç olmalı
  (`INVALID_TRANSCRIPT`), defter ve olay doğrulanır, `APP_ATTACH` bu kimlikle imzalanır, aile bağlanır.
  `{ familyId, kisiId, olay }` döner; ailesi olan örnekte `FAMILY_EXISTS`. `olay` (tam imzalı `APP_ATTACH`, hex) yerel
  kanala bırakılır: ailede kimse yeni kimliği henüz tanımadığı için olay eski uygulamanın defteri üstünden yayılır.
- **YEREL_ESITLE** `c.yerelEsitle({ olay })` (eski uygulama): olayı deftere alır, yeni kimliğe ilk paketi döner
  (`{ kimlik, paketler: [{ id, kutu }] }`; defter, ortak koleksiyonların anahtarları ve işlemleri, her biri çift sırla
  mühürlü `APP_LOCAL_SYNC`).
- Yeni uygulama paketleri `c.yerelPaketAl({ kimlik, paketler })` ile alır; kayıtlar ağ olmadan okunur.
- Kanal komut numaraları (RFC-0017 §13'teki 365, 366) RFC-0027 §1a'nın kasa komutlarıyla çakıştığı için verilmedi (İstek 184).

## Afet modu: normal yol, saklama, yükseltme (D104)

- **Saklama (RFC-0031 §8.3):** ürün `DisasterApi`'yi `saklama: c.afetSaklama()` ile kurar: afet hâli, sakla-ilet deposu,
  teslim edilmemiş kendi mesajları ve gelen kutusu şifreli durum dosyasında (toplam 4 MB) kalır, yeniden açılışta
  sıfırlanmaz; deponun bekleyen yazımı durum yazılmadan önce boşaltılır.
- **Normal yol (RFC-0031 §8.4):** `const yol = afet.setupNormalPath({ urunZarfi: c.urunZarfi, zarfGonder: c.zarfGonder })`;
  `AFET_MSG` ürün zarfıdır (kalıcı kuyruk, alıcı aktif üye telefonu). İnternet dönünce `yol.gonder()` teslim edilmemiş kendi
  mesajlarını öncelik sırasıyla (SOS önce) kuyruğa verir. Kuyrukta en çok 64 ürün zarfı vardır; doluysa `c.zarfGonder`
  `QUEUE_FULL` verir, sığmayan afet mesajı afet yolunda bekler ve sonraki `yol.gonder()` çağrısında (kuyruk boşalınca,
  ör. her `sync-status` olayında) yeniden denenir; gelen `AFET_MSG` giriş noktasından geçip `takeFromNormalPath`'a gider, aynı `mid` bağdan ve normal
  yoldan gelirse bir kez işlenir.
- **Yükseltme (RFC-0012 §6.5):** `new DisasterApi({ ..., bagCekirdegi: { yukseltmeIste(bag), yukseltmeGeldi(bag, teklif) } })`.
  Bluetooth bağında iki yönde bekleyen 20 mesaj ya da 16 KB aşılınca grup sahibi (bağı başlatmayan) `yukseltmeIste`'den
  aldığı teklifi `AFET_LINK_UP` ile yollar; başlatan `yukseltmeGeldi`'yi alır. Uygulama kendi teklifini
  `afet.upgradeOffer(bag, teklif)` ile verebilir. Wi-Fi Direct ve Multipeer platformdadır.

## Ağ taşıyıcısı, deneme sürümü (`core/transport`, D43; varsayılan kapalı)

`require('@havenfold/transport')` `DhtTasiyici({ dht, cihaz, deneysel: true })` HyperDHT üstünde aile oturumları
kurar ve `.ag` ile eşitleyicinin ağ kancasını verir; `core/transport/ceremony.js` `dhtTorenTasiyici` `CeremonyApi`'nin tören
kancasıdır. `deneysel: true` olmadan `EXPERIMENTAL_DISABLED`; paket girişi bunları içe aktarmaz. Tasarım ve açık sorular
`kollar/D-tasiyici-oneri.md` (RFC-0028 önerisi). Test `test/transport.js`: iki süreç yerel testnet üstünde tören ve
eşitleme; dış ağa bağlanmaz.

## Birden çok aile (RFC-0034; D92, D95)

Süreçte aile başına bir çekirdek örneği çalışır. Kök örnek dizinin kökündedir (bugünkü düzen); ek örnekler
`aileler/<yerelNo>/` altındadır (`yerelNo`: 16 bayt rastgele, hex; telefondan çıkmaz). Her örneğin kendi Kalici'si, SDK
nesneleri, eşitleyicisi, taşıyıcı cihazı ve ürün sunucusu vardır (`urunSunucusu(c)` örnek başına bir kez; `c.aile`).
`start({ tasiyici })` verilmişse bütün örnekler tek HyperDHT düğümünü paylaşır.

- **Çerçeve:** `{ id, komut, govde, aile? }`. `aile` yoksa tek örnekte o, birden çok örnekte `FAMILY_AMBIGUOUS`; bilinmeyen
  `yerelNo` `NO_FAMILY`. 420 `FAMILIES`, 421 `FAMILY_ADD`, 422 `JOIN_PREPARE` worklet'te işlenir, `aile` istemez ve
  sırayla yürür. Ek örneğe CREATE_FAMILY (2) `FAMILY_EXISTS`. 389 `VAULT_ARCHIVE_MOVE` (Arşiv anahtarı cihazda tek)
  birden çok örnekte `UNSUPPORTED`.
- **Olaylar:** tek örnekte bugünkü gibi. Ek örneğin her olayı `aile` taşır; birden çok örnek varken kökün olayları da
  `aile: <kökün yerelNo'su>` ve `kok: true` taşır. Geri çağrı kimliği o zaman `<yerelNo>:<JSON kimlik>` olur; cevap
  `{ cagriId }` aynı dizgiyle döner. Ortak olaylar: `families` (liste değişti), `family-error` (`{ aile, hata }`).
- **Sayaç haritası:** uygulama `persisted` olaylarından örnek başına sayaç tutar: `kok: true` ya da `aile` alanı yoksa
  `kok` anahtarına, yoksa `aile` (yerelNo) anahtarına; `sayac: null` o anahtarı siler (örnek silindi; açılışta silinen
  örneğinki bağlanınca gelir). Sonraki başlatmada `start({ sayaclar: { kok: n, <yerelNo>: n } })`. Haritada olup diskte
  olmayan ek örnek `STATE_ROLLED_BACK` ile açılmaz, `family-error` gelir, diğerleri açılır. Kökün sayacı yanlışlıkla
  `yerelNo` anahtarıyla yazılmışsa o da kökün sayacı sayılır.
- **Sınırlar:** en çok 3 aile (`FAMILY_LIMIT`), aynı anda tek katılım (`JOIN_IN_PROGRESS`), kutu, uç ya da işçi tek aile
  (`DEVICE_SINGLE_COMMUNITY`). Katılım örneği tören kapanınca ya da 10 dakikada aile bağlanmazsa silinir; yeniden açılışta
  sürmez. Telefondaki bir aileye ikinci katılım `FAMILY_EXISTS` (QR `famHint`, `JOIN_LEDGER` `familyId`).
- **Ayrılma ve silme (D93):** 423 `FAMILY_LEAVE { aile }` `LEAVE` yazar, örnek `silinecek` olur (klasörde `silinecek`
  işareti, `asama: 'bekliyor'`); `LEAVE` doğrulanmış bir oturuma yazılınca (3 sn sonra) ya da 72 saatte silinir. 424
  `FAMILY_LOCAL_REMOVE { aile }` yalnız üyeliği bitmiş, ayrılması bekleyen, bozuk, katılım ya da ailesiz ek örneği siler; yoksa
  `MEMBERSHIP_IN_PROGRESS`. Silmeli çıkarılma (`REMOVE_MEMBER wipe`) defter gelince yalnız o örneği siler. Silme sırası: işaret
  `siliniyor`, dosyalar, işaret; yarım kalan silme açılışta tamamlanır. Kök örnek silinmez, sıfırlanır (yeni ailesiz kimlik).
  Olay `family-removed { aile }` (planlanmış bildirimleri iptal için). Kök açılamazsa ve ek örnek varsa kök `family-error`
  (`aile: 'kok'`) ile durur, ekler açılır; 424 `{ aile: 'kok' }` kökü sıfırlar.
- **Yerel kanal (D93):** FAMILIES öğesinde `familyId` ve `kimlik` (`ana` | `ek`): uygulama bunları yerel kanala bırakır.
  `start({ yerelAileler: () => [{ familyId, rol } | familyId hex] })` öbür Eser uygulamalarının aileleri: 3 sınırı ve QR
  `famHint` denetimi onları da sayar; rolü `cocuk` olan aile varsa yeni aile `CHILD_IN_OTHER_APP` (RFC-0034 §4.4).
  Telefonun öbür uygulamada zaten olduğu aileye eşleşme (365) yeni aile sayılmaz. Eşleşme: `LedgerApi.pairRequest(appId, { familyId })` `APP_PAIR_REQ2` (0xEB) üretir; eski uygulama
  isteğin ailesi kendi defteri değilse `NO_FAMILY`. Bildiren uygulama aile başına: SDK `reportingApp`.
- **Çocuk ve bildirim (D94):** telefon bir örnekte çocuksa 421 ve 422, çocuk olduğu her ailede geçerli ebeveyn izni
  (`hf.aile-izni`, Tüm Aile; yazarı o ailenin ebeveyni, en çok 7 gün, tek kullanım) yoksa `FAMILY_PERMISSION_REQUIRED`. 425
  `FAMILY_PERMIT_GRANT { cocukId, saat }` (çerçevede aile; yalnız ebeveyn) izni yazar. Bildirimcinin "en çok bir kez" kümesi
  aile verilince `(aile, vaka, basamak, sira)` (`EventApi.notifier({ aile })`); aynı SOS basışı bütün ailelere aynı
  `ortakMid` ile yazılır (`EventApi.writeSos({ ortakMid })`), örnekler ortak bir `SosTekil` paylaşırsa tek bildirim gösterilir.
- **Arka plan:** Bare `suspend`/`resume` ve ön/arka plan olayları bütün örneklere birlikte; paylaşılan düğüm bir kez
  askıya alınır (örnek taşıyıcıları düğümü askıya almaz).
- Test: `test/multi-family.js` (Node ve Bare; üç süreçli testnet dahil).

## Misafir (bakıcı) kipi (D99; RFC-0019 §11.3, RFC-0030)

- **Tören:** ebeveyn `INVITE_START { tur: 'misafir', bitis? }` (varsayılan 24 saat, en çok 90 gün) ile QR gösterir; bakıcı
  `JOIN` ile okutur, iki tarafta 5 resim. Ebeveyn tarafı GRANT taslağını (`prepareCaregiver`; `Bakıcı:<ad>` koleksiyonu
  açılır) yollar, bakıcı imzalar, ebeveyn uygular (`proposeCaregiver`) ve `JOIN_LEDGER` yerine `GUEST_VIEW` yollar. Bakıcının
  telefonu görünümü doğrular ve misafir kipine geçer (`c.nesneler.misafir`: `gorunum`, `ledger`, `hlc`, `saklama`,
  `iptal`; uygulamaya `{ olay: 'guest', veri: { durum } }`). Defterde görülmüş kimlikle ikinci tören `IDENTITY_ALREADY_EXISTS`
  ile kapanır (uzatma protokolde yok).
- **Eşitleme:** bakıcı aile üyelerini arar, üye dinler (`core/transport`). Ebeveyn misafir oturumu açılınca ve defter
  değişince güncel `GUEST_VIEW`'u, misafirliği düşüren `REVOKE`'ta açık oturumdan `GUEST_REVOKED`'i yollar
  (`synchronizer.js`). Bakıcı tarafı `guest-synchronizer.js`: bırakmalar (`c.misafirGonder(GuestWriteApi.drop(…).mesaj)`)
  açık üye oturumlarına, yoksa kalıcı kuyrukta bekler.
- **Ürün:** `GuestWriteApi`'yi kendi kataloğuyla `c.nesneler.misafir`'den kurar (örnek: `example/product.js` 410–413, 440
  `CAREGIVER_LIST`, 441 `CAREGIVER_REMOVE`). Test: `test/guest.js` (iki gerçek çekirdek, yerel testnet).

## Tanıtım ailesi (`scripts/seed.js`, D35)

```sh
node worklet/scripts/seed.js <boş dizin> <ana|ek|cocuk|yetiskin|yok> --anahtar <64 hex> --arsiv <64 hex>
```

Uydurma Rivera ailesini (Alex, Maya, Lina, Rosa; kayıt düzeni Yuva Defteri'nin taklit çekirdeğindeki örnek veriden,
değerler uydurma; Tüm Aile, Ebeveynler, Kişisel, Kasa, Kalkan, Sağlık:Rosa, Kalkan:Rosa; 30 + 8 sayfa, 21 kasa kaydı, 10 dosya, 11 doz, KRA kurulumu) gerçek çekirdekte
kurar. Dizin senaryonun telefonu olur: uygulama aynı platform anahtarı ve Arşiv anahtarıyla açınca dolu görünür, kasa
kilitli başlar. Anahtarlar yalnız parametredir, dosyaya yazılmaz. Ailenin öbür kimlikleri betiğin belleğinde üretilir
ve gider (bu aile başka cihazla eşitlenemez). Veri `scripts/seed-family.js`'te; misafir (bakıcı), işçi ve asistan
konuşmaları yok.

## Diskteki biçim

- Dosyalar: `kimlik`, `hlc`, `durum`, `arsiv`, `kilit`, `dosyalar/<blobId>`.
- `durum`, `kimlik` dosyasının özetini ve her yazımda artan `sayac`'ı taşır. Biri yoksa ya da özet uymuyorsa `STATE_CORRUPT`; sayaç uygulamanın verdiğinden küçükse `STATE_ROLLED_BACK`. Worklet her yazımdan sonra `{ olay: 'persisted', veri: { sayac } }` yollar.
- `durum` tek bir anlık görüntüdür. Defter, replika, dosya dizini, görülme ve onaylar birlikte yazılır. Ayrı dosyalara yazılsaydı yarıda kalan bir kayıt defteri yeni, replikayı eski bırakabilirdi.
- Dosya önce, durum sonra yazılır.
- `hlc` her yazımda işlem gönderilmeden önce yazılır (RFC-0001 §6).
- Biçim: `"HFW1" ‖ sürüm ‖ kip ‖ gövde`.
  - Şifreli kipte gövde `nonce ‖ XChaCha20-Poly1305` olur. Platform anahtarı zorunludur (`NO_KEY`).
  - Açık kip yalnız `testKipi: true` ile (testler); gövde `hash(AD, içerik) ‖ içerik`. Telefon paketinde (`--preset mobile`,
    `#mode` → `mode-phone.js`) açık kip derleme anında kapalıdır: `testKipi` `NO_TEST_MODE`, açık dosya `STATE_MODE_MISMATCH`
    (`scripts/package-try.sh` denetler).
  - Geliştirmede açık kipte yazılmış dizin şifreli kiple açılınca bir kez taşınır: kimlik önce, `durum` en son. `durum`
    şifreliyse dizindeki her açık dosya `STATE_MODE_MISMATCH`; göç ancak `kimlik` de açıkken ve dizinde hiç şifreli dosya
    yokken başlar ya da `kimlik` önceden şifrelenmişse sürer; uygulama bir `sayac` veriyorsa (dizin önceden şifreli
    açılmıştır) göç yok. Platform anahtarı olmayan saldırgan yalnız açık dosya yazabildiği için (inceleme 13 bulgu 1).
- `arsiv` ilk parçası `"HFA2" ‖ sayaç ‖ Arşiv açık anahtarı`: eşlik ettiği `durum`'un sayacı (`durum`'da `arsivSayac`) ve
  öğelerin mühürlendiği anahtar (`"HFA1" ‖ sayaç` okunur). Başlıktaki anahtar uygulamanın verdiğinden farklıysa
  `ARCHIVE_KEY_MISMATCH` (389 `VAULT_ARCHIVE_MOVE` ile taşınmış; uygulama yeni anahtarla yeniden başlatır). Açılışta arsiv
  yoksa ya da sayacı uymuyorsa `STATE_CORRUPT` (arsiv yazılıp durum yazılamadan çökülmüşse bir sonraki sayaç kabul).
  `hlc` `durum`'daki saatten geride olamaz. Arsiv öğeleri: kasa dönem anahtarları, bekleyen kasa yazımları, kasa
  koleksiyonlarının çıkıştaki `REC_KEY`/`REC_CUTOFF`'u ve bekleyen `REC_KEY`'leri, gönderilecek pay baytları, tutulan
  paylar; öğe kimliği içeriğin özeti. Kilit açılırken önce bütün öğeler çözülür, biri bozuksa hiçbiri uygulanmaz.
- `durum`'da gizli olmayan iki dizin: tutulan payların dizini (sır, sürüm, pay özeti; kilitliyken `DUPLICATE_HOLDER` ve
  `STALE_VERSION`) ve kasa kayıtlarının dosyaları (kilitliyken `VAULT_LOCKED`).
  - AD dosya adını içerir; bu yüzden bir dosya başka bir adın yerine konamaz.
- Replika geri yüklenirken işlemler çekirdeğin kendi doğrulamasından yeniden geçer. Durum, geçerli işlemler kümesinden yeniden hesaplanır (RFC-0001 §5). Mezar, temizlenenler, verilen kesimler ve gönderilen paketler işlemlerden önce yüklenir.

## Bilinen sınırlar

- Ağ taşıyıcısı (HyperDHT, Noise, emanet, Posta Kutusu) ve tören taşıyıcısı bu pakette yok; eşitleyici bir ağ kancası
  bekler. Ağ kancası verilmezse replikanın çıkış kutusu diske yazılır ama gönderilmez.
- Eşitleyicinin bellekte beklettikleri (çevrimdışı alıcıya anahtar, kutuya yükleme) kalıcı değildir; yeniden açılışta
  özetler (`REC_VV`, `REC_BUCKETS`) eksikleri bulur, kutuya yüklenmemiş dosya ise yeniden yüklenmez.
- Çıkarılan üye çıkarıldığını öğrenmez (ona hiçbir şey gitmez); kendi kopyası telefonda kalır (silme `wipe` ile).
- Her komuttan sonra bütün durum serileştirilir; değişmediyse diske yazılmaz. Aile verisi küçük olduğu için v0'da yeterlidir (HF32).
- Dosya deposunda önbellek sınırı ve silme yok (SDK'nın `MemoryBlobStore` sınırı 64 MiB).
- Dizin kilidi Android ve Linux'ta `/proc` ile süreç canlılığını denetler; iOS'ta worklet uygulama sürecinde olduğu için başka sürecin kilidi bırakılmış sayılır.
- AiApi'nin durumu (arama dizini, kota, model) bu pakette saklanmaz; ürün kurar.
