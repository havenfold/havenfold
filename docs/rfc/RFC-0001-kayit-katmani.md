# RFC-0001 — Kayıt katmanı (ortak veri)

> Durum: **Onaylandı** (Kerem, 23 Ekim 2026) · Kurucu belge 1.1 ile yürürlükte · Yazan: Havenfold çekirdek ekibi · Onay: Kerem
> Kurucu belge: §7, §8.2, §13. Bağımlılık: RFC-0003 (defter v2.1: `COLLECTION`, `GRANT`, `PROTOCOL_LEVEL`, cihaz çift sırrı, emanet mührü).
> Kod yeri: `havenfold/core/kayit` (`@havenfold/records`).

## 1. Sorun

Yuva Defteri, Ev Makinesi, Bakım, Pati ve Mekan Stok gibi ürünler ailenin ya da ekibin ortak verisini tutacak. Bugün yalnız mesajlar ve defter eşitleniyor. Her ürün kendi eşitlemesini yazarsa güvenlik kuralları dağılır, kutu ve Posta Kutusu her ürünü ayrı tanımak zorunda kalır, denetlenecek kod çoğalır.

## 2. Öneri özeti

- **Yapı:** Defterde tanımlı koleksiyonlar, içlerinde kayıtlar ve kayıtları değiştiren imzalı, şifreli işlemler vardır.
- **Birleştirme:** Alan düzeyinde son yazan kazanır (HLC).
- **Yetki:** Defterden hesaplanan yetki aralıkları. Yetkisi biten yazarın geriye dönük yazımlarını, okuyucuların yayımladığı imzalı kesimler sınırlar.
- **Anahtar:** Koleksiyon başına dönem anahtarı. Okuyucular üretir ve imzalar, çift kanalıyla dağıtılır.
- **Kutu:** İşlemleri kör tutar ve iletir.
- Hiçbir kural cihazın saatine ya da mesajların geliş sırasına bağlı değildir. Her cihaz aynı veriden aynı duruma varır.

Yeni algoritma ya da bağımlılık yoktur: `sodium-native`, `compact-encoding`, `b4a`.

## 3. Tanımlar ve kodlama kuralları

| Ad | Tür | Anlam |
|----|-----|-------|
| `familyId` | 32 B | Topluluk kimliği |
| `collectionId` | 16 B | Koleksiyon kimliği; `COLLECTION` olayında rastgele üretilir |
| `recordId` | 16 B | Kayıt kimliği (§4.1) |
| `authorId` | 16 B | Yazanın kimliği: üye, cihaz ya da misafir (RFC-0003 §3) |
| `epochSeq` | uint | Dönemi başlatan defter olayının `seq`'i |
| `epochHash` | 32 B | O olayın `eventHash`'i. Dönemin kimliği `(epochSeq, epochHash)` ikilisidir. |
| `keyId` | 32 B | `hash('hf/rec-epoch/', epochKey)`. Anahtarın tam özetidir; iki farklı anahtar aynı `keyId`'yi taşıyamaz. |
| `hlc` | uint64 (BigInt) | §6 |
| `ledgerSeq` | uint | Yazarın işlemi yazarken uygulanmış son defter olayının `seq`'i |
| `opId` | 32 B | §4.3 |

**"X anında"** her yerde şu anlama gelir: `seq = X` olan olay **uygulandıktan sonraki** defter durumu, yani `ledger.pastCursor().at(X + 1)`. Bir okuyucuyu çıkaran olayda, çıkan okuyucu "o olay anında" artık okuyucu değildir.

**Üye kimliklerinin çözülmesi:** Koleksiyon izinlerindeki `uye:<id>`, `owner` ve `TASK_PERMIT` öznesi, denetlenen işlemin `ledgerSeq` anındaki defterde `rotatedTo` zincirinin o an aktif olan ucuna çözülür (RFC-0003 §5.13). Böylece bir kimliğin cihaz değişiminden önce yazdığı işlemler, sonradan değerlendirilse de geçerli kalır.

**Kodlama kuralları (dört RFC için ortak):**

- Tel biçimleri `compact-encoding` ile kodlanır. `c.uint` en kısa biçimde olmalıdır; en kısa olmayan biçim reddedilir.
- **Seçimli alanlar** (`?` ile gösterilen) önce bir `c.bool` varlık bayrağı, sonra değer olarak kodlanır. `null` değeri "bayrak false" demektir.
- **İmza her zaman gönderilen baytlar üzerinden doğrulanır.** Alıcı gövdeyi yeniden kodlamaz; defterdeki olay gövdeleri de böyledir.
- `hlc` BigInt'tir ve `c.biguint64` ile kodlanır.
- **Özet ve türetmeler:**
  - `derive` ve `hash` kullanılır (`kdf.js`).
  - Bu RFC'lerin yeni etiketleri `hf/` ile başlar ve `/` ile biter (ör. `hf/rec-op/`). Böylece hiçbir etiket bir başkasının öneki olamaz.
  - Özete giren tamsayılar 8 bayt büyük sonlu (`u64be`) yazılır.
  - `kdf.js`'teki `toBuf` işlevine BigInt dalı eklenir (`u64be`). Bugün BigInt'i ondalık metne çeviriyor.
  - Liste olan girdiler (ör. `opIds`) öğeleri arka arkaya eklenmiş ham bayt olarak verilir.

## 4. Veri modeli

### 4.1 Kayıt

```
Kayıt { recordId, type, fields: Map<ad, Değer>, deletedAt: (hlc, authorId, opId) | null }
```

