# Yuva için Aileye Ait Asistan: İhtiyaçlar, Pazar, Mimari ve Önerilen Konseptler

> **Kuruluş öncesi araştırma** (22 Ekim 2026). Havenfold'un kuruluşuna temel olan rapordur; olduğu gibi korunur. Kararlar `KURUCU-BELGE.md`'dedir; rapor belgeyle çelişirse belge geçerlidir (§24).

Yuva'nın felsefesine en iyi oturan asistan, her şeyi yapmaya çalışan bir "aile süper zekâsı" değil. Doğru hedef, Yuva sohbetinin içinde yaşayan, ailenin paylaşılan bilgisini (evrak, ev bilgisi, sağlık notları, tarifler, hikâyeler) yerelde ve şifreli tutan, dar ama güvenilir işler yapan bir "Aile Defteri" asistanı. Bunun üzerine iki farklılaştırıcı katman eklenmeli: yaşlıları dolandırıcılığa karşı koruyan bir "aile doğrulama" katmanı ve zamanla kuşaklar arası bir aile hafızasına dönüşen bir arşiv. 2026'daki pazar tablosu bu yönü destekliyor. Bulut tabanlı genel aile asistanları ya kapandı (Milo, Maple) ya da büyük platformların bedava özelliklerine dönüştü (Alexa+). Gizlilik vaadi veren kişisel hafıza ürünleri ise satın alınıp kapatıldı (Limitless/Rewind → Meta). "Veri bizde kalır, şirket batsa da kaybolmaz" vaadi bu yüzden artık soyut bir değer değil, somut bir satış argümanı.

## TL;DR

- **En güçlü başlangıç, lojistik ile hafızanın kesiştiği yer:** Sohbetten takvim/görev çıkaran ve "kombi nasıl sıfırlanır, wifi şifresi ne, annemin ilaçları neler" gibi sorulara yanıt veren bir **Aile Defteri** önerin. Bu her gün kullanılır, küçük modellerle bugün güvenilir biçimde yapılabilir ve kendiliğinden bir aile arşivine dönüşür. Saf "anı/hikâye" ürünü duygusal açıdan güçlü ama seyrek kullanılır. Saf "takvim/market" ürünü ise kalabalık ve ölümcül derecede rekabetçi bir alan.
- **Mimari olarak "yerel-öncelikli + isteğe bağlı gizli bulut" hibriti gerçekçi:** Cihaz üstü modeller (Apple'ın ~3B modeli 4.096 token bağlamla, Gemini Nano en iyi Pixel 10'da) çıkarma, sınıflandırma ve kısa yanıt için yeterli. Uzun akıl yürütme için ya aile içindeki bir "ev beyni" (Mac mini/N100 + Ollama/llama.cpp) ya da açık rıza ile Apple Private Cloud Compute benzeri doğrulanabilir bir bulut gerekiyor. Ortak hafıza CRDT + uçtan uca şifreli grup anahtarıyla (Keyhive/BeeKEM tarzı) tutulabilir.
- **Güvenlik, farklılaşmanın kendisi:** ABD'de 60 yaş üstünün 2025'te internet dolandırıcılığına 7,7 milyar dolar kaybettiği, gençlerin %72'sinin AI "arkadaşları" denediği ve FTC'nin AI sohbet botlarına çocuk güvenliği soruşturması açtığı bir ortamda, "sadece aileyi tanıyan, dışarıya kapalı, çocuğa arkadaş taklidi yapmayan" bir asistan ciddi bir konumlandırma fırsatı. Ancak KVKK'nın "aynı konutta yaşayan aile" istisnası dar ve bulut kullanıldığı an yurt dışı aktarım kuralları devreye giriyor.

## Temel Bulgular

1. **Pazar, "her şeyi yapan aile AI'si" fikrini iki kez sınadı ve ikisinde de başarısız oldu.** OpenAI ve Y Combinator destekli Milo, Ocak 2026'da kapandı. Kurucu Avni Patel Thompson veda yazısında "teknoloji, herhangi bir yararlı şekilde güvenilir olmak için hâlâ çok erken" diyor. "Beyaz eşya" gibi geniş bir aile yapay zekâsının "küçük oyuncaklar ve demolar dışında mümkün olmadığını", ekibin sürekli basitleştirmek zorunda kaldığını anlatıyor. Ücretsiz aile organizatörü Maple ise Wander tarafından satın alındı ve 31 Aralık 2026'da kapanıyor. Maple'ın kendi ifadesiyle bu tarihten sonra "tüm veriler silinecek ve kurtarmanın hiçbir yolu olmayacak".
2. **Büyük platformlar aile lojistiğini metalaştırıyor.** Alexa+ Şubat 2026'dan beri Prime üyelerine ücretsiz. Aile takvimi, e-postadan/okul broşüründen etkinlik çıkarma, el yazısı tarif dijitalleştirme ve Visual ID ile kişiye özel hatırlatma sunuyor. Amazon'un aboutamazon.com'daki "Getting started with Alexa+" yazısına göre müşteriler takvim öğelerini "neredeyse iki kat daha sık" ekleyip düzenliyor ve Alexa'dan tarif adımlarını beş kat daha fazla istiyor. "Fotoğraftan etkinliğe" özelliği 2026'da sıradan bir özelliğe dönüştü.
3. **Gizlilik odaklı kişisel hafıza ürünlerinin kurumsal kırılganlığı kanıtlandı.** Meta, 5 Aralık 2025'te Limitless'i (eski adıyla Rewind) satın aldı. Pendant satışı durdu, Rewind Mac uygulaması 19 Aralık 2025'te kayıt yapmayı bıraktı, AB/Birleşik Krallık'ta hizmet kesildi. Merkezi sunucusuz bir mimari bu riski yapısal olarak ortadan kaldırıyor. Yuva için en güçlü pazarlama cümlesi tam olarak bu.
4. **Cihaz üstü modeller dar işler için hazır, genel sohbet için değil.** Apple'ın Foundation Models çerçevesindeki on-device model ~3B parametreli ve bağlam penceresi 4.096 token (girdi+çıktı toplamı). Gemini Nano'nun ML Kit Prompt API'si en iyi Pixel 10 serisinde çalışıyor. Pil kotaları uyguluyor ve arka planda çalışmayı desteklemiyor. Sürekli yükte telefonlar ısınıp yavaşlıyor.
5. **Asıl risk alanı çocuklar ve yaşlılar.** FBI IC3'ün 2025 raporuna göre 60 yaş üstü 201.266 şikâyette 7,748 milyar dolar kaybetti, kayıplar bir yılda %59 arttı. FBI'ın basın bültenine göre yapay zekâ ile ilişkili 22.364 şikâyette tüm yaşlar için yaklaşık 893 milyon dolar kayıp yaşandı; HousingWire'ın aktardığı IC3 verisine göre 60 yaş üstünden yapay zekâya atıf yapan 3.100'den fazla şikâyette kayıp 352 milyon doları aştı. Çocuk tarafında Common Sense Media araştırmasına göre ABD'li gençlerin %72'si AI arkadaşı denemiş. FTC 11 Eylül 2025'te yedi şirkete 6(b) soruşturma emri gönderdi.

## Bölüm 1 — Günlük Aile Hayatından İhtiyaç Haritası

Aşağıdaki tablo, ihtiyaçları aile evresine göre ayırıyor. Her satırda kimin kullandığı, ne sıklıkla kullandığı, genel asistanların neden yetersiz kaldığı ve "aileye özel + gizli" olmanın neden fark yarattığı yer alıyor. Sıklık, ürünün alışkanlık yaratıp yaratmayacağının en iyi göstergesi. Duygusal değer ise ödeme isteğini ve sadakati belirliyor.

