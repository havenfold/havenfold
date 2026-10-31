# RFC-0034 — Bir telefonda birden çok aile

> Durum: **Onaylandı** (Kerem, 25 Ekim 2026; K1–K4 Mac önerileri kabul), kurucu belge 1.19 · 25 Ekim 2026 · Yazan: Havenfold çekirdek ekibi · Onay: Kerem
> Kaynak: Yuva Bakım `docs/07` YB6 ve H4, `docs/01` §2.1, `docs/02` §2 (B86, B87); EserX `yuva/docs/18-aile-agi.md` §4, §9, §11 (Sürüm 3).
> Kurucu belge: §4, §6.1, §6.2, §10, §11, §13.1, §22. Etkilenen RFC'ler: 0001 (§14), 0004 (§3, §5), 0006 (§11.3), 0009 (§6), 0015 (§4), 0017 (§6, §9, §11, §13), 0024 (§2), 0027 (§5), 0028 (§4, §5, §7 f–h), 0029 (§4), 0031 (§3).
> **Defterde protokol değişikliği yok.** Yeni defter olayı, düzey ve HELLO biti yok. Değişenler: kanal çerçevesine `aile` alanı (RFC-0024), kanal komutları 420–429, yalnız yerel kanalda geçen `0xEB APP_PAIR_REQ2` (RFC-0017 aralığından), K1 kabul edilirse `hf.aile-izni` kayıt türü, K2 kabul edilirse `hf.sos.ortakMid` alanı.
> **Kapsam dışı:** aile bağı (`LINK`/`UNLINK`), geniş aile sohbeti ve `INTRO` (EserX 18 §5–§6; ayrı RFC). Bu RFC yalnız "bir telefon birden çok ailenin üyesi" kısmını tanımlar.

## 1. Sorun

- Yuva Bakım v0, yalnız yaşayan yaşlının kendi ailesine dayanır (YB6): "Elena'nın evi"nde Elena kurucu ebeveyndir, onu takip eden Rosa ve Alex yetişkindir. Rosa'nın telefonunda iki aile olur: "Rivera ailesi" ve "Elena'nın evi".
- Çekirdek bugün bir telefonda (bir uygulamada) tek aile taşır:
  - `worklet/persistence.js`: dizinde tek `kimlik` ve tek `durum` dosyası; ikinci aile `FAMILY_EXISTS` verir.
  - `worklet/start.js`: tek `Kalici`, tek SDK nesne kümesi, tek eşitleyici, tek taşıyıcı cihazı; ikinci `baslat` `ALREADY_STARTED`.
  - `sdk/api.js`: bir `LedgerApi` = bir defter. Kanal çerçevesinde (RFC-0024 §2) aile seçimi yok.
- Yuva Bakım ikinci aileyi bugün taklitle gösteriyor (`cekirdek/taklit.ts`, `ESLEME.md` §2 "`aileler()` yok"). Gerçek çekirdekle Bakım v0 çıkamaz.
- RFC-0001 §14 "bir telefon 3 topluluğa üye olabilir" der ama kimliğin, kalıcı durumun, taşıyıcının ve SDK'nın nasıl ayrılacağını tanımlamaz.

## 2. Öneri özeti

1. Telefon her aile üyeliği için **ayrı kimlik** üretir: ayrı ÜKA, ÜDA, cihaz sertifikası, kişi kimliği. İki ailenin defterinde ortak bir anahtar ya da kimlik görünmez. Aileler birbirini protokolde görmez.
2. Telefon en çok **3 ailede** üye olur. Sınır tekniktir, ücretle değişmez. Defterler birbirini görmediği için sınırı telefon uygular.
3. Worklet **tek süreçtir**; içinde **aile başına bir çekirdek örneği** çalışır: ayrı kalıcı durum, ayrı kasa, ayrı SDK nesneleri, ayrı eşitleyici, ayrı ürün sunucusu.
4. **Tek HyperDHT düğümü** bütün örneklere hizmet eder. Buluşma anahtarları zaten çift sırrından türetilir; aileler anahtar düzeyinde bağlanamaz. IP düzeyinde bağlanabilirler; bu RFC-0028 §8'in kabul ettiği sınırdır ve kullanıcıya söylenir.
5. Kanal çerçevesine `aile` alanı gelir. Birden çok aile varken `aile` alanı olmayan aileye özgü komut reddedilir (`FAMILY_AMBIGUOUS`): yanlış aileye yazmak, bu RFC'nin önlemek istediği sızıntının ta kendisidir.
6. Aileden ayrılmak, çıkarılmak ya da bir örneğin bozulması yalnız o örneği etkiler.
7. Bugünkü tek aileli kurulumlar dosya taşımadan çalışmayı sürdürür. Bugünkü dizin "kök örnek" olur.
8. RFC-0017 her ailede ayrı çalışır: her ailede kişinin ayrı ana kimliği ve ek kimlikleri vardır. Aynı uygulama bir ailede ana, öbüründe ek kimlik olabilir.

## 3. Tanımlar

| Terim | Anlam |
|-------|-------|
| **Aile örneği** | Bir uygulamanın worklet'inde bir aile üyeliğini taşıyan çekirdek: kimlik, defter, replika, kasa, eşitleyici, SDK nesneleri, ürün sunucusu. |
| **Kök örnek** | Uygulama dizininin kökündeki örnek. Bugünkü tek aileli düzendir. Ailesiz de olabilir (RFC-0017 §6.4). Her zaman vardır. |
| **Ek örnek** | `aileler/<yerelNo>/` altındaki örnek. |
| **`yerelNo`** | Örneğin telefondaki adı: 16 bayt rastgele, hex. Telefondan çıkmaz; hiçbir zarfa, kayda ya da yerel kanal mesajına yazılmaz. Kanal çerçevesinde aileyi seçer. |
| **Aile listesi** | Telefondaki bütün Eser uygulamalarının örneklerinin `familyId` birleşimi (yerel kanaldan, RFC-0017 §6.1). 3 sınırı bunu sayar. |
| **Bağlantısızlık** | Dışarıdan bakan biri (Eser, kutu, DHT gözlemcisi, yalnız bir ailenin üyesi) protokol verisinden iki üyeliğin aynı telefona ait olduğunu çıkaramaz. |

## 4. Kurallar

### 4.1 Kimlik ve bağlantısızlık

