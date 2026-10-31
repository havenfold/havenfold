# RFC-0015 — SDK ortak alanları ve yardımcıları

> Durum: **Onaylandı** (Kerem, 23 Ekim 2026) · 23 Ekim 2026 · Yazan: Havenfold çekirdek ekibi · Onay: Kerem
> Kurucu belge: §5.1 (SDK), §14.1. Bağımlılık: RFC-0001 (§4.1 ayrılmış alanlar), RFC-0003 (`rotatedTo`, HELLO yetenek bitleri), RFC-0006 (olay alanları), RFC-0013 (`_src` biçimi, güven hesabı).
> İhtiyacı ortaya çıkaran: Yuva Defteri 07 §4 (H-4, H-5, H-6).
> Kod yeri: `havenfold/sdk`; alan doğrulaması `@havenfold/records` içinde.

## 1. Sorun

Ürünler, çekirdekte tanımlı olmayan üç ortak ihtiyaçla karşılaştı:

1. Bir üyenin en son ne zaman görüldüğünü okumak. Örnek: Aile Kalkanı'nın "Ahmet'in cihazı 10 dakika önce açıktı" demesi (kurucu §15.2 v1.5).
2. `_conf` gibi çekirdeğe ayrılmış alanların değer türü. Taslak RFC'ler aynı alana farklı ölçek vermişti.
3. Kayıt içindeki ürün alanlarında tutulan üye kimliklerinin, telefon değişince yeni kimliğe çözülmesi.

Her ürün bunları kendisi çözerse aynı şey farklı biçimlerde yapılır.

## 2. Çekirdeğe ayrılmış kayıt alanları

RFC-0001 §4.1'e göre `_` ile başlayan alanlar çekirdeğe ayrılmıştır. Bu bölüm bütün ayrılmış alanların **tek listesidir**.

### 2.1 Genel alanlar

| Alan | Tür | Anlam |
|------|-----|-------|
| `_src` | list<string> | Kaynak başvuruları. En çok 16 öğe, her biri ≤ 200 bayt. Biçimler RFC-0013 §8.5'tedir: `msg:`, `kayit:`, `dosya:`, `aktarma:`. |
| `_conf` | int, 0–100 | Yapay zeka güveni, yüzde. Kayıtta, kullanıcının değiştirmediği yapay zeka alanlarının güvenlerinin en küçüğüdür (RFC-0013 §8.4). Kullanıcı onayladıktan sonra da saklanır. Yoksa 100 sayılır (insanın yazdığı kayıt). |
| `_ai` | list<string> | Yapay zekanın doldurduğu ve kullanıcının değiştirmeden onayladığı alan adları. Dışa aktarmada `yapay_zeka_alanlari` olur (RFC-0014 §4). |
| `_aiyol` | string | Yapay zekanın yolu ve modeli: `telefon/apple-fm@<sürüm>`, `telefon/gemini-nano@<sürüm>`, `isci/<modelId>`, `kural/<sürüm>`, `disari/<model>` (RFC-0013 §8.5). |

### 2.2 Olay alanları

RFC-0006 §4.2'de tanımlıdır: `_v`, `_t`, `_subj`, `_place`, `_scope`, `_key`, `_obs`, `_keep`. Türleri ve kuralları orada yazılıdır. `_t` ve `_keep` olay olmayan kayıtlarda da süreli saklama için kullanılabilir (RFC-0006 §14.1).

### 2.3 Kurallar

- Ürün, `_` ile başlayan yeni bir alan tanımlayamaz. Gerekiyorsa bu RFC değişir.
- **Yazar alanı yoktur.** Kaydı kimin oluşturduğu ya da değiştirdiği bir alan olarak yazılmaz; işlemlerin `authorId`'sinden okunur (RFC-0001 §4.3). Neden: alana yazılan bir kimlik taklit edilebilir, işlemin imzalı yazarı edilemez.
- Ürünlerin kendi adlarıyla yazdığı benzer alanlar (ör. Yuva Defteri taslağındaki `yz_alanlar`) yayımlanmadan önce `_ai`'ye taşınır. Yayımlanmış sürüm olmadığı için eski adı okuma desteği gerekmez.
- Kayıt katmanı alanların anlamını denetlemez (RFC-0001 §4.2). Aralık ve biçim denetimini SDK yazarken yapar: aralık dışı `_conf` ya da biçimi bozuk `_src` yazılmaz. Okurken aralık dışı `_conf` 0 sayılır.

## 3. Son görülme

```ts
presence(memberId): Promise<{ lastSeenMs: number | null, via: 'dogrudan' | 'emanet' | 'yok', online: boolean }>
presenceWithin(memberId, saat: 24): Promise<boolean | null>   // yalnız Aile Kalkanı doğrulaması
```

- **Kaynak:** Telefonun kendi gözlemi. Yeni bir mesaj türü ya da ortak durum yoktur.
  - `dogrudan`: o üyenin aktif cihazıyla son başarılı HELLO ya da açık oturum.
  - `emanet`: o üyeden kutu emaneti ya da Posta Kutusu yoluyla gelen son geçerli mesaj. Zaman olarak mesajın şifreli gövdesindeki `hlc` alınır; telefonun saatinden ileriyse telefonun saati alınır.
  - `yok`: gözlem yok ya da üye gizlilik seçti.