- **`recordId`:**
  - `put` ile oluşturulan kayıtta rastgele 16 bayttır.
  - `append-event` ile oluşturulan kayıtta `hash('hf/rec-append/', authorId, u64be(hlc))[0..16]`'dir (§10).
- **`type`:** Ad alanlıdır (`hf.*`, `yuva.*`, `mekan.*`). Kaydın türü, `type` alanı dolu olan işlemler arasında en küçük `(hlc, authorId, opId)` üçlüsüne sahip olanınkidir. `append-event` işleminde `type` her zaman doludur.
- **Alan adı:** En çok 64 bayt, `[a-z0-9_.]`. `__proto__`, `constructor` ve `prototype` alan adı olamaz (`INVALID_FIELD_NAME`; açılış güvenlik incelemesi, 25 Ekim 2026: alanlar JS nesnesine çevrilir). `_` ile başlayanlar çekirdeğe ayrılmıştır. Ayrılmış alanlar RFC-0015 §2'dedir: `_src` kaynak başvuruları listesi, `_conf` 0–100 güven, `_ai`, `_aiyol`, `_keep`, `_subj`, `_v`, `_t`.
- Bir kayıtta en çok 256 alan olabilir.

### 4.2 Değer kodlaması

```
Değer = tag (uint) + içerik
  0 null      1 false      2 true
  3 int       : c.int (zigzag varint, −2^53+1 .. 2^53−1)
  4 string    : c.string (UTF-8, ≤ 16 KB)
  5 bytes     : c.buffer (≤ 16 KB)
  6 blobRef   : { blobId: fixed32, fileKey: fixed32, size: uint, mime: string, name: string }
  7 list      : c.array(Değer), ≤ 64 öğe, iç içe en çok 2 düzey
```

Bilinmeyen `tag` içeren işlem reddedilir (`INVALID_VALUE`).

### 4.3 İşlem

**İç kısım (şifreli metnin içi):**

```
OpInner {
  recordId  : fixed16
  op        : uint      (0 put, 1 del, 2 append-event)
  type      : string    (kaydı oluşturan put'ta ve her append-event'te dolu; diğerlerinde boş)
  fields    : array<{ name: string, value: Değer }>
  hlc       : biguint64
  authorId  : fixed16
  ledgerSeq : uint
  ledgerHash: fixed32   // ledgerSeq'teki olayın eventHash'i
}
```

**Tel biçimi:**

```
REC_OP {
  collectionId : fixed16
  epochSeq     : uint
  keyId        : fixed32
  nonce        : fixed24     // rastgele
  ct           : buffer
  sig          : fixed64
}
AD   = hash('hf/rec-ad/', familyId, collectionId, u64be(epochSeq), keyId)
ct   = XChaCha20-Poly1305(epochKey, nonce, encode(OpInner), AD)
opId = hash('hf/rec-op/', collectionId, u64be(epochSeq), keyId, nonce, ct)
sig  = Ed25519(yazar, hash('hf/rec-op-sig/', familyId, opId))
```

- Yazar, kayıt, işlem türü, saat ve `ledgerSeq` şifreli metnin içindedir. Kutu ve Posta Kutusu yalnız `collectionId`, `epochSeq`, `keyId` ve boyutu görür.
- **Doğrulama sırası:** Alıcı önce `ct`'yi çözer, sonra iç `authorId`'nin anahtarıyla `sig`'i doğrular. İmza `opId` üzerinden şifreli metnin tamamını kapsar. İmzalayan, içteki `authorId` ile eşleşmek zorundadır.
- `opId` imzayı içermez; imza değiştirilerek farklı `opId` üretilemez.
- Tek `REC_OP` en çok **48 KB** olabilir. Daha büyük veri dosya olarak saklanır (§11).

## 5. Birleştirme

Her cihaz her koleksiyon için şu durumu tutar:

```
recordId → { fields: ad → (değer, hlc, authorId, opId), deletedAt }
```

Durum, **geçerli işlemler** kümesinin (§7) fonksiyonudur:

1. **Alan:** Büyük olan kazanır: önce `hlc`, sonra `authorId` bayt sırası, sonra `opId` bayt sırası. Aynı yazarın aynı `hlc`'li iki işlemi bile böylece belirlenimci çözülür.
2. **`del`:** Kaydın `deletedAt` değerine aynı kuralla yazılır. `hlc`'si `deletedAt`'ten küçük alanlar okumada yok sayılır.
3. **Geri getirme:** Silinmiş kayda `deletedAt`'ten büyük `hlc` ile gelen `put` kaydı geri getirir. Yalnız kendisinin ve kendisinden sonraki işlemlerin alanları görünür.
4. **Sıra bağımsızlığı:** Uygulama sırası sonucu değiştirmez. Geçerli işlemler kümesi değişince (yeni işlem, yeni kesim) durum yeniden hesaplanır. Yeniden hesaplama yalnız etkilenen kayıtlarda yapılabilir.
5. **Kural yetmediğinde:** Alan düzeyinde son yazan kazanır kuralının yetmediği yerde (sayaç, liste birleştirme) ürün her öğeyi ayrı kayıt yapar.

## 6. Saat (HLC)

- `hlc` = üst 48 bit milisaniye ‖ alt 16 bit sayaç.
- Cihaz tek bir `lastHlc` tutar ve bunu **işlemi göndermeden önce kalıcı olarak yazar**.
- **Yazarken:** `hlc = max(BigInt(şimdi_ms) << 16n, lastHlc + 1n)`.
- **Alırken:** `lastHlc = max(lastHlc, gelen.hlc)`.
- **İleri saat sınırı:** Gelen işlemin milisaniye kısmı yerel saatten 5 dakikadan ileriyse işlem bekletilir ve saat yetişince geçerli kümeye girer. Bu, yalnız işlemin **ne zaman** görüneceğini değiştirir, sonucunu değiştirmez. Kuyrukta en çok 1000 işlem durur; fazlası atılır ve eşitlemeyle yeniden gelir.
- `hlc` yalnız birleştirme sırası içindir. Yetki kararında kullanılmaz.

