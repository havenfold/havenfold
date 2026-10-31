# RFC-0006 — Olay zarfı, olay türleri kataloğu ve rutin motoru

> Durum: **Onaylandı** (Kerem, 23 Ekim 2026) · 23 Ekim 2026 · Yazan: Havenfold çekirdek ekibi · Onay: Kerem
> Kurucu belge: §4 (olay), §7.6–§7.7 (olaylar koleksiyonu), §8.6 (sürekli görev), §12 (olay zarfı), §15.3 (Bakım, Pati, Acil), §16.3. Çatı dokümanı: §4 (rutin, kural, kart), §8 (olay formatı), §10 (rutin motoru).
> Bağımlılık: RFC-0001 (kayıt, `append-event`, `REC_DROP`, temizlik), RFC-0002 (sürekli görev, `NODE_CAPS`), RFC-0003 (yer, varlık, cihaz, koleksiyon, emanet mührü), RFC-0015 (ayrılmış alanların tek listesi). Mekan'daki okunuşu: RFC-0005.
> Kod yeri: `havenfold/core/olay` (`@havenfold/events`). Tür kataloğu: `havenfold/protocol/olay-turleri.json`.

## 1. Sorun

Bakım, Pati, Kamera, Acil, Ev Makinesi ve Mekan Stok aynı şeyi yapacak: bir şey olunca kaydetmek, normali öğrenmek, sapmayı yakalamak ve doğru kişiye haber vermek. Bugün bunun ortak bir biçimi yok:

- Çatı §8'deki olay zarfı bir JSON örneğidir; kayıt katmanıyla (RFC-0001) nasıl eşleştiği tanımlı değildir.
- Rutin, kural ve bildirim merdiveni (çatı §10) yalnız bir tablodur. Sayısal tanımı yoktur.
- Bir ailede birden çok telefon aynı olayı görür. Hepsi aynı kişiye haber verirse aynı uyarı üç kez çalar. "Ben bakıyorum" deyince kimin duracağı belli değildir.
- Kutu olayı açmaz (kurucu §12). Kamerayı işleyen işçi olay koleksiyonunu okuyamaz (RFC-0001 §10). Motorun nerede, neyi görerek çalışacağı yazılmamıştır.

Her ürün bunu kendisi yazarsa aynı olay iki üründe iki ayrı anlama gelir ve bildirim gürültüsü denetlenemez.

## 2. Öneri özeti

- **Olay bir kayıttır.** Ayrı bir zarf yoktur. Çatı §8'deki alanlar kayıt alanlarına eşlenir. İmza, kayıt işleminin imzasıdır.
- **Ad alanı:** `hf.` çekirdek, `yuva.` ev, `mekan.` iş yeri. Türler uygulamanın içinde gelen sabit bir katalogla tanımlanır. Uzaktan tür indirilmez.
- **Güven** yüzde tamsayıdır (`_conf`, 0–100, RFC-0015 §2.1). Düşük güvenli olay tek başına vaka açmaz.
- **Rutin** basit ve belirlenimcidir: son 28 günün günlük değerlerinin ortancası ve ortanca mutlak sapması. Tamsayı aritmetiği. Aynı olaylardan her cihaz aynı normale varır.
- **Kural** sabit eşiktir ve her zaman rutinin önüne geçer.
- **Vaka:** Sapma ya da kural bir vaka açar. Vakanın kimliği belirlenimcidir; iki telefon aynı sapmayı bulursa aynı vakayı bulur.
- **Bildirim merdiveni:** kayıt, kart notu, topluluk sohbeti, sorumlu kişi, sıradaki kişi, dış hizmet. Durum, olayın bulunduğu koleksiyonda kayıtlar olarak durur. "Ben bakıyorum" bir kayıttır ve merdiveni durdurur.
- **Çift bildirim olmaz:** Her telefon yalnız kendi kullanıcısına haber verir ve bir vakanın bir basamağı için en çok bir kez. Uyandırma zarfı yalnız ipucudur; alıcı tekilleştirir.
- **Kart**, öznenin sohbetteki yüzüdür ve bir kayıttır.
- **Saklama:** Olay kayıtları süreli olabilir (`_keep`). Süresi dolan kayıt, koleksiyonun verisine bağlı belirlenimci bir eşikle temizlenir.

Yeni algoritma yoktur. Yeni defter olayı yoktur. Yeni yetenek biti yoktur: bilinmeyen zarf türü bugünkü kodda yok sayılır (`messenger.js`, docs/04 §10).

## 3. Tanımlar ve kodlama kuralları

| Ad | Anlam |
|----|-------|
| **Olay** | `_t` alanı taşıyan ve türü olay kataloğunda bulunan kayıt (§4). |
| **Özne** | Olayın kimin ya da neyin hakkında olduğu: üye, varlık, yer, cihaz ya da aynı koleksiyondaki bir kayıt (§4.3). |
| **Motor** | Rutin ve kuralları değerlendiren, vakaları yürüten kod. Telefonda ve işçide çalışır, kutuda çalışmaz (§12). |
| **Rutin** | Bir özne ve olay türü için öğrenilmiş normal bant (§8). |
| **Kural** | Öğrenmeden bağımsız sabit koşul (§9). |
| **Sapma** | Ölçülen değerin rutinin bandı dışına çıkması. |
| **Vaka** | Bir sapma ya da kural tetiklemesinin ortak durumu. Kimliği `vaka` (16 B) belirlenimcidir (§10). |
| **Basamak** | Bildirim merdiveninin adımı, 0–5 (§11). |
| **Kitle** | Bir basamakta haber alan kişiler. |
| **Kart** | Öznenin topluluk sohbetindeki yüzü; `hf.kart` kaydı (§13). |
| **Topluluk sohbeti** | Yuva'da aile grubu (`conv-family`), Mekan'da ekip sohbeti (RFC-0005). |

**"X anında"** RFC-0001 §3'teki anlamdadır.

**Kodlama:** RFC-0001 §3'teki kurallar aynen geçerlidir: `compact-encoding`, en kısa `c.uint`, seçimli alanda varlık bayrağı, imza gönderilen baytlar üzerinden, özete giren tamsayılar `u64be`, etiketler `hf/` ile başlar ve `/` ile biter. İmzalı zarflarda RFC-0002 §3'teki düzen kullanılır: `body` = `sig` dışındaki alanların kodlaması, `sig = Ed25519(imzalayan, hash('<etiket>', familyId, body))`.

**Değişken uzunlukta girdi:** `hash` girdileri arka arkaya ekler ve uzunluk yazmaz (`kdf.js`). Bu yüzden bu RFC'deki özetlere değişken uzunlukta metin doğrudan girmez. Metin önce kendi etiketiyle 32 baytlık özete çevrilir, özet girer.

**Saat:** Bu RFC'de paylaşılan durumu belirleyen hiçbir kural cihazın saatine ya da geliş sırasına bağlı değildir. Saat yalnız iki yerde kullanılır: motorun bir basamağı **ne zaman** yazacağına karar vermesi ve rutinin hangi günü değerlendirdiği. İkisi de yerel bir karardır. Yazılan kaydın geçerliliğini değiştirmez.

## 4. Olay kaydı

### 4.1 Çatı zarfından kayda eşleme

| Çatı §8 alanı | Kayıt karşılığı | Not |
|---------------|-----------------|-----|
| `v` | `_v` alanı | Bugün 1. |
| `id` | `recordId` | Cihazın olayında `append-event` kuralıyla türetilir (RFC-0001 §4.1). Üyenin olayında rastgele. |
| `type` | Kaydın türü (`type`) | Ad alanlı (§5). |
| `subject` | `_subj` alanı | §4.3 |
| `place` | `_place` alanı | §4.3 |
| `time` | `_t` alanı | Olayın gerçekleştiği an, Unix ms. `hlc` yazılma anıdır; ikisi ayrıdır. |
| `source` | İşlemin `authorId`'si, gerekirse `_obs` | Yazan imzalı olarak işlemin içindedir. Kameranın kendisi gibi ayrı bir gözlem kaynağı varsa `_obs`. |
| `data` | Ürün alanları | Altçizgisiz alan adlarıyla düz yazılır (`sure_sn`). İç içe nesne yoktur. |
| `confidence` | `_conf` alanı | Yüzde tamsayı, 0–100 (§7, RFC-0015 §2.1). Değer kodlamasında kayan nokta yoktur (RFC-0001 §4.2). |
| `scope` | `_scope` alanı | §4.4 |
| `sig` | `REC_OP.sig` ya da `REC_DROP.sig` | Ayrı imza yoktur. |

Çatı §8'deki "olay şifreli zarfın içinde gider, Posta Kutusu ve kutu türünü göremez" kuralı kendiliğinden sağlanır: tür ve bütün alanlar kayıt işleminin şifreli metnindedir.

### 4.2 Çekirdek alanlar

RFC-0001 §4.1, `_` ile başlayan alanları çekirdeğe ayırır. Bu RFC şunları tanımlar:

| Alan | Değer türü | Zorunlu | Anlam |
|------|------------|---------|-------|
| `_v` | int | Evet | Olay biçimi sürümü. Bugün 1. |
| `_t` | int | Evet | Olayın anı, Unix ms. |
| `_subj` | string | Evet | Özne başvurusu (§4.3). |
| `_place` | string | Hayır | `yer:<hex16>`. Yoksa öznenin yerinden okunur. |
| `_scope` | string | Hayır | `topluluk` (varsayılan), `kisisel`, `bag`, `hizmet`. |
| `_conf` | int | Hayır | 0–100. Yoksa 100 sayılır. |
| `_key` | bytes (16) | Hayır | Tekil anahtar: aynı tür ve aynı `_key` aynı gerçektir (§4.5). |
| `_obs` | string | Hayır | Gözlem kaynağı: `kaynak:<hex16>` (RFC-0002 `hf.task.vision` `sourceId`). |
| `_keep` | int | Hayır | Saklama süresi, gün. 0 ya da yok: süresiz (§14). |
| `_src` | list<string> | Hayır | Kaynak başvuruları (biçimi RFC-0013 §8.5). |

