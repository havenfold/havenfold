# RFC-0022 — Ekip incelemesinden kararlar: geçicinin süresi, ekipte devir, yöneticinin alanı, ayrılma

> Durum: **Onaylandı** (Kerem, 23 Ekim 2026) · 23 Ekim 2026 · Yazan: Havenfold çekirdek ekibi · Onay: Kerem
> Kaynak: dell'in D10 (RFC-0005 ekip topluluğu) uygulaması üstüne Mac'in incelemesi (`kollar/D-inceleme-7.md`).
> Kurucu belge: §7, §22. Etkilenen RFC'ler: 0005, 0017, 0021.

## 1. Sorun

D10 testlerden geçti, ama inceleme RFC-0005'in açık bıraktığı ya da yanlış izin verdiği beş yer buldu:

- Süresi dolan geçici çalışan, anahtar isteği ve eşitleme yoluyla yeni kayıtları almaya devam ediyor. Elindeki dönem anahtarıyla da okumayı sürdürüyor.
- Ekipte tek bir yönetici ile sahibin ek kimliğini tutan biri, sahibin ana kimliğini beklemeden devredebiliyor. Oysa telefon değişiminde bütün diğer sahipler ve 72 saat gerekiyor.
- RFC-0005 §6.2, yöneticinin kendi alanı dışındaki bir çalışanın telefonunu değiştirmesine izin veriyor. Ama aynı yönetici o çalışanı çıkaramıyor; telefonu kendi cihazına çevirip başka yerin verisini okuyabiliyor.
- Ayrılan cihaz, güncel defterinde kesin olarak reddedilen bir çıkarmayı 7 gün sonra yine uyguluyor. Tek yönetici bir sahibin cihazını tam sildirebiliyor.
- Ayrılma makbuzu yeniden oynatılabiliyor ve telefon değişiminde düşen eski kimlik de makbuz verebiliyor.

## 2. Kararlar

| # | Karar | Neden |
|---|-------|-------|
| a | **Geçicinin süresi dolunca erişim her yoldan kesilir.** Süresi dolmuş ya da TERM'i olmayan geçiciye anahtar yanıtı, eşitleme (`commonCollections`), katılma paketi ve dosya (`BLOB_REQ`) gitmez. Süre dolduğunda yönetim telefonu, geçicinin okuyucu olduğu koleksiyonlar için yeni dönem açmayı önerir; tek dokunuşla onaylanır. | Geçici, süre bittikten sonra yazılan kayıtları da alıp açabiliyordu. |
| b | **Ekipte ana kimlik devri telefon değişimiyle aynı kurala bağlıdır.** RFC-0021 §3 madde 96'nın netleşmesi: `APP_PRIMARY`'de `parentSigned`'ın yerini ekipte RFC-0005'in `ROTATE_DEVICE` tablosu alır. Sahip için diğer bütün sahipler, yönetici için bir sahip, çalışan için yönetim. Bu sağlanmazsa devir bekler (72 saat, veto açık). | Tek yönetici, sahibin telefonunu bekleme ve veto olmadan düşürebiliyordu. |
| c | **Yönetici yalnız kendi alanındaki kişinin telefonunu değiştirebilir.** RFC-0005 §6.2 satır 4'e "yönetici için, değişen kişi yöneticinin yönetim alanındaki bir yerde atanmış olmalı" şartı eklenir (`OUT_OF_SCOPE`). | Yönetici başka yerdeki çalışanın kimliğini kendine çevirip o yerin verisini okuyabiliyordu. |
| d | **Ayrılma, güncel defterde kesin reddedilen olayı uygulamaz.** Ayrılan cihaz olayı kendi kopyasıyla doğrularken, kopyası güncelse (olayın `seq`'i defterin uzunluğuna eşit ve `prev` uyuşuyor) yeter sayı hatası kesin rettir. 7 günlük "eski kopya" yolunda yalnız iş kapsamı silinir; bir sahibin cihazı hiçbir yoldan tam silinmez. | Tek yöneticinin imzaladığı `wipe: true` bir sahibe tam silme yaptırıyordu. |
| e | **Makbuz tek kullanımlıktır ve çıkarma olayına bağlıdır.** `EKIP_CIKIS_OK` imzası çıkarma olayının özetini, kapsamı ve cihazın o anki kimliğini kapsar. Aynı olay için ikinci makbuz yok sayılır. Kapsam olayın istediğinden dar olamaz (`wipe: true` için tam). Telefon değişimiyle düşmüş kimliğin makbuzu kabul edilmez. Posta Kutusu, çıkarılan üyeden yalnız `0xC9`'u kabul eder. | Makbuz yeniden oynatılabiliyor ve eski kimlikten verilebiliyordu. |
| f | **Rol değişince eski kısıtlar geri gelmez.** Geçici başka role geçince TERM'i silinir; yeniden geçici yapılırsa yeni TERM gerekir. Kaldırılıp yeniden eklenen yerin eski atamaları geri gelmez. `TASK_PERMIT` geçiciye görev açmaz (RFC-0005 §5.1). | Belgedeki "hemen geçerli" kuralı eski durumun sessizce dönmesiyle bozuluyordu. |

## 3. Hata kodları

| RFC | Kodlar |
|-----|--------|
| 0005 | `OUT_OF_SCOPE` (telefon değişiminde de), `INVALID_RECEIPT`, `DUPLICATE_RECEIPT` |

## 4. Koda yansıyan düzeltmeler

§2'nin bütün maddeleri dell'in kodunda değişiklik ister. Görevi `kollar/D-cekirdek.md`'dedir; bulgular `kollar/D-inceleme-7.md`'dedir.

## 5. Kurucu belgede değişecekler

| Bölüm | Değişiklik |
|-------|------------|
| §22 | HF54: "Ekipte süresi dolan geçicinin erişimi her yoldan kesilir; ana kimlik devri telefon değişimiyle aynı kurala bağlıdır; yönetici yalnız kendi alanında telefon değiştirir; ayrılma güncel defterde reddedilen olayı uygulamaz (RFC-0022)." |
