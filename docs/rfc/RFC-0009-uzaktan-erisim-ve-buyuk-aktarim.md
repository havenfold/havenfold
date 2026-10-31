# RFC-0009 — Yuva Bağlantı: kutuya evin dışından erişim ve büyük dosya aktarımı

> Durum: **Onaylandı** (Kerem, 23 Ekim 2026) · 23 Ekim 2026 · Yazan: Havenfold çekirdek ekibi · Onay: Kerem
> Kurucu belge: §2 (Yuva Bağlantı altyapısı), §3 (ilke 4, 5, 9; H1, H2, H7), §11, §13, §16.1, §22 (HF11). Ürün: EserX `yuva/docs/01` §4 (Yuva Bağlantı paketi), `09` §8.
> Bağımlılık: RFC-0001 (dosya biçimi §11), RFC-0002 (`NODE_CAPS`), RFC-0003 (cihaz çift sırrı, HELLO yetenek bitleri, emanet mührü §6.4). Protokol v2: `PLAN` olayı (tür 6).
> Kod yeri: `havenfold/core/baglanti` (`@havenfold/baglanti`: merdiven, jeton, aktarım istemcisi), `havenfold/node` (port eşleme, Tunnel yönetimi, röle dinleyicisi), `havenfold/services/baglanti` (Bağlantı geçidi ve Bağlantı rölesi, AGPL-3.0).

## 1. Sorun

Kutu ve işçiler evdedir. Aile üyeleri çoğu zaman dışarıdadır. Ev interneti de mobil hat da operatörün CGNAT'ı arkasında olabilir. O zaman ne doğrudan bağlantı ne de delik açma çalışır.

Üç şey tanımsız:

- Telefon, evdeki bir düğüme hangi sırayla ve hangi yollarla ulaşır.
- Büyük dosyalar (RFC-0001 §11, en çok 2 GB) iki cihaz aynı anda çevrimiçi değilken nasıl taşınır. Dosyalar Posta Kutusu'na gitmez (RFC-0001 §11.2).
- Ücretli Yuva Bağlantı paketi neyi açar ve sunucu hesabı olmadan nasıl doğrulanır.

Kurucu belge §11 ve HF11 iki sınır koyar: Eser Cloudflare Tunnel adresi sağlamaz; topluluk içinde VPN, Tailscale ya da Headscale kullanılmaz.

## 2. Öneri özeti

- **Erişim merdiveni:** (a) port eşleme, (b) HyperDHT delik açma, (c) ailenin kendi Cloudflare Tunnel'ı, (d) Eser'in işlettiği kör **Bağlantı rölesi**. İlk üçü ücretsizdir ve aileye aittir. Yalnız (d) ücretlidir.
- **Her basamakta aynı güvenlik:** Telefon ile düğüm arasında her zaman Noise IK + HELLO kurulur. Aradaki hiçbir taraf içeriği görmez.
- **Büyük aktarım:** Eser'in işlettiği R2 deposunda, aileyle bağlanamayan rastgele adlarla, aktarıma özel anahtarla şifreli, en çok 14 gün duran parçalar.
- **Ücretli paketin kapısı iki katlıdır:**
  - Cihazda: `PLAN` olayındaki mağaza fişi her cihazda doğrulanır. Bu kapı yalnız neyin gösterileceğini ve deneneceğini belirler.
  - Hizmette: Eser'in röle ve deposu yalnız geçerli bir **Bağlantı jetonu** kabul eder. **Jeton cihaz başınadır;** ailede paylaşılmaz. Geçit jetonla fiş arasındaki bağı saklamaz. Böylece Eser bir ailenin cihazlarını jetonla birbirine bağlayamaz; gördüğü bağ Posta Kutusu'nun gördüğünden fazla değildir (§9.2).
- **HF11 ile ilişki:** Bağlantı rölesi Cloudflare Tunnel adresi ya da VPN değildir. Kalıcı bir aile adresi yoktur, ağ katmanında erişim vermez. Yalnız çift sırrını bilen iki ucu günlük belirteçle eşleştirir ve uçlar arası Noise'u şifreli bayt olarak taşır.
- **Süre dolunca** yalnız (d) ve R2 durur. Port eşleme, delik açma, ailenin Tunnel'ı, kutunun aile içi rölesi ve emaneti, Posta Kutusu aynen çalışır.
- Yeni algoritma yok. Defter olayı 32 kullanılmaz.

## 3. Tanımlar

| Ad | Anlam |
|----|-------|
| **Düğüm** | Ailenin kutusu ya da bir işçisi (Linux ya da eski Android kutu). Merdivenin hedefidir. |
| **Bağlantı geçidi** | Eser'in Cloudflare Worker'ı. Jeton verir, R2 aktarımlarını yönetir. |
| **Bağlantı rölesi** | Eser'in sanal makinelerde işlettiği kör UDP rölesi. Holepunch `blind-relay` protokolünü konuşur. |
| **Aktarım deposu** | Eser'in R2 kovası (`hf-aktarim`). Posta Kutusu'nun kovasından ayrıdır. |
| **Bağlantı jetonu** | Geçidin verdiği 32 baytlık rastgele taşıyıcı jeton. Röle ve depo bunu ister. Her cihaz kendi jetonunu alır; jeton başka cihaza verilmez. |
| **Gün** | `epochDay = floor(unixMs / 86400000)`, UTC. |
| `pair` | İki kimlik arasındaki çift sırrı (protokol §5, RFC-0003 §6.2). |

Kodlama kuralları RFC-0001 §3'tekiyle aynıdır. Bu RFC'deki imzalı her mesajda `body` = `sig` dışındaki alanların kodlaması, `sig = Ed25519(imzalayan, hash('<etiket>', familyId, body))`.

## 4. Erişim merdiveni

### 4.1 Basamaklar

| # | Basamak | Kim kurar | Ücret | Taşıma | Hangi düğümde |
|---|---------|-----------|-------|--------|---------------|
| a | **Port eşleme** (PCP, NAT-PMP, UPnP-IGD) | Düğüm, kendiliğinden | Yok | UDP, doğrudan | Hepsi |
| b | **HyperDHT delik açma** | Çekirdek, bugünkü gibi | Yok | UDP, doğrudan | Hepsi |
| c | **Ailenin Cloudflare Tunnel'ı** | Ebeveyn, ailenin kendi Cloudflare hesabıyla | Yok (Cloudflare'ın ücretsiz Tunnel'ı; alan adı ailenin) | TCP / WebSocket | Linux kutu ve işçi |
| d | **Bağlantı rölesi** | Eser | Yuva Bağlantı | UDP, rölede eşleşme | Hepsi |

