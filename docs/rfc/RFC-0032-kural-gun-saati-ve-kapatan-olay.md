# RFC-0032 — Kural için gün saati, çok günlük pencere ve kapatan olay

> Durum: **Onaylandı** (Kerem, 24 Ekim 2026), kurucu belge 1.17 · 24 Ekim 2026 · Yazan: Havenfold çekirdek ekibi · Onay: Kerem
> Kaynak: Yuva Pati `docs/02` §3.3, `docs/07` YP11, H1–H3; Yuva Bakım `docs/02` §4–§5, `docs/07` YB7, H1–H2; RFC-0030 §7.
> Etkilenen RFC'ler: 0006 (§9.1, §9.2, §10.3, §11.4, §12, §17), 0019 (§7.2), 0030 (§7).
> **Protokol değişikliği: yok.** Defter olayı, zarf, düzey ve HELLO biti değişmez. Yeni kanal komutu yok. Yalnız `hf.kural` kaydına isteğe bağlı alanlar ve motor kuralları eklenir. `RULE_WRITE` (265) yeni alanları taşır; `CASE_LIST` (266) yanıtında yeni bir durum değeri (`cozuldu`) olur.

## 1. Sorun

- RFC-0006 §9.2'de kural yalnız **kayan pencereyle** çalışır. Günün saati yoktur. "Akşam maması 20:00'ye kadar verilmediyse" yazılamaz; kural sabah 03:00'te de tetiklenir.
- `pencere_dk` en çok 1440'tır. "Kum kabı 2 gündür temizlenmedi" tek koşulla yazılamaz.
- Vaka yalnız üyenin `hf.vaka.kapat` kaydıyla kapanır. Mama verilince ya da yaşlı "İyiyim" deyince vaka açık kalır, merdiven yürür.
- Bakıcı (misafir) `hf.vaka.kapat` yazamaz (RFC-0030 §7). Mamayı bakıcı verdiyse aile yine uyarılır.
- Ürünler bunu geçici yollarla çözdü:
  - **Pati YP11:** Uygulama kuralı yalnız hatırlatma saatinde (20:00) değerlendirir. "İki gün üst üste" için iki günün vakasına bakar.
  - **Bakım YB7:** Takip edenlerin telefonları 11:15'te `yuva.bakim.sabah-sinyal-yok` sınır olayını yazar; kural bu olaya bağlanır. Yaşlının telefonu "İyiyim"de `hf.vaka.kapat` da yazar.
- Bu yollar her ürün için ayrı kod ister. Aynı olaylardan her cihazın aynı vakaya varması ürünün dikkatine kalır.
- RFC-0006 §9.1 örneklerindeki adlar Pati'nin kataloğuyla uyuşmuyor: `yuva.pet.eat`, `yuva.pet.litter.*`.

## 2. Öneri özeti

1. `hf.kural`'a `bicim: 2` gelir. Biçim 2'de koşullar **sabit yerel pencerede** değerlendirilir: `gun_saati: [bas_dk, bit_dk]` ve `gun` (1–7 gün).
2. Sabit pencere **bittiğinde** değerlendirilir. `pencereBasi` pencerenin başlangıcıdır. Aynı olaylardan her cihaz aynı vakaya varır.
3. `kapatan_olay` alanı gelir. Bu türden bir olay gelince vaka **çözülür** (`cozuldu`). Çözülme bir kayıt değil, hesaplanan durumdur.
4. Bakıcının bıraktığı olay da vakayı çözer. Bakıcı yine `hf.vaka.kapat` yazamaz.
5. `kesintide_ac` alanı gelir. Gözlem kaynağı kapalıyken de vaka açılmasını sağlar (Bakım için).
6. Eski motor biçim 2 kuralını geçersiz sayar ve hiç değerlendirmez. Yeni kanal komutu, zarf ya da defter olayı yok.

## 3. Tanımlar

