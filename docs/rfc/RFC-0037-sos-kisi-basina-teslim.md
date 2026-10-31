# RFC-0037 — SOS'ta kişi başına teslim ("Aldı")

> Durum: **Onaylandı** (25 Ekim 2026; K1–K3 Mac önerisi, Kerem yetkisiyle), kurucu belge 1.22 · Yazan: Mac oturumu
> Kaynak: Yuva Acil A23/A24 "KİMLER ALDI"; yuva-acil `apps/mobile/src/cekirdek/ESLEME.md` "Çekirdekte gerekli" madde 1 (`Vaka.ulasilan` tek aralık, kişi başına teslim yok); yuva-bakim `kollar/CEKIRDEK-EKSIKLERI.md` madde 6; Yuva Acil `docs/02` §2 ("Aldı" = alıcının telefonu kaydı eşitleyince oluşan teslim bilgisi; afet modunda `ALINDI`).
> Kurucu belge: §7.7, §12, §13.1, §22. Etkilenen RFC'ler: 0006 (§6.2, §15), 0012 (§7.1, yalnız not), 0015 (§3, yalnız not), 0017 (§9), 0031 (§6), 0034 (§9), 0036 (§3.2, §3.3).
> **Defterde protokol değişikliği yok.** Yeni defter olayı, `PROTOCOL_LEVEL`, düzey koşulu, HELLO biti ve zarf türü yok. Değişenler: yeni çekirdek kayıt türü `hf.sos.alindi` (olay değil, yazar sınıfı `kendi`, RFC-0036 §3.3); `hf.uygulama`'ya isteğe bağlı `yetenek` alanı; SDK'ya `EventApi.sosRecipients`. Ön koşul: `kendi` sınıfının kodu (RFC-0036 adım 1, dell D96).

## 1. Sorun

1. SOS gönderen telefon, alıcı listesinde kimin SOS'u aldığını gösteremiyor. Alıcılar "Bekliyor" kalıyor; yalnız "Ben bakıyorum" diyen (`hf.vaka.sahip`) "bakıyor" oluyor.
2. Çekirdekte kişi başına teslim bilgisi yok. Vaka durumu (RFC-0006 §10.3) yalnız ulaşılan basamağı verir; basamak bir kitleye bildirim *planlandığını* söyler, kimin telefonuna ulaştığını söylemez.
3. Afet yolunda teslim zaten var (RFC-0012 §7.1 `ALINDI`, §8.2 `doneHash`), ama gönderenin giden kutusunda kalıyor; internet yolunda karşılığı yok.

## 2. Öneri özeti

1. **"Aldı" = cihaz teslimi:** alıcı kişinin telefonundaki çekirdek SOS kaydını çözdü. Bildirimin gösterilip gösterilmediği ve kişinin açıp açmadığı (okundu) yazılmaz (§3; K1).
2. Alıcının çekirdeği, SOS'un koleksiyonuna (Tüm Aile) **kendi imzalı `hf.sos.alindi` kaydını** kendiliğinden yazar. Yazar sınıfı `kendi`: kimse başkası adına "aldı" yazamaz (§4, §5).
3. Gönderende her alıcı kişi için üç durum: **aldı**, **bekliyor**, **bilinmiyor** (eski istemci). "Bekliyor" ancak kişinin bütün kimlikleri alındı yazabildiğini bildirdiyse gösterilir (§6).
4. Afet yolunda bugünkü `ALINDI` kullanılır; gönderen ikisini birleştirir (§7). Kutu içerik görmez (§11).

## 3. "Aldı" ne demek

| | Düzey | Ne söyler | Gizlilik bedeli | Değer |
|---|-------|-----------|-----------------|-------|
| **D1** | **Cihaz teslimi (öneri):** kişinin bir kimliği SOS kaydını çözdü | "Telefonu açık ve bağlıydı, SOS oraya ulaştı" | Telefonun o an çevrimiçi olduğu sızar; kişinin telefonun başında olduğu sızmaz. Yalnız SOS'ta, yılda birkaç kez. | Gönderen "ulaşmadı mı, telefonu kapalı mı?" sorusuna cevap alır. Afet yolundaki `ALINDI` ile aynı anlam (çözünce kendiliğinden). Ürün belgesindeki tanım (Yuva Acil 02 §2). |
| D2 | Bildirim gösterildi | "Uygulama bildirimi işletim sistemine verdi" | D1'e ek olarak bildirim izni ve odak ayarı dolaylı sızar | Düşük ve yanıltıcı: işletim sistemi bildirimi odak kipinde ya da izinsizken gizleyebilir; uygulama bunu kesin bilemez. Seçilmedi. |
| D3 | Kişi gördü (SOS ekranını açtı) | "Ayşe 14:32'de gördü" | **Yüksek:** kişinin o an telefonu kullandığı sızar; "gördü ama gelmedi" baskısı (çocuk, ergen, yaşlı, sorunlu aile ilişkisi). Okundu bilgisi bir kez açılınca geri alınmaz. | "Ben bakıyorum" zaten gönüllü ve açık olumlu sinyaldir. D3 onun yerini tutmaz, yanına baskı ekler. Seçilmedi (K1). |