| # | Kural |
|---|-------|
| 1 | Her örneğin kimliği `createIdentity()` ile **bağımsız rastgele** üretilir. Ortak tohumdan türetilmez (§16). |
| 2 | Kişi kimliği (`personId`, RFC-0017 §3) her ailede o ailedeki ilk ana kimliğin `rootId`'sidir. Aileler arasında ortak değildir. |
| 3 | Cihaz sertifikası her örnekte ayrıdır. `createdAt` örneğin kendi oluşturma anıdır. Cihaz adı sertifikaya girmez (bugün de girmiyor). |
| 4 | Donanıma bağlı anahtar (sertifikanın `dbaPub`'ı; bugün boş) geldiğinde **her örnek için ayrı** üretilir. Cihazda tek donanım anahtarını bütün ailelerde kullanmak yasaktır. |
| 5 | YA `secretId`'si `familyId` içerir (RFC-0004 §4.2); zaten ailelere göre ayrıdır. |
| 6 | Zil bileti, Bağlantı jetonu ve ileride gelecek her hizmet belirteci **örnek başınadır**. Aynı belirteç iki ailenin trafiğinde kullanılmaz (§14, RFC-0009). |
| 7 | Bir ailenin kaydı, dosyası ya da anahtarı başka bir aileye çekirdek tarafından taşınmaz (RFC-0001 §14). SDK'da aileler arası kopyalama yöntemi yoktur. Kişinin kendi verisini (ör. kendi telefon numarası, Bakım YB16) her ailede ayrı yazması kişinin açık eylemiyle olur; ürün bunu ailelere tek tek yazar. Dosya her ailede yeni `fileKey`'le şifrelenir, `blobId` farklı olur (RFC-0001 §11.1). |
| 8 | Görünen ad ve fotoğraf kullanıcı içeriğidir; aynı seçilirse iki ailenin ortak üyesi bunu görür. Bu protokol sızıntısı değildir; zaten iki ailede de yüz yüze tanışılmıştır. |
| 9 | Telefon başka bir kişiyi aileler arasında **birleştirmez**. "Rosa (Rivera ailesi)" ile "Rosa (Elena'nın evi)" telefonda iki ayrı kişidir. Yalnız telefonun kendi örnekleri yerelde birbirini bilir. |

### 4.2 Sınırlar

| Sınır | Değer | Kim uygular |
|-------|-------|-------------|
| Bir telefonun üye olduğu aile | **3** | Telefon. Aile listesi (§3) sayılır; yerel kanal yoksa uygulamanın kendi örnekleri. Defter göremez. |
| Aynı aileye iki kez üyelik | Yasak | Telefon: törenden önce QR'daki `famHint` (RFC-0028 §5 a) aile listesiyle karşılaştırılır; `JOIN_LEDGER` gelince `familyId` yeniden denetlenir. İkisinde de `FAMILY_EXISTS`, katılım örneği silinir. |
| Aynı anda süren katılım | 1 | Worklet (`JOIN_IN_PROGRESS`) |
| Kutu, uç ya da işçi olan telefon | Yalnız 1 örnek | Worklet (`DEVICE_SINGLE_COMMUNITY`); kurucu §6.2 son satırı aynen |
| Her ailede rol | Tek | Doğal sonuç: her ailede tek kimlik |

- Sınırlar ücretle değişmez (EserX 18 §9).
- **Dürüst sınır:** Değiştirilmiş bir istemci 3 sınırını aşabilir. Her ailenin katılımı yine o ailenin ebeveynlerinin yüz yüze töreniyle olur; sınırın amacı ürünü "topluluk sohbeti" olmaktan uzak tutmaktır, güvenlik değil.

### 4.3 Bir aileye daha katılmak ya da aile kurmak

- **Kurma:** `FAMILY_ADD` (421) yeni ek örnek açar, kimliği üretir, GENESIS'i yazar (`LedgerApi.createFamily`; kurucunun bildiği en yüksek düzey). `CREATE_FAMILY` (2) bugünkü gibi yalnız kök örnek ailesizken çalışır.
- **Katılma:** `JOIN_PREPARE` (422) katılım örneği açar (`durum: 'katiliyor'`), yeni kimliği üretir ve `yerelNo`'yu döner. Kök örnek ailesizse kök örneği döner (bugünkü akış). Tören bugünkü komutlarla (`JOIN` 5) ve çerçevede bu `aile` ile yürür. Tören kapanırsa ya da 10 dakikada bitmezse katılım örneği silinir.
- **Davet:** `INVITE_START` (3) çerçevedeki ailenin örneğinden QR gösterir. Ürün davetten önce hangi aileye davet edildiğini ekranda yazar.
- Uzaktan katılım (EserX 18 §8.1), misafir ve kutu törenleri örnek içinde aynen çalışır.

**Örnek akış (Bakım B86):**

1. Elena'nın telefonunda Yuva Bakım kurulur. Kök örnek "Elena'nın evi"ni kurar; Elena kurucu ebeveyndir. QR gösterir.
2. Rosa'nın telefonunda Yuva Bakım "Rivera ailesi"nde ek kimliktir (kök örnek, RFC-0017). B86'da Bakım 422'yi çağırır, yeni örnek açılır.
3. Rosa QR'ı okutur, 5 resim karşılaştırılır. Elena yetişkin eklemeyi imzalar. Yeni örnekte Rosa'nın "Elena'nın evi" kimliği ana kimliktir (o ailede ilk uygulamadır).
4. Bakım B87'de iki aileyi `FAMILIES` (420) listesinden sekme olarak gösterir.

### 4.4 Çocuk rolündeki telefon

Defter, çocuğun başka bir aileye katıldığını göremez; aile A'nın ebeveynine bunu soracak protokol yolu bağlantısızlığı bozar. Bu yüzden kural telefondadır. **Kural (K1, Kerem kararı 25 Ekim 2026):**

- Telefonun herhangi bir örneğinde rolü `cocuk` ise, bu telefon yeni aile kuramaz ve yeni aileye katılamaz; ancak çocuk olduğu **her** ailede geçerli bir ebeveyn izni varsa olur.
- İzin, o ailenin Tüm Aile koleksiyonunda `hf.aile-izni` kaydıdır: `{ _subj: 'uye:<çocuk>', gecerli: <ms> }`; yazarı o ailenin ebeveyni olmalıdır; `gecerli` yazılıştan en çok 7 gün sonradır. Komut 425.
- İzin yalnız A'nın içinde kalır. Katılınan aileye hiçbir şey gitmez. A'nın ebeveyni çocuğun hangi aileye katıldığını protokolden öğrenmez; izin ekranında çocuk aile adını kendisi söyler.
- İzin tek kullanımlıktır (telefon kullandığını yerelde tutar). `SET_ROLE` ile `yetiskin` olan çocukta kural kalkar.
- Kural istemci kuralıdır; değiştirilmiş istemci aşabilir. Katılınan ailenin ebeveynleri yine yüz yüze imzalar.
- **Başka uygulamadaki çocukluk (Codex 10. tur, 28 Ekim 2026):** Yerel kanal aile listesi her aile için `rol`'ü taşır (§4.6). Telefon başka bir Eser uygulamasında bir ailede `cocuk` ise bu uygulamada yeni aile kuramaz ve yeni aileye katılamaz (`CHILD_IN_OTHER_APP`). İzin o uygulamanın defterinde olduğu için burada doğrulanamaz; kural tutucudur: aile, çocuğun olduğu uygulamadan kurulur ya da katılınır, bu uygulama sonra eşleşmeyle (RFC-0017 §6.2) eklenir. Telefonun başka uygulamada zaten üyesi olduğu aileye eşleşme yeni aile sayılmaz: sınır, cihaz ve çocuk kuralı uygulanmaz. Rolü taşımayan eski liste (yalnız `familyId`) için bu kural uygulanamaz; worklet iki biçimi de kabul eder (`baslat({ yerelAileler })`).

Alternatifler §16'da: kural yok, tamamen yasak.

### 4.5 Ayrılma, çıkarılma ve silme

| Durum | Ne olur |
|-------|---------|
| Kişi ayrılır (`FAMILY_LEAVE`, 423) | O örnekte `LEAVE` yazılır ve gönderilir. Örnek `silinecek` olur; `LEAVE` en az bir üyeye ya da kutuya ulaşınca, ulaşmazsa 72 saat sonra yerel olarak silinir. |
| Aile kişiyi çıkarır (`REMOVE_MEMBER`, `wipe: true`) | Yalnız o örnek silinir. Diğer örneklerin dosyası, sayacı ve oturumu değişmez. |
| Aile kişiyi çıkarır (`wipe: false`) | Örnek salt okunur kalır (bugünkü davranış); kişi `FAMILY_LOCAL_REMOVE` (424) ile siler. |
| Bu telefon için imzasız `ROTATE_DEVICE` | Yalnız o ailenin örneği silme emri alır (RFC-0017 §4.3 cihaz grubu aile içindedir). |
| Örneğin dosyaları bozuk ya da geri alınmış | Yalnız o örnek açılmaz; `aile-hata { aile, hata }` olayı gider (`STATE_CORRUPT`, `STATE_ROLLED_BACK`). Diğer örnekler açılır. Bugün tek örnekte açılış tümden durur; bu RFC bunu örnek düzeyine indirir. |
| Uygulamanın tümden silinmesi (`WIPE` 20) | Bütün örnekler. Ürün onay ekranında aileleri tek tek sayar. |
| Platform anahtarı kaybolur (yeniden kurulum) | Bütün örnekler gider (bugünkü gibi). Kurtarma aile başına yapılır (§7). |

- **Silme sırası:** Önce örnek dizinine `silinecek` işareti yazılır, sonra dosyalar silinir, en son sayaç haritasından çıkarılır (§5.2). Yarıda kalan silme açılışta tamamlanır.
- Kök örneğin ailesi biterse kök örnek sıfırlanır: dosyaları silinir, yeni ailesiz kimlik üretilir.
- Silinen örneğin planlanmış yerel bildirimlerini uygulama `aile-silindi { aile }` olayıyla iptal eder.

### 4.6 RFC-0017 ile birlikte

- RFC-0017'nin bütün kuralları **aile başınadır**. Kişi, ana kimlik, ek kimlik, cihaz grubu, `APP_PRIMARY`, `replaces` hep tek bir defterin içindedir.
- Örnek: Rosa'nın telefonunda Yuva Hat ve Yuva Bakım.

  | Aile | Yuva Hat | Yuva Bakım |
  |------|----------|------------|
  | Rivera ailesi | ana kimlik (ilk kuran) | ek kimlik (`APP_ATTACH`) |
  | Elena'nın evi | yok | ana kimlik |

  Dört kimlik vardır; üçü iki defterde görünür, aralarında ortak anahtar yoktur.
- **Yerel kanal (RFC-0017 §6.1):** Uygulamanın kanala bıraktığı bilgi aile listesini taşır: her örnek için `{ familyId, ad, rol, kimlik: 'ana' | 'ek' }`. Kanal yalnız Eser'in imzalı uygulamalarına açık olduğu için `familyId` orada kalabilir.
- **Eşleşme:** Yeni uygulama hangi aileye eklenmek istediğini söyler. Yeni zarf, yalnız yerel kanalda:

  ```
  APP_PAIR_REQ2 (0xEB) { deviceCert, appId: string, nonce: fixed32, familyId: fixed32 }
  ```

  - Eski uygulama yalnız `familyId`'si kendi örneklerinden birinde olan isteği kabul eder; yoksa `NO_FAMILY`. Biyometri ekranı aile adını yazar.
  - Yeni uygulama her aile için ayrı istek ve ayrı kimlik üretir. Kök örneği doluysa yeni ek örnek açar.
  - Tek aileli eski uygulama (bugünkü sürümler) `APP_PAIR_REQ` (0xE8) ile eşleşir ve tek ailesine ekler; yeni uygulama karşı taraf `0xEB`'yi bilmiyorsa `0xE8`'e düşer.
  - `PAIR_REQUEST` (360) gövdesine `familyId` eklenir. Ağdan gelen `0xEB` atılır.
- **`APP_LOCAL_SYNC` (0xEA)** aynı ailedeki iki kimlik arasında kalır; mühür o çiftin sırrıdır. Farklı ailelerin örnekleri arasında yerel eşitleme yoktur.
- **Ailesiz kişisel mod (RFC-0017 §6.4):** Bekleyen veri düzey gelince hangi ailenin Kişisel koleksiyonuna taşınacağını kişi seçer; tek aile varsa ona.

## 5. Worklet ve kalıcı durum

### 5.1 Tek süreç, aile başına çekirdek örneği (karar)

- `baslat()` tek örnek kalır (`ALREADY_STARTED` aynen). İçinde `Map<yerelNo, örnek>` tutar.
- Her örnekte ayrı: `Kalici`, `ledger`, `replika`, `kayit`, `defter`, `gorev`, `gorulme`, `kasa`, `Esitleyici`, taşıyıcı cihazı, `urunSunucusu(c)` ile kurulan ürün sunucusu, `c.zamanla` işleri, `c.urunSaklama`.
- Ortak: IPC bağı, HyperDHT düğümü, platform anahtarı (türetmeyle ayrılır), Arşiv açık anahtarı, dizin kilidi, açılan dosyaların geçici klasörü.
- Ürün sunucusu her örnek için bir kez kurulur. Ürün kodu bugünkü gibi tek aileye göre yazılır; çerçeve yönlendirmesini worklet yapar.
- Bir örneğin yakalanmamış hatası yalnız o örneği durdurur (`aile-hata`); diğerleri çalışır.
- Gerekçe ve öbür iki seçenek: §16.

### 5.2 Dizin düzeni ve şifreleme

```
<dizin>/kilit                         süreç kilidi (bütün örnekler)
<dizin>/kimlik, hlc, durum, arsiv     kök örnek (bugünkü düzen; taşınmaz)
<dizin>/dosyalar/, gomme/             kök örnek
<dizin>/aileler/<yerelNo>/            ek örnek: kimlik, hlc, durum, arsiv, dosyalar/, gomme/, (silinecek)
```

- Klasör adında `familyId` yoktur. RFC-0001 §14'teki `hat/families/<familyId hex>/` düzeni bunun yerine geçer: yedeğe girmese de diskteki dosya adı aile kimliğini açık yazmamalıdır.
- Şifreleme anahtarı: kök örnekte bugünkü `derive(platform anahtarı, 'hf/worklet/kalici')`; ek örnekte `derive(platform anahtarı, 'hf/worklet/kalici', yerelNo)`.
- AD'deki dosya adı örneğin yolunu içerir (`aileler/<yerelNo>/durum`). Bir ailenin dosyası öbürünün yerine konamaz.
- **Sayaçlar (RFC-0027 §5 c):** Uygulama platform kasasında örnek başına sayaç tutar: `{ kok: n, <yerelNo>: n }`. `baslat({ sayaclar })` bunları alır; bugünkü `sayac` kök örneğin sayacıdır. `kalici` olayı `aile` taşır; `sayac: null` örneğin silindiğini söyler. Haritada olup diskte olmayan örnek `STATE_ROLLED_BACK` ile açılmaz; diğerleri açılır.
- `yerelNo` örneğin `durum` dosyasına da yazılır. Kök örneğe ilk açılışta bir `yerelNo` verilir.

### 5.3 Kasa kilidi

- Arşiv anahtarı cihazda tektir; her örneğin `arsiv` dosyası onunla mühürlenir.
- `UNLOCK` (224) ve `LOCK` (19) çerçevedeki ailenin kasasını açar ve kapatır. 5 dakika işlemsizlik kilidi örnek başınadır. Gerekçe: her ailenin kasası ayrı bir güvenlik sınırıdır; bir ailede açılan kasa öbürünü açmamalıdır.

## 6. Taşıyıcı ve eşitleme

- **Tek düğüm:** `T.dhtAc()` bir kez çağrılır. Her örnek kendi `DhtTasiyici`'sini ve tören taşıyıcısını aynı `dht` ile kurar. RFC-0028 §7 f "uygulama başına tek düğüm" olarak okunur.
- **Anahtarlar:** Buluşma anahtarları çift sırrından türetilir (RFC-0028 §4 a); çift sırrı `familyId` ve iki ÜDA'yı içerir. İki ailenin dinleme ve arama anahtarları ortak bir değer taşımaz. Konu duyurusu yoktur.
- **HELLO:** Değişmez. `familyId` HELLO'dadır; bir ailenin sunucusuna öbür ailenin üyesi gelirse güvenlik duvarı el sıkışmadan önce, geçerse HELLO reddeder.
- **Trafik analizi:** DHT gözlemcisi iki ailenin sunucularının aynı IP ve porttan geldiğini görebilir. Aile başına ayrı düğüm bunu çözmez: NAT arkasında IP yine aynıdır. Zamanlama gizlemesi de IP aynı olduğu için ek koruma sağlamaz; yapılmaz. Bu sınır RFC-0028 §8'deki "IP düzeyinde görülebilir" kabulünün aynısıdır ve kurucu §11'e yazılır.
- **Dinleme bütçesi (RFC-0028 §7 g–h):** "En çok 16 dinleme sunucusu" **telefon geneline** uygulanır. Kutulu ailede arka planda yalnız kutu dinlenir (1 sunucu). Kalan bütçe kutusuz ailelere üye sayısıyla orantılı paylaştırılır; uygulama öndeyken ekrandaki aileye öncelik verilir. Üç kutusuz 8 kişilik aile (21 çift) bütçeyi aşar; o zaman çiftler sırayla dinlenir. Sayılar dell ölçümüyle kesinleşir (Açık nokta A1).
- **Eşitleyici:** Örnek başınadır. Bir ailenin çıkış kutusu, emaneti ve önerileri öbürüne karışmaz.
- **Arka plan:** `arkaPlan(bool)` ve Bare `suspend`/`resume` bütün örneklere birlikte uygulanır.

## 7. Kasa ve yedek

- Her örneğin kendi YA'sı, yedek dizini ve pay sahipleri vardır; pay sahipleri o ailenin üyeleridir (RFC-0004 §3). Bir ailenin payı öbür ailenin yedeğini açamaz.
- Kâğıt pay her aile için ayrı basılır; üstüne aile adı yazılır.
- **Telefon kaybı:** Kurtarma ve `ROTATE_DEVICE` aile başına ayrı yapılır. Üç aileli kişi üç ayrı törenle üç aileye geri döner. Bu, bağlantısızlığın bedelidir: tek bir kurtarma üç aileyi birbirine bağlardı (K4).
- Çocuk telefonu hiçbir ailede pay tutmaz (kurucu §10.2 aynen). Başka ailede yetişkin olan kişi o ailede pay tutar.

## 8. SDK yüzü ve kanal

### 8.1 Çerçeve (RFC-0024 §2'ye ek)

- İstek: `{ id, komut, govde, aile? }`. `aile` = `yerelNo`.
- Olay: `{ olay, veri, aile? }`. Aileye özgü her olay (`kayit-degisim`, `defter`, `vaka`, `yz`, `ceremony`, `kalici`, `kasa`) `aile` taşır.
- Geri çağrı: `{ cagri, id, veri, aile? }`. `onayEkrani` ekranında aile adı gösterilir.
- **Seçim kuralı:** Aileye özgü komutta `aile` yoksa: tek örnek varsa o; birden çok örnek varsa `FAMILY_AMBIGUOUS`. Bilinmeyen `yerelNo` `NO_FAMILY`. Böylece tek aileli eski ürün kodu değişmeden çalışır; ikinci aileyi ekleyebilen yeni kod her çağrıda aileyi söylemek zorundadır.
- **Abonelik:** Çekirdekte ayrı abonelik komutu yoktur. Bütün olaylar `aile` taşır; ürün kendi süzgecini uygular. Aile verisi küçük olduğu için olay hacmi sorun değildir.
- **Etkin aile** ürünün ekran durumudur (ana ekrandaki sekme, EserX 18 §12). Çekirdek "etkin aile" tutmaz; tutsaydı arka planda biten bir iş yanlış aileye yazabilirdi.

### 8.2 Komutlar (420–429)

Aralık `protocol/command-ranges.json`'a eklenir (`sdk: true`). Bu komutlar çerçevede `aile` istemez (425 ister).

| No | Ad | Girdi → Çıktı | Not |
|----|----|---------------|-----|
| 420 | `FAMILIES` (`AilelerApi.liste`) | `{}` → `[{ aile, ad, rol, benimAdim, durum, kok, duzey }]` | `durum`: `hazir`, `katiliyor`, `bozuk`, `silinecek`, `ailesiz` |
| 421 | `FAMILY_ADD` (`AilelerApi.kur`) | `{ aileAdi, benimAdim }` → `{ aile }` | §4.3; `FAMILY_LIMIT`, `FAMILY_PERMISSION_REQUIRED` |
| 422 | `JOIN_PREPARE` (`AilelerApi.katilimHazirla`) | `{}` → `{ aile }` | §4.3; `JOIN_IN_PROGRESS` |
| 423 | `FAMILY_LEAVE` (`AilelerApi.ayril`) | `{ aile }` → `{ durum: 'silinecek' }` | §4.5; kişi biyometriyle onaylar |
| 424 | `FAMILY_LOCAL_REMOVE` (`AilelerApi.yerelSil`) | `{ aile }` → `null` | Yalnız üyeliği bitmiş, bozuk ya da katılım örneği; yoksa `MEMBERSHIP_IN_PROGRESS` |
| 425 | `FAMILY_PERMIT_GRANT` (`AilelerApi.izinVer`) | `{ cocukId, saat }` → `{ recordId }` | Çerçevede `aile` ister; yalnız ebeveyn; K1'e bağlı |
| 426–429 | ayrılmış | | |

Yeni olaylar: `aileler` (liste değişti), `aile-hata` (`{ aile, hata }`), `aile-silindi` (`{ aile }`).

### 8.3 TypeScript yüzü

`AilelerApi` worklet düzeyindedir; aileye özgü API'ler (`LedgerApi`, `RecordApi`, `EventApi`…) bugünkü gibi kalır ve istemci tarafında aileye bağlanır:

```ts
const aileler = await cekirdek.aileler.liste()
const elena = cekirdek.aile(aileler[1].aile)   // her çağrıya { aile } ekleyen sarmalayıcı
await elena.kayit.query({ collectionId, type: 'yuva.bakim.ugradi' })
cekirdek.on('vaka', (veri, aile) => { … })
```

## 9. Bildirim

- **Anahtar:** RFC-0006 §11.3 madde 3'teki "en çok bir kez" kümesi `(aile, vaka, basamak, sira)` olur. Vaka kimliği koleksiyona bağlı olduğu için iki ailenin vakası zaten çakışmaz; anahtar bunu yerel küme için de güvenceye alır.
- **Bildiren uygulama (RFC-0017 §9, RFC-0029 §5):** Her aile için ayrı seçilir. Seçim o ailede kimliği olan uygulamalar arasında yapılır. "Ana kimlik" o ailedeki ana kimliktir. Yerel kanaldaki ortak küme `familyId` ile anahtarlanır.
- **Görünüş:** Bildirim hangi aileden geldiğini söyler (ör. "Elena'nın evi"). Kilit ekranında aile adının görünüp görünmeyeceği ürünün kararıdır.
- **Aynı olay iki aileden:** Telefon bir olayı birden çok aileye yazarsa (yalnız K2'deki SOS), alıcı iki aileden iki kayıt alır. Alıcı telefon iki gönderenin aynı kişi olduğunu bilemez (§4.1 madde 9). Bu yüzden gönderen her SOS basışı için 16 bayt rastgele `ortakMid` üretir ve bütün ailelere aynı değeri yazar. Alıcı, `afetMid` kuralındaki gibi (RFC-0031 §6), aynı `ortakMid` için 7 gün içinde ikinci bildirim göstermez, ekrandaki SOS'u günceller.
  - Sızıntı: `ortakMid` yalnız iki ailenin de okuyucusu olan kişiye "bu iki SOS aynı basış" der. O kişi iki ailede de gönderenle yüz yüze tanışmıştır. Kutu ve Eser kaydı okuyamaz. Değer her basışta yenidir; kişiyi kalıcı olarak etiketlemez.
- Vaka, sahiplenme ve merdiven aile içinde kalır. "Ben bakıyorum" bir ailede yazılınca öbür ailedeki aynı SOS'un vakası kendiliğinden kapanmaz; alıcı ekranı ikisini birlikte gösterir ve kişi iki ailede de "Ben bakıyorum" der (ürün tek dokunuşla iki kayıt yazabilir, çünkü aynı telefonun iki örneğidir).

## 10. Göç

- Bugünkü dizin kök örnek olur. Dosya taşınmaz, anahtar türetimi ve AD değişmez. İlk açılışta `durum`'a `yerelNo` eklenir ve durum yeni sürümle yazılır (`DURUM_SURUMU` 3).
- Uygulamanın verdiği eski `sayac` kök örneğin sayacı sayılır; uygulama bundan sonra sayaç haritası tutar.
- Ürün kodu `aile` göndermediği sürece tek aileli davranış aynen sürer (§8.1).
- Mağazadaki Yuva Hat kendi worklet'iyle çalışır; bu RFC'yi çekirdeğin taşınmasıyla (kurucu §18.4) alır. O zamana kadar Yuva Hat tek ailelidir ve `0xE8` ile eşleşir.
- Defterde göç yoktur: iki ailenin defteri bu RFC'den önce de sonra da aynı biçimdedir.

## 11. Test vektörleri

Yeni dosyalar: `protocol/vectors/multi-family.json` (kimlik ve yerel kanal), `worklet/test/multi-family.js` (örnekler, kalıcılık, taşıyıcı).

1. **Bağlantısızlık:** Bir telefonda iki örnek, iki aile. İki defterin bütün 16 bayt ve üstü alanlarının kesişimi boştur (memberId, ÜKA, ÜDA, `personId`, sertifika özeti, YA `secretId`). Ortak değer yalnız düşük entropili alanlardır (`platform`, `appId`, yetenek bitleri).
2. **Seçim:** Tek örnekte `aile`'siz `RECORD_PUT` → geçerli. İki örnekte → `FAMILY_AMBIGUOUS`. Bilinmeyen `yerelNo` → `NO_FAMILY`.
3. **Sınır:** 3 aile → 421 ve 422 `FAMILY_LIMIT`. Yerel kanalda başka uygulamanın 3. ailesi varken bu uygulamada 3. farklı aile → `FAMILY_LIMIT`. Ayrılma tamamlanınca → geçerli.
4. **Aynı aile:** QR `famHint`'i aile listesinde → `FAMILY_EXISTS`, tören başlamaz. `famHint` çakışması ama `JOIN_LEDGER.familyId` farklı → geçerli. `JOIN_LEDGER.familyId` listede → `FAMILY_EXISTS`, katılım örneği silinir.
5. **Dosya takası:** A'nın `durum`'u B'nin klasörüne kopyalanır → B `STATE_CORRUPT`; A ve kök açılır.
6. **Silinen örnek:** Sayaç haritasında olan B'nin klasörü silinir → B `STATE_ROLLED_BACK`, `aile-hata`; A açılır.
7. **Çıkarılma:** A'da `REMOVE_MEMBER { wipe: true }` → A'nın klasörü silinir; B'nin dosyaları bayt bayt aynı, sayacı değişmez, oturumları kopmaz.
8. **Yarım silme:** `silinecek` işareti yazılmış, dosyalar yarım → açılışta silme tamamlanır, örnek listede yok.
9. **Göç:** Bugünkü biçimde dizin (kök `kimlik` + `durum`, D-sürümü) → kök örnek aynı memberId ve sayaçla açılır; hiçbir dosya yer değiştirmez.
10. **Taşıyıcı:** Tek `dht`, iki örnek. A'nın çiftinin arama anahtarıyla B'nin sunucusuna bağlanma → el sıkışmadan önce red. A'nın üyesinin B'ye HELLO'su → red. Testnette iki ailede eşitleme aynı anda yürür.
11. **Bildirim:** A ve B'de aynı `ortakMid`'li iki `hf.sos` → tek bildirim. Farklı `ortakMid` → iki bildirim. A'da aynı `(vaka, basamak, sira)` iki kez → tek bildirim.
12. **Çocuk (K1):** A'da `cocuk` olan telefon izinsiz 422 → `FAMILY_PERMISSION_REQUIRED`. Ebeveyn izniyle → geçerli; izin ikinci kez → `FAMILY_PERMISSION_REQUIRED`. Süresi geçmiş izin → red. İzni çocuk ya da yetişkin yazmış → yok sayılır.
13. **Cihaz rolü:** Kutu modundaki telefonda 421 → `DEVICE_SINGLE_COMMUNITY`.
14. **Yerel kanal:** `APP_PAIR_REQ2.familyId` eski uygulamanın örneklerinde yok → `NO_FAMILY`. `0xEB` ağdan gelir → atılır. Tek aileli uygulamayla `0xE8` → tek ailesine eklenir.
15. **Kasa:** A'da `UNLOCK` → B'nin kasası kilitli kalır.

## 12. Güvenlik değerlendirmesi

| Tehdit | Önlem |
|--------|-------|
| Eser ya da bir kutu iki ailenin üyeliğini aynı kişiye bağlar | Her ailede ayrı rastgele kimlik; ortak anahtar, kişi kimliği, sertifika, belirteç yok (§4.1). Posta Kutusu v1'de kullanılmıyor (RFC-0028 §7 a). |
| DHT gözlemcisi aileleri bağlar | Buluşma anahtarları çift sırrından, saatlik; konu yok. IP düzeyindeki bağ kabul edilmiş sınırdır ve kullanıcıya söylenir (§6). |
| Uygulama bir ailenin verisini öbür aileye yazar | `aile` zorunlu (`FAMILY_AMBIGUOUS`); örnekler ayrı nesneler, ayrı anahtarlar; aileler arası kopyalama yöntemi yok. |
| Diskte bir ailenin dosyası öbürünün yerine konur | Örnek başına türetilmiş anahtar ve yolu içeren AD (§5.2). |
| Bir ailenin bozulması ya da silinmesi öbürünü kilitler | Örnek düzeyinde hata ve silme (§4.5). |
| Bir ailenin kasası açılınca öbürü de açılır | Kilit örnek başına (§5.3). |
| Çocuk, ailesi bilmeden yabancı bir "aileye" alınır | K1: çocuk olduğu her ailede ebeveyn izni; katılınan ailede yüz yüze tören ve ebeveyn imzası. İstemci kuralıdır. |
| Aynı kişi aynı aileye iki kez girip iki oy kullanır | `famHint` ve `familyId` denetimi; aynı telefonda ikinci uygulama RFC-0017 eşleşmesine yönlendirilir. Değiştirilmiş istemciye karşı koruma, bugünkü gibi, yüz yüze törendir. |
| Telefonu ele geçiren bütün aileleri görür | Kabul edilmiş: aynı cihaz, aynı platform anahtarı. Kurucu §6.1'deki birleşik cihaz sınırına benzer; kurulumda söylenir. |
| Aynı SOS iki kez çalar ya da tekilleştirme kişiyi etiketler | `ortakMid` her basışta yeni, yalnız iki ailenin okuyucusuna görünür (§9). |

## 13. Kurucu belgede değişecekler

| Bölüm | Değişiklik |
|-------|------------|
| §4 kavramlar | "Kişi (üye)" satırına: "Bir telefon en çok 3 ailede üye olur; her ailede ayrı kimlik ve kişi kimliği vardır, aileler birbirini görmez (RFC-0034)." |
| §6.1 | Madde 1'e: "Bir telefonun her aile üyeliği ayrı kimliktir; aynı telefondaki kimlikler ailelere göre ayrı kişilerdir (RFC-0034)." |
| §6.2 | Yeni satır: "Bir telefonun üye olduğu aile · 3 (ücretle değişmez) · ekip: RFC-0034 K3". |
| §10.2 | "Pay, yedek ve kurtarma aile başınadır; telefon kaybında her aileye ayrı dönülür (RFC-0034)." |
| §11 | Madde: "Bir telefondaki aileler tek HyperDHT düğümünü paylaşır; anahtar düzeyinde bağlanamazlar, IP düzeyinde bağlanabilirler (RFC-0034 §6)." |
| §13.1 | T30: "İki ailenin üyeliği aynı telefona bağlanır" · "Aile başına rastgele kimlik; ortak anahtar ve belirteç yok; IP sınırı kabul edilmiş (RFC-0034 §12)." |
| §22 | HF66 (aşağıda). Sürüm 1.18 → bir sonraki. |

**HF66:** Bir telefon en çok üç ailede üye olur. Her üyelik ayrı rastgele kimliktir; aileler protokolde birbirini görmez. Telefon aile başına ayrı çekirdek örneği çalıştırır, tek HyperDHT düğümünü paylaşır; aileye özgü her komut aileyi söyler (RFC-0034). — Gerekçe: Yaşlının evi ayrı evdir (YB6); "çekirdek aile içeride kalır" (EserX 18 §1).

## 14. Diğer RFC'lerde değişecekler

| RFC | Yer | Değişiklik |
|-----|-----|------------|
| 0001 | §14 | "3 topluluk" → "3 aile (RFC-0034; ekip K3)". Yol `hat/families/<familyId hex>/kayit/` → `aileler/<yerelNo>/` (§5.2); klasör adında `familyId` yok. |
| 0004 | §3, §5 | "Pay sahipleri ve kurtarma aile başınadır; kâğıt payda aile adı yazar (RFC-0034 §7)." |
| 0006 | §11.3 | Madde 3'teki küme `(aile, vaka, basamak, sira)`. Bildirim aile adını taşır. |
| 0009 | §6 | "Jeton cihaz başına" → telefonda "aile örneği başına; aynı jeton iki ailenin oturumunda kullanılmaz". Sayaç sınırı (32) aile başına değişmez. |
| 0015 | §4 | `resolveMember` yalnız kendi ailesinde çözer; ürün kişileri aileler arasında birleştirmez. |
| 0017 | §6.1–§6.2 | Yerel kanal aile listesini taşır; `0xEB APP_PAIR_REQ2` (bu RFC'ye verilir; 0xEC–0xEF ayrılmış kalır); `PAIR_REQUEST` (360) gövdesine `familyId`. |
| 0017 | §9, §11 | Bildiren uygulama aile başına seçilir; "her uygulamanın çekirdeği ayrıdır" → "her uygulamanın her ailesi ayrı çekirdek örneğidir". |
| 0017 | §13 | Zarf satırına `0xEB` (RFC-0034). |
| 0024 | §2 | Çerçeveye `aile` (§8.1); `FAMILY_AMBIGUOUS`, `NO_FAMILY`. |
| 0027 | §5 | Dizin düzeni, örnek başına anahtar ve AD, sayaç haritası, örnek düzeyinde hata (§5.2, §4.5). |
| 0028 | §4, §5 a, §7 f–h | Tek düğüm bütün örneklere; törenden önce `famHint` denetimi; dinleme bütçesi telefon geneli (§6). |
| 0029 | §4 | SOS'un gittiği aileler (K2). |
| 0031 | §3 | K2 kabul edilirse `ortakMid` (bytes 16, isteğe bağlı) ve §6'daki tekilleştirmenin ona genişlemesi. |
| `command-ranges.json` | | 420–429 RFC-0034. |

## 15. Ürün belgelerine etkisi

- **Yuva Bakım:**
  - `cekirdek/ESLEME.md` §2: `aileler()` → 420; `etkinAile()`, `etkinAileSec()` → ürün durumu (§8.1); "§7 madde 1" ve "Birden çok aile … yalnız taklitte" satırları kalkar.
  - Taklitteki aileler arası ortak `KisiId` gerçekte yoktur. Kişinin kendi kimlikleri yerelde birleşir; başka kişiler aileye göredir. `kisiTelefonu(kisiId, familyId?)` → `familyId` zorunlu. `telefonumuYaz` her aileye ayrı yazar (§4.1 madde 7).
  - B86: takip edenin telefonunda 422 + `JOIN`; yaşlının telefonunda aile kök örnekte kurulur. B87: sekmeler 420'den.
  - `docs/07` H4 ve YB6'nın çekirdek koşulu bu RFC'yle karşılanır.
- **EserX `18-aile-agi.md`:** §4 "kasa yapısı `hat/families/<familyId>/`" → `aileler/<yerelNo>/` (klasör adında aile kimliği yok). §11 "Bir telefon birden fazla aile" satırı RFC-0034'e bağlanır.
- **Yuva Acil:** K2 kararına göre SOS'un hangi ailelere gittiği ve aile durumu ekranının aileye göre bölünmesi.
- **Yuva Hat, Yuva Defteri, Yuva Pati:** Aile seçici ve sekmeler ürün işidir. Çekirdekte zorunlu değişiklik `aile` alanıdır; tek aileli sürümler değişmeden çalışır.

## 16. Alternatifler

| Seçenek | Neden seçilmedi |
|---------|-----------------|
| Bütün ailelerde aynı kimlik | İki defterde aynı açık anahtar görünür; ürün kararına (EserX 18 §4) ters. |
| Tek tohumdan aile anahtarları türetmek | Tek yedekle kolay kurtarma sağlar, ama tohumun açığa çıkması bütün aileleri birden açar ve bağlar. Yedek zaten aile başınadır. |
| Aile başına ayrı worklet | Üç JS çalışma zamanı belleği; RFC-0028 §7 f gereği üç DHT düğümü; uygulamada çerçeve çoklama yine gerekir. Yalıtım kazancı küçük: aynı uygulama süreci aynı platform anahtarını tutar. |
| Tek çekirdek, çok defter | SDK'nın her nesnesine `familyId` eklenir; `Replika`, `PairBook`, `Presence`, `OnayDefteri` önbellekleri ortaklaşır; yanlış ailenin anahtarıyla şifreleme ya da gönderme hatası yapısal olarak mümkün olur. Büyük yeniden yazım. |
| Aile başına ayrı DHT düğümü | IP yine aynı; bakım trafiği üçe katlanır; gizlilik kazancı yok. |
| Sınırı defterde uygulamak | Defterler birbirini görmez; görselerdi bağlantısızlık biterdi. |
| `aile` yoksa "etkin aile"ye yazmak | Arka planda biten bir iş ya da yarış durumunda yanlış aileye yazılır; sızıntı sessiz olur. |
| Çocuk için kural yok | Çocuğun telefonu ailesinin haberi olmadan başka bir "aileye" alınabilir. |
| Çocuğa ikinci aile tümden yasak | Boşanmış ebeveynlerin iki ailesi ve büyükanne ailesi gibi gerçek durumlar kapanır. |

## 17. Hata kodları

| Kod | Nerede | Anlam |
|-----|--------|-------|
| `FAMILY_LIMIT` | 421, 422, 360 | Telefon 3 ailede (yeni) |
| `FAMILY_EXISTS` | 2, 421, tören | Kök örnek dolu (2) ya da bu aile zaten telefonda (bugünkü kodun anlamı genişler) |
| `FAMILY_AMBIGUOUS` | Kanal | Birden çok örnek var, aileye özgü komutta `aile` yok (yeni) |
| `NO_FAMILY` | Kanal, `0xEB` | Bilinmeyen `yerelNo` ya da örneklerde olmayan `familyId` (yeni) |
| `JOIN_IN_PROGRESS` | 422 | Bitmemiş bir katılım örneği var (yeni) |
| `MEMBERSHIP_IN_PROGRESS` | 424 | Üyeliği süren örnek yerel olarak silinemez; önce 423 (yeni) |
| `FAMILY_PERMISSION_REQUIRED` | 421, 422 | Çocuk olduğu bir ailede geçerli izin yok (yeni; K1) |
| `CHILD_IN_OTHER_APP` | 2, 421, 422, tören | Telefon başka bir Eser uygulamasında çocuk; aile o uygulamadan kurulur ya da katılınır (§4.4; Codex 10. tur) |
| `DEVICE_SINGLE_COMMUNITY` | 421, 422 | Kutu, uç ya da işçi olan telefon başka aileye giremez (yeni) |
| `STATE_CORRUPT`, `STATE_ROLLED_BACK` | `aile-hata` | Bugünkü anlam; artık yalnız o örneği durdurur |

## 18. Açık noktalar ve Kerem'in kararları

**Kerem kararları (25 Ekim 2026): K1–K4 Mac önerisi kabul edildi.** K1 ebeveyn izni, K2 bütün aileler ve `ortakMid`, K3 yalnız aileler sayılır, K4 aile başına kurtarma.

| # | Konu | Mac önerisi |
|---|------|-------------|
| K1 | Çocuk rolündeki telefonun başka aileye katılması ya da aile kurması | Çocuk olduğu her ailede ebeveynin `hf.aile-izni`'si (7 gün, tek kullanım) (§4.4). Alternatifler: kural yok; tamamen yasak. |
| K2 | Birden çok aileli kişinin SOS'u hangi ailelere gider | Bütün ailelerine; `ortakMid` ile tek bildirim (§9). Alternatif: yalnız seçilen aile (Yuva Acil ayarı). |
| K3 | 3 sınırı neyi sayar: misafirlik ve ekip | Yalnız aile üyeliği. Misafirlik (bakıcının telefonu) ve ekip (Mekan uygulamaları) ayrı karar ve ayrı RFC; bu RFC onlara örnek düzenini açık bırakır. RFC-0001 §14'teki "3 topluluk" "3 aile" olarak düzeltilir. |
| K4 | Telefon kaybında her aileye ayrı kurtarma töreni | Kabul: bağlantısızlığın bedeli; ürün "her aileden biriyle buluş" listesini gösterir (§7). |

**Teknik açık noktalar (karar ölçüm ya da başka RFC bekliyor):**

| # | Konu | Neden açık |
|---|------|------------|
| A1 | Telefon geneli dinleme bütçesi ve paylaştırma | dell ölçümü (RFC-0028 §7 g'deki gibi), üç aileli telefonda pil |
| A2 | Posta Kutusu ve zil geldiğinde bildirim jetonu | iOS ve Android'de uygulama başına tek bildirim jetonu vardır; iki ailenin zil biletine aynı jeton yazılırsa Posta Kutusu aileleri bağlar. Posta Kutusu RFC'si bunu çözmeden çoklu aileli telefonda zil açılmaz. |
| A3 | Afet modunda birden çok aile | RFC-0012'nin yayınları aile başına mı, tek yayın mı; Yuva Acil v1 ile |
| A4 | Yuva Bağlantı planı ve jeton | Hane başına paket; ikinci ailenin paketini kimin aldığı ve telefonun o aile için jetonu hangi fişle istediği (RFC-0009 §6) |
| A5 | Donanım anahtarı (`dbaPub`) | P-256 doğrulayıcı geldiğinde Secure Enclave ve Keystore'da örnek başına anahtar (§4.1 madde 4) |

## 19. Uygulama sırası

Bakım v0'ı açan en kısa yol önce:

1. **Worklet örnekleri:** `Kalici`'ye örnek yolu, örnek başına anahtar ve AD, sayaç haritası; `baslat`'ta örnek haritası, çerçeve yönlendirme (`aile`, `FAMILY_AMBIGUOUS`), örnek başına ürün sunucusu ve olay etiketi; 420, 421, 422; göç. Vektörler 1, 2, 3, 5, 6, 9. (dell)
2. **Taşıyıcı:** tek `dht`, örnek başına `DhtTasiyici` ve tören taşıyıcısı; `famHint` ve `familyId` denetimi; vektörler 4, 10. Bu iki adımla Rosa'nın telefonu "Elena'nın evi"ne katılır (B86) ve Bakım iki aileyi gerçek çekirdekte gösterir (B87).
3. **Ayrılma ve silme:** 423, 424, örnek düzeyinde hata, yarım silme; vektörler 7, 8; kasa kilidi örnek başına (vektör 15).
4. **Yerel kanal:** aile listesi, `0xEB`, 360'a `familyId`, aile başına bildiren uygulama; vektör 14. (Rosa'da Yuva Hat ve Bakım birlikteyken gerekir.)
5. **Bildirim:** `(aile, …)` anahtarı; K2 kabul edilirse `ortakMid`; vektör 11.
6. **K1 kabul edilirse** `hf.aile-izni` ve 425; vektör 12. Vektör 13.
7. **Ölçüm ve inceleme:** A1 ölçümü (dell), bağımsız inceleme (Mac), sonra Bakım v0 gerçek çekirdekle.

## 20. Geri dönüş yolu

- Defter değişmediği için geri alınacak protokol durumu yoktur.
- Karar geri alınırsa ürünler 421 ve 422'yi göstermez. Ek örneği olan telefonlarda örnekler okunmaya devam eder; kişi istediği aileden 423 ile ayrılır.
- Kök örnek bugünkü düzende kaldığı için tek aileli telefonlarda hiçbir şey değişmez.

## Ek: açılış öncesi bağımsız inceleme (25 Ekim 2026)

Bağımsız incelemede bulunan üç açık kapatıldı. Protokol türü, numarası ve defter olayı değişmez.

a. **Yeni aile denetimi her yolda (§4.2, §4.4).** İzin (`FAMILY_PERMISSION_REQUIRED`), aile sınırı (`FAMILY_LIMIT`) ve cihaz kuralı (`DEVICE_SINGLE_COMMUNITY`) kök örnek boşken de uygulanır: `CREATE_FAMILY` (2), 421'in kök yolu, 422'nin kök yolu ve törenle bağlanma. Kök sıfırlanmış bir telefon başka örnekte çocuksa ya da başka uygulamalarda 3 ailedeyse izinsiz aile kuramaz, katılamaz. Denetim kökün kalıcı katmanında aile bağlanmadan önce yapılır (`worklet/persistence.js` `aileBagla` kancası, `worklet/start.js` `kokAileGecidi`); ürünün `c.kalici` üstünden bağlaması da geçitten geçer. Cihaz kuralı yalnız telefon zaten bir ailedeyken uygulanır (kutu ilk topluluğuna katılır).

b. **İzin kaydının sahibi (§4.4).** `hf.aile-izni` kaydının alanları birleşmiş hâldir; ilk yazar ebeveyn olsa da `gecerli`'yi başkası değiştirebilir. İzin, kaydın **bütün işlemleri** (ilk yazım ve sonraki her değişiklik) aktif bir ebeveynin olduğunda geçerlidir. Çocuğun ya da yetişkinin tek bir değişikliği kaydı izin olmaktan çıkarır.

c. **LEAVE'in ulaşması (§4.5, 423).** "Ulaştı", LEAVE'i alan üyenin ya da kutunun onu defterine alıp **aynı oturumdan geri göndermesi** (yankı) demektir; sokete yazmak ulaşmak sayılmaz. Alan taraf, gönderenin kendi LEAVE'i o gelişle defterine girdiyse o olayı bir kez sıradan bir `LEDGER_EVENTS` olarak geri yazar (gönderen artık üye olmadığı için olağan gönderim denetimi atlanır). Ayrılan telefon kendi LEAVE'ini o eşten aynen geri alınca örneği siler; yalnız aktif bir üyenin ya da kutunun yankısı sayılır, işçinin (cihaz oturumu) sayılmaz: işçi olayı saklamadan geri gönderebilir (i). Yankı gelmezse 72 saat kuralı geçer. Eski sürüm yankı göndermez; o zaman da 72 saat geçer. Ayrılma beklerken taşıyıcı defteri LEAVE'den önceki hâliyle görür: çevrimdışıyken ayrılan telefon, LEAVE'i taşıyacak oturumu sonradan kurabilir.

d. **Silme hatası (§4.5).** Örneğin bir dosyası silinemezse işaret `siliniyor` kalır, örnek açılmaz ve `FAMILIES`'de `bozuk` görünür (`hata: ERASURE_INCOMPLETE`); 424 silmeyi yeniden dener, açılış da dener. Kök silinemezse eski kimlikle yeniden açılmaz; kök hata durumunda kalır (`ROOT_CORRUPT`), 424 `kok` yeniden dener.

e. **Misafir kipi ve örnekler (D99 ile).** Misafir kipindeki örnek (aile yok, misafir görünümü var) doludur: katılım süresi dolunca ya da açılışta "ailesiz" diye silinmez. Misafir kipindeki kökte aile kurulmaz, katılım ek örnekte yapılır (421, 422); kalıcı katman misafirken aile bağlamaz (`IN_GUEST_MODE`): aynı kimlik bir ailede misafir, öbüründe üye olmaz. Başka ailenin misafirliği başlarken eski ailenin bırakma kuyruğu silinir.

f. **Tören başında denetim.** Boş kökte üye, kutu ya da cihaz katılımında (a)'daki denetim JOIN başlarken de yapılır; reddedilen telefon için aile tarafında üye eklenmez. Misafir töreni bu denetime girmez (K3).

g. **Silme işareti.** `siliniyor` işareti yazılamazsa hiçbir dosya silinmez (d'deki hata yolu).

h. **Çatalda kaybolan LEAVE.** Ayrılma beklerken defter değişir ve üyelik sürüyorsa (kendi LEAVE'imiz çatal çözümünde öbür dalda kaldı) LEAVE yeniden yazılır; yoksa 72 saat sonra örnek silinir ama kimlik ailede aktif kalırdı.

i. **Dördüncü inceleme (Codex).** LEAVE yankısı yalnız aktif üyeden ya da kutudan (c). Misafir töreninde `GUEST_VIEW` yalnız misafir 5 resmi onaylayıp bu törenin `GRANT` taslağını imzaladıktan sonra kabul edilir; görünümün `GRANT`'ı imzalanan taslakla aynı olmalı (`eventHash`) ve taslağın `ceremonyTranscriptHash`'i bu törenin transkripti olmalı. Eski, geçerli bir görünüm onaysız bağlanamaz, yerel iptali kaldıramaz (`VIEW_NOT_FOR_CEREMONY`; RFC-0003 §6.1). Biten ya da iptal edilen törenin soketinden gelen mesaj işlenmez.

j. **Beşinci inceleme (Codex).** Misafirliği veren ebeveyn cihaz değiştirdikten sonra ayrılır, çıkarılır ya da ebeveynlikten inerse de `GUEST_REVOKED` gider: o olayla düşen misafirlikler (`removedSeq`) bulunur, `grantedBy`'daki eski kimlikle karşılaştırılmaz. Silmede klasör ancak gerçekten yoksa (`ENOENT`) silinmiş sayılır; erişim hatası silinmiş sayılmaz (g).


k. **Onuncu inceleme (Codex, 28 Ekim 2026).** Başka bir Eser uygulamasındaki çocukluk yerel kanal rolüyle görülür (§4.4, §4.6): o uygulamada çocuk olan telefon bu uygulamada yeni aile kuramaz ve yeni aileye katılamaz (`CHILD_IN_OTHER_APP`). Telefonun öbür uygulamada zaten olduğu aileye eşleşme yeni aile sayılmaz (sınır, cihaz ve çocuk kuralı uygulanmaz); eşleşme kabulü (365) o aileyi artık `FAMILY_EXISTS` ile reddetmez (öbür uygulamanın listesi verildiğinde eşleşme hep reddediliyordu). Sınır 28 kapandı.

Yeni hata kodları: `VIEW_NOT_FOR_CEREMONY` (misafir töreni), `ERASURE_INCOMPLETE` (424, `aile-hata`, `FAMILIES`), `IN_GUEST_MODE` (aile bağlama). Testler: `worklet/test/multi-family.js` "açılış incelemesi" testleri, `worklet/test/guest-startup.js`.
