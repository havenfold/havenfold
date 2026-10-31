# RFC-0036 — Katılımda uygulama ve aile adı

> Durum: **Onaylandı** (Kerem, 25 Ekim 2026; K1 misafir görür, K2, K3), kurucu belge 1.21 · Yazan: Havenfold çekirdek ekibi
> Kaynak: Yuva Acil'in gerçek iki telefon denemesi (25 Ekim 2026); yuva-acil PR #24 (LA41). Kodda bilinen boşluk: `sdk/api.js` "Defter ana kimliğin appId'sini taşımaz" (D15 madde 8, İstek 113).
> Kurucu belge: §6.1, §6.4, §7.7, §13.1, §22. Etkilenen RFC'ler: 0003 (§2.2 madde 2, §10), 0006 (§6.2), 0015 (§2.2), 0017 (§3, §5, §13), 0019 (§11.1 l), 0024 (tören olayı), 0028 (§5 a–b), 0029 (§4.6), 0034 (§4.1).
> **Defterde protokol değişikliği yok.** Yeni defter olayı, `PROTOCOL_LEVEL` ve düzey koşulu yok. Değişenler: yeni çekirdek kayıt türü `hf.uygulama` (olay değil) ve yazar sınıfı `kendi`; `JOIN_HELLO`'nun sonuna isteğe bağlı `familyName`; yetenek biti `AILE_ADI = 32768` (bilgi biti, düzey koşulu değil).

## 1. Sorun

1. **Ana kimliğin uygulaması bilinmiyor.** Kişi Yuva Acil'in kendi töreniyle (QR, 5 resim) aileye ana kimlik olarak katılınca defterde hangi uygulamayla katıldığı yazmaz. `appId` yalnız `APP_ATTACH`'te (ek kimlik, RFC-0017 §4.1) var; `GENESIS`, `ADD_MEMBER`, `ROTATE_DEVICE` ve `JOIN_HELLO` uygulama taşımaz. Öbür telefon bu kişide "Yuva Acil yok · internetsiz ulaşılamaz" sanıyor; SOS ekranı yanlış "uygulama yok" diyor (RFC-0029 §4.2, §4.6). Yuva Acil şimdilik bu kişiyi "bilinmiyor" sayıyor (LA41). Yuva Pati'nin `patiVar`'ı aynı boşluktan etkilenir.
2. **Katılan, ailenin adını bilmiyor.** `JOIN_HELLO`'da aile adı yok (Havenfold D32). 5 resim ekranında yalnız karşının adı ve cihazı görünür. Aile adı yeni gelene ancak `JOIN_LEDGER`'la, yani onaydan sonra gelir (RFC-0028 §5 e). Bir telefonda birden çok aile varken (RFC-0034) kişi hangi aileye katıldığını onaydan önce görmeli.
3. **(Bilgi)** Defterde ad değiştirme olayı yok. Kişinin adı yalnız törende (`JOIN_HELLO.name` → `ADD_MEMBER.displayName`), ailenin adı yalnız `GENESIS.familyName` ile yazılır.

## 2. Öneri özeti

1. Her kimlik kendi uygulamasını **Tüm Aile'ye kendi imzalı `hf.uygulama` kaydıyla** bildirir. Ek kimlikte `APP_ATTACH.appId` geçerli kalır. Kişinin uygulamaları, aktif kimliklerinin birleşimidir. Uygulaması bilinmeyen kimlik varsa sonuç "yok" değil **"bilinmiyor"**dur.
2. Üye ve misafir töreninde aile tarafı, karşı taraf `AILE_ADI` bitini bildirdiyse, kendi `JOIN_HELLO`'sunun sonuna **aile adını** ekler. Yeni gelen (üye ya da misafir) adı 5 resim ekranında gösterir; üye `JOIN_LEDGER` gelince defterdeki adla karşılaştırır (K1: misafir de görür).
3. Kişi uygulamalarını aileden gizleyemez (K2).
4. Ad değiştirme gereklidir ama bu RFC'nin kapsamında değildir; ayrı RFC'de yazılacak (K3, §5).

## 3. Kimliğin uygulaması

### 3.1 Seçenekler