## 7. Geçerli işlem

Bir işlem, aşağıdaki koşulların hepsi sağlanınca geçerli kümeye girer. Hiçbir koşul saate ya da geliş sırasına bağlı değildir.

| # | Koşul | Sağlanmazsa |
|---|-------|-------------|
| 1 | `(epochSeq, keyId)` anahtarı var ve `ct` çözülüyor | Anahtar gelene kadar bekler |
| 2 | `sig`, iç `authorId`'nin anahtarıyla geçerli | Atılır |
| 3 | `ledgerSeq < ledger.len` ve `ledgerHash = ledger.hashAt(ledgerSeq)` | Defter yetişene kadar bekler; özet uyuşmazsa (başka dal) atılır |
| 4 | **Yetki:** `ledgerSeq` anında `authorId`, koleksiyonun `writers` listesinde (yetki aralığı tablosu, §7.2) | Atılır |
| 5 | **Dönem:** `epochSeq`, `ledgerSeq` anında yürürlükte olan dönem ya da ondan sonraki ilk dönem (yazar yeni dönemi görmeden yazmış olabilir) | Atılır (`EPOCH_MISMATCH`) |
| 6 | **Tür:** `append-event` yalnız `device:` yazarları ve `GRANT_WRITE` izni olan misafir içindir (RFC-0030 §4); `put` ve `del` onlara kapalıdır | Atılır |
| 7 | **Kesim:** İşlemin `ledgerSeq`'inin düştüğü yetki aralığı bir olayla bittiyse (§8.1), o olayın kesiminde işlem listelenmiştir ve zaman sınırını aşmaz (§8.3) | Hariç tutulur ama saklanır |

### 7.1 Yazma kuralı

Bir yazar, yetkisini ya da okuyucuyu çıkaran bir olayı defterde gördükten sonra o koleksiyonda **eski dönemle yazmaz**. Yeni dönem anahtarı gelene kadar işlemlerini yerelde kuyruğa alır.

### 7.2 Yetki aralığı tablosu

Her `ledgerSeq` için defteri yeniden kurmak pahalıdır, çünkü `pastCursor` geri gidildiğinde baştan kurar. Bu yüzden her cihaz her koleksiyon için şu tabloyu tutar:

```
yazar (üye kimliği, rol, cihaz, misafir) → [ { fromSeq, toSeq } ]
```

- Tablo, defter her değiştiğinde yalnız yeni olaylardan güncellenir.
- Bir işlemin yetkisi tablodan ikili aramayla bulunur.
- Çatallanma çözülüp defter değişirse (`replaceWith`) tablo baştan kurulur ve bütün koleksiyonların durumu yeniden hesaplanır.

## 8. Kesim

**Sorun:** Yetkisi biten bir yazar eski dönem anahtarını bilir. `ledgerSeq`'i eski bir değere ayarlayıp yazmaya devam edebilir; o eski anda yetkilidir.

**Çözüm:** Yetkisi bittiği anda okuyucular, yazarın o ana kadar geçerli olan işlemlerinin listesini imzalı olarak yayımlar. Listede olmayan geriye dönük işlemler hariç tutulur.

### 8.1 Yetkiyi bitiren olaylar

Yazarın yetki aralığı tablosunda (§7.2) bir aralığı `toSeq = eventSeq` ile biten her olay:

- `REMOVE_MEMBER`, `LEAVE`, `SET_ROLE` (yazar listesinden düşürürse)
- **Her** `ROTATE_DEVICE` (eski kimlik için; eski cihaz imzalasa da imzalamasa da). Bekleyen ebeveyn cihaz değişiminde eski kimliğin yetkisi `ACTIVATE_MEMBER` ile biter.
- `REVOKE`, `DEVICE_DETACH`, yazar listesini daraltan `COLLECTION`

### 8.2 Kesim mesajı

```
REC_CUTOFF (0x88) {
  collectionId : fixed16
  authorId     : fixed16
  eventSeq     : uint
  eventHash    : fixed32
  listHash     : fixed32       // hash('hf/rec-cutoff-list/', bütün parçaların opId'leri sıralı)
  part, parts  : uint
  opIds        : array<fixed32>
  issuerId     : fixed16
  sig          : fixed64       // Ed25519(issuer, hash('hf/rec-cutoff/', familyId, collectionId, authorId, u64be(eventSeq), eventHash, listHash, u64be(part), u64be(parts), opIds))
}
```

### 8.3 Kurallar

1. **Kim yayımlar:** `eventSeq` olayından sonra koleksiyonun okuyucusu olan bir **üye**. Şu kimlikler yayımlayamaz:
   - `authorId`'nin kendisi;
   - `authorId`'nin `rotatedFrom`/`rotatedTo` zincirindeki herhangi bir kimlik;
   - cihazlar ve misafirler.

   Böylece yazar listesinden düşürülüp okuyucu olarak kalan biri kendi geriye dönük işlemlerini listeleyemez.
