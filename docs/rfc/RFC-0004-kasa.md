# RFC-0004 — Kasa: Shamir payları, yedek ve kurtarma

> Durum: **Onaylandı** (Kerem, 23 Ekim 2026) · Kurucu belge 1.1 ile yürürlükte · Yazan: Havenfold çekirdek ekibi · Onay: Kerem
> Kurucu belge: §10, §13. Bağımlılık: RFC-0003 (cihazlar, `ROTATE_DEVICE`, emanet mührü), RFC-0001 (dönem anahtarları, dosya biçimi), RFC-0002 (`hf.task.backup`).
> Önceki tasarım: EserX `yuva/docs/09-aile-kutusu.md` §10. Bu RFC onun yerine geçer.
> Kod yeri: `havenfold/core/kasa` (`@havenfold/vault`).

## 1. Sorun

Bir telefon kaybolunca mesaj geçmişi ve yalnız o telefonda duran anahtarlar gidiyor: kişisel koleksiyon anahtarları, tek ebeveynli ailede kasa koleksiyonu.

Bunlar geri alınabilmeli. Ama şu durumların hiçbirinde açılmamalı:

- tek bir cihaz çalınınca;
- evdeki bütün cihazlar birlikte çalınınca;
- tek bir aile üyesi evdeki cihazlara erişince.

## 2. Korunan sırlar

| Sır | Kimin | Ne korur |
|-----|-------|----------|
| **YA** (Yedek Anahtarı, 32 B) | Her üye için bir | Üyenin yedek dizinini (§4.5) şifreler |
| **KRA** (Kasa Kurtarma Anahtarı, 32 B) | Her `kasa` koleksiyonu için bir | Kasa zarfını şifreler: o koleksiyonun bütün dönem anahtarları |

**Yedekte ne var:** Arşiv mesajları ve ekler, kişisel koleksiyonların dönem anahtarları, ilk kullanım onayları (RFC-0002 §7), üyenin kendi kasa payları.

## 3. Pay sahipleri ve eşik

### 3.1 Uygunluk

| Taraf | Kim | Not |
|-------|-----|-----|
| **Kişi** | Ebeveyn ve yetişkin rolündeki aktif, bekleyen olmayan telefonlar; ev dışı kâğıt paylar (en çok 2). Mekan'da (ekip) sahip, yönetici ve çalışan telefonları (RFC-0005). | Çocuk telefonu pay tutmaz. Misafir pay tutmaz. Ekipte geçici pay tutmaz. |
| **Cihaz** | Kutu ve TPM'li işçiler. Cihaz payı yalnız Linux konteyner düğümünde (`runtime = 'linux-konteyner'`) ve TPM mührü doğrulanmışsa tutulur. | TPM'siz düğüm pay tutmaz. Tepsi uygulaması (Windows/macOS) ve eski Android kutu pay tutmaz (RFC-0008). Cihazın `tpm: true` beyanı tek başına yetmez: kurulum, TPM'ye mühürleme işleminin başarılı olduğunu doğrulamalıdır. |

**Evdeki kâğıt pay sayılmaz.** Kâğıt pay her zaman "evin dışında, güvendiğiniz birinde saklayın" diye basılır.

**Dürüst sınır:** Cihaz payı TPM'ye mühürlüdür, ama PCR'a bağlı değildir. Kutunun içinde kök yetkisi olan biri payı açabilir. Bu yüzden bu RFC, cihaz paylarını tek bir kişinin erişebileceği paylar olarak sayar:

- **YA için:** Tek bir kişi payı ile bütün cihaz payları birlikte eşiğe ulaşamaz. Böylece bir ebeveyn, kutuya erişerek öbür üyenin yedeğini tek başına açamaz.
- **KRA için:** Bütün cihaz payları birlikte eşiğe ulaşamaz. KRA'nın pay sahipleri zaten o kasanın okuyucularıdır; okuyucu kasayı okuyabilir.