| | Seçenek | Artı | Eksi |
|---|---------|------|------|
| A1 | `ADD_MEMBER`'ın sonuna isteğe bağlı `appId` | Katılımda defterde | Gövde çözmesi kanonik (`encoding.js` `canonical`): eski istemci sondaki fazla baytı `CORRUPT_BODY` ile reddeder, yani **düzey 2.4** ve herkesin güncellemesi gerekir. `ADD_MEMBER`'ı davet eden imzalar; başkasının uygulaması hakkında yanlış imzacı. `GENESIS` kurucusunu, `ROTATE_DEVICE`'ı ve bugünkü üyeleri kapsamaz. Sonradan güncellenemez. Kutu ve cihazlar da görür (tam defter). |
| A2 | Yeni defter olayı (37, "uygulama bildirimi"), kimliğin kendisi imzalar | Doğru imzacı; herkesi kapsar; güncellenebilir | Düzey 2.4 ve yeni bit; yetki taşımayan bilgi deftere girer; `SECONDARY_IDENTITY_CANNOT_VOTE` istisna listesi büyür; kutu ve cihazlar görür. Düzey gelene kadar sorun sürer. |
| **A3** | **Kayıt katmanında `hf.uygulama`, kimliğin kendisi yazar (öneri)** | Düzey ve defter değişmez; eski istemci kaydı yok sayar; işlem imzası doğru imzacıdır; herkesi kapsar (kurucu, katılan, telefon değiştiren, bugünkü üyeler); güncellenebilir; şifreli, kutu ve cihaz görmez | Kayıt, katılandan Tüm Aile anahtarı gelince yazılır (çevrimiçi ailede saniyeler); o arada "bilinmiyor". Tüm Aile'si olmayan aile (düzey 2.0, mağazadaki Yuva Hat) kayıt taşıyamaz. Yeni yazar sınıfı gerekir (§3.3). |

**Karar önerisi: A3.** Sorun bir yetki sorunu değil, bilgi sorunu. Bilgi kayıt katmanına aittir (`DEVICE_ATTACH.caps` gibi "yalnız bilgi verir"). Düzey açmak, en eski istemci güncellenene kadar sorunu çözmez; A3 bugün çözer.

### 3.2 Kayıt biçimi