2. **Liste neyi içerir:** Yayımlayanın `eventSeq` olayını **uygulamadan hemen önceki** geçerli kümesinde bulunan, bu yazarın, biten aralığa düşen (`fromSeq ≤ ledgerSeq < eventSeq`) işlemleri. Olay uygulandıktan sonra gelen ya da bekletilen işlemler listelenmez. Her telefon bu listeyi olayı uyguladığı anda çıkarır ve saklar. Kasa duyarlılıklı koleksiyonda yayımlayanın kasası kilitliyse işlemler çözülemediği için olay anında elde olan aday işlemlerin kimlikleri saklanır; liste kilit açılınca bunlardan çıkarılır.
3. **Ne zaman:** Olay uygulanır uygulanmaz; ancak kasa duyarlılıklı koleksiyonda yayımlayanın kasası kilitliyse kesim ertelenir ve kilit açılınca verilir (RFC-0027 §9 h). Ertelenen kesim kalıcıdır ve bir kez verilir. Derinlik beklenmez. Kesim `eventHash`'e bağlıdır; olay bir çatallanmada zincirden düşerse kesim yok sayılır.
4. **Alıcının denetimi:**
   - Defterde `eventSeq`'teki olayın özeti `eventHash`'tir.
   - Yetki tablosunda `authorId`'nin bir aralığı tam olarak `toSeq = eventSeq` ile biter.
   - `issuerId`, kural 1'e göre yayımlayabilir.
   - İmza geçerlidir.
   - Aynı `(issuerId, listHash)` için bütün parçalar gelmiştir.

   Biri tutmazsa kesim atılır.
5. **Herkes yayımlar:** Olaydan sonra okuyucu olan **her üye** kendi kesimini yayımlar. Ancak elindeki bütün listelenecek işlemler, aldığı tam kesimlerin birleşiminde zaten varsa yayımlamaz. Böylece kimsenin yayımlamaması yüzünden işlem kaybolmaz.
6. **Birleşim:** Uygulanan liste, o `(authorId, eventSeq, eventHash)` için gelen bütün geçerli kesimlerin birleşimidir. Birleşim yalnız büyür. Hangi sırayla gelirse gelsin her cihaz aynı sonuca varır.
7. **Kapsam:** Bir işleme yalnız, `ledgerSeq`'inin düştüğü yetki aralığını bitiren olayın kesimi uygulanır. Bu, `ledgerSeq`'ten büyük en küçük bitiş olayıdır. Yazar sonradan yeniden yetki alırsa sonraki işlemleri yeni aralığa düşer, ve o aralık da bir gün biterse kendi kesimine tabi olur.
8. **Zaman sınırı:** Yetkisi biten yazarın, bitiş olayının `ts` değerinden 1 günden ileri `hlc` taşıyan işlemleri listede olsa bile hariç tutulur. `ts` defterde yazılı olduğu için kural belirlenimcidir. Böylece giderken "geleceğe" yazılmış işlemler bırakılamaz.
9. **Kesim gelmeden önce:** Biten aralığa düşen ve henüz hiçbir kesimde görülmemiş işlemler bekletilir; hariç tutulmuş sayılır.
10. **Saklama:** Kesimler ve hariç tutulan işlemler kalıcıdır. Okuyucular arasında eşitlemeyle (§12) ve yeni okuyucunun anahtar paketiyle (§9.4) dolaşır.

### 8.4 Bilinen sınırlar

- Hiçbir okuyucunun görmediği, ama yazarın yetkisi bitmeden gerçekten yazdığı işlemler kaybolur.
- Kalan bir okuyucu, çıkarılan yazarla anlaşırsa geriye dönük işlemleri kendi kesimine ekleyebilir. Bu kişi zaten okuyucu ve çoğu zaman yazar olduğu için, kendi adına da aynı veriyi yazabilir; ek bir yetki kazanmaz.

## 9. Dönem anahtarı

### 9.1 Dönemler

| Olay | Yeni dönem başlar mı |
|------|----------------------|
| İlk `COLLECTION` (oluşturma) | Evet |
| Okuyucu çıkar: `REMOVE_MEMBER`, `LEAVE`, `SET_ROLE` ile düşme, `REVOKE`, okuyucu listesini daraltan `COLLECTION` | Evet |
| Eski cihaz imzalamadan yapılan cihaz değişimi: bekleyen ebeveynde `ACTIVATE_MEMBER`, diğer rollerde hemen uygulanan `ROTATE_DEVICE` | Evet |
| Eski cihazın imzaladığı `ROTATE_DEVICE` | Hayır |
| `history: false` koleksiyona okuyucu eklenir | Evet: yeni okuyucu önceki işlemleri görmesin. Cihaz değişimi (`ROTATE_DEVICE`) okuyucu eklemek sayılmaz. |
| `history: true` koleksiyona okuyucu eklenir | Hayır (§9.4) |
| Kasa koleksiyonlarında: herhangi bir `DEVICE_DETACH` ya da kutunun `REMOVE_MEMBER`'ı | Evet (RFC-0004 §6) |

### 9.2 Anahtar üretimi ve imzası

- **Kim üretir:** Dönem anında (olaydan sonra) koleksiyonun okuyucusu olan herhangi bir üye. Gereksiz kopyaları azaltmak için önce "sıralamada ilk" olan üretir: önce ebeveynler, sonra diğerleri, her grupta `memberId` bayt sırasıyla küçük olan. Diğerleri yeni anahtarı göremezlerse kendileri üretir. Ne kadar bekleneceği yerel bir ayardır ve geçerliliği etkilemez.
- Her anahtar üreten tarafından imzalanır:

  ```
  keyEntry = { keyId: fixed32, key: fixed32, issuerId: fixed16,
               sig: Ed25519(issuer, hash('hf/rec-key/', familyId, collectionId, u64be(epochSeq), epochHash, keyId, hash('hf/rec-key-commit/', key))) }
  ```

  `key` imzaya kendisi değil, özeti olarak girer. İmza anahtarı açığa çıkarmaz; anahtar zaten şifreli kanalda gider.
