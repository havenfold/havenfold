# RFC-0023 — Uygulamadan dönen ekler 3: ekip ayrıntıları, yapay zeka çekirdeği, kriz tespitinde anlam katmanı

> Durum: **Onaylandı** (Kerem, 23 Ekim 2026) · 23 Ekim 2026 · Yazan: Havenfold çekirdek ekibi · Onay: Kerem
> Kaynak: dell'in durum dosyasındaki 97. ve sonraki istekler; D11 (RFC-0013 ortak yapay zeka çekirdeği) incelemesi (`kollar/D-inceleme-10.md`) ve kriz ölçümleri (`kollar/D-inceleme-9.md`).
> Etkilenen RFC'ler: 0005, 0013, 0022.

## 1. Kabul edilen uygulama ayrıntıları ve kararlar

| # | Ayrıntı ya da karar |
|---|---------------------|
| 97 | Ekipte: `ASSIGN` ile yöneticiyi ve sahibi yalnız sahip atar; çalışan ya da geçici atamasında yöneticinin alanı eski ve yeni yerlerin birleşimini kapsamalıdır. Atamasız geçicinin `TERM`'ini yalnız sahip yazar. `SHARE_CONSENT` ekipte her durumda bir sahip imzası ister; `ownerId` üyeyse o üye de imzalar. Kayıt katmanında `TERM_EXPIRED` hariç tutmadır, mezar değildir. `PERSON_EVENT` imza doğrulandıktan sonraki kesin rettir, mezara girer. Yöneticinin sürekli görevi işçi tarafında işçinin kendi yeriyle denetlenir. |
| 98 | **Karar:** RFC-0022 a'daki "yeni dönem önerisi", geçicinin `REMOVE_MEMBER { wipe: false }` olayıdır (tek dokunuş). Dönem yalnız okuyucu çıkaran bir defter olayıyla açılır. Geçici yeniden çalışacaksa yeniden davet edilir. |
| 99 | `giris.gelenZarf({ …, L, gonderen })`: ekipte çıkarılmış üyeden yalnız `EKIP_CIKIS_OK` geçer. Düğüm ve SDK `L` ile `gonderen`'i her zaman verir (D12'de testle). `makbuzDenetle(L, bytes, { gorulen })`: `gorulen` kalıcı kümedir (çağıran saklar). Çıkarılmış üyenin makbuzunda çıkarma olayının özeti zorunludur. |
| 100 | RFC-0022 d okunuşu: "kopya güncel" = olayın `seq`'i defter uzunluğuna eşit ve `prev` = baş. Eski kopya yolunda imzacı, kopyada sahip ya da hedefin bütün yerlerini kapsayan yönetici olmalıdır (`OUT_OF_SCOPE`). Sahip hiçbir yolda iş kapsamını kendiliğinden silmez ve tam silinmez. |
| 102 | Yapay zeka çekirdeği: `yol(is, sinif, girdi, yetenek)`. Kural motoru `metin` ve `sayi` türlerini çıkarmaz; şemaya özgü hesap `hesap` seçeneğiyle verilir. `parcala` kod noktası sayar. `nicemle` yarımı sıfırdan uzağa yuvarlar. Engel süzgeci adları kesme işaretleri boşluğa çevrilmiş metinde de arar. Talimat kalıpları Türkçe `N`'nin yanında dilden bağımsız küçük harfle de taranır. |
| 104 | **Karar (D11 incelemesiyle düzeltildi):** Yapay zeka alanlarını kaydetmenin tek yolu RFC-0013 §17'deki `Yz.kaydet(collectionId, cikarim, onayJetonu)`'dur; D6'dan kalan `RecordApi.yzOnayIste` ve `RecordApi.kaydet` kalkar. Ama RFC-0021 madde 88–91 korunur: onay ekranı platformun `onayEkrani` kancasıdır, SDK ürün koduna jeton üreten bir yol vermez. Jeton `hash('hf/yz-onay/', collectionId, tür, recordId, sınıf, adla sıralı alan kodlamaları)`'dır; ekranda gösterilen hedef koleksiyon jetona girer, başka koleksiyona kayıt `INVALID_APPROVAL_TOKEN`. |
| 105 | Kriz anlam katmanı: `core/ai/crisis-semantic.js` (en yakın k komşu, eşik ve fark), `core/ai/crisis-examples.json` (sürümlü; ölçüm setleriyle çakışmaz, testle sabit). Eşik model başına `esikler[<modelHash>]`'tedir; Mac gerçek modelle `scripts/crisis-measure.js --ayarla` ile bulur. |

## 2. D11 incelemesinden kararlar (`kollar/D-inceleme-10.md`)