| | |
|---|---|
| Tür | `hf.uygulama`, olay değil (RFC-0006 §6.2), `v` 1 |
| Koleksiyon | Tüm Aile (kurucu §7.7). Ekip: Açık nokta A3. |
| Alanlar | `_subj: 'uye:<yazarın kendi kimliği, hex16>'`, `appId: string` (`[a-z0-9-]`, 1–32 bayt; RFC-0017 §3'teki adlar: `yuva-hat`, `yuva-defteri`, `yuva-acil`, `yuva-pati`, `yuva-bakim`…) |
| `recordId` | RFC-0019 §11.1 c: `hash('hf/rec-new/', authorId, nonce)` |
| Bilinmeyen alan | Yok sayılır (RFC-0006 §4.2). İleride yetenek alanı gerekirse bu türe eklenir; düzey gerekmez. |

### 3.3 Kim yazar, nasıl okunur

| # | Kural |
|---|-------|
| 1 | **Yazan:** Kimliğin kendisi; ana ya da ek kimlik, her rol (çocuk dahil; çocuk Tüm Aile'ye yazar). Misafir, kutu ve bağlı cihaz yazmaz. Yazmak isteğe bağlı değildir: kişi uygulamalarını aileden gizleyemez, ayar yoktur (K2; RFC-0029 §4.6 durumun kişi kişi yazılmasını ister). |
| 2 | **Yazar sınıfı `kendi`** (katalogda yeni değer; RFC-0019 §11.1 l genişler): kaydın görünümüne yalnız kaydı oluşturan yazarın işlemleri katılır. Başka yazarın `put`'u geçerli kümede kalır ama görünüme girmez. Böylece biri başkasının uygulamasını değiştiremez ve "bilinmiyor"a da düşüremez. |
| 3 | **`_subj` çözülmez.** Bu türde `_subj` ham kimliktir ve kaydı oluşturan yazarla aynı olmalıdır; değilse kayıt yok sayılır. RFC-0006 §4.3'teki `rotatedTo` çözümü uygulanmaz: eski telefonun kaydı yeni telefona geçmemelidir. |
| 4 | **Ne zaman yazılır:** Uygulamanın çekirdeği, kimliği aktifken ve Tüm Aile anahtarı elindeyken, kendi kaydı yoksa ya da `appId` farklıysa bir kez yazar. Tetikler: aile kurma, törenle katılma, `APP_ATTACH`, `ROTATE_DEVICE`, uygulamanın açılışı (bugünkü üyeler). Başka zaman yazmaz. |
| 5 | **Bir kimliğin uygulaması:** Ek kimlikte `APP_ATTACH.appId` (defter) geçerlidir; kayıt farklı diyorsa kayıt yok sayılır. Ana kimlikte (ve `APP_PRIMARY`'den önce ek kimlik olmamış her kimlikte) kendi `hf.uygulama` kaydı; birden çok varsa son işlemi en büyük `hlc`'li olan. Kayıt yoksa `null` (bilinmiyor). Pasif kimliğin kaydı sayılmaz. |
| 6 | **Kişinin uygulamaları** (kişiye göre çözümleme, RFC-0017 §5): kişinin aktif kimliklerinin uygulamaları. Bir ürün için üç durum: **var** (bir kimliğin uygulaması o ürün), **yok** (bütün aktif kimliklerin uygulaması biliniyor ve hiçbiri o ürün değil), **bilinmiyor** (diğer her durum). Ürün "yok" ve "bilinmiyor"u ayrı gösterir. |
| 7 | Kutu (rolü `kutu`) uygulama değildir; bu hesaba girmez. |

**Bilinen sınır (RFC-0017'den kalan):** Uygulama telefondan silinince kimliği defterde aktif kalır. Kimlik yalnız `LEAVE`, `REMOVE_MEMBER`, `APP_PRIMARY` ya da `replaces` ile düşer. `hf.uygulama` silinmeyi bilemez (Açık nokta A1).

### 3.4 SDK ve kanal

- Yeni komut numarası yok. `PERSON_IDENTITIES` (362) her kimlik için `appId`'yi kural 5'e göre doldurur; `null` "bilinmiyor" demektir. Bugün yalnız kendi kimliğimiz için kurulumdaki `appId` dönüyor (İstek 113); bu RFC'den sonra kayıttan döner.
- Yazmayı çekirdek kendisi yapar; ürün kodu bir şey çağırmaz.
- SDK'ya yardımcı: `kisiUygulamaDurumu(personId, appId) → 'var' | 'yok' | 'bilinmiyor'` (362'nin sonucundan, istemci tarafında).

## 4. Törende aile adı

### 4.1 Seçenekler

| | Seçenek | Neden |
|---|---------|-------|
| **B1** | **Aile tarafının `JOIN_HELLO`'sunda (öneri)** | 5 resim ekranında görünür; kişi yanlış aileyse resimleri karşılaştırmadan vazgeçer. Kanal Noise içinde, yalnız QR'ı gören bağlanabilir. |
| B2 | QR'da | QR'ı yanından gören ya da fotoğraflayan herkes okur; QR büyür. `famHint` bilerek 8 bayttır. Seçilmedi. |
| B3 | `JOIN_DRAFT`'ın yanında, aile tarafı 5 resmi onayladıktan sonra | QR'ı fotoğraflayan saldırgan aile adını hiç öğrenmez. Ama ad yeni gelenin 5 resim ekranında değil, ancak aile tarafının onayından sonra görünür; yeni gelen için ikinci bir onay adımı gerekir (bugün taslak, yeni gelen önceden onayladıysa hemen imzalanıyor). Seçilmedi; aile tarafının tarayan olduğu törenler için ileride yol olabilir (A2). |

B1 misafir töreninde de geçerlidir (K1): misafir töreninde de QR'ı aile tarafı gösterir (`sdk/ceremony.js` `davet`: üye ve misafir), yani aile tarafı karşının bitini görüp cevap verir.

B1'in bedeli: QR'ı fotoğraflayıp ilk bağlanan saldırgan, 5 resim tutmadan önce aile adını öğrenir. Bugün aynı saldırgan karşının adını ve cihaz adını zaten öğreniyor (`JOIN_HELLO.name`, `device`); QR 60 saniyede yenilenir, en çok 180 saniye yaşar (RFC-0028 §5 d). Sızıntı aynı sınıftadır.

### 4.2 Biçim

```
JOIN_HELLO = deviceCert, name, device, eph, mac, [caps], [familyName]
familyName : c.string, UTF-8, 1–256 bayt
mac        : derive(sec, 'hf/toren/mac', el sıkışma özeti, taraf, u64be(caps)[, familyName])
```

- `familyName` yalnız `caps` içinde `AILE_ADI` (32768) biti varken yazılabilir. Yazılmışsa boş olamaz. Böylece her `JOIN_HELLO`'nun tek kodlaması kalır (RFC-0019 §11.3 d; `caps` için bugünkü kural gibi). Uymayan `INVALID_MESSAGE`.
- `familyName` yazılmışsa MAC'in son parçasıdır; yolda değiştirmek ya da silmek `INVALID_CEREMONY` verir (RFC-0003 §2.2 madde 2'deki `caps` kuralının aynısı).
- `AILE_ADI` biti `HELLO.caps` ve `JOIN_HELLO.caps`'te taşınır. Yalnız törende anlamlıdır; `PROTOCOL_LEVEL` koşuluna girmez (RFC-0015'teki `HIDE_PRESENCE` gibi).

### 4.3 Kurallar

| # | Kural |
|---|-------|
| 1 | **Kim yazar:** Yalnız aile tarafı (defteri olan), yalnız üye töreninde (`kind` 0) ve misafir töreninde (`kind` 3; K1, Kerem 25 Ekim 2026), yalnız gösteren olduğunda (karşının `JOIN_HELLO`'sunu alıp cevap verir; RFC-0028 §5 b) ve karşının `caps`'inde `AILE_ADI` varsa. Değer defterin bugünkü aile adıdır (`GENESIS.familyName`). |
| 2 | **Yazılmaz:** aile tarafının tarayan olduğu törenler (`kind` 1, 2, 4): orada aile ilk yazar, karşının bitini bilemez. Gerek de yoktur: kutu ve bağlı cihaz (1, 2) tam defteri alır ve ekranında aile seçen bir kişi yoktur; ek kimlikte (4) iki cihaz aynı kişinindir ve aile tarafı kişinin kendi örneğidir, hangi aile olduğu o ekranda zaten yazar. Yeni gelen adı `JOIN_LEDGER`'dan öğrenir (bugünkü gibi). Ad 256 bayttan uzunsa yazılmaz. |
| 3 | Aile tarafı, karşıdan gelen `JOIN_HELLO`'da `familyName` görürse töreni kapatır (`INVALID_CEREMONY`): yeni gelen aile adı göndermez. Yeni gelen başka ailelerinin adını hiçbir zaman göndermez. |
| 4 | **Gösterim:** Yeni gelenin (üye ya da misafir) 5 resim ekranı aile adını, karşının adını ve cihazını gösterir. Tören olayı (`sas`, RFC-0024) `aileAdi: string \| null` taşır. Alan yoksa ekran bugünkü gibidir. |
| 5 | **Denetim (üye töreni):** Yeni gelen `JOIN_LEDGER`'ı doğruladıktan sonra defterin aile adını `JOIN_HELLO`'daki adla karşılaştırır. Farklıysa aileye bağlanmaz, `FAMILY_NAME_MISMATCH` ile kapanır, katılım örneği silinir (RFC-0034 §4.3). Aile tarafı bu noktada `ADD_MEMBER`'ı uygulamış olur; bu yalnız değiştirilmiş aile istemcisinde olur ve ebeveyn o üyeyi çıkarır. |
| 5a | **Misafir töreni:** Misafir `JOIN_LEDGER` değil `GUEST_VIEW` alır (RFC-0003 §6.1); `GUEST_VIEW` aile adını taşımaz ve bu RFC'de değişmez (düzey ve biçim değişikliği gerekmesin diye). Karşılaştırma yapılmaz, `FAMILY_NAME_MISMATCH` misafirde yoktur. Gerekçe: adı söyleyen, `GRANT`'ı ve misafirin göreceği her `GUEST_VIEW`'i imzalayan ebeveynin telefonudur; 5 resim misafiri o telefona bağlar. Ad yetki vermez, yalnız gösterilir. Misafir uygulaması adı misafirlik örneğinin yerel durumunda (kayıt değil) saklar ve aile ekranında gösterir; misafirlik düşünce (`GUEST_REVOKED`, RFC-0003 §5.12) örneğin öbür yerel verisiyle birlikte silinir. |
| 6 | **Uyum:** Eski yeni gelen biti göndermez, ad gelmez, tören bugünkü gibi yürür. Eski aile tarafı adı göndermez, yeni gelen "aile adı yok" kipinde gösterir. Eski çözücü sondaki `familyName`'i `INVALID_MESSAGE` ile reddederdi; bit koşulu bu yüzden zorunludur. |

**Tören türlerine göre özet:**

| `kind` | Tören | QR'ı gösteren | Aile adı `JOIN_HELLO`'da | Denetim |
|--------|-------|---------------|--------------------------|---------|
| 0 | Üye | Aile tarafı | Evet (bit varsa) | `JOIN_LEDGER`, `FAMILY_NAME_MISMATCH` |
| 1 | Kutu | Düğüm | Hayır | — (tam defter) |
| 2 | Bağlı cihaz | Düğüm | Hayır | — (tam defter) |
| 3 | Misafir | Aile tarafı | **Evet (bit varsa; K1)** | Yok (`GUEST_VIEW` ad taşımaz; madde 5a) |
| 4 | Ek kimlik | Yeni cihaz | Hayır | — (`JOIN_LEDGER`'da ad zaten var) |

### 4.4 Gizlilik ve bağlantısızlık (RFC-0034)

- Aile adı yalnız aileden o aileye katılan kişiye, Noise içindeki tören oturumunda gider. Üye aynı adı birkaç saniye sonra `JOIN_LEDGER`'da zaten alıyor; yeni olan yalnız zamanlamadır.
- **Misafir (K1, Kerem 25 Ekim 2026):** Misafir bugün aile adını hiç öğrenmiyor (`GUEST_VIEW` taşımaz). Bu RFC'yle öğrenir ve saklar; bu bilinçli bir genişlemedir. Gerekçe: bakıcı ebeveynin yüz yüze davet ettiği kişidir ve aileyi zaten tanır; birden çok ailenin bakıcısı hangi aileye katıldığını onaydan önce görmelidir. Misafire aile listesi, planlar ve bağlar yine gitmez (RFC-0003 §7); giden tek şey ailenin adıdır. Ad misafirin telefonundan öbür ailelere ya da kutuya gitmez; misafir aile adını hiçbir mesajda göndermez.
- Yeni gelen yeni bir şey göndermez (yalnız bir bit). Telefonun öbür ailelerine dair hiçbir değer tören oturumuna girmez. `AILE_ADI` biti bütün örneklerde aynıdır; düşük entropili ortak alanlardandır (RFC-0034 §11 vektör 1: yetenek bitleri, `appId`).
- Kutu, Eser ve DHT gözlemcisi aile adını göremez. `famHint` denetimi (RFC-0034 §4.2) değişmez.
- Çok aileli telefonda kişi (ve birden çok ailenin bakıcısı) hangi örneğe katıldığını onaydan önce görür; yanlış aileye katılma riski azalır.

## 5. Ad değiştirme (yalnız not)

- Bugün kişinin adı da ailenin adı da yalnız bir kez yazılır; değiştirmenin yolu yok. Bu RFC'nin çözdüğü iki soruna engel değildir.
- İki yol var, karar ayrı RFC'de: **(1)** defter olayı (kişi kendi adını, ebeveyn aile adını imzalar): düzey 2.4 ister, kutu ve cihaz da görür. **(2)** kayıt: kişinin adı `kendi` sınıfıyla (§3.3) Tüm Aile'de, aile adı ebeveyn yazarlı kayıtla; düzey gerekmez, ama misafir (`GUEST_VIEW`) ve kutu eski adı görür.
- Aile adı değişebilir hale gelirse §4.3 madde 1 ve 5'teki "aile adı" defterin (ya da kaydın) güncel adı olarak okunur.
- Misafir aile adını törende bir kez alır (§4.3 madde 5a). Ad değişebilir hale gelirse misafirin yeni adı nasıl öğreneceği (ör. `GUEST_VIEW`'e alan) o RFC'nin işidir.
- **Karar (K3, Kerem 25 Ekim 2026):** Ad değiştirme gereklidir; ayrı RFC'de yazılacak. Bu RFC'de yalnız bu not vardır; yol seçimi (1 ya da 2) o RFC'de.

## 6. Uyumluluk ve düzey

| Konu | Etki |
|------|------|
| Defter, olaylar, `PROTOCOL_LEVEL` | Değişmez. Düzey 2.1, 2.2, 2.3 ailelerinin hepsinde çalışır. |
| Eski istemci ve `hf.uygulama` | Bilmediği türü saklar, eşitler, kullanmaz. Katalogda tür olmadığı için `kendi` sınıfını uygulamaz; kayıt onun için anlamsızdır, zarar vermez. |
| Düzey 2.0 aile (mağazadaki Yuva Hat) | Koleksiyon yok; kayıt yazılamaz. O ailede ana kimlikler "bilinmiyor" kalır. Yuva Hat çekirdeği taşıyınca (kurucu §18.4) düzelir. |
| Tören | Bit koşullu; dört karışımın hepsi çalışır (§4.3 madde 6). |
| RFC-0034 | Kayıt ve bit aile örneği başınadır; ortak yüksek entropili değer yok. |

## 7. Güvenlik değerlendirmesi

| Tehdit | Önlem |
|--------|-------|
| Bir üye başkasının uygulamasını değiştirir ya da "bilinmiyor"a düşürür | `kendi` yazar sınıfı; `_subj` yazarla aynı ve çözülmez (§3.3 madde 2–3) |
| Eski telefonun kaydı yeni telefona geçer | `_subj` çözülmez; pasif kimliğin kaydı sayılmaz |
| Kişi kendi için yalan söyler ("Acil var") | Değiştirilmiş istemci; yetki vermez, yalnız gösterimi etkiler. Bugünkü `APP_ATTACH.appId` de beyandır. |
| Kutu ya da Eser kişilerin uygulamalarını görür | Kayıt şifreli; kutu anahtar almaz. (`APP_ATTACH.appId` defterde olduğu için kutu bugün de görüyor; değişmez.) |
| Cihaz ya da misafir uygulama kaydı yazar | Misafir Tüm Aile'ye yazamaz; cihaz `kendi` sınıfına uymaz |
| QR'ı fotoğraflayan aile adını öğrenir | Aynı saldırgan bugün ad ve cihazı öğreniyor; QR ömrü kısa; B3 alternatifi (§4.1) |
| Aile tarafı sahte aile adı gösterir | `JOIN_LEDGER` karşılaştırması, `FAMILY_NAME_MISMATCH` |
| Yolda ad ya da bit eklenir, silinir | MAC (§4.2) |
| Misafir aile adını öğrenir | Kabul edildi (K1): misafir ebeveynin yüz yüze davet ettiği kişidir; ad yalnız Noise içindeki tören oturumunda, yalnız misafir biti bildirdiyse gider; aile listesi ve plan gitmez (§4.4) |
| Ebeveynin telefonu misafire sahte aile adı gösterir | `GUEST_VIEW` ad taşımadığı için denetlenmez; adı söyleyen, misafirin göreceği her şeyi zaten imzalayan ebeveyndir; ad yetki vermez (§4.3 madde 5a) |
| Kişi uygulamalarını gizlemek ister | Gizleme yok (K2); yalnız ürün adı bildirilir, kullanım bilgisi yok |

## 8. Hata kodları

| Kod | Nerede | Anlam |
|-----|--------|-------|
| `FAMILY_NAME_MISMATCH` | Üye töreni, yeni gelen | `JOIN_HELLO`'daki ad defterdekinden farklı (yeni; misafir töreninde yok) |
| `INVALID_MESSAGE` | `JOIN_HELLO` çözme | Bit yokken ad, boş ad, 256 bayttan uzun ad (anlam genişler) |
| `INVALID_CEREMONY` | Tören | MAC tutmuyor; yeni gelenden ad geldi (anlam genişler) |

`hf.uygulama` için hata kodu yoktur: kurala uymayan işlem görünüme girmez, kayıt yok sayılır.

## 9. Test vektörleri

Yeni dosyalar (var olanlar değişmez): `protocol/vectors/ceremony-family-name.json`, `protocol/vectors/app-record.json`; testler `core/transport/test/` ve `core/records/test/` altında.

1. `JOIN_HELLO`: `familyName`'li kodlama ve MAC; kanonik: bitsiz ad, boş ad, 257 bayt → `INVALID_MESSAGE`.
2. Bugünkü çözücü `familyName`'li `JOIN_HELLO`'yu reddeder (bit koşulunun gerekçesi); aile tarafı bitsiz karşıya adı yazmaz.
3. Yolda ad değiştirilir ya da silinir → `INVALID_CEREMONY`.
4. `JOIN_LEDGER`'daki ad farklı → `FAMILY_NAME_MISMATCH`, katılım örneği silinir.
5. `kind` 1, 2, 4 → ad yok. Yeni gelen (her tür, misafir dahil) ad gönderir → `INVALID_CEREMONY`.
5a. `kind` 3 (misafir): misafir bit gönderir → aile tarafının `JOIN_HELLO`'sunda ad var, MAC kapsar, `sas.aileAdi` dolu; ardından `GUEST_VIEW` gelir, karşılaştırma yapılmaz ve `FAMILY_NAME_MISMATCH` üretilmez; ad misafir örneğinin durumunda saklanır. Misafir bit göndermezse ad yok.
6. `sas` olayında `aileAdi`; eski aile tarafıyla `null`.
7. `hf.uygulama` kimliğin kendisinden → kişinin uygulamalarında. Başka üyenin aynı kayda `put`'u → görünüme girmez, değer değişmez. `_subj` yazardan farklı → yok sayılır.
8. Ek kimliğin kaydı `APP_ATTACH.appId`'den farklı → defter geçerli.
9. Üç durum: ana kimlik kayıtsız + ek kimlik `yuva-hat` → Acil "bilinmiyor"; ana kimlik `yuva-acil` → "var"; bütün kimlikler bilinen ve hiçbiri Acil değil → "yok".
10. `ROTATE_DEVICE`: eski kimliğin kaydı yeni kimliğe geçmez; yeni kimlik yazana kadar "bilinmiyor".
11. Cihaz `hf.uygulama` yazar → görünüme girmez.
12. Bugünkü sürüm (kataloğunda tür yok) kaydı hata vermeden eşitler.

## 10. Kurucu belgede değişecekler (1.21)

| Bölüm | Değişiklik |
|-------|------------|
| Başlık | Sürüm 1.21; RFC-0036. |
| §6.1 madde 1 | "Kimliğin uygulaması ek kimlikte `APP_ATTACH`'te, her kimlikte kendi `hf.uygulama` kaydındadır; bilinmeyen uygulama 'yok' sayılmaz (RFC-0036)." |
| §6.4 | "Üye ve misafir töreninde aile tarafı, yeni gelen `AILE_ADI` bitini bildirdiyse aile adını `JOIN_HELLO`'da gönderir; yeni gelen 5 resim ekranında gösterir. Üye adı `JOIN_LEDGER`'la karşılaştırır; misafir karşılaştırmaz, adı saklar (RFC-0036)." |
| §7.7 | Not: "Her kimlik kendi uygulamasını Tüm Aile'ye `hf.uygulama` kaydıyla bildirir; yalnız kendisi yazar; kişi gizleyemez." |
| §13.1 | T31: "Bir üye başkasının uygulama bilgisini değiştirir" · "`kendi` yazar sınıfı (RFC-0036 §3.3)". |
| §22.1 | HF68 (aşağıda). |

**HF68:** Kimliğin uygulaması defterde değil, kimliğin kendi yazdığı `hf.uygulama` kaydındadır (ek kimlikte `APP_ATTACH.appId` geçerli kalır); kişinin bir uygulaması "var", "yok" ya da "bilinmiyor"dur; kişi uygulamalarını aileden gizleyemez. Üye ve misafir töreninde aile adı, yeni gelen biti bildirdiyse aile tarafının `JOIN_HELLO`'sunda gider; misafir de görür. Ad değiştirme ayrı RFC'de (RFC-0036). — Gerekçe: Yuva Acil denemesinde ana kimlikle katılan kişi "Acil yok" görünüyordu; katılan hangi aileye katıldığını onaydan önce göremiyordu (Kerem, 25 Ekim 2026).

## 11. Diğer RFC'lerde değişecekler

| RFC | Yer | Değişiklik |
|-----|-----|------------|
| 0003 | §2.2 madde 2 | `JOIN_HELLO`'nun sonuna `familyName` (RFC-0036 §4.2). |
| 0003 | §10 | HELLO bitlerine `AILE_ADI 32768` (RFC-0036). |
| 0003 | §6.1, §7 | Misafir töreninde aile adı `JOIN_HELLO`'dan gelir; `GUEST_VIEW` değişmez (RFC-0036 §4.3 madde 5a). |
| 0006 | §6.2 | Tabloya `hf.uygulama` · kimliğin uygulaması · kimliğin kendisi · RFC-0036 §3. |
| 0015 | §2.2 | `_subj` olay olmayan `hf.uygulama`da da kullanılır ve orada çözülmez. |
| 0017 | §3, §5, §13 | `appId` tanımına: "Ana kimliğinki `hf.uygulama` kaydında." Kişiye göre çözümlemeye kişinin uygulamaları ve üç durum. 362'nin `appId`'si kayıttan. |
| 0019 | §11.1 l | Yazar sınıflarına `kendi`. |
| 0024 | Tören olayı | `sas` verisine `aileAdi`. |
| 0028 | §5 a–b | `JOIN_HELLO`'da aile adı, kim yazar, `JOIN_LEDGER` denetimi. |
| 0029 | §4.2, §4.6 | "Yuva Acil'i yükle" ve "internet yokken ona ulaşamayız" yalnız "yok" durumunda; "bilinmiyor" ayrı gösterilir. |
| 0034 | §4.1 | Madde 8'in yanına: aile adı törende aileden yeni gelene gider; yeni gelen başka ailelerine dair bir şey göndermez (RFC-0036 §4.4). |
| `protocol/event-types.json` | | `hf.uygulama` (`olay: false`, `yazar: 'kendi'`, koleksiyon Tüm Aile). |

## 12. Ürün belgelerine etkisi

| Ürün | Yer | Değişiklik |
|------|-----|------------|
| Yuva Acil | `docs/01` §5 "Yuva Acil var mı" | `APP_ATTACH` yerine §3.3 madde 6: var / yok / bilinmiyor. LA41'in "bilinmiyor"u kural olur. |
| Yuva Acil | A49 (aile listesi), A16, A17, A38 | Üç durum. "Yuva Acil yok · internetsiz ulaşılamaz" yalnız "yok"ta. "Bilinmiyor" metni Acil belgesinin işi. |
| Yuva Acil | A24 ve ortak SOS ekranı (RFC-0029 §4.2) | Uygulama durumuna bağlı her satır ve "Yuva Acil'i yükle" önerisi aynı üç durumlu kuralı kullanır. |
| Yuva Acil | A09–A11 (kod okut, beş resim, katıldın) | Beş resim ekranı aile adını gösterir; ad yoksa bugünkü gibi. |
| Yuva Pati | `cekirdek/ESLEME.md` `patiVar` | 362'nin `appId`'si kayıttan gelir; `null` "bilinmiyor". |
| Yuva Bakım | Kişinin Bakım'ı var mı gösterimi | Aynı kural. Tören ekranında aile adı (B86, çok aileli telefonda özellikle). |
| Bütün ürünler | "Misafir olarak katıl" akışı (bakıcı) | Beş resim ekranı ve misafirin aile ekranı aile adını gösterir (K1); ad yoksa bugünkü gibi. |
| Yuva Defteri, Yuva Hat | — | Çekirdek kaydı kendisi yazar; ürün işi yok. Yuva Hat çekirdek taşınınca alır. |

## 13. Açık noktalar

**Kerem kararları (25 Ekim 2026):**

| # | Konu | Taslaktaki varsayılan | Karar |
|---|------|------------------------|-------|
| K1 | Misafir töreninde (bakıcı) aile adı gösterilsin mi | Hayır | **Evet, misafir de görür.** Misafir töreninde de aile tarafı adı `JOIN_HELLO`'ya ekler (§4.3 madde 1, 5a; §4.4). Taslak önerisinden farklı. |
| K2 | Kişi uygulamalarını aileden gizleyebilsin mi | Gizleme yok | **Gizleme yok** (öneri kabul; §3.3 madde 1). |
| K3 | Kişi ve aile adını değiştirme gerekli mi | Bu RFC'de yok | **Gerekli; ayrı RFC'de yazılacak** (Kerem kararı; §5). |

**Teknik açık noktalar:**

| # | Konu |
|---|------|
| A1 | Silinen uygulamanın kimliği defterde aktif kalır; "var" bayatlayabilir. RFC-0017'den kalan sınır; ayrı ele alınır. |
| A2 | ~~Aile tarafının tarayan olduğu törenlerde ad yok.~~ Çözüldü (§4.3 madde 2): `kind` 1, 2, 4'te ada gerek yok. Bir ürün ileride isterse B3 yolu (§4.1). |
| A3 | Ekipte (Mekan) kayıt koleksiyonu: Ekip (RFC-0005 §8.4); Mekan uygulamaları Havenfold'a geçince kesinleşir. |

## 14. Uygulama sırası (dell)

1. **Kayıt türü (dell D96):** katalogda `hf.uygulama`; `core/records/class.js`'te `kendi` sınıfı (yazarı ve `_subj`'i bilen denetim); worklet'te yazma tetikleri (§3.3 madde 4); 362'nin `appId`'si; SDK `kisiUygulamaDurumu`. Vektörler 7–12. Bu adım Acil'in 1. sorununu kapatır.
2. **Tören (dell D97):** `core/core/protocol/join-hello.js` (`familyName`, kanonik kural), `core/core/protocol/hello.js` (`AILE_ADI`), `core/transport/ceremony.js` (kim yazar: `kind` 0 ve 3, MAC, `sas.aileAdi`, `JOIN_LEDGER` denetimi, misafir örneğinde adın saklanması). Vektörler 1–6 ve 5a.
3. **Mac:** ~~kurucu belge 1.21~~ (işlendi, 25 Ekim 2026), §11'deki RFC ekleri, bağımsız inceleme.
4. **lenovo (Yuva Acil):** §12 satırları; sonra gerçek iki telefonla yeniden deneme. Pati ve Bakım aynı SDK yardımcısını kullanır.

## 15. Geri dönüş yolu

- Defter değişmediği için geri alınacak protokol durumu yok.
- `hf.uygulama` kayıtları zararsızdır; okumayı bırakmak yeter, ürünler "bilinmiyor"a döner.
- `familyName` yazmayı bırakan aile tarafıyla tören bugünkü gibi yürür; bit tek başına bir şey değiştirmez.