### 3.2 YA eşiği ve dağıtımı

**Pay sahiplerini sırrın sahibi seçer.** Arayüz uygun listeyi ve bir varsayılan önerir:

| Sahip | Varsayılan kişi payları |
|-------|-------------------------|
| Ebeveyn, yetişkin | Diğer ebeveyn ve yetişkinler + 1 ev dışı kâğıt |
| Çocuk | Ebeveynler + 1 ev dışı kâğıt |

Çocukta varsayılan, iki ebeveynin birlikte çocuğun yedeğini, kişisel koleksiyonu dahil, açabileceği anlamına gelir. Arayüz bunu açıkça yazar. Çocuk bunu ayarlardan "yalnız kâğıt paylar" seçeneğine çevirebilir (2 kâğıt). Kurucu belge §7.7'deki "ebeveyn kişisel koleksiyona kendini ekleyemez" güvencesi defter yoluyla erişim içindir; yedekten kurtarma, sahibinin seçtiği kişilere verdiği ayrı ve açık bir güvendir.

```
P  = seçilen kişi payları (telefonlar + kâğıtlar)
Dc = cihaz adayları, öncelik sırasıyla: Yuva Kutusu / Mekan Kutusu, sonra TPM'li işçiler (deviceId sırası)

t  = (|P| ≤ 3) ? 2 : 3           // eşik yalnız kişi sayısından hesaplanır
D  = min(|Dc|, t − 2)            // t = 2 → D = 0;  t = 3 → D ≤ 1
n  = |P| + D

Koşul: |P| ≥ t                   // cihazlar olmadan, yalnız kişilerle kurtarılabilir olmalı
```

- Koşul sağlanmazsa YA kasası kurulmaz. Arayüz eksik olanı söyler: "Kurtarma için bir kâğıt pay daha basın" ya da "bir yetişkin seçin".
- `D ≤ t − 2` olduğu için, tek bir kişi payı ile bütün cihaz payları toplamı (`1 + D`) eşikten küçüktür.

| Örnek | P | Dc | t | D | n | Kurtarma için |
|-------|---|----|---|---|---|---------------|
| 2 ebeveyn + kutu; Anne'nin YA'sı | Baba + kâğıt = 2 | 1 | 2 | 0 | 2 | Baba + kâğıt |
| 2 ebeveyn + kutu + 2 TPM'li işçi | Baba + kâğıt = 2 | 3 | 2 | 0 | 2 | Baba + kâğıt (cihaz eklemek kurulumu bozmaz) |
| 2 ebeveyn + 2 yetişkin + kutu | 3 + kâğıt = 4 | 1 | 3 | 1 | 5 | 3 pay, en az 2'si kişi |
| Tek ebeveyn + kutu + 1 kâğıt | 1 | 1 | 2 | 0 | 1 | Kurulamaz: ikinci kâğıt gerekir |
| Tek ebeveyn + kutu + 2 kâğıt | 2 | 1 | 2 | 0 | 2 | İki kâğıt |
| Ergen, "yalnız kâğıt" | 2 kâğıt | 1 | 2 | 0 | 2 | İki kâğıt |

Üçüncü örnekte (t = 3, D = 1) kutu payı tek bir kişi payıyla birlikte eşiğe ulaşmaz (1 + 1 < 3).

### 3.3 KRA eşiği ve dağıtımı

```
P  = kasa koleksiyonunun okuyucusu olan telefonlar + ev dışı kâğıt paylar (en çok 2)
Dc = cihaz adayları (§3.2'deki sıra)

t  = (|P| ≤ 3) ? 2 : 3
D  = min(|Dc|, t − 1)
Koşul: |P| ≥ 1  ve  |P| − 1 + D ≥ t     // herhangi bir okuyucunun telefonu kaybolsa da kurtarılabilir olmalı
```