- **Kapsam:**
  - Değer yalnız sorulan telefonda hesaplanır. Topluluk içinde ayrıca dolaşan bir "konum" ya da "durum" verisi oluşmaz. Bu yerel bir karardır; paylaşılan duruma yazılmaz.
  - Kaba bir zaman olarak gösterilir: "10 dakika önce", "bugün", "dün". Saniye hassasiyeti gösterilmez.
- **Kimin için:** Topluluğun aktif üyeleri. Misafir için çağrılamaz. Misafirin kendisi de kimsenin son görülme bilgisini okuyamaz.
- **Gizlilik ayarı:** Her üye "son görülmemi gösterme" seçebilir. Bu seçim üyenin `HELLO.caps` içinde `HIDE_PRESENCE` bitiyle bildirilir. Seçildiğinde başkalarının telefonu o üye için `via: 'yok'` döner. İstisna: Aile Kalkanı'nın doğrulama sorusu. Bu soru `presenceWithin` ile yalnız "son 24 saatte görüldü mü: evet/hayır" cevabını alır, zamanı almaz. Ürün bu istisnayı daha da daraltabilir (Yuva Defteri 04 §5.2).
- **Komut:** Çekirdek komutu 350 `PRESENCE_GET`. `presenceWithin` aynı komutun bir kipidir.

## 4. Üye kimliğinin çözülmesi

```ts
resolveMember(memberId, atLedgerSeq?): { activeId: string | null, name: string, role: string, active: boolean }
```

- Defterdeki `rotatedTo` zincirini izler (RFC-0003 §5.13 ile aynı kural).
- `atLedgerSeq` verilirse o andaki aktif uç döner (RFC-0001 §3'teki "X anında" anlamı). Verilmezse cihazın uyguladığı son defter durumundaki uç döner.
- Sonuç yalnız defter olaylarından hesaplanır; saate ve geliş sırasına bağlı değildir.
- Ürünler, kayıt içinde tuttukları üye alanlarını (sorumlu kişi, kimin için) gösterirken ve izin denetlerken bu işlevi kullanır.
- **Komut:** 351 `MEMBER_RESOLVE`.

## 5. Arama

Tam metin arama çekirdekte değildir. Her ürün kendi yerel dizinini tutar. Kurallar RFC-0013 §9'daki dizin kurallarıyla aynıdır:

- cihaz okuyamadığı koleksiyonu dizinlemez;
- dizin koleksiyon anahtarına bağlı olarak korunur; kasa dizini yalnız kasa açıkken bellekte durur;
- okuyuculuk bitince dizin silinir;
- çocuğun cihazı yalnız kendi okuyabildiklerini dizinler.

## 6. Numaralar

| Tür | Numara |
|-----|--------|
| Çekirdek komutları | 350 `PRESENCE_GET`, 351 `MEMBER_RESOLVE`; 352–359 SDK ortak işlevleri için ayrılmış |
| HELLO yetenek biti | `HIDE_PRESENCE = 4096`: üye son görülmesini gizler |
| Ayrılmış alanlar | §2: `_src`, `_conf`, `_ai`, `_aiyol` ve RFC-0006'nın olay alanları |
| Defter olayı, zarf türü, türetme etiketi | Yok |

## 7. Test vektörleri

`protocol/vectors/sdk.json`:

1. `_src` biçimlerinin ayrıştırılması; 17 öğeli liste ya da 201 baytlık öğe → SDK yazmaz.
2. `_conf = 101` → SDK yazmaz. `_conf` yok → 100 okunur.
3. `resolveMember`: iki kez telefon değiştirmiş üye; `atLedgerSeq` ile ara uç.
4. `HIDE_PRESENCE` açık üye → `via: 'yok'`; `presenceWithin` → yalnız evet/hayır.
5. Ürünün tanımsız bir `_` alanı (ör. `_by`) yazması → SDK reddeder.

## 8. Güvenlik değerlendirmesi

| Tehdit | Önlem |
|--------|-------|
| Son görülmeyle bir üyenin günlük düzeninin izlenmesi | Kaba zaman, gizlilik ayarı, misafire kapalı, dolaşan veri yok |
| Ürünün çekirdek alanlarını taklit etmesi | `_` öneki yalnız bu RFC ile |
| Kaydın yazarının taklit edilmesi | Yazar alanı yok; imzalı `authorId` okunur |

## 9. Kurucu belgede değişecekler

| Bölüm | Değişiklik |
|-------|------------|
| §5.1 SDK satırı | "Ortak alanlar ve yardımcılar RFC-0015'tedir." |
| §6.3 ve RFC-0003 §10 | HELLO yetenek bitlerine `HIDE_PRESENCE = 4096` eklenir. |
| RFC-0001 §4.1 | Ayrılmış alanların tam listesi RFC-0015 §2'dedir. `_conf` yüzde (0–100) tamsayıdır. |

## 10. Uygulama sırası

1. Ayrılmış alanların doğrulanması (`@havenfold/records` içinde); vektörler 1, 2, 5.
2. `resolveMember` ve `presence` (SDK); vektörler 3, 4.
3. HELLO `HIDE_PRESENCE` biti.