- Merdiven yalnız **bir ucu düğüm olan** bağlantılar içindir. Telefon ↔ telefon bağlantısı bugünkü sırayı izler (doğrudan, aile içi röle, kutu, Posta Kutusu). Telefon kutuya (d) ile ulaşıyorsa kutunun ücretsiz aile içi rölesi telefon ↔ telefon trafiğini de taşıyabilir.
- **Gerekçe:** Ücret "olay evin dışına çıktığında ve uzaktan erişimde" başlar (01 §4). Ama port eşleme, delik açma ve ailenin kendi Tunnel'ı Eser'e hiçbir maliyet getirmez ve açık çekirdeğin parçasıdır. Bunları ücrete bağlamak README taahhüdünü (kurucu §17.2: "ücretsiz bir özellik ücretli katmana taşınmayacak") çiğner. Ücretli olan, Eser'in bant genişliği ödediği röle ve depodur.

### 4.2 (a) Port eşleme

| Kural | Değer |
|-------|-------|
| Sıra | PCP (RFC 6887), sonra NAT-PMP (RFC 6886), sonra UPnP-IGD (önce `AddAnyPortMapping`, yoksa `AddPortMapping`) |
| Ne eşlenir | Yalnız HyperDHT'nin UDP soketi. Tek eşleme. TCP hiç eşlenmez. Uygulama portları hiç eşlenmez (RFC-0011). |
| Kira | 7200 sn. Sürenin yarısında yenilenir. Düğüm kapanırken silinir. |
| Açıklama | `havenfold` |
| Sonuç | Yönlendiricinin bildirdiği dış adres `100.64.0.0/10` ya da özel aralıktaysa eşleme işe yaramaz; `cgnat = true` kaydedilir ve eşleme silinir. |
| UPnP kapalıysa | Kullanıcıdan UPnP'yi açması **istenmez**. UPnP evdeki her cihaz için saldırı yüzeyini genişletir. (b), (c) ve (d) denenir. |
| Kütüphane | Kurucu §17.1 bağımlılık kuralına uyan küçük bir uygulama. Eski Android kutuda uygulamanın içinde. |

Eşleme başarılı olunca HyperDHT soketi dışarıdan erişilir olur. HyperDHT bunu kendisi algılar; telefonlar ek bilgi almadan doğrudan bağlanır.

### 4.3 (b) Delik açma

Bugünkü HyperDHT davranışı değişmez. Düğüm ek olarak kendi NAT türünü (`natRandom`: rastgele port atayan NAT) `REACH_INFO` ile bildirir. Telefon iki taraf da rastgele NAT arkasındaysa delik açmayı kısa keser ve sonraki basamağa geçer.

### 4.4 (c) Ailenin Cloudflare Tunnel'ı

- **Kim:** Yalnız ailenin kendi Cloudflare hesabı ve kendi alan adı. Eser adres, hesap ya da alt alan sağlamaz (HF11).
- **Kurulum:**
  1. Ebeveyn Cloudflare panelinde bir Tunnel ve bir ad (ör. `kutu.<ailenin alan adı>`) oluşturur. Adın hedefi `http://127.0.0.1:47801` olur.
  2. Tunnel jetonunu düğüme verir: düğümün terminalinde `havenfold tunel kur` ile ya da telefondan `TUNNEL_SET` ile.
  3. Düğüm `cloudflared`'i jetonla çalıştırır. `cloudflared` ikilisinin özeti imzalı sürüm bildiriminin `assets` listesindedir (RFC-0007 §12.1).
- **Dinleyici:** Düğüm `127.0.0.1:47801`'de yalnız WebSocket kabul eder. Yol `/hf/v1`. Başka her istek boş `404` alır.
- **Tunnel jetonu bir sırdır:**
  - Yalnız doğrudan Noise oturumunda taşınır. Emanete ve Posta Kutusu'na hiç gitmez.
  - Düğümde, düğümün kendi anahtar dosyasıyla aynı korumada saklanır (TPM varsa sarılı).
- **Ad deftere yazılmaz.** `REACH_INFO` içinde, yalnız aileye gider (09 §8 ile aynı).
- **Eski Android kutu** Tunnel çalıştırmaz (09 §8).
- **Cloudflare ne görür:** İki ucun IP'si, zaman, boyut. İçerik Noise ile şifrelidir.

### 4.5 (d) Bağlantı rölesi

- **Teknoloji:** Holepunch `blind-relay` (Apache-2.0). HyperDHT ailesinin parçasıdır; ikinci bir protokol yığını gerekmez (H2). UDP üzerinde çalıştığı için sesli arama da taşınabilir.
- **Nerede:** Eser'in sanal makineleri. Cloudflare Worker UDP aktaramaz. Varsayılan: AB içinde iki bölge. Rölelerin açık anahtarları uygulamanın ve düğüm paketinin içinde sabittir; ebeveyn `BAG_CONFIG` ile değiştirebilir (§6.2).
- **Röle seçimi:** `relays[relayPairToken[0] mod len(relays)]`. İki uç aynı röleyi seçer. Seçilen yanıt vermezse listede bir sonraki denenir.
- **Eşleşme belirteci:** `relayPairToken = derive(pair, 'hf/bag-relay/', u64be(gün))`. Her çift için her gün değişir.
- **Kapı:** Her uç röleye Noise bağlantısı açar. Eşleşme isteğinden önce `hf-bag/1` adlı protomux kanalında **kendi** Bağlantı jetonunu sunar. Röle jetonu geçitten sorar ve cevabı 10 dakika önbellekte tutar. Jetonsuz ya da geçersiz jetonlu bağlantı eşleşme yapamaz.
- **Düğüm ne zaman rölede bekler:** Aşağıdakilerin hepsi doğruysa:
  - Bağlantı etkin (§5.3);
  - port eşleme yok, ya da `cgnat = true`;
  - düğüm bir üye ya da cihazdan son 24 saatte (a) veya (b) ile doğrudan bağlantı almamış, ya da `natRandom = true`.

  Bekleyen düğüm, çift kurduğu her telefon ve düğüm için o günün belirteciyle bir eşleşme kaydı tutar (en çok 25). Kullanılan kaydın yerine hemen yenisini açar. Gün dönünce kayıtları yeniler.
- **Telefon** röleyi yalnız merdivende sırası gelince kullanır (§4.7). Telefon rölede beklemez.

### 4.6 Boru üstünde Noise

(c) ve (d) yalnız bir bayt borusu verir. Kimlik ve şifreleme her zaman uçlar arasında kurulur:

1. **İpucu (yalnız c):** Telefon ilk WebSocket ikili çerçevesinde `TUNNEL_HINT { v: 1, hint: fixed16 }` gönderir. `hint = derive(pair, 'hf/bag-tunnel-hint/', u64be(gün))[0..16]`. Düğüm ipucunu bugünün ve dünün değerleriyle eşleştirir. Eşleşmezse bağlantıyı kapatır. Böylece adı bilen bir yabancı Noise'a bile ulaşamaz. (d)'de eşleşme belirteci aynı işi görür.
2. **Noise IK:** `@hyperswarm/secret-stream`, borunun üstünde bugünkü gibi çalışır. Anahtar çiftleri:
   - düğüm: `crypto_sign_seed_keypair(derive(pair, 'hf/bag-noise/', nodeId, u64be(gün)))`
   - telefon: `crypto_sign_seed_keypair(derive(pair, 'hf/bag-noise/', phoneId, u64be(gün)))`

   Bu, buluşma anahtarlarının (protokol §6) aynı düzenidir: yalnız çift sırrını bilen taraf el sıkışmayı tamamlar.
3. **HELLO:** Protokol §7.2 aynen. Kanal bağlama `handshakeHash` ile yapılır.
4. Bundan sonra oturum, doğrudan oturumdan farksızdır. Bütün zarf türleri geçer.

### 4.7 Deneme sırası (telefon → düğüm)

| Adım | Ne | Ne kadar |
|------|----|----------|
| 1 | HyperDHT (yerel adres, eşlenmiş port, delik açma) | Bugünkü 3 dilim. `natRandom` iki uçta da doğruysa tek dilim. |
| 2 | Düğümün `REACH_INFO`'sunda `tunnelHost` varsa Tunnel | 8 sn |
| 3 | Bağlantı etkinse ve düğüm `relay = true` bildirdiyse röle | 8 sn |
| 4 | Hiçbiri olmazsa | Zarflar emanete ya da Posta Kutusu'na; dosyalar §7'ye ya da beklemeye |

- **Ses ve görüntü** (kutunun aile içi rölesiyle giden aramalar) için 2 ile 3'ün yeri değişir: UDP röle, TCP Tunnel'dan önce denenir.
- Telefon her düğüm için son başarılı basamağı saklar ve bir sonraki denemeye oradan başlar. Ağ değişince baştan başlar.

### 4.8 `REACH_INFO` (0xA0)

```
REACH_INFO {
  nodeId     : fixed16
  seq        : uint            // her bildirimde artar
  mapped     : bool            // (a) başarılı
  cgnat      : bool
  natRandom  : bool
  tunnelHost?: string          // (c) kuruluysa, ≤ 253 B
  relay      : bool            // (d)'de bekliyor
  sig        : fixed64         // düğüm, etiket 'hf/reach-info/'
}
```

- Düğüm bunu bağlanan her üyeye, bağlanınca ve değişince gönderir. Emanet ve Posta Kutusu yolunda RFC-0003 §6.4 mührüyle gider (anahtar `derive(pair, 'ctrl')`).
- Alıcı yalnız en büyük `seq`'i tutar.
- Dış IP adresi taşımaz. Gerek yoktur; HyperDHT adresi kendisi bulur.

### 4.9 `TUNNEL_SET` (0xA4)

```
TUNNEL_SET {
  nodeId      : fixed16
  op          : uint           // 0 kur, 1 kaldır
  host        : string
  tunnelToken?: string         // op = 0'da dolu
  by          : fixed16        // ebeveyn
  ledgerSeq   : uint
  sig         : fixed64        // etiket 'hf/tunnel-set/'
}
```

- Düğüm `by`'ın bugün aktif ebeveyn olduğunu kendi defter kopyasıyla denetler.
- **Yalnız doğrudan Noise oturumunda** kabul edilir. Emanetten ya da Posta Kutusu'ndan gelirse atılır (`TUNNEL_YOL`).

## 5. Ücretli paket ve cihazdaki kapı

### 5.1 Ne ücretli, ne değil

| Ücretsiz (her ailede) | Yuva Bağlantı (ya da onu içeren Yuva Aile) |
|-----------------------|---------------------------------------------|
| Port eşleme, delik açma | Bağlantı rölesi (d) |
| Ailenin kendi Tunnel'ı (c) | Aktarım deposu (R2, §7) |
| Kutunun aile içi rölesi ve emaneti | |
| Posta Kutusu (zarflar, zil, ≤ 25 MB mesaj ekleri, K7) | |
| Kendi kurduğu Bağlantı sunucusu (§6.4) | |

Posta Kutusu'nun mesaj ekleri (K7, ≤ 25 MB) bu RFC'nin dışındadır ve ücretsiz kalır. RFC-0001 dosyaları Posta Kutusu'na yine gitmez.

### 5.2 `PLAN` fişinin doğrulanması

`PLAN` (tür 6) gövdesi değişmez: `{ storeReceiptJws, product, expiresAt }`. Defter kuralı da değişmez: tek imzacı, aktif bir telefon üyesi; `product ∈ {'baglanti', 'aile'}` ya da `hizmet:<ad>`.

**Fiş doğrulaması defter kuralı değildir.** Sertifika zincirleri, kök sertifikaların ömrü ve kütüphane farkları defteri belirlenimci olmaktan çıkarırdı. Fiş, her cihazda ayrı bir yorum adımıyla doğrulanır. Sonucu yalnız o cihazın davranışını etkiler; paylaşılan durum değildir.

`storeReceiptJws` alanının içeriği mağazaya göre:

| Mağaza | İçerik | Cihazdaki doğrulama |
|--------|--------|----------------------|
| App Store | StoreKit 2 işleminin `jwsRepresentation`'ı (JWS compact) | Başlık `alg = ES256`, `x5c` üç sertifika. Zincir uygulamaya sabitlenmiş Apple Root CA - G3 parmak izine bağlanır. Zincir, fişin kendi `signedDate` anında geçerli olmalıdır; "şimdi" kullanılmaz. Apple'ın yaprak ve ara sertifika OID'leri. İmza. Gövdede `bundleId` uygulamanınki, `productId` §5.2.1 tablosunda, `type = 'Auto-Renewable Subscription'`, `revocationDate` yok, `environment` derlemeye uygun, `expiresDate = PLAN.expiresAt`. |
| Google Play | `gp1.` + base64url(`originalJson`) + `.` + base64url(`signature`) | Uygulamaya sabitlenmiş Play lisans açık anahtarıyla RSA PKCS#1 v1.5 SHA-1 imzası. `packageName` uygulamanınki, `productId` tabloda, `purchaseState = 0`. Play'in cihazdaki verisi bitiş tarihi taşımaz: `expiresAt ≤ PLAN.ts + süre(productId) + 3 gün` olmalıdır. |

- **Gerekçe (Play):** Play fişi bitişi kanıtlamaz. `expiresAt` satın alanın beyanıdır ve geçidin cevabından gelir (§6.1). Bu beyan yalnız ailenin kendi ekranlarını etkiler. Ücretli hizmetin kendisini jeton korur. Fişi sahteleyen aile yalnız kendi ekranını kandırır.
- **Algoritma notu:** ES256, X.509 ve RSA-SHA1 protokolün parçası değildir. Mağazaların kendi mekanizmasıdır ve işletim sisteminin kripto kütüphaneleriyle doğrulanır (iOS Security, Android `java.security`, düğümde Node `crypto`). Kurucu §13.2'deki "protokolün dışında" listesine eklenir (§13).