| İhtiyaç | Kim kullanır | Sıklık | Genel asistanlar (ChatGPT/Siri/Gemini/Alexa) neden yetersiz | "Aileye özel + gizli" farkı |
|---|---|---|---|---|
| Sohbetten takvim/görev yakalama ("Cuma 15:00 veli toplantısı", "Ali'yi kim alacak?") | Okul çağı çocuklu ebeveynler | Günlük | Aile grup sohbetini görmezler; her bireyin hesabı ayrı | Asistan zaten sohbetin içinde; bilgi aileden dışarı çıkmadan yapılandırılır |
| Ev bilgi tabanı (wifi şifresi, kombi sıfırlama, sigorta poliçe no, apartman yöneticisi) | Tüm hane, misafir/bakıcı | Haftalık | Genel bilgi verir, *sizin* kombinizi bilmez; şifre gibi bilgileri buluta koymak riskli | Şifreler ve evrak cihazda/aile içinde şifreli kalır; rol bazlı paylaşım (bakıcı wifi'yi görür, banka bilgisini görmez) |
| Önemli evrak ve garanti takibi | Ebeveynler, yetişkin çocuklar | Aylık, ama kriz anında kritik | Belgeyi saklamazlar; hatırlatma bağlamsızdır | Fotoğraf → yerel OCR → "bulaşık makinesinin garantisi ne zaman bitiyor?" |
| İlaç ve sağlık takibi (çocuk aşıları, yaşlının ilaç listesi, alerjiler) | Bebekli aileler, yaşlı ebeveyne bakan kardeşler | Günlük/haftalık | Sağlık verisi hassas; çoklu bakıcı koordinasyonu yok | KVKK'da özel nitelikli veri; yerelde tutmak hukuken ve duygusal olarak doğru tercih |
| Yaşlı bakım koordinasyonu ("Annemi bu hafta doktora kim götürecek?") | Uzakta yaşayan yetişkin kardeşler | Haftalık | Tek kullanıcılı tasarım; aile içi rol paylaşımı yok | Kardeşler arası adil yük dağılımı, ortak kayıt |
| Dolandırıcılığa karşı koruma ("Oğlum yeni numaradan para istiyor") | Yaşlılar + onları koruyan çocukları | Seyrek ama yüksek riskli | Genel asistanlar aileyi tanımaz; "bu gerçekten oğlum mu?" sorusunu yanıtlayamaz | Asistan aile üyelerinin gerçek kimliğini/cihazını bilir; aile içi doğrulama yapılabilir |
| Yaşlılar için kolay erişim (sesli, büyük yazı, tek tuş) | 70+ büyükanne/büyükbaba | Günlük | Arayüzler karmaşık; aile bağlamı yok | "Torunumun doğum günü ne zaman?" gibi sorulara aile verisinden yanıt |
| Aile hafızası (hikâyeler, tarifler, soyağacı, ses kayıtları) | Çok kuşaklı aileler, yetişkin çocuklar | Seyrek, duygusal zirveler (bayram, kayıp, doğum) | Veriyi sahiplenmezler; şirket kapanınca kaybolur | Aileye ait, devredilebilir, şirketten bağımsız arşiv |
| Ritüeller/hatırlatmalar (doğum günü, ölüm yıldönümü, bayram ziyareti) | Geniş aile | Aylık | Bağlamsız hatırlatma ("hediye fikri: geçen yıl ne almıştık?") | Geçmiş aile verisinden kişiselleştirme |
| Çocuk için güvenli soru-cevap / ödev yardımı | 6–12 yaş çocuklar, ebeveynler | Günlük | Yaş doğrulaması zayıf; "arkadaş" gibi davranma riski | Ebeveynin tanımladığı sınırlar, şeffaf kayıt, kişilik taklidi yok |
| Ergenle iletişim köprüsü | Ergenler ve ebeveynleri | Haftalık | Ya tamamen gözetimsiz ya da gözetim aracı | Kritik: gizlilik dengesi yanlış kurulursa ürün güveni yok eder (bkz. Bölüm 4) |
| Kuşaklar arası üslup/dil köprüsü (gurbetteki torun ile Türkçe zayıf; büyükannenin sesli mesajının özeti) | Diaspora aileleri, çok kuşaklı aileler | Haftalık | Çeviri yapar ama aile bağlamını/hitapları bilmez | "Babaanneye uygun bir dille yaz" türü aile içi ince ayar |
| Ortak karar (tatil yeri, bayramda kimde toplanılacak) | Geniş aile | Aylık | Grup kararı aracı değiller | Sohbet içinde anket + özet + karar kaydı |

**Evrelere göre yorum:**
- **Bebek/küçük çocuklu aileler:** En yüksek "zihinsel yük" bu evrede. Aşı takvimi, uyku/mama kayıtları ve bakıcıyla bilgi paylaşımı öne çıkıyor. Bu kullanıcılar ödemeye en istekli segment ama en hızlı kayıp da burada yaşanıyor; çocuk büyüyünce ihtiyaç değişiyor.
- **Okul çağı:** Okul duyuruları, servis, kurs ve doğum günü partileri burada yoğunlaşıyor. Milo'nun kurucusunun tespiti önemli: Son on yılda okul/spor e-posta seli ve kayıt yazılımları yükü azaltmadı, artırdı. Türkiye bağlamında bu yük e-postadan çok WhatsApp veli gruplarından geliyor. Yuva'nın okul gruplarını göremeyeceğini kabul etmek gerekiyor. Kullanıcı mesajı Yuva'ya "ileterek" aktarmalı.
- **Yaşlı ebeveyne bakan yetişkin çocuklar:** En net ve en az hizmet alan ihtiyaç burada: ilaç listesi, doktor randevuları, kardeşler arası görev paylaşımı, dolandırıcılık riski. Duygusal değeri ve ödeme isteği yüksek.

## Bölüm 2 — Rakip ve Emsal Ürünler

### 2.1 Aile organizasyonu ve AI aile asistanları

| Ürün | Ne yapıyor | İş modeli | Gizlilik yaklaşımı | 2025–2026 durumu / ders |
|---|---|---|---|---|
| **Ohai.ai** (Care.com kurucusu Sheila Lirio Marcelo) | "O" adlı asistan; e-posta iletme, takvim birleştirme, yemek planı, Instacart, SMS/uygulama | Ücretsiz katman; Premium aylık 9,99 $, Premium Plus (2 kişi) 19,99 $, Premium Group 29,99 $ | Bağımsız bir incelemeye göre gizlilik bildirimi sohbet, takvim, e-posta ve dosyalara geniş erişim ile "insan asistanlar tarafından sınırlı inceleme" içeriyor | Ağustos 2025'te Muse Capital liderliğinde yatırım aldı; "AI + insan" hibriti. Gizlilik, en zayıf karnesi |
| **Milo** (Avni Patel Thompson, YC/OpenAI destekli) | SMS üzerinden aile kopilotu; sesli not, ekran görüntüsü → takvim/hatırlatma | ~40 $/ay | Bulut, GPT tabanlı, insan-döngüde | **Ocak 2026'da kapandı.** "Prompt, few-shot, fine-tune… umut verici demolar ama hayal kırıklığı yaratan üretim ve ölçek" |
| **Maple** | Takvim, görev, yemek, liste; "zihinsel yük" söylemi | Ücretsiz + Maple+ yıllık 40 $ | Bulut | **Wander'a satıldı, 31 Aralık 2026'da kapanıyor**, veriler kalıcı olarak silinecek |
| **Skylight Calendar + Sidekick** | Duvar/masa ekranı, takvim, görev, yemek planı; Sidekick AI fotoğraf/e-postadan etkinlik çıkarıyor | Donanım ~299–600 $ + Skylight Plus yıllık 79 $ | Bulut | İncelemeler Sidekick'in içe aktarmasını "tutarsız; hatalar, çift kayıtlar ve sessiz başarısızlıklar güveni aşındırıyor" diye tanımlıyor; abonelik zorunluluğu en sık şikâyet |
| **Amazon Alexa+** | Aile takvimi, belge/tarif yükleme ve hatırlama, Visual ID ile kişiye özel hatırlatma, ödev yardımı | Prime'a dahil (Şubat 2026'dan beri) veya ayrı ücret | Bulut, Amazon ekosistemi | Lojistik özelliklerini "bedava" hale getirerek bağımsız uygulamaların fiyatlama gücünü kırıyor |
| **Cozi, FamilyWall, TimeTree, OurHome, Picniic, Hearth Display** | Ortak takvim, liste, görev/ödül, aile ekranı | Genellikle reklamlı ücretsiz + abonelik ya da donanım | Klasik bulut senkronizasyonu | Bu araştırmada ayrıntılı kullanıcı yorumları doğrulanmadı; kategori olgun ve AI özellikleri (fotoğraftan etkinlik) 2026'da standart hale geldi |

