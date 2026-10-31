# RFC-0017 — Aynı ailede birden çok uygulama: kişinin ek kimlikleri

> Durum: **Onaylandı** (Kerem, 23 Ekim 2026) · 23 Ekim 2026 · Yazan: Havenfold çekirdek ekibi · Onay: Kerem
> Karar kaynağı: Kerem, 23 Ekim 2026 — "Yuva Defteri ayrı uygulama olsun; amaç daha çok insana ulaşmak." Ürün kararı onaylıdır; bu taslak protokol ayrıntısını onaya getirir.
> Kurucu belge: §1, §2, §3, §4, §6, §7, §8.2, §10, §13.1, §14.1, §15.1, §15.2, §16.2, §19, §20, §22 (HF22'nin yerine geçer). Bağımlılık: RFC-0001, 0002, 0003, 0004, 0005, 0006, 0013, 0015.
> Kod yeri: `havenfold/core` (defter v2.2), `havenfold/sdk`.

## 1. Sorun

Kurucu belge (HF22) Yuva Defteri'ni Yuva Hat'ın içinde bir sekme yaptı. Bu kararın bedeli şu: mesajlaşmayı kullanmayan biri Yuva Defteri'ni kullanamıyor. Ürünlerin daha çok insana ulaşması için her ürün kendi başına kurulabilen ayrı bir uygulama olmalı.

Ama bugünkü defterde **bir üye = bir cihaz kimliği**. Aynı telefonda iki EserX uygulaması kurulursa:

- ikisi de aileye ayrı ayrı katılır;
- aynı insan kişi sınırını (ailede 8, ekipte 32) iki kez doldurur;
- aynı kişi iki kez oy verir;
- aynı kişiye iki kez kasa payı verilir.

## 2. Öneri özeti

1. **Her EserX uygulaması kendi başına çalışır.** Havenfold çekirdeğini içinde taşır. Diğer uygulama olmadan aile kurabilir ve aileye katılabilir.
2. **Kişi ve kimlik ayrılır.** Bir kişinin bir **ana kimliği** ve en çok 4 **ek kimliği** olabilir. Ek kimlik şunlardan biri olabilir:
   - aynı telefondaki başka bir EserX uygulaması;
   - kişinin kendi başka bir cihazı (ör. tablet).
3. **Ek kimliğin sınırları:**
   - Ek kimlik oy vermez, kişi sınırına girmez, kasa payı tutmaz.
   - Kişinin rolünü, okuma ve yazma izinlerini taşır.
4. **Aynı telefonda katılım:** Aynı telefondaki iki uygulama, işletim sisteminin yalnız aynı geliştiricinin uygulamalarına açtığı yerel kanal üzerinden eşleşir. QR ya da ikinci ekran gerekmez.
5. **Ana kimliğin kaybı:** Ana kimliği taşıyan uygulama silinirse, ek kimlik kendini ana kimlik yapabilir. Bunun için ya eski ana kimliğin imzası gerekir, ya da 72 saat beklenir.
6. **Bildirim:** Her uygulama kendi bildirimini gösterir. Bir olayı bir cihazda yalnız bir uygulama bildirir.

## 3. Tanımlar

| Ad | Anlam |
|----|-------|
| **Kişi** | Ailedeki ya da ekipteki insan. Sınırlar, yeter sayılar ve kasa eşikleri kişileri sayar. |
| **Kişi kimliği (`personId`)** | Kişinin ilk ana kimliğinin `rootId`'si (RFC-0004 §4.2). Ana kimlik değişse de aynı kalır. Bugünkü her üyenin kişi kimliği kendi `rootId`'sidir. |
| **Ana kimlik** | Kişinin oy veren, kişi sınırına giren, kasa payı tutan kimliği. Bugünkü üye kimliğidir. Bir kişinin her an tek ana kimliği vardır. |
| **Ek kimlik** | Aynı kişinin başka bir uygulamadaki ya da kendi başka bir cihazındaki kimliği. Defterde `personOf` alanıyla kişi kimliğine bağlıdır. |
| **Cihaz grubu** | Aynı cihazdaki kimlikler. `sameDevice = true` ile eklenen ek kimlik, onu ekleyen ana kimliğin grubundadır. `sameDevice = false` ile eklenen kendi grubunu açar. |
| **Uygulama kimliği (`appId`)** | Uygulamanın kısa adı: `yuva-hat`, `yuva-defteri`, `mekan-hat`… Bilgi amaçlıdır, yetki vermez. |
| **Mesajlaşan kimlik** | `PREKEY` yayımlayan kimlik. Yalnız mesajlaşan uygulamalar (Yuva Hat, Mekan Hat) `PREKEY` yayımlar ve sohbetlere katılır. |
| **Yerel kanal** | Aynı telefonda yalnız aynı geliştiricinin (Eser Teknoloji) uygulamalarının erişebildiği işletim sistemi kanalı (§6). |

## 4. Defter değişiklikleri (protokol v2.2)

### 4.1 Yeni olaylar

Numaralar ilk boş yerden alınır. 24–26 RFC-0005'te kullanılıyor. 27–29 RFC-0005'e, 30–31 RFC-0010'a, 32 RFC-0009'a, 33 RFC-0012'ye ayrılmış.

| No | Olay | Gövde |
|----|------|-------|
| 34 | `APP_ATTACH` | `{ deviceCert, personId: fixed16, appId: string, sameDevice: bool, replaces: fixed16 \| null, ceremonyTranscriptHash: fixed32 }` |
| 35 | `APP_PRIMARY` | `{ personId: fixed16, newPrimaryId: fixed16, oldSigned: bool }` |

### 4.2 `APP_ATTACH` kuralları

| Kural | Hata |
|-------|------|
| İmzacılar: yeni ek kimliğin kendisi + kişinin şu anki ana kimliği | `NO_NEW_MEMBER_APPROVAL`, `NO_PERSON_APPROVAL` |
| `personId` aktif bir kişinin kişi kimliği olmalı; kişinin ana kimliği aktif ve bekleyen değil. Kutu, bağlı cihaz ve misafir kişi değildir. | `NO_PERSON` |
| Kişinin aktif ek kimlik sayısı < 4. `replaces` ile yerine geçilen kimlik sayılmaz. | `SECONDARY_IDENTITY_LIMIT` |
| Kimlik daha önce görülmemiş olmalı (RFC-0003 §3) | `IDENTITY_ALREADY_EXISTS` |
| `replaces` varsa: aynı kişinin, aynı `appId`'li bir ek kimliği ya da `APP_PRIMARY` ile pasifleşmiş eski ana kimliği olmalı | `CANNOT_REPLACE` |
| `ceremonyTranscriptHash` sıfır olamaz | `INVALID_TRANSCRIPT` |
| `level ≥ '2.2'` | `LEVEL_TOO_LOW` |

- Başka bir ebeveynin onayı **gerekmez**. Kişi yalnız kendisini çoğaltır; aileye yeni bir insan girmez.
- Ek kimlik çift sırlarını her üyeyle kendisi türetir. Çapa `APP_ATTACH` olayının özetidir (RFC-0003 §6.2'deki gibi). Ana kimlik ona hiçbir anahtarını vermez.
- **`replaces`:** Kişi telefon değiştirdiğinde ya da sildiği bir uygulamayı yeniden kurduğunda kullanılır. Etkisi eski cihazın imzalamadığı `ROTATE_DEVICE`'ınkiyle aynıdır:
  - eski kimlik pasifleşir;
  - `rotatedTo` zincirine eski → yeni bağı eklenir; yeni kimliğin `rootId`'si ve yedeğinin `secretId`'si eskisiyle aynı olur;
  - koleksiyonlarda yeni dönem başlar (RFC-0001 §9.1);
  - eski kimliğin yedek payları 72 saat beklemeyle verilir (RFC-0004 §5.2 satır 4).

### 4.3 Ek kimliğin defterdeki yeri

Ek kimlik `members` haritasında tutulur: aynı HELLO, aynı çift sırrı ve aynı zarf kodu ona da çalışır. Ek alanlar:

```
{ ..., role: <kişinin rolü>, personOf: <kişi kimliği hex>, appId, sameDevice }
```

Defter ayrıca `persons: Map<personId, { primary }>` tutar. Ana kimliği değişen kişinin eski ana kimliği pasifleşir ve `personOf` alanını alır.

| Konu | Kural |
|------|-------|
| Rol | Her zaman ana kimliğin rolüdür. `SET_ROLE` ana kimliğe uygulanır, ek kimlikler kendiliğinden izler. |
| Sınırlar | Yalnız ana kimlikler sayılır: kişi sınırı (`maxMembers`, `HARD_MAX_MEMBERS`, ekipte `HARD_MAX_MEMBERS_EKIP`), ebeveyn sınırı (`MAX_PARENTS`), sahip sınırı (`MAX_OWNERS`), ekipte kutusuz 8 kişi sınırı (`EKIP_KUTUSUZ_SINIR`). Yeni yardımcı `personIds()` ana kimlikleri döner. `parentIds()` ve `authorityIds()` (RFC-0005 §4.3) ek kimlikleri dışarıda bırakır. Ek kimlik eklemek `MEMBER_LIMIT` ya da `BOX_REQUIRED` vermez. |
| Oy | Ek kimlik hiçbir yeter sayıya girmez. `mergeSigs` ek kimlik imzasını eklemez. İmzalayabildiği olaylar: kendi `APP_ATTACH`'i (yeni kimlik olarak), kendi `PREKEY`'i, kendi `LEAVE`'i, kendi `APP_PRIMARY`'si (§7), kişinin kişisel koleksiyonundaki `COLLECTION` değişikliği. Başka her olayda `SECONDARY_IDENTITY_CANNOT_VOTE`. |
| Okuma | Koleksiyon izinleri (`uye:<id>`, `rol:`) kişiye göre çözülür. Ek kimlik, kişinin okuduğu her koleksiyonun okuyucusudur. Dönem anahtarları ona da gider (RFC-0001 §9). `replaces` taşımayan `APP_ATTACH` okuyucu eklemek sayılmaz: `history: false` koleksiyonda da yeni dönem başlamaz, ek kimlik kişinin aldığı dönemleri alır. Anahtar isteğinde (RFC-0001 §9.5) yetki kişiye göre denetlenir. |
| Yazma | Kişinin yazdığı her koleksiyona yazar. İşlemin `authorId` alanı ek kimliktir; yetki kişi üzerinden çözülür. |
| Görev | Kişinin verebildiği görevleri verebilir; işçi yetkiyi kişiye göre denetler (RFC-0002 §6.2). İlk kullanım onayı kişi başınadır (RFC-0002 §7): aynı cihaz grubundaki kimlikler onayı yerel kanaldan paylaşır, başka cihazdaki ek kimlik onayı kendisi sorar. |
| Kasa payı | Ek kimlik pay **tutmaz** ve KRA payı istemez. Kasa dönem anahtarlarını okuyuculardan `REC_KEY_REQ` ile alır. Her kimliğin kendi yedeği vardır (§8). |
| Mesajlaşma | Yalnız mesajlaşan kimlik sohbetlere katılır. Gönderen bir kişiye mesajı, o kişinin `PREKEY` yayımlamış bütün aktif kimliklerine yazar. Kişinin mesajlaşan kimliği yoksa sohbette "Yuva Hat'ı kurmadı" yazar. |
| Çıkarma | `REMOVE_MEMBER` ana kimliğe uygulanırsa bütün ek kimlikler de aynı olayla pasif olur; `wipe: true` hepsine uygulanır. Ekipte ayrılan kişinin iş verisi bütün kimliklerinden silinir (RFC-0005 §10). Tek bir ek kimliği çıkarmak için: kişi kendisi `LEAVE` imzalar, ya da herhangi bir ebeveyn (ekipte sahip ya da yönetim alanındaki yönetici) tek imzayla `REMOVE_MEMBER` yazar (kutu çıkarma kuralıyla aynı). |
| Telefon değişimi, kayıp telefon | Ana kimliğin `ROTATE_DEVICE`'ı, eski ana kimliğin cihaz grubundaki ek kimlikleri aynı olayla pasifleştirir; eski cihaz imzalamadıysa onlara da silme emri gider. Yeni telefondaki uygulamalar §6.2 akışıyla ve `replaces` ile yeniden eklenir. Ek kimlik `ROTATE_DEVICE` yazamaz. |

### 4.4 Uyum ve sürüm kapısı

- Yeni HELLO biti: `COKLU_UYGULAMA = 8192`. `JOIN_HELLO.caps` da bu biti taşır.
- `PROTOCOL_LEVEL { level: '2.2' }`, RFC-0003 §2.2'deki koşullarla yazılır: bütün aktif ve bekleyen olmayan üyeler (kişiler ve kutu) son 30 gün içinde bu bitle görülmüş olmalıdır. Ekipte imzacı RFC-0005 §6.2'deki gibidir.
- 34–35 numaralı olaylar ancak düzey 2.2 olduktan sonra yazılabilir.
- Düzey 2.2'den sonra bu biti taşımayan `JOIN_HELLO` `UPDATE_REQUIRED` ile reddedilir.
- **Sonraki düzeyler:** Ek kimlik defteri kendisi doğrular; bilmediği olayı görünce durur. Bu yüzden 2.2'den sonraki her `PROTOCOL_LEVEL` koşulu ek kimlikleri de kapsar.
- **Düzeyi beklemeden başlama:** Düzey 2.2 olmadan önce ikinci uygulama, ailenin ayrı bir **kişisi** olarak katılamaz; çünkü aynı insanı iki kez saymak kuralı bozar. Bunun yerine §6.4'teki bekleme ekranı gösterilir.

### 4.5 Çatallanma

`APP_PRIMARY`, RFC-0003 §9'daki güçlü olaylar listesine girer: eski ana kimliğin ya da bir ebeveynin imzaladığı, ya da 72 saat beklemesi dolmuş `APP_PRIMARY` güçlü sayılır. Ek kimliği çıkaran `REMOVE_MEMBER` zaten güçlüdür.

## 5. Kişiye göre çözümleme (kurucu belge ve RFC'lere etkisi)

Kişi kavramı bütün katmanlarda aynı kuralla okunur:

- **Kişi sayılan yerlerde yalnız ana kimlik** sayılır: sınırlar (§4.3), yeter sayılar, kasa eşiği ve pay sahipleri (RFC-0004 §3), kupon dağıtımı (RFC-0013 §16.2), sorumlu listesinin sırası (RFC-0006 §11.1).
- **Okuma ve yazma izinlerinde** kişi; yani ana kimlik ve ek kimlikleri birlikte.
- **`uye:<id>`, `owner`, `TASK_PERMIT.subject`, `grantedBy`** (RFC-0003 §5.13): önce `rotatedTo` zincirinin aktif ucuna, sonra `personOf` ile kişiye çözülür. İzin kişiye verilmiş sayılır.
- **Kesim** (RFC-0001 §8):
  - Kişinin hiçbir kimliği, aynı kişinin başka bir kimliği için kesim yayımlayamaz. Bu, RFC-0001 §8.3 kural 1'deki listeye eklenir.
  - Yetkiyi bitiren olaylara (RFC-0001 §8.1) şunlar eklenir: ek kimliği pasifleştiren her olay (`REMOVE_MEMBER`, `LEAVE`, ana kimliğin `ROTATE_DEVICE`'ı), eski ana kimlik için `APP_PRIMARY`, eski kimlik için `replaces` taşıyan `APP_ATTACH`.
  - Ana kimliğin rolü `SET_ROLE` ile daralınca kesim kişinin her kimliği için ayrı yayımlanır.
- **Yeni dönem** (RFC-0001 §9.1): Ek kimlik çıkınca okuyucu çıkmış sayılır, yeni dönem başlar. `replaces` taşıyan `APP_ATTACH` ve eski imzası olmayan `APP_PRIMARY` yeni dönem başlatır. `replaces` taşımayan `APP_ATTACH` ve eski imzalı `APP_PRIMARY` başlatmaz.
- **Son görülme** (RFC-0015 §3): Kişinin bütün kimliklerinin en yenisi döner. Hangi uygulamada görüldüğü gösterilmez. Kişinin herhangi bir kimliği `HIDE_PRESENCE` bildirirse kişi için `via: 'yok'` döner. Ayarı kişi bir kez seçer; bütün kimliklerine uygulanır.
- **Üye çözme** (RFC-0015 §4): `resolveMember` sonucuna `personId` ve `primaryId` eklenir. Ürünler kimliği değil kişiyi gösterir: aynı kişi listelerde bir kez görünür.
- **Misafir** ek kimlik alamaz; misafir uygulaması her davet için yeni kimlik üretir (RFC-0003 §3).
- **Ekip:** Kurallar aynıdır. Ekipte kişisel koleksiyon olmadığı için ek kimliğin `COLLECTION` istisnası kullanılmaz.

## 6. Aynı telefonda eşleşme (yerel kanal)

### 6.1 Kanal

| Platform | Kanal | Kimin erişimi var |
|----------|-------|-------------------|
| iOS | Ortak App Group kapsayıcısı (`group.eserx.havenfold`) | Yalnız aynı Apple geliştirici hesabının (Eser Teknoloji) uygulamaları |
| Android | `signature` korumalı izinle açılan `ContentProvider` | Yalnız aynı imza anahtarıyla imzalanmış uygulamalar |

- Kanalı, başka bir geliştiricinin uygulaması okuyamaz ve yazamaz. Bu güvenceyi işletim sistemi verir.
- Kanalda kalıcı sır tutulmaz. Kanal yalnız taşıyıcıdır.

### 6.2 Akış

1. Kullanıcı yeni uygulamayı açar. Uygulama yerel kanala bakar: aynı telefonda ailesi olan bir EserX uygulaması var mı?
2. Varsa şöyle sorar: "Bu telefonda Yuva Hat'ta 'Rivera Ailesi' var. Aynı aileye katılalım mı?"
3. Kullanıcı onaylar. Yeni uygulama kendi kimliğini üretir ve yerel kanala bir **eşleşme isteği** bırakır:

   ```
   APP_PAIR_REQ (0xE8) { deviceCert, appId, nonce: fixed32 }
   ```

4. Eski uygulama açılır; yeni uygulama onu bir derin bağlantıyla öne getirir. Eski uygulama kullanıcıya biyometri sorar: "Yuva Defteri bu ailede senin adına çalışacak. Onaylıyor musun?"
5. Eski uygulama `APP_ATTACH`'i imzalar. `ceremonyTranscriptHash = hash('hf/app-pair/', nonce, deviceCert özeti, appId)`. Olayı ve ailenin defterini yerel kanala bırakır:

   ```
   APP_PAIR_OK (0xE9) { event: buffer, ledger: buffer, nonce: fixed32 }
   ```

   Eski uygulama hiçbir anahtarını ve çift sırrını vermez.
6. Yeni uygulama (`ESLES_KABUL`) `nonce`'u denetler, defteri doğrular, olayı imzalar ve çift sırlarını türetir. Olay eşitlemeyle ailenin bütün cihazlarına yayılır. Koleksiyon anahtarlarını okuyuculardan alır (RFC-0001 §9.4). İlk paketi aynı telefondaki eski uygulama `APP_LOCAL_SYNC` ile verir (`YEREL_ESITLE`). Bu iki komutun kanal numarası henüz verilmedi (aşağıda §13).
7. Yerel kanaldaki eşleşme dosyaları 5 dakika sonra ya da iş bitince silinir.

**Zarflar:**

- `APP_PAIR_REQ` ve `APP_PAIR_OK` yalnız yerel kanalda geçerlidir. Ağdan gelirse atılır.
- `APP_LOCAL_SYNC (0xEA)`, aynı cihaz grubundaki iki kimlik arasında defter, kayıt ve anahtar eşitlemesi taşır. İki kimliğin çift sırrıyla RFC-0003 §6.4'teki gibi mühürlenir.

**Neden QR ve 5 resim yok:** Yüz yüze törenin amacı karşıdaki cihazın gerçekten o kişinin olduğunu doğrulamaktır. Burada iki uygulama aynı telefonda; işletim sistemi kanalı yalnız Eser'in uygulamalarına açık ve kişi telefonda biyometriyle onay veriyor. Bu, törenin verdiği güvenceyi aynı telefon için sağlar.

### 6.3 Kişinin başka cihazı (tablet)

Ek kimlik kişinin başka bir cihazında olacaksa yerel kanal yoktur. Bu durumda normal yüz yüze tören yapılır:

- QR'daki `kind = 4` (ek kimlik);
- kişinin ana kimliği QR'ı tarar ve 5 resim karşılaştırılır;
- `APP_ATTACH { sameDevice: false }` yazılır.

### 6.4 İlk uygulama ve düzey

- Telefonda hiçbir EserX uygulamasında aile yoksa, ilk açılan uygulama normal akışı izler: aile kurar ya da yüz yüze törenle katılır. Bu uygulamanın kimliği kişinin ana kimliği olur. Hangi uygulama olduğu fark etmez.
- **Düzey 2.2 yoksa:** İkinci uygulama, "Ailenin bu özelliği kullanabilmesi için herkesin uygulamaları güncel olmalı" ekranını gösterir ve bekler. Kullanıcı yine de kullanmak isterse uygulama **ailesiz kişisel mod**da çalışır: veri yalnız telefonda durur, düzey gelince kişinin ailedeki kişisel koleksiyonuna taşınır.
- Ekipte kişisel koleksiyon olmadığı için ailesiz kişisel mod yalnız ailede vardır. Ekipte ikinci uygulama düzey gelene kadar bekleme ekranını gösterir.

## 7. Ana kimliğin değişmesi (`APP_PRIMARY`)

Ana kimliği taşıyan uygulama silinebilir. Kişi örneğin Yuva Hat'ı siler ama Yuva Defteri'ni tutar.

| Durum | Kural |
|-------|-------|
| Eski ana kimlik imzalıyor (uygulama silinmeden önce "ana kimliği devret" denirse) | `APP_PRIMARY { oldSigned: true }`; eski ve yeni imzası yeter; hemen geçerli |
| Eski ana kimlik imzalamıyor (uygulama zaten silinmiş) | Yeni kimlik imzalar; olay **72 saat bekleyen** olur (K16 düzeni). Bu sürede eski ana kimliğe ve ailenin ebeveynlerine `security { type: 'app_primary_pending' }` gider. Eski kimlik ya da herhangi bir ebeveyn veto edebilir. Süre dolunca `ACTIVATE_MEMBER` ile etkinleşir. |
| Ebeveyn hızlandırması | Kişi dışındaki bir ebeveyn de imzalarsa bekleme olmaz |

- **Etkisi:** `persons[personId].primary` yeni kimlik olur. Eski kimlik pasifleşir ve `personOf` alanını alır.
- `APP_PRIMARY` `rotatedTo` zincirine **girmez**. İzinler kişi kimliği üzerinden çözüldüğü için gerekmez. Yeni ana kimliğin `rootId`'si ve yedeği değişmez.
- **Kasa:** Eski ana kimliğin tuttuğu paylar (başkalarının YA'ları ve KRA'lar) gitmiş sayılır. Pay sahibi çıktığı için her sırrın sahibi sırrı döndürür ve yeni payı yeni ana kimliğe verir (RFC-0004 §6).
- **Silinen uygulamanın verisi:** Eski ana kimliğin yedeği (ör. Yuva Hat'ın mesaj arşivi) kendi YA'sıyla durur. Kişi uygulamayı yeniden kurarsa yeni kimlik `APP_ATTACH { replaces: <eski kimlik> }` ile ek kimlik olarak eklenir. Eski yedeği kurtarma akışıyla geri alır (RFC-0004 §5).

## 8. Uygulama başına veri ve yedek

- Her uygulamanın kendi yerel verisi vardır: Yuva Hat'ın mesaj arşivi, Yuva Defteri'nin dizini.
- **Ortak veri** (koleksiyonlar) kayıt katmanındadır. Hangi uygulama yazarsa yazsın aynı aileye aittir ve diğer uygulama da görür.
- **Yedek:** Her kimliğin kendi yedeği ve kendi YA'sı vardır (`secretId` kimliğin `rootId`'sinden, RFC-0004 §4.2). Pay sahiplerini kişi bir kez seçer; ayar bütün kimliklerine uygulanır. Eşik kişi sayısından hesaplanır (RFC-0004 §3.2).
- Yeniden kurulabilen veri (arama dizini, önbellek) yedeğe girmez.
- **Kişisel koleksiyon** kişiye aittir. Kişinin bütün kimlikleri okur ve yazar. Anahtarları her kimliğin yedeğine girer.

## 9. Bildirim ve zil

- Her uygulama kendi bildirimlerini gösterir. Kurucu belgedeki "bildirim yalnız Yuva Hat'tan" kuralı kalkar.
- **Bir olayı bir cihazda yalnız bir uygulama bildirir.** Bildiren uygulama şöyle seçilir:

  | Bildirim | Bildiren |
  |----------|----------|
  | Mesaj, arama, bas-konuş | Mesajlaşan uygulama (Yuva Hat; Mekan'da Mekan Hat) |
  | Defter hatırlatması (`yuva.defter.*`), asistan, Kalkan haberi | Yuva Defteri |
  | Vaka ve bildirim merdiveni (RFC-0006 §11) | Olay türünü kaydeden ürünün uygulaması (RFC-0006 §5.3): `yuva.acil.*` Yuva Acil, `yuva.pet.*` Yuva Pati, `yuva.bakim.*` ve `yuva.cocuk.*` Yuva Bakım, `yuva.defter.*` Yuva Defteri (RFC-0029 §5). |
  | `hf.sos` | Yuva Acil; cihazda yoksa ana kimlik. SOS her Yuva uygulamasında alınır ve gösterilir (RFC-0029 §4). |
  | Çekirdek güvenlik ve aile bildirimleri (`security`, kasa payı isteği, imza bekleyen öneri, `hf.sos` dışındaki `hf.` türleri) | Kişinin o cihazdaki ana kimliği. Pay ve imza ana kimliktedir; onay ekranı da orada açılır. |

- **Geri düşme:** Bildiren uygulama o cihazda yoksa, cihaz grubundaki kimliklerden önce ana kimlik, o da yoksa `appId` sırasıyla ilk uygulama bildirir. Her uygulama cihazdaki diğer uygulamaları yerel kanaldan öğrenir.
- **RFC-0006 §11.3'ün okunuşu:** Oradaki "telefon", cihaz grubunun bütün kimlikleridir. Merdiven motorunu (RFC-0006 §12) cihazda yalnız bildiren uygulama çalıştırır. "En çok bir kez" kümesi yerel kanalda ortak tutulur. Böylece iki uygulama aynı basamağı iki kez göstermez.
- **Uyandırma:** `VAKA_UYANDIR` kitledeki kişinin bütün aktif kimliklerine gider. Bildiren olmayan uygulama zarfı alır, eşitler ama bildirim göstermez.
- **Zil:** Her kimliğin kendi zil bileti vardır (Posta Kutusu kimlik başınadır). Gönderen, kişinin hangi kimliğine yazıyorsa onun zilini çalar. Mesaj zili yalnız mesajlaşan kimliklere çalar.

## 10. Uygulamalar arası geçiş

- Bir uygulama diğerine derin bağlantıyla geçebilir: `eserx://yuva-defteri/kayit/<collectionId>/<recordId>`. Bağlantı yalnız rastgele kimlikleri taşır. Soru, mesaj metni ya da kayıt içeriği bağlantıya yazılmaz; gerekiyorsa yerel kanaldan geçer.
- **Yuva Hat sohbetinde @Yuva:** Yuva Hat tetiği tanır (RFC-0013 §7.1) ama soruyu kendisi işlemez; Yuva Hat'ta yapay zeka yoktur.
  - Yuva Defteri kuruluysa soru metni ve "Asistana sor" ile seçilen tek mesaj yerel kanaldan Yuva Defteri'ne geçer ve Yuva Defteri açılır.
  - Cevap Yuva Defteri'nde, yalnız sorana görünür (RFC-0013 §7.2). Tetikleyen metin sohbete gitmez.
  - "Sohbete gönder" denirse `[YZ]` işaretli metin (RFC-0013 §7.5) Yuva Hat'ın yazma kutusuna taslak olarak düşer. Kişi kendisi gönderir.
  - Yuva Defteri kurulu değilse "Yuva Defteri'ni yükle" kartı gösterilir. Kart platforma özgü mağaza bağlantısı verir (§12).
- **Sohbetten Plana:** Yuva Defteri mesaj okumaz. Sohbet Yuva Hat'tadır. İki giriş vardır:
  - **Yuva Hat kuruluysa:** Yuva Hat yalnız kural tabanlı tarih ve saat süzgecini çalıştırır (RFC-0013 §7.7; model yok). Süzgece takılan mesajın altında "Plana ekle" kartı görünür. Dokununca mesaj metni, `msg:` başvurusu ve sohbet katılımcılarının listesi yerel kanaldan Yuva Defteri'ne geçer. Çıkarma, öneri formu ve onay Yuva Defteri'ndedir. Onaydan önce kayıt katmanına hiçbir şey yazılmaz; "Plana ekle" kartı yalnız o telefonda görünür. Kaydedilen planın sohbetteki kartını Yuva Hat ortak durumdan çizer.
  - **Yuva Hat kurulu değilse ya da metin başka bir uygulamadaysa:** Kişi herhangi bir uygulamadan metni ya da fotoğrafı işletim sisteminin **paylaş menüsüyle** Yuva Defteri'ne gönderir. Yuva Defteri aynı çıkarma akışını uygular. Kaynak saklanacaksa kaydın koleksiyonuna dosya olarak yazılır ve `dosya:` başvurusuyla bağlanır. Yeni `_src` biçimi gerekmez.
- **Ek kimliğin yapamadığı işler:** Üye, cihaz ya da misafir ekleme ve ortak koleksiyon oluşturma gibi oy isteyen işler ana kimlikte yapılır. Ek kimlikteki uygulama öneriyi yerel kanaldan verir ve ana kimliği taşıyan uygulamayı derin bağlantıyla açar; kişi orada onaylar. Diğer imzalar RFC-0003 §5.14'teki öneri yoluyla toplanır. Ana kimlik başka bir cihazdaysa "Bunu ana cihazından yap" der.
- **Onaylı RFC'lerin okunuşu:** RFC-0013 §7.1'deki "Defter sekmesindeki arama kutusu", Yuva Defteri uygulamasının arama kutusudur. RFC-0003 §2.2 madde 9'daki "Defter özellikleri" Yuva Defteri'nin aile özellikleridir; bekleme ekranı her uygulamada aynı metinle görünür.

## 11. Aynı telefonda iki uygulama aynı anda çalışırsa

- Her uygulamanın çekirdeği ayrıdır. Kendi kimliğiyle, kendi oturumlarıyla çalışır.
- İkisi de aynı aile defterini ayrı ayrı tutar ve doğrular.
- **Telefonun pili ve ağı:** Aynı cihaz grubundaki kimlikler, Posta Kutusu ve kutu yoluna yük bindirmesin diye birbirleriyle `APP_LOCAL_SYNC` ile doğrudan eşitlenir; aynı veriyi ağdan ayrıca çekmez. Bu bir iyileştirmedir, doğruluğu etkilemez.

## 12. Mağaza

- Her uygulamanın kendi mağaza sayfası, kendi yaş derecelendirmesi ve kendi gizlilik beyanı vardır.
- Yuva Hat'ta yapay zeka yoktur: @Yuva ve Sohbetten Plana'nın modeli Yuva Defteri'ndedir (§10). Bu yüzden **Yuva Defteri'nin yapay zeka özellikleri yalnız Yuva Defteri'nin derecelendirmesini etkiler.** Yuva Hat'ın derecelendirmesi değişmez.
- Uygulama, diğer uygulamayı kendi mağazasının bağlantısıyla önerir. App Store sürümü App Store'a, Play sürümü Play'e bağlantı verir. Platforma özgü metin kuralı (kurucu §16.2) geçerlidir.
- Uzaktan kod indirme yasağı her uygulama için ayrı ayrı geçerlidir.
- **Yuva Aile paketi** hangi uygulamadan alınırsa alınsın aileye aittir. Kuponlar Tüm Aile koleksiyonuna yazıldığı için (RFC-0013 §16.2) diğer uygulama da kullanır.

## 13. Numaralar

| Tür | Numara |
|-----|--------|
| Defter olayları | 34 `APP_ATTACH`, 35 `APP_PRIMARY` |
| Protokol düzeyi | `2.2` |
| HELLO biti | `COKLU_UYGULAMA 8192` |
| Tören `kind` | `4` ek kimlik (başka cihaz) |
| Zarf türleri | `0xE8 APP_PAIR_REQ`, `0xE9 APP_PAIR_OK` (yalnız yerel kanal), `0xEA APP_LOCAL_SYNC`; `0xEB–0xEF` bu RFC'ye ayrılmış. `0xF0–0xFE` boş. |
| Çekirdek komutları | `360 PAIR_REQUEST` (`pairRequest`), `361 PAIR_APPROVE` (`pairApprove`), `362 PERSON_IDENTITIES` (`identities`), `363 PRIMARY_HANDOVER` (`handOverPrimary`), `364 DEVICE_APPS` (`localApps`), `ESLES_KABUL` (`pairAccept`; §6.2 adım 6, yeni uygulama) ve `YEREL_ESITLE` (`localSync`; §6.2 adım 6 ilk paket, eski uygulama) worklet'te adlarıyla (`c.eslesKabul`, `c.yerelEsitle`); kanal numarası **verilmedi**: 365–369 RFC-0027 §1a kasa komutlarınındır (`protocol/command-ranges.json`), numara ayrı kararla boş bir aralıktan verilecek |
| Hata adları | `NO_PERSON_APPROVAL`, `NO_PERSON`, `SECONDARY_IDENTITY_LIMIT`, `SECONDARY_IDENTITY_CANNOT_VOTE`, `CANNOT_REPLACE`, `INVALID_TRANSCRIPT` |
| Türetme etiketleri | `hf/app-pair/` |
| Derin bağlantı | `eserx://<appId>/…` |

## 14. Test vektörleri

`protocol/vectors/multi-app.json`:

1. `APP_ATTACH` kodlama ve imzalar; ebeveyn onayı olmadan geçerli.
2. Ek kimlik bir `ADD_MEMBER`'ı imzalar → `SECONDARY_IDENTITY_CANNOT_VOTE`. Kendi `PREKEY`'ini imzalar → geçerli.
3. 8 kişilik ailede bir kişinin 4 ek kimliği → geçerli; kişi sayısı 8 kalır. 32 kişilik ekipte aynı → kişi sayısı 32 kalır.
4. Kutusuz ekipte 8 kişi ve ek kimlikleri → ek kimlik eklemek geçerli; 9. kişi → `BOX_REQUIRED`.
5. 5. ek kimlik → `SECONDARY_IDENTITY_LIMIT`. Aynı kişinin `replaces` ile eklenen kimliği → geçerli.
6. Ana kimliğe `REMOVE_MEMBER` → ek kimlikler de pasif.
7. Ana kimliğin imzasız `ROTATE_DEVICE`'ı → aynı cihaz grubundaki ek kimlikler pasif ve silme emri alır; `sameDevice = false` ek kimlik kalır.
8. `APP_PRIMARY`: eski imzalı → hemen; eski imzasız → 72 saat bekleyen; veto. `uye:<eski ana kimlik>` → kişinin yeni ana kimliğine çözülür.
9. `SET_ROLE` ana kimliğe → ek kimliğin rolü de değişir.
10. Kişinin kişisel koleksiyonuna ek kimliğin yazması → geçerli; başka kişinin ek kimliğinin yazması → red.
11. Ek kimliğin, aynı kişinin başka bir kimliği için yayımladığı kesim → atılır.
12. `APP_PAIR_OK` ağdan gelir → atılır.

## 15. Güvenlik değerlendirmesi

| Tehdit | Önlem |
|--------|-------|
| Telefondaki kötü niyetli uygulama ek kimlik olmaya çalışır | Yerel kanal yalnız Eser'in imzalı uygulamalarına açık; ana kimlik biyometriyle onaylar |
| Ek kimlik aileye "yeni bir kişi" gibi oy vermeye çalışır | Ek kimlik hiçbir yeter sayıya ve sınıra girmez |
| Silinen uygulamanın kimliğini başkası devralır | `APP_PRIMARY` için eski imza ya da 72 saat + veto + ebeveyne bildirim |
| Telefon çalınır | Ana kimliğin `ROTATE_DEVICE`'ı ya da `REMOVE_MEMBER { wipe }` aynı cihaz grubundaki ek kimlikleri de kapsar |
| Ek kimlik kasa payı toplar | Ek kimlik pay tutmaz |
| Kişi kendi geriye dönük işlemlerini başka kimliğiyle kesime ekler | Aynı kişinin kimlikleri birbirinin kesimini yayımlayamaz |
| Derin bağlantı ya da yerel kanal içerik sızdırır | Bağlantıda yalnız rastgele kimlik; yerel kanalda kalıcı sır yok; eşitleme çift sırrıyla mühürlü |
| Aynı kişinin iki uygulaması aynı bildirimi iki kez gösterir | Bildirim kuralı (§9) |

## 16. Kurucu belgede değişecekler (1.3)

| Bölüm | Değişiklik |
|-------|------------|
| Başlık | Sürüm 1.3; RFC-0017 onaylı RFC'ler arasında listelenir (§0). |
| §1 | Bugünkü durum: Yuva Defteri ayrı uygulamadır. |
| §2 katman tablosu ve §2.2 | Yuva Defteri ayrı bir uygulamadır. Her EserX ürünü kendi başına kurulabilir. |
| §3 "Asla yapılmayanlar" | "Modüller uygulamanın içinde gelir" → her ürün kendi uygulamasıdır; modüller uygulamanın içinde gelir. |
| §4 kavramlar | "Kişi", "ana kimlik", "ek kimlik" satırları. |
| §6.1, §6.2 | Defterde kişi kavramı; sınırlar kişileri sayar; kişi başına en çok 4 ek kimlik. |
| §6.3, §6.4 | Olaylar 34–35, düzey 2.2, HELLO biti 8192; tören `kind = 4`; aynı telefonda eşleşme yeni kişi değildir. |
| §6.8 | Kişinin telefonu değişince aynı telefondaki ek kimlikler kapanır. |
| §7.3, §7.6 | Kesim aynı kişinin başka kimliği adına yayımlanamaz; kişisel koleksiyon ve `uye:` izinleri kişiye aittir. |
| §8.2 | Zarf aralığı 0xE8–0xEF RFC-0017. |
| §10.2 | Kişi tarafındaki payı ana kimlik tutar; ek kimlik pay tutmaz. |
| §13.1 | Yeni tehdit T29: telefondaki başka bir uygulama ek kimlik olmaya çalışır. |
| §14.1 | "Telefonda modüller uygulamanın içinde gelir" → "Her ürün kendi uygulamasıdır ve kendi başına kurulabilir. Bir uygulamanın içindeki modüller (ör. Bakım, Pati) uygulamayla birlikte gelir; uzaktan kod indirilmez." "Bildirimler yalnız Yuva Hat'tan" → §9'daki kural. |
| §15.1 | Modüller listesinden Yuva Defteri çıkar. Yuva Hat'ta yapay zeka yoktur; @Yuva Yuva Defteri'ni açar. |
| §15.2 | "Nerede": ayrı uygulama, kendi mağaza sayfası; Yuva Hat'ta @Yuva kartı ve derin bağlantı; paylaş menüsü girişi. |
| §16.2 | Uygulamalar birbirini yalnız kendi mağazasının bağlantısıyla önerir. Yaş derecelendirmesi uygulama başınadır. |
| §19 | Uyum tablosuna "Uygulama" satırı. |
| §20 | Faz 2: "Defter sekmesi" → Yuva Defteri uygulaması; defter v2.2. |
| §22.1 | HF22 değişir: "Yuva Defteri ayrı bir uygulamadır; aynı ailede birden çok uygulama RFC-0017'ye göre çalışır. Gerekçe: daha çok insana ulaşmak (Kerem, 23 Ekim)." Yeni karar HF49: kişi ve ek kimlik. |
| §22.2 | HF22'nin eski ve yeni hali. |

## 17. Uygulama sırası

1. Defter v2.2: olaylar 34–35, `personOf`, `persons`, kişiye göre çözümleme, sınırların kişi sayması, kesim ve dönem kuralları; vektörler 1–11.
2. Yerel kanal (iOS App Group, Android imza izinli ContentProvider), eşleşme akışı ve `APP_LOCAL_SYNC`; vektör 12.
3. `APP_PRIMARY`, `replaces` ve bekleme.
4. Bildirim kuralı ve derin bağlantılar.
5. Yuva Defteri'nin ayrı uygulama olarak yayını (paylaş menüsü girişi dahil).