#### 5.2.1 Ürün kimlikleri (varsayılan, değiştirilebilir)

| `productId` | `product` | Süre |
|-------------|-----------|------|
| `yuva.baglanti.aylik` | `baglanti` | 31 gün |
| `yuva.baglanti.yillik` | `baglanti` | 366 gün |
| `yuva.aile.aylik` | `aile` | 31 gün |
| `yuva.aile.yillik` | `aile` | 366 gün |

Fiyat Kerem'in kararıdır ve bu RFC'nin konusu değildir.

### 5.3 Kapı işlevi

```
planEtkin(ledger, now):
  ledger'daki PLAN olaylarından, en büyük seq'ten başlayarak:
    product ∉ {'baglanti', 'aile'}  → atla
    fisGecerli(e) yanlış            → atla     // §5.2, sonuç olay başına önbellekte
    now ≤ e.expiresAt + 3 gün       → doğru
  yanlış

jetonEtkin(now) = bu cihazın kendi geçerli jetonu var ve now < token.expiresAt

bagEtkin(now) = planEtkin(ledger, now) veya jetonEtkin(now)
```

- `bagEtkin` doğruysa cihaz Bağlantı ekranlarını gösterir, röleyi ve depoyu dener, düğüm rölede bekler.
- Yanlışsa cihaz bu ikisini hiç denemez. Eser'e istek gitmez.
- `jetonEtkin` dalı şu durumu kapatır: Abonelik yenilendi ama satın alan telefon yeni `PLAN` yazmadı. Cihaz kendi jetonunu eski jetonla yenilemiştir; geçit aboneliğin güncel durumunu mağaza sunucusundan aldığı için yenileme olur (§6.3); hizmet sürer.
- **Satın alan telefon** her yeni mağaza işleminde (yenileme dahil) yeni bir `PLAN` yazar: iOS'ta `Transaction.updates`, Android'de satın alma dinleyicisi ve uygulama açılışındaki sorgu. Yılda en çok 12 olay eklenir; kabul edilmiştir.
- Kutu `PLAN` imzalayamaz (protokol §4.2). Bu değişmez.

### 5.4 Süre dolunca

| Ne | Ne olur |
|----|---------|
| Bağlantı rölesi | Yeni eşleşme yapılmaz. Açık oturumlar jetonun süresi bitince kapanır. Düğüm rölede beklemeyi bırakır, `REACH_INFO.relay = false` gönderir. |
| Aktarım deposu | Yeni aktarım açılmaz. **Yüklenmiş aktarımlar süreleri dolana kadar indirilebilir**, çünkü indirme jeton istemez (§7.4). Yoldaki hiçbir dosya kaybolmaz. |
| Port eşleme, delik açma, Tunnel | Aynen sürer. |
| Kutunun röle ve emaneti, Posta Kutusu, aramalar, SOS | Aynen sürer. |
| Ekran | "Yuva Bağlantı sona erdi. Evinize dışarıdan ulaşmak için ücretsiz yollar sürüyor: <durum>." Aile cezalandırılmaz. |

## 6. Bağlantı jetonu

### 6.1 Verme

```
POST /v1/jeton   { store: 'apple' | 'google', receipt }        → 200 { token, expiresAt, product, limits }
```

- `receipt`: App Store'da `PLAN.storeReceiptJws`'nin kendisi; Play'de `{ packageName, productId, purchaseToken }`.
- **Geçidin denetimi:**
  - Apple: JWS'yi doğrular, `originalTransactionId` ile App Store Server API'den aboneliğin güncel durumunu alır.
  - Google: Play Developer API'den `purchaseToken` ile aboneliğin güncel durumunu alır.
  - Abonelik etkin değilse ya da geri ödenmişse `402`.
- **Jeton:** 32 bayt rastgele. Geçit yalnız `SHA-256(token)` → `{ product, expiresAt, kullanım }` saklar.
- **Süre:** `expiresAt = min(abonelik bitişi + 3 gün, şimdi + 35 gün)`.
- **Cihaz başına jeton:** Her cihaz (telefon üyesi, kutu, işçi) kendi jetonunu ister. Misafir, uç ve aksesuar jeton almaz.
- **Fiş ile jeton arasındaki bağ saklanmaz.** Geçit yalnız bir sayaç tutar: `SHA-256(store ‖ özgünKimlik ‖ güncelBitiş)` → verilen yeni jeton sayısı. `özgünKimlik` Apple'da `originalTransactionId`, Play'de `purchaseToken`'dır. Aynı abonelik dönemi için en çok **32** yeni jeton verilir (`409`; varsayılan, değiştirilebilir: 8 üye + 16 cihaz + kutu + yedek). Yenileme (§6.3) sayaca girmez. Sayaç dönem bitişinden 30 gün sonra silinir.
- Bu bağ, istek işlenirken bellekte bir an için vardır. Geçit kaydetmez ve günlük tutmaz (Posta Kutusu ile aynı kural: `observability` kapalı, `console.` yasak). Bu bir teknik güvence değil, işletim taahhüdüdür. Kör imza gibi bir yapı kurucu §13.2 listesinde yoktur (H7); v1'de kullanılmaz.

### 6.2 Ayarlar: `BAG_CONFIG` (0xA1)

```
BAG_CONFIG {
  mode          : uint            // 0 Eser, 1 kendi sunucusu, 2 kapalı
  base          : string          // geçit adresi
  relays        : array<fixed32>  // rölelerin açık anahtarları
  token?        : fixed32         // yalnız mode = 1: ailenin kendi sunucusunun paylaşılan jetonu (§6.4)
  tokenExpiresAt: uint            // ms; mode ≠ 1'de 0
  product       : string
  ledgerSeq     : uint
  hlc           : biguint64
  by            : fixed16
  sig           : fixed64         // etiket 'hf/bag-config/'
}
```

- **Kim alır:** Aktif telefon üyeleri, kutu, işçiler. Misafir, uç ve aksesuar almaz.
- **Kim gönderir:**
  - `mode = 0` ve sabit varsayılan `base` ile `relays`: herhangi bir aktif üye ya da düğüm.
  - `mode = 1` ya da `2`, veya varsayılandan farklı `base`/`relays`: yalnız aktif ebeveyn.