| Terim | Anlam |
|-------|-------|
| Yerel gün | `d = floor((_t + utc_dk × 60000) / 86400000)`. RFC-0006 §8.2 ile aynı; `gun_basi_dk = 0`. |
| Sabit pencere | Kuralın `gun_saati` ve `gun` alanlarından hesaplanan `[S, E)` aralığı (Unix ms). |
| `S` | Pencerenin başı. Vaka anahtarındaki `pencereBasi`. |
| `E` | Pencerenin sonu. Değerlendirme anı en erken `E`'dir. |
| Kapatan olay | Türü kuralın `kapatan_olay` listesinde olan olay. |
| Çözülmüş vaka | Kapatan olay geldiği ya da koşul artık sağlanmadığı için merdiveni durmuş vaka (§6). |

## 4. Kural kaydına eklenenler (`hf.kural`)

Hepsi isteğe bağlıdır. Biçim 1 kurallar bugünkü gibi çalışır.

| Alan | Değer | Anlam |
|------|-------|-------|
| `bicim` | int, 1 ya da 2 | Yoksa 1. 2 ise bu RFC'nin kuralları geçer. |
| `gun_saati` | `[bas_dk, bit_dk]`, ikisi de 0–1439 | Yerel başlangıç ve bitiş dakikası. `bit_dk ≤ bas_dk` ise bitiş ertesi gündedir (gece yarısını aşar). Eşitse pencere 24 saattir. Yoksa `[0, 0]`. |
| `gun` | int, 1–7 | Pencerenin kaç gün sürdüğü. Yoksa 1. |
| `utc_dk` | int, −720–840 | Yerel saat farkı, dakika. Yoksa 180. Kartın `utc_dk`'sı değişince ürün kuralı da yeniden yazar. |
| `kapatan_olay` | list<string>, 1–8 tür | Bu türlerden biri gelince vaka çözülür (§6). |
| `kesintide_ac` | bool | `true` ise gözlem kesintisi vakayı engellemez (§5.4). Yoksa `false`. |

**Biçim 2'de koşul öğesi:** `[olay, olcu, alan, 0, karsilastirma, deger]`. `pencere_dk` her zaman **0**'dır. Bütün koşullar aynı sabit pencereye bakar. Ölçüler aynıdır: `sayi`, `toplam`, `yok`.

**Eski motorla uyum:** RFC-0006 §9.1'de `pencere_dk` 1–1440'tır. Biçim 2'yi bilmeyen motor 0'ı geçersiz sayar ve kuralı hiç değerlendirmez (bugünkü kod: `core/events/rule.js` `kuralTanimi` `null` döner). Bu kuralın vakasını da göstermez, çünkü vakanın önemi kaynaktan türetilir (RFC-0019 §11.5 b). Yanlış ya da çift bildirim olmaz; eski telefon yalnız bu vakayı görmez.

## 5. Sabit pencere kuralları

### 5.1 Pencere

Pencere başladığı yerel gün `s` ile adlandırılır:

```
S = s × 86400000 + bas_dk × 60000 − utc_dk × 60000
k = (bit_dk ≤ bas_dk) ? 1 : 0
E = (s + gun − 1 + k) × 86400000 + bit_dk × 60000 − utc_dk × 60000
```

- Her yerel gün için bir pencere vardır. `gun ≥ 2` ise pencereler üst üste biner.
- Kayan pencere yoktur. Biçim 2'de RFC-0006 §9.2'deki `floor(T / …)` hesabı kullanılmaz.

### 5.2 Değerlendirme

1. Koşullar `_t ∈ [S, E)` olan geçerli olaylarla hesaplanır (RFC-0006 §4.5, §7.2, §7.3).
2. Değerlendirme `E`'de ya da motorun `E`'den sonraki ilk çalışmasında yapılır. Pencere içinde erken tetikleme yoktur.
3. Bütün koşullar sağlanırsa vaka açılır:
   - `pencereBasi = S`, `yon = 0`;
   - `vaka` RFC-0006 §10.1'deki gibi hesaplanır;
   - `hf.vaka.pencere = [S, E]` (RFC-0019 §7.2).