- `_conf` ve `_src` alanlarının türü RFC-0015 §2.1'dedir (`_conf` yüzde tamsayı). Bu RFC'nin alanları da RFC-0015'teki tek listeye girer.
- `_t`, `_subj`, `_key` ve `_keep` yalnız kaydın **türünü belirleyen işlemden** okunur (RFC-0001 §4.1). Sonradan gelen `put` bu dört alanı değiştiremez; motor ve temizlik onları yok sayar. Böylece bir olayın anı ve öznesi sonradan kaydırılamaz. Yanlış olay `hf.olay.duzelt` ile işaretlenir (§7.3) ya da silinir.
- Bilinmeyen alanlar yok sayılır (çatı §8).

### 4.3 Özne ve yer başvuruları

`<hex16>` her yerde 16 baytın küçük harf hex yazımıdır (32 karakter).

| Biçim | Ne | Geçerlilik |
|-------|----|-----------|
| `uye:<hex16>` | Üye (kutu dahil) | Defterde var olmuş bir üye. Kimlik RFC-0003 §5.13'teki gibi `rotatedTo` zincirinin aktif ucuna çözülür. |
| `varlik:<hex16>` | `BEING` | Defterde var olmuş bir varlık. Kaldırılmış varlık geçmiş olaylar için geçerli kalır. |
| `yer:<hex16>` | `PLACE` | Defterde var olmuş bir yer. |
| `device:<hex16>` | Bağlı cihaz | Defterde var olmuş bir cihaz. |
| `grant:<hex16>` | Misafir | Defterde var olmuş bir misafirlik. |
| `kayit:<hex16>` | Aynı koleksiyondaki bir kayıt (Mekan'da raf, makine) | Başka koleksiyondaki kayda başvuru yoktur; böylece özne bilgisi koleksiyon sınırını aşmaz. |
| `topluluk` | Bütün topluluk | Yedek ve kasa gibi çekirdek olaylar için. |

**Yer:** `_place` yoksa yer şöyle bulunur: varlık ve cihazda defterdeki `placeId`; yerde kendisi; diğerlerinde yok.

### 4.4 Kapsam

`_scope` görünürlüğü genişletmez. Bir olayı kimin okuyacağını yalnız koleksiyon belirler (RFC-0001). `_scope` yalnız topluluk dışına çıkış yollarını (çatı §9) daraltır:

| Değer | Anlam |
|-------|-------|
| `topluluk` | Koleksiyonun okuyucuları görür. Bağ ve hizmet paketine girmez. |
| `kisisel` | Yalnız `kind = 'kisisel'` koleksiyonda geçerlidir. Başka koleksiyonda bu değeri taşıyan olay geçersizdir. |
| `bag` | Bağlı topluluğa önerilebilir. Gönderim yine sahibinin onayıyla olur (ilke 6). |
| `hizmet` | Hizmet paketine konabilir. Gönderim yine `SHARE_CONSENT` ister (RFC-0003 §5.7). |

### 4.5 Olayın motor için geçerliliği

Kayıt katmanı alanların anlamını denetlemez. Motor bir olayı yalnız şu koşullar sağlanınca sayar. Sağlanmazsa kayıt durur ama sayılmaz ve kartta "geçersiz olay" olarak görünür.

| # | Koşul |
|---|-------|
| 1 | Tür katalogda var ve `_v` motorun bildiği sürümde |
| 2 | `_t`, `_subj` var ve biçimleri doğru |
| 3 | `ms(_t) ≤ ms(hlc) + 5 dakika`. Gelecekten olay yazılamaz. |
| 4 | Yazan, türün tanımındaki yazar sınıfına uyuyor (§5.2: `uye`, `cihaz`, `ikisi`) |
| 5 | `_scope` kurallara uyuyor (§4.4) |
| 6 | `_conf` 0–100 arasında |
| 7 | Hedefleyen geçerli bir `hf.olay.duzelt { gecersiz: true }` yok (§7.3) |

**Tekil anahtar:** Aynı tür ve aynı `_key` taşıyan geçerli olaylar tek olay sayılır. Asıl olan, türü belirleyen işlemi `(hlc, authorId, opId)` sırasıyla en küçük olanıdır. Birden çok telefonun aynı gerçeği (ör. bir cihazın çevrimdışı olduğunu) yazdığı olaylarda `_key` zorunludur ve tür tanımında nasıl türetileceği yazılıdır. Türetme her zaman şudur:

```
_key = hash('hf/olay-anahtar/', hash('hf/olay-tur/', tür adı), parça_1, …, parça_n)[0..16]
```

Parçalar sabit boyutludur (kimlikler, `u64be` tamsayılar).

### 4.6 Olay hangi koleksiyona yazılır

- Varlık, yer ve uç cihaz olayları öznenin yerinin `Olaylar:<yer>` koleksiyonuna yazılır.
- Çekirdek olayların koleksiyonu §6'daki katalogda yazılıdır.
- Ürün olaylarının koleksiyonu ürünün uyum tablosundadır (kurucu §19).
- **Kasa koleksiyonuna olay yazılmaz.** Kasa koleksiyonunda cihaz yazarı olamaz (RFC-0003 §5.9) ve kasa verisi bildirim kitlesine giremez.

## 5. Ad kuralları ve tür kaydı

### 5.1 Ad biçimi

```
tür adı = ad-alanı "." parça ( "." parça ){0,4}
ad-alanı = "hf" | "yuva" | "mekan"
parça    = [a-z0-9] [a-z0-9-]*
```

- En çok 64 bayt, yalnız küçük harf ASCII, rakam, nokta ve tire.
- İkinci parça modüldür. `hf.` için modüller: `device`, `task`, `backup`, `wipe`, `sos`, `kayit`, `kasa`, `grant`, `olay`, `rutin`, `kural`, `vaka`, `kart`, `saklama`, `ai` (RFC-0013), `ekip` (RFC-0005), `hizmet` ve `paylasim` (RFC-0010), `node` (RFC-0007), `uc` (RFC-0008), `app` (RFC-0011). Var olan adlar (kurucu §12, RFC-0001, RFC-0003) olduğu gibi korunur; yeni `hf.` modülü yalnız bir RFC ile açılır ve bu listeye eklenir. Ad bir tanımlayıcıdır, kullanıcıya gösterilmez.
- `yuva.` modülleri Yuva ürün depolarında, `mekan.` modülleri Mekan depolarında `OLAY-TURLERI.md` dosyasında listelenir: `yuva.pet`, `yuva.bakim`, `yuva.defter`, `yuva.kamera`, `yuva.acil`, `yuva.cocuk`, `yuva.anilar`, `yuva.plan`; `mekan.stok`, `mekan.guard`, `mekan.vision`, `mekan.hayvan`. Yeni modül o dosyaya eklenerek açılır.
- Yayımlanmış bir ad değişmez ve başka anlama verilmez. Anlam değişirse yeni ad açılır ya da `_v` artırılır.
- Bu üç ad alanı dışındaki türler kaydedilir ama motor onları değerlendirmez. Üçüncü taraf ad alanı, depo açıldıktan sonra ayrı bir RFC ile gelir (kurucu §21).

### 5.2 Tür tanımı

Her tür, uygulamanın içinde gelen bir tanımla bilinir:

```json
{
  "tur": "yuva.pet.litter.visit",
  "v": 1,
  "olay": true,
  "yazar": "cihaz",
  "ozne": ["varlik"],
  "alanlar": [
    { "ad": "sure_sn", "deger": "int", "zorunlu": false, "birim": "sn" }
  ],
  "kapsam": "topluluk",
  "keep": 90,
  "ozel": false,
  "ozet": "yuva.pet.litter.visit.ozet"
}
```

| Alan | Anlam |
|------|-------|
| `olay` | `true` ise olaydır ve `_t` ister. Kart, kural, rutin gibi yapılandırma kayıtları `false`'tur. |
| `yazar` | `uye`, `cihaz` ya da `ikisi`. |
| `ozne` | İzin verilen özne türleri. |
| `alanlar` | Ürün alanları. `deger`: RFC-0001 §4.2'deki etiket adları. |
| `kapsam` | Yazanın varsayılan `_scope` değeri. |
| `keep` | Yazanın varsayılan `_keep` değeri (§14.1). |
| `ozel` | Özel nitelikli veri (sağlık) taşır. `true` ise olay yalnız Ebeveynler koleksiyonuna ya da `kind = 'kisisel'` bir koleksiyona yazılabilir; motor diğerlerinde geçersiz sayar. Mekan'da Yönetim koleksiyonu Ebeveynler'in yerini tutar (RFC-0005 §8.4). |
| `ozet` | Kartta gösterilen metnin şablon kimliği. Şablon metni uygulamanın içindedir. |

### 5.3 Ürünler türü nasıl kaydeder

1. Ürün türünü kendi deposundaki `OLAY-TURLERI.md` dosyasına ve tanım dosyasına ekler. Çekirdek türleri `havenfold/protocol/olay-turleri.json`'dadır.
2. Tanım, ürün uygulamasıyla birlikte derlenir ve başlangıçta SDK'ya verilir: `olay.turKaydet(tanim)`.
3. **Uzaktan tür, şablon ya da kural kodu indirilmez** (kurucu §16.2). Tür tanımı veridir ama uygulamanın içinde gelir. Böylece motorun davranışı yalnız mağaza güncellemesiyle değişir.
4. Görev imajı (ör. Bakım imajı) aynı tanım dosyasını kendi içinde taşır. Sürüm bildirimi imajı kapsar (kurucu §9.4).

### 5.4 Bilinmeyen tür

Bir cihaz tanımadığı türde olay alırsa:

- Kaydı saklar ve eşitler (RFC-0001 kuralları türden bağımsızdır).
- Kartta "Bu olay türünü bu uygulama sürümü tanımıyor" diye gösterir.
- Rutin ve kural değerlendirmez, vaka açmaz.

## 6. `hf.` çekirdek kataloğu

Önem değerleri §11.2'dedir. Koleksiyon sütunu Yuva içindir; Mekan karşılıkları RFC-0005'tedir. "Telefon" sütunu, olayı yazan telefonu anlatır: aynı gerçeği birden çok telefon yazabilir, `_key` onları birleştirir.

### 6.1 Olaylar

| Tür | Özne | Yazan | Koleksiyon | Önem | `_keep` | `_key` parçaları |
|-----|------|-------|------------|------|---------|------------------|
| `hf.device.added` | `device:` | Töreni yapan ebeveyn telefonu | Ebeveynler | duyuru | 365 | `DEVICE_ATTACH` olayının `eventHash`'i |
| `hf.device.removed` | `device:` | `DEVICE_DETACH`'ı yazan telefon | Ebeveynler | duyuru | 365 | `DEVICE_DETACH` olayının `eventHash`'i |
| `hf.device.offline` | `device:` ya da kutu için `uye:` | Herhangi bir ebeveyn telefonu; son `NODE_CAPS` 15 dakikadan eskiyse (RFC-0002 §4) | Ebeveynler | bilgi; kutuda duyuru | 30 | özne kimliği, son görülen `NODE_CAPS.seq` |
| `hf.device.online` | aynı | aynı; çevrimdışı sayılan cihazdan yeni bildirim gelince | Ebeveynler | bilgi | 30 | özne kimliği, yeni `seq` |
| `hf.device.silent` | `device:` | aynı; 30 gün sessizlik (kurucu §6.8) | Ebeveynler | duyuru | 90 | özne kimliği, son `seq` |
| `hf.device.overheat` | `device:` / `uye:` | aynı; `status` `sicak`'a geçince | Ebeveynler | dikkat | 30 | özne kimliği, `seq` |
| `hf.device.battery` | `device:` / `uye:` | aynı; `healthPct` %60'ın altına inince (kurucu §9.6) | Ebeveynler | dikkat | 90 | özne kimliği, `cycles` |
| `hf.device.on-battery` | `device:` / `uye:` | aynı; `onAC` 10 dakikadan uzun `false` | Ebeveynler | duyuru | 30 | özne kimliği, `seq` |
| `hf.device.disk-low` | `device:` / `uye:` | aynı; `diskFreeGB < 5` | Ebeveynler | duyuru | 30 | özne kimliği, gün numarası |
| `hf.device.battery-check` | `topluluk` | Sıralamada ilk ebeveyn telefonu; yılda bir | Ebeveynler | duyuru | 365 | yıl |
| `hf.task.done` | `uye:` (isteyen) | İsteyen telefon; 1 dakikadan uzun işler | İsteyenin Kişisel'i | bilgi | 30 | `taskId` |
| `hf.task.failed` | `uye:` | İsteyen telefon | İsteyenin Kişisel'i | duyuru | 30 | `taskId` |
| `hf.task.standing-ending` | `device:` (işçi) | Görevi veren ebeveyn telefonu; sürekli görev 3 gün içinde bitecek ve yenilenemedi | Görevin koleksiyonu | dikkat | 30 | `taskId` |
| `hf.backup.verified` | `uye:` (sahip) | Sahibin telefonu | Sahibin Kişisel'i | bilgi | 30 | `BACKUP_INDEX.seq` |
| `hf.backup.stale` | `uye:` | Sahibin telefonu; yedek 7 günden eski (RFC-0004 §7) | Sahibin Kişisel'i | duyuru | 30 | gün numarası |
| `hf.backup.failed` | `uye:` | Sahibin telefonu | Sahibin Kişisel'i | duyuru | 30 | gün numarası |
| `hf.wipe.done` | `device:` | Raporu kaydeden ebeveyn telefonu (RFC-0003 §8) | Ebeveynler | duyuru | 0 (süresiz) | `wipeReportHash` |
| `hf.kasa.rotated` | `uye:` (YA) / `topluluk` (KRA) | Döndüren telefon | Sahibin Kişisel'i / Ebeveynler | bilgi | 365 | `secretId`, `version` |
| `hf.kasa.paper-needed` | aynı | Döndüren telefon; her gün, kâğıt basılana kadar (RFC-0004 §6) | aynı | duyuru | 7 | `secretId`, `version`, gün numarası |
| `hf.kayit.kutu-dolu` | `uye:` (kutu) | Kutunun durum mesajını alan telefon. Kutu kendisi yazmaz (kurucu §12). | Ebeveynler | dikkat | 30 | kutu kimliği, `collectionId`, gün numarası |
| `hf.grant.expired` | `grant:` | Misafiri veren ebeveynin telefonu (RFC-0003 §5.5) | Ebeveynler | duyuru | 90 | `GRANT` olayının `eventHash`'i |
| `hf.sos` | `uye:` (basan kişi) | Basan kişinin telefonu | Tüm Aile | acil (§9.4) | 365 | — |

- **Gün numarası:** `floor((_t + utc_dk × 60000) / 86400000)`, `utc_dk` yerin saat farkıdır (§8.2). Yer yoksa 0.
- `hf.device.*` olaylarını yalnız ebeveyn telefonları yazar. Ebeveynler koleksiyonunun yazarı ebeveyndir (kurucu §7.7).
- `hf.sos` olayının konum, sessiz SOS ve afet alanları RFC-0031'dedir; misafir de `hf.sos` bırakabilir (RFC-0031 §4.1). Bu RFC yalnız tür adını, koleksiyonu ve merdiveni tanımlar.

### 6.2 Yapılandırma ve vaka kayıtları (`olay: false`)

| Tür | Ne | Yazan | Bölüm |
|-----|----|-------|-------|
| `hf.rutin` | Rutin tanımı | Üye | §8.1 |
| `hf.kural` | Kural tanımı | Üye | §9.1 |
| `hf.vaka` | Vaka açılışı | Üye ya da cihaz | §10.2 |
| `hf.vaka.basamak` | Merdiven basamağı | Üye ya da cihaz | §10.2 |
| `hf.vaka.sahip` | "Ben bakıyorum" | Yalnız üye | §10.2 |
| `hf.vaka.kapat` | Vakanın kapanışı | Yalnız üye | §10.2 |
| `hf.kart` | Kart | Üye | §13 |
| `hf.kart.not` | Karta elle not | Üye | §13 |
| `hf.olay.duzelt` | "Bu olay yanlış" | Yalnız üye | §7.3 |
| `hf.saklama` | Koleksiyonun saklama sınırı | Üye | §14.2 |
| `hf.wipe.report` | Silme raporu (RFC-0003 §8) | Ebeveyn | — |

`hf.vaka*` ve `hf.kart.not` kayıtları `_t` taşır ve süreli olabilir (§14). Diğerleri süresizdir.

Misafirin `GRANT_WRITE` ile bıraktığı olaylar (RFC-0030) rutine, kurala ve vakaya diğer olaylar gibi girer. Misafir vaka sahiplenemez, kapatamaz ve bildirim merdiveninin kitlesinde değildir.

## 7. Güven

### 7.1 Düzeyler

| `_conf` | Düzey | Motor ne yapar |
|---------|-------|----------------|
| 80–100 | Yüksek | Sayar. Tek başına vaka açabilir. |
| 50–79 | Orta | Sayar. Tek başına vaka açamaz (§7.2). |
| 0–49 | Düşük | Saymaz. Kartta katlanmış "belirsiz" satırı olarak görünür. |

İnsanın yazdığı olayda `_conf` yazılmaz (100 sayılır).

### 7.2 Vaka açma koşulu

Bir kural ya da rutin, değerlendirdiği pencerede şu koşullardan biri sağlanmadıkça vaka açmaz:

- en az bir yüksek güvenli olay katkıda bulunuyor; ya da
- en az iki orta güvenli olay katkıda bulunuyor ve bunların `_t` değerleri farklı.

Bu, çatı §8'deki "düşük güvenli olay tek başına uyarı üretmez" kuralının sayısal karşılığıdır. "Hiç olay yok" (rutinde `az`, kuralda `yok`) koşulu bu denetimden muaftır, çünkü katkı veren olay yoktur; onun yerine gözlem kesintisi denetimi uygulanır (§8.4).

### 7.3 Düzeltme

- Kullanıcı karttaki bir olaya "Bu yanlış" derse telefon `hf.olay.duzelt { hedef: <recordId hex>, gecersiz: true }` yazar.
- Hedef olay bütün motorlarda sayılmaz. Kural sıradan bağımsızdır: düzeltme kaydı varsa olay yoktur.
- Düzeltmeyi yalnız koleksiyonun yazarı olan üye yazar. Düzeltme kaydı silinirse olay geri gelir.
- Düşük güvenli olayların saklama süresi en çok 7 gündür (§14.1).

## 8. Rutin

### 8.1 Rutin tanımı (`hf.rutin`)

| Alan | Değer | Varsayılan | Anlam |
|------|-------|------------|-------|
| `_subj` | string | — | Özne |
| `olay` | string | — | İzlenen olay türü |
| `olcu` | string | — | `sayi`, `toplam` ya da `bosluk` (§8.3) |
| `alan` | string | — | `toplam` için toplanan int alan |
| `pencereler` | list<list<int>> | `[[0, 1440]]` | Gün içi pencereler, yerel dakika, `[başlangıç, bitiş)` |
| `utc_dk` | int | 180 | Yerin UTC farkı, dakika |
| `gun_basi_dk` | int | 0 | Günün başladığı yerel dakika |
| `gecmis_gun` | int | 28 | Öğrenmeye giren en çok gün (7–56) |
| `en_az_gun` | int | 7 | Olgunluk için en az geçerli gün |
| `k` | int | 3 | Bant genişliği katsayısı |
| `en_dar` | int | 1 | Bandın en dar yarı genişliği |
| `onem` | int | 2 (dikkat) | Sapmanın önemi (§11.2) |
| `aktif` | bool | true | — |

- Rutin kaydı olayların bulunduğu koleksiyondadır. Yazanı koleksiyonun yazarı olan üyedir.
- Bir koleksiyonda aynı `(_subj, olay, olcu, alan)` için birden çok rutin kaydı varsa geçerli olan, türü belirleyen işlemi en küçük olanıdır; diğerleri arayüzde "kopya" olarak birleştirilmeye sunulur.
- **Saat farkı neden sabit:** IANA saat dilimi verisi cihazdan cihaza farklı sürümde olabilir ve sonucu değiştirebilir. `utc_dk` kayıtta yazılı olduğu için her cihaz aynı günü hesaplar. Yaz saati uygulanan yerlerde uygulama, geçişte rutin kaydını yeni `utc_dk` ile günceller; o güne kadarki günler eski değerle hesaplanmış sayılmaz, her gün kaydın **o anki** değeriyle yeniden hesaplanır. Bu, geçiş günü için bir saatlik kaymayı kabul eder.

### 8.2 Gün ve pencere

```
yerel_ms  = _t + utc_dk × 60000 − gun_basi_dk × 60000
gün       = floor(yerel_ms / 86400000)
dakika    = floor((yerel_ms mod 86400000) / 60000)
```

Olay, `başlangıç ≤ dakika < bitiş` olan pencereye düşer. Pencereler örtüşebilir; her pencere ayrı değerlendirilir.

### 8.3 Ölçüler

Bir gün ve bir pencere için değer `x`:

| Ölçü | `x` |
|------|-----|
| `sayi` | Pencereye düşen sayılabilir olay sayısı (§4.5, §7.1; tekil anahtarlar bir kez) |
| `toplam` | Bu olaylarda `alan` değerlerinin toplamı. Alanı olmayan olay 0 katar. |
| `bosluk` | Pencere içindeki en uzun olaysız süre, dakika. Pencere başından ilk olaya ve son olaydan pencere sonuna kadar olan süreler de sayılır. |

### 8.4 Öğrenme ve normal bant

1. **Geçmiş günler:** Değerlendirilen günden önceki `gecmis_gun` tam gün.
2. **Dışarıda kalan günler:**
   - **Gözlem kesintisi:** Olayın gözlem kaynağı olan cihazın (`_obs` ya da yazar) `hf.device.offline`–`hf.device.online` aralıkları pencerenin %25'inden fazlasını kaplıyorsa o gün o pencere için öğrenmeye girmez ve o pencere için sapma üretilmez.
   - **Gerçek sorun günü:** O rutin için açılmış ve `sonuc = 'gercek'` ile kapatılmış bir vakanın penceresi öğrenmeye girmez. Böylece hastalıklı bir gün normali bozmaz.
3. **Olgunluk:** Geçerli gün sayısı `en_az_gun`'den azsa rutin olgun değildir. Olgun olmayan rutin sapma üretmez; kartta "Normal öğreniliyor (4/7 gün)" yazar.
4. **Bant:** `n` geçerli günün değerleri `x_1 … x_n` için

   ```
   alt_ortanca(L) = sırala(L)[floor((|L| − 1) / 2)]
   m   = alt_ortanca(x)
   mad = alt_ortanca(|x_i − m|)
   w   = max(k × mad, floor((m + 3) / 4), en_dar)
   alt = m − w
   üst = m + w
   ```

   Bütün işlemler tamsayıdır. Ortanca ve ortanca mutlak sapma, birkaç uç günün bandı bozmaması için seçildi. Ortalama ve standart sapma kullanılmaz, çünkü kayan nokta cihazlar arasında farklı sonuç verebilir.

### 8.5 Sapma

| Yön | Ne zaman | `yon` |
|-----|----------|-------|
| `cok` | Pencere sürerken ya da bitince `x > üst`. `sayi` ve `toplam`'da pencere bitmeden de tespit edilir. `bosluk`'ta süren boşluk `üst`'ü aşınca. | 1 |
| `az` | Yalnız pencere bittikten sonra `x < alt` | 2 |

- Sapma bir vaka açar (§10). Vakanın `pencereBasi` değeri pencerenin başlangıcının Unix ms karşılığıdır.
- `alt ≤ 0` ise `az` sapması üretilmez. "Hiç yemedi" gibi durumlar kuralla yakalanır (§9).
- Rutinin bandı hiçbir zaman bir kuralın eşiğini genişletmez (§9.3).

## 9. Kural

### 9.1 Kural tanımı (`hf.kural`)

| Alan | Değer | Anlam |
|------|-------|-------|
| `_subj` | string | Özne. `*` ise türün bütün özneleri için ayrı ayrı. |
| `kosullar` | list<list> | Her öğe `[olay, olcu, alan, pencere_dk, karsilastirma, deger]`. Hepsi aynı anda sağlanmalı (VE). |
| `eylem` | string | `vaka` ya da `sustur` |
| `onem` | int | 0–3 (§11.2) |
| `hizmet` | bool | `true` ise merdivene 5. basamak eklenir (yalnız önem ≥ 2) |
| `sessiz_disi` | bool | `true` ise sessiz saatlere uyulmaz (yalnız önem 3) |
| `sureler` | list<int> | Basamak bekleme sürelerinin yerel ayarı, dakika (§11.2); yoksa varsayılan |
| `aktif` | bool | — |
| `bicim`, `gun_saati`, `gun`, `utc_dk`, `kapatan_olay`, `kesintide_ac` | — | Sabit pencereli kural (biçim 2) ve kapatan olay: RFC-0032 §4. Biçim 2'de `pencere_dk = 0`. |

**Koşul öğesi:**

| Parça | Değerler |
|-------|----------|
| `olay` | Olay türü |
| `olcu` | `sayi`, `toplam`, `yok` |
| `alan` | `toplam` için alan adı; diğerlerinde boş metin |
| `pencere_dk` | Kayan pencerenin uzunluğu, 1–1440 |
| `karsilastirma` | `gt`, `ge`, `lt`, `le` (`yok`'ta yok sayılır) |
| `deger` | int |

`yok` ölçüsü "son `pencere_dk` dakikada bu türden sayılabilir olay yok" demektir.

Örnekler:

| Durum | Kural |
|-------|-------|
| Coki 12 saattir yemedi | `[['yuva.pet.beslenme', 'yok', '', 720, 'gt', 0]]`, önem 2 |
| Kum kabı 2 gündür temizlenmedi | Biçim 2: `[['yuva.pet.kum', 'yok', '', 0, 'gt', 0]]`, `gun_saati: [1200, 1200]`, `gun: 2`, `kapatan_olay: ['yuva.pet.kum']`, önem 1 (RFC-0032 §7.2) |
| Soğuk oda 8 °C'yi geçti | `[['mekan.sicaklik.olcum', 'toplam', 'c_x10', 1, 'gt', 80]]`, önem 3 |

### 9.2 Değerlendirme

- **Kayan pencere:** Bir koşul, `[T − pencere_dk, T)` aralığında değerlendirilir. `T` değerlendirme anıdır: olayla tetiklenen değerlendirmede o olayın `_t + 1`'i, zamanla tetiklenen değerlendirmede (`yok`) motorun o anki saati.
- **Vaka penceresi:** Kural tetiklenince `pencereBasi = floor(T / (pencere_dk × 60000)) × pencere_dk × 60000` olur. `pencere_dk` en uzun koşulunkidir. Böylece aynı tetikleme farklı motorlarda aynı vakaya düşer; ardışık tetiklemeler aynı pencere içinde yeni vaka açmaz.
- **Kesinti:** `yok` koşulu, gözlem kaynağı pencerenin %25'inden fazlasında çevrimdışıysa tetiklenmez (§8.4). Onun yerine `hf.device.offline` olayı zaten vardır.
- **Güven:** §7.2.
- **Sabit pencere (biçim 2):** Yerel gün saatine bağlı pencere, pencere bitince değerlendirme, çok günlük pencerede tekrar yok, kesintide açma: RFC-0032 §5.

### 9.3 Kural her zaman rutinin önüne geçer

1. **Tetikleme:** Rutin "normal" dese bile kural tetiklenirse vaka açılır.
2. **Bastırma:** Aynı özne ve aynı olay türü için, pencereleri örtüşen bir kural vakası varsa rutin vakası **bastırılmış** sayılır: bildirim üretmez, kartta kural vakasının altında not olarak görünür. Bu, kayıtların kümesinden hesaplanır; hangisinin önce yazıldığı önemli değildir.
3. **Susturma:** `eylem = 'sustur'` olan kural, koşulu sağlandığı pencerede aynı özne ve türün **rutin** vakalarını bastırır. Bir kural vakasını bastıramaz. Örnek: "Bayram günü misafir var, kedinin kum kabı sayısı normal dışı olabilir."
4. **Kurallar arasında:** Aynı özne ve pencerede birden çok kural vakası varsa hepsi açık kalır. Merdiven her biri için ayrı yürür, ama telefon aynı özne için aynı anda tek bildirim gösterir: önemi en yüksek olanı; eşitlikte `vaka` bayt sırasıyla küçük olanı.

### 9.4 Çekirdek kuralları

Bunlar kayıt olmadan, her motorda yerleşik çalışır. Kaynak kimliği `hash('hf/vaka-cekirdek/', tür adı)[0..16]`'dır.

| Olay | Kural | Önem | Not |
|------|-------|------|-----|
| `hf.sos` | Her olay vaka açar; pencere 1 dakika | 3 (acil) | Sessiz saatlere uyulmaz. 2. ve 3. basamak birlikte yazılır; 3. basamağın kitlesi bütün okuyuculardır (§11.1). 5. basamak "112'yi ara" düğmesidir; hiçbir şey kendiliğinden aranmaz. |
| `hf.kayit.kutu-dolu` | Her olay; pencere 1 gün | 2 | — |
| `hf.device.overheat`, `hf.device.battery` | Her olay; pencere 1 gün | 2 | — |
| Önemi 1 olan katalog olayları | Her olay; pencere 1 gün | 1 | Yalnız 2. basamak |
| Önemi 0 olan katalog olayları | Vaka açmaz | — | Yalnız kartta görünür |

## 10. Vaka

### 10.1 Vaka anahtarı

```
ozneOzeti = hash('hf/ozne/', _subj)
vaka      = hash('hf/vaka/', collectionId, kaynakId, ozneOzeti, u64be(pencereBasi), u64be(yon))[0..16]
```

| Parça | Değer |
|-------|-------|
| `kaynakId` | Rutin ya da kuralın `recordId`'si; çekirdek kuralında §9.4'teki kimlik |
| `pencereBasi` | §8.5 ya da §9.2 |
| `yon` | Rutinde 1 `cok`, 2 `az`; kuralda 0 |

İki motor aynı sapmayı bulursa aynı `vaka` değerini hesaplar.

### 10.2 Vaka kayıtları

Vakanın bütün durumu, **vakayı doğuran olayların koleksiyonunda** kayıtlar olarak durur. Böylece vakayı gören herkes olayları da görebilir ve hiçbir bilgi koleksiyon sınırını aşmaz.

Her öğe ayrı kayıttır (RFC-0001 §5 madde 5). `recordId`'ler RFC-0001'deki gibidir; aynı vakaya ait kayıtlar `vaka` alanıyla birleşir.

| Tür | Alanlar | Yazan |
|-----|---------|-------|
| `hf.vaka` | `vaka` (bytes 16), `_subj`, `_t` (tespit anı), `kaynak` (`rutin:<hex16>`, `kural:<hex16>`, `cekirdek:<tür>`), `onem`, `ilk` (ilk basamak), `son` (son basamak), `yon`, `deger` (ölçülen değer), `alt`, `ust` (rutinde bant), `olaylar` (katkı veren en çok 16 olayın `recordId` hex listesi), `ozet` (şablon kimliği), `_keep` | Üye (`put`) ya da cihaz (`append-event`) |
| `hf.vaka.basamak` | `vaka`, `basamak` (1–5), `sira` (int), `_t` | Üye ya da cihaz |
| `hf.vaka.sahip` | `vaka`, `_t` | Yalnız üye |
| `hf.vaka.kapat` | `vaka`, `sonuc` (`gercek`, `yanlis`, `bilgi`), `_t` | Yalnız üye |

### 10.3 Vaka durumu

Durum, koleksiyonun geçerli kayıtlarından hesaplanan bir işlevdir. Kayıtların geliş sırası sonucu değiştirmez.

1. **Açılış:** Aynı `vaka` değerini taşıyan `hf.vaka` kayıtlarından, türü belirleyen işlemi `(hlc, authorId, opId)` sırasıyla en küçük olanı **asıl** açılıştır. `onem`, `ilk`, `son` ondan okunur. Diğerleri yok sayılır.
2. **Geçerli basamak:** `(b, s)` geçerlidir eğer:
   - `ilk ≤ b ≤ son`;
   - `b = 4` ise `s + 1 < |sorumlu listesi|` (§11.1); diğer basamaklarda `s = 0`;
   - `b = ilk` ve `s = 0`; ya da `s > 0` ve `(b, s − 1)` geçerli; ya da `s = 0`, `b > ilk` ve `b − 1` basamağında herhangi bir sıra geçerli.
   - **Tek sorumlu:** Sorumlu listesinde tek kişi varsa 4. basamak yoktur; `(5, 0)` için geçerli bir `(3, 0)` yeter.

   Yani basamak atlanmaz.
3. **Ulaşılan basamak:** Geçerli `(basamak, sira)` ikililerinin sözlük sırasıyla en büyüğü.
4. **Sahip:** Geçerli bir `hf.vaka.sahip` varsa vaka **sahiplidir**. Sahip olarak gösterilen, türü belirleyen işlemi en küçük olan sahiplenme kaydının yazarıdır. Birden çok sahiplenme olabilir; hepsi merdiveni durdurur.
5. **Kapanış:** Geçerli bir `hf.vaka.kapat` varsa vaka **kapalıdır**. Birden çok kapanışta `sonuc` en küçük işlemli kayıttan okunur.
6. **Bastırılmış:** §9.3 madde 2 ya da 3 uyuyorsa.
7. **Yazar denetimi:** `hf.vaka.sahip` ve `hf.vaka.kapat` yalnız yazarı üye olan işlemden geçerlidir. Yazarın koleksiyona yazma yetkisini kayıt katmanı, işlemin `ledgerSeq` anına göre zaten denetlemiştir (RFC-0001 §7 koşul 4). Cihazın yazdığı bu türler yok sayılır.
8. **Çözülmüş:** Kuralın `kapatan_olay` türünden, aynı özne için, `_t ≥ pencereBasi` olan geçerli bir olay varsa ya da koşul artık sağlanmıyorsa vaka **çözülmüştür** (`cozuldu`). Çözülme kayıt değil, hesaplanan durumdur; misafirin bıraktığı olay da çözer (RFC-0032 §6).

Bu maddelerin hepsi yalnız geçerli kayıtlar kümesine bakar. Yerel saat, kayıtların geliş sırası ve hangi motorun önce yazdığı sonucu değiştirmez. Sahipli, kapalı, çözülmüş ya da bastırılmış bir vakanın basamak kayıtları, ne zaman yazılmış olursa olsun, geçerli kalır ama **bildirim üretmez**.

## 11. Bildirim merdiveni

### 11.1 Basamaklar ve kitle

| # | Basamak | Ne olur | Kitle |
|---|---------|---------|-------|
| 0 | Kayıt | Olay koleksiyondadır. Vaka yoktur. | — |
| 1 | Kart notu | Vaka kartta görünür. Bildirim yoktur. | — |
| 2 | Topluluk sohbeti | Vaka, kart notu olarak topluluk sohbetinde görünür. Kitleye bildirim gider. | Koleksiyonun okuyucusu olan bütün üyeler |
| 3 | Sorumlu kişi | Öncelikli bildirim | `sorumlu[0]`. `hf.sos`'ta bütün okuyucular. |
| 4 | Sıradaki kişi | Öncelikli bildirim, sırayla | `sorumlu[sira + 1]` |
| 5 | Dış hizmet | Sorumluya "Veterinere göndereyim mi?" gibi bir **öneri** gider. Hiçbir şey kendiliğinden dışarı çıkmaz. | `sorumlu[0]` |

**Sorumlu listesi:**

1. Öznenin kartındaki `sorumlu` listesi (§13), sırasıyla.
2. Kart yoksa ya da liste boşsa: koleksiyonun okuyucusu olan ebeveynler, `memberId` bayt sırasıyla. Mekan'da önce okuyucu sahipler, sonra okuyucu yöneticiler, her grupta `memberId` sırasıyla (RFC-0005 §14).
3. Listeden, vakanın koleksiyonunun okuyucusu olmayanlar çıkarılır. Böylece bildirim, okuyamayacağı bir vakayı kimseye göstermez.
4. Liste sonunda, listede olmayan okuyucu ebeveynler (Mekan'da sahipler ve yöneticiler) 2. maddedeki sırayla eklenir. Böylece 4. basamak her zaman bir yetkiliye ulaşır.

`uye:` başvuruları `rotatedTo` zincirinin aktif ucuna çözülür (RFC-0003 §5.13). Okuyuculuk cihazın uyguladığı son defter durumuna göre, kart geçerli kayıtlardan hesaplanır. Liste saate ve geliş sırasına bağlı değildir: aynı defter ve aynı kayıtlarla her cihaz aynı listeye, dolayısıyla aynı geçerli basamaklara (§10.3 madde 2) varır.

**Kart notu sohbette:** Topluluk sohbeti bir ratchet sohbetidir; vaka ona mesaj olarak gönderilmez. Her telefon, okuyabildiği koleksiyonlardaki ulaşılan basamağı ≥ 2 olan vakaları, sohbet akışında 2. basamak kaydının `hlc` sırasına yerleştirerek kendisi çizer. Koleksiyonun okuyucusu olmayan üye (ör. çocuk) kart notunu görmez, çünkü kaydı çözemez. Yeni mesaj türü gerekmez.

### 11.2 Önem ve süreler

| Önem | Ad | `ilk` | `son` | Varsayılan bekleme (yerel ayar) |
|------|----|-------|-------|--------------------------------|
| 0 | bilgi | 1 | 1 | — |
| 1 | duyuru | 2 | 2 | — |
| 2 | dikkat | 2 | 4 (`hizmet` ise 5) | 2 → 3: 30 dk; 3 → 4: 60 dk; sıra arası 60 dk; → 5: 60 dk |
| 3 | acil | 2 | 4 (`hizmet` ise 5) | 2 ve 3 birlikte; 3 → 4: 5 dk; sıra arası 5 dk; → 5: 5 dk |

- Bekleme süreleri **varsayılandır, değiştirilebilir** (kuralın `sureler` alanı). Süre, motorun bir sonraki basamağı ne zaman yazacağını belirler. Yazılan basamağın geçerliliğini değiştirmez.
- Rutin vakalarının önemi rutinin `onem` alanından gelir (varsayılan dikkat).

### 11.3 Çift bildirim olmaz

Kural:

1. **Her telefon yalnız kendi kullanıcısına haber verir.** Telefon başka bir kişi adına bildirim göstermez.
2. Telefon, kullanıcısı bir geçerli `(vaka, basamak, sira)`'nın kitlesindeyse ve vaka sahipli, kapalı ya da bastırılmış değilse bildirim gösterir.
3. Telefon her `(vaka, basamak, sira)` için **en çok bir kez** bildirim gösterir. Bu küme telefonda yereldir ve vakanın saklama süresi kadar tutulur.
4. Telefon bir vaka için ekranda tek bildirim tutar. Yeni basamak aynı bildirimi günceller. Ses ve titreşim yalnız kullanıcı yeni basamağın kitlesindeyse çalar.
5. Vaka sahiplenince ya da kapanınca telefon bekleyen bildirimini kaldırır ve planlanmış yerel bildirimini iptal eder (§11.5).

Bu kuralla bir basamağın kaydı iki motor tarafından iki kez yazılsa da, iki uyandırma zarfı gelse de kişi bir kez haber alır. Kim yazarsa yazsın durum aynıdır.

### 11.4 Basamak yazma sırası

Aynı basamağı gereksiz yere çok motorun yazmaması için bir sıra vardır. Bu sıra yalnız trafiği azaltır, geçerliliği etkilemez (RFC-0001 §9.2'deki anahtar üretme düzeni gibi).

1. Vakayı bir işçi açtıysa (açılış yazarı `device:`), işçi kendi saatine göre basamakları yazar ve uyandırır. İşçi sahiplenmeyi okuyamaz; `VAKA_DUR` alınca durur (§11.5).
2. Telefonlar sırası: `sorumlu` listesi sırası, sonra diğer okuyucu yazarlar `memberId` sırasıyla. Telefon, sıradaki yeri `r` ise bekleme süresine `r × 2 dakika` ekler. Bu sürede kaydı görürse yazmaz.
3. Sahipli, kapalı, çözülmüş ya da bastırılmış vakada hiçbir motor yeni basamak yazmaz.

**Okuyucu olup yazar olmayan üye** basamak, sahiplenme ve kapanış yazamaz. Arayüz ona "Ben bakıyorum" düğmesini göstermez. Bu yüzden Olaylar koleksiyonunun varsayılan yazarlarına yetişkin eklenir (§19).

### 11.5 Uyandırma zarfları

iPhone arka planda çalışmaz. Bildirimin çıkması için telefonun uyanması gerekir. Basamağı yazan cihaz, kitleye bir uyandırma zarfı gönderir. Zarf çift kanalında gider; alıcı kapalıysa kutuda `HOLD` ile bekler ve kutu zili çalar (09 §9). Kutu yoksa Posta Kutusu yoluna düşer.

```
VAKA_UYANDIR (0xC0) {
  collectionId : fixed16
  vaka         : fixed16
  basamak      : uint        // 1–5
  sira         : uint
  onem         : uint        // 0–3
  baslik       : string      // ≤ 120 bayt UTF-8, boş olabilir
  senderId     : fixed16
  sig          : fixed64     // etiket 'hf/vaka-uyandir/'
}

VAKA_DUR (0xC1) {
  collectionId : fixed16
  vaka         : fixed16
  tur          : uint        // 0 sahiplenildi, 1 kapandı
  byId         : fixed16
  sig          : fixed64     // etiket 'hf/vaka-dur/'
}
```

**`VAKA_UYANDIR` alıcısının denetimi:**

| # | Koşul | Sağlanmazsa |
|---|-------|-------------|
| 1 | `sig`, `senderId`'nin anahtarıyla geçerli | Atılır |
| 2 | `senderId`, bugün `collectionId`'nin okuyucusu olan bir üye **ya da** `writers` listesinde `device:` olarak bulunan bir cihaz | Atılır |
| 3 | Alıcı bugün koleksiyonun okuyucusu | Atılır |
| 4 | `1 ≤ basamak ≤ 5` | Atılır |
| 5 | Aynı `(vaka, basamak, sira)` için daha önce zarf alınmadı | Sessizce atılır |
| 6 | Gönderen başına saatte en çok 30 zarf | Fazlası atılır |

Denetim geçince telefon önce koleksiyonu eşitlemeye çalışır. Kayıtlar gelirse §11.3'e göre davranır. Gelmezse ve zarfın basamağının kitlesindeyse, `baslik` ile (boşsa "Olaylar'da yeni bir durum var") tek bildirim gösterir ve bunu §11.3 madde 3'teki kümeye yazar. Zarf yalnız ipucudur; vakanın durumunu kayıtlar belirler.

**`VAKA_DUR`:** "Ben bakıyorum" ya da kapanışı yazan telefon, kayıtla birlikte bu zarfı vakanın kitlesindeki bütün üyelere ve vakayı açan cihaza gönderir. Alıcı `byId`'nin o koleksiyonun yazarı olan bir üye olduğunu ve imzayı denetler. Telefon bildirimini kaldırır; cihaz o vaka için basamak yazmayı ve uyandırmayı bırakır.

**Taşıma:** İki zarf da RFC-0003 §6.4'teki emanet ve Posta Kutusu mührüyle kapatılır (anahtar `derive(pair, 'ctrl')`). Kutu ve Posta Kutusu ne vakayı ne başlığı görür. Doğrudan Noise oturumunda ek mühür gerekmez.

**Planlanmış yerel bildirim:** Telefon bir vakayı gördüğünde, kullanıcısının kitlesinde olacağı sonraki basamak için işletim sisteminin yerel bildirimini bekleme süresine göre planlar. Böylece hiçbir motor çalışmasa da sorumlu kişi haber alır. Vaka sahiplenir, kapanır ya da o basamak zaten bildirilirse plan iptal edilir. `VAKA_DUR` ulaşmazsa planlanmış bildirim yine çıkabilir; uygulama açılınca "Ayşe bakıyor" gösterilir. Bu sınır kabul edilmiştir.

### 11.6 Sessiz saatler

- Kartın `sessiz` aralığında 2. basamak bildirimleri sessiz gösterilir. Dikkat önemindeki vakalarda 3. ve 4. basamak sessiz saat bitene kadar yazılmaz.
- Acil önemde ve `sessiz_disi: true` olan kurallarda sessiz saat yok sayılır.

### 11.7 Dış hizmet

- 5. basamak hiçbir zaman veriyi dışarı göndermez. Yalnız sorumluya bir öneri kartı gösterir: "Coki'nin son 3 günlük kum kabı özetini veterinere gönder?"
- Gönderim, çatı §9'daki hizmet paylaşımıyla olur: sahibinin onayı, `SHARE_CONSENT` olayı (RFC-0003 §5.7), tek seferlik paket. Paketin biçimi hizmet geçidinin RFC'sindedir.
- Pakete yalnız `_scope = 'hizmet'` olan olaylar ve vaka özeti girebilir.
- `hf.sos`'ta 5. basamak bir telefon araması önerisidir ("112'yi ara"). Arama, kişinin kendi dokunuşuyla telefonun kendi arama ekranından yapılır.

## 12. Motorlar

| Yer | Ne çalıştırır | Neyi görür |
|-----|---------------|------------|
| Üye telefonu | Rutin, kural, vaka durumu, merdiven, kart | Okuyucusu olduğu koleksiyonlar |
| İşçi (sürekli görevin içinde) | Yalnız biçim 1 kural; pencere ≤ 1440 dakika; durum bellekte (biçim 2'yi değerlendirmez, RFC-0032 §5.5) | Yalnız kendi ürettiği olaylar |
| Kutu | Hiçbiri | Hiçbiri (kurucu §12) |
| Misafir telefonu | Yalnız kart ve vaka gösterimi | Kendi koleksiyonları (`bakici`). `olaylar` koleksiyonuna erişemez. |

**İşçide neden yalnız kural:** İşçi `olaylar` koleksiyonunu okuyamaz (RFC-0001 §10). Rutin öğrenmek 28 günlük geçmiş ister; işçi bunu tutarsa görev bittikten sonra da veri saklamış olur (RFC-0002 §6, iş bitince silme). Kural ise yalnız son pencereye bakar ve bellekte tutulabilir. Sonuç: hızlı ve sabit eşikli uyarılar (soğuk oda, SOS düğmesi, duman) evdeki işçiden hemen çıkar; normali öğrenmek telefonların işidir.

**İşçi motorunun çalışması:**

1. Telefon sürekli görevi verirken (RFC-0002 §10) ilgili `hf.kural` kayıtlarını, `recordId`'leriyle, ve öznenin `sorumlu` listesini görev parametresine koyar. Kural ya da kart değişince görevi yeniler.
2. İşçi kendi ürettiği olayları kurallarla değerlendirir. Tetiklenince `hf.vaka` ve ilk basamak kaydını `REC_DROP` ile bırakır, kitleye `VAKA_UYANDIR` gönderir.
3. Sonraki basamakları kendi saatine göre yazar; `VAKA_DUR` alınca durur.
4. Görev bitince ya da iptal edilince kural durumu silinir.

**Telefon motoru:** Uygulama ön planda, arka plan penceresinde (iOS arka plan yenilemesi, Android iş planlayıcısı) ve bir uyandırma zarfı işlenirken çalışır. Aynı koleksiyon verisinden her telefon aynı vakalara, aynı basamaklara ve aynı sorumlulara varır.

**Geç gelen olay:** `hlc`'si, olayın penceresinin bitişinden 24 saatten fazla sonra olan olay rutin istatistiğine girer ama yeni vaka açmaz. Böylece günler sonra eşitlenen bir telefon eski bir sapma için kimseyi uyandırmaz.

## 13. Kart

### 13.1 Kart kaydı (`hf.kart`)

| Alan | Değer | Anlam |
|------|-------|-------|
| `_subj` | string | Özne (§4.3). Zorunlu. |
| `ad` | string | Görünen ad. Yoksa defterdeki ad (`BEING`, `PLACE`, cihaz, üye). |
| `foto` | blobRef | Kart resmi |
| `modul` | string | Kartı çizen modül (`yuva.pet`, `yuva.bakim`, `mekan.stok`) |
| `sorumlu` | list<string> | `uye:<hex16>` listesi, sırayla (§11.1) |
| `sessiz` | list<int> | `[başlangıç_dk, bitiş_dk]`, yerel; bitiş başlangıçtan küçükse gece yarısını aşar |
| `utc_dk` | int | Sessiz saat için yerin UTC farkı |
| `olaylar` | list<string> | Kartta gösterilen olay türleri; yoksa öznenin bütün olayları |
| `sabit` | bool | Topluluk sohbetinin üstünde sabitlenir |

- Kart, öznenin olaylarının bulunduğu koleksiyondadır. Böylece kartı görebilen olayları da görebilir.
- **Tek kart:** Bir koleksiyonda aynı `_subj` için birden çok `hf.kart` varsa asıl olan, türü belirleyen işlemi en küçük olanıdır. Diğerleri arayüzde "kopya kart, birleştir" olarak görünür. Birleştirme, kopyanın silinmesidir.
- Ürün, özne ilk olayını aldığında kartı kendiliğinden önerir; kartı oluşturan, kartı yazan üyedir.

### 13.2 Kart ekranı

Kart açılınca telefon şunları kayıtlardan hesaplar:

- son olaylar (türün `ozet` şablonuyla);
- her olgun rutinin bugünkü değeri ve normal bandı: "Bugün 3 kez yedi · normal 4–6";
- açık vakalar, ulaşılan basamak, sahibi;
- belirsiz (düşük güvenli) olaylar, katlanmış;
- elle notlar.

Kartta "Ben bakıyorum", "Kapat (gerçek sorun / yanlış alarm / bilgi)" ve "Bu olay yanlış" düğmeleri vardır.

### 13.3 Elle not (`hf.kart.not`)

`{ _subj, _t, metin (≤ 1 KB), _keep }`. Karta düşülen insan notudur: "Coki'ye ilacını verdim." Merdiven başlatmaz. Varsayılan `_keep` 365.

## 14. Saklama

### 14.1 Süreli kayıt

- Bir kaydın türünü belirleyen işlemi `_t` ve `_keep > 0` taşıyorsa kayıt **süreli**dir.
- Yazan, `_keep` değerini türün tanımından alır (§5.2). Düşük güvenli olayda (`_conf < 50`) yazan `_keep ≤ 7` yazar; okuyucu da etkin süreyi en çok 7 gün sayar.
- Vaka kayıtlarında varsayılan 365 gündür.

### 14.2 Koleksiyon sınırı (`hf.saklama`)

`{ tur: string, gun: int ≥ 1 }`. `tur` bir tür adı öneki (`yuva.pet.`) ya da `*`'dır.

**Etkin süre:**

```
k = _keep (0 ise sonsuz)
her silinmemiş hf.saklama için, tur kaydın türünün öneki ya da '*' ise:
    k = min(k, gun)
_conf < 50 ise k = min(k, 7)
```

`min` kullanıldığı için birden çok saklama kaydının sırası sonucu değiştirmez. Mekan'da KVKK saklama süreleri bu kayıtla uygulanır.

### 14.3 Temizlik

- **Eşik:** `M` = koleksiyondaki en büyük geçerli `hlc`'nin milisaniyesi. Süreli bir kayıt `_t + k × 86400000 < M` ise süresi dolmuştur. Eşik yerel saate değil koleksiyonun verisine bağlıdır (RFC-0001 §13'teki gibi). Hiç yeni veri gelmeyen bir koleksiyonda kayıt dolmaz; bu kabul edilmiştir.
- **Ne olur:** Cihaz o kaydın **bütün** işlemlerini siler, türü belirleyen işlem dahil. İşlem kimlikleri ve `recordId` mezar listesine girer. O `recordId` için sonradan gelen hiçbir işlem kabul edilmez. Böylece kaydın türü temizlikten sonra başka bir şeye dönemez.
- `del` işlemi yazılmaz. Her okuyucu aynı veriden aynı kaydı temizler; bu yüzden ek trafik gerekmez.
- Kutudan `REC_PRUNE` ile budanır (RFC-0001 §12.2).
- **Dosyalar:** Süresi dolan kaydın başvurduğu ve başka canlı kaydın başvurmadığı dosyalar için sıralamada ilk ebeveyn telefonu `BLOB_DEL` gönderir (RFC-0001 §11.2).
- Bu kural RFC-0001 §13'e bir eklemedir (§19).

### 14.4 Varsayılan süreler

| Kayıt | Gün |
|-------|-----|
| Sensör ve kamera olayları (`yuva.pet.*`, `mekan.vision.*`) | 90 (ürün değiştirebilir) |
| `hf.device.*`, `hf.task.*`, `hf.backup.*` | 30 (bazıları §6.1'de farklı) |
| `hf.vaka*`, `hf.sos`, `hf.kart.not` | 365 |
| `hf.wipe.*`, kart, rutin, kural, saklama | Süresiz |

## 15. SDK yüzeyi ve komutlar

```ts
interface Olay {
  turKaydet(tanim: OlayTuru): void
  yaz(collectionId, tur, alanlar): Promise<RecordId>
  sorgula(collectionId, { tur?, ozne?, from?, to?, limit? }): Promise<OlayKaydi[]>
  kartlar(collectionId?): Promise<Kart[]>
  kartYaz(collectionId, recordId | null, alanlar): Promise<RecordId>
  rutinYaz(collectionId, recordId | null, alanlar): Promise<RecordId>
  kuralYaz(collectionId, recordId | null, alanlar): Promise<RecordId>
  vakalar(collectionId?, { durum? }): Promise<Vaka[]>   // durum: 'acik' | 'sahipli' | 'kapali' | 'cozuldu' (RFC-0032)
  sahiplen(collectionId, vaka): Promise<void>
  kapat(collectionId, vaka, sonuc): Promise<void>
  rutinDurumu(collectionId, rutinId): Promise<{ olgun, gun, m, alt, ust, bugun }>
  on('vaka', (v: Vaka) => void)
}
```

Yuva Hat çekirdek komutları (`packages/protocol/komutlar.js`):

| No | Komut |
|----|-------|
| 260 | `EVENT_WRITE` |
| 261 | `EVENT_QUERY` |
| 262 | `CARD_LIST` |
| 263 | `CARD_WRITE` |
| 264 | `ROUTINE_WRITE` |
| 265 | `RULE_WRITE` |
| 266 | `CASE_LIST` |
| 267 | `CASE_CLAIM` |
| 268 | `CASE_CLOSE` |
| 269 | `ROUTINE_STATUS` |

Worklet'ten arayüze yeni olay adı: `vaka` (`OLAYLAR` listesine eklenir).

## 16. Numaralar

| Tür | Numara |
|-----|--------|
| Zarf türleri | `0xC0 VAKA_UYANDIR`, `0xC1 VAKA_DUR`. `0xC2–0xC7` bu RFC'nin sonraki sürümleri için ayrılmış. |
| Çekirdek komutları | 260–269 (§15) |
| Defter olayı | Yok |
| HELLO yetenek biti | Yok. Eski istemci bilinmeyen zarfı yok sayar. |
| Türetme etiketleri | `hf/olay-tur/`, `hf/olay-anahtar/`, `hf/ozne/`, `hf/vaka/`, `hf/vaka-cekirdek/`, `hf/vaka-uyandir/`, `hf/vaka-dur/` |
| Çekirdek alanlar | `_v`, `_t`, `_subj`, `_place`, `_scope`, `_key`, `_obs`, `_keep` (tek liste RFC-0015 §2) |
| Kayıt türleri | §6.1, §6.2 |

## 17. Test vektörleri

Sabit pencere ve kapatan olay vektörleri `protocol/vectors/event-v3.json`'dadır (RFC-0032 §8).

`protocol/vectors/event.json`:

1. Çekirdek alanlı bir olayın `OpInner` kodlaması; aynı olayın `REC_DROP` biçimi ve `recordId` türetimi.
2. `_key` ve `vaka` türetimi; `ozneOzeti` için iki farklı `_subj`.
3. **Gün:** `_t = 1792359000000` (18 Ekim 2026 21:30 UTC), `utc_dk = 180`, `gun_basi_dk = 0` → gün 20745 (19 Ekim, yerel 00:30). `_t = 1792357140000` (20:59 UTC) → gün 20744.
4. **Bant:** 14 günlük değerler `4, 5, 4, 6, 3, 5, 4, 4, 5, 6, 4, 3, 5, 4`, `k = 3`, `en_dar = 1` → `m = 4`, `mad = 1`, `w = 3`, bant `1–7`. Bugün 11 → `cok`. Bugün 7 → normal.
5. **Dar bant:** değerler `0, 1, 0, 0, 2, 0, 1` → `m = 0`, `mad = 0`, `w = 1`, bant `−1–1`. Bugün 2 → `cok`. `alt ≤ 0` olduğu için `az` üretilmez.
6. **Olgunluk:** 6 geçerli gün → olgun değil; gözlem kesintili 3 gün dışarıda kalır.
7. **Güven:** Pencerede tek bir 70'lik olay → vaka yok. İki farklı `_t`'li 70'lik olay → vaka. Bir 45'lik olay → sayılmaz. Bir 85'lik olay → vaka.
8. **Sıra bağımsızlığı:** Aynı `hf.vaka`, `hf.vaka.basamak`, `hf.vaka.sahip` kümesi üç farklı sırayla uygulanır → aynı durum, aynı sahip.
9. **Basamak geçerliliği:** `ilk = 2` iken `(3, 0)` kaydı var, `(2, 0)` yok → geçersiz. `(2, 0)` gelince geçerli olur.
10. **Bildirim:** Sahiplenme kaydından sonra gelen `(3, 0)` → geçerli basamak, bildirim yok. Aynı `(vaka, 3, 0)` için iki kayıt ve iki zarf → tek bildirim.
11. **Kural önceliği:** Örtüşen rutin vakası ve kural vakası → rutin bastırılmış. Susturma kuralı rutin vakasını bastırır, kural vakasını bastıramaz.
12. **Sorumlu listesi:** Karttaki sorumlulardan biri okuyucu değil → çıkarılır; listeye okuyucu ebeveynler eklenir.
13. **Tekil anahtar:** Aynı `_key`'li iki `hf.device.offline` → bir olay.
14. **Düzeltme:** `hf.olay.duzelt` hedef olayı sayımdan çıkarır; düzeltme silinince olay geri gelir.
15. **Saklama:** `_keep = 30`; `M`, `_t`'den 31 gün sonra → temizlenir; 29 gün sonra → kalır. `hf.saklama { tur: 'yuva.pet.', gun: 20 }` → etkin 20. Temizlenen `recordId` ile gelen yeni `put` → reddedilir.
16. **Zarflar:** `VAKA_UYANDIR` ve `VAKA_DUR` kodlama ve imza. Koleksiyonun yazarı olmayan cihazdan gelen `VAKA_UYANDIR` → atılır.
17. **Kural penceresi:** `pencere_dk = 720`, aynı 12 saatlik dilimde iki tetikleme → aynı `vaka`.
18. **Yazar denetimi:** Cihazın yazdığı `hf.vaka.sahip` → yok sayılır.

Her vektör telefonda (Bare) ve düğümde (Node 24) aynı sonucu vermek zorundadır.

## 18. Güvenlik değerlendirmesi

| Tehdit | Önlem |
|--------|-------|
| Kutu ya da Posta Kutusu olay türünü ya da vakayı görmek ister | Olay ve vaka kayıt işleminin şifreli metnindedir. Uyandırma zarfları emanet mührüyle kapalıdır. Kutu olay açmaz. |
| Ele geçirilmiş kamera sahte olay yazar | Yalnız kendi `olaylar` koleksiyonuna yeni olay ekler (RFC-0001 §10). Sahiplenme ve kapanış yazamaz. Ebeveyn cihazı çıkarınca kesim gelir. Kullanıcı "Bu olay yanlış" diyebilir. |
| Ele geçirilmiş cihaz uyandırma yağdırır | İmzalı; gönderen koleksiyonun yazarı olmalı; saatte 30 sınırı; aynı basamak bir kez. |
| Çocuk ebeveynlerin vakalarını görür | Vaka kayıtları olayın koleksiyonundadır; kitle yalnız okuyuculardır; kart notu okuyamayan cihazda çizilmez. |
| Sorumlu listesine okuyucu olmayan biri yazılır | Liste değerlendirilirken okuyucu olmayanlar çıkarılır. |
| Biri vakayı sessizce kapatır | Kapanış imzalı bir kayıttır, kartta kimin kapattığı görünür. Kapanışı yalnız yazar olan üye yapabilir. |
| Normal yavaş yavaş kaydırılır (rutin zehirlenmesi) | Kural her zaman önce gelir; ortanca uç değerlere dayanıklıdır; gerçek sorun günleri öğrenmeye girmez. |
| Saati ileri ya da geri kurulu cihaz | `_t ≤ hlc + 5 dk`; vaka anahtarı pencere başlangıcına bağlı; geç gelen olay vaka açmaz; `hlc` sınırları RFC-0001 §6'dadır. |
| Aynı uyarı defalarca çalar | §11.3: her telefon yalnız kendi kullanıcısına, basamak başına bir kez. |
| Olay sonsuza kadar birikir | `_keep`, `hf.saklama`, belirlenimci temizlik. |
| Dış hizmete kendiliğinden veri gider | 5. basamak yalnız öneridir; gönderim `SHARE_CONSENT` ve onay ister. |
| Özel nitelikli veri geniş koleksiyona yazılır | `ozel: true` türler yalnız Ebeveynler'de ya da `kisisel` türü koleksiyonda geçerlidir. |

**Bilinen sınırlar:**

- Sahiplenme ulaşmazsa planlanmış yerel bildirim yine çıkabilir.
- iPhone'larda rutin değerlendirmesi uygulamanın çalıştığı anlara bağlıdır. Hızlı uyarı gereken durumlar işçide kuralla yazılmalıdır.
- Yaz saatinde rutin günü bir saat kayabilir (§8.1).
- Saklama eşiği koleksiyona yeni veri gelmesine bağlıdır.

## 19. Kurucu belgede değişecekler

| Bölüm | Değişiklik |
|-------|------------|
| §4 Temel kavramlar | Çatı §4'teki **Rutin**, **Kural**, **Kart** satırları ve yeni **Vaka** satırı eklenir. |
| §7.7 Varsayılan koleksiyonlar | `Olaylar:<yer>` yazarları: ebeveyn + **yetişkin** + yalnız yazan cihazlar. Neden: okuyucu yetişkin "Ben bakıyorum" ve kapanış yazabilmeli. |
| §12 Olay zarfı | Olay ayrı bir zarf değil, kayıttır. Alan eşlemesi bu RFC §4.1'dedir. `confidence` yüzde tamsayı `_conf`'tur (0–100, RFC-0015). `sig`, kayıt işleminin imzasıdır. Ad kuralları §5, çekirdek kataloğu §6. |
| §12 tablo | `hf.` örneklerine `hf.kayit.kutu-dolu` eklenir; bu olayı kutu değil, kutunun durum mesajını alan telefon yazar. |
| §8.6 ve §12 son madde | "Rutin motoru telefonda ya da işçide" ifadesi ayrıntılanır: işçide yalnız kural, telefonda rutin ve merdiven. |
| §13.1 | Yeni satır: **T20** "Ele geçirilmiş cihaz uyandırma yağdırır" → §18. |
| §7.2 son madde | "Silinen kayıtlar … bir yıl sonra temizlenir" cümlesine ek: "Süreli kayıtlar (`_t` ve `_keep`) süreleri dolunca, koleksiyonun verisine bağlı eşikle temizlenir (RFC-0006 §14)." |
| §22 | Yeni karar satırları: olay = kayıt; vaka anahtarı belirlenimci; her telefon yalnız kendi kullanıcısına bildirir; işçide yalnız kural; süreli olay temizliği. |
| RFC-0001 §4.1 | Çekirdek alan listesine `_v`, `_t`, `_subj`, `_place`, `_scope`, `_key`, `_obs`, `_keep` eklenir; tek liste RFC-0015 §2'dedir, `_conf` yüzde tamsayıdır. |
| RFC-0001 §13 | Süreli kayıtların temizliği eklenir (§14.3): türü belirleyen işlem dahil bütün işlemler silinir, `recordId` mezar listesine girer. Süresiz kayıtlar için bugünkü kural aynen kalır. |
| RFC-0003 §6.4 | Emanet ve Posta Kutusu mührünün kapsamına `0xC0–0xC1` eklenir (`derive(pair, 'ctrl')`). |
| Çatı §8 | JSON örneği yerine kayıt biçimi; `x.` yerine `hf.` (kurucu §22.2'de zaten yazılı). |

## 20. Uygulama sırası

1. Tür tanımı, ad denetimi, çekirdek katalog dosyası; olay yazma ve geçerlilik; vektörler 1, 2, 13, 14.
2. Rutin hesabı (gün, pencere, ölçü, bant); vektörler 3–6.
3. Kural değerlendirmesi ve güven kuralı; vektörler 7, 11, 17.
4. Vaka kayıtları ve durum işlevi; vektörler 8, 9, 18.
5. Merdiven, sorumlu listesi, tekil bildirim, planlanmış yerel bildirim; vektörler 10, 12.
6. `VAKA_UYANDIR` ve `VAKA_DUR`, mühür kapsamı; vektör 16.
7. Kart ve sohbet içinde kart notu çizimi.
8. Süreli kayıt temizliği; vektör 15. RFC-0001 §13 eklemesiyle birlikte.
9. Çekirdek olaylarının üreticileri: `hf.device.*` (Ev Makinesi, Faz 1), `hf.backup.*` ve `hf.kasa.*` (Faz 3), `hf.sos` (Acil RFC'siyle).
10. İşçi motoru: sürekli görevle birlikte (Faz 3, `hf.task.vision`).
11. SDK ve komutlar 260–269 (Faz 2, taşıma aşaması B).