**Karar (K1): yalnız D1.** Okundu ("gördü") yoktur. Gerekçe: acil durumda gönderenin bilmesi gereken "ulaştı mı" sorusudur; "gördü mü" sorusunun cevabı "Ben bakıyorum"dur. D1 iki yolda (kayıt ve afet) aynı anlamı taşır.

**Güvenlik (bütün düzeyler için):** Alındı yalnız alıcının kendi imzasıyla geçerlidir. İnternet yolunda kayıt işleminin imzası ve `kendi` sınıfı (§5.2); afet yolunda çiftin `afetKey`'iyle mühürlü `ALINDI` (yalnız çiftin iki tarafı üretebilir). Değiştirilmiş istemci kendisi için yalan söyleyebilir ("aldım"); bu, `hf.uygulama` beyanıyla aynı sınıftır ve yetki vermez.

## 4. Nereye kaydedilir

| | Seçenek | Artı | Eksi |
|---|---------|------|------|
| A | Gönderenin yerel gözlemi (doğrudan oturumda karşının `REC_VV`'si; yeni veri yok) | Hiçbir şey dolaşmaz (RFC-0015 §3 son görülme gibi) | Yalnız doğrudan oturumda; kutu ve emanet yolunda (çoğu durum) hiç bilgi yok. Yalnız gönderen görür. Yetersiz. |
| B | Yeni doğrudan zarf (`0xC2`, alıcı → gönderen, `VAKA_DUR` gibi imzalı) | Yalnız gönderen görür; paylaşılan duruma girmez | Yeni zarf türü; kalıcı değil (yeniden kurulum, ikinci cihaz görmez); kutu "B, A'ya SOS'tan hemen sonra yazdı" eşleşmesini görür (kayıttan daha açık üst veri); gönderenin çevrimiçi olmasına bağlı; vaka durumu kayıtlardan hesaplanır ilkesinin dışında. |
| **C** | **Alıcının kendi yazdığı kayıt, SOS'un koleksiyonunda (öneri)** | Defter ve düzey değişmez; bütün yollarla eşitlenir (doğrudan, kutu, ileride Posta Kutusu); belirlenimci; kişinin her cihazı ve gönderenin her kimliği görür; `kendi` sınıfı hazır (RFC-0036); şifreli, kutu içerik görmez; vaka kayıtlarıyla aynı yerde (RFC-0006 §10.2: bilgi koleksiyon sınırını aşmaz). | SOS'u okuyabilen herkes (çocuklar dahil) kimin aldığını görebilir (K3); her SOS'ta alıcı sayısı kadar küçük kayıt. |
| D | Defter olayı | — | Düzey 2.4; kutu ve cihaz da görür; yetki taşımayan bilgi deftere girer. Seçilmedi. |

**Karar (K3): C.** Alındıyı SOS'u okuyabilen herkes görür. Sorun bir bilgi sorunu; bilgi kayıt katmanına aittir (RFC-0036 §3.1 ile aynı gerekçe). İleride "yalnız gönderen görsün" istenirse B'ye dönülür; bedeli §4'teki tablodadır.

## 5. Kayıt: `hf.sos.alindi`

### 5.1 Biçim

| | |
|---|---|
| Tür | `hf.sos.alindi`, olay değil (RFC-0006 §6.2), `v` 1 |
| Koleksiyon | SOS kaydının koleksiyonu (Yuva'da Tüm Aile) |
| Yazar sınıfı | `kendi` (RFC-0036 §3.3 madde 2) |
| `recordId` | RFC-0019 §11.1 c: `hash('hf/rec-new/', authorId, nonce)` |
| `_subj` | `'uye:<yazarın kendi kimliği, hex16>'`; çözülmez (RFC-0036 §3.3 madde 3) |
| `_t` | Alıcının SOS kaydını çözdüğü an, Unix ms |
| `_keep` | 7 (gün). SOS 365 gün kalır (RFC-0006 §6.1); alındı yalnız olay sırasında anlamlıdır. 7 gün RFC-0012'deki teslim bilgisi ve RFC-0031 §6'daki tekilleştirme süresiyle aynıdır. |
| `sos` | bytes (16): SOS kaydının `recordId`'si (kayıt alan adı kuralı `[a-z0-9_.]`, RFC-0001 §4.1) |
| Bilinmeyen alan | Yok sayılır (RFC-0006 §4.2) |

### 5.2 Geçerlilik (görünüm hesabı, her telefonda aynı)

Bir `hf.sos.alindi` şu koşulların hepsini sağlarsa sayılır; sağlamazsa kayıt durur ama sayılmaz (hata kodu yok):

| # | Koşul |
|---|-------|
| 1 | Görünüme yalnız kaydı oluşturan yazarın işlemleri girer (`kendi`); `_subj` = `uye:<authorHex>` |
| 2 | Yazar, işlemin `ledgerSeq` anında üye (cihaz değil, misafir değil) ve koleksiyonun okuyucusu |
| 3 | `sos` aynı koleksiyonda bir `hf.sos` kaydının `recordId`'si |
| 4 | Yazarın kişisi (RFC-0017 §5) SOS'u gönderen kişi değil. Misafirin SOS'unda (`_subj = grant:…`) her üye geçerlidir. |
| 5 | SOS'ta `sessiz: true` yok (§5.4) |
| 6 | `ms(_t) ≤ ms(hlc) + 5 dakika` (RFC-0006 §4.5 madde 3) |

Kişi başına birden çok geçerli alındı (birkaç kimlik, birkaç cihaz) tek satır olur; zaman en erken `_t`'dir. Gösterilen zaman `max(_t, sos._t)`'dir: saat farkı yüzünden SOS'tan önce görünen alındı atılmaz, SOS anına çekilir.

### 5.3 Kim, ne zaman yazar

Çekirdek kendisi yazar; ürün kodu bir şey çağırmaz, kişi kapatamaz. "Son görülmemi gösterme" (`HIDE_PRESENCE`, RFC-0015 §3) seçen kişi de yazar: SOS istisnasıdır (K2). Alıcının çekirdeği bir `hf.sos` kaydını görünüme aldığında şu koşulların hepsi sağlanıyorsa **bir kez** yazar:

| # | Koşul | Neden |
|---|-------|-------|
| a | SOS'u gönderen kişi bu kimliğin kişisi değil | Kendi SOS'una alındı anlamsız |
| b | SOS'ta `sessiz: true` yok | §5.4 |
| c | SOS'un `_t`'si yerel saatle son 24 saatte | Uzun çevrimdışılıktan sonra eski SOS'lar için yazma dalgası olmasın. Bu yalnız yazma tetiğidir, geçerlilik koşulu değildir (RFC-0006 §11.4'teki basamak yazma süresi gibi). |
| d | Vaka kapalı değil (RFC-0006 §10.3 madde 5) | "Yanlışlıkla bastım"dan sonra gereksiz |
| e | Bu kimliğin bu SOS için geçerli alındısı yok | Tekrar yok; yeniden başlatmada da |
| f | Bu cihazda `hf.sos`'u bildiren uygulama bu kimliktir (RFC-0017 §9, RFC-0029 §4.3; çok ailede aile başına, RFC-0034 §9). Yerel kanal yoksa ya da cihaz grubu bilinmiyorsa her kimlik yazar. | Cihaz başına bir kayıt; geri düşmede fazladan kayıt zararsızdır, kişi başına birleşir (§5.2). |

- SOS motor için geçersiz olsa da (RFC-0031 §3) gösterildiği için alındı yazılır; yalnız `sessiz` istisnadır.
- Bildirim tekilleştirmesi alındıyı etkilemez (§9).
- Alındı yazılınca `VAKA_UYANDIR` ya da başka uyandırma zarfı gönderilmez (RFC-0006 §11.5 saatte 30 sınırı ve T20). Gönderen telefon kaydı olağan eşitlemeyle alır; A24 açıkken uygulama ön plandadır.

### 5.4 Sessiz SOS

`sessiz: true` SOS'ta hiçbir alıcı alındı yazmaz; yazılmışsa sayılmaz. Gerekçe: gönderen telefonda hiçbir iz kalmamalıdır (RFC-0031 §5 madde 2, "teslim onayı beklenmez"). Silme 10 saniye içinde gecikirse, telefonu elinde tutan saldırgan "aileye ulaştı" bilgisini görmemelidir.

## 6. Gönderende gösterim

### 6.1 Alıcı listesi

SOS'un koleksiyonunun okuyucusu olan kişiler (cihazın uyguladığı son defter durumuna göre, RFC-0006 §11.1), gönderen kişi hariç. Kutu, bağlı cihaz ve misafir alıcı değildir (Tüm Aile'yi okumazlar).