4. Sonuç yalnız olay kümesine ve kuralın geçerli son hâline bağlıdır. Motorun saati, olayların geliş sırası ve hangi cihazın önce baktığı sonucu değiştirmez.
5. **Geç değerlendirme:** Motor `E + 24 saat`'ten sonra bakıyorsa vaka açmaz (RFC-0006 §12, RFC-0019 §11.5 c).

### 5.3 Çok günlük pencerede tekrar yok

- `gun ≥ 2` olan kuralda, aynı özne için `s − 1` penceresinde de koşul sağlanıyorsa `s` penceresi **yeni vaka açmaz**. Önceki vaka sürer.
- Bu kural da yalnız olay kümesinden hesaplanır. Vakanın kapalı ya da sahipli olmasına bakmaz.
- Böylece "kum kabı 3 gündür temizlenmedi" her gün yeni bildirim üretmez. Kart günü sayar: "Kum kabı 3 gündür temizlenmedi".

### 5.4 Gözlem kesintisi

- RFC-0006 §9.2'deki %25 kuralı biçim 2'de `yok` koşullarına ve `lt`, `le` karşılaştırmalı `sayi`/`toplam` koşullarına uygulanır. Eksik veri sayıyı düşürür; yanlış alarm olmasın.
- Kesinti RFC-0019 §7.4'e göre olayları yazan cihazlardan hesaplanır.
- `kesintide_ac: true` ise kesinti vakayı engellemez. Kart "Telefonundan haber yok" der. Bakım bunu kullanır: yaşlının telefonu kapalıysa sabah sessizliği tam da haber verilmesi gereken durumdur.

### 5.5 Hangi motor çalıştırır

- Biçim 2 kuralını yalnız **üye telefonu** değerlendirir.
- İşçi biçim 2 kuralını değerlendirmez. Telefon bu kuralları görev parametresine koymaz (RFC-0006 §12). İşçi kapatan olayları göremez; çözülmeyi hesaplayamaz.
- iPhone'da her telefon, sorumlu olduğu biçim 2 kuralları için `E` anına yerel bildirim planlar (RFC-0006 §11.4, Pati 02 §3.4). `E`'de telefon uyanır, eşitler, değerlendirir. Koşul sağlanmıyorsa ya da vaka çözülmüşse bildirimi göstermez.

## 6. Kapatan olay ve çözülme

### 6.1 Çözülme koşulu

Biçim 2 kuralının vakası **çözülmüştür** eğer:

1. **Kapatan olay:** Vakanın koleksiyonunda şu olay varsa:
   - türü kuralın `kapatan_olay` listesinde;
   - `_subj`'u vakanın `_subj`'u;
   - `_t ≥ E` (pencere bittikten sonra; açıklama 1);
   - RFC-0006 §4.5'e göre geçerli, §7.3'e göre düzeltilmemiş.
2. **Koşul artık sağlanmıyor:** Geç gelen bir olay `[S, E)` içine düştü ve koşullar yeniden hesaplanınca sağlanmıyor.

- Yalnız vakanın koleksiyonuna bakılır. Başka koleksiyondaki olay vakayı çözmez; bilgi koleksiyon sınırını aşmaz.
- Rutin vakası ve çekirdek kuralı vakası çözülmez. `kapatan_olay` yalnız biçim 2 kuralında vardır.
- `eylem: 'sustur'` kuralında `kapatan_olay` olmaz.

