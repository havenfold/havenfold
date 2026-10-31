# RFC-0012 — Afet modu: internet ve elektrik yokken aile içi kısa iletişim

> Durum: **Onaylandı** (Kerem, 23 Ekim 2026) · 23 Ekim 2026 · Yazan: Havenfold çekirdek ekibi · Onay: Kerem
> Kurucu belge: §3 (ilke 4, 7, 8; H3, H7), §11 (afet satırı ve maddesi), §12 (`hf.sos`, olayı kim açar), §13, §15.3 (Acil ve Deprem, Yuva Kutusu), §16.2, §21.
> Bağımlılık: Protokol v2 §5 (çift sırrı), §6–§7 (Noise IK + HELLO), §8 (zarf, K12 mührü); RFC-0003 (cihaz ve misafir çift sırrı, oturum rolleri). Ürün: EserX `yuva/docs/09` §11–§12, `19` (Acil ve Deprem).
> Kod yeri: `havenfold/core/afet` (`@havenfold/disaster`: durumlar, mesajlar, sakla-ilet, yerel ağ keşfi), `havenfold/node/afet` (BlueZ, güç kaynağı okuma). Telefonda Bluetooth ve Wi-Fi köprüleri ürün uygulamasının yerel modülündedir (yalnız Yuva Acil'de, `native-modules/yuva-afet`; RFC-0029 §4).

## 1. Sorun

Büyük bir depremden sonra elektrik, mobil şebeke ve ev interneti saatlerce, bazen günlerce gider. Aile üyeleri birbirine "iyiyim" diyemez. Bugünkü bütün yollar (doğrudan bağlantı, kutu, Posta Kutusu) internet ister.

Kurucu belge §11 sınırı çizdi: çekirdek yalnız kısa metin zarfının yerel bağlantılardan da taşınabilmesini garanti eder; ürün mantığı Yuva Acil ve Deprem'indir. Bu RFC o çekirdek garantiyi tanımlar.

## 2. Öneri özeti

- **Ne zaman:** Elle; ya da son saatlerde aileden SOS veya deprem uyarısı geldiyse ve internet yoksa; ya da internet uzun süre yoksa hafif bir "hazır" kipinde.
- **Hangi bağlarla:** Bluetooth LE (her platform), Android'ler arasında Wi-Fi Direct, iPhone'lar arasında Multipeer, ve internetsiz kalmış ev Wi-Fi'si.
- **Ne taşır:** ≤ 256 baytlık metin, "İyiyim", SOS, cihaz uyarısı ve teslim onayı. İsteğe bağlı, yalnız gönderenin eklediği konum özeti.
- **Nasıl:** Yalnız aile cihazları arasında, sakla ve ilet. Her mesaj gönderen ile alıcının **var olan çift sırrından** türeyen anahtarla mühürlüdür. Bağın kendisi bugünkü Noise IK + HELLO'dur. Yeni kripto yok.
- **Sınırlar:** Taşkın ve pil kuralları sabittir. Arama, ses, fotoğraf, dosya, defter değişikliği yoktur. LoRa ve telsiz v1'de yoktur.
- Yeni defter olayı yok.

## 3. Çekirdek ne yapar, ürün ne yapar

| Çekirdek (bu RFC) | Yuva Acil ve Deprem (ürün) |
|--------------------|-----------------------------|
| Durum makinesi ve tetikleyiciler | "Afet modu" ekranı, büyük düğmeler |
| Yerel bağlar, keşif, oturum | SOS akışı, aile acil planı, buluşma noktası |
| Mesaj biçimi, şifreleme, sakla-ilet | "Durumunu bildir" kartı, evdekiler kartı |
| Taşkın ve pil kuralları | Deprem eşiği ve sensör yorumu |
| Normal yol dönünce yeniden gönderim | Resmî kurumlara yönlendirme metinleri |

Ürün, çekirdeğe yalnız §13'teki komutlarla dokunur. Çekirdek ürünün metinlerini ve eşiklerini bilmez.

## 4. Tanımlar

| Ad | Anlam |
|----|-------|
| **Aile cihazı** | Bu cihazla çift sırrı olan aktif kimlik: telefon üyeleri (çocuk dahil), kutu, bağlı cihazlar. Misafir §8.1'deki sınırlarla. |
| **Yerel bağ** | İnternetsiz iki cihaz arasındaki kısa menzilli bağlantı (§6). |
| **Taşıyıcı** | Başkasının mühürlü mesajını saklayıp yakına gelen aile cihazına veren cihaz. |
| `afetKey` | `derive(pair, 'hf/afet/')`. Çiftin afet alt anahtarı. |
| **Gün** | `epochDay = floor(unixMs / 86400000)`, UTC. |
| **Dilim** | `slot = floor(unixMs / 900000)`, 15 dakika. |
| **İnternet yok** | Son başarılı DHT teması **ve** son başarılı Posta Kutusu isteği eşikten eski; ya da işletim sistemi bağlantı yok diyor. Tam sunucusuz modda yalnız DHT teması bakılır. |

Kodlama kuralları RFC-0001 §3'tekiyle aynıdır.

## 5. Durumlar ve etkinleşme

### 5.1 Durumlar

| Durum | Davranış |
|-------|----------|
| **KAPALI** | Hiçbir yerel yayın ve tarama yok. Varsayılan. |
| **HAZIR** | Düşük görev oranı: Bluetooth reklamı açık, tarama seyrek, yerel ağ duyurusu seyrek. Gelen afet mesajları alınır ve taşınır. |
| **ETKİN** | Tam görev oranı: sürekli reklam, sık tarama, eşleşen aile cihazına bağlanıp eşitleme, yerel ağ duyurusu sık. |

Görev oranları §9'dadır.

### 5.2 Geçişler

| Geçiş | Koşul |
|-------|-------|
| KAPALI → HAZIR | İnternet **30 dakika** yok (varsayılan; ayarda 10–120 dk). Ya da bir aile cihazından yerel bağla afet mesajı geldi. |
| herhangi → ETKİN | (1) Kullanıcı "Afet modunu aç" dedi. (2) Son **6 saatte** aileden doğrulanmış bir deprem `UYARI`'sı ya da `SOS` alındı veya bu cihaz `SOS` gönderdi, **ve** internet 2 dakikadır yok. (3) HAZIR'dayken kullanıcı bir afet mesajı yazdı. (4) Düğümde: prizden güç kesildi ve pille çalışıyor, ya da deprem sensörü tetiklendi (§10). |
| ETKİN → HAZIR | 72 saat doldu. Elle açıldıysa önce "Afet modu sürsün mü?" sorulur; cevap yoksa HAZIR'a iner. |
| HAZIR ya da ETKİN → KAPALI | İnternet 10 dakika kesintisiz döndü **ve** gönderilmeyi bekleyen afet mesajı kalmadı. Ya da kullanıcı kapattı. |

- **Gerekçe:** Yalnız "internet yok" yaygın ve zararsızdır (asansör, metro, köy). Bu durumda tam görev oranı pili boşa harcar. Bu yüzden internetsizlik tek başına yalnız HAZIR'a götürür. ETKİN, bir afet işareti ya da kullanıcının isteği ister.
- Yetişkin ve çocuk aynı kurallara tabidir. Ebeveyn bir başkasının cihazında afet modunu uzaktan açamaz ve kapatamaz; her cihaz kendi kuralıyla karar verir.
- Durum paylaşılan bir durum değildir; her cihazın kendi yerel davranışıdır.

## 6. Yerel bağlar

### 6.1 Özet

| Bağ | Platformlar | Ne zaman | Ne taşır |
|-----|-------------|----------|----------|
| **Bluetooth LE** (GATT; varsa L2CAP CoC) | iPhone, Android, Linux düğüm | HAZIR ve ETKİN'de her zaman. Keşif her zaman bununla. | Yalnız afet zarfları |
| **Wi-Fi Direct** | Android ↔ Android | Bluetooth oturumunda iki yönde bekleyen veri 16 KB'ı ya da 20 mesajı aşınca | Yalnız afet zarfları |
| **Multipeer** | iPhone ↔ iPhone, yalnız ön planda | Aynı koşul | Yalnız afet zarfları |
| **Yerel ağ** (internetsiz Wi-Fi) | Hepsi | HAZIR ve ETKİN'de | Tam oturum: bütün zarf türleri |

- **Nearby Connections kullanılmaz.** Google Play hizmetlerine bağlıdır; bu hizmetler olmayan Android cihazlarda çalışmaz ve kapalı bir bileşendir. Wi-Fi Direct, Android'in kendi çerçeve arayüzüyle kullanılır.
- **Yerel ağ yolu** aslında afet zarfı taşımaz; çekirdeğin olağan doğrudan bağlantısını DHT olmadan kurar. Ev yönlendiricisi ve kutu bir güç kaynağına bağlıysa ve yalnız internet gittiyse evdekiler mesajlaşmaya, hatta aramaya devam eder. Bu yol afet modunun bir parçası olarak HAZIR ve ETKİN'de açılır.
- Apple'ın Wi-Fi Aware desteği sahada denenmeden kullanılmaz. v1'de iPhone ↔ Android arasındaki tek bağ Bluetooth LE'dir.

### 6.2 Keşif

**Reklam:** Cihaz yalnız Havenfold afet hizmet kimliğini yayınlar (§13). Ad, hizmet verisi ya da cihaz kimliği yoktur.

**Etiket listesi:** Bağlanan taraf, reklam yapanın `TAGS` niteliğini okur:

```
AFET_TAGS (0xB4) {
  v    : uint                 // 1
  slot : uint
  tags : array<fixed4>        // tam 25 öğe
}
tag(çift) = derive(afetKey, 'hf/afet-near/', reklamYapanId, u64be(slot))[0..4]
```

- Reklam yapan, çift kurduğu her aile cihazı için bir etiket koyar. Liste rastgele baytlarla **25 öğeye tamamlanır** ve her dilimde karıştırılır. Böylece ailenin büyüklüğü görünmez.
- Tarayan, kendi her çifti için `tag(çift, reklamYapanId = karşıId, slot)` hesaplar; bu ve önceki dilimde arar. Eşleşen yoksa bağlantıyı kapatır ve o Bluetooth adresini 15 dakika yok sayar.
- Etiketler her 15 dakikada değişir. Telefonların Bluetooth adresi de yaklaşık bu sıklıkta değişir. Yabancı biri iki dilimdeki listeleri birbirine bağlayamaz.

### 6.3 Bağ oturumu

Eşleşmeden sonra bağ bir bayt akışı olarak kullanılır ve üstünde bugünkü oturum kurulur:

1. **Noise IK** (`@hyperswarm/secret-stream`). Başlatan bağlanan taraftır. Anahtar çiftleri:

   ```
   afetSeed(id) = derive(pair, 'hf/afet-noise/', id, u64be(gün))
   anahtar çifti = crypto_sign_seed_keypair(afetSeed(id))
   ```

   Başlatan önce bugünü, olmazsa dünü dener. Bu, buluşma anahtarlarının (protokol §6) aynı düzenidir.
2. **HELLO** (protokol §7.2), kanal bağlamalı. `caps` içinde `AFET` biti bulunur. Alıcı kimliği kendi defter kopyasıyla doğrular.
3. **İzinli türler:** Bluetooth, Wi-Fi Direct ve Multipeer bağlarında yalnız `HELLO`, `HELLO_OK`, `PING`, `PONG` ve `0xB0–0xB5`. Başka bir tür gelirse oturum kapanır (`DISASTER_TYPE_FORBIDDEN`). **Defter eşitlemesi, kayıt işlemi, görev ve mesaj ratchet'i bu bağlarda yoktur.** Yerel ağ yolunda bu sınır yoktur.
4. HELLO'daki defter uzunluğu farklı olsa da eşitleme yapılmaz. Karar her cihazın kendi defter kopyasına göre verilir.

### 6.4 Bluetooth ayrıntısı

| Öğe | Değer |
|-----|-------|
| Hizmet | `9f6d0001-2c4b-4e7a-8b15-3d0c6a2e71f4` |
| `TAGS` (okuma) | `9f6d0002-2c4b-4e7a-8b15-3d0c6a2e71f4` |
| `IN` (yanıtsız yazma) | `9f6d0003-2c4b-4e7a-8b15-3d0c6a2e71f4` |
| `OUT` (bildirim) | `9f6d0004-2c4b-4e7a-8b15-3d0c6a2e71f4` |
| `PSM` (okuma) | `9f6d0005-2c4b-4e7a-8b15-3d0c6a2e71f4`; L2CAP CoC kanal numarası, yoksa 0 |
| Akış | L2CAP CoC iki tarafta da varsa o; yoksa `IN` ve `OUT` sıralı bayt akışı olarak. Gönderen, işletim sisteminin "yazmaya hazır" geri bildirimini bekler; böylece akış kayıpsız ve sıralıdır. |
| MTU | En az 185 istenir |
| Bağlantı | Aynı anda en çok 3. İş bitince (§8.2) bağlantı kapanır. |

Linux düğümde BlueZ kullanılır (birim izni RFC-0007 §4.3). Yuva Kutusu gibi birleşik cihazda Bluetooth'u **kutu süreci** kullanır; işçi süreci afet mesajlarını kutuya, iki kimlik arasındaki olağan yerel oturumdan (cihaz ↔ kutu) bırakır. Bu, kurucu belge H4'e uyar: taşıma ve üst bilgi (`toTag`, öncelik, boyut, kiminle bağ kurulduğu) kutu kimliğinde kalır; işçi kimliği yalnız kendi gönderdiği mesajın içeriğini bilir ve kutunun bağ geçmişini görmez.

### 6.5 Wi-Fi Direct ve Multipeer

```
AFET_LINK_UP (0xB5) {
  kind : uint          // 0 Wi-Fi Direct, 1 Multipeer
  name : string        // Wi-Fi Direct grup adı ya da Multipeer hizmet adı
  pass : string        // Wi-Fi Direct grup parolası; Multipeer'de boş
  port : uint          // TCP portu (Wi-Fi Direct)
}
```

- Bluetooth oturumu içinde gönderilir; yani şifreli ve kimliği doğrulanmıştır.
- *Uygulama notu (açılış öncesi inceleme, 25 Ekim 2026):* Alanlar denetlenir: `kind 0` grup adı 1–32 bayt, parola 8–63 bayt, port 1–65535; `kind 1` hizmet adı `hf-afet`, parola boş, port 0. Geçersiz teklif oturumu bitirir (`INVALID_DISASTER_LINK`) ve platforma verilmez; başlatan taraf bir oturumda yalnız ilk geçerli teklifi platforma verir (`core/disaster/message.js` `linkHatasi`, `core/disaster/local.js` `afetEsitle`).
- Grup sahibi Bluetooth oturumunu başlatmayan taraftır. Yeni bağda §6.3 baştan kurulur.
- Multipeer'de hizmet adı `hf-afet`, eş adı her açılışta rastgeledir; keşif bilgisi boştur.
- Aktarım bitince Wi-Fi bağı kapatılır.

### 6.6 Yerel ağ

- **Duyuru:** UDP çok noktaya yayın `239.255.72.70:47870`. Yük: `AFET_TAGS` + `u16` TCP portu. ETKİN'de 30 sn, HAZIR'da 120 sn arayla.
- **Bağlanma:** Etiketi eşleşen cihaz TCP ile bağlanır, §6.3'teki Noise ve HELLO'yu kurar. Bundan sonra oturum olağan bir doğrudan oturumdur: mesajlar ratchet'le gider, defter eşitlenir, arama yapılabilir.
- Yalnız IPv4, yalnız aynı alt ağ. Yönlendiricinin istemci yalıtımı açıksa bu yol çalışmaz; arayüz Bluetooth'a güvenir.

### 6.7 Platform sınırları (dürüst not)

| Durum | Ne olur |
|-------|---------|
| iPhone ön planda | Reklam ve tarama tam çalışır. Multipeer kullanılabilir. |
| iPhone arka planda | iOS reklamdaki hizmet kimliğini "taşma alanına" koyar. Bunu yalnız bu kimliği açıkça tarayan başka bir iPhone görür; **Android göremez.** Arka plandaki iPhone, reklam yapan Android'i tarayarak bulur ve bağlantıyı kendisi kurar. İki arka plan iPhone'u birbirini bulabilir ama bu dakikalar sürebilir. Her Bluetooth olayında uygulamaya birkaç saniye verilir; eşitleme kısa tutulur (§8.2). |
| iPhone'da uygulama kullanıcı tarafından kapatıldı | iOS Bluetooth için uygulamayı yeniden başlatmaz. Afet modu o telefonda durur. Ürün, afet modunu açarken "Uygulamayı kapatmayın" der. |
| iPhone | Wi-Fi Direct yoktur. Multipeer yalnız ön planda ve yalnız iPhone'lar arasında çalışır. |
| Android | Afet modu HAZIR ya da ETKİN'ken "Afet modu açık" kalıcı bildirimiyle ön plan hizmeti çalışır. Üretici pil yönetimi hizmeti öldürebilir (06 §4.5); kurulum yönlendirmesi aynen geçerlidir. |
| Linux düğüm | Bluetooth donanımı yoksa yalnız yerel ağ yolu çalışır. |

**Mağaza (kurucu §16.2):**

- iOS'ta `bluetooth-central` ve `bluetooth-peripheral` arka plan kipleri ve Bluetooth kullanım açıklaması eklenir. İnceleme notunda gerekçe: "İnternet ve şebeke yokken aile içi kısa mesaj."
- Android'de `BLUETOOTH_SCAN` (`neverForLocation`), `BLUETOOTH_ADVERTISE`, `BLUETOOTH_CONNECT`, `NEARBY_WIFI_DEVICES` (`neverForLocation`) ve `connectedDevice` türlü ön plan hizmeti gerekir. `BLUETOOTH_CONNECT` 06 §4.1'de inceleme sırasında çıkarılmıştı; geri eklenirken Play beyanı aynı gerekçeyle yapılır.
- İki mağazanın metinleri platforma özgü kuralla ayrı yazılır.

## 7. Mesajlar

### 7.1 Türler

| `kind` | Ad | Kim gönderir | Metin | Konum |
|--------|----|--------------|-------|-------|
| 1 | `METIN` | Üye, misafir | ≤ 256 B UTF-8, zorunlu | İsteğe bağlı |
| 2 | `IYIYIM` | Üye, misafir | ≤ 64 B, isteğe bağlı | İsteğe bağlı; varsayılan kapalı |
| 3 | `SOS` | Üye, misafir | ≤ 64 B, isteğe bağlı | Varsayılan açık; gönderen ekranda görür ve kapatabilir |
| 4 | `UYARI` | Yalnız bağlı cihaz (işçi, uç) | ≤ 64 B | Yok |
| 5 | `ALINDI` | Alıcı, kendiliğinden | Yok | Yok |

- Birden çok kişiye giden mesaj (ör. "İyiyim" herkese) her alıcı için ayrı mühürlenir. Aynı içerik, farklı `mid`'ler.
- `ALINDI`, `METIN`, `IYIYIM` ve `SOS` için kendiliğinden gönderilir; `UYARI` ve `ALINDI` için gönderilmez.
- **Kurucu §12 ile uyum:** Kutu kimliği olay açmaz. `UYARI` yalnız bağlı cihaz kimliğinden çıkar. Yuva Kutusu'nda deprem sensörünü işçi kimliği okur.

### 7.2 `AFET_MSG` (0xB0)

```
AFET_MSG {
  mid        : fixed16           // rastgele
  toTag      : fixed8
  prio       : uint              // 0 SOS, 1 UYARI, 2 IYIYIM, 3 METIN, 4 ALINDI
  hops       : uint              // kalan yayma hakkı, başta 4
  expiresDay : uint              // en çok gönderildiği gün + 3
  doneHash   : fixed16
  nonce      : fixed24           // rastgele
  ct         : buffer            // ≤ 420 B
}

toTag      = derive(afetKey, 'hf/afet-to/', aliciId, u64be(gün))[0..8]
doneSecret = derive(afetKey, 'hf/afet-done/', mid)
doneHash   = hash('hf/afet-done-hash/', doneSecret)[0..16]
AD         = hash('hf/afet-ad/', mid, toTag, u64be(prio), u64be(expiresDay), doneHash)
ct         = XChaCha20-Poly1305(afetKey, nonce, encode(AfetInner), AD)

AfetInner {
  kind     : uint
  from     : fixed16
  to       : fixed16
  at       : uint                // gönderenin saati, ms; yalnız gösterim
  text     : string
  konum?   : { latE5: int, lonE5: int, accM: uint, at: uint }
  ref?     : fixed16             // ALINDI: onaylanan mid
  alarm?   : { kind: string ('deprem' | 'elektrik'), level: uint, nearby: array<fixed16> }   // yalnız UYARI
  battery? : uint                // gönderenin pil yüzdesi
}
```

- `hops` AD'ye girmez, çünkü taşıyıcılar azaltır. Diğer açık alanlar AD'dedir; taşıyıcı onları değiştirirse mesaj açılmaz.
- `toTag` gönderen ile alıcının çiftine ve güne bağlıdır. Taşıyıcı alıcının kim olduğunu bilmez.
- `doneHash` alıcının teslimi kanıtlamasını sağlar (§8.2). `doneSecret`'ı yalnız çiftin iki tarafı hesaplayabilir.
- **Neden ratchet değil:** Sakla-ilet yolunda mesajlar kopyalanır, gecikir, sırasız ve eksik gelir. Double Ratchet'in durumu bu koşullarda bozulur. Afet mesajı, emanet yolundaki denetim zarflarıyla (K12) aynı düzende çift alt anahtarıyla mühürlenir. Bedeli: ileri gizlilik yoktur. Çift sırrını sonradan ele geçiren biri, kaydedilmiş afet mesajlarını açabilir. Mesajlar kısa ve süreli olduğu için bu kabul edilmiştir.

### 7.3 Konum özeti

- Konum yalnız gönderen o mesaja açıkça eklerse gider. Kimse başkasının konumunu **isteyemez**; böyle bir mesaj türü yoktur (ilke 7).
- `latE5`, `lonE5`: derece × 10⁵, tamsayı. Yuvarlama:
  - `SOS`: yuvarlanmaz (~1 m).
  - `IYIYIM` ve `METIN`: 1000'in katına yuvarlanır (0,01°, ~1 km; açıklama 1). Gönderen "tam konum" seçerse yuvarlanmaz.
- `accM`: cihazın bildirdiği doğruluk, metre. `at`: konumun alındığı an.
- Konum, cihazın kendi konum servisinden gelir (GPS internetsiz çalışır). Çekirdek konum izni istemez; ürün ister.

> **Açıklama 1 (25 Ekim 2026, inceleme 21):**
> 1. **§9.1 sınırları olay başınadır.** Çok alıcılı bir mesaj (§7.1, her alıcıya ayrı mühür) tek olaydır: bir `SOS` bütün aile cihazlarına aynı anda gider ve dakikada 1 sınırına bir kez sayılır. `METIN` ve `UYARI` için de aynı; `IYIYIM` alıcı başına kalır. Vektör 11 buna göre.
> 2. **§6.3 karşılayanın çifti seçmesi:** Bağlanan, Noise IK'den önce düz metin olarak keşifte eşleşen günlük etiketi (§6.2) gönderir; karşılayan anahtarını bu etiketin çiftinden türetir. Etiket zaten duyuruda yayınlandığı için yeni bilgi açığa çıkmaz. Etiketi tanımayan karşılayan bağlantıyı kapatır.
> 3. **§7.3 yuvarlama:** `latE5`/`lonE5` 1000'in katına (0,01°, ~1,1 km). Önceki metindeki "100'ün katı" (~111 m) "~1 km" vaadiyle çelişiyordu; vaat esas (ilke 7; Yuva Acil YA9). Vektör 10 buna göre.
> 4. **§7.4 alıcı penceresi:** Alıcı `toTag`'i [bugün − 3, bugün + 1] günleri için dener; `expiresDay = gün + 3` ile uyumlu.

> **Açıklama 2 (25 Ekim 2026, inceleme 22):**
> 1. **Etiket listesi dilim başına bir kez** üretilir ve dilim boyunca aynı kalır (dolgu ve karıştırma dahil); aynı dilimde iki okuma aynı listeyi görür (§6.2 "büyüklüğü görünmez"). Bluetooth TAGS ve yerel ağ duyurusu aynı listeyi kullanır.
> 2. **KAPALI'da** Bluetooth yayını, tarama ve GATT hizmeti yoktur; düğüm de §5.1'e uyar.
> 3. **§9.3 pil kuralları yalnız pille çalışırken** (`onAC = false`) uygulanır; prizdeki cihaz taşıyıcı sınırı için pil yüzdesi bildirmez. Güç değişince tarama planı yenilenir.
> 4. **Çevre rolünde yabancı:** etiket doğrulanamayan adres o dilim boyunca yok sayılır; çevre rolü meşgulken gelen ikinci merkezin bağlantısı kapatılır (ATT'de cevapsız yazma meşgul bildiremez).
> 5. **Kapanış:** bağ, GATT yazma kuyruğu boşalmadan kopartılmaz (son parçalar, DONE, ALINDI).
> 6. **Düğüm Bluetooth adresi** çözülebilir özel adres kullanır (BlueZ `Privacy = device`); sabit genel adres dilimler arası izlemeyi açar.

> **Açıklama 3 (25 Ekim 2026, inceleme 24):** `UYARI` için §9.1 sınırı türe göre sayılır (deprem ve elektrik ayrı); deprem uyarısı önceliklidir, elektrik uyarısının sınırını beklemez. Sınıra ya da geçici hataya takılan uyarı, sınır kalkınca bir kez yeniden denenir. Yakındaki cihazlar listesi aktif aile üyeleriyle süzülür ve üst sınırlıdır (ct ≤ 420 B).

### 7.4 Alıcının denetimi

Alıcı, kendi her çifti için `toTag`'i bugün, dün ve yarın için hesaplar (en çok 26 × 3 değer). Eşleşen `toTag` için:

| # | Denetim | Sağlanmazsa |
|---|---------|-------------|
| 1 | `ct` o çiftin `afetKey`'iyle açılıyor | Atılır |
| 2 | `from` çiftin karşı tarafı, `to` kendisi | Atılır |
| 3 | `from` alıcının defterinde bugün aktif | Atılır |
| 4 | `kind` gönderenin türüne uygun (§7.1); `UYARI` yalnız bağlı cihazdan, `alarm` yalnız `UYARI`'da | Atılır |
| 5 | `mid` son 7 günde görülmemiş | Atılır (tekrar) |
| 6 | `expiresDay ≥ bugün − 1` | Atılır |
| 7 | Metin ve konum alanları sınırlar içinde | Atılır |

Geçerli mesaj Hat katmanına yazılır; telefon kilitliyken de alınır, okumak için kilit açılır (06 §4.4).

## 8. Sakla ve ilet

### 8.1 Kim taşır

| Kim | Gönderir | Alır | Taşır |
|-----|----------|------|-------|
| Telefon üyesi (çocuk dahil) | ✓ | ✓ | ✓ |
| Kutu | — | — | ✓ |
| İşçi, uç (Bluetooth ya da yerel ağ varsa) | Yalnız `UYARI` | — (yalnız kendi `UYARI`'larının `AFET_DONE` teslim bilgisi) | ✓ |
| Misafir | ✓ (yalnız çifti olan üyelere) | ✓ (yalnız çifti olan üyelerden) | ✗ |
| Aile dışı her cihaz | ✗ | ✗ | ✗ |

- **Misafir:** Kendi mesajını bir taşıyıcıya bırakabilir. Taşıyıcılar misafire yalnız **kendi yazdıkları** mesajları verir, başkalarının mühürlü mesajlarını vermez. Misafir aileden değildir; ailenin trafiğinin biçimini görmemelidir. Bakıcı yine de "çocuklar yanımda, iyiyiz" diyebilir.
- Yabancı bir cihaz Noise el sıkışmasını geçemez (§6.3). Aile dışından hiçbir mesaj alınmaz ve hiçbir mesaj aile dışına verilmez.

### 8.2 Eşitleme

Bir bağ oturumu kurulunca iki taraf sırayla şunları yapar ve işi bitince bağlantıyı kapatır:

```
AFET_HAVE (0xB1) { items: array<{ mid: fixed16, toTag: fixed8, prio: uint, hops: uint }> }   // ≤ 64 öğe/mesaj
AFET_WANT (0xB2) { mids: array<fixed16> }
AFET_DONE (0xB3) { items: array<{ mid: fixed16, doneSecret: fixed32 }> }
```

1. Her taraf `AFET_DONE` ile bildiği teslimleri yollar. Alan, `hash('hf/afet-done-hash/', doneSecret)[0..16] = doneHash` tutan mesajı siler ve teslim bilgisini saklar (7 gün). Tutmayan öğe yok sayılır. Böylece yalnız gerçek alıcı bir mesajı ağdan sildirebilir.
2. Her taraf `AFET_HAVE` ile taşıdıklarını yollar.
3. Her taraf `AFET_WANT` ile ister:
   - `toTag`'i kendi etiketlerinden biriyse her zaman (**çekme serbesttir**);
   - taşıyıcıysa ve `hops > 0` ise, kendinde yoksa (**yayma atlama sayısına bağlıdır**).
4. İstenenler `AFET_MSG` olarak gider. Yayılan kopyada `hops` bir azalır.
5. Sıra her adımda önceliğe göredir: `SOS`, `UYARI`, `IYIYIM`, `METIN`, `ALINDI`.

Alıcı bir mesajı açınca hemen `ALINDI` mühürler ve aynı oturumda `AFET_DONE` gönderir.

### 8.3 Saklama ve atma

| Kural | Değer |
|-------|-------|
| Taşıyıcının deposu | En çok 1000 mesaj ve 512 KB |
| Süre | `expiresDay` geçince silinir |
| Atma sırası (depo dolunca) | Süresi geçen → teslim edilen → en eski `ALINDI` → en eski `METIN` → en eski `IYIYIM` → en eski `UYARI`. `SOS` ancak depo yalnız `SOS`'la doluysa, en eskiden. |
| Kendi giden mesajları | Taşıyıcı deposundan ayrıdır; teslim ya da süre dolana kadar silinmez |
| Kalıcılık | Hat katmanında; cihaz yeniden başlasa da kaybolmaz |

### 8.4 Normal yol dönünce

- Gönderen, internet ya da kutu yolu açılınca teslim edilmemiş kendi afet mesajlarını olağan oturumla ya da emanetle de gönderir. Zarf aynıdır (`AFET_MSG`, aynı `mid`); alıcı tekrarı atar.
- Emanet ve Posta Kutusu yolunda `AFET_MSG` zaten mühürlüdür; ek olarak RFC-0003 §6.4 mührüyle (`ctrl` anahtarı) kapatılır (§13).
- Taşıyıcı başkasının mesajını internete taşımaz. Alıcıyı tanımadığı için bunu yapamaz da; bu, tasarımın bilinçli sonucudur.

## 9. Taşkın ve pil kuralları

- Afet modunda gönderilen SOS'un `hf.sos` kaydı `afetMid` taşır; alıcı aynı `afetMid` için ikinci kez bildirim göstermez (RFC-0031 §6).

### 9.1 Gönderim sınırları (gönderen cihazda)

| Tür | Sınır |
|-----|-------|
| `METIN` | 15 sn'de 1, saatte 30 |
| `IYIYIM` | 5 dakikada 1 (alıcı başına) |
| `SOS` | Yeni `SOS` dakikada 1. Aynı `SOS` yeni karşılaşılan her aile cihazına yeniden verilir; ayrıca yayılmaz. |
| `UYARI` | Cihaz başına dakikada 1 |

### 9.2 Taşıyıcı sınırları

| Sınır | Değer |
|-------|-------|
| Bir komşudan kabul edilen yeni mesaj | 10 dakikada 100 |
| `AFET_MSG` boyu | ≤ 600 B; büyükse oturum kapanır |
| `hops` | Başta en çok 4 |
| `expiresDay` | En çok gönderim günü + 3 |
| Aynı komşuyla yeniden eşitleme | Yeni mesaj yoksa 5 dakikada bir |
| Yabancı Bluetooth adresi | Eşleşmezse 15 dakika yok sayılır; aynı anda en çok 3 bağlantı |

### 9.3 Görev oranları

| Durum ve pil | Reklam | Tarama | Yerel ağ duyurusu |
|--------------|--------|--------|--------------------|
| ETKİN, pil ≥ %30 | Sürekli | 60 sn'de 10 sn | 30 sn |
| ETKİN, %15–30 | Sürekli | 3 dk'da 5 sn | 60 sn |
| ETKİN, < %15 | Sürekli | Yok; yalnız gelen bağlantı | 120 sn |
| HAZIR | Sürekli, düşük güç | 5 dk'da 5 sn | 120 sn |
| Düğüm, prizde ya da pil ≥ %30 | Sürekli | Sürekli | 30 sn |
| Düğüm, pil < %30 | Telefonun ETKİN %15–30 satırı | | |

- iPhone'da gerçek oran işletim sistemine bağlıdır; çekirdek yalnız istekte bulunur.
- Pil %15'in altındayken taşıyıcı yalnız `SOS`, `UYARI` ve `IYIYIM` kabul eder.
- Ürün, afet modunda ekran parlaklığını düşürmeyi ve gereksiz uygulamaları kapatmayı önerir. Çekirdek bunu yapmaz.

## 10. Yuva Kutusu: güç kaynağı ve deprem sensörü

- **Güç:** Düğüm prizi ve dahili pili `/sys/class/power_supply` üzerinden okur. Prizden güç kesilince düğüm ETKİN'e geçer. Harici kesintisiz güç kaynağı (UPS) v1'de desteklenmez: yaygın araç (NUT) GPL lisanslıdır ve düğüm yazılımına giremez (kurucu §17.1).
- **Görevler:** Pille çalışan düğüm `NODE_CAPS.status = 'pil'` bildirir ve görev kabul etmez (RFC-0002 §4). Pil afet iletişimine kalır.
- **Çapa:** Kutu evin sabit taşıyıcısıdır. Prizdeyken ya da pili %30'un üstündeyken sürekli tarar ve sürekli reklam yapar. Eve yaklaşan her aile telefonu kutudaki mesajları alır.
- **Deprem sensörü:** Yuva Kutusu'nun ivmeölçerini **işçi kimliği** okur. Eşik ve yorum Yuva Acil ve Deprem'indir (09 §11). Eşik aşılınca işçi:
  1. Bütün olağan yollarla ürünün uyarısını gönderir;
  2. her aile üyesine `UYARI { alarm: { kind: 'deprem', level, nearby } }` mühürler ve kutuya bırakır;
  3. kutu ETKİN'e geçer ve yerel bağlarla dağıtır.
- **Prizden güç kesildi:** İşçi `UYARI { alarm: { kind: 'elektrik', level: 0, nearby } }` gönderir. Kısa kesintilerde gürültü olmasın diye 2 dakika bekler.
- **`nearby` (evdekiler):** `UYARI`'yı yazan işçi kimliğinin **kendisinin** son 10 dakikada yerel ağ ya da kendi Bluetooth'uyla doğrudan oturum kurduğu aile üyelerinin kimlikleri. Kutunun bağ geçmişi kullanılmaz: o, kutu kimliğinin gördüğü trafik üst bilgisidir ve kurucu belge H4 gereği işçi kimliğine geçmez. Birleşik cihazda Bluetooth'u kutu kullandığı için `nearby` yalnız yerel ağ oturumlarını içerir; ürün ekranı bunu "evdeki Wi-Fi'de görülenler" diye yazar. Yalnız mühürlü `UYARI`'nın içinde, yalnız aileye gider. Konum değil, "cihazın yakınında görüldü" bilgisidir (09 §11–§12 ile aynı ilke).
- **Yönlendirici:** Ürün, ev yönlendiricisinin de aynı güç kaynağına bağlanmasını önerir. Böylece §6.6'daki yerel ağ yolu evin içinde tam iletişimi sürdürür.
- **Eski Android kutu:** Bluetooth taşıyıcısı olur, kendi pil profiliyle. İvmeölçeri deprem için kullanılmaz (09 §11).

## 11. Desteklenmeyenler

| Ne | Neden |
|----|-------|
| Sesli ve görüntülü arama, bas-konuş | Bluetooth bant genişliği ve pil. Yerel ağ yolunda olağan oturumla çalışır; afet bağlarında yoktur. |
| Fotoğraf, ses kaydı, dosya | Boyut. Taşıyıcı deposunu doldurur. |
| Grup sohbeti, okundu bilgisi, düzenleme, silme | Kısa mesajın dışında |
| Defter değişikliği, üye ekleme ve çıkarma, kayıt işlemi, görev | Afet bağlarında yasak (§6.3). Kimlik değişikliği yüz yüze tören ve tam defter ister. |
| Aile dışına mesaj, yabancı cihazlarla ağ | Kurucu §11 ve güvenlik modeli |
| Taşıyıcının mesajı internete taşıması | Taşıyıcı alıcıyı bilmez (§8.4) |
| Resmî kurumlara bildirim | Afet modu bir acil durum hizmeti değildir. 112'nin ve işletim sisteminin kendi acil özelliklerinin yerini tutmaz. Ürün metinleri bunu açıkça yazar. |
| LoRa, Meshtastic, telsiz | §12 |

## 12. Mevzuat notu

- Bluetooth LE ve Wi-Fi, telefonların ve düğümlerin zaten onaylı telsiz donanımıyla, 2,4 ve 5 GHz lisanssız bantlarda çalışır. Ek izin gerekmez.
- **LoRa ve Meshtastic v1'de yoktur.** 868 MHz kısa mesafe cihazları Türkiye'de BTK'nın kısa mesafe erişimli telsiz düzenlemesine, AB'de RED'e tabidir: görev oranı ve güç sınırları vardır. Eser'in satacağı bir LoRa aksesuarı CE/RED ve BTK uygunluğu ister (kurucu §16.1). Bu iş "Haneler arası federasyon, Meshtastic" satırıyla Yuva S4 sonrasına kalır (kurucu §21) ve hukuki incelemeyle ayrı bir RFC'de gelir.
- **Amatör ve PMR446 telsiz bantları** hiçbir zaman kullanılmaz: biri lisans ister, öteki veri için ayrılmamıştır.
- Bu madde genel bilgidir; lansmandan önce avukat görüşü alınır.

## 13. Numaralar

| Tür | Numara |
|-----|--------|
| Defter olayı | **Kullanılmaz.** 33 bu RFC'ye ayrılmıştı; afet modu paylaşılan bir aile ayarı gerektirmediği için boş kalır. |
| Zarf türleri | `0xB0 AFET_MSG`, `0xB1 AFET_HAVE`, `0xB2 AFET_WANT`, `0xB3 AFET_DONE`, `0xB4 AFET_TAGS`, `0xB5 AFET_LINK_UP`. `0xB6–0xB7` bu RFC'ye ayrılı ve boş. |
| HELLO yetenek biti | `AFET = 512`: bu RFC'nin bağlarını ve zarflarını bilir |
| Çekirdek komutları | `310 DISASTER_STATE`, `311 DISASTER_SET` (elle aç ve kapat), `312 DISASTER_SEND`, `313 DISASTER_INBOX`, `314 DISASTER_NEARBY`, `315 DISASTER_SETTINGS` (eşik, varsayılan konum), `316 DISASTER_SIGNAL` (yerel modülden: güç, pil, sensör, bağlantı durumu), `317 DISASTER_LINK` (yerel modül ↔ çekirdek bağ çerçeveleri: aç, veri, kapat), `318 DISASTER_TAGS_GET`, `319 DISASTER_CLEAR` (taşıyıcı deposunu boşalt) |
| Türetme etiketleri | `hf/afet/`, `hf/afet-near/`, `hf/afet-noise/`, `hf/afet-to/`, `hf/afet-done/`, `hf/afet-done-hash/`, `hf/afet-ad/` |
| Bluetooth | Hizmet ve nitelik kimlikleri §6.4'te |
| Yerel ağ | `239.255.72.70:47870` UDP |
| Emanet mührü | RFC-0003 §6.4'teki K12 mühür kuralı `0xB0–0xB7` aralığının tamamını kapsar: bu aralıktaki bir zarf emanet ya da Posta Kutusu yolundan geçecekse aynı mühürle (`derive(pair, 'ctrl')`, AD = gönderen ‖ alıcı ‖ tür ‖ zarf id) kapatılır; `CTRL_TYPES` bunları kapsar. Bu yollardan yalnız `AFET_MSG` geçer (§8.4). `0xB1–0xB5` bu yollarda hiç taşınmaz; gelirse atılır. Afet bağlarında (Bluetooth, Wi-Fi Direct, Multipeer) zarflar Noise oturumunun içindedir; ek mühür gerekmez. |

Koda yazılınca `KARARLAR.md`'ye işlenir.

## 14. Test vektörleri

`protocol/vectors/disaster.json`:

1. Sabit `pair` ile `afetKey`; sabit kimlik, gün ve dilimle `tag`, `toTag`, `afetSeed`, `doneSecret`, `doneHash`.
2. Sabit nonce ile `AFET_MSG` kodlama, AD ve `ct`; `prio` değiştirilmiş kopya → açılmaz; `hops` değiştirilmiş kopya → açılır.
3. `AFET_TAGS`: 3 çiftli cihaz → 25 öğe; tarayan doğru eşi bulur; bir önceki dilimin etiketi de eşleşir; iki dilim önceki eşleşmez.
4. Alıcı denetimi: telefondan gelen `UYARI` → atılır; misafirden `SOS` → geçerli; aileden çıkarılmış göndericinin eski mesajı → atılır; tekrar `mid` → atılır.
5. Sahte `AFET_DONE` (yanlış `doneSecret`) → mesaj silinmez; doğru `doneSecret` → silinir.
6. Eşitleme: `hops = 0` mesaj taşıyıcıya yayılmaz ama alıcı çekebilir.
7. Atma sırası: dolu depoya `SOS` gelir → en eski `METIN` atılır.
8. Durum makinesi, tablo güdümlü: internet 31 dk yok → HAZIR; deprem `UYARI` + 2 dk internet yok → ETKİN; 72 saat → HAZIR; internet 10 dk döndü, bekleyen yok → KAPALI; internet döndü ama bekleyen mesaj var → durum korunur.
9. Bluetooth oturumunda `LEDGER_REQ` → `DISASTER_TYPE_FORBIDDEN`, oturum kapanır; yerel ağ oturumunda aynı zarf → geçerli.
10. Konum yuvarlama: `IYIYIM` için `latE5 = 4101234` → `4101200`; `SOS` için değişmez.
11. Gönderim sınırları: 15 sn içinde ikinci `METIN` → reddedilir.

Her vektör telefonda (Bare) ve düğümde (Node 24) aynı sonucu verir. Bluetooth katmanı ayrıca sahada sınanır (§17).

## 15. Güvenlik değerlendirmesi

| Tehdit | Önlem |
|--------|-------|
| Yabancı biri Bluetooth'la aileyi izler | Reklamda yalnız hizmet kimliği; etiketler 15 dakikada değişir, 25'e tamamlanır, karışıktır. Kalan sızıntı: "yakında afet modu açık bir Havenfold cihazı var". |
| Yabancı bağlanıp mesaj enjekte eder | Etiket eşleşmez; Noise el sıkışması çift sırrı ister; oturum yalnız aile cihazıyla |
| Yabancı bağlantılarla pil tüketir | Eşleşmeyen adres 15 dakika yok sayılır; en çok 3 bağlantı |
| Aileden kötü niyetli taşıyıcı | Mesajı açamaz, değiştiremez (AD); yalnız geciktirir ya da atar. Teslimi sahteleyemez (`doneHash`). |
| Taşıyıcı trafiği izler | Gönderen ve alıcı şifreli metnin içinde; taşıyıcı yalnız `toTag`, öncelik ve boyut görür |
| Aileden çıkarılan cihaz | Çift sırları silinir; etiketi ve Noise anahtarı tutmaz; eski mesajları alıcıda reddedilir |
| Sahte deprem uyarısı | `UYARI` yalnız bağlı cihazın çift anahtarıyla; telefondan gelen `UYARI` atılır |
| Konumun istemeden paylaşılması | Konum yalnız gönderenin eklediği mesajda; konum isteyen tür yok; `SOS` dışında yuvarlanır |
| Yeniden oynatma | `mid` 7 gün saklanır; `expiresDay` |
| Taşkın | Gönderen ve taşıyıcı sınırları, depo tavanı, öncelikli atma |
| Telefon çalınır | Bugünkü koruma (kilit, zorlama PIN'i); afet mesajları Hat katmanında, okumak kilit açmayı ister |
| Misafir ailenin trafiğini görür | Taşıyıcılar misafire başkalarının mesajını vermez; misafir taşımaz |
| Birleşik cihazda işçi kimliği kutunun bağ geçmişini öğrenir | Bluetooth ve taşıma kutu kimliğinde; `nearby` yalnız işçinin kendi oturumlarından (§10, H4) |

**Bilinen sınırlar:**

- İleri gizlilik yoktur (§7.2).
- iPhone arka planda Android'i bulabilir ama Android arka plandaki iPhone'u bulamaz (§6.7).
- Afet modu bir ağ değildir. Mesaj ancak aile cihazları birbirine yaklaştıkça ilerler. Bluetooth'un menzili kapalı alanda birkaç on metredir.

## 16. Kurucu belgede değişecekler

| Bölüm | Değişiklik |
|-------|------------|
| §11 tablo, 5. satır | "Afet modu (yerel ağ, Bluetooth LE, Wi-Fi Direct, Multipeer) · Bluetooth ve Wi-Fi bağlarında yalnız kısa afet mesajları; internetsiz yerel ağda tam oturum · Yakındaki aile cihazı; yabancı yalnız bir Havenfold cihazının varlığını". |
| §11 afet maddesi | "Çekirdek tarafı RFC-0012'dedir: durumlar, yerel bağlar, mesaj biçimi, sakla-ilet, taşkın ve pil kuralları. Ekranlar, SOS akışı ve deprem eşiği Yuva Acil ve Deprem'in işidir." |
| §12 | Ek: "Yuva Kutusu'nda deprem sensörünü ve güç kesintisini işçi kimliği okur ve uyarıyı o açar; kutu kimliği yalnız taşır. Uyarıdaki 'evdekiler' listesi işçinin kendi oturumlarından gelir; kutunun bağ geçmişi işçiye geçmez (H4)." |
| §6.5 | Emanet mührü `0xB0–0xB7` aralığını da kapsar. |
| §15.3 Acil ve Deprem satırı | "afet modu (kendi RFC'si)" → "afet modu (çekirdek: RFC-0012)". |
| §16.2 | Ek: "Afet modu iOS'ta Bluetooth arka plan kiplerini, Android'de Bluetooth ve yakındaki Wi-Fi izinlerini ister; gerekçe 'internet ve şebeke yokken aile içi kısa mesaj' olarak ve platforma özgü metinle yazılır." |
| §13.1 | Yeni tehdit satırları (numaraları işlenirken verilir): "Bluetooth ile izleme → dönen, doldurulmuş etiket listesi; yalnız varlık sızar." ve "Afet taşıyıcısı kötü niyetli → açamaz, değiştiremez, teslimi sahteleyemez." |
| §21 | "Afet modu ayrıntısı" satırı: "Çekirdek RFC-0012 ile tanımlandı. Ürün ekranları Yuva S4." "Haneler arası federasyon, Meshtastic" satırı aynen kalır; LoRa için mevzuat notu (RFC-0012 §12) eklenir. |
| §22.2 | Satır: "09 §11 · Kutu `ALARM` gönderir · Uyarıyı Yuva Kutusu'nun işçi kimliği açar, kutu taşır (RFC-0012 §10)". |

## 17. Uygulama sırası

1. Türetmeler, `AFET_MSG` mühürü, alıcı denetimi, durum makinesi; vektörler 1, 2, 4, 8, 10.
2. Sakla-ilet motoru ve sınırlar, benzetimli bağlarla (saf JavaScript); vektörler 5–7, 11.
3. Yerel ağ yolu: duyuru, etiket eşleşmesi, olağan oturum; vektörler 3, 9.
4. Android Bluetooth köprüsü ve ön plan hizmeti; Linux düğümde BlueZ.
5. iOS Bluetooth köprüsü, arka plan kipleri, durum geri yükleme.
6. Saha denemesi: iPhone/Android ön plan ve arka plan bütün birleşimlerinde keşif süresi, menzil, pil tüketimi. Sonuçlar §6.7 ve §9.3'e işlenir.
7. Wi-Fi Direct ve Multipeer yükseltmesi.
8. Düğümde güç ve sensör sinyalleri, kutunun çapa davranışı, `UYARI` (Yuva Kutusu ile, Yuva S4).
9. Yuva Acil ve Deprem ekranları ve mağaza metinleri (ürün işi).