- Okuyucu olmayan yetişkinler KRA payı tutmaz.
- Örnek: Tek okuyucu + kutu, kâğıt yok → P = 1, t = 2, D = 1 → 1 − 1 + 1 = 1 < 2 → kurulamaz; ev dışı kâğıt gerekir.
- **KRA'nın kendisi:** Okuyucular KRA'yı telefonda Arşiv katmanında saklar. Zarfı yeniden üretmek için gerekir.
- Cihazlar birlikte en çok `t − 1` paya ulaşır, yani tek başlarına açamaz.

## 4. Biçimler

### 4.1 Shamir kütüphanesi

- GF(256) üzerinde Shamir. Paket: `shamir-secret-sharing` (privy-io). Apache-2.0 lisanslı, Cure53 ve Zellic tarafından denetlenmiş.
- Sürüm kesin sabitlenir. Denetim raporları `havenfold/arastirma/denetim/` altına konur.
- Bu kütüphane 32 baytlık bir sır için 33 baytlık pay üretir. Payın **son baytı** x koordinatıdır ve kütüphane bunu rastgele seçer. Bu yüzden `index` alanı tutulmaz: `index = share[32]`.
- **Rastgelelik:** Kütüphane `globalThis.crypto.getRandomValues` kullanır. Bare ortamında bu işlev `sodium.randombytes_buf` ile sağlanır (`@havenfold/vault` içinde tek bir yama). Test vektörlerinde aynı yama, sabit bir akış verecek şekilde değiştirilir.
- **Zamanlama:** Kütüphanenin GF(256) tablo aramaları sabit zamanlı değildir. Birleştirme yalnız istekçinin kendi cihazında, kendi payları üzerinde yapıldığı için bu kabul edilmiştir.
- Kütüphane değiştirmek RFC ister (kurucu belge H7).

### 4.2 Kimlikler ve sürüm

- **`rootId`:** Sırrın sahibinin cihaz değişimi zincirindeki ilk kimliği. Defterde `rotatedFrom` bağları geriye izlenerek bulunur.
- **YA için:** `secretId = hash('hf/kasa-ya-id/', familyId, rootId)[0..16]`. Cihaz değişse de aynı kalır.
- **KRA için:** `secretId = collectionId`.
- **`version`:** Her döndürmede artar. Ayrı bir alandır, `secretId`'ye girmez.

### 4.3 Pay

```
KASA_SHARE {
  secretId  : fixed16
  kind      : uint      // 0 YA, 1 KRA
  version   : uint
  threshold : uint
  total     : uint
  share     : fixed33   // kütüphanenin payı; son bayt x koordinatı
  holderId  : fixed16   // memberId, deviceId ya da kâğıt için 0xFF × 15 ‖ kâğıt sırası
  commit    : fixed32   // hash('hf/kasa-commit/', secretId, u64be(version), sır)
}
```

### 4.4 Payın saklanması

| Sahip | Nerede | Koruma |
|-------|--------|--------|
| Telefon | Arşiv katmanı | Biyometri olmadan okunmaz |
| Kutu, TPM'li işçi | Dosya | TPM 2.0 ile mühürlü (tpm2-tss) |

**Kâğıt payı biçimi:**

- `hfk1:` öneki + RFC 4648 base32 (büyük harf, dolgusuz) ile kodlanmış `KASA_SHARE`'ın kendisi + 4 baytlık sağlama: `hash('hf/kasa-paper/', kodlama)[0..4]`.
- QR ve aynı metin, insanın okuyabileceği bir kâğıt şablonunda basılır. Kâğıtta ailenin adı ve "Kasa payı 1/2, sürüm 3" yazar.
- Kâğıt şifresizdir; tek başına sırrı açmaz.

### 4.5 Yedek