**Bu tablodan çıkan ürün dersleri:**
- **"Her şeyi yapan aile AI'si" çalışmıyor; dar ve güvenilir işler çalışıyor.** Milo'nun kurucusu da sonunda tek bir "sağlam zemin" bulduklarını, sorunun oradan sonraki adımlarda başladığını yazıyor. Rakip analizleri de aynı sonuca varıyor: Bugün işe yarayan, e-postadan takvime gibi spesifik ve yüksek değerli görevler.
- **Milo'nun en önemli içgörüsü Yuva için bir uyarı ve bir fırsat:** "Görünmez yük tam olarak paylaşılamaz; birinin koordinasyonu üstlenmesi gerekir." Patel Thompson AI'nin bu merkezi rolü "her ebeveyne eşit hizmet ederek" üstlenebileceğini söylüyor. Yuva'da asistanın sohbetin içinde, herkese eşit görünen bir "aile üyesi" olması bu içgörüyle doğrudan örtüşüyor.
- **Gizlilik bu kategoride rekabet ekseni değil, zayıf nokta.** Ohai'nin insan incelemesi, Alexa'nın Amazon ekosistemi ve Maple'ın veri silmesi, "aileye ait" iddiası olan bir ürün için boş bir alan bırakıyor.

### 2.2 Aile hafızası ve arşiv ürünleri

