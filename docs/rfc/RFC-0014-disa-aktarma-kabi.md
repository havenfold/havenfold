# RFC-0014 — Ortak dışa aktarma kabı

> Durum: **Onaylandı** (Kerem, 23 Ekim 2026) · 23 Ekim 2026 · Yazan: Havenfold çekirdek ekibi · Onay: Kerem
> Kurucu belge: §3 ilke 9 (kilitlenme yok), §4 (dışa aktarma), §13.2. Çatı §9 yol 4.
> İlk kullanıcı: Yuva Defteri (`YuvaDefteri/docs/05-kasa-ve-sifreler.md` §5.3, karar YD28).
> Kod yeri: `havenfold/core/kap` (`@havenfold/export`), açma aracı `havenfold/tools/export-open`.

## 1. Sorun

İlke 9'a göre her ürün, kullanıcının verisini açık biçimde ve şifresi kullanıcıda bir dosya olarak dışarı verebilmeli. Her ürün kendi şifreli dosya biçimini yazarsa:

- birden çok kripto yapısı denetlenmek zorunda kalır;
- kullanıcı her ürün için ayrı açma aracı arar.

Yuva Defteri bu ihtiyaç için `.yuvadefter` kabını tanımladı ve Havenfold'a ortak kap olarak önerdi.

## 2. Öneri özeti

- Bütün ürünler tek bir şifreli kap kullanır: **Havenfold kabı**. Kabın içinde, ürünün tanımladığı bir ZIP arşivi durur.
- Ürün kendi dosya uzantısını ve içerik şemasını seçer. Kabın kendisi ortaktır.
- Şifreleme: paroladan Argon2id ile anahtar türetilir, içerik XChaCha20-Poly1305 akışıyla (libsodium `crypto_secretstream`) şifrelenir.
- Açma aracı açık kaynaktır (Apache-2.0).

## 3. Biçim

```
sihir      : "HFKAP" (5 bayt ASCII)
sürüm      : 1 bayt, 0x01
başlık_uz  : uint32 büyük sonlu (≤ 4096)
başlık     : UTF-8 JSON (aşağıda)
akış_başı  : 24 B   (crypto_secretstream_xchacha20poly1305_init_push çıktısı)
parçalar   : her biri ≤ 65536 B düz metin + 17 B; sonuncusu TAG_FINAL
```

**Başlık:**

```json
{
  "kdf": "argon2id13",
  "opslimit": 4,
  "memlimit": 134217728,
  "salt": "<base64, 16 B>",
  "cipher": "xchacha20poly1305-secretstream",
  "chunk": 65536,
  "urun": "yuva-defteri",
  "bicim": "yuva-defter-arsiv",
  "bicimSurum": 1
}
```

**Anahtar ve ek veri:**

```
anahtar        = crypto_pwhash(32, parola, salt, opslimit, memlimit, ALG_ARGON2ID13)
AD (1. parça)  = sihir ‖ sürüm ‖ başlık_uz ‖ başlık
AD (diğerleri) = boş
```

**Kurallar:**

- `opslimit` en az 3, `memlimit` en az 64 MiB olmalı. Daha düşük değerli dosya açılmaz.
- `opslimit` en çok 16, `memlimit` en çok 1 GiB olabilir. Daha yüksek değerli dosya açılmaz; böylece değiştirilmiş bir başlık açan cihazı kilitleyemez.
- `kdf` ve `cipher` yukarıdaki değerlerden başkaysa dosya açılmaz.
- Son parça `TAG_FINAL` taşımazsa dosya kesilmiş sayılır ve açılmaz. `TAG_FINAL`'dan sonra bayt varsa dosya açılmaz.
- Başlık 1. parçanın ek verisine girer. Başlıktaki hiçbir değer (`kdf` parametreleri, `urun`) fark edilmeden değiştirilemez.

## 4. Düz metin: ZIP arşivi

```
icerik.json          ürünün şeması (bicim, bicimSurum)
dosyalar/<ad>        ekler (çözülmüş halde)
BENIOKU.txt          biçimin Türkçe ve İngilizce kısa açıklaması
```

- ZIP sıkıştırmalı ya da sıkıştırmasız olabilir. ZIP içi şifreleme kullanılmaz.
- `icerik.json` içindeki kişi alanları görünen adla yazılır. İç kimlikler (`memberId`, `deviceId`) dışarı çıkmaz.
- Yapay zekanın çıkardığı alanlar her kayıtta `yapay_zeka_alanlari` dizisiyle işaretlenir. Dizi, kaydın `_ai` alanından gelir (RFC-0015 §2.1; kurucu §16.3, AB Yapay Zekâ Yasası md. 50(2)).
- Çekirdeğe ayrılmış öteki alanlar (`_src`, `_conf`, olay alanları) ürün şemasının izin verdiği biçimde yazılır; iç kimlik içeren başvurular (`msg:`, `kayit:`) dışarı çıkmaz.
- Ürün şemaları kendi belgelerinde tanımlanır. Yuva Defteri'nin şeması `yuva-defter-arsiv` sürüm 1'dir (Yuva Defteri 05 §5.3).

## 5. Dosya uzantıları