- **Alıcının denetimi:** `issuerId` dönem anında okuyucudur; `keyId = hash('hf/rec-epoch/', key)`; imza geçerlidir. Çıkarılan okuyucu dönem anında okuyucu olmadığı için anahtar üretemez. Okuyucuları arasında misafir (`grant:`) bulunan koleksiyonda anahtarı yalnız ebeveyn üretebilir.
- **Birden çok anahtar:** Bir dönemde birden çok geçerli anahtar olabilir. Okuyucular hepsini saklar ve iletir. Her işlem kendi `keyId`'siyle açılır; hiçbir işlem kaybolmaz.
- **Yeni yazımda hangisi:** Elindeki anahtarlar arasında, üreteni dönem anındaki rollere göre sıralamada en önde olanınki. Aynı üretenin birden çok anahtarı varsa `keyId` bayt sırasıyla küçük olan.

### 9.3 `REC_KEY` (0x82)

```
REC_KEY {
  collectionId : fixed16
  epochSeq     : uint
  epochHash    : fixed32
  keys         : array<keyEntry>
  dropSecrets  : array<{ dropKeyHash: fixed32, secret: fixed32 }>
}
```

- **Taşıma:** Doğrudan Noise oturumunda gider. Emanet ya da Posta Kutusu yolunda RFC-0003 §6.4 mührüyle.
- **Denetim:**
  - `(epochSeq, epochHash)` alıcının defteriyle eşleşir; eşleşmezse defter çözülene kadar bekletilir.
  - `epochSeq`'teki olay, §9.1'e göre bu koleksiyonda dönem başlatan bir olaydır.
  - Her `keyEntry` §9.2'ye göre denetlenir.
  - Her `dropSecrets` öğesinin açık anahtarı, o dönem içinde yürürlükte olmuş bir `dropKey` ile eşleşir.
- Yeni bir `dropKey` aynı dönem içinde de gelebilir. Bu durumda öneren, `keys: []` ve yeni `dropSecrets` içeren bir `REC_KEY` gönderir.

### 9.4 Okuyucu eklenince

- `history: true` ise yeni okuyucu bütün geçmiş dönemlerin anahtarlarını ve bütün kesimleri alır.
- `history: false` ise yalnız katıldığı olayla başlayan yeni dönemi alır (§9.1).
- Paketi, olaydan sonra okuyucu olan herhangi bir üye gönderebilir. Önce sıralamada ilk olan gönderir.

### 9.5 Anahtar isteme

```
REC_KEY_REQ (0x83) { collectionId: fixed16, epochs: array<uint> }
```

- Anahtarı kaybolan, yeni cihaza geçen ya da 7 günden uzun çevrimdışı kalan okuyucu herhangi bir okuyucudan ister.
- Cevap veren, isteyenin istenen dönemleri almaya yetkili olduğunu doğrular:
  - `history: true` ise bugün okuyucu olması yeter.
  - `history: false` ise her dönem anında okuyucu olmalıdır.
  - Okuyuculuk cihaz değişimiyle geldiyse `rotatedFrom` zinciri izlenir.
- Cevap: `REC_KEY` mesajları ve kesimler.

### 9.6 Anahtar saklama

- Dönem anahtarları telefonda Hat katmanındadır; kilitliyken de eşitleme sürer.
- `kasa` koleksiyonlarının anahtarları Arşiv katmanındadır, biyometri ister. Kilitliyken bu koleksiyonun işlemleri şifreli olarak kuyrukta bekler.
- Kasa koleksiyonu anahtarları kasa zarfına, kişisel koleksiyon anahtarları sahibinin yedeğine girer (RFC-0004).

## 10. Yalnız yazan cihaz ve olay ekleme

### 10.1 Bırakma anahtarı

- `kind = 'olaylar'` koleksiyonda `COLLECTION` olayı `dropKey` (X25519 açık anahtar) taşır. Gizli yarısı okuyuculara `REC_KEY.dropSecret` ile gider.
- **Okuyucu çıkınca:** Dönemi başlatan olaydan sonra, sıralamada ilk okuyucu yeni bir `dropKey` içeren `COLLECTION` olayı önerir. Çıkan okuyucu, yenilenmeden önce bırakılmış olayları okuyabilir; sonrakileri okuyamaz.
- **Geçerlilik:** Bir `REC_DROP`, işlemin `ledgerSeq` anında yürürlükteki `dropKey` ile mühürlüyse geçerlidir.

### 10.2 `append-event` biçimi

```
REC_DROP {
  collectionId : fixed16
  dropKeyHash  : fixed32     // hash('hf/rec-drop/', dropKey)
  sealed       : buffer      // crypto_box_seal(encode(OpInner, op = 2), dropKey)
  sig          : fixed64     // Ed25519(cihaz, hash('hf/rec-drop-sig/', familyId, dropOpId))
}
dropOpId = hash('hf/rec-drop-op/', collectionId, dropKeyHash, sealed)
```

Okuyucu `sealed`'ı açar ve §7'deki koşullara ek olarak şunları doğrular:

- `OpInner.authorId` imzalayan cihazdır.
- `op = 2`, `type` doludur.
- `recordId = hash('hf/rec-append/', authorId, u64be(hlc))[0..16]` eşitliği tutar.

Aynı cihaz aynı `hlc` ile iki olay bırakırsa (bozuk ya da kötü niyetli cihaz) aynı `recordId`'li iki işlem olur. §5'teki kural uygulanır: `dropOpId` bayt sırasıyla büyük olan kazanır. Cihaz kendi yazdığını okuyamaz.