- **Hangisi geçerli:** `(ledgerSeq, hlc, by)` üçlüsü büyük olan (RFC-0001 §5 düzeni). Karar yalnız gövdeye bakar; geliş sırasına ve saate bağlı değildir.
- **Eser jetonu `BAG_CONFIG` ile dağıtılmaz** (`mode = 0`'da `token` yoktur). Her cihaz kendi jetonunu geçitten alır (§6.1, §6.3).
- **Taşıma:** Doğrudan oturumda; emanet ve Posta Kutusu yolunda RFC-0003 §6.4 mührüyle. Posta Kutusu `mode = 1` jetonunu göremez.

### 6.3 Alma, yenileme ve çıkış

- **Kim alır:** Her cihaz kendi jetonunu kendisi alır. Fişi defterdeki en son geçerli `PLAN`'dan okur. Telefonlar, kutu ve işçiler tam defteri tuttuğu için hepsi bunu yapabilir.
- **İlk alma:** `planEtkin` doğruyken cihazın (d) ya da Aktarım deposu ihtiyacı ilk kez doğduğunda. Rölede bekleyecek düğüm (§4.5) hemen alır. Telefon uygulama ön plandayken alır.
- **Yenileme:** Jetonun bitmesine 7 gün kala günde en çok bir kez, ya da röle veya depo `401` döndüğünde. Yenileme eski jetonla yapılır:

  ```
  POST /v1/jeton/yenile   x-hf-bag: <eski jeton>   { store, receipt }   → 200 { token, ... }
  ```

  Eski jeton aynı anda geçersiz olur. Eski jeton teslim edildiği için bu istek dönem sayacına girmez. Abonelik yenilenmemişse geçit `402` döner ve cihaz yenilemeyi bırakır.
- **Cihaz aileden çıkınca** (`REMOVE_MEMBER`, `LEAVE`, `DEVICE_DETACH`, `ROTATE_DEVICE`'ta eski cihaz): Jeton yalnız o cihazdadır. Dürüst yazılım çıkarıldığını defterde görünce jetonunu siler. Kötü niyetli bir eski cihaz jetonunu abonelik sürdükçe yenileyebilir; ama çift sırları geçersiz olduğu için hiçbir aile cihazıyla eşleşemez ve aile verisine ulaşamaz. Yalnız kendi jetonunun kotası kadar röle ve depo kullanabilir (§12). Geçit jetonları aileye bağlayan bir kayıt tutmadığı için tek bir jetonu uzaktan iptal etmenin yolu yoktur; bu bilinçli bedeldir ve kotayla sınırlıdır.
- **Kural belirlenimcidir ve yereldir:** Jeton paylaşılan bir durum değildir; her cihazın kendi davranışıdır.

### 6.4 Kendi Bağlantı sunucusu

- Geçit ve röle kodu açıktır (`services/baglanti`, AGPL-3.0; Posta Kutusu ile aynı lisans).
- Bir aile kendi Cloudflare hesabında geçidi ve kendi makinesinde röleyi kurabilir. Ebeveyn `BAG_CONFIG { mode: 1, base, relays }` yazar.
- `mode = 1`'de `PLAN` aranmaz; sunucu ailenindir. Ücret Eser'in işlettiği hizmetin bedelidir, yazılımın değil.
- Kendi sunucusunda kapıyı aile kurar: kurulumda üretilen tek bir paylaşılan jeton sunucuya yazılır ve `BAG_CONFIG.token` ile aileye dağıtılır. Mağaza denetimi yapılmaz.

## 7. Büyük dosya aktarımı (R2)

### 7.1 Ne zaman

Bir dosya (RFC-0001 §11) bir aile cihazına gidecek ve:

- alıcıya (a), (b), (c) ya da kutunun rölesi ile ulaşılamıyorsa, ya da
- tek yol Bağlantı rölesiyse ve dosya 8 MiB'den büyükse (röle bant genişliği pahalı, R2 çıkışı ücretsiz),

ve `bagEtkin` doğruysa, dosya Aktarım deposuna yüklenir. Değilse dosya, doğrudan yol açılana kadar gönderende bekler.

Örnekler: dışarıdaki telefon 300 MB'lık bir videoyu evdeki işçiye bırakır; uyuyan bir iPhone'a büyük bir belge gönderilir; yazlıktaki düğüm ana evdeki yedeği çeker.

### 7.2 Anahtarlar ve adlar

Gönderen her aktarım için 32 baytlık rastgele `xferSecret` üretir:

```
xferId   = hash('hf/xfer-id/', xferSecret)
writeKey = derive(xferSecret, 'hf/xfer-write/')
readKey  = derive(xferSecret, 'hf/xfer-read/')
xferKey  = derive(xferSecret, 'hf/xfer-key/')
```

- `xferSecret` ve `writeKey` gönderende kalır. Alıcı `xferId`, `readKey` ve `xferKey` alır.
- **R2 nesne adı:** `x/<xferId hex>/<parça no>`. Adda aile, tarih, jeton ya da `blobId` yoktur.
- **Neden `blobId` kullanılmaz:** Aynı dosya iki kez gönderilirse `blobId` aynı olur. Eser iki aktarımı birbirine bağlayabilirdi. Aktarım katmanı bu yüzden ayrı ve rastgeledir.

### 7.3 Parça biçimi

- Kaynak, RFC-0001 §11 biçiminde şifrelenmiş dosyanın baytlarıdır (`ct_0 ‖ ct_1 ‖ …`). Dosya anahtarı (`fileKey`) aktarıma hiç girmez; kayıtta ya da görevde ayrıca gider.
- Parça boyu `P = 128 × 65552 = 8390656` bayttır, yani 128 şifreli dosya parçası. Son parça kısa olabilir.

```
nonce_j = u64be(j) ‖ 16 sıfır bayt
AD_j    = hash('hf/xfer-ad/', xferId, u64be(j), u64be(parts))
up_j    = XChaCha20-Poly1305(xferKey, nonce_j, kaynak[j·P .. (j+1)·P), AD_j)
```

- İkinci şifreleme katmanı Eser'in dosyanın iç yapısını (RFC-0001 parça sınırları, `blobId`) görmesini ve iki aktarımı bağlamasını engeller. `xferKey` her aktarımda yenidir; sabit nonce düzeni güvenlidir.
- Alıcı her parçayı açar, kaynağı birleştirir, sonra RFC-0001 §11'deki `blobId` ve boyut denetimini yapar.

### 7.4 Geçidin aktarım uçları

Bütün istekler HTTPS'dir. Gövdeler ikili ya da JSON. Hiçbir istekte `familyId`, `memberId`, ad ya da numara yoktur.

| Yöntem | Yol | Başlık | Gövde | Cevap |
|--------|-----|--------|-------|-------|
| `POST` | `/v1/x/{xferId}` | `x-hf-bag`, `x-hf-write`, `x-hf-read` | `{ size, parts, maxReads, ttlSec }` | `201` · 400 (sınır dışı alan) · 401 · 402 · 409 (var) · 413 (boyut) · 429 |
| `PUT` | `/v1/x/{xferId}/{j}` | `x-hf-write` | `up_j` (≤ P + 16) | `201` · 403 · 409 (parça var) · 413 |
| `GET` | `/v1/x/{xferId}` | `x-hf-read` | — | `{ parts, have: bitmap, expiresAt }` · 403 · 404 |
| `GET` | `/v1/x/{xferId}/{j}` | `x-hf-read` | — | baytlar · 403 · 404 · 429 |
| `POST` | `/v1/x/{xferId}/bitti` | `x-hf-read` | — | `204` |
| `DELETE` | `/v1/x/{xferId}` | `x-hf-write` | — | `204` |
| `GET` | `/v1/jeton` | `x-hf-bag` | — | `{ expiresAt, used, limits }` |

- Anahtarlar hex olarak gelir. Geçit yalnız `SHA-256` özetlerini saklar ve sabit süreli karşılaştırır (Posta Kutusu §4 ile aynı düzen).
- **Jeton yalnız oluştururken istenir.** Aktarımın tam boyu o anda jetonun aylık kotasından düşer. Nesne kaydında jeton ya da özeti tutulmaz.
- **İndirme jeton istemez**, yalnız `readKey` ister. Böylece indiren cihazın IP'si jetonla bağlanmaz ve süre dolduktan sonra da yoldaki dosyalar alınabilir.
- Her aktarım bir Durable Object'tir (`xferId` başına): boyut, parça bitmap'i, anahtar özetleri, `maxReads`, okuma sayısı, son tarih.

### 7.5 Akış

```mermaid
sequenceDiagram
    participant G as Gönderen (telefon)
    participant B as Bağlantı geçidi + R2
    participant A as Alıcı (düğüm ya da telefon)
    G->>G: xferSecret üret, parçaları şifrele
    G->>B: POST /v1/x/{xferId} (jeton, yazma ve okuma anahtarı)
    G->>B: PUT parçalar (kaldığı yerden sürer)
    G->>A: XFER_OFFER (doğrudan, emanet ya da Posta Kutusu; mühürlü)
    A->>B: GET parçalar (readKey)
    A->>A: Aç, birleştir, blobId'yi doğrula
    A->>B: POST /bitti
    A->>G: XFER_DONE
    G->>B: DELETE (bütün alıcılar bitirdiyse)
```

```
XFER_OFFER (0xA2) {
  xferId    : fixed32
  base      : string          // aktarımın yapıldığı geçit
  readKey   : fixed32
  xferKey   : fixed32
  blobId    : fixed32
  size      : uint            // kaynağın toplam boyu
  parts     : uint
  expiresAt : uint            // ms
}

XFER_DONE (0xA3) { xferId: fixed32, blobId: fixed32, ok: bool }
```

- İkisi de doğrudan oturumda ya da RFC-0003 §6.4 mührüyle emanet ve Posta Kutusu yolunda gider. Teklifi yalnız alıcı açabilir.
- Gönderen, `XFER_OFFER`'ı gönderebilmek için yüklemenin tamamlanmasını bekler. Alıcı eksik parça görürse (`have` bitmap'i) 10 dakika sonra yeniden sorar.
- Alıcı açamadığı parçayı (`AEAD` hatası) yeniden indirmez; aktarımı `XFER_DONE { ok: false }` ile reddeder. Gönderen yeni bir aktarımla dener.
- `maxReads`, teklifin gittiği alıcı sayısıdır (en çok 26).

### 7.6 Süre ve silme

| Olay | Sonuç |
|------|-------|
| `bitti` sayısı `maxReads`'e ulaşır | Nesne hemen silinir |
| Gönderen `DELETE` | Hemen silinir |
| `ttlSec` dolar | Durable Object alarmı siler. Varsayılan 7 gün, en çok 14 gün. |
| Güvenlik ağı | R2 kovasında 15 günden eski nesneleri silen yaşam döngüsü kuralı |
| Yarım kalan yükleme | Oluşturmadan 24 saat sonra tamamlanmamışsa silinir |

Silme, R2 nesnelerini ve Durable Object'i (`deleteAll`) birlikte kaldırır. İz kalmaz.

## 8. Kotalar ve kötüye kullanım sınırları

Hepsi **varsayılan, değiştirilebilir**. Ücret değil, maliyet ve kötüye kullanım sınırıdır. Yuva Aile aynı Bağlantı sınırlarını içerir.

| Sınır | Değer |
|-------|-------|
| Jeton verme | Abonelik dönemi başına 32 yeni jeton (yenileme hariç); IP başına saatte 10 istek |
| Röle aylık hacim | Jeton (cihaz) başına 25 GB |
| Röle eşzamanlı eşleşme | Jeton başına 8; eşleşme başına 20 Mbit/sn |
| Röle bekleyen eşleşme kaydı | Jeton başına 32 |
| Depo aylık yükleme | Jeton (cihaz) başına 50 GB |
| Tek aktarım | Kaynak en çok 2 GiB (RFC-0001 sınırı) |
| Aktarım açma | Jeton başına günde 500 |
| Parça indirme | Parça başına en çok `3 × maxReads` |
| Süre | Varsayılan 7 gün, en çok 14 gün |
| Genel | IP başına dakikada 600 istek (Posta Kutusu ile aynı) |

- Sınır aşılınca `429`. İstemci "Bu ayki Bağlantı hacmi doldu, ücretsiz yollar sürüyor" der.
- Röle ve geçit içerik görmediği için içerik denetimi yapmaz. Kötüye kullanım yalnız hacim, sayı ve süreyle sınırlanır. Aktarımlar en çok 14 gün durduğu ve yalnız anahtarı bilen indirebildiği için depo genel bir dosya paylaşım hizmetine dönüşemez.

## 9. Gizlilik beyanı

### 9.1 Kim ne görür

| Taraf | Görür | Görmez |
|-------|-------|--------|
| Ev yönlendiricisi | Düğümün bir UDP portu eşlediğini | İçerik |
| Ailenin Cloudflare hesabı (c) | Telefonun ve evin IP'si, zaman, boyut | İçerik, kimlikler |
| Bağlantı geçidi (Eser) | Jeton verirken: mağaza işlem kimliği, ürün, bitiş, isteğin IP'si (istek süresince; saklanmaz). Aktarımda: IP, zaman, boyut, `xferId`, oluştururken gönderenin jetonu. | Aile, üye, ad, içerik, `blobId`, alıcının kim olduğu, iki jetonun aynı aileden olduğu |
| Bağlantı rölesi (Eser) | İki ucun IP'si, zaman, bayt sayısı, günlük eşleşme belirteci, her ucun kendi jetonu | İçerik, aile, üye, iki jetonun aynı aileden olduğu |
| R2 (Eser, Cloudflare altyapısında) | Şifreli parçalar | İçerik |
| Posta Kutusu | `XFER_OFFER` ve `BAG_CONFIG` için mühürlü baytlar | İçlerindeki anahtarlar ve jeton |

### 9.2 Bağlanabilirlik (dürüst not)

- **Jeton cihaz başınadır.** Bir jeton süresince (en çok 35 gün) Eser, o jetonla gelen istekleri ve IP'leri "aynı cihaz" diye bağlayabilir. Aynı ailenin iki cihazının jetonları arasında Eser'de kayıtlı bir bağ yoktur, çünkü fiş-jeton eşlemesi saklanmaz.
- **Eşleşme belirteci** her çift için günlüktür. Aynı gün aynı iki IP'nin buluştuğu görülür. Bu, Posta Kutusu'nun gördüğüyle aynı düzeydedir: orada da aynı çift adresine bırakan ve oradan alan iki IP birbirine bağlanabilir.
- **Rölede bekleyen düğüm** evin IP'sinden uzun süreli bir bağlantı tutar ve çiftleri için günlük belirteçler kaydeder. Eser bu IP'nin bir Havenfold düğümü olduğunu, Bağlantı kullandığını ve o gün kaç çiftin onu beklediğini bilir. Kimin evi olduğunu bilmez. Posta Kutusu da çift adreslerini yoklayan bir kutunun IP'sini aynı biçimde görür.
- **Jeton alma anı:** Geçit fişi ve isteyenin IP'sini istek süresince görür. Bu bağı saklamamak bir işletim taahhüdüdür (§6.1).
- **Mağaza:** Eser satıcı olarak abonelik sayısını ve işlem kimliklerini zaten bilir. Apple ve Google ödeyenin kim olduğunu bilir; Eser bilmez.
- **Sonuç:** Yuva Bağlantı, Eser'e aile ile IP arasında Posta Kutusu'nun gördüğünün ötesinde bir bağ vermez. Ek olarak gördüğü, hacim, süre ve cihaz başına jetondur.

### 9.3 Pazarlama ve arayüz cümlesi

"Yuva Bağlantı, evinize dışarıdan ulaşamadığınızda Eser'in işlettiği kör bir köprü ve süreli bir dosya deposu kullanır. Köprü ve depo içeriği göremez, ailenizi tanımaz. Evinizin internet adresini ve ne kadar veri geçtiğini görür."

### 9.4 Hukuk

- Eser, geçit, röle ve depo için veri işleyen konumundadır (kurucu §16.1).
- Röle makineleri ve Cloudflare yurt dışındadır. Posta Kutusu'nun KVKK listesine (yurt dışına aktarım, standart sözleşme) eklenir.
- Geçit mağaza işlem kimliğini abonelik sözleşmesinin ifası için işler ve saklamaz (§6.1).

## 10. Numaralar

| Tür | Numara |
|-----|--------|
| Defter olayı | **Kullanılmaz.** 32 bu RFC'ye ayrılmıştı; `PLAN` (6) yeterli olduğu için boş kalır. |
| Zarf türleri | `0xA0 REACH_INFO`, `0xA1 BAG_CONFIG`, `0xA2 XFER_OFFER`, `0xA3 XFER_DONE`, `0xA4 TUNNEL_SET`. `0xA5–0xA7` bu RFC'ye ayrılı ve boş. |
| HELLO yetenek biti | `BAGLANTI = 256`: bu RFC'nin zarflarını ve (c)/(d) borularını bilir |
| Çekirdek komutları | `290 LINK_STATUS`, `291 LINK_TOKEN_REQ`, `292 LINK_CONFIG_SET`, `293 TUNNEL_SET`, `294 TUNNEL_CLEAR`, `295 XFER_SEND`, `296 XFER_STATUS`, `297 XFER_CANCEL`, `298 PLAN_RECORD`, `299 REACH_TEST` |
| Türetme etiketleri | `hf/bag-relay/`, `hf/bag-tunnel-hint/`, `hf/bag-noise/`, `hf/bag-config/`, `hf/reach-info/`, `hf/tunnel-set/`, `hf/xfer-id/`, `hf/xfer-write/`, `hf/xfer-read/`, `hf/xfer-key/`, `hf/xfer-ad/` |
| Ağ | Tunnel dinleyicisi `127.0.0.1:47801`, yol `/hf/v1`. Röle protomux kanalı `hf-bag/1`. |
| Emanet mührü | RFC-0003 §6.4'teki K12 mühür kuralı `0xA0–0xA7` aralığının tamamını kapsar: bu aralıktaki bir zarf emanet ya da Posta Kutusu yolundan geçecekse aynı mühürle (`derive(pair, 'ctrl')`, AD = gönderen ‖ alıcı ‖ tür ‖ zarf id) kapatılır; Posta Kutusu'nda ayrıca K12'nin `mailbox-seal` mührü uygulanır. `CTRL_TYPES` bunları kapsar. `0xA0–0xA3` bu yollardan geçebilir. `0xA4 TUNNEL_SET` bu yollarda hiç taşınmaz; gelirse atılır (`TUNNEL_YOL`). |

Koda yazılınca `KARARLAR.md`'ye işlenir.

## 11. Test vektörleri

`protocol/vectors/baglanti.json`:

1. Sabit `pair` ve gün ile `relayPairToken`, `hint`, `hf/bag-noise/` anahtar çiftleri.
2. Sabit `xferSecret` ile `xferId`, `writeKey`, `readKey`, `xferKey`; iki parçalı kaynak için `up_0`, `up_1` ve AD'ler.
3. Parça sırası değiştirilmiş aktarım → AD uyuşmaz, açılmaz.
4. `REACH_INFO`, `BAG_CONFIG`, `XFER_OFFER`, `TUNNEL_SET` kodlama ve imzaları.
5. `BAG_CONFIG` seçimi: aynı `ledgerSeq`, farklı `hlc` → büyük `hlc`; çocuktan gelen `mode = 2` → reddedilir.
6. `TUNNEL_SET` emanet yolundan → `TUNNEL_YOL`.
7. `planEtkin`: sabit Apple JWS örneği ve sabitlenmiş test kökü ile geçerli; `expiresAt` uyuşmaz → geçersiz; `revocationDate` var → geçersiz; süre + 3 gün geçti → yanlış.
8. `planEtkin`: Play örneği; `expiresAt` sınırı aşıyor → geçersiz.
9. Jeton yenileme zamanı: bitişe 8 gün → yenileme yok; 7 gün → yenile; aynı gün ikinci deneme → yok; `401` → hemen yenile.
10. Geçit (Miniflare): jetonsuz `POST /v1/x` → 401; yanlış `x-hf-read` → 403; `maxReads` kez `bitti` → nesne yok; 14 günden uzun `ttlSec` → 400; 2 GiB'den büyük `size` → 413; dönem başına 33. yeni jeton → 409; `yenile` sayaca girmez; `yenile` sonrası eski jeton → 401.

Her vektör telefonda (Bare), düğümde (Node 24) ve geçitte (Worker) aynı sonucu verir.

## 12. Güvenlik değerlendirmesi

| Tehdit | Önlem |
|--------|-------|
| Tunnel adını bulan yabancı düğüme bağlanır | İlk çerçevede çift sırrına bağlı ipucu; yoksa Noise'a bile ulaşmaz. Sonra Noise IK + HELLO. |
| Röle içeriği okur ya da değiştirir | Uçlar arası Noise; röle yalnız şifreli bayt taşır |
| Röle iki ucu yanlış eşler | Noise el sıkışması çift sırrı ister; yanlış eş el sıkışamaz |
| Jetonsuz kullanım (bedava binme) | Röle ve depo jeton ister; jeton mağaza sunucusuyla doğrulanmış abonelikle verilir |
| Sahte `PLAN` | Yalnız ailenin kendi ekranını etkiler; hizmet jetonla korunur |
| Çıkarılan cihaz kendi jetonunu kullanır | Çift sırları geçersiz: hiçbir aile cihazıyla eşleşemez, aile verisine ulaşamaz. Yalnız kendi jetonunun kotası; dürüst yazılım jetonu siler (§6.3). |
| Eser bir ailenin cihazlarını jetonla gruplar | Jeton cihaz başına; fiş-jeton eşlemesi saklanmaz (§9.2) |
| Geçit fişi jetonla eşler | İşletim kuralı: saklanmaz, günlük yok. Teknik sınır §9.2'de açık. |
| Depo kalıcı dosya paylaşımına çevrilir | En çok 14 gün, `maxReads`, parça başına indirme sınırı |
| Eser iki aktarımı aynı dosya diye bağlar | Aktarıma özel `xferKey` ve rastgele `xferId` |
| Port eşlemeyle evin yüzeyi büyür | Tek UDP port, yalnız HyperDHT; UDP kapalıysa açtırılmaz |
| Tunnel jetonu kutudan ya da Posta Kutusu'ndan sızar | Yalnız doğrudan oturumda taşınır; düğümde anahtar koruması |
| Yeniden oynatılan `XFER_OFFER` | Alıcı aynı `xferId`'yi bir kez işler; nesne silinmişse 404 |

**Bilinen sınırlar:**

- Jeton süresince bir cihazın IP'leri birbirine bağlanabilir (§9.2).
- Play fişi bitişi kanıtlamaz; cihazdaki kapı yalnız gösterimdir (§5.2).
- Rölede bekleyen düğüm evin IP'sini Eser'e sürekli gösterir.

## 13. Kurucu belgede değişecekler

| Bölüm | Değişiklik |
|-------|------------|
| §11 tablo | Satır eklenir: "4b · Bağlantı rölesi (Eser, Yuva Bağlantı) · Bir ucu düğüm olan oturumlar, şifreli UDP · İki ucun IP'si, zaman, boyut, günlük eşleşme belirteci". "Cloudflare Tunnel (kutu için son çare)" satırı "Ailenin kendi Cloudflare Tunnel'ı" olur. |
| §11 madde "Tunnel'ı kim sağlar" ve HF11 | HF11 aynen kalır. Açıklama eklenir: "Eser'in Yuva Bağlantı kapsamında işlettiği yol Tunnel adresi ya da VPN değil, kör Bağlantı rölesidir. Kalıcı bir aile adresi yoktur; eşleşme belirteci her gün değişir; jeton cihaz başınadır. Eser'in gördüğü aile–IP bağı Posta Kutusu'nunkinden fazla değildir (RFC-0009 §9.2)." |
| §11 yeni madde | "Büyük aktarım: dosyalar Posta Kutusu'na gitmez. Doğrudan yol yoksa ve Yuva Bağlantı etkinse Eser'in Aktarım deposundan, en çok 14 gün, aktarıma özel anahtarla geçer (RFC-0009 §7)." |
| §2 tablo, EserX satırı | "Yuva Bağlantı altyapısı" → "Yuva Bağlantı altyapısı (Bağlantı geçidi, Bağlantı rölesi, Aktarım deposu)". |
| §6.5 | Emanet mührü `0xA0–0xA7` aralığını da kapsar. |
| §13.1 | Yeni tehdit satırı (numarası işlenirken verilir): "Eser'in Bağlantı hizmeti ele geçirilir → Röle ve depo yalnız şifreli bayt görür; jetonla abonelik bağı saklanmaz; en kötü durumda IP ve hacim bilgisi açığa çıkar." |
| §13.2 "Protokolün dışında" | Eklenir: "Mağaza fişi doğrulaması (App Store JWS: ES256 + X.509 zinciri; Play: RSA PKCS#1 v1.5 SHA-1). Yalnız cihazdaki gösterim kapısı içindir; işletim sisteminin kripto kütüphanesiyle yapılır." Ayrıca: "Bağlantı geçidinde jeton ve aktarım anahtarlarının SHA-256 özetleri (Posta Kutusu ile aynı sunucu düzeni)." |
| §16.1 | Yurt dışı aktarım listesine Bağlantı rölesi makineleri ve Aktarım deposu eklenir. |
| §17.1 | Posta Kutusu satırı "Posta Kutusu ve Bağlantı hizmeti kodu" olur (AGPL-3.0). |
| §20 | Faz 3'e: "Yuva Bağlantı: merdiven (a)–(c) ücretsiz; röle ve Aktarım deposu". |

## 14. Uygulama sırası

1. Türetmeler, zarf kodlayıcıları, `planEtkin`; vektörler 1–9.
2. Düğümde port eşleme ve `REACH_INFO`; telefonda deneme sırası (§4.7) yalnız (a) ve (b) ile.
3. Ailenin Tunnel'ı: `cloudflared` yönetimi, WebSocket dinleyicisi, ipucu, boru üstünde Noise; `TUNNEL_SET`.
4. Bağlantı geçidi: jeton verme, Apple ve Google sunucu doğrulaması, sayaç; vektör 10'un jeton kısmı.
5. Bağlantı rölesi: `blind-relay` + `hf-bag/1` kapısı, hacim sayımı; düğümün rölede beklemesi.
6. Aktarım deposu: Durable Object, R2 parçaları, alarmlar, yaşam döngüsü kuralı; `XFER_OFFER` / `XFER_DONE`; vektör 10'un kalanı.
7. Cihaz başına jeton alma ve yenileme, `BAG_CONFIG` ayarları; satın alma akışı ve `PLAN` yazımı (Yuva Hat, mağaza metinleri §16.2'ye göre ayrı ayrı).
8. Kendi Bağlantı sunucusu belgesi ve kurulum kılavuzu.
