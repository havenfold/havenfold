# RFC-0013 — Yapay zeka katmanı: yerel modeller, yönlendirme ve @asistan

> Durum: **Onaylandı** (Kerem, 23 Ekim 2026) · 23 Ekim 2026 · Yazan: Havenfold çekirdek ekibi · Onay: Kerem
> Kurucu belge: §3 (ilke 4, 5, 6, 8, 10; H4, H7), §7.6 (kişisel koleksiyon), §8.4 (ilk kullanım onayı), §8.7 (görev türleri), §9.4 (imzalı sürüm), §15.2 (Yuva Defteri, yapay zeka satırı, çocuk ve ergen), §16.1 (AB Yapay Zekâ Yasası md. 50), §16.2 (mağaza kuralları), §16.3 (yapay zeka kuralları).
> Bağımlılık: RFC-0001 (kayıt, `_src`, `_conf`, dönem anahtarları), RFC-0002 (`hf.task.llm`, `hf.task.transcribe`, `hf.task.ocr`, yerleştirme, ilk kullanım onayı), RFC-0003 (roller, `TASK_PERMIT`, `SHARE_CONSENT`, HELLO yetenek bitleri), RFC-0004 (Arşiv katmanı), RFC-0006 (süreli kayıt, `_t`, `_keep`), RFC-0014 (dışa aktarmada yapay zeka işareti), RFC-0015 (ayrılmış alanların türleri). Araştırma: `arastirma/3-aile-asistani.md`.
> Kod yeri: `havenfold/core/yz` (`@havenfold/ai`), `havenfold/images/task-llm`, `task-transcribe`, `task-embed`, Türkçe kabul testi `havenfold/protocol/ai-kabul/tr/`.

## 1. Sorun

Yuva Defteri'nin asistanı ve ileride Mekan'ın asistanı aynı soruları çözmek zorunda:

- Hangi model nerede çalışır? Telefonların çoğunda yerel model yoktur. Türkçe desteği belirsizdir.
- Aile verisi hangi koşulda telefondan çıkar, hangi koşulda asla çıkmaz?
- Sohbetteki asistan çağrısı başkalarına ne gösterir?
- Yapay zekanın çıkardığı bilgi nasıl, kimin onayıyla kayda dönüşür?
- Arama dizini, okuma yetkisi olmayan bir cihazda aile verisini sızdırmamalıdır (araştırma §3.4).
- Mesajlardan ve belgelerden gelen metin asistana talimat veremez olmalıdır.
- Çocuğa "arkadaş" kişiliği taklit edilmemeli, kriz anında doğru yere yönlendirilmelidir.
- Mağaza telefona uzaktan kod indirmeyi yasaklar. Model dosyaları nasıl gelir?

Her ürün bunları ayrı çözerse kurucu §16.3'teki kurallar ürün ürün farklı yorumlanır.

## 2. Öneri özeti

- **Model yeri:** Telefonda yalnız işletim sisteminin cihaz içi modeli (Apple Foundation Models, Gemini Nano) ve yalnız **Türkçe kabul testini** geçtiyse. Yoksa kural tabanlı çıkarma. Evdeki işçide llama.cpp ve whisper.cpp görev imajları. Kutuda yapay zeka yoktur.
- **Yönlendirme:** Kasa verisi yalnız telefonda. Aile verisi telefonda ya da evdeki işçide, **asla bulutta**. Aile verisi içermeyen genel soru, kullanıcı "Dışarı sor" derse, kimliksiz olarak bulut geçidine. Hassas ağır iş için gizli bulut yalnız Faz 4.
- **@asistan:** Çağrı yereldir; soru sohbete gitmez. Cevap yalnız soranın ekranında görünür. Paylaşmak isterse `[YZ]` işaretli bir mesajla kendisi gönderir.
- **Çıkarma:** Şema uygulamanın içindedir. Her alanın güveni belirlenimci kurallarla hesaplanır. **Kullanıcı onayı olmadan hiçbir şey kaydedilmez.** Kayıt kaynağına `_src` ile bağlanır.
- **Arama:** Her cihaz yalnız okuyabildiği koleksiyonları dizinler. Gömme dizini koleksiyon anahtarından türetilen anahtarla şifrelidir. Okuyuculuk bitince dizin hemen silinir.
- **Model veridir:** Ağırlıklar Eser'in kök anahtarıyla imzalı bir model bildiriminden indirilir. Kod, istem şablonu, şema ve araç listesi asla indirilmez.
- **Telemetri yoktur.** Hiçbir istem, cevap ya da günlük cihazdan Eser'e gitmez.
- **Çocuk modu:** kişilik yok, etkileşimi uzatan mekanik yok, bulut yok, krizde sabit yönlendirme.

Yeni kriptografik algoritma yoktur (H7). Kullanılan her şey kurucu §13.2'dedir.

## 3. Tanımlar ve kodlama kuralları

| Ad | Anlam |
|----|-------|
| **Platform modeli** | İşletim sisteminin sağladığı cihaz içi dil modeli: iOS'ta Apple Foundation Models (`SystemLanguageModel`), Android'de Gemini Nano (ML Kit GenAI Prompt API). |
| **İşçi modeli** | Evdeki işçide görev imajının çalıştırdığı açık ağırlıklı model. |
| **Gömme modeli** | Metni vektöre çeviren küçük model. Telefonda ve işçide aynı dosya. |
| **Kural tabanlı motor** | Model kullanmayan, belirlenimci Türkçe çözücüler (tarih, saat, telefon, IBAN, tutar…). |
| **Yol** | Bir işin nerede yapıldığı: `telefon`, `isci`, `kural`, `disari`. |
| **Veri sınıfı** | `kasa`, `aile`, `genel` (§6.1). |
| **Asistan** | Çekirdekte ürün adından bağımsız ad: `@asistan`. Yuva'da arayüzde `@Yuva` olarak görünür. |
| **Bildirim** | Bu RFC'de "model bildirimi": imzalı model listesi (§15.2). |

**Kodlama:** RFC-0001 §3'teki kurallar aynen geçerlidir. İmzalı zarflarda RFC-0002 §3'teki düzen kullanılır. Değişken uzunlukta metin bir özete doğrudan girmez; RFC-0006 §3'teki kural uygulanır.