## 11. Dosyalar (blob)

### 11.1 Biçim

```
parça boyutu  : 65536 B (son parça daha kısa olabilir)
fileKey       : her yüklemede rastgele 32 B; aynı anahtar ikinci bir içerik için kullanılmaz
nonce_i       = u64be(i) ‖ 16 sıfır bayt
AD_i          = hash('hf/blob-ad/', u64be(i), u64be(toplamParça))
ct_i          = XChaCha20-Poly1305(fileKey, nonce_i, parça_i, AD_i)
h_i           = hash('hf/blob-chunk/', ct_i)
blobId        = hash('hf/blob-id/', h_0 ‖ … ‖ h_n)
```

- Alıcı dosyayı kullanmadan önce `blobId`'yi ve boyutu doğrular.
- Bir dosya en çok 2 GB olabilir.

### 11.2 Taşıma ve silme

```
BLOB_REQ  (0x84) { blobId: fixed32, from: uint, count: uint }
BLOB_DATA (0x85) { blobId: fixed32, index: uint, total: uint, chunk: buffer }
BLOB_DEL  (0x86) { blobIds: array<fixed32>, by: fixed16, sig }   // Ed25519(by, hash('hf/blob-del/', familyId, blobIds))
```

- Dosyalar Posta Kutusu'na gitmez. Doğrudan bağlantıyla telefon ↔ telefon, telefon ↔ kutu ya da telefon ↔ depolama yeteneği olan işçi arasında taşınır.
- Kutu ve işçi dosyaları şifreli tutar; `fileKey`'i bilmezler.
- **Kim yükledi:** Dosyayı tutan, her dosyayı ilk yükleyen kimliği kaydeder.
- **Kim silebilir:** `BLOB_DEL`'i yalnız yükleyen, ya da topluluğun herhangi bir aktif ebeveyni imzalayabilir. Tutucu imzayı denetler ve dosyayı 90 gün sonra siler. Bu sürede aynı `blobId` yeniden yüklenirse silme iptal olur.
- **Konteyner uygulamalarının yedek dosyaları:** 90 günlük silme beklemesi uygulanmaz; tutucu, yükleyenin `BLOB_DEL`'ini hemen uygular (RFC-0011).
- Telefon kendi önbelleğini durumdan hesaplar: hiçbir canlı kaydın atıf yapmadığı dosyayı 30 gün sonra siler.
- Evin dışından büyük aktarım (R2) Yuva Bağlantı paketindedir ve ayrı RFC ile gelir.

## 12. Eşitleme

### 12.1 Okuyucular arası

1. Bağlantı kurulunca her taraf, ortak koleksiyonlar için özet gönderir:

   ```
   REC_VV (0x80) { items: array<{
     collectionId,
     epochs:  array<{ epochSeq, keyIds: array<fixed32> }>,
     authors: array<{ epochSeq, keyId: fixed32, authorId: fixed16, count: uint, setHash: fixed32 }>,   // (dönem, anahtar, yazar) başına; setHash = hash('hf/rec-set/', sıralı opId'ler)
     cutoffs: array<{ authorId, eventSeq, issuerId, listHash }>
   }> }
   ```

2. Bir yazarın `count` ya da `setHash` değeri farklıysa taraflar o yazarın `opId` listelerini değiş tokuş eder:

   ```
   REC_IDS (0x87) { collectionId, authorId, opIds: array<fixed32> }
   ```

   Eksik işlemler gönderilir:

   ```
   REC_OPS (0x81) { items: array<{ kind: 0 REC_OP | 1 REC_DROP, bytes: buffer }> }
   ```

   - Hariç tutulan işlemler de sayıma ve listeye girer; reddedilen ve temizlenen işlemler girmez (aşağıdaki mezar listesi).
   - Karşı tarafın anahtarı olmayan dönemin işlemleri gönderilmez. Bu, `history: false` ile katılan okuyucu ve misafir için de geçerlidir.
   - **Mezar listesi:** Okuyucu, kesin olarak reddettiği (koşul 2, 4, 5 ya da 6) ve temizlediği (§13) işlemlerin `opId`'lerini saklar. Bu işlemler yeniden gelirse kabul edilmez, eşitlemede istenmez.
3. Eksik anahtarlar `REC_KEY_REQ` ile, eksik kesimler `REC_CUTOFF` gönderimiyle tamamlanır.
4. **Boyut:** Doğrudan oturumda bir `REC_OPS` en çok 1 MB taşır. Emanet ve Posta Kutusu yolunda tek zarf `RELAY_MAX` (63 KB) sınırına uyar ve gerekirse bölünür.

### 12.2 Kutu (kör emanet)

- Kutu okuyucu değildir; yazarı ve saati göremez.
- **Kabul:** Kutu bir işlemi yalnız o koleksiyonun **okuyucusu olan bir üyenin** oturumundan ya da `writers` listesinde `device:` olarak yer alan bir cihazın oturumundan kabul eder. Bunu kendi defter kopyasından bilir: oturumu açanın kimliği HELLO'dan gelir ve koleksiyonun okuyucu ve yazar listesi defterdedir. Gönderici başına koleksiyonda en çok 256 MB kabul eder.
- **Saklama:** `opId` (`REC_DROP` için `dropOpId`) → işlem baytları. Kutu bir işlemi yalnız iki durumda siler:
  - Bir okuyucunun imzalı `REC_PRUNE` isteğiyle. Budanan `opId` kutunun mezar listesine girer ve yeniden kabul edilmez.
  - Koleksiyonun hiç okuyucusu kalmadığında, 30 gün sonra. Bu kural defterdeki okuyucu listesine bağlıdır.

  Bunların dışında kutu kendiliğinden silmez. Dolunca yenisini reddeder ve bunu bağlı okuyuculara `hf.kayit.kutu-dolu` olayı olarak, durum mesajıyla bildirir.