| Ürün | Ne yapıyor | Kullanıcıların sevdiği / şikâyet ettiği |
|---|---|---|
| **Storyworth** | Yılda 52 haftalık soru, yanıtlar yıl sonunda ciltli kitap | Hediye olarak güçlü; eleştiriler: dikte orijinal sesi saklamıyor, haftalık format "ev ödevi" gibi hissettirebiliyor (bu eleştiriler rakip Remento'nun blogundan, taraflı kaynak) |
| **Remento** | Sesle/videoyla hikâye kaydı, "Speech-to-Story" AI ile metne dönüştürme, QR kodla sesli kitap | Yazamayan yaşlılar için kolay; bağımsız bir incelemeye göre AI düzenleme sadece ses kaydından beslendiği için sonradan yazılan eklemeleri yok sayıyor, ek kopyalar 69–99 $ |

**Ders:** Hafıza ürünleri "hediye anı" (doğum günü, Anneler Günü) etrafında satılıyor ve tek seferlik bir proje gibi işliyor. Günlük alışkanlık yaratmıyorlar. Remento'nun "sesi sakla" vurgusu ise önemli: Yaşlı ebeveynin sesi, ailenin en değerli dijital varlıklarından biri. Bu, cihazda saklanması ve hiçbir şirketin eline geçmemesi gereken bir veri türü.

### 2.3 Yaşlı bakımı asistanları

**ElliQ (Intuition Robotics):** Masa üstü, proaktif konuşan bir yol arkadaşı robot. Başlangıç ücreti 249 $, aylık 39–59 $. New York Eyalet Yaşlılık Ofisi (NYSOFA) programı üç yıllık 2,1 milyon dolarlık yeni bir anlaşmayla uzatıldı. 2025'te 3.500'den fazla yaşlı başvurdu. NYSOFA'nın 2026 tarihli "Three Years of Success with ElliQ and NYSOFA" raporuna göre katılımcıların %94'ü kendini daha az yalnız hissettiğini söylüyor; Mayıs 2025 itibarıyla programa 834 yaşlı katılmış ve memnuniyet 4,6/5. Bir hakemli değerlendirme ise uzun vadeli sonuç verilerinin "henüz oluşmakta" olduğunu not ediyor. Bu rakamlar şirket ve kamu ortağının öz-raporlarına dayanıyor, kontrollü deney değil. **Ders:** Yaşlılar *proaktif* ve *sesli* bir arayüzle gerçekten etkileşime giriyor. Ancak ElliQ yaşlıyı aileden bağımsız bir "arkadaş"la baş başa bırakıyor. Yuva'nın fırsatı, yaşlıyı yapay bir arkadaşa değil, *gerçek ailesine* bağlayan bir arayüz olmak.

### 2.4 Gizlilik odaklı / yerel AI ürünleri

- **Home Assistant Assist:** 2026'da tamamen yerel ses hattı (Whisper → Assist → Ollama/llama.cpp → Piper) olgunlaştı. 2026.8 sürümü llama.cpp ve LiteLLM'i birinci taraf entegrasyon olarak ekledi. Komut-kontrol için "üretime hazır" deniyor. Pratik bir sınır var: Home Assistant her istekte görünür cihazları modelin bağlamına ekliyor; ~30 cihaz yaklaşık 1.300 token tutuyor, Ollama entegrasyonu varsayılan olarak 8K bağlam kullanıyor. **Ders:** "Ev beyni" mimarisi teknik meraklılar için çalışıyor, ortalama aile için kurulum hâlâ engel.
- **Rewind/Limitless:** "Her şeyi kaydet, yerelde ara" ürünü önce buluta kaydı, sonra Meta'ya satıldı. Kişisel hafıza kategorisinin en somut uyarısı bu.

## Bölüm 3 — Teknik ve Mimari Seçenekler

### 3.1 (a) Tamamen cihaz üzerinde

**Apple Foundation Models (iOS 26+):** Apple Intelligence'ın ~3B parametreli on-device modeline ücretsiz, çevrimdışı erişim veriyor. Yapılandırılmış çıktı (@Generable), araç çağırma (tool calling) ve LoRA adaptörleri destekleniyor. Kritik sınırlar şunlar:
- Bağlam penceresi 4.096 token. Apple'ın geliştirici forumunda bu açıkça belirtiliyor ve girdi + çıktı toplamını kapsıyor.
- Yerleşik embedding modeli yok. Apple, RAG için Natural Language çerçevesindeki basit kelime/cümle gömmelerini öneriyor.
- Arka planda hız sınırları var.
- Her OS güncellemesinde LoRA adaptörlerinin yeniden eğitilmesi gerekiyor.
- Desteklenen cihaz tabanı iPhone 15 Pro ve sonrası.
- İkincil kaynaklara göre Private Cloud Compute modeli aynı API üzerinden, bir izinle (entitlement), 32K bağlam sunuyor. Bu ayrıntı Apple'ın birincil belgesinden doğrulanmadı.

**Google Gemini Nano / ML Kit GenAI:** Prompt API Ekim 2025'te alfa olarak çıktı. Google'a göre en iyi Pixel 10 serisinde (nano-v3) çalışıyor. InfoQ'nun aktardığı sınırlamalar: zorunlu pil kotaları ve arka planda çalıştırma desteği yok. Android Developers Blog'un 21 Temmuz 2026 tarihli yazısına göre Gemini Nano 140 milyondan fazla cihazda çalışıyor, ancak cihaz parçalanması Android'de gerçek bir sorun: InfoQ'ya göre Pixel 10 dışındaki cihazlar (Pixel 9, Galaxy Z Fold7, Xiaomi 15) yalnızca daha az yetenekli Nano-v2 modeliyle çalışıyor. Yuva kullanıcılarının ailesindeki orta segment telefonlarda bu model büyük olasılıkla bulunmayacak.

**Açık modeller (Qwen/Gemma/Llama/Phi) + llama.cpp/MLC/MediaPipe/ExecuTorch:** Platformdan bağımsızlık sağlıyor ama model dağıtımı (1–2 GB indirme) ve ısı yönetimi sizin sorumluluğunuzda kalıyor. Ölçümler şunu gösteriyor:
- Llama 3.2 3B, iPhone 16 Pro'da başlangıçta ~37,6 token/sn'ye çıkıyor, ısınma sonrası ~22,6 token/sn'ye düşüyor (ikincil derleme).
- Bir hakemli ön baskıda Galaxy S24 Ultra, GPU sıcaklığı 78,3°C'ye ulaşınca Android'in termal yöneticisi tarafından durduruldu.
- iPhone 16 Pro'da 20 çıkarım iterasyonu bataryanın ~%10'unu tüketti.
- Başka bir çalışma, sürekli yükte throughput'un soğuk başlangıcın yaklaşık yarısına düştüğünü gösteriyor.

**Sonuç:** Telefon, *kısa ve tetiklemeli* işler için (bir mesajdan etkinlik çıkarmak, bir belgeyi etiketlemek, 2–3 cümlelik yanıt) iyi bir çalışma ortamı. Uzun sohbet, büyük belge özetleme veya sürekli arka plan işleme için değil. Yuva asistanı "her mesajı sürekli işleyen" değil, "olay geldiğinde kısa iş yapan" biçimde tasarlanmalı.

### 3.2 (b) Aile içinde bir "ev beyni"

Ailedeki bir cihaz (Mac mini, N100 mini PC, NAS, hatta şarjda duran eski bir iPad) daha büyük modeli çalıştırır, diğer cihazlar yerel ağ veya P2P üzerinden ona istek gönderir.
- **Artıları:** 7–8B ve üstü modeller, daha uzun bağlam, telefonda pil/ısı sorunu yok. Home Assistant topluluğunun deneyimi, Raspberry Pi 5'te 3B modelin, N100 veya GPU'lu makinede 8B+ modelin pratik olduğunu gösteriyor.
- **Eksileri:** Ev dışındayken erişim için bir aktarma (relay) ya da NAT geçişi gerekiyor. Bu, "sunucusuz" iddiasını zorlar; sunucu aileye ait olsa da artık bir sunucu var. Kurulum ve bakım yükü genellikle ailenin "teknik çocuğu"na kalıyor. Cihaz kapalıyken asistan zayıflıyor.
- **Yuva için öneri:** Ev beyni **isteğe bağlı bir hızlandırıcı** olmalı, zorunlu bir bileşen değil. Ailede uygun cihaz varsa ağır işler (uzun özetler, aile arşivi araması, ses kaydı transkripsiyonu) ona kuyruklanır. Yoksa sistem telefonlarda daha dar kapsamla çalışır.

### 3.3 (c) Gizlilik korunarak bulut

- **Apple Private Cloud Compute (PCC):** Beş ilke üzerine kurulu: durumsuz hesaplama, uygulanabilir garantiler, ayrıcalıklı erişim yok, hedeflenemezlik, doğrulanabilir şeffaflık. Apple her üretim yapısının yazılım imajını yayımlıyor, güvenlik açısından kritik kaynak kodunun bir alt kümesini paylaşıyor, Mac üzerinde çalışan bir Sanal Araştırma Ortamı sunuyor ve bunu güvenlik ödül programına bağlıyor. Haziran 2026'da PCC, NVIDIA Confidential Computing ve Intel TDX ile Google Cloud'a genişletildi. Eleştiriler de var: Yayımlanan kaynak yalnızca bir alt küme ve araştırma lisanslı; bağımsız bir analiz tekrarlanabilir yapı (reproducible build) eksikliğini not ediyor.
- **Anonimleştirip sadece sorguyu göndermek:** "Kombi E1 hatası nasıl giderilir?" gibi genel bilgi soruları için iyi çalışıyor. "Annemin ilaçlarıyla bu ağrı kesici etkileşir mi?" gibi aile bağlamı içeren sorularda anonimleştirme kırılgan. İlaç adı + yaş + şehir kombinasyonu bile yeniden tanımlamaya yol açabilir.
- **Hibrit yönlendirme kuralı (önerilen):**
  1. Aile verisine dokunan her şey → cihazda veya ev beyninde.
  2. Aile verisi içermeyen genel bilgi → kullanıcı açıkça "dışarıya sor" dediğinde, kimlik bilgisi olmadan buluta. Arayüzde bu, görünür bir "🌐 Dışarı soruluyor" etiketiyle belirtilir.
  3. Hassas + ağır iş → yalnızca doğrulanabilir gizli bulut (PCC benzeri) ve aile yöneticisinin önceden verdiği rıza ile.

### 3.4 Ortak aile hafızası: local-first veri + şifreli paylaşım + rol modeli

- **Veri katmanı:** Yuva muhtemelen zaten CRDT tabanlı senkronizasyon kullanıyor. Aile Defteri bunun üzerine yapılandırılmış belgeler olarak eklenebilir: "kişi", "ilaç", "cihaz", "evrak", "tarif", "hikâye", "etkinlik". Automerge/Yjs veya SQLite + CRDT senkronizasyonu (cr-sqlite benzeri) seçenekler arasında. Asistanın çıkardığı her öğe, sohbetteki kaynak mesaja bağlanmalı. Böylece "bunu nereden biliyorsun?" sorusunun her zaman bir yanıtı olur.
- **Erişim kontrolü:** Merkezi sunucu olmadan "çocuk bunu göremez, bakıcı sadece şunu görür" demek zor bir problem. Ink & Switch'in açık kaynaklı Keyhive projesi tam olarak bunu hedefliyor:
  - Yetki devri zincirleriyle okuma/yazma/yönetici yetkileri tanımlanıyor ("convergent capabilities").
  - Merkezi sunucu gerektirmeyen, eşzamanlı güncellenebilen bir grup anahtar anlaşması (BeeKEM, TreeKEM varyantı) kullanılıyor.
  - Veri durağan halde şifreleniyor.
  - Kod hâlâ "pre-alpha".
  - Ink & Switch, BeeKEM'in yerel-öncelikli bağlamda ileri gizliliği (forward secrecy) bilinçli olarak öncelemediğini açıkça yazıyor.
  - **Pratik öneri:** Yuva, rol başına ayrı şifreli "koleksiyonlar" ile başlamalı (Ebeveynler, Tüm Aile, Bakıcı, Çocuklar). Her koleksiyonun kendi grup anahtarı olmalı. Belge düzeyinde ince taneli yetki daha sonra gelebilir.
- **Yerel RAG:** Gömme (embedding) üretimi ve vektör araması cihazda yapılır (SQLite + vektör eklentisi). Gömmeler ilgili koleksiyonun anahtarıyla şifrelenmeli. Aksi halde çocuğun cihazındaki indeks, göremediği belgelerin anlamını sızdırabilir. Bu, sık atlanan bir tasarım hatası.
- **Rol/izin modeli örneği:**

| Veri | Ebeveyn | Ergen | Çocuk (<13) | Büyükanne | Bakıcı |
|---|---|---|---|---|---|
| Ev bilgi tabanı (wifi, kombi) | ✓ | ✓ | Kısmen | ✓ | ✓ |
| Aile takvimi | ✓ | ✓ (kendi + ortak) | Sadece kendi | ✓ | İlgili etkinlikler |
| Sağlık/ilaç | ✓ | Sadece kendi | — | Sadece kendi + izin verilen | Sadece bakılan kişininki |
| Finans/evrak | ✓ | — | — | Kendi evrakı | — |
| Aile hikâyeleri | ✓ | ✓ | ✓ (seçilmiş) | ✓ | — |
| Ergenin asistanla özel sohbeti | **— (varsayılan kapalı)** | ✓ | — | — | — |

### 3.5 Mimari seçeneklerin karşılaştırması

| Seçenek | Gizlilik | Kalite | Maliyet (Yuva için) | Geliştirme zorluğu | Ne zaman |
|---|---|---|---|---|---|
| Sadece cihaz üstü (Apple FM / Gemini Nano) | Çok yüksek | Dar işler için iyi, sohbet için zayıf | ~0 (çıkarım ücretsiz) | Orta; iki platform, iki API, cihaz parçalanması | MVP |
| Cihaz üstü açık model (llama.cpp vb.) | Çok yüksek | Model seçimine bağlı | ~0, ama indirme boyutu ve destek yükü var | Yüksek | Eski/orta segment cihazlar için fallback |
| Ev beyni | Yüksek | İyi (7–8B+) | Kullanıcıya donanım maliyeti | Yüksek; keşif, eşleştirme, uzaktan erişim | Faz 2, "pro aile" |
| Doğrulanabilir gizli bulut (PCC benzeri) | Yüksek (doğrulamaya bağlı) | Çok iyi | Sorgu başına maliyet | Orta–yüksek | Faz 2–3, açık rıza ile |
| Klasik bulut LLM API | Düşük–orta | En iyi | Sorgu başına maliyet | Düşük | Sadece anonim genel bilgi sorguları için |

## Bölüm 4 — Güven ve Güvenlik

### 4.1 Çocuklar

- **Bağlam:** Common Sense Media'nın 1.060 gençle yaptığı temsili ankette 13–17 yaşındakilerin %72'si AI "arkadaşı" denemiş, %52'si düzenli kullanıcı. Common Sense Media'nın soru sonuçlarına göre AI arkadaşı kullananların (n=758) %33'ü ciddi bir konuyu insan yerine AI ile konuşmayı seçmiş (%17 bir-iki kez, %12 ara sıra, %4 sık sık). Kurum, 18 yaş altının yeterli güvenceler gelene kadar AI arkadaşları kullanmamasını öneriyor. Küçük ergenler (13–14) yapay zekâ tavsiyesine büyüklerden daha fazla güveniyor.
- **Düzenleyici sinyaller:** FTC 11 Eylül 2025'te Alphabet, Character.AI, Instagram, Meta, OpenAI, Snap ve xAI'ye 6(b) emirleri gönderdi. Soruşturma; çocuklar üzerindeki etkilerin nasıl ölçüldüğünü, kullanımın nasıl kısıtlandığını, etkileşimin nasıl paraya çevrildiğini ve COPPA uyumunu kapsıyor. Güncellenen COPPA Kuralı 23 Haziran 2025'te yürürlüğe girdi. 13 yaş altı için hedefli reklama ayrı ebeveyn onayı gerekiyor ve veri saklama ile üçüncü taraf paylaşımı sıkılaştırıldı.
- **Yuva için tasarım ilkeleri:**
  1. Çocuk modunda asistan **bir "arkadaş" kişiliği taklit etmemeli**: isim, duygu ifadesi, "seni özledim" yok.
  2. Etkileşimi uzatacak hiçbir mekanik olmamalı: seri ödülleri, bildirimle geri çağırma yok.
  3. Ebeveyn, çocuğun asistanla neler konuştuğunun *özetini* görebilmeli (çocukla birlikte kararlaştırılan şeffaflık düzeyinde).
  4. Kendine zarar verme gibi kriz sinyallerinde asistan tanı koymaya veya terapist rolüne girmemeli. Önceden tanımlı bir aile yetişkinine ve profesyonel yardım hattına yönlendirmeli.

### 4.2 Ergenin mahremiyeti vs ebeveyn gözetimi

Bu araştırmada ergen gözetimi üzerine özel bir akademik kaynak doğrulanmadı. Yine de ürün ilkesi net olmalı: **Ergenin asistanla özel konuşmaları varsayılan olarak ebeveyne kapalı olmalı.** Bunun dışında kalan dar ve önceden açıklanmış bir güvenlik istisnası olabilir (ör. açık intihar riski). Bu istisna ergene açıkça anlatılmalı. Aksi takdirde ergen asistanı kullanmayı bırakır ya da daha kötüsü, gizliliğini koruyan bir dış AI arkadaşına yönelir. Common Sense verisi, bu yaş grubunun zaten bu ürünlere yöneldiğini gösteriyor. Ortak alanlar (aile takvimi, ev bilgisi) ise herkese açık olmalı.

### 4.3 Yaşlıları dolandırıcılıktan koruma

- **Ölçek:** FBI IC3'ün 2025 raporuna göre 60 yaş üstü 201.266 şikâyet yaptı (2024'e göre %37 artış). Kayıp 7,748 milyar dolar (%59 artış), ortalama kayıp 38.500 dolar; 12.444 kişi 100.000 doların üzerinde kaybetti. En büyük kalemler yatırım dolandırıcılığı (IC3'ü aktaran HousingWire'a göre 3,52 milyar $) ve teknik/müşteri destek dolandırıcılığı (21.333 şikâyette 1,04 milyar $). FBI'ın basın bültenine göre sesi klonlanmış "başı dertte aile üyesi" aramaları dahil yapay zekâ ile ilişkili 22.364 şikâyette yaklaşık 893 milyon dolar kayıp yaşandı; HousingWire'ın aktardığı IC3 verisine göre 60 yaş üstünden yapay zekâya atıf yapan 3.100'den fazla şikâyette kayıp 352 milyon doları aştı. Bu veriler ABD'ye ait; Türkiye'ye ait karşılaştırılabilir veri bu araştırmada bulunamadı. Ancak "polis/savcı" ve "yeni numaradan akraba" dolandırıcılığı Türkiye'de de bilinen kalıplar.
- **Yuva'nın yapısal avantajı:** Yuva, aile üyelerinin *kriptografik kimliğini* zaten biliyor. Bu kimliğe dayanarak:
  - "Bu numara/ses gerçekten oğlum mu?" sorusuna asistan "Ahmet'in Yuva'daki doğrulanmış cihazından son 3 gün içinde böyle bir mesaj gelmedi; ona Yuva üzerinden sormak ister misin?" diyebilir.
  - Aile bir "güvenli kelime" belirleyebilir.
  - Yaşlı, asistana şüpheli bir SMS'in ekran görüntüsünü gösterebilir; yerel model tanınmış kalıpları ("acil para", "hesabınız bloke", "kimseye söylemeyin") işaretler ve önceden belirlenmiş bir aile üyesine haber verir.
  - Bu, genel asistanların yapamayacağı bir şey. Çünkü onların "aile" kavramı yok.