### 6.2 Yetenek bildirimi

Eski istemci alındı yazmaz; "yazmadı" "almadı" demek değildir. Bu yüzden her kimlik alındı yazabildiğini kendi `hf.uygulama` kaydında bildirir:

- `hf.uygulama`'ya isteğe bağlı alan: `yetenek: list<string>`. Bu RFC'nin değeri `'sos-alindi'`. RFC-0036 §3.2 "ileride yetenek alanı bu türe eklenir; düzey gerekmez" der.
- RFC-0036 §3.3 madde 4 genişler: kimlik kendi kaydını `appId` **ya da `yetenek`** farklıysa yeniden yazar.
- Ek kimlikte de `yetenek` kendi `hf.uygulama` kaydından okunur (`appId` için `APP_ATTACH` geçerli kalır).

### 6.3 Üç durum

| Durum | Koşul | Ekranda (öneri; metin Yuva Acil'in) |
|-------|-------|--------------------------------------|
| **aldı** | Kişinin herhangi bir kimliğinden geçerli alındı (§5.2) ya da afet `ALINDI`'sı (§7) | "Aldı · 14:32" (dakika) |
| **bekliyor** | Alındı yok ve kişinin koleksiyonu okuyan **bütün** aktif kimliklerinin `yetenek`'inde `'sos-alindi'` var | "Bekliyor" |
| **bilinmiyor** | Diğer her durum (eski istemci, `hf.uygulama` kaydı yok) | "Bilinmiyor" ya da satırda durum yok |

Kural RFC-0036 §3.3 madde 6 ile aynı ilkededir: "yok" kanıtlanamıyorsa "bilinmiyor" denir. "Bakıyor" (`hf.vaka.sahip`) bu durumların üstüne yazılır; sahiplenen kişi zaten almıştır.

## 7. Afet yolu (Bluetooth, sakla-ilet)

- Değişiklik yok. Alıcı `AFET_MSG { kind: SOS }`'u açınca `ALINDI`'yı kendiliğinden mühürler ve aynı oturumda `AFET_DONE` gönderir (RFC-0012 §7.1, §8.2). `ALINDI` gönderene sakla-ilet ile döner; internet ya da kutu yolu açılınca olağan oturumla da gider (§8.4). Gönderenin giden kutusunda alıcı başına `durum: 'alindi'` olur (bugünkü `DisasterApi`).
- `ALINDI` çiftin `afetKey`'iyle mühürlüdür: taşıyıcı açamaz, sahteleyemez. Başka bir aile üyesi kendi çiftiyle aynı `ref`'li bir `ALINDI` mühürleyebilir; bu yüzden gönderen yalnız o `mid`'in alıcısından gelen `ALINDI`'yı sayar (`ALINDI`'nın göndereni = gidenin alıcısı; `sdk/disaster.js` `_alindi`, motorun teslim kuralıyla aynı; açılış öncesi inceleme).
- **Birleştirme gönderende yereldir.** Afet SOS'u alıcı başına ayrı `mid` taşır (RFC-0012 §7.1). Gönderen çekirdek, `sosYaz`'a verilen afet `mid` listesini (312 `DISASTER_SEND`'in dönüşü) yerel durumda tutar; birleştirme bu yerel eşlemeyle yapılır. Liste ayrıca kayda `afet_midler` olarak yazılır (D103, RFC-0031 §6 tekilleştirmesi için: her alıcı kendi mid'ini bulur); aile okuyucuları birbirinin afet mid'ini görür (mid afet başlığında taşıyıcılara zaten açıktır). Tekilleştirme bağları (`afet_mid`, `afet_midler`, `ortak_mid`) yalnız SOS'u yazanın kaydı açan işleminden okunur; başka üyenin sonradan eklediği mid sayılmaz. `sosAlicilari` bir kişi için kayıt alındısı ya da o kişinin kimliğine giden `mid`'in `ALINDI`'sı varsa "aldı" döner; `yol: 'afet' | 'kayit'`, zaman en erkendir.
- Bu eşleme `hf.sos.afet_mid`'e dayanmaz (alıcı başına mid sorunu: A2).
- Alıcı afet SOS'unu aldıktan sonra kayıt da eşitlenirse §5.3'e göre ayrıca kayıt alındısı yazar; gönderen tek satır görür.

## 8. Birden çok aile (RFC-0034)

- Alındı aile örneği başınadır: alıcının her örneği, kendi ailesindeki SOS kaydına kendi ailesinde alındı yazar. Kayıt `ortak_mid` taşımaz; aileler arası bağ kurulmaz (RFC-0034 §4.1 madde 7, 9).
- Gönderen (bütün ailelerine yazmıştır, RFC-0034 K2) sonucu aile başına alır ve A24'te aileye göre gösterir (RFC-0034 §15). Aynı kişi iki ailede alıcıysa iki ayrı satırdır ("Rosa (Rivera ailesi)", "Rosa (Elena'nın evi)"); telefon onları birleştirmez.
- **Sızıntı:** İki ailenin ortak okuyucusu, aynı telefonun iki örneğinin aynı saniyelerde alındı yazdığını görüp iki kimliği ilişkilendirebilir. Bu kişi iki ailede de yüz yüze tanışmıştır; RFC-0034 §9'daki `ortakMid` sızıntısıyla aynı sınıftır ve kabul edilir.

## 9. Bildirim tekilleştirmesiyle etkileşim

| Kural | Bildirime etkisi | Alındıya etkisi |
|-------|------------------|-----------------|
| `(aile, vaka, basamak, sira)` en çok bir kez (RFC-0006 §11.3, RFC-0034 §9) | İkinci bildirim yok | Yok: alındı SOS kaydı başına, basamak başına değil |
| `afet_mid` (RFC-0031 §6), `ortak_mid` (RFC-0034 §9) | İkinci geliş bildirim göstermez | Yok: her SOS kaydı için alındı yazılır |
| Bir cihazda tek bildiren uygulama (RFC-0017 §9) | Yalnız o uygulama bildirir | Yalnız o kimlik yazar (§5.3 f) |
| Vaka sahiplendi ya da kapandı | Bildirim kalkar | Kapalı vakada yazılmaz (§5.3 d); sahipli vakada yazılır |

Alındı "kişi bildirildi" değil "telefon aldı" demektir; tekilleştirme bu yüzden alındıyı bastırmaz.

## 10. Misafir

- **Misafir alıcı değildir:** Tüm Aile'yi okumaz, internet yolunda SOS kaydını çözemez, alındı yazamaz (RFC-0030 §6). Afet yolunda üyeden SOS alırsa bugünkü gibi `ALINDI` gönderir (RFC-0012 §8.1).
- **Misafir gönderen:** Kendi `hf.sos`'unun alındılarını internet yolunda göremez, çünkü Tüm Aile'yi okumaz. Afet yolunda `ALINDI`'ları alır (RFC-0012 §8.1, misafirin teslim bilgisi). İnternet yolu için çözüm bu RFC'de yoktur (A1).

## 11. Kutu ve Eser ne görür

- **İçerik: hiçbir şey.** Kayıt Tüm Aile'nin dönem anahtarıyla şifrelidir; tür, `_subj`, `sos` ve zaman şifreli metnin içindedir (kurucu §7.4). Kutu koleksiyon anahtarı almaz.
- **Üst veri: bugünkü kadar.** Kutu, hangi üyenin koleksiyona ne zaman, ne boyutta işlem yüklediğini zaten görür (kurucu §11 satır 2) ve `VAKA_UYANDIR` zarflarının kim-kime üst verisini zaten görür. Alındılarla yeni olan, SOS sonrası alıcı sayısı kadar küçük yüklemenin örüntüsüdür. B seçeneğindeki doğrudan zarf, bunun üstüne alıcı–gönderen eşleşmesini de verirdi.
- Posta Kutusu v1'de yoktur (RFC-0028 §7); geldiğinde aynı şifreli işlem gider, Eser içerik görmez.

## 12. SDK ve kanal

```ts
interface SosAlicisi {
  personId: Hex
  durum: 'aldi' | 'bekliyor' | 'bilinmiyor'
  at: number | null          // ms, gösterimde dakikaya yuvarlanır
  yol: 'kayit' | 'afet' | null
}
EventApi.sosRecipients(collectionId: Hex, sosRecordId: Hex): SosAlicisi[]   // NO_RECORD
EventApi.writeSos(collectionId, { ...SosAlanlari, afetMidler?: Hex[] })     // afetMidler yalnız yerel durumda (§7)
```

- Yeni kanal komutu yok: Yuva Acil'in ürün sunucusu SDK'yı worklet içinde doğrudan çağırır (ESLEME düzeni). İleride bir uygulama kanaldan isterse numara o zaman verilir.
- Worklet'ten arayüze yeni olay adı: `sos-alindi { collectionId, sos, personId }` (`OLAYLAR` listesine).
- Yazmayı çekirdek kendisi yapar (§5.3). `Vaka.ulasilan` değişmez.

## 13. Uyumluluk ve düzey

| Konu | Etki |
|------|------|
| Defter, olaylar, `PROTOCOL_LEVEL`, HELLO, zarflar | Değişmez. Düzey 2.1, 2.2, 2.3 ailelerinde çalışır. |
| Eski istemci ve `hf.sos.alindi` | Bilmediği türü saklar, eşitler, kullanmaz (RFC-0006 §5.4). Alındı yazmaz; `yetenek` bildirmediği için gönderende "bilinmiyor" görünür. |
| Eski istemci ve `hf.uygulama.yetenek` | Bilinmeyen alanı yok sayar. |
| `kendi` sınıfı olmayan istemci | Alındıyı okumaz (katalogda tür yok); başkası adına yazılmış alındı ona zarar vermez. |
| Düzey 2.0 aile (mağazadaki Yuva Hat) | Koleksiyon yok; SOS kaydı da yok. Etkisiz. |
| Afet yolu | Değişmez. |

## 14. Güvenlik değerlendirmesi

| Tehdit | Önlem |
|--------|-------|
| Bir üye başkası adına "aldı" yazar | `kendi` sınıfı: görünüme yalnız oluşturanın işlemleri girer; `_subj` yazarla aynı, çözülmez (§5.2 madde 1) |
| Bir üye başkasının alındısını siler ya da zamanını değiştirir | `kendi`: başka yazarın `put`/`del`'i görünüme girmez |
| Kutu, cihaz ya da misafir alındı yazar | Kutu ve cihazın anahtarı yok; cihaz `kendi`'ye uymaz; misafir Tüm Aile'ye yalnız `hf.sos` bırakabilir (RFC-0031 §4.1) |
| Alındı başka bir SOS'a yeniden oynatılır | `sos` alanı imzalı işlemin içinde ve SOS `recordId`'sine bağlı |
| Afet taşıyıcısı sahte `ALINDI` üretir | Çiftin `afetKey`'i; `doneHash` (RFC-0012 §15) |
| Kişi kendisi için yalan söyler | Değiştirilmiş istemci; yalnız gösterimi etkiler, yetki vermez (RFC-0036 §7 ile aynı sınır) |
| Sessiz SOS'ta saldırgan teslimi görür | Sessiz SOS'ta alındı yazılmaz ve sayılmaz (§5.4) |
| Alındıyla kişinin günlük düzeni izlenir | Yalnız SOS'ta; düzey D1 (telefon, kişi değil); dakika hassasiyeti; 7 gün sonra temizlenir; okundu yok (K1) |
| "Gördü ama gelmedi" baskısı | D3 yok (K1) |
| Kutu kimin aldığını öğrenir | İçerik şifreli; üst veri bugünkü sınıfta (§11) |
| İki ailenin ortak üyesi iki kimliği ilişkilendirir | Kabul edilen sınır, RFC-0034 §9 ile aynı (§8) |

## 15. Hata kodları

| Kod | Nerede | Anlam |
|-----|--------|-------|
| `NO_RECORD` | `sosAlicilari` | `sosRecordId` koleksiyonda bir `hf.sos` değil (bugünkü kod, anlam genişler) |

`hf.sos.alindi` için kayıt hata kodu yoktur: kurala uymayan işlem görünüme girmez, kayıt sayılmaz.

## 16. Test vektörleri

Yeni dosyalar: `protocol/vectors/sos-receipt.json`; testler `core/events/test/` ve `core/records/test/` altında. Var olanlar değişmez.

1. B, A'nın SOS'unu çözer → tek `hf.sos.alindi` (`_subj` B, `sos`, `_keep` 7). Yeniden başlatma ya da ikinci çözme → yazmaz.
2. A'da: B `aldi`, `at = max(_t, sos._t)`; C yazmadı ve bütün kimlikleri `sos-alindi` bildirdi → `bekliyor`; D'nin bir kimliği bildirmedi → `bilinmiyor`.
3. C, `_subj = uye:B` ile alındı yazar → sayılmaz. C, B'nin alındısına `put` ya da `del` → görünüm değişmez.
4. Cihaz kimliği alındı yazar → sayılmaz.
5. `sessiz: true` SOS → hiçbir alıcı yazmaz; dışarıdan yazılmış alındı sayılmaz; `sosAlicilari` hepsini `bekliyor`/`bilinmiyor` döner.
6. Gönderenin kendi ek kimliği SOS'u çözer → yazmaz; yazılmışsa sayılmaz.
7. Aynı `afet_mid`'li ya da aynı `ortak_mid`'li ikinci geliş: bildirim bastırılır, alındı yazılır.
8. Aynı cihazda Acil ve Defter: yerel kanal var → yalnız Acil'in kimliği yazar; yerel kanal yok → ikisi yazar, kişi tek `aldi`, en erken zaman.
9. Kişinin iki cihazı → iki kayıt, tek satır.
10. 24 saatten eski SOS ya da kapalı vaka → yazmaz. Sahipli vaka → yazar.
11. Çok aile: S ve R iki ailede → her ailede ayrı alındı, kayıtta `ortak_mid` yok; `sosAlicilari` aile başına.
12. Afet: `sosYaz({ afetMidler })`, R'nin `mid`'ine `ALINDI` → kayıt alındısı yokken R `aldi`, `yol: 'afet'`; sonra kayıt alındısı → tek satır, en erken zaman.
13. `_t` > `hlc` + 5 dk → sayılmaz. `_t` < `sos._t` → sayılır, `at = sos._t`.
14. Bugünkü sürüm (katalogda tür yok) alındıyı ve `yetenek`'i hata vermeden eşitler.
15. Temizlik: 7 gün sonra alındı temizlenir, SOS kalır; `sosAlicilari` → `bekliyor`/`bilinmiyor`.

## 17. Kurucu belgede değişecekler (1.22, işlendi)

| Bölüm | Değişiklik |
|-------|------------|
| Başlık | Sürüm 1.22; RFC-0037. |
| §7.7 | Not: "SOS'u alan her üyenin çekirdeği aynı koleksiyona kendi `hf.sos.alindi` kaydını yazar (cihaz teslimi; okundu yok); yalnız kendisi yazar; sessiz SOS'ta yazılmaz (RFC-0037)." |
| §12 | `hf.` satırına `hf.sos.alindi` (olay değil; RFC-0037). |
| §13.1 | T32: "Bir üye başkası adına SOS alındısı yazar" · "`kendi` yazar sınıfı; sessiz SOS'ta alındı yok (RFC-0037 §5)". |
| §22.1 | HF69 (aşağıda). |

**HF69:** SOS'ta "Aldı" cihaz teslimidir: alıcının çekirdeği SOS kaydını çözünce aynı koleksiyona kendi imzalı `hf.sos.alindi` kaydını yazar (yazar sınıfı `kendi`, 7 gün). Okundu bilgisi yoktur. Gönderende her kişi "aldı", "bekliyor" ya da "bilinmiyor"dur; afet yolunda `ALINDI` kullanılır. "Son görülmemi gösterme" seçen kişi de yazar (SOS istisnası); alındıyı SOS'u okuyabilen herkes görür. Sessiz SOS'ta alındı yazılmaz. — Gerekçe: Yuva Acil gönderene kimin aldığını gösteremiyordu; "gördü" bilgisi ailede baskı yaratır, "Ben bakıyorum" zaten gönüllü sinyaldir (25 Ekim 2026; K1–K3 Mac önerisi, Kerem yetkisiyle).

## 18. Diğer RFC'lerde değişecekler

| RFC | Yer | Değişiklik |
|-----|-----|------------|
| 0006 | §6.2 | Tabloya `hf.sos.alindi` · SOS alındısı · yalnız alıcının kendisi (`kendi`) · RFC-0037 §5. |
| 0006 | §15 | `sosAlicilari`, `sosYaz.afetMidler`, `sos-alindi` olayı. |
| 0012 | §7.1 | Not: "SOS'un `ALINDI`'sı gönderende kayıt alındısıyla birleşir (RFC-0037 §7)." Biçim değişmez. |
| 0015 | §3 | Not: "SOS alındısı son görülme değildir; yalnız SOS'ta, dakika hassasiyetinde, paylaşılan kayıttır (RFC-0037)." "`HIDE_PRESENCE` SOS alındısını durdurmaz (SOS istisnası, RFC-0037 K2)." |
| 0017 | §9 | "`hf.sos`'u bildiren uygulama alındıyı da yazar; yerel kanal yoksa her kimlik (RFC-0037 §5.3 f)." |
| 0031 | §6 | "Tekilleştirme yalnız bildirimi etkiler; alındı her SOS kaydı için yazılır (RFC-0037 §9)." Sessiz SOS: §5'e "alındı yazılmaz". |
| 0034 | §9 | "Alındı aile örneği başınadır, `ortak_mid` taşımaz (RFC-0037 §8)." |
| 0036 | §3.2, §3.3 madde 4 | `yetenek: list<string>` alanı; `appId` ya da `yetenek` farklıysa yeniden yazılır. |
| `protocol/event-types.json` | | `hf.sos.alindi` (`olay: false`, `yazar: 'kendi'`, `ozne: ['uye']`, alan `sos` bytes, `keep` 7, koleksiyon Tüm Aile). |

## 19. Ürün belgelerine etkisi

| Ürün | Yer | Değişiklik |
|------|-----|------------|
| Yuva Acil | `docs/02` §2 "Alındı" | Tanım aynen (cihaz teslimi); "bilinmiyor" durumu ve dakika hassasiyeti eklenir; sessiz SOS'ta alındı yok. |
| Yuva Acil | A24 "KİMLER ALDI" | Üç durum; "Bakıyor" üstte; çok ailede aileye göre bölünür. Kilitli görünümde gösterilir (02 §2, bugünkü kural). |
| Yuva Acil | `ESLEME.md` | "Çekirdekte gerekli" madde 1 kapanır: `alicilar[].durum` `sosAlicilari`'ndan. |
| Yuva Bakım | `kollar/CEKIRDEK-EKSIKLERI.md` madde 6 | RFC-0037 ve dell adımına bağlanır. |
| Yuva Hat, Defter, Pati, Bakım | — | SOS'u bildiren uygulama olduklarında çekirdek alındıyı kendisi yazar; ürün işi yok. |

## 20. Açık noktalar

**Kararlar (25 Ekim 2026; Mac önerisi, Kerem yetkisiyle):**

| # | Konu | Karar | Seçilmeyen |
|---|------|-------|------------|
| K1 | "Aldı" yalnız cihaz teslimi mi; "gördü" (okundu) da olsun mu | **Yalnız cihaz teslimi** ("aldı"); okundu yok (§3) | D3 okundu: daha çok bilgi, ailede baskı ve izleme |
| K2 | "Son görülmemi gösterme" (`HIDE_PRESENCE`) seçen kişi SOS alındısı yazsın mı | **Evet, yazar.** SOS istisnasıdır (Aile Kalkanı istisnası gibi, RFC-0015 §3); zaman dakika. | Yazmasın: o kişi gönderende "bilinmiyor" görünür |
| K3 | Alındıyı kim görebilir | **SOS'u okuyabilen herkes** (C: kayıt yolu, Tüm Aile'de; ürün A24 ve A27'de gösterir) | Yalnız gönderen (B: doğrudan zarf; kalıcı değil, kutuda eşleşme üst verisi) |

**Teknik açık noktalar:**

| # | Konu |
|---|------|
| A1 | Misafir gönderen internet yolunda alındı göremez (Tüm Aile'yi okumaz). Yollar: `GUEST_VIEW`'e SOS başına alındı özeti ya da misafire doğrudan zarf. Bakıcı ekranının ihtiyacı netleşince ayrı ele alınır. |
| A2 | RFC-0031 §6: afet SOS'u alıcı başına ayrı `mid` taşıdığı için tek `afet_mid` alanı tekilleştirmeyi yalnız bir alıcıda sağlar (yuva-acil LA28 (1); bugün kayda yazılmıyor). Bu RFC'nin teslim eşlemesi buna dayanmaz (§7); tekilleştirme sorunu ayrı düzeltilir (dell D103). |
| A3 | Uygulaması silinen kimlik defterde aktif kalır (RFC-0036 A1); o kişi "bekliyor"da bayatlayabilir. |
| A4 | iPhone'da alıcı uygulama uyanınca yazar (uyandırma zarfı onu uyandırır); arka plandaki gönderen alındıları uygulamayı açınca görür. Alındı için uyandırma yoktur (§5.3). |
| A5 | Ekipte (Mekan) SOS ve alındı: Mekan uygulamaları Havenfold'a geçince. |

## 21. Uygulama sırası (dell)

1. **Ön koşul:** RFC-0036 adım 1 (dell D96): katalogda `kendi` sınıfı (`core/records/class.js`) ve `hf.uygulama`.
2. **Alındı (dell D102; ön koşul D96, sıra D101'den sonra):** katalogda `hf.sos.alindi`; `hf.uygulama.yetenek` ve yeniden yazma tetiği; `core/events/sos.js`'e yazma tetiği (§5.3; motor SOS kaydını görünüme alınca) ve görünüm hesabı (§5.2, §6.3); SDK `EventApi.sosRecipients`, `sosYaz.afetMidler` yerel eşlemesi ve afet `ALINDI` birleşimi (§7); worklet olayı `sos-alindi`; bildiren uygulama denetimi (yerel kanal yoksa her kimlik). Vektörler 1–15.
3. **Mac:** bağımsız inceleme; kurucu belge 1.22 bu RFC'nin onayıyla işlendi; §18'deki RFC ekleri.
4. **lenovo (Yuva Acil):** A24 bağlama (§19); gerçek iki telefonla deneme (biri çevrimdışı → "bekliyor", sonra "aldı").

## 22. Geri dönüş yolu

- Defter değişmediği için geri alınacak protokol durumu yok.
- Yazmayı ve okumayı bırakmak yeter: kayıtlar 7 günde temizlenir; ürünler "bilinmiyor"a döner.
- K3 ileride B'ye dönerse kayıt türü kullanılmaz, yerine `0xC2` zarfı RFC-0006'nın ayrılmış aralığından alınır; §5.2 ve §5.3 kuralları zarfa taşınır.