- **Eşitleme:**

  ```
  REC_BUCKETS    (0x8A) { collectionId, hashes: array<fixed32> }      // 256 kova; kova = opId[0], özet = hash('hf/rec-bucket/', sıralı opId'ler)
  REC_BUCKET_IDS (0x8B) { collectionId, bucket: uint, opIds: array<fixed32> }
  ```

  Telefon ve kutu kova özetlerini karşılaştırır. Farklı kovalar için `REC_BUCKET_IDS` değiş tokuş edilir, eksikler `REC_OPS` ile iki yönde gönderilir.
- **Kim budar:** Telefon, mezar listesine giren ya da kendi temizliğiyle silinen işlemler için kutuya `REC_PRUNE` gönderir:

  ```
  REC_PRUNE (0x89) { collectionId, opIds, by, sig }   // Ed25519(by, hash('hf/rec-prune/', familyId, collectionId, opIds)); by o koleksiyonun okuyucusu olan üye
  ```

  Böylece kutu ile telefonun kümeleri sürekli farklı kalmaz.

### 12.3 Çevrimdışı alıcı

- İşlemler kutuya `HOLD { forMemberId, fromMemberId, sealed }` ile bırakılır. Kutu yoksa Posta Kutusu'na zarf olarak gider.
- Posta Kutusu aile kotası (200 MB, 7 gün) bu işlemleri de kapsar.

## 13. Saklama ve temizlik

- **v1'de sıkıştırma yoktur.** Her cihaz koleksiyonun bütün işlemlerini tutar. Aile verisi küçük olduğu için bu kabul edilmiştir. Boyut sorun olursa sıkıştırma ayrı bir RFC ile gelir.
- **Silinen kaydın temizliği:**
  - **Eşik:** Bir kaydın `deletedAt` milisaniyesi, koleksiyondaki en büyük geçerli `hlc`'nin milisaniyesinden 1 yıl eskiyse kayıt temizlenebilir. Eşik yerel saate değil, koleksiyonun verisine bağlıdır.
  - **Ne silinir:** O kaydın `hlc < deletedAt.hlc` olan işlemleri. İki istisna: `del` işleminin kendisi ve kaydın türünü belirleyen işlem (§4.1) kalır.
  - Bundan sonra gelen ve `hlc < deletedAt.hlc` olan işlemler kaydedilmez, mezar listesine girer.
  - Silinen işlemler kutudan da `REC_PRUNE` ile budanır.
- Türü belirleyen işlem hiç silinmediği için kaydın türü temizlikten önce ve sonra aynıdır.
- **Süreli kayıtlar (`_keep`):** Süresi dolunca, türü belirleyen işlem dahil bütün işlemleriyle silinir; `recordId` mezar listesine girer. Eşik koleksiyonun verisine bağlıdır (RFC-0006 §14). Süresiz kayıtlar için yukarıdaki kural aynen kalır.

## 14. Çoklu topluluk

- Bir telefon 3 topluluğa üye olabilir. Her topluluğun kayıt verisi ayrı klasörde durur: `hat/families/<familyId hex>/kayit/`.
- Koleksiyonlar, kimlikler ve anahtarlar topluluğa özeldir. Topluluklar arası kayıt taşınmaz.

## 15. Misafirin kuralları

Misafirin tam defteri yoktur (RFC-0003 §7). Bu yüzden misafir daha basit bir kural kümesiyle çalışır:

- **İşlem:** Yazarı, `GUEST_VIEW.peers` içinde `writerOf` listesinde o koleksiyon bulunan bir üye olan işlemi kabul eder.
- **Anahtar:** Yalnız `peers` içindeki bir ebeveynin imzaladığı anahtarı (`keyEntry`) kabul eder. Misafirli koleksiyonlarda anahtarı zaten yalnız ebeveyn üretir (§9.2). Dönemleri görünümdeki `epochs` listesinden alır.
- **Üyeler misafire** yalnız kendi geçerli kümelerindeki işlemleri gönderir; hariç tutulan ya da bekleyen işlemleri göndermez.
- **Kesim:** Kesim uygulamaz. Yazar çıkarılınca güncel görünümde artık bulunmaz; misafir de o yazarın yeni işlemlerini kabul etmez.
- Misafirin kopyası üyelerinkinden geri kalabilir. Misafir yalnız okur: `grant:` hiçbir koleksiyonun `writers` listesinde bulunamaz (RFC-0003 §5.9). İzinli koleksiyona yalnız bırakabilir (RFC-0030).

## 16. SDK yüzeyi

```ts
interface Kayit {
  collections(): Promise<CollectionInfo[]>
  get(collectionId, recordId): Promise<Record | null>
  query(collectionId, { type?, where?, limit? }): Promise<Record[]>
  put(collectionId, recordId | null, type, fields): Promise<RecordId>
  del(collectionId, recordId): Promise<void>
  attach(file: { path | bytes, mime, name }): Promise<BlobRef>
  open(blobRef): Promise<{ path }>
  on('change', (collectionId, recordIds[]) => void)
}
```

Yuva Hat çekirdek komutlarında (`packages/protocol/komutlar.js`, K9) 240–249 aralığı ayrılır.

## 17. Test vektörleri

`protocol/vectors/record.json`:

1. Sabit anahtar ve nonce ile `REC_OP`: kodlama, `opId`, imza.
2. Aynı işlem kümesinin üç farklı sırada uygulanması → aynı durum.
3. Eşit `hlc` ve aynı yazar → `opId` sırası belirler.
4. Kesim: listede olmayan geriye dönük işlem hariç tutulur. İkinci bir okuyucunun kesimi onu içeriyorsa birleşimle geri gelir. İki cihaz farklı sırayla alsa da aynı sonuca varır.
5. Kesim kapsamı: yeniden yetki alan cihazın sonraki işlemleri etkilenmez.
6. Çıkarılan okuyucunun ürettiği anahtar → geçersiz (dönem anında okuyucu değil).
7. İki geçerli anahtar → ikisiyle yazılmış işlemler de açılır.
8. `history: false` ile katılan okuyucu, katıldığı dönemden önceki işlemleri açamaz.
9. Silme ve geri getirme; bir yıl sonraki temizlik.
10. Dosya: `blobId` ve AD.
11. `append-event`: geçerli; yanlış `recordId` → red; cihazın `put` denemesi → red.
12. `toBuf(BigInt)` → 8 bayt büyük sonlu.
13. Yazar listesinden düşürülüp okuyucu kalan üye kendi kesimini yayımlar → kesim atılır.
14. Yetkisi bitmeyen bir yazar için sahte kesim (PREKEY olayına) → atılır.
15. Bitiş olayının `ts` değerinden 2 gün ileri `hlc` → listede olsa bile hariç.

Her vektör telefonda (Bare) ve düğümde (Node 24) aynı sonucu vermek zorundadır.

## 18. Güvenlik değerlendirmesi

| Tehdit | Önlem |
|--------|-------|
| Kutu içeriği ya da yazarı görmek ister | Yazar, saat ve içerik şifreli metnin içinde |
| Kutu kendiliğinden işlem atar | Kutu silmez; yalnız okuyucunun imzalı isteğiyle siler |
| Kutunun diski sahte işlemlerle doldurulur | Yalnız okuyucu ve yazar oturumlarından kabul; gönderici kotası |
| Yetkisi biten yazar geçmişe yazar | Okuyucuların imzalı kesimleri; yeni dönem anahtarını bilmez |
| Çıkarılan okuyucu yeni dönem için kendi anahtarını yayar | Anahtar imzalıdır; üreten, dönem anında okuyucu olmalıdır |
| Saati ileri kurulu cihaz | İleri saat sınırı |
| Çocuk ebeveyn koleksiyonuna yazar | Yetki aralığı tablosu |
| Ebeveyn kişisel koleksiyonu okumak ister | `COLLECTION` kuralı (RFC-0003 §5.9) |
| Ele geçirilmiş kamera sahte olay yazar | Yalnız yeni olay ekler; cihaz çıkarılınca kesim |
| Başkasının dosyasını silmek | `BLOB_DEL` imzalı; yalnız yükleyen ya da ebeveyn |

**Bilinen sınırlar:**

- İleri gizlilik dönem düzeyindedir.
- Kesimin sınırları §8.4'te.
- Sıkıştırma yoktur.
- XChaCha20-Poly1305 anahtara bağlayıcı (key-committing) değildir. Bu yüzden `keyId` anahtarın tam özetidir ve her anahtar imzalıdır (§9.2).

## 19. Kurucu belgede değişecekler

- **§7.2:** Sıkıştırma ilk sürümde yoktur. Silinen kaydın temizliği §13'teki gibidir.
- **§7.5:**
  - Tel biçimi §4.3'teki gibidir. Önce şifre çözülür, sonra imza doğrulanır.
  - Anahtarı tek bir "ilk imzacı" değil, dönem anında okuyucu olan herhangi bir üye imzalı olarak üretir.
  - Kesim herhangi bir okuyucu tarafından yayımlanır ve birleşim olarak uygulanır.
  - `ROTATE_DEVICE` dönem değişimine yalnız eski cihaz imzalamadıysa yol açar.
  - `history: false` koleksiyona okuyucu eklenince yeni dönem başlar.
- **§7.7:** `dropKey`, okuyucu çıkınca yenilenir. `grant:` yazar olamaz.
- **§7.2:** Eşitlikte bayt sırasıyla **büyük** yazar kazanır (kurucu belgede "küçük" yazıyordu). Üçüncü ölçüt `opId`'dir.
- **§7.4:** Kesim `REC_KEY` içinde değil, ayrı `REC_CUTOFF` mesajıyla taşınır.
- **§7.6:** `BLOB_DEL` imzalıdır; yalnız yükleyen ya da bir ebeveyn silebilir.

## 20. Uygulama sırası

1. `kdf.js`'e BigInt dalı; `@havenfold/records`: kodlama, birleştirme, HLC, yetki aralığı tablosu; vektörler 1–3, 12.
2. Dönem anahtarları, `REC_KEY`, `REC_KEY_REQ`, kesim; vektörler 4–8.
3. Eşitleme: okuyucular arası ve kutu.
4. Dosyalar; vektör 10.
5. `append-event`; vektör 11. Silme temizliği; vektör 9.
6. Misafir kuralları.
7. SDK ve Yuva Hat komutları (Faz 2, taşıma aşaması B).

## Ek (RFC-0016, 23 Ekim 2026)

- §4.1: Ayrılmış alanların tam listesi RFC-0015 §2'ye bağlandı; `_src` liste, `_conf` 0–100.
- §11.2: Konteyner uygulamalarının yedek dosyalarında 90 günlük silme beklemesi yok (RFC-0011).
- §13: Süreli kayıtlar (`_keep`) süresi dolunca bütün işlemleriyle silinir (RFC-0006 §14).