> **Açıklama 1 (25 Ekim 2026, inceleme 20):** Kapatan olay yalnız pencere bittikten sonra (`_t ≥ E`) sayılır. Pencere içindeki olay, geç gelse de, madde 2'nin yolundan (koşulun yeniden hesabı) çözer; aksi hâlde `sayi lt 2` gibi bir kuralda penceredeki tek olay vakayı açıldığı anda çözerdi. Madde 1 ve 2'de, vakayı açan değerlendirmeyle **aynı olay kümesi** kullanılır (RFC-0006 §4.5 geçerli ve sayılan olaylar; belirsiz olay çözmez). Madde 1'deki özne karşılaştırması iki tarafta da normalleştirilmiş özneyle yapılır.

### 6.2 Çözülme bir kayıt değildir

- Çözülme, RFC-0006 §10.3'e yeni bir madde olarak eklenir: koleksiyonun geçerli kayıtlarından hesaplanır.
- Kimse "çözüldü" kaydı yazmaz. Bu yüzden yazma yetkisi gerekmez.
- **Bakıcı:** Misafirin bıraktığı olay (RFC-0030) koleksiyonda diğer olaylar gibidir. Türü `kapatan_olay`'daysa vakayı çözer. Misafir yine `hf.vaka.sahip` ve `hf.vaka.kapat` yazamaz; RFC-0006 §10.3 madde 7 ve RFC-0030 §7 değişmez.
- Düzeltme (`hf.olay.duzelt`) kapatan olayı geri alırsa çözülme de geri alınır. Merdiven ulaşılan basamaktan, o basamağın süresiyle yeniden başlar. `E + 24 saat` geçtiyse başlamaz.

### 6.3 Çözülmenin sonuçları