### 4.4 Regülasyon (Türkiye ve AB)

- **KVKK (6698):**
  - Sağlık ve biyometrik veri özel nitelikli kişisel veridir (md. 6). 2024 değişikliğinden sonra açık rıza dahil sayılı şartlara bağlıdır.
  - Yurt dışına aktarım 1 Haziran 2024'ten beri yeterlilik kararı veya standart sözleşme gibi güvencelere bağlı (md. 9). Henüz hiçbir ülke için yeterlilik kararı yok. Standart sözleşmenin imzadan sonra 5 iş günü içinde Kurum'a bildirilmesi gerekiyor. Açık rıza yalnızca arızi aktarımlar için bir istisna olarak kaldı.
  - Bu, Yuva asistanının herhangi bir yabancı LLM API'sine aile verisi göndermesinin ciddi bir hukuki yük olduğu anlamına geliyor.
  - KVKK md. 28(1)(a)'daki istisna, verinin "aynı konutta yaşayan aile fertlerinin" tamamen kişisel faaliyetleri kapsamında işlenmesini kapsıyor. Ayrı evde yaşayan büyükanne bu istisnanın dışında kalabilir.
  - Kurum, 24 Kasım 2025'te "Üretken Yapay Zekâ ve Kişisel Verilerin Korunması Rehberi (15 Soruda)"nı yayımladı. Rehber, ebeveynlerin çocukların üretken yapay zekâ kullanımında alabileceği önlemleri de ele alıyor.
  - Türkiye'de çocuklar için kanunda bir rıza yaşı yok; uygulamada veli rızası esas alınıyor. Kurul 20 Şubat 2026'da büyük sosyal medya platformlarının çocuk verisi işlemesine ilişkin re'sen inceleme başlattı.