- Yedek blokları RFC-0001 §11 dosya biçimiyle şifrelenir. **Her yüklemede yeni ve rastgele bir `fileKey`** kullanılır. Değişen blok yeni bir dosya olarak yüklenir, eski dosyası silinir. Aynı anahtar iki içerik için hiç kullanılmaz.
- **Yedek dizini:**

  ```
  BACKUP_INDEX { memberRootId, version, seq, blocks: array<{ blokNo, blobId, fileKey, size }> }
  ```

  YA ile şifrelenir:

  ```
  sealed = nonce(24) ‖ XChaCha20-Poly1305(YA, BACKUP_INDEX, AD = hash('hf/kasa-index-ad/', secretId, u64be(version), u64be(seq)))
  ```

  Dizin, yedek bloklarıyla aynı yerde (kutu, TPM'li işçi) tutulur. Her yedeklemede `seq` artar.
- **Ne zaman:** Gece, Wi-Fi'de ve şarjdayken. Yalnız değişen bloklar yüklenir.
- Bloklar ve dizin `hf.task.backup` ile saklanır (RFC-0002 §5).

### 4.6 Kasa zarfı

```
KASA_ENVELOPE {
  collectionId : fixed16
  version      : uint
  envSeq       : uint                 // her yeniden üretimde artar
  lastEpochSeq : uint                 // içerdiği en son dönem
  nonce        : fixed24
  ct           : buffer               // XChaCha20-Poly1305(KRA, nonce, encode({ epochs: [{ epochSeq, epochHash, keys }], dropSecret? }), AD)
  writerId     : fixed16
  sig          : fixed64              // Ed25519(writer, hash('hf/kasa-env/', familyId, gönderilen baytlar sig hariç))
}
AD = hash('hf/kasa-env-ad/', collectionId, u64be(version), u64be(envSeq), u64be(lastEpochSeq))
```

- Her dönem değişiminde, yeni dönemin anahtarını üreten okuyucu (RFC-0001 §9.2) zarfı yeniden üretir.
- Zarf; kutuya, TPM'li işçilere ve okuyucuların telefonlarına opak dosya olarak gider.

## 5. Pay verme ve kurtarma

### 5.1 Mesajlar

```
KASA_VERSION_REQ (0x9E) { secretId }
KASA_VERSION_RES (0x9F) { secretId, version, threshold, total }
KASA_SHARE_REQ   (0x9B) { secretId, kind, version, requesterId, reason: 'restore' | 'rotate', sig }   // etiket 'hf/kasa-req/'
KASA_SHARE_RES   (0x9C) { share: KASA_SHARE }
```

- `sig = Ed25519(istekçi, hash('hf/kasa-req/', familyId, gönderilen baytlar sig hariç))`.
- Mesajlar çift kanalında gider. Emanet ya da Posta Kutusu yolunda RFC-0003 §6.4 mührüyle.
- Yeni telefon önce `KASA_VERSION_REQ` ile güncel sürümü öğrenir, sonra o sürüm için pay ister.

### 5.2 Pay sahibinin denetimi

| # | Koşul |
|---|-------|
| 1 | `sig` geçerli; `requesterId` aktif ve bekleyen değil |
| 2 | **YA:** `requesterId`, `secretId`'nin `rootId` zincirinin bugünkü ucudur, yani sırrın sahibinin şu anki cihazıdır |
| 3 | **KRA:** `requesterId` bugün o kasa koleksiyonunun okuyucusu |
| 4 | **Cihaz değişimi beklemesi:** İstekçinin cihazı `ROTATE_DEVICE` ile geldiyse ve eski cihaz bu olayı **imzalamadıysa**, pay sahibi bu olayı ilk gördüğü andan itibaren **72 saat** bekler. Bu sürede eski cihaza `security { type: 'rotate_pending_share' }` bildirimi gider. Süre içinde istekçiyi çıkaran bir olay görülürse pay verilmez. Kural bütün rollerde geçerlidir: ebeveyn için K16'nın beklemesiyle örtüşür, diğer roller için pay sahiplerinin kendi kuralıdır. |
| 5 | Aynı istekçiye aynı sır ve sürüm için en çok günde bir pay |

- **Kişi tarafı** (telefon): Denetimler geçince kullanıcıya sorar ("Anne'nin yeni telefonu yedeğini açmak istiyor. İzin veriyor musun?") ve biyometriyle onaylatır.
- **Cihaz tarafı:** Denetimler geçince sormadan verir.
- **Kâğıt:** Kullanıcı yeni telefonla okutur.

### 5.3 Birleştirme

1. İstekçi `t` payı toplar ve birleştirir.
2. `commit` değerini doğrular. Uyuşmazsa başka bir pay kombinasyonunu dener. Yeterli doğru pay yoksa "Bir pay bozuk" der.
3. **YA:** Ulaşabildiği bütün tutuculardan yedek dizinini ister ve geçerli olanlar arasında en büyük `seq`'liyi kullanır. Bir tutucu eski dizin verse bile daha yenisi kazanır. Blokları çeker, Arşiv'i yeniden kurar; kişisel koleksiyon anahtarları geri gelir.
4. **KRA:** Ulaştığı bütün geçerli zarfları açar ve içindeki dönemleri birleştirir. İki okuyucu aynı `envSeq` ile farklı zarf üretmiş olabilir; birleştirmek hiçbir dönemin kaybolmamasını sağlar. Dönem anahtarları geri gelir; eksik kalan sonraki dönemler `REC_KEY_REQ` ile okuyuculardan istenir.
5. Hemen ardından sırrı döndürür (§6).

## 6. Döndürme

**Ne zaman zorunlu:**

- Bir pay sahibi çıkınca: üye atıldı ya da ayrıldı, rolü çocuğa döndü, KRA'da okuyuculuktan çıktı, cihaz emekliye ayrıldı ya da çalındı.
- Bir kurtarmadan sonra.

**Ne zaman isteğe bağlı:** Pay sahibi listesi genişleyince. Bu durumda yalnız yeni dağıtım yapılabilir.

**Nasıl:** Aynı sır yeniden bölünmez, çünkü eski paylar kendi aralarında aynı sırrı hâlâ açabilir.

| Sır | Adımlar |
|-----|---------|
| YA | Yeni YA üretilir, `version` artar. Yedek dizini yeni YA ile yeniden şifrelenir. Yeni paylar dağıtılır, eski dizin silinir. Pay sahibi **çalınmışsa**: bütün bloklar sonraki gecelerde yeni `fileKey`'lerle yeniden yüklenir ve eskileri silinir. Böylece eski paylarla eski dizin elde edilse bile bloklar işe yaramaz. |
| KRA | Yeni KRA üretilir, `version` artar. Kasa zarfı yeniden şifrelenir. Yeni paylar dağıtılır. Kasa koleksiyonunda yeni dönem ayrıca başlatılmaz; her `DEVICE_DETACH` ve kutunun `REMOVE_MEMBER`'ı kasa koleksiyonlarında zaten kendiliğinden yeni dönem başlatır (RFC-0001 §9.1). |

**Kâğıt pay:** Döndürmeden sonra yeni kâğıt basılması istenir: "Kasa güncellendi. Yeni kâğıdı basıp eskisiyle değiştirin." Yeni kâğıt basılana kadar koşul sağlanmıyorsa ebeveynlere her gün hatırlatma gider.

**Kim yapar:**

- YA'yı sahibi döndürür.
- KRA'yı, döndürmeyi gerektiren olaydan sonra o kasa koleksiyonunda sıralamada ilk okuyucu döndürür (RFC-0001 §9.2). Diğer okuyucular onu göremezse kendileri döndürür; birden çok yeni KRA olursa en büyük `version`, eşitlikte en küçük `hash('hf/kasa-kra/', KRA)` geçerlidir.

## 7. Arayüz

| Yer | Ne |
|-----|----|
| Ayarlar → Kasa | "Yedeğiniz 2 kişide: Baba ve kâğıt. Açmak için 2 gerekir." Son yedek zamanı. "Pay sahiplerini değiştir". "Kâğıt payı bas". |
| Kurulum | Kasa ilk kez kurulurken ev dışı kâğıt payın neden gerektiği tek cümleyle anlatılır. Çocukta varsayılan pay sahipleri ve anlamı yazar. |
| Kayıp telefon | Tören → `ROTATE_DEVICE` → gerekiyorsa 72 saat → "Yedeği geri yükle" → paylar toplanır. |
| Uyarı | Koşul sağlanmıyorsa ya da yedek 7 günden eskiyse bildirim. |

## 8. Test vektörleri

`protocol/vectors/vault.json`:

1. Sabit rastgelelik yamasıyla pay üretimi; `share[32]` x koordinatı.
2. §3.2 ve §3.3 tablolarındaki her satır: `t`, `D`, `n` ve "kurulamaz".
3. YA: tek kişi payı + bütün cihaz payları → birleştirme başarısız.
4. Eski cihazın imzalamadığı `ROTATE_DEVICE`; 72 saat dolmadan istek → pay verilmez.
5. Döndürmeden sonra eski paylar eski sırrı açar; ama `version` uyuşmaz ve yeni dizin açılmaz.
6. Bozuk pay → `commit` uyuşmazlığı.
7. Yedek dizini AD'si ve `secretId` türetimi.

## 9. Güvenlik değerlendirmesi

| Tehdit | Önlem |
|--------|-------|
| Evdeki bütün cihazlar çalınır | YA'da cihaz payı ≤ t − 2; KRA'da ≤ t − 1; evdeki kâğıt pay sayılmaz |
| Bir aile üyesi kutuya erişip başkasının yedeğini açar | Tek kişi payı + bütün cihaz payları < t (YA) |
| İki ebeveyn birlikte çocuğun yedeğini açar | Varsayılan ayarda mümkündür. Bu açıkça yazılır; çocuk "yalnız kâğıt" seçebilir. |
| Kurtarma bahanesiyle yedek çalma | Tören + `ROTATE_DEVICE` + eski cihaz imzalamadıysa 72 saat + kişi tarafında biyometrili onay |
| Eski paylar toplanır | Döndürme yeni sır üretir; çalınmada bloklar ve kasa dönemi de yenilenir |
| Aynı anahtarla iki içerik | Her yüklemede yeni `fileKey` |
| Shamir uygulama hatası | Denetlenmiş kütüphane, sabit sürüm, `commit` doğrulaması |

## 10. Kurucu belgede değişecekler

- §10.2: Bu RFC'nin §3 kuralları gelir. YA'da cihaz payı ≤ t − 2. KRA'da okuyucu olmayan yetişkin pay tutmaz. Pay sahiplerini sırrın sahibi seçer. Çocuk telefonu pay tutmaz.
- §10.1: Yedek dizini ve her yüklemede yeni dosya anahtarı eklenir.
- §13.1 T1, T2: "En çok bir kasa payı" ifadesi bu RFC'deki sınırlarla değişir.

## 11. Uygulama sırası

1. Eşik algoritması, pay üretimi, saklama (Arşiv, TPM mühür), kütüphane yaması; vektörler 1–3, 7.
2. Yedek: dizin, bloklar, `hf.task.backup`.
3. Pay isteme, birleştirme, kayıp telefon akışı; vektörler 4, 6.
4. Döndürme; vektör 5.
5. Kasa koleksiyonu KRA ve zarfı (Yuva Defteri v1 ile, Faz 3).
6. Bağımsız güvenlik denetimi, yayından önce.

## Ek (RFC-0016, 23 Ekim 2026)

- §3.1: Cihaz payı yalnız TPM mührü doğrulanmış Linux konteyner düğümünde; tepsi uygulaması ve eski Android kutu pay tutmaz (RFC-0008).
- §3.1: Mekan'da kişi tarafı sahip, yönetici ve çalışandır (RFC-0005).