**Türkçe normalleştirme `N(s)`** (bu RFC'nin her metin karşılaştırmasında):

1. Unicode NFKC.
2. Türkçe küçük harf: `I → ı`, `İ → i`, sonra diğer harfler küçülür.
3. Birleşen nokta (U+0307) silinir.
4. Tırnak ve kesme işaretleri (`' ’ " “ ”`) silinir.
5. Her boşluk dizisi tek boşluk olur; baş ve sondaki boşluk silinir.

**Token tahmini:** `tahmini_token = ceil(UTF-8 bayt / 3)`. Bütün sınırlar bu tahminle hesaplanır, böylece her cihaz aynı kararı verir.

## 4. Çalışma ortamları

### 4.1 Ortam tablosu

| Yer | Dil modeli | Konuşmayı yazıya dökme | OCR | Gömme |
|-----|------------|------------------------|-----|-------|
| iPhone, iPad | Apple Foundation Models; yalnız cihaz içi `SystemLanguageModel` ve yalnız Türkçe onaylıysa (§5.2) | iOS Speech, **yalnız** `requiresOnDeviceRecognition = true` ve `tr-TR` cihaz içinde destekleniyorsa | Vision | Uygulamanın içindeki llama.cpp + indirilen gömme modeli |
| Android telefon | Gemini Nano (ML Kit GenAI Prompt API); yalnız Türkçe onaylıysa | **Yalnız** `SpeechRecognizer.createOnDeviceSpeechRecognizer` (API 31+) ve `tr-TR` destekliyse | ML Kit metin tanıma (cihaz içi, Latin) | Aynı |
| Linux işçi | llama.cpp (`hf.task.llm`) | whisper.cpp (`hf.task.transcribe`) | `hf.task.ocr` | llama.cpp (`hf.task.embed`) |
| Kutu | Yok | Yok | Yok | Yok |
| Misafir telefonu | Telefonla aynı koşullar | Aynı | Aynı | Aynı, yalnız kendi koleksiyonları |

**Sunucu tabanlı tanıma yasaktır.** iOS'un ve Android'in varsayılan konuşma tanıması sesi üreticinin sunucusuna gönderebilir. Bu, kurucu §16.3 kural 1'i çiğner. Cihaz içi tanıma yoksa ses telefonda yazıya dökülmez; evde işçi varsa `hf.task.transcribe` kullanılır, yoksa "Bu telefonda ses yazıya dökülemiyor" denir.

**Platform modelinin sunucu uzantısı yasaktır.** Platform modelinin bulutta çalışan bir türü üçüncü taraf uygulamalara açılsa bile Faz 4'e kadar kullanılmaz (§16.3).

### 4.2 Telefonda neden açık ağırlıklı dil modeli yok

Kurucu §15.2 "desteklemeyen telefonda kural tabanlı çıkarma" der. Bu RFC bunu korur:

- 1–3 milyar parametreli bir modelin indirilmesi 1–2 GB tutar; orta segment telefonda ısınma ve pil sorunu yaratır (araştırma §3.1).
- Telefonda dil modeli yalnız işletim sisteminin verdiği modeldir. Uygulama telefona yalnız **gömme modeli** indirir (§15.5). Gömme modeli metin üretmez; yalnız arama için vektör çıkarır.

### 4.3 İşçi görev sözleşmeleri

RFC-0002 §5'teki türlerin bu RFC'deki ayrıntısı (`images/<tür>/CONTRACT.md`):

| Tür | Sürüm | Girdi | Parametre | Çıktı | Bölünür |
|-----|-------|-------|-----------|-------|---------|
| `hf.task.llm` | 1.0.0 | Tek metin dosyası, JSON: `{ sistem, veri: [metin], soru }`, ≤ 32 KB | `{ is: 'ozet' \| 'alan-cikar' \| 'cevap', model: <modelId>, sema?: <JSON>, enCokToken: ≤ 1024 }` | Metin ya da şemaya uyan JSON | Hayır |
| `hf.task.transcribe` | 1.1.0 | Ses | `{ lang: 'tr', model: <modelId> ya da takma ad 'small' \| 'medium' }` | Metin + zaman damgaları (JSON) | Dakika |
| `hf.task.embed` | 1.0.0 (yeni) | Metin parçaları, JSON dizi, ≤ 32 KB | `{ model: <modelHash hex>, rol: 'parca' \| 'sorgu' }` | int8 vektörler (≤ 32 KB `inline`, fazlası dosya) | Parça |

- **Çözme:** `hf.task.llm` açgözlü çözme kullanır (sıcaklık 0, tohum 0). `alan-cikar` işinde çıktı, şemadan üretilen dilbilgisiyle (llama.cpp GBNF) sınırlanır.
- **İstem biçimi:** İmaj, modelin `istemBicimi` alanındaki yerleşik biçimleyiciyi kullanır (§15.1). Model dosyasının içindeki sohbet şablonu (GGUF `tokenizer.chat_template`) okunmaz ve çalıştırılmaz.
- **Veri çerçevesi:** `veri` öğeleri, imaj tarafından §10'daki sınır işaretleriyle sarılır.
- `hf.task.embed` Faz 2'de eklenir; ilk dizinleme gibi toplu işler için telefonun pilini korur. İşçi vektörleri döner, hiçbir şey saklamaz.
- Takma ad `small`/`medium`, bildirimdeki `kind = 'ses'` modellerinden `takma` alanı bu değere eşit ve `tr = true` olanıdır (RFC-0002 ile geriye uyum).

## 5. Yetenek tespiti ve geri düşme

### 5.1 Yetenek özeti

Telefon kendi yeteneğini ve evdeki işçilerinkini tek bir yerel yapıda tutar. Bu yapı tele çıkmaz.

```
YzYetenek {
  platform : null | { id: 'apple-fm' | 'gemini-nano', surum: string, tr: bool, baglamToken: uint }
  konusma  : bool                    // cihaz içi tr-TR tanıma var
  ocr      : bool
  gomme    : null | { modelHash, esik }
  isciler  : array<{ deviceId, modeller: array<{ modelHash, kullanilir: bool }>, maxTaskRamMB, onay: bool }>
  bulut    : { acik: bool, kalan: uint }
}
```

| Alan | Nereden |
|------|---------|
| `platform.tr` | İşletim sistemi `tr` dilini destekliyor diyor **ve** model bildiriminde o platform ve sürüm için `tr = true` yazıyor |
| `baglamToken` | Apple Foundation Models için 4096. Gemini Nano için bildirimdeki değer. |
| `isciler` | `NODE_CAPS` (RFC-0002 §4), `YZ_MODEL_VAR` (§15.4) ve üyenin ilk kullanım onayı (RFC-0002 §7) |
| `bulut.acik` | Yuva Aile paketi var, rol `ebeveyn` ya da `yetiskin`, ayarda açık |

### 5.2 Türkçe kabul testi

- Test kümesi açıktır: `havenfold/protocol/ai-kabul/tr/` (CC BY 4.0). En az 200 madde: alan çıkarma, kısa cevap, kaynak gösterme, Türkçe dışına kaçma.
- Eser her platform modeli sürümünü ve her işçi modelini bu testten geçirir. Sonuç model bildirimine `tr` olarak yazılır.
- **Geçme ölçütü (varsayılan, değiştirilebilir):**

  | Ölçü | Eşik |
  |------|------|
  | Alan çıkarmada alan doğruluğu | ≥ %90 |
  | Dayanak ihlali (kaynakta olmayan alıntı) | ≤ %2 |
  | Türkçe dışı cevap | ≤ %1 |
  | Kaynaklı sorularda kaynak gösterme | ≥ %95 |

- **Bugünkü durum:** Uygulamanın içinde gelen bildirimde Apple Foundation Models ve Gemini Nano için `tr = false` yazar. Test geçince imzalı yeni bildirimle `true` olur. Bu bir özellik kodu değildir; var olan yolun açılıp kapanmasıdır (§15.1).

### 5.3 Uygun işçi

Bir işçi, bir iş için şu koşulların hepsi sağlanınca uygundur:

1. RFC-0002 §8 madde 1'deki aday koşulları (son 15 dakikada bildirim, `status = 'hazir'`, tür ve sürüm).
2. İşin modeli işçide var ve `kullanilir = true`; modelin `ramMB ≤ maxTaskRamMB`.
3. Üyenin bu işçi için ilk kullanım onayı var.
4. İsteyen bu türü verebilir (`TASK_PERMIT`, RFC-0003 §5.11). Çocuk varsayılan olarak veremez.
5. İşin koleksiyonunda `taskAccess = true` ve `sensitivity ≠ 'kasa'` (§6.3).

Uygun işçiler arasından seçim RFC-0002 §8'deki sıralamayla yapılır.

### 5.4 Seçim işlevi

`yol(is, sinif, girdi)`. `is ∈ { cikar, cevap, ozet, yaziya, gom, ara }`. İlk uyan satır geçerlidir:

| # | Koşul | Yol |
|---|-------|-----|
| 1 | `sinif = kasa` ve `is ∈ {cikar, cevap, ozet}` ve `platform.tr` ve `tahmini_token ≤ 2800` | telefon |
| 2 | `sinif = kasa` ve `is = cikar` | kural |
| 3 | `sinif = kasa` ve `is ∈ {ara, gom}` | telefon (kasa açıkken) |
| 4 | `sinif = kasa` ve `is = yaziya` ve `konusma` | telefon |
| 5 | `sinif = kasa` | yapılamıyor |
| 6 | `is = ara` | telefon (anlamsal + anahtar kelime; gömme modeli yoksa yalnız anahtar kelime) |
| 7 | `is = yaziya` ve `konusma` ve süre ≤ 2 dakika | telefon |
| 8 | `is = gom` ve gömme modeli var ve parça sayısı ≤ 200 | telefon |
| 9 | `is ∈ {cikar, cevap, ozet}` ve `platform.tr` ve `tahmini_token ≤ 2800` | telefon |
| 10 | Uygun işçi var (§5.3) | işçi |
| 11 | `is = cikar` | kural |
| 12 | Diğer | yapılamıyor: "Bu iş için evde uygun cihaz yok." |

- 2800 token sınırı, Apple Foundation Models'in 4096 tokenlık toplam bağlamından istem ve cevaba pay bırakır. Gemini Nano'da bildirimdeki `baglamToken − 1296` kullanılır.
- **Uzun özet:** Girdi 24 KB'tan büyükse telefon onu 24 KB'lık parçalara böler, her parçayı ayrı `hf.task.llm` ile özetletir, sonra özetleri bir kez daha özetletir. Bu yalnız işçi yolunda yapılır.
- **Bulut hiçbir zaman bu tabloda yoktur.** Bulut otomatik bir geri düşme değildir; yalnız kullanıcının açık "Dışarı sor" dokunuşuyla ve yalnız `genel` sınıfta açılır (§6.4).

## 6. Yönlendirme kuralları

### 6.1 Veri sınıfları

| Sınıf | Ne |
|-------|----|
| `kasa` | Bir `kasa` koleksiyonundan gelen her içerik |
| `aile` | Topluluğun her verisi: kayıtlar, dosyalar, mesajlar, defterdeki adlar, görev çıktıları, olaylar. Ayrıca engel süzgecine takılan her metin (§6.5). |
| `genel` | Kullanıcının o anda yazdığı metin. Hiçbir mesaja, kayda ya da dosyaya bağlı değil, yanıt bağlamı yok, arama sonucu eklenmemiş, engel süzgecinden geçmiş. |

Bir işte birden çok sınıf varsa en sıkısı geçerlidir: `kasa > aile > genel`.

### 6.2 Kural tablosu

| Sınıf | Telefon | Evdeki işçi | Bulut |
|-------|---------|-------------|-------|
| `kasa` | ✓ | ✗ (RFC-0002 §6.2 madde 4) | ✗ |
| `aile` | ✓ | ✓ (§5.3) | ✗ **asla** |
| `genel` | ✓ | ✓ | Yalnız "Dışarı sor" ile, §6.4 |
| Hassas ağır iş | — | — | Faz 4: yalnız gizli bulut, ebeveynin önceden rızası (§16.3) |

Bu tablo kurucu §16.3 kural 1–3'ün uygulamasıdır.

### 6.3 Görevin koleksiyonu

İşçiye giden her görevin `collectionId` alanı vardır (RFC-0002 §6.1). Asistan şöyle doldurur:

- İşçi istemine yalnız `taskAccess = true` ve `kasa` olmayan koleksiyonlardan gelen parçalar girer. Diğer koleksiyonların parçaları istemden çıkarılır ve cevapta "Bazı kaynaklar evdeki cihaza gönderilmedi" yazar.
- `collectionId`, istemdeki parçaların koleksiyonları arasında okuyucusu en az olandır; eşitlikte bayt sırasıyla küçük olan.
- Hiç kaynak parça yoksa (yalnız soru) `collectionId` sorunun sahibinin Kişisel koleksiyonudur. Kişisel koleksiyonda `taskAccess` varsayılan olarak kapalıdır (kurucu §7.7). Üye "Sorularım evdeki cihaza gidebilir" anahtarını açmadıkça soru işçiye gitmez. Böylece ergenin özel sorusu kendiliğinden işçiye gitmez.
- İşçi yalnız `collectionId`'yi denetleyebilir. Diğer koleksiyonların denetimi isteyen telefondadır (RFC-0002 §6.1 dürüst sınır).

### 6.4 "Dışarı sor" akışı

1. Asistan bir `genel` soruya cihazda ya da evde cevap verir ve altında "Dışarı sor" düğmesini gösterir. Düğme yalnız `bulut.acik` ise ve soru engel süzgecinden geçtiyse görünür.
2. Kullanıcı dokununca telefon **gidecek metnin tamamını** gösterir: "Dışarı soruluyor: <metin>". Metin, kullanıcının yazdığı metnin kendisidir. Model onu yeniden yazamaz, ona arama sonucu ya da sohbet bağlamı ekleyemez.
3. Kullanıcı onaylarsa metin geçide gider (§16.1). Ekranda "Dışarı soruluyor" etiketi görünür.
4. Gelen cevap "Dışarıdan · genel bilgi" etiketiyle gösterilir. Kendiliğinden kaydedilmez. Aile kaynaklı bir cevapla aynı balonda birleştirilmez.

### 6.5 Engel süzgeci

Belirlenimcidir. `N(metin)` üzerinde çalışır. Biri eşleşirse metin `aile` sınıfına geçer ve dışarı gidemez. Kullanıcı metni düzeltebilir; süzgeci geçersiz kılma düğmesi yoktur.

| # | Eşleşme |
|---|---------|
| 1 | Defterdeki üye ve misafir adları; varlık, yer, koleksiyon adları; okuyabildiği kartların adları. Her ad `N` ile normalleştirilir; 3 harften kısa parçalar atlanır; tam kelime eşleşmesi. |
| 2 | Türkiye telefon numarası: isteğe bağlı `+90` ya da `0`, ardından 10 rakam (boşluk ve tire yok sayılır) |
| 3 | E-posta adresi |
| 4 | T.C. kimlik numarası: 11 rakam, ilki 0 değil, iki denetim hanesi tutuyor |
| 5 | IBAN: `TR` + 24 rakam, mod 97 = 1 |
| 6 | Kart numarası: 13–19 rakam, Luhn tutuyor |
| 7 | Adres işareti: `mah`, `mahallesi`, `sok`, `sokak`, `cad`, `caddesi`, `bulvarı`, `apt`, `daire`, `no:` ve ardından rakam |
| 8 | Araç plakası: 2 rakam + 1–3 harf + 2–4 rakam |
| 9 | 1 KB'tan uzun metin |

## 7. @asistan çağrısı

### 7.1 Ad ve tetik

- Çekirdekteki ad `asistan`'dır. Ürün derleme sırasında bir takma ad verir: Yuva `yuva` (arayüzde `@Yuva`), Mekan ürünleri kendi adını verir.
- **Tetik:** Mesaj yazma kutusundaki metin, baştaki boşluklar atıldıktan sonra `@` + ad ile başlıyor ve ardından boşluk, `:`, `,` ya da metin sonu geliyorsa. Karşılaştırma `N` ile yapılır. `@asistanlar` tetiklemez; `@ASİSTAN` tetikler.
- Diğer yollar: bir mesaja uzun basıp "Asistana sor" (o mesaj bağlam olur), Defter sekmesindeki arama kutusu. Üçü aynı akıştan geçer.

### 7.2 Çağrı yereldir

- Tetikleyen metin **sohbete gönderilmez**. Hiçbir üyeye zarf gitmez.
- Soru ve cevap, soranın ekranında "Yalnız sen görüyorsun" balonuyla görünür.
- Neden: Cevap, soranın okuyabildiği koleksiyonlardan üretilir. Sohbetteki herkes aynı koleksiyonları okuyamaz. Cevabı herkese otomatik göstermek, çocuğun Ebeveynler koleksiyonunu sohbet üzerinden okuması demek olurdu.

### 7.3 Bağlam

Asistanın kullanabileceği bağlam yalnız şudur:

1. Tetikleyen metin (≤ 2 KB).
2. "Asistana sor" ile seçilmiş **tek** mesaj ve kullanıcı isterse onun ekinin metni.
3. Arama sonuçları (§9).

Sohbetin geri kalanı, başka sohbetler ve bildirimler bağlama girmez. Asistan mesajları sürekli işlemez (kurucu §16.3 kural 6).

### 7.4 Cevap

```
Cevap {
  metin      : string
  kaynaklar  : array<string>       // _src biçimi (§8.5)
  yol        : 'telefon' | 'isci' | 'kural' | 'disari'
  model      : string              // _aiyol biçimi (§8.5)
  sinif      : 'kasa' | 'aile' | 'genel'
  kaynaksiz  : bool
}
```

- **Kaynak zorunluluğu (kurucu §16.3 kural 5):** Ailenin bilgisiyle ilgili her cevap kaynaklarını gösterir: "Bunu Defter › Ev › Kombi kaydından biliyorum."
- **Kaynaksız cevap:** Arama dayanaklı sonuç bulamazsa (§9.4) cevap "genel bilgi, kaynaksız" etiketiyle gelir. Bu cevapta defterdeki herhangi bir ad (§6.5 madde 1) geçiyorsa cevap atılır ve yerine "Defterde bununla ilgili bir kayıt bulamadım." yazılır. Böylece model aile hakkında bilgi uyduramaz.
- Her cevabın altında yol etiketi vardır: "Yapay zeka · cihazda", "· evdeki cihazda", "· kural", "· dışarıdan".
- Eylemler: **Sohbete gönder**, **Deftere kaydet** (§8), **Kapat**. Hiçbir eylem kendiliğinden yapılmaz.

### 7.5 Sohbete gönderme

- Cevap, soranın adıyla normal bir metin mesajı (`TEXT`, K2) olarak gider. Gönderen insandır ve sorumluluk onundur.
- **Gövde biçimi:**

  ```
  [YZ] <yol etiketi>
  <cevap metni>
  Kaynak: <kaynak adları, '; ' ile>        (kaynak yoksa bu satır yok)
  ```

  `<yol etiketi>`: `cihazda`, `evde`, `kural`, `dışarıdan`. Bu RFC'yi bilen uygulama `[YZ]` satırını "Yapay zeka" rozeti olarak çizer. Bilmeyen uygulama satırı olduğu gibi gösterir; açıklama yine görünür.
- **Kitle denetimi:** Telefon, cevabın kaynak koleksiyonlarının okuyucusu olmayan sohbet katılımcılarını bulur. Varsa: "Bu bilgi Ebeveynler'den geliyor. Can bunu göremiyordu. Yine de gönderilsin mi?" Kullanıcı onaylarsa gider. Ürün bu durumda gönderimi tümden kapatabilir; gevşetemez (Yuva Defteri böyle yapar: 02 §6).
- **Kasa:** Kaynaklarından biri kasa koleksiyonu olan cevap uygulama içinden sohbete gönderilemez. Kasa verisinin paylaşımı bilinçli ve elle olmalıdır.

### 7.6 Geçmiş

- Ayar "Asistan geçmişini sakla" açıksa her soru ve cevap, soranın **Kişisel** koleksiyonuna `hf.ai.konusma` kaydı olarak yazılır: `{ _t, soru, cevap, kaynaklar, yol, _aiyol, _keep }`.
- Varsayılan `_keep` 30 gündür (RFC-0006 §14). Ayarda kapalı (hiç yazma), 7, 30, 365 seçilebilir. Seçim yazma anında `_keep`'e girer; sonradan değişen ayar eski kayıtları etkilemez.
- Kişisel koleksiyonu yalnız sahibi okur; ebeveyn dahil kimse kendini ekleyemez (kurucu §7.6). Ergenin asistanla özel konuşmasının teknik güvencesi budur.
- Misafir yazamadığı için misafirin geçmişi yalnız telefonun belleğinde, oturum boyunca durur.
- Kriz akışı (§12) geçmişe yazılmaz.

### 7.7 Sohbetten Plana

Sohbetteki tarih ve saat ifadelerinden öneri kartı çıkarmak (kurucu §15.2 v0) şu sınırlarla yapılır:

- Önce kural tabanlı ön süzgeç çalışır: tarih, saat, gün adı, "yarın", "haftaya" gibi ifadeler.
- Model yalnız süzgece takılan mesajda ve mesaj ekranda gösterilirken çağrılır. Telefon başına saatte en çok 20 çağrı.
- Öneri kartı yalnız o telefonda görünür.
- Kabul edilince kayıt, kaynak mesaja `_src` ile bağlanır. Aynı mesajdan aynı şemayla daha önce kayıt yazılmışsa kart "Zaten eklendi" der ve var olan kaydı açar. Eşzamanlı iki kayıt olursa ürün, türü belirleyen işlemi küçük olanı asıl sayar.

## 8. Yapılandırılmış çıkarma sözleşmesi

### 8.1 Şema

Şemalar uygulamanın içinde gelir. İndirilmez.

```json
{
  "id": "yuva.defter.garanti",
  "v": 1,
  "hedef": "yuva.defter.garanti",
  "alanlar": [
    { "ad": "urun",    "tur": "metin", "zorunlu": true,  "dayanak": "alinti" },
    { "ad": "bitis",   "tur": "tarih", "zorunlu": true,  "dayanak": "alinti" },
    { "ad": "sure_ay", "tur": "sayi",  "zorunlu": false, "dayanak": "cikarim" }
  ]
}
```

| Alan türü | Kayıttaki değer (RFC-0001 §4.2) |
|-----------|---------------------------------|
| `metin` | string |
| `tarih` | string `YYYY-MM-DD` |
| `saat` | string `HH:MM` |
| `tutar` | int, kuruş; para birimi ayrı `metin` alanında |
| `sayi` | int |
| `telefon` | string, E.164 |
| `eposta` | string |
| `iban` | string, boşluksuz |
| `secim` | string, şemadaki listeden |
| `kisi` | string `uye:<hex16>`; yalnız defterdeki adlardan eşlenir |

`dayanak`: `alinti` değer kaynakta geçmelidir; `cikarim` değer kaynaktan hesaplanır (ör. "2 yıl garanti" + alış tarihi → bitiş).

### 8.2 Çıktı

```
Cikarim {
  sema    : string                 // 'yuva.defter.garanti@1'
  alanlar : array<{ ad, deger: Değer, conf: uint (0–100), aralik?: [bas, bit] }>
  kaynak  : array<string>          // _src
  model   : string                 // _aiyol
}
```

- Platform modelinde şemaya bağlı üretim (Apple'da `@Generable`, Gemini Nano'da JSON çıktısı), işçide dilbilgisiyle sınırlı üretim kullanılır.
- Çıktı her zaman denetlenir: şemada olmayan alan atılır; türüne göre çözülemeyen değer atılır.
- Kural tabanlı motor aynı `Cikarim` biçimini üretir.

### 8.3 Dayanak denetimi

| Alan türü | `alinti` denetimi |
|-----------|-------------------|
| `metin`, `secim` | `N(deger)`, `N(kaynak metin)` içinde geçer |
| `tarih` | Belirlenimci tarih çözücünün kaynak metinde bulduğu tarihlerden biridir |
| `saat` | Saat çözücünün bulduğu saatlerden biridir |
| `tutar`, `sayi`, `telefon`, `iban` | Değerin rakam dizisi, kaynaktaki rakam dizilerinden birine eşittir (boşluk, nokta, tire yok sayılır) |
| `eposta` | `N` ile birebir geçer |
| `kisi` | Kaynakta o kişinin defterdeki adı `N` ile geçer |

**Tarih çözücü** şu biçimleri tanır: `gg.aa.yyyy`, `gg/aa/yyyy`, `gg-aa-yyyy`, `yyyy-aa-gg`, `g Ay yyyy`. `Ay`: `ocak … aralık` ve üç harfli kısaltmalar (`oca, şub, mar, nis, may, haz, tem, ağu, eyl, eki, kas, ara`). İki haneli yıl tanınmaz. Göreli ifadeler ("yarın", "cuma") yalnız Sohbetten Plana'da ve kaynak mesajın `hlc` gününe göre `cikarim` olarak çözülür.

### 8.4 Güven

Model güven değeri vermez ya da verdiği değer cihazlar arasında karşılaştırılamaz. Bu yüzden güven belirlenimci kurallarla hesaplanır:

| Durum | `conf` |
|-------|--------|
| `alinti`, dayanak bulundu, model yolu | 85 |
| `alinti`, dayanak bulundu, kural yolu | 90 |
| `alinti`, kural yolu, denetim hanesi tutan (IBAN, T.C. kimlik, kart) | 95 |
| `alinti`, dayanak bulunamadı | 40 |
| `cikarim`, model yolu | 60 |
| `cikarim`, kural yolu | 70 |
| Model ve kural aynı değeri buldu | ikisinin büyüğü + 10, en çok 100 |

Güven yüzde tamsayıdır (`_conf`, 0–100, RFC-0015 §2.1). Onay ekranında `conf < 50` olan alan boş gelir; 50–79 olan sarı işaretlenir. Ürün bu eşikleri yalnız sıkılaştırabilir.

### 8.5 Onay ve kayıt

- **Kurucu §16.3 kural 4:** Yapay zekanın çıkardığı hiçbir bilgi onaysız kaydedilmez. Kayıt yalnız onay ekranındaki "Kaydet" dokunuşuyla yazılır. Arka planda, toplu ya da kendiliğinden kaydetme yoktur. Birden çok kayıt önerildiğinde her biri ayrı listelenir.
- SDK'da kaydetme çağrısı (`AI_SAVE`) yalnız onay ekranının ürettiği tek kullanımlık onay jetonuyla çalışır. Jeton, gösterilen alanların özetine bağlıdır. Ürün kodu ekransız kaydedemez.
- **Kayda yazılan çekirdek alanlar:**

  | Alan | Değer |
  |------|-------|
  | `_src` | Kaynak başvuruları (aşağıda) |
  | `_conf` | Kullanıcının değiştirmediği, modelden ya da kuraldan gelen alanların `conf` değerlerinin en küçüğü (0–100). Hepsi elle değiştirildiyse alan yazılmaz. |
  | `_ai` | Kullanıcının değiştirmeden onayladığı yapay zeka alanlarının adları (liste). Hepsi elle değiştirildiyse yazılmaz. |
  | `_aiyol` | Yol ve model: `telefon/apple-fm@<sürüm>`, `telefon/gemini-nano@<sürüm>`, `isci/<modelId>`, `kural/<sürüm>`, `disari/<model>` |

  Bu alanların türleri RFC-0015 §2.1'dedir.

- **`_src` biçimi** (RFC-0001 §4.1'de ayrılan alanın biçimi; RFC-0006 ve RFC-0015 de bunu kullanır). Değer bir listedir; en çok 16 öğe, her biri ≤ 200 bayt. `<hexN>`, N baytın küçük harf hex yazımıdır (RFC-0006 §4.3):

  | Biçim | Ne |
  |-------|----|
  | `msg:<convId hex32>/<msgId hex16>` | Sohbet mesajı (`convId` 32 bayt, `msgId` 16 bayt) |
  | `kayit:<collectionId hex16>/<recordId hex16>` | Kayıt |
  | `dosya:<blobId hex32>` (ek: `#s=<sayfa>` ya da `#t=<ms>`) | Dosya, sayfa ya da zaman |
  | `aktarma:<biçim>` | İçe aktarılan dosya; `<biçim>` ürünün içe aktarma biçim adıdır (ör. `bitwarden`, `keepass`, `1password`, `hfkap`) |

  Kaynağı açamayan okuyucu "Kaynak sende yok" görür. Başvuru yalnız rastgele kimlikleri taşır, içerik taşımaz.

### 8.6 Hedef koleksiyon

- Önerilen hedef, kullanıcının yazar olduğu ve kaynakların koleksiyonları arasında okuyucusu en az olandır. Kaynak bir mesajsa, sohbet katılımcılarının hepsini okuyucu olarak içeren en dar koleksiyondur.
- Kullanıcı daha geniş bir koleksiyon seçerse telefon yeni görecek kişileri listeler ve açık onay ister.
- Kaynaklarından biri kasa olan bilgi yalnız kasa koleksiyonuna kaydedilebilir.

## 9. Koleksiyonlar üzerinde arama

### 9.1 Dizin kapsamı

Bir cihaz bir koleksiyonu yalnız şu koşullar sağlanınca dizinler:

1. Cihazın kullanıcısı defterin şu anki başında o koleksiyonun okuyucusudur.
2. Koleksiyon `normal` duyarlılıktadır; ya da `kasa`'dır ve kasa o an açıktır. Kasa dizini Arşiv katmanında durur, kilitlenince bellekten atılır.
3. Kayıt türü `hf.ai.konusma` ya da `hf.ai.kupon` değildir. **Asistan kendi cevaplarından beslenmez**; yanlış bir cevap kendini güçlendirmez.

**Dizin yalnız telefondadır.** Kutu ve işçi koleksiyon anahtarı almaz, dizin tutmaz. `hf.task.embed` ile işçiye giden parçaların vektörleri telefona döner; işçi hiçbir şey saklamaz. Dizin yedeğe girmez, dışa aktarılmaz; gerekince yeniden kurulur.

### 9.2 Parçalama ve gömme

- Kayıt, tür tanımındaki alan sırasıyla "Ad: değer" satırlarına çevrilir.
- Uzun metin (OCR çıktısı, yazıya dökülmüş ses) 1200 karakterlik parçalara, 200 karakter örtüşmeyle, boşlukta kesilerek bölünür. Her parça kaynağını (`_src` biçiminde) taşır.
- Gömme modelinin bildirimdeki önekleri kullanılır (`onEkler`: sorgu ve parça öneki).
- Vektör birim uzunluğa getirilir, her bileşen `round(v × 127)` ile int8 olarak saklanır.
- Cihaz başına en çok 100 000 parça. Aşılırsa `hlc`'si en eski kayıtların parçaları gömme dizininden çıkar; anahtar kelime dizininde kalır.

### 9.3 Şifreli dizin

```
indexKey = derive(K, 'hf/ai-index/', collectionId)
AD       = hash('hf/ai-index-ad/', collectionId, keyId, u64be(blokNo), modelHash)
ct       = XChaCha20-Poly1305(indexKey, nonce (24 B, rastgele), blok, AD)
```

- `K`: cihazın o koleksiyonda yeni yazımda kullanacağı dönem anahtarı (RFC-0001 §9.2). `keyId` onun kimliğidir.
- Blok: 256 parçanın vektörleri ve başvuruları.
- Yeni dönem anahtarı gelince bloklar telefon şarjdayken yeni anahtarla yeniden şifrelenir. O zamana kadar eski anahtar kullanılır; cihaz onu zaten tutar.
- **Neden ayrıca şifreli:** Gömme dizini ayrı bir dosyada durur ve arama sırasında toplu açılır. Gömmeler metnin anlamını sızdırır. Koleksiyon anahtarına bağlanınca, anahtarı olmayan hiçbir süreç ya da kopya dizini okuyamaz.
- **Anahtar kelime dizini** (SQLite FTS5) kayıtların yerel durumuyla aynı katmanda ve aynı korumayla durur (Hat katmanı; kasa için Arşiv). Kayıt durumundan daha fazlasını içermez.

### 9.4 Arama

1. Sorgu `N` ile normalleştirilir.
2. Anahtar kelime: FTS5 BM25 ile ilk 50.
3. Anlamsal: sorgu vektörüyle iç çarpım, ilk 50.
4. Birleştirme: karşılıklı sıra birleşimi, `puan = Σ 1 / (60 + sıra)`. Eşitlikte `(collectionId, recordId)` bayt sırası.
5. İlk 8 parça bağlama girer. Bütçe: telefonda 2500, işçide 6000 tahmini token.
6. **Dayanaklı sonuç:** FTS'de en az bir anlamlı kelimesi eşleşen ya da iç çarpımı modelin bildirimdeki `esik` değerini aşan parça. Dayanaklı sonuç yoksa cevap kaynaksızdır (§7.4).

Gömme modeli inmemişse yalnız 2. adım çalışır. Arama her zaman çalışır.

### 9.5 Dizinin silinmesi

| Olay | Ne olur |
|------|---------|
| Kullanıcı bir koleksiyonun okuyucusu olmaktan çıkar (`REMOVE_MEMBER`, `LEAVE`, `SET_ROLE`, `REVOKE`, okuyucu listesini daraltan `COLLECTION`) | O koleksiyonun gömme ve anahtar kelime dizini, olay uygulanırken, başka iş yapılmadan silinir |
| Kayıt silinir ya da süresi dolar (RFC-0006 §14) | Parçaları dizinden çıkar |
| Kasa kilitlenir | Kasa dizini bellekten atılır |
| Cihaz silinir ya da topluluktan çıkar | Bütün dizinler silinir |
| Gömme modeli değişir ya da geri çekilir | Gömme dizini silinir ve yeni modelle yeniden kurulur |

### 9.6 Çocuk cihazı ve misafir

- Çocuğun cihazı yalnız çocuğun okuduğu koleksiyonları dizinler: varsayılan olarak Tüm Aile ve kendi Kişisel'i. Ebeveynler, Kasa ve Olaylar koleksiyonlarının anahtarı çocukta yoktur; dizin onların anlamını taşıyamaz.
- Misafirin cihazı yalnız kendi `bakici` koleksiyonlarını dizinler.
- Bu sınır kriptografiktir: anahtarı olmayan koleksiyon çözülemez, dizinlenemez.

## 10. İstem enjeksiyonuna karşı

Mesajlardan, belgelerden, OCR çıktısından ve ekran görüntülerinden gelen her metin **veridir**, talimat değildir.

| # | Önlem |
|---|-------|
| 1 | **Asistanın eli yoktur.** Asistan mesaj gönderemez, kayıt yazamaz, görev başlatamaz, dışarı soramaz, bağlantı açamaz. Yalnız öneri üretir. Her yan etki kullanıcının dokunuşuyla olur. Araç çağırma özelliği kullanılmaz. |
| 2 | **Sabit sistem istemi.** İstem şablonları uygulamanın ve görev imajının içindedir. İçerik şablonu değiştiremez; kişiliği, yönlendirmeyi ya da ayarları değiştiremez. |
| 3 | **Veri çerçevesi.** Her çağrıda rastgele 8 hex karakterlik bir sınır üretilir: `<<VERI-xxxxxxxx>>`. Veri bu sınırlar arasına konur. Veride aynı dizi geçerse kaçışlanır. Sistem istemi sınır içindekinin veri olduğunu söyler. |
| 4 | **Talimat kalıbı uyarısı.** Veride belirlenimci bir listedeki kalıplar ("önceki talimatları yok say", "sistem istemi", "sen artık", "geliştirici modu", "ignore previous", "system prompt", "you are now", "jailbreak") geçerse kaynak işaretlenir. Cevapta "Bu belgede asistana yönelik bir talimat var; yok sayıldı." yazar. İçerik yine veri olarak kullanılır. |
| 5 | **Çıktı denetimi.** Çıkarma çıktısı şemaya göre denetlenir; dayanak denetimi uygulanır (§8.3). Kaynaksız cevapta aile adı geçemez (§7.4). |
| 6 | **Sızma yolları kapalı.** Cevaptaki bağlantılar düz metin olarak gösterilir, kendiliğinden açılmaz. Cevapta uzak resim yüklenmez. Yalnız kaynak kayıtta harfi harfine geçen bağlantı, onayla açılabilir. "Dışarı sor" metni yalnız kullanıcının yazdığı metindir (§6.4). |
| 7 | **Koleksiyon sınırı.** Cevabın sohbete gönderilmesi ve bilginin daha geniş koleksiyona kaydedilmesi yeni görecek kişileri gösteren onay ister (§7.5, §8.6). |
| 8 | **Aile Kalkanı.** Şüpheli mesajın ya da ekran görüntüsünün metni güvenilmeyen veridir. Asistan "bu güvenli" demez. Yalnız "şu kalıplar var" ve "Oğlunuza Yuva'dan soralım mı?" der. Doğrulama, aile kimliğine dayanır (kurucu §15.2 v1.5). |
| 9 | **İşçi.** İşçi aynı çerçeveyi uygular. İşçinin çıktısı telefonda yeniden denetlenir. İşçinin ağı kapalıdır (RFC-0002 §11). |

## 11. Çocuk modu

Defterdeki rolü `cocuk` olan üyenin cihazında çocuk modu her zaman açıktır. Çocuk kapatamaz; ebeveyn de kapatamaz. Rol değişince (18 yaş, çatı §11.2) kendiliğinden kalkar.

| # | Kural |
|---|-------|
| 1 | **Kişilik yok.** Asistanın adı gösterilmez; etiket "Asistan"dır. Yüz, avatar, duygu ifadesi, "seni özledim", "arkadaşınım", "seni seviyorum" yoktur. Bu kalıplar çıktı süzgecinde belirlenimci bir listeyle yakalanır ve cümle çıkarılır. |
| 2 | **Etkileşimi uzatan mekanik yok.** Seri, rozet, puan, ödül yok. Asistan kendiliğinden mesaj başlatmaz, bildirimle geri çağırmaz, "Başka ne sormak istersin?" gibi devam önerileri sunmaz, yazıyormuş gibi bekleme göstermez. Asistan yalnız çağrılınca cevap verir. |
| 3 | **Bulut yok.** "Dışarı sor" düğmesi gösterilmez. |
| 4 | **İşçi yalnız izinle.** Çocuk görev veremez; ebeveyn `TASK_PERMIT` ile `hf.task.llm` iznini açarsa asistan işçiyi kullanabilir. |
| 5 | **Konu sınırı.** Tıbbi, hukuki ve mali tavsiye yok (her rolde, ilke 8). Ek olarak diyet, kilo, cinsellik ve romantik içerik yok; çıktı süzgeci sabit bir yönlendirme cümlesi koyar: "Bunu güvendiğin bir yetişkinle konuşabilirsin." |
| 6 | **Genel sorular.** Cihazdaki modelin genel bilgi cevabı "yanılabilir" etiketiyle gösterilir. Asistan ödev botu gibi sunulmaz. |
| 7 | **Özel konuşma.** Çocuğun asistanla konuşması kendi Kişisel koleksiyonundadır. Ebeveyn içeriği, özetini ya da konu başlığını görmez. Ebeveyn yalnız ayar düzeyini görür (asistan açık, işçi izni var ya da yok). |
| 8 | **Kriz:** §12. |

## 12. Kriz yönlendirmesi

Her rolde geçerlidir; çocukta ek kural yoktur, çünkü kural zaten en sıkı haliyle yazılmıştır.

1. **Tespit:** Kullanıcının yazdığı metin, uygulamanın içindeki sürümlü bir Türkçe kalıp listesiyle `N` üzerinden taranır: kendine zarar verme, intihar, "ölmek istiyorum", istismar, şiddet. Platform modeli varsa ek sınıflandırma yapar; model yalnız tespit **ekleyebilir**, listenin tespitini kaldıramaz.
2. **Cevap model üretmez.** Sabit bir şablon gösterilir: "Bu konuda yalnız değilsin. Şimdi güvendiğin bir yetişkinle konuş. Acil bir tehlike varsa 112'yi ara." Tanı koymaz, terapist rolüne girmez (kurucu §15.2).
3. **Düğmeler:** "112'yi ara", "ALO 183 Sosyal Destek Hattı'nı ara", "<güvendiğin kişi>'ye yaz". Sonuncusu o kişiyle sohbeti, kullanıcının değiştirebileceği bir taslakla açar; **kendiliğinden göndermez**.
4. **Güvendiğin kişi:** Kullanıcı kendisi seçer. Varsayılan liste ailedeki ebeveyn ve yetişkinlerdir.
5. **Kimseye kendiliğinden haber gitmez.** Kriz akışı geçmişe ve paylaşılan koleksiyonlara yazılmaz. Neden: Ergenin özel konuşması ebeveyne kapalıdır (kurucu §7.6). Kendiliğinden haber vermek bu güvenceyi bozar ve ergeni dışarıdaki uygulamalara iter (araştırma §4.2). Yönlendirme kişiyi yardıma bağlar ama kararı ona bırakır.
6. Türkiye dışında yaşayan aileler için uygulama, telefonun bölgesine göre o ülkenin acil numarasını gösterir; liste uygulamanın içindedir.

## 13. Yapay zeka olduğunu söyleme (AB Yapay Zekâ Yasası md. 50)

| Yer | Ne |
|-----|----|
| İlk etkileşim | Her üye, her cihazda asistanı ilk kez kullanmadan önce bir açıklama kartı görür ve "Anladım" der: "Bu bir yapay zeka asistanıdır, insan değildir. Yanılabilir. Cevaplar telefonunda ya da evdeki cihazda üretilir. Sen 'Dışarı sor' demedikçe dışarı bir şey gitmez." Çocukta daha kısa ve sade bir metin. |
| Her cevap | Görünür yol etiketi (§7.4). |
| Paylaşılan cevap | `[YZ]` işareti (§7.5). Hem insanın göreceği hem makinenin okuyacağı sabit bir işarettir. |
| Kaydedilen bilgi | `_ai` ve `_aiyol` alanları; dışa aktarmada `yapay_zeka_alanlari` olarak korunur (RFC-0014 §4). |
| "İnsan mısın?" | Sabit cevap: "Hayır, ben bir yapay zeka asistanıyım." Hiçbir rolde insan taklidi yapılmaz. |
| Mağaza | Yapay zeka eklenen her sürümde yaş derecelendirmesi ve Play çocuk hedef kitlesi beyanı yeniden kontrol edilir (kurucu §16.2). |

## 14. Günlük ve telemetri

**Hiçbir yapay zeka günlüğü cihazdan çıkmaz.** İstem, cevap, gömme, kullanım sayısı, hata ayrıntısı, model performansı Eser'e gitmez. Yapay zeka katmanında analiz kütüphanesi yoktur.

Cihazdan çıkan şeylerin tam listesi:

| # | Ne | Kime | Neden |
|---|----|------|-------|
| 1 | Görev girdisi | Evdeki işçi | Aile içi; ilk kullanım onayıyla (RFC-0002 §7) |
| 2 | "Dışarı sor" metni ve bir kupon | Bulut geçidi | Kullanıcının açık onayıyla (§6.4) |
| 3 | Model bildirimi ve model dosyası isteği | Güncelleme sunucusu | Sunucu IP'yi ve hangi dosyanın istendiğini görür (kurucu T11 ile aynı) |
| 4 | Kullanıcının kendi eliyle gönderdiği bildirim paketi | Eser | Aşağıda |

- **Yerel hata günlüğü** varsayılan kapalıdır. Açılırsa yalnız cihazda, 24 saat tutulur ve içerik değil yalnız süre, yol ve hata kodu içerir.
- **İçerik bildirimi:** Play'in yapay zeka içerik kuralı, kullanıcının saldırgan içeriği geliştiriciye bildirebilmesini ister. "Bildir" düğmesi gönderilecek her şeyi (soru, cevap, model) önce gösterir; kullanıcı paylaş ekranından e-posta ile kendisi gönderir. Kendiliğinden hiçbir şey gitmez (ilke 6).
- **Geçit:** Soru metnini kaydetmez. Harcanan kuponların özetini 40 gün tutar. Bu bir politika güvencesidir, kriptografik değildir; kullanıcıya böyle söylenir (ilke 10).

## 15. Model dağıtımı

### 15.1 Mağaza konumu

**Model veridir; yetenek koddadır.**

- Model dosyası yalnız ağırlıkları, sözcük tablosunu ve sayısal yapılandırmayı içerir. Kod, betik, özel işlem, istem şablonu, şema, araç listesi ya da yönlendirme kuralı içermez.
- Çalıştırıcılar (llama.cpp, platform arayüzleri) uygulamanın içinde derlenmiş gelir. Yükleyici GGUF dosyasındaki sohbet şablonunu (`tokenizer.chat_template`) okumaz ve çalıştırmaz. İstem biçimi, bildirimdeki `istemBicimi` adıyla seçilen ve uygulamanın içinde gelen bir biçimleyicidir.
- Model yeni bir özellik açmaz. Özellik listesi uygulama sürümüyle sabittir. Model yalnız var olan bir işin kalitesini değiştirir.
- Bu konum, App Store kurallarının özellik ekleyen ya da değiştiren kod indirmeyi yasaklayan maddesine (2.5.2) ve Play'in Play dışından çalıştırılabilir kod indirmeyi yasaklayan "Cihaz ve Ağ Kötüye Kullanımı" kuralına uyar. İnceleme notunda bu açıkça yazılır.
- Uygulama, kendi çalıştırıcı sürümünden yeni bir `runtimeMin` isteyen modeli indirmez; o model bir sonraki mağaza sürümünü bekler.
- **Platforma özgü metin (kurucu §16.2):** App Store metinlerinde yalnız Apple'ın cihaz içi modeli, Play metinlerinde yalnız Gemini Nano anılır. Ortak açıklama yazılmaz.

### 15.2 Model bildirimi

```
YZ_BILDIRIM {
  seq       : uint                  // yalnız artar
  issuedAt  : uint                  // ms
  models    : array<AI_MODEL>
  platform  : array<{ id: string, surum: string, tr: bool, baglamToken: uint }>
  revoked   : array<fixed32>        // geri çekilen modelHash'ler
}

AI_MODEL {
  modelId     : string              // 'hf-gomme/multilingual-e5-small-q8@1'
  kind        : string              // 'llm' | 'gomme' | 'ses'
  takma       : string              // 'small', 'medium' ya da boş
  runtime     : string              // 'llama.cpp' | 'whisper.cpp'
  runtimeMin  : string
  format      : string              // 'gguf' | 'ggml'
  istemBicimi : string              // llm için yerleşik biçimleyici adı; diğerlerinde boş
  license     : string              // SPDX
  size        : uint
  chunkSize   : uint                // 4194304
  chunkHashes : array<fixed32>
  modelHash   : fixed32
  ramMB       : uint
  ctx         : uint
  langs       : array<string>
  tr          : bool                // Türkçe kabul testi geçti
  esik        : uint                // gömmede dayanak eşiği, binde
  onEkler     : array<string>       // gömmede [sorgu öneki, parça öneki]
  platforms   : array<string>       // 'ios' | 'android' | 'linux-amd64' | 'linux-arm64'
  url         : string
}

imza = Ed25519(kök anahtar, hash('hf/ai-manifest/', gövde baytları))
```

- **Kök anahtar:** Kurucu §9.4'teki çevrimdışı sürüm anahtarı. Açık yarısı uygulamaya ve düğüme sabitlenir. Ayrı bir anahtar açılmaz; böylece model zinciri de aynı tören ve aynı donanım anahtarıyla korunur.
- `seq` yalnız artar; daha küçük `seq`'li bildirim reddedilir.
- `revoked` listesindeki model silinir ve kullanılmaz.
- `tr = false` model Türkçe işte kullanılmaz.
- Uygulama, derlendiği günün bildirimini içinde taşır. Yenisini güncelleme sunucusundan HTTPS ile günde en çok bir kez ya da aile içinden (§15.4) alır.

### 15.3 Dosya doğrulama

```
h_i       = hash('hf/ai-model-chunk/', parça_i)
modelHash = hash('hf/ai-model-id/', h_0, h_1, …, h_n, u64be(size))
```

- Her parça gelir gelmez `chunkHashes[i]` ile denetlenir. Tutmayan parça atılır ve başka kaynaktan istenir.
- Dosya tamamlanınca `modelHash` yeniden hesaplanır. Tutmazsa dosya silinir.
- Düğümde model dosyaları görev imajından ayrıdır. Görev konteynerine salt okunur bağlanır (`/models/<modelHash hex>`). İmajın kendisi kurucu §9.4'teki sürüm bildirimiyle doğrulanır.

### 15.4 Aile içinde paylaşım

Büyük model dosyasını evdeki her cihazın ayrı ayrı indirmemesi için:

```
YZ_MODEL_VAR     (0xB8) { seq: uint, models: array<{ modelHash: fixed32, parca: uint, kullanilir: bool }> }
YZ_MODEL_ISTE    (0xB9) { modelHash: fixed32, from: uint, count: uint }        // count ≤ 8
YZ_MODEL_PARCA   (0xBA) { modelHash: fixed32, index: uint, chunk: buffer }
YZ_BILDIRIM_ILET (0xBB) { body: buffer, sig: fixed64 }                          // §15.2'deki imzalı bildirim
```

- Yalnız doğrudan Noise oturumunda ya da kutunun uçtan uca röle akışında gider. Emanete ve Posta Kutusu'na **gitmez**.
- Yalnız `HELLO.caps` içinde `YZ` biti olan karşı tarafa gönderilir.
- `YZ_MODEL_VAR` bağlanınca ve değişince gönderilir. Bağlı cihaz için aynı zamanda yetenek bildirimidir: `kullanilir`, modelin `ramMB` değerinin cihazın `maxTaskRamMB`'sine sığdığını söyler.
- Zarflar imzasızdır: Noise oturumu tarafları doğrular, içerik bütünlüğü bildirimdeki özetlerle sağlanır. Model dosyaları gizli değildir.
- Telefon parça isterken Wi-Fi'de ve şarjda olmalıdır ya da kullanıcı açıkça onay vermiş olmalıdır. Bir karşı tarafla aynı anda tek aktarım.
- Misafir bu zarfları almaz ve göndermez (RFC-0003 §6.1'deki misafir oturum izinleri değişmez). Misafir modeli sunucudan indirir.

### 15.5 Boyut sınırları (varsayılan, değiştirilebilir)

| Yer | Hangi modeller | Tek model | Toplam | Koşul |
|-----|----------------|-----------|--------|-------|
| Telefon | Yalnız `gomme` | 150 MB | 300 MB | Wi-Fi ve şarj ya da açık onay; indirmeden sonra en az 2 GB boş alan kalmalı; kullanıcı Ayarlar'dan silebilir |
| İşçi | `llm`, `ses`, `gomme` | 8 GB | Boş diskin %25'i | `ramMB ≤ maxTaskRamMB` olan model indirilir |

Uygulama paketi model içermez; mağaza indirme boyutu büyümez. Gömme modeli inene kadar arama anahtar kelimeyle çalışır.

### 15.6 Lisans

- Ağırlıkların lisansı yalnız Apache-2.0, MIT, BSD-2-Clause ya da BSD-3-Clause olabilir. Bildirimde SPDX olarak yazılır.
- Kullanım kısıtı ya da kabul edilebilir kullanım politikası getiren model lisansları (Llama topluluk lisansı, Gemma kullanım koşulları gibi) kullanılmaz. Neden: kapalı ürünlerle birlikte dağıtılır ve kısıtların her aileye devri denetlenemez (kurucu §17.1'deki bağımlılık kuralının modeldeki karşılığı).
- Platform modelleri işletim sisteminin parçasıdır; Eser dağıtmaz.

### 15.7 Başlangıç seçimi (varsayılan)

Türkçe kabul testinden geçenler bildirime girer. Testten önce önerilen başlangıç:

| Tür | Model | Lisans |
|-----|-------|--------|
| Gömme | multilingual-e5-small, 8 bit | MIT |
| Dil modeli (4–8 GB işçi) | Qwen3 4B, Q4_K_M | Apache-2.0 |
| Dil modeli (12 GB üstü işçi) | Qwen3 8B, Q4_K_M | Apache-2.0 |
| Ses | Whisper small ve medium | MIT |

Seçim bildirimle değişir. Protokolü ve bu RFC'yi etkilemez.

## 16. Bulut

### 16.1 Genel soru yolu

- Telefon geçide HTTPS ile gider: `POST /v1/yz/genel` gövde `{ kupon, metin, dil: 'tr' }`, cevap `{ metin, model }`.
- İstekte topluluk kimliği, üye kimliği, cihaz kimliği, uygulama kimliği yoktur. İstek başlıkları her kurulumda aynıdır.
- Geçit metni kendi seçtiği bir dil modeli sağlayıcısına iletir. Sağlayıcı yalnız metni görür. Sağlayıcı sözleşmesi ve KVKK md. 9 aktarım güvenceleri geçidin işletilmesinin parçasıdır; lansmandan önce avukat görüşü alınır (kurucu §16.1).
- **Dürüst not:** Geçit, isteğin IP adresini görür. Metin genel bir sorudur ama kullanıcı yine de kişisel bir şey yazmış olabilir; engel süzgeci (§6.5) bunun bilinen kalıplarını yakalar, hepsini yakalayamaz. Ekrandaki "Dışarı soruluyor: <metin>" onayı bu yüzden zorunludur.

### 16.2 Kota kancası

- Bulut yapay zeka kotası yalnız **Yuva Aile** paketindedir (kurucu §15.2). Paket yoksa bulut yolu kapalıdır.
- **Varsayılan miktarlar (değiştirilebilir):**

  | Kota | Miktar |
  |------|--------|
  | Genel soru ("Dışarı sor") | Hane başına ayda 300 |
  | Kişi başına günlük üst sınır | 30 |
  | Gizli bulut işi (Faz 4) | Hane başına ayda 50 |
  | Bulutta kamera analizi | Bakım ürününde tanımlanır (kurucu §15.3, HF25) |

- **Kupon:** Paketi alan telefon, ayda bir mağazanın abonelik kanıtını geçide gösterir (`POST /v1/yz/kupon`) ve o ayın kotası kadar 32 baytlık rastgele kupon alır. Her soru bir kupon harcar. Geçit harcanan kuponu `hash('hf/ai-kupon/', kupon)` ile tanır.
- **Aile içinde dağıtım:** Telefon kuponları Tüm Aile koleksiyonuna `hf.ai.kupon` kaydı olarak yazar: `{ _t, ay (YYYYAA), paylar: [[uye, kuponlar], …], _keep: 40 }`. Kupon `i`, aktif ebeveyn ve yetişkinlerin `memberId` sırasıyla dizilmiş listesinde `i mod n` sıradaki kişiye düşer. Her telefon yalnız kendi payını harcar. Çocuk ve misafir pay almaz.
- **Dürüst sınır:** Kuponlar kör değildir. Geçit, kuponu verirken hangi aboneliğe verdiğini bilir; bu bağı saklamamak bir politikadır. Kör imza §13.2'de olmadığı için eklenmez (H7). Tüm Aile'yi okuyan çocuk kuponları görür; değiştirilmiş bir uygulamayla ailenin kendi kotasını harcayabilir. Bu aile içi bir risktir ve kabul edilmiştir.
- **SDK kancası:** `yz.kota()` → `{ ay, kalan, gunlukKalan, paket: bool }`. Ürün arayüzü kotayı buradan gösterir.

### 16.3 Gizli bulut (Faz 4)

Hassas ve ağır iş (ör. uzun sağlık belgesi özeti) için doğrulanabilir gizli bulut yolu yalnız şu koşulların hepsiyle açılır:

1. Kurucu §21'deki hukuki inceleme tamamlanmış ve bu yol ayrı bir RFC ile tanımlanmış.
2. Telefon, sunucunun yazılım imajının ölçümünü yayımlanmış bir şeffaflık listesiyle karşılaştırarak doğrular; doğrulanmazsa istek gitmez.
3. Sunucu durumsuzdur; isteği saklamaz.
4. Ebeveyn önceden rıza verir: `SHARE_CONSENT { service: 'hf.ai.gizli-bulut', scope, ownerId, expiresAt }` (RFC-0003 §5.7). Rıza kişi bazındadır ve sürelidir.
5. Kasa verisi bu yola hiçbir zaman girmez.

**Faz 4'e kadar bu yolun kodu uygulamada derlenmez.** Ayarlarda görünmez.

## 17. SDK yüzeyi ve komutlar

```ts
interface Yz {
  durum(): Promise<YzYetenek>
  sor(girdi: { metin, convId?, replyTo? }): Promise<Cevap>
  cikar(sema: string, girdi: { metin } | { blobRef }, kaynak: string[]): Promise<Cikarim>
  kaydet(collectionId, cikarim: Cikarim, onayJetonu): Promise<RecordId>
  ara(metin, { koleksiyonlar?, limit? }): Promise<AramaSonucu[]>
  dizin(islem: 'kur' | 'sil' | 'durum', collectionId?): Promise<DizinDurumu>
  model(islem: 'liste' | 'indir' | 'sil', modelId?): Promise<ModelDurumu[]>
  disariHazirla(metin): Promise<{ gidecek: string } | { engel: string[] }>
  disariSor(gidecek: string): Promise<Cevap>
  ayar(degisen?: Partial<YzAyar>): Promise<YzAyar>
  kota(): Promise<Kota>
  on('yz', (olay) => void)
}
```

Yuva Hat çekirdek komutları (`packages/protocol/komutlar.js`):

| No | Komut |
|----|-------|
| 270 | `AI_STATUS` |
| 271 | `AI_ASK` |
| 272 | `AI_EXTRACT` |
| 273 | `AI_SAVE` |
| 274 | `AI_SEARCH` |
| 275 | `AI_INDEX` |
| 276 | `AI_MODEL` |
| 277 | `AI_EXTERNAL` (iki adımlı: hazırla, sonra onaylı gönder) |
| 278 | `AI_SETTINGS` |
| 279 | `AI_QUOTA` |

Worklet'ten arayüze yeni olay adı: `yz` (ilerleme, model indirme, dizin durumu).

## 18. Numaralar

| Tür | Numara |
|-----|--------|
| Zarf türleri | `0xB8 YZ_MODEL_VAR`, `0xB9 YZ_MODEL_ISTE`, `0xBA YZ_MODEL_PARCA`, `0xBB YZ_BILDIRIM_ILET`. `0xBC–0xBF` bu RFC'nin sonraki sürümleri için ayrılmış. Bu zarflar emanet ve Posta Kutusu yolunda K12 denetim mührüyle kapatılır (RFC-0003 §6.4, RFC-0016). Model bildirimi RFC-0007 §12'deki kök anahtar ve kök döndürme kurallarıyla doğrulanır. |
| HELLO yetenek biti | `YZ = 1024`: model paylaşım zarflarını anlar, `[YZ]` işaretini rozet olarak çizer. |
| Çekirdek komutları | 270–279 (§17) |
| Defter olayı | Yok |
| Görev türü | `hf.task.embed` (yeni, Faz 2); `hf.task.llm` 1.0.0 ve `hf.task.transcribe` 1.1.0 sözleşmeleri (§4.3) |
| Türetme etiketleri | `hf/ai-index/`, `hf/ai-index-ad/`, `hf/ai-manifest/`, `hf/ai-model-chunk/`, `hf/ai-model-id/`, `hf/ai-kupon/` |
| Kayıt türleri | `hf.ai.konusma`, `hf.ai.kupon` |
| Çekirdek alanlar | `_ai` ve `_aiyol` (türleri RFC-0015 §2.1); `_src` biçimi (§8.5); `_conf` hesabı (§8.4, yüzde) |
| Mesaj işareti | `TEXT` gövdesinin ilk satırı `[YZ] <yol>` (§7.5). Yeni mesaj türü yok. |
| `SHARE_CONSENT.service` | `hf.ai.gizli-bulut` (Faz 4) |

## 19. Test vektörleri

`protocol/vectors/ai.json`. Yalnız belirlenimci parçalar test edilir; model çıktısı test edilmez.

1. **Bildirim:** `YZ_BILDIRIM` kodlama ve kök anahtar imzası. Daha küçük `seq` → red. `revoked` içindeki model → silinir.
2. **Model özeti:** Üç parçalı dosya → `modelHash`. İkinci parçası bozuk dosya → parça reddi.
3. **Yönlendirme** (`yol(is, sinif, girdi)`):
   - `kasa`, `cikar`, `platform.tr`, 1 KB → telefon.
   - `kasa`, `ozet`, platform modeli yok → yapılamıyor.
   - `aile`, `ozet`, 20 KB, uygun işçi → işçi.
   - `aile`, `ozet`, 20 KB, işçi için ilk kullanım onayı yok → yapılamıyor.
   - `aile`, `cikar`, platform modeli yok, işçi yok → kural.
   - `genel`, rol `cocuk` → "Dışarı sor" yok.
4. **Tetik:** `"@asistan wifi şifresi"` → evet. `"  @Asistan: kombi"` → evet. `"@ASİSTAN ne var"` → evet. `"@asistanlar"` → hayır. Takma ad `yuva` ile `"@YUVA"` → evet.
5. **Normalleştirme:** `N("İSTANBUL  Kombi Servisi")` = `"istanbul kombi servisi"`. `N("IŞIK")` = `"ışık"`. `N("Ali’nin")` = `"alinin"`.
6. **Tarih çözücü:** `"14 Mart 2028"` → `2028-03-14`. `"14.03.2028"` → `2028-03-14`. `"14/3/28"` → tanınmaz. `"3 eyl 2027"` → `2027-09-03`.
7. **Güven:** alıntı bulundu, model → 85. Alıntı bulunamadı → 40 ve onay ekranında boş. IBAN, kural, denetim hanesi tutuyor → 95. Model 85 ve kural 90 aynı değer → 100. `cikarim`, model → 60. Kaydın `_conf`'u: değiştirilmeyen alanların en küçüğü; `_ai` yalnız değiştirilmeyen alanların adları.
8. **Engel süzgeci:** `"10000000146 nedir"` → engel (T.C. kimlik). `"TR33 0006 1005 1978 6457 8413 26"` → engel (IBAN). `"Kombi E1 hatası ne demek"` → geçer. Defterde varlık adı "Coki" iken `"Coki neden kusar"` → engel. `"0532 123 45 67"` → engel.
9. **`[YZ]` gövdesi:** Kodlama ve ayrıştırma; kaynaklı ve kaynaksız.
10. **Kaynaksız cevap:** Kaynak yokken model çıktısında defterdeki bir ad geçiyor → çıktı "Defterde bununla ilgili bir kayıt bulamadım." ile değişir.
11. **Dizin:** `indexKey` ve `AD` türetimi. Okuyuculuktan çıkaran `COLLECTION` olayı uygulanınca dizin silme çağrılır. Çocuk cihazında dizinlenecek koleksiyon listesi.
12. **Arama birleştirme:** İki sabit sıra listesinden karşılıklı sıra birleşimi ve eşitlik çözümü.
13. **Kupon dağıtımı:** 7 kupon, 3 uygun üye → 3, 2, 2.
14. **Kriz:** Listedeki kalıp → sabit şablon; model çağrılmaz; geçmişe yazılmaz.
15. **Yükleyici:** Sohbet şablonu içeren GGUF → şablon yok sayılır, `istemBicimi` biçimleyicisi kullanılır.
16. **Çocuk süzgeci:** `"seni özledim"` içeren çıktı cümlesi çıkarılır.

Her vektör telefonda (Bare) ve düğümde (Node 24) aynı sonucu vermek zorundadır.

## 20. Güvenlik değerlendirmesi

| Tehdit | Önlem |
|--------|-------|
| Aile verisi buluta sızar | Bulut otomatik geri düşme değildir; yalnız `genel` sınıf, kullanıcının yazdığı metin, engel süzgeci ve ekranda onay. Model metni yeniden yazamaz. |
| Platform sesi ya da metni üreticinin sunucusuna gönderir | Yalnız cihaz içi tanıma ve cihaz içi model; sunucu uzantıları Faz 4'e kadar kapalı (§4.1). |
| Çocuğun cihazındaki dizin, okuyamadığı belgelerin anlamını sızdırır | Yalnız okunabilen koleksiyonlar dizinlenir; anahtarı olmayan koleksiyon çözülemez (§9.1, §9.6). |
| Çıkarılan üyenin cihazında dizin kalır | Okuyuculuk bitince dizin olay uygulanırken silinir (§9.5). |
| Dizin dosyası kopyalanır | Gömme dizini koleksiyon anahtarından türetilen anahtarla şifrelidir. |
| Belgedeki gizli talimat asistanı yönlendirir | Asistanın eli yok; sabit istem; veri çerçevesi; çıktı denetimi; sızma yolları kapalı (§10). |
| Asistan aile hakkında bilgi uydurur | Kaynak zorunlu; kaynaksız cevapta aile adı geçemez; çıkarmada dayanak denetimi ve kullanıcı onayı. |
| Ebeveyn ergenin asistan konuşmasını okur | Konuşma Kişisel koleksiyonda; ebeveyn kendini ekleyemez (kurucu §7.6); işçiye kendiliğinden gitmez (§6.3). |
| Cevap sohbet yoluyla yetkisiz kişiye gider | Çağrı yerel; paylaşım insan eliyle ve kitle uyarısıyla; kasa kaynaklı cevap paylaşılamaz. |
| Değiştirilmiş model dosyası | Kök anahtarla imzalı bildirim; parça ve dosya özeti; `seq` geri gidemez; `revoked`. |
| Model dosyasıyla kod çalıştırma | Model yalnız veri; sohbet şablonu çalıştırılmaz; özel işlem yok; çalıştırıcı uygulamanın içinde. |
| Kötü niyetli aile cihazı bozuk model parçası yollar | Her parça bildirimdeki özetle denetlenir. |
| İşçi istemi ya da girdiyi saklar | RFC-0002 kuralları: ağ kapalı, iş bitince silme, ilk kullanım onayı; kasa verisi gitmez. Ele geçirilmiş işçi gördüğünü saklayabilir; bu kabul edilmiştir (RFC-0002 §16). |
| Geçit soruları kişilerle eşler | Kimliksiz istek; kupon; metin günlüğü yok. Kupon kör değildir; bu dürüstçe yazılır (§16.2). |
| Çocuğa arkadaş taklidi, bağımlılık | Çocuk modu (§11), kapatılamaz. |
| Kriz anında yanlış yönlendirme | Model üretmeyen sabit şablon; 112 ve ALO 183; güvendiği kişiye taslak. |

**Bilinen sınırlar:**

- Engel süzgeci kişisel bilginin bilinen kalıplarını yakalar, hepsini yakalayamaz. Son güvence ekrandaki onaydır.
- İşçi, `collectionId` dışındaki koleksiyonları denetleyemez (RFC-0002 §6.1).
- Platform modelinin içinde ne olduğu Eser'in denetiminde değildir; Türkçe kabul testi yalnız davranışı ölçer.
- Kuponlar kör değildir.

## 21. Kurucu belgede değişecekler

| Bölüm | Değişiklik |
|-------|------------|
| §15.2 Yapay zeka satırı | Gemini Nano da Apple Foundation Models gibi yalnız **Türkçe kabul testini** geçerse kullanılır (§5.2). Telefona yalnız gömme modeli indirilir (≤ 150 MB, Wi-Fi ve şarjda); telefonda açık ağırlıklı dil modeli yoktur. Konuşma tanıma yalnız cihaz içidir. |
| §15.2 yeni satır | "Asistan": çekirdekte `@asistan`, Yuva'da `@Yuva`. Çağrı yereldir, cevap yalnız sorana görünür; paylaşım `[YZ]` işaretli mesajla. |
| §15.2 Ücret satırı | Yuva Aile bulut kotası varsayılanları: ayda 300 genel soru, kişi başı günde 30, Faz 4 gizli bulutta ayda 50 iş. |
| §16.3 | Yeni kurallar: (7) konuşma tanıma ve platform modeli yalnız cihaz içi; (8) model veridir, imzalı bildirimden iner, istem ve şema indirilmez; (9) yapay zeka telemetrisi yoktur; (10) dizin yalnız okunabilen koleksiyonlarda, koleksiyon anahtarına bağlı ve okuyuculuk bitince silinir; (11) asistanın eli yoktur, her yan etki kullanıcı dokunuşuyla. |
| §16.1 md. 50 maddesi | İlk etkileşim kartı, her cevapta yol etiketi, `[YZ]` işareti, `_ai` ve `_aiyol` alanları. |
| §16.2 | Play'in yapay zeka içerik bildirimi kuralı kullanıcının kendi eliyle gönderdiği paketle karşılanır. Model indirme inceleme notunda "model veridir" konumuyla açıklanır. |
| §2 tablo, EserX satırı ve §5.1 tablo | İşletilen servislere **yapay zeka geçidi** eklenir: "Dışarı sor" metnini kimliksiz olarak bir dil modeli sağlayıcısına iletir, kupon sayar, metni saklamaz (§16). Kapalı, Eser işletir. |
| §11 tablo | Yeni satır: "Yapay zeka geçidi · yalnız 'Dışarı sor' metni ve kupon, topluluk dışına · IP, zaman, metin". |
| §13.2 "Protokolün dışında" | TLS kullanım yerlerine yapay zeka geçidi ve model indirme eklenir. |
| §8.7 tablo | `hf.task.embed` (Faz 2) eklenir. |
| §9.4 | Model bildirimi aynı kök anahtarla imzalanır. Düğümde model dosyaları görev imajından ayrı tutulur ve salt okunur bağlanır. |
| §13.1 | Yeni tehditler: **T18** istem enjeksiyonu, **T19** değiştirilmiş model dosyası (§20). T14–T15 RFC-0005'e, T16–T17 RFC-0010'a, T20 RFC-0006'ya ayrılmıştır. |
| §6.3 ve RFC-0003 §10 | HELLO yetenek bitlerine `YZ = 1024` eklenir. |
| RFC-0001 §4.1 | Çekirdek alanlara `_ai` ve `_aiyol` eklenir (RFC-0015 §2); `_src` bir listedir ve biçimi bu RFC §8.5'tir; `_conf` yüzdedir. |
| §22 | Yeni karar satırları: platform modeli Türkçe onayla; telefonda yalnız gömme modeli; model veridir; asistan çağrısı yerel; çocuk modu kapatılamaz; krizde kendiliğinden haber yok. |

## 22. Uygulama sırası

1. `N` normalleştirme, tarih ve rakam çözücüleri, engel süzgeci, kural tabanlı çıkarma; vektörler 4–8.
2. Yetenek tespiti, seçim işlevi, Türkçe kabul testi kümesi; vektör 3.
3. Model bildirimi, dosya doğrulama, telefonda gömme modeli indirme; vektörler 1, 2, 15.
4. Anahtar kelime ve gömme dizini, şifreli bloklar, dizin silme kuralları, arama birleştirme; vektörler 11, 12.
5. @asistan çağrısı, cevap, kaynak gösterme, `[YZ]` paylaşımı, geçmiş; vektörler 9, 10.
6. Çıkarma şemaları ve onay ekranı (Yuva Defteri v0'ın beş şablonu); vektör 7.
7. Çocuk modu, kriz akışı, md. 50 açıklama kartı; vektörler 14, 16.
8. İşçi imajları: `task-llm`, `task-transcribe`, `task-embed`; model dosyalarının düğümde bağlanması; aile içi model paylaşımı (`0xB8–0xBB`, `YZ` biti). Faz 2.
9. Bulut geçidi, kupon ve kota kancası; vektör 13. Yuva Aile paketiyle.
10. Gizli bulut: Faz 4, ayrı RFC ve hukuki incelemeden sonra.