- **GDPR (AB'deki gurbetçi aileler için):**
  - md. 2(2)(c) "tamamen kişisel veya ev içi faaliyet" istisnası aile üyelerinin kendisini koruyabilir.
  - Ancak Gerekçe 18 açıkça, bu faaliyetler için *araç sağlayan* kontrolör ve işleyenlerin tüzüğe tabi olduğunu söylüyor. Yani Yuva'yı geliştiren şirket istisnadan yararlanamaz, özellikle aktarma sunucusu işletiyor veya uygulamayı ticari olarak dağıtıyorsa.
  - md. 8 uyarınca 16 yaş altı (üye devletler 13'e kadar indirebilir) için rızaya dayalı işlemede ebeveyn onayı gerekiyor.
- **AB Yapay Zekâ Yasası md. 50:** Doğrudan insanlarla etkileşen yapay zekâ sistemlerinin sağlayıcıları, kullanıcıya bir yapay zekâ ile konuştuğunu ilk etkileşimde açıkça bildirmekle yükümlü. Bu yükümlülük 2 Ağustos 2026'dan beri uygulanıyor. Dijital Omnibus (Tüzük 2026/1744) md. 50'yi genel olarak ertelemedi. Yalnızca 2 Ağustos 2026'dan önce piyasada olan üretken sistemlere, makine tarafından okunabilir işaretleme (md. 50(2)) için 2 Aralık 2026'ya kadar süre verdi. Komisyon'un SSS'si, kişisel ve mesleki olmayan kullanımı "uygulayıcı" tanımının dışında tutuyor; aile bu yükümlülüğün muhatabı değil, ama Yuva'yı geliştiren sağlayıcı muhatap. Bu araştırmada Omnibus'un Resmî Gazete metni doğrudan açılamadı; tarihler birbiriyle tutarlı hukuk firması özetlerine dayanıyor.
- **Pratik sonuç:** Mimari ne kadar yerel olursa hukuki yük o kadar azalır. Bu, Yuva felsefesinin teknik bir tercih olmasının ötesinde bir *uyum stratejisi* olduğu anlamına geliyor. Yine de "sunucusuzuz, KVKK bizi ilgilendirmez" varsayımı yanlış. Geliştirici olarak aydınlatma, güvenlik ve (bulut kullanılıyorsa) aktarım yükümlülükleri sürüyor.

## Bölüm 5 — Sentez: Yuva için Asistan Konseptleri

### Konsept 1 — Aile Defteri (ev ve aile bilgi tabanı)

- **Tanım:** Ailenin paylaşılan, yapılandırılmış ve şifreli bilgi tabanı. Asistan sohbetten ve fotoğraflardan besliyor ve soruları ondan yanıtlıyor.
- **Çözdüğü problem:** "O bilgi kimdeydi?" Wifi şifresi, kombi kılavuzu, garanti belgeleri, sigorta, doktor iletişim bilgileri, çocukların beden ölçüleri, apartman yöneticisinin numarası.
- **Örnek diyaloglar:**
  - Bakıcı: "@Yuva kombi E1 hatası veriyor." → Asistan: "Geçen Kasım Mehmet Bey bu hatayı basınç düşüklüğü diye yazmıştı. Musluk kombinin altında, kılavuzun 12. sayfası. Fotoğrafı burada. Basınç 1,5 bar'a gelince musluğu kapat."
  - Anne: (garanti belgesinin fotoğrafını atar) → Asistan: "Bulaşık makinesi garantisi 14 Mart 2028'e kadar. Deftere kaydettim, bitmeden bir ay önce hatırlatırım."
  - Büyükanne: "Torunların ayakkabı numarası kaç?" → Asistan, Ebeveynler koleksiyonunda izin verilmişse yanıt verir.
- **Neden aileye özel olmalı:** Bilginin kendisi aileye ait, genel asistanlarda yok. Şifreler ve evrak dışarı çıkmamalı.
- **Mimari:** Cihaz üstünde yapılır: OCR (iOS Vision / ML Kit), küçük model ile alan çıkarma (Apple FM @Generable / Gemini Nano Prompt API), yerel gömme ve arama. Kısa yanıtlar 4K bağlama sığar. Bulut gerekmez. Ev beyni varsa uzun kılavuz özetleri ona gider.
- **Yuva entegrasyonu:** Sohbette "@Yuva" ile çağrılan bir aile üyesi. Ayrıca uygulamada "Defter" sekmesi olur ve her kayıt kaynak mesaja bağlanır.
- **MVP:** 5 sabit şablon (Ev, Cihazlar, Evrak/Garanti, Kişiler/İletişim, Sağlık Özeti). Fotoğraf → alan çıkarma → kullanıcı onayı → kayıt. Doğal dilde arama. Koleksiyon bazlı paylaşım (Ebeveynler/Tüm Aile/Bakıcı).
- **Riskler:** Çıkarma hataları (Skylight Sidekick'in yaşadığı "sessiz başarısızlık" sorunu). Çözüm: Her kayıt kullanıcı onayından geçer, otomatik kayıt yapılmaz. Bir diğer risk "boş defter" problemi, yani ilk değer görülene kadar veri girişi gerekmesi.
- **Farklılaşma:** Genel asistanlar *sizin* evinizi bilmiyor. Bulut aile uygulamaları bu düzeyde hassas veriyi (şifre, sağlık) güvenle tutamıyor ve şirket kapanınca siliyor (Maple).

### Konsept 2 — Sohbetten Plana (lojistik yakalayıcı)

- **Tanım:** Aile sohbetindeki tarih, saat, görev ve sorumluluk ifadelerini fark edip tek dokunuşla takvime/görev listesine dönüştüren pasif asistan.
- **Çözdüğü problem:** Aile kararları sohbette kayboluyor ("Cumartesi annemlerde yemek" → kimse takvime yazmıyor).
- **Örnek diyalog:** Baba: "Perşembe Lina'nın dişçisi 16:30'da, ben alamam." → Mesajın altında küçük bir öneri kartı belirir: "📅 Perşembe 16:30 – Lina dişçi. Götürecek kişi: ? [Ben alırım] [Ayşe'ye sor]". Anne "Ben alırım"a basar. Etkinlik takvime girer ve bir saat önce annenin telefonunda hatırlatma çıkar.
- **Neden aileye özel olmalı:** Sohbet zaten Yuva'da, uçtan uca şifreli. Bulut asistanların bu sohbeti görmesi Yuva'nın varlık sebebine aykırı.
- **Mimari:** Tamamen cihaz üstü. Kısa mesaj başına yapılandırılmış çıkarım küçük modellerin en güçlü olduğu iş. Isı/pil açısından da hafif, çünkü sadece tarih/saat ifadesi içeren mesajlarda tetikleniyor. Önce kural tabanlı bir ön filtre çalışıyor, model ancak ondan sonra devreye giriyor.
- **MVP:** Öneri kartı + ortak aile takvimi (CRDT) + kişi atama + hatırlatma. Google/Apple takvime tek yönlü dışa aktarma isteğe bağlı.
- **Riskler:** Kategori kalabalık ve Alexa+ ile Skylight bunu "bedava" yapıyor. Bu konsept tek başına satılamaz; Yuva'nın günlük kullanım motoru olarak değerli.
- **Farklılaşma:** Diğerleri e-postadan/fotoğraftan çıkarıyor. Yuva'nınki *aile konuşmasının kendisinden* çıkarıyor ve sorumluluk atamayı ("kim alacak?") sohbetin doğal parçası yapıyor.

### Konsept 3 — Aile Kalkanı (yaşlılar için doğrulama ve kolay erişim)

- **Tanım:** Yaşlı aile üyeleri için sade, sesli bir arayüz ve aile kimliğine dayalı bir dolandırıcılık doğrulama katmanı.
- **Çözdüğü problem:** Yaşlıların dolandırıcılığa açıklığı ve teknolojiyle yalnız kalması. Yetişkin çocukların "annem bir şey tıklar mı" kaygısı.
- **Örnek diyaloglar:**
  - Büyükbaba (sesli): "Bir adam aradı, Alex'in kaza yaptığını, acil para lazım olduğunu söyledi." → Asistan: "Alex'in Yuva'daki cihazı 10 dakika önce aktifti. Ona şimdi Yuva'dan sesli arama yapalım mı? Ayrıca ailenin belirlediği güvenlik kuralına göre Elif'e de haber veriyorum. Lütfen kimseye para göndermeyin."
  - Büyükanne: "Torunum Defne'nin doğum günü ne zaman, ne sever?" → Asistan, aile takvimi ve Defter'den yanıt verir.
- **Neden aileye özel olmalı:** Doğrulamanın tamamı aile kimliğine dayanıyor. Bunu bir dış asistan yapamaz.
- **Mimari:**
  - Ses → metin cihazda çalışır (iOS Speech / ML Kit Speech Recognition; Gemini Nano tabanlı gelişmiş mod şimdilik Pixel 10'la sınırlı).
  - Şüpheli kalıp tespiti küçük modelle cihazda yapılır.
  - Doğrulama Yuva'nın mevcut P2P kimlik altyapısıyla yapılır.
  - Bulut gerekmez.
- **MVP:** "Büyük ekran modu" + tek tuşla sesli soru + "şüpheli mesaj/arama bildir" butonu + güvenli kelime + önceden belirlenmiş "aile koruyucusu" bildirim akışı.
- **Riskler:**
  - Telefon görüşmesinin kendisini dinlemek iOS'ta mümkün değil ve etik olarak da sorunlu. Asistan sadece yaşlının *anlattığı* veya ekran görüntüsüyle *gösterdiği* şeyle çalışabilir.
  - Yanlış alarmlar güveni aşındırabilir.
  - Yaşlının özerkliği korunmalı. Asistan yaşlıyı "izleyen" bir şey değil, onun çağırdığı bir yardımcı olmalı.
- **Farklılaşma:** ElliQ yaşlıyı yapay bir arkadaşla baş başa bırakıyor. Aile Kalkanı onu gerçek ailesine bağlıyor. Bu, piyasada boş bir konum.

### Konsept 4 — Bakım Masası (sağlık ve yaşlı bakım koordinasyonu)

- **Tanım:** Bir aile üyesinin (bebek, kronik hasta, yaşlı ebeveyn) ilaç, randevu ve bakım görevlerini kardeşler/ebeveynler arasında koordine eden paylaşımlı kayıt.
- **Örnek diyalog:** Kardeş 1: "@Yuva annem bugün tansiyon ilacını içti mi?" → Asistan: "Saat 09:10'da Hatice Hanım 'içtim' butonuna bastı. Akşam dozu 21:00'de. Bu hafta Cuma kardiyoloji randevusu var, götürecek kişi atanmadı."
- **Neden aileye özel olmalı:** KVKK'da sağlık verisi özel nitelikli. Yerel ve şifreli tutmak hem hukuki hem duygusal olarak doğru seçim.
- **Mimari:** Cihaz üstü. İlaç kutusundan OCR ile ilaç adı okunur. **İlaç etkileşimi gibi tıbbi tavsiye verilmez.** Asistan yalnızca kayıt tutar ve hatırlatır.
- **MVP:** İlaç listesi + doz hatırlatma + "aldım" onayı + randevu + bakıcı atama + "acil durum kartı" (kan grubu, alerjiler, ilaçlar, doktor; kilit ekranından/çevrimdışı erişilebilir).
- **Riskler:** Tıbbi tavsiyeye kayma, sorumluluk ve yanlış hatırlatma. Kapsam katı biçimde "kayıt ve koordinasyon" ile sınırlı tutulmalı.

### Konsept 5 — Aile Hikâye Arşivcisi (kuşaklar arası hafıza)

- **Tanım:** Büyükanne/büyükbabadan sesli hikâye, tarif ve anı toplayan; bunları ses kaydı + metin + fotoğrafla aileye ait bir arşive dönüştüren asistan.
- **Örnek diyalog:**
  - Asistan, Pazar sabahı büyükanneye: "Ayşe Hanım, torununuz Deniz sizden bir şey öğrenmek istiyor: Dedemle nasıl tanıştınız?" → Büyükanne sesli yanıt verir.
  - Akşam aile grubunda: "Babaannenin yeni hikâyesi: 'Ankara'ya ilk geliş, 1968' (4 dk ses, metni hazır)." Deniz soruyu oylamayla seçmişti.
  - Tarif modu: "Babaannenin yaprak sarması" ses kaydından ölçülerle birlikte yapılandırılmış tarife dönüşür.
- **Neden aileye özel olmalı:** Yaşlı ebeveynin sesi ve hikâyeleri ailenin en değerli varlığı. Remento/Storyworth bu verileri kendi sunucularında tutuyor ve şirketin geleceğine bağlı.
- **Mimari:**
  - Transkripsiyon cihazda (Whisper türevi) veya ev beyninde yapılır.
  - Metni "kitap diline" çevirme gibi uzun işler ev beynine ya da açık rızayla gizli buluta gider.
  - Ses dosyaları CRDT senkronizasyonu yerine içerik adresli blob olarak P2P dağıtılır.
- **MVP:** Haftalık soru + sesli yanıt + transkript + aile grubunda paylaşım + basit dışa aktarma (PDF/ses).
- **Riskler:**
  - Düşük sıklık. Haftada bir etkileşim alışkanlık yaratmıyor.
  - Remento'nun yaşadığı "AI metni orijinalden uzaklaştırıyor" sorunu. Orijinal ses ve ham transkript her zaman korunmalı.
  - Depolama: Sesler büyük ve tüm cihazlarda tam kopya tutmak pahalı.
- **Farklılaşma:** "Şirket batsa da babaannenin sesi ailede kalır." Duygusal ve somut bir vaat.

### Konsept 6 — Güvenli Soru Arkadaşı (çocuk modu)

- **Tanım:** 6–12 yaş için ebeveynin sınırlarını belirlediği, kişilik taklidi yapmayan, ödev ve merak sorularına yaş uygun yanıt veren mod.
- **Değerlendirme:** Kullanıcı değeri gerçek. Ancak cihaz üstü 3B model çocuğun "dinozorlar neden yok oldu?" sorusunu iyi yanıtlayabilir, kesirler konusunda ise hata yapabilir. Ödev yardımı doğruluk gerektiriyor; genel bilgi için buluta gitmek gerekiyor ve bu da Yuva'nın en güçlü vaadini sulandırıyor. Üstelik bu alan, FTC'nin ve düzenleyicilerin en yakından izlediği alan. **Öneri:** Bağımsız bir ürün olarak değil, Konsept 1–5'in çocuklara uygun bir *görünümü* olarak ele alınmalı: "Babaannenin hikâyesini dinle", "Bugün ne var?", "Kendi görevlerim". Bilgi/ödev botu olarak başlamayın.

### Açıkça zayıf bulduğum fikirler

- **Otomatik aile bütçesi:** Banka entegrasyonu sunucusuz mimariyle neredeyse imkânsız. Elle giriş ise kimsenin sürdürmediği bir alışkanlık.
- **Ergen gözetim asistanı:** Aileye güveni yok eder ve ergeni dış AI arkadaşlarına iter.
- **Çocuğa "AI arkadaş":** Etik, regülasyon ve marka riski yüksek. Common Sense ve FTC'nin odak noktası tam olarak bu.
- **Her mesajı sürekli işleyen proaktif "her şeyi bilen" asistan:** Milo'nun dersi açık: Teknoloji bunun için güvenilir değil. Telefonda pil ve ısı maliyeti de var.
- **Ayrı bir "ortak karar" asistanı:** Basit bir anket özelliği işin çoğunu görüyor; Sohbetten Plana'nın bir özelliği olarak yeterli.
- **"Ev beyni" zorunluluğu:** Ortalama aile için kurulum engeli. Ancak isteğe bağlı bir hızlandırıcı olarak mantıklı.

### Karşılaştırma tablosu (1–5 ölçeği; 5 = en iyi)

| Konsept | Kullanıcı değeri | Kullanım sıklığı | Teknik yapılabilirlik (cihaz üstü, 2026) | Farklılaşma / "aileye özel" gerekliliği | Regülasyon/etik riski (5 = düşük risk) | Toplam |
|---|---|---|---|---|---|---|
| 1. Aile Defteri | 4 | 4 | 5 | 5 | 4 | **22** |
| 2. Sohbetten Plana | 4 | 5 | 5 | 3 | 5 | **22** |
| 3. Aile Kalkanı | 5 | 2 | 4 | 5 | 4 | **20** |
| 4. Bakım Masası | 5 | 4 | 4 | 4 | 3 | **20** |
| 5. Hikâye Arşivcisi | 5 | 2 | 3 | 5 | 4 | **19** |
| 6. Güvenli Soru Arkadaşı | 4 | 4 | 2 | 2 | 2 | **14** |

### En umut verici iki yön

**1) "Aile Defteri + Sohbetten Plana" birleşik çekirdeği.** Bu, Yuva'nın günlük kullanım motoru olmalı. Gerekçeler:
- Günlük sıklık sağlıyor.
- Bugünkü cihaz üstü modellerin *en güçlü olduğu* işe dayanıyor: kısa metinden yapılandırılmış çıkarım ve küçük bilgi tabanından yanıt.
- Buluta ihtiyaç duymuyor; Yuva felsefesini bozmuyor ve KVKK yükünü en aza indiriyor.
- Her kullanımda Defter biraz daha doluyor ve bu da zamanla kopyalanması zor bir "aile hafızası" birikimi yaratıyor.
- Milo'nun dersine de uygun: dar, doğrulanabilir, her öneri kullanıcı onayından geçiyor.

**2) "Aile Kalkanı" farklılaştırıcı katmanı.** Bu, Yuva'nın hikâyesini anlatan özellik olmalı. Gerekçeler:
- Hiçbir genel asistan ve hiçbir bulut aile uygulaması bunu Yuva kadar inandırıcı biçimde yapamaz, çünkü doğrulama *aile kimliğine* dayanıyor.
- Yetişkin çocukların gerçek ve ölçülebilir bir kaygısına (60+ kayıplarında %59 artış) yanıt veriyor.
- Yaşlıları Yuva'ya getirerek çok kuşaklı ağ etkisini başlatıyor. Bu, hafıza konseptinin de ön koşulu.

### Duygusal hafıza vs faydacı lojistik: Hangisi daha iyi başlangıç?

İki alan arasındaki gerilim gerçek.
- **Lojistik:**
  - Sık kullanılıyor ve kolay ölçülüyor.
  - Ama metalaşmış durumda: Alexa+ bedava, Skylight ve onlarca uygulama aynı şeyi yapıyor.
  - Tek başına bir hendek (moat) oluşturmuyor ve iş modeli zayıf. Maple ücretsiz katmanla en kapsamlı ürünü sundu ve yine kapandı.
- **Hafıza:**
  - Duygusal değeri ve gizlilik ihtiyacı en yüksek alan; Yuva'nın felsefesine en çok bu yakışıyor.
  - Ama seyrek kullanılıyor ve "hediye projesi" gibi davranıyor.
  - Teknik olarak da daha ağır: ses, uzun metin, depolama.

**Benim pozisyonum:** Başlangıç noktası *lojistik değil, ev bilgisi* olmalı. Yani ikisinin kesişimi. "Kombi nasıl sıfırlanır", "annemin ilaçları", "garantinin bitiş tarihi" faydacı ama aynı zamanda ailenin *kurumsal hafızası*. Bu bilgi bir gün "babamın kombiyi nasıl tamir ettiğini anlattığı not" olarak duygusal bir değere de dönüşüyor. Lojistik yakalama, Defter'i doldurmanın ve uygulamayı her gün açtırmanın aracı olarak kullanılmalı. Hikâye arşivi ise bu temel ve Aile Kalkanı ile yaşlılar platforma geldikten sonra (Faz 2) eklenmeli. Böylece hafıza, ayrı bir ürün olarak değil, zaten birikmiş bir aile bilgi tabanının doğal genişlemesi olarak gelir.

## Öneriler (yol haritası)

1. **Faz 1 (MVP, 3–4 ay):**
   - Sohbet içinde "@Yuva" aile üyesi.
   - Sohbetten Plana öneri kartları ve ortak takvim.
   - 5 şablonlu Aile Defteri (fotoğraf → onaylı kayıt → doğal dil arama).
   - Rol bazlı 3 koleksiyon (Ebeveynler / Tüm Aile / Bakıcı).
   - Tamamen cihaz üstü: iOS'ta Foundation Models, Android'de destekleyen cihazlarda Gemini Nano Prompt API, diğerlerinde küçük bir açık model (1–3B) ya da sadece kural tabanlı çıkarma.
   - **Sıfır bulut.**
2. **Faz 1.5:**
   - Aile Kalkanı: büyük ekran modu, sesli soru, şüpheli mesaj bildirimi, güvenli kelime, aile koruyucusu.
   - Acil durum kartı.
3. **Faz 2:**
   - Bakım Masası (ilaç/randevu).
   - Hikâye Arşivcisi.
   - İsteğe bağlı ev beyni eşleştirmesi (Mac/PC'de Yuva masaüstü + yerel model).
4. **Faz 3:** Yalnızca açık rıza ve görünür etiketle, aile verisi içermeyen genel sorular için anonim bulut; hassas ağır işler için doğrulanabilir gizli bulut seçeneği. Bu noktada KVKK md. 9 aktarım uyumu ve AB Yapay Zekâ Yasası md. 50 şeffaflık yükümlülükleri için hukuki inceleme şart.
5. **İş modeli:**
   - Milo'nun "AI çağında fiyatlama inovasyonu gerekiyor" tespiti önemli.
   - Sunucusuz mimarinin avantajı marjinal maliyetin neredeyse sıfır olması.
   - Kullanıcı başı değil, **aile başı** tek seferlik veya yıllık ücret düşünülebilir.
   - "Verileriniz şirketle birlikte batmaz" vaadi, açık dışa aktarma formatıyla somutlaştırılmalı.

## Uyarılar

- **Kaynak kalitesi:** Rakip karşılaştırmalarının önemli bir kısmı rakip şirketlerin kendi bloglarından (Remento, AlphaMa, Sense, Klonr vb.) geliyor ve taraflı. Milo ve Maple'ın kapanışları birincil kaynaklarla (kurucunun veda yazısı ve Maple'ın kendi duyurusundan alıntılar) desteklendi. Ohai'nin "insan incelemesi" bilgisi bağımsız bir inceleme sitesinden geliyor; doğrudan gizlilik politikası okunmadı. Cozi, TimeTree, FamilySearch, Jan, Khoj gibi ürünler ile Gemini ve Apple Intelligence'ın aile özellikleri için güncel kullanıcı yorumu analizi yapılamadı.
- **Performans rakamları:** Cihaz üstü hız ve pil verileri belirli cihaz/model/çerçeve kombinasyonlarına ait. Bir kısmı hakemli olmayan ön baskılardan ve ikincil derlemelerden geliyor. Yuva kendi hedef cihazlarında 30 dakikalık sürekli yük testleri yapmalı.
- **ElliQ sonuçları** şirket ve kamu ortağının öz-raporlarına dayanıyor; kontrollü bir klinik deney değil.
- **Dolandırıcılık verileri** ABD'ye ait. Türkiye için karşılaştırılabilir resmi veri bu araştırmada bulunamadı.
- **Hukuki bilgiler** genel bilgilendirme amaçlı. KVKK md. 28 alıntısı ikincil bir kaynaktan, AB Dijital Omnibus tarihleri ise hukuk firması özetlerinden geliyor. Ürün lansmanı öncesinde Türk ve AB veri koruma hukukunda uzman bir avukatla görüşülmeli.
- **Keyhive** pre-alpha aşamasında. Üretimde kullanılmadan önce bağımsız kriptografik denetim gerekir. Grup anahtar yönetimini sıfırdan yazmak yerine Yuva'nın mevcut E2EE protokolünü genişletmek daha düşük riskli olabilir.