| Ürün | Uzantı | `bicim` |
|------|--------|---------|
| Yuva Defteri | `.yuvadefter` | `yuva-defter-arsiv` |
| Genel Havenfold dışa aktarması (ürünü olmayan koleksiyonlar) | `.hfkap` | `hf-koleksiyon-arsiv` |
| Mekan | `.mekanarsiv` | Mekan belgelerinde |

Uzantı yalnız kolaylıktır; açma aracı her kabı sihirden tanır.

**Geçiş:** Yuva Defteri'nin ilk taslağında sihir `YUVADEFTER` idi. Yuva Defteri 05 §5.3 artık bu kabı kullanır (YD28). Yuva Defteri'nin yayımlanmış bir sürümü olmadığı için eski sihirli dosya yoktur; okuma desteği gerekmez.

## 6. Parola

- En az 12 karakter.
- Uygulama 24 karakterlik rastgele bir parola önerir ve "bunu bir kâğıda yazın" der.
- Parola hiçbir yerde saklanmaz. Unutulursa dosya açılamaz; uygulama bunu dışa aktarmadan önce söyler.

## 7. Akış kuralları (bütün ürünler için)

- Her dışa aktarma tek seferlik ve açık onaylıdır (ilke 6). Zamanlanmış ya da otomatik dışa aktarma yoktur.
- `kasa` duyarlılığındaki koleksiyon ancak biyometri onayıyla kaba girer.
- Her dışa aktarma, içeriksiz bir günlük kaydı yazar. Ortak veride "Ebeveynler" koleksiyonuna, kişisel veride kişinin kendi koleksiyonuna yazar.
- Dosya işletim sisteminin paylaşım menüsüyle verilir. Uygulamanın geçici kopyası 10 dakika sonra silinir.

## 8. Açma aracı

- `export-open`: komut satırı aracı. Apache-2.0. Yalnız `libsodium` ve standart ZIP okuyucuya bağlıdır.
- Kabı açar, ZIP'i bir klasöre çıkarır. Ürün şemasını bilmesi gerekmez.
- Ürünler kabı içe de alabilir (geri yükleme). Bu, ürünün kendi işidir.

## 9. Algoritma listesine ekleme

Kurucu §13.2'ye iki satır eklenir:

| Algoritma | Kullanım yeri |
|-----------|---------------|
| `crypto_secretstream_xchacha20poly1305` | Dışa aktarma kabı (XChaCha20-Poly1305 üstüne libsodium akış yapısı) |
| Argon2id (`crypto_pwhash`, ALG_ARGON2ID13) | Kabın parolasından anahtar türetme |

Argon2id listede zaten vardı (PIN ve parola); burada kullanım yeri genişler.

## 10. Numaralar

| Tür | Numara |
|-----|--------|
| Sihir | `HFKAP`, sürüm `0x01` |
| Uzantılar | §5 |
| Defter olayı, zarf türü, yetenek biti, çekirdek komutu, türetme etiketi | Yok. Kap topluluğun dışında, kullanıcının elindeki dosyadır; SDK'dan `@havenfold/export` kütüphanesi olarak çağrılır. |

## 11. Test vektörleri

`protocol/vectors/export.json`:

1. Sabit parola, salt ve akış başıyla küçük bir kabın tam baytları.
2. Başlıkta `opslimit` 2'ye düşürülmüş dosya → açılmaz. `memlimit` 2 GiB → açılmaz.
3. Son parçası kesilmiş dosya → açılmaz. `TAG_FINAL`'dan sonra fazladan bayt → açılmaz.
4. Başlığın bir baytı değişmiş dosya → 1. parça doğrulanmaz.

## 12. Güvenlik değerlendirmesi

| Tehdit | Önlem |
|--------|-------|
| Dosya ele geçer, parola kaba kuvvetle denenir | Argon2id, en az 64 MiB bellek; en az 12 karakter; önerilen parola 24 karakter |
| Başlık değiştirilerek zayıf parametre dayatılır | Başlık ek veride; alt sınırlar zorunlu |
| Başlık değiştirilerek açan cihaz kilitlenir | Üst sınırlar: `opslimit ≤ 16`, `memlimit ≤ 1 GiB` |
| Dosya kesilir ya da sonuna veri eklenir | `TAG_FINAL` zorunlu; sonrasında bayt yok |
| İç kimlikler dışarı sızar | Görünen adlar yazılır |
| Unutulan geçici dosya | 10 dakikada silinir |

Kap, kurucu H7 gereği bağımsız güvenlik denetimine girer. Yuva Defteri v1 denetimiyle birlikte yapılır.

## 13. Kurucu belgede değişecekler

- §13.2 algoritma tablosuna §9'daki satırlar eklenir.
- §4 "Topluluk dışına çıkış" satırına: "Dışa aktarma Havenfold kabıyla yapılır (RFC-0014)."
- §17.1 lisans tablosuna yeni satır: "Dışa aktarma kabı açma aracı (`export-open`) · Apache-2.0 · Herkes, Havenfold'u kurmadan kendi verisini açabilsin (ilke 9)." `@havenfold/export` kütüphanesi çekirdeğin parçasıdır, MPL-2.0.

## 14. Uygulama sırası

1. `@havenfold/export`: yazma ve okuma; vektörler 1–4.
2. `export-open` aracı.
3. Yuva Defteri v1'de kullanım.
4. Bağımsız denetim.