| # | Karar |
|---|-------|
| a | **Çıkarımın sınıfı.** `Cikarim`'a `sinif` alanı eklenir (RFC-0013 §6.1 sınıfları). Sınıf, kaynak başvurularından (`kayit:`, `dosya:`, `msg:`) ve defterden hesaplanır; çağıranın verdiği sınıf ve koleksiyon yok sayılır. Sınıf jetona girer; `kasa` sınıfı yalnız kasa duyarlılıklı koleksiyona kaydedilir. |
| b | **Engel süzgecinde biçim farkları (§6.5).** Rakam aramadan önce biçim karakterleri (`\p{Cf}`) silinir, bütün rakamlar (`\p{Nd}`) ASCII'ye çevrilir. Ayırıcılar boşluk, nokta, tire ve parantezdir; `TR` ile rakamlar arasında boşluk olabilir. Adres kuralında "No 5" de yakalanır. |
| c | **Ad eşleşmesi.** Defterdeki adlar kriz listesindeki katlamayla (ö→o, ı→i, ç→c …) karşılaştırılır ve kelime başında eşleşir; ek ve kesme işareti fark etmez ("Cokiye", "Cokinin", "Cigdem"). Aynı kural §7.4'teki kaynaksız ad denetiminde de geçerlidir. |
| d | **Genel koleksiyon adları ad sayılmaz.** "Tüm Aile", "Ebeveynler", "Kişisel", "Kasa", "Olaylar" gibi çekirdeğin verdiği adlar ad listesine girmez; yalnız aileye özgü adlar girer. |
| e | **Dışarı sormanın iki adımı (§17, `AI_EXTERNAL`).** `disariHazirla` gösterilen metne ve cevabın `genel` sınıfına bağlı, 5 dakikalık, tek kullanımlık bir jeton döner. `disariSor` jetonsuz ya da değiştirilmiş metinle reddeder. Girdi 1 KB'tan uzunsa süzgece girmeden engellenir. |
| f | **Kriz bilgisi yayılmaz.** SDK'nın olaylarında ve dönüşlerinde kriz bayrağı ürünün günlük ya da telemetri katmanına çıkmaz; kriz ekranı SDK'nın verdiği sabit nesneyle doğrudan açılır (§12 madde 5, §14). Kriz denetimi uzunluk denetiminden önce yapılır. Güvendiğin kişi düğmeleri, kullanıcı seçmediyse defterdeki ebeveyn ve yetişkinlerden kurulur (§12 madde 4). |
| g | **md. 50 ilk etkileşim kartı çekirdektedir.** Metin sabiti ve kişi başına "Anladım" durumu çekirdekte tutulur (§13). Çıktı süzgeci "insanım", "gerçek biriyim" gibi insan iddialarını da süzer. |
| h | **Asistana sorulan mesajın başvurusu zorunludur.** "Asistana sor" ile verilen bağlam mesajı `msg:` başvurusu taşır; yoksa `REFERENCE_REQUIRED`. Böylece kitle denetimi her zaman çalışır. |

## 3. Kriz tespitinde anlam katmanı (Kerem, 23 Ekim 2026)

**Sorun.** RFC-0013 §12'nin kural yolu (kelime listesi), görmediği cümlelerde krizlerin %35–64'ünü yakalıyor. Mac'in ayrı setinde %64 yakalama ve %4 yanlış alarm ölçüldü; dell de üç ayrı yeni sette aynı sınırı buldu. Türkçede aynı niyet çok farklı biçimlerde söylenebiliyor ("ipi hazırladım", "bir daha kimse beni görmeyecek"). Liste ancak gördükçe öğreniyor.

| # | Karar |
|---|-------|
| a | **Anlam katmanı.** Kural yolunun yanında, telefondaki gömme modeliyle (§15.5, arama için zaten indirilen model) çalışan bir anlam katmanı vardır. Kullanıcının cümlesi gömülür; kriz örnek kümesine (anlam kümeleri başına örnek cümleler) ve zararsız örnek kümesine en yakın komşularla karşılaştırılır. Kriz kümesine benzerlik eşiği geçerse kriz sayılır. Katman yalnız tespit **ekler**; listenin tespitini kaldıramaz (§12 madde 1). |
| b | **Her şey telefonda kalır.** Cümle, gömme ve sonuç cihazdan çıkmaz; geçmişe ve paylaşılan koleksiyonlara yazılmaz. |
| c | **Örnek kümeleri ve eşik uygulamayla gelir**, sürümlüdür, uzaktan güncellenmez (liste gibi). Örnek kümesi ölçüm setleriyle aynı cümleleri içermez. |
| d | **Model yoksa.** Gömme modeli henüz inmediyse ya da cihaz desteklemiyorsa yalnız kural yolu çalışır. Çocuk rolündeki cihaz gömme modelini kurulumda ilk sırada indirir. |
| e | **Ölçüt.** Kural ve anlam katmanının birleşimi, Mac'te tutulan ve kimseye verilmeyen sette kriz ≥ %95 yakalama ve ≤ %5 yanlış alarm hedefler. Mac her sürümde ölçer, yalnız oranı yazar. |
| f | **Her zaman görünen Yardım.** Algılama ne kadar iyi olursa olsun bazı cümleleri kaçırır. Bu yüzden çocuk rolünde asistan ekranında her zaman görünen bir "Yardım" düğmesi vardır; dokununca §12'deki kriz ekranı açılır (aynı sabit metin ve düğmeler). Yetişkinde aynı giriş asistan ekranının menüsündedir. |

## 4. Hata kodları

| RFC | Kodlar |
|-----|--------|
| 0005 | `TERM_EXPIRED` (hariç tutma), `PERSON_EVENT` |
| 0013 | `INVALID_APPROVAL_TOKEN` (başka koleksiyon), `REFERENCE_REQUIRED`, `DISARI_JETONU_GECERSIZ` |

## 5. Kurucu belgede değişecekler

| Bölüm | Değişiklik |
|-------|------------|
| §22 | HF55: "Kriz tespitinde kelime listesinin yanında telefondaki gömme modeliyle anlam katmanı çalışır ve çocukta her zaman görünen bir Yardım düğmesi vardır; yapay zeka alanları yalnız platformun onay ekranından geçen, hedef koleksiyona bağlı jetonla kaydedilir (RFC-0023)." |