- Hiçbir motor yeni basamak yazmaz (RFC-0006 §11.4 madde 3'e "çözülmüş" eklenir).
- Çözülmüş vakanın basamak kayıtları geçerlidir ama bildirim üretmez. `VAKA_UYANDIR` gelen telefon durumu hesaplar, bildirim göstermez.
- Telefon planlı yerel bildirimleri iptal eder, ekrandaki bildirimi kaldırır.
- Kart çözen olayı gösterir: "Çözüldü · Selin mama verdi · 20:12". Koşul yüzünden çözüldüyse: "Geç yazılan kayıtla çözüldü".
- Üye isterse yine `hf.vaka.kapat` yazar (`sonuc`: `gercek`, `yanlis`, `bilgi`). Kapanış çözülmeyi ezmez; ikisi birlikte gösterilir.
- `CASE_LIST` (266) ve SDK `vakalar(…, { durum })` yeni `cozuldu` değerini döner.

## 7. Örnekler

### 7.1 Pati: akşam maması

"Coki'ye 16:00–20:00 arasında mama verilmediyse 20:00'de haber ver."

```
{
  bicim: 2,
  _subj: 'varlik:coki',
  kosullar: [['yuva.pet.beslenme', 'yok', '', 0, 'gt', 0]],
  gun_saati: [960, 1200],
  utc_dk: 180,
  kapatan_olay: ['yuva.pet.beslenme'],
  eylem: 'vaka', onem: 1, aktif: true
}
```

- 20:00'de mama yoksa vaka açılır.
- Bakıcı Selin 20:12'de "Mama verildi" bırakır. Vaka çözülür, merdiven durur. Ailede: "Çözüldü · Selin mama verdi · 20:12".
- 15:30'da verilen mama pencereye girmez. Ürün pencereyi hatırlatma saatinden kurar.

### 7.2 Pati: kum kabı 2 gündür temizlenmedi

```
{
  bicim: 2,
  _subj: 'varlik:coki',
  kosullar: [['yuva.pet.kum', 'yok', '', 0, 'gt', 0]],
  gun_saati: [1200, 1200],
  gun: 2,
  kapatan_olay: ['yuva.pet.kum'],
  eylem: 'vaka', onem: 1, aktif: true
}
```

- Pencere 48 saattir; her akşam 20:00'de biter.
- Üçüncü gün de temizlenmezse yeni vaka açılmaz (§5.3); kart "3 gündür" der.

### 7.3 Bakım: sabah 11:00 sorusu

"Annemden 06:00–11:15 arasında ne güne başladı, ne İyiyim, ne de Yardım lazım geldiyse haber ver."

```
{
  bicim: 2,
  _subj: 'uye:anne',
  kosullar: [
    ['yuva.bakim.gun-basladi', 'yok', '', 0, 'gt', 0],
    ['yuva.bakim.iyiyim',      'yok', '', 0, 'gt', 0],
    ['yuva.bakim.yardim-istedi','yok', '', 0, 'gt', 0]
  ],
  gun_saati: [360, 675],
  utc_dk: 180,
  kapatan_olay: ['yuva.bakim.gun-basladi', 'yuva.bakim.iyiyim'],
  kesintide_ac: true,
  eylem: 'vaka', onem: 2, aktif: true
}
```

- 11:00 sorusu yaşlının telefonunda kalır (Bakım 02 §5). Kural yalnız 11:15'te bakar.
- 11:20'de "İyiyim" gelir; vaka çözülür. Yaşlının telefonu artık `hf.vaka.kapat` yazmak zorunda değildir.
- `yardim-istedi` kapatan değildir. O olay kendi kuralıyla daha yüksek önemli vaka açar.
- Telefon kapalıysa da vaka açılır (`kesintide_ac`). Kart: "Telefonundan haber yok".
- `sabah-sinyal-yok` sınır olayına gerek kalmaz.

## 8. Test vektörleri

Yeni dosya: `protocol/vectors/event-v3.json`. Her vektör telefonda (Bare) ve düğümde (Node 24) aynı sonucu verir. Yerel gün `s = 20745` (19 Ekim 2026), `utc_dk = 180`.

1. **Pencere:** `[960, 1200]` → `S = 1792414800000`, `E = 1792429200000`. `[360, 675]` → `S = 1792378800000`, `E = 1792397700000`. `[1320, 360]` (gece) → `S = 1792436400000`, `E = 1792465200000`.
2. **Çok gün:** `[1200, 1200]`, `gun = 2`, `s = 20744` → `S = 1792342800000`, `E = 1792515600000` (48 saat).
3. **Akşam maması:** Pencerede mama yok → vaka; `pencereBasi = 1792414800000`. 19:38'de (`1792427880000`) mama → vaka yok.
4. **Kapatan olay:** 3'teki vaka; 20:12'de (`1792429920000`) `yuva.pet.beslenme` → `cozuldu`. Aynı olay başka özne için → çözülmez. `_t < S` olan olay → çözülmez.
5. **Bakıcı:** 4'teki olay `REC_DROP` ile misafirden gelir → `cozuldu`. Misafirin `hf.vaka.kapat`'ı → yok sayılır.
6. **Geç olay:** Vaka açıldıktan sonra `_t = 1792427880000` olan mama gelir → koşul sağlanmıyor → `cozuldu`.
7. **Sıra bağımsızlığı:** Olaylar, `hf.vaka`, basamaklar ve kapatan olay üç farklı sırayla uygulanır → aynı vaka anahtarı, aynı durum.
8. **Tekrar yok:** `gun = 2`, üç gün kum yok → yalnız ilk pencere vaka açar.
9. **Kesinti:** Kaynak pencerenin %30'unda kapalı → vaka yok. Aynı kural `kesintide_ac: true` → vaka.
10. **`utc_dk` sınırı:** `gun_saati` yok (`[0, 0]`). `_t = 1792357140000` (yerel 18 Ekim 23:59) `s = 20744` penceresine, `1792359000000` (19 Ekim 00:30) `s = 20745` penceresine düşer.
11. **Eski motor:** `pencere_dk = 0` olan kural → biçim 1 motoru kuralı geçersiz sayar; vaka yok, `hf.vaka` gösterilmez.
12. **Düzeltme:** Kapatan olay `hf.olay.duzelt` ile geri alınır → vaka yeniden açık; düzeltme silinince yine `cozuldu`.
13. **Geç değerlendirme:** Motor `E + 25 saat`'te bakar → vaka yok.

## 9. Güvenlik değerlendirmesi

- **Bakıcı vakayı susturabilir mi?** Yalnız kapatan türden olay bırakarak, yalnız izinli özne için (RFC-0030 §4). Bu, gerçek dünyada "mama verdim" demekle aynıdır. Olay ailede adıyla görünür; üye "Bu olay yanlış" diyebilir (RFC-0006 §7.3). Düzeltme çözülmeyi geri alır.
- **Ciddi vaka:** Kapatan olay önem 3 kuralında da çalışır. Ürün, önem 3 kuralına misafirin bırakabildiği türü kapatan olay olarak koymaz. Bakım'ın önem 2 sabah kuralında kapatan olayları yalnız yaşlının kendi telefonu yazar.
- **Zaman oyunu:** `_t`'yi yazan cihaz seçer. Geriye tarihli kapatan olay da yalnız `_t ≥ S` ise çözer; daha eskisi etkisizdir. Pencere içine tarihli olay zaten koşulu bozar; bu RFC-0006'daki durumla aynıdır.
- **Determinizm:** Vaka anahtarı ve durum yalnız kayıt kümesinden çıkar. İki telefon farklı saatte baksa da aynı vakaya ve aynı çözülmeye varır.
- **Kesinti:** `kesintide_ac` yanlış alarmı artırır. Yalnız "sessizlik tehlikedir" durumunda (Bakım) kullanılır.
- **Gizlilik:** Yeni veri yazılmaz. Çözülme hesaplanır; kart zaten görünen olayı gösterir.

## 10. Kurucu belgede değişecekler (1.17)

- §22'ye karar satırı: **HF64** — "Kural yerel gün saatine bağlı sabit pencereyle ve en çok 7 günlük pencereyle değerlendirilebilir; kapatan olay vakayı çözer. Çözülme kayıt değil, hesaplanan durumdur; misafirin olayı da çözer (RFC-0032)." Gerekçe: "Akşam maması ve sabah işareti ürün koduna kalmasın; bakıcı mamayı verince aile uyarılmasın."
- Sürüm 1.16 → 1.17 (ekleme). Başka bölüm değişmez.

## 11. Diğer RFC'lerde değişecekler

| RFC | Bölüm | Değişiklik |
|-----|-------|------------|
| 0006 | §9.1 | `bicim`, `gun_saati`, `gun`, `utc_dk`, `kapatan_olay`, `kesintide_ac` alanları. Biçim 2'de `pencere_dk = 0`. Örnek adları: `yuva.pet.eat` → `yuva.pet.beslenme`; "Sık gidip az idrar" örneği çıkar: Pati kataloğunda idrar ölçüsü yok, `yuva.pet.kum` alansızdır. Yerine §7.2'deki kum kabı kuralı konur. |
| 0006 | §9.2 | Sabit pencere, değerlendirme anı, tekrar yok, kesinti (bu RFC §5). |
| 0006 | §10.3 | Yeni madde 8: **Çözülmüş** (bu RFC §6). Son paragrafa "çözülmüş" eklenir. |
| 0006 | §11.4 | Madde 3: "Sahipli, kapalı, çözülmüş ya da bastırılmış vakada…" |
| 0006 | §12 | İşçi biçim 2 kuralını değerlendirmez. |
| 0006 | §15 | `vakalar` için `durum: 'cozuldu'`. |
| 0006 | §17 | `event-v3.json` (bu RFC §8). |
| 0019 | §7.2 | Biçim 2'de `pencere = [S, E]`. |
| 0030 | §7 | "Misafirin bıraktığı kapatan olay vakayı çözer; misafir yine vaka kapatamaz." |

## 12. Ürün belgelerine etkisi

- **Yuva Pati:**
  - 02 §3.3: geçici değerlendirme kalkar; kurallar §7.1 ve §7.2'deki gibi yazılır.
  - 07: YP11 kaldırılır; H1, H2 bu RFC'yle karşılanır.
  - H3 (ad düzeltmesi) RFC-0006 metninde bu RFC'yle yapılır. Çekirdek testlerindeki `yuva.pet.eat` (`core/events/test`) dell'in işidir; bu RFC kodu değiştirmez.
- **Yuva Bakım:**
  - 01 §5 ve 02 §5: `yuva.bakim.sabah-sinyal-yok` sınır olayı kalkar; kural §7.3'teki gibi yazılır.
  - 02 §5: "İyiyim" artık `hf.vaka.kapat` yazmaz.
  - 07: YB7 kaldırılır; H1, H2 bu RFC'yle karşılanır.
- **Yuva Acil, Hat, Defter:** Değişiklik yok.

## 13. Alternatifler

| Seçenek | Neden seçilmedi |
|---------|-----------------|
| Sınır olayı (Bakım YB7) | Her ürün kendi zamanlayıcısını yazar. Takip edenlerin hiçbirinin telefonu açık değilse olay geç yazılır. |
| Ürünün kendi saatinde bakması (Pati YP11) | Determinizm ürünün dikkatine kalır; iki gün kuralı ayrı kod ister. |
| Misafire `hf.vaka.kapat` izni | RFC-0006 §10.3 madde 7'yi ve RFC-0030'u bozar. Misafir her vakayı kapatabilir hâle gelir. |
| Kapatan olayda `hf.vaka.kapat` yazılması | Kayıt yazan cihaz gerekir; misafir yazamaz. Aynı vakaya çok kapanış kaydı düşer. |
| `pencere_dk`'yı 10080'e çıkarmak | Kayan pencere günün saatini yine bilmez; işçinin bellek sınırını bozar. |
| Pencere içinde erken tetikleme (`gt`, `ge`) | Biçim 2'de gerek görülmedi. Hızlı eşikler biçim 1'de kalır. |
| Haftanın günleri (`gunler`) | Hiçbir ürün istemedi. Gerekirse sonraki sürümde. |
| Kayan pencereli kurala kapatan olay | Eski motor bunu değerlendirip merdiveni sürdürürdü. Gerekirse kayan pencere biçim 2'ye ayrı alanla taşınır. |

## 14. Hata kodları

| Kod | Nerede | Anlam |
|-----|--------|-------|
| `INVALID_RULE` | `RULE_WRITE` (265) | Kural bu RFC'ye uymuyor (yeni). Örnekler: biçim 2'de `pencere_dk ≠ 0`; biçim 1'de `gun_saati`, `gun`, `kapatan_olay` ya da `kesintide_ac` var; `gun_saati` 0–1439 dışında; `gun` 1–7 dışında; `utc_dk` −720–840 dışında; `kapatan_olay` boş, 8'den çok ya da adı RFC-0006 §5.1'e uymuyor; `eylem: 'sustur'` ile `kapatan_olay`. |

Motor geçersiz kuralı yok sayar. Kod yalnız yazan uygulamaya döner.

## 15. Geri dönüş yolu

- Yeni alanlar isteğe bağlıdır. Biçim 2 kuralı yazılmamış ailede hiçbir şey değişmez.
- Karar geri alınırsa ürünler biçim 2 kuralını `aktif: false` yazar ve geçici yollara döner (YP11, YB7). Eski motor zaten biçim 2'yi değerlendirmez.
- Açılmış vakalar kayıt olarak kalır. Biçim 2'yi bilmeyen motor onları göstermez; bildirim üretmez.
- Çözülme kayıt olmadığı için geri alınacak veri yoktur.
