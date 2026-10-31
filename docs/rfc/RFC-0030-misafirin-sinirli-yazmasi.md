# RFC-0030 — Misafirin sınırlı yazması: bakıcı yalnız bırakır

> Durum: **Onaylandı** (Kerem, 24 Ekim 2026), kurucu belge 1.15 · 24 Ekim 2026 · Yazan: Havenfold çekirdek ekibi · Onay: Kerem
> Karar kaynağı: Kerem, 24 Ekim 2026 — "Yazamayacaksa bir anlamı yok. Bakıcının da yazması lazım." (Yuva Pati YP1, Yuva Bakım YB4)
> Kurucu belge: §6 (olay tablosu, düzey), §7.4, §7.7, §22. Etkilenen RFC'ler: 0001 (§7, §10, §15), 0003 (§5.5, §5.9, §7), 0006 (§10.2).
> **Protokol değişikliği vardır:** yeni defter olayı 36 `GRANT_WRITE`, düzey 2.3, yetenek biti `MISAFIR_YAZAR = 16384`, `GUEST_VIEW`'e `drops` alanı.

## 1. Sorun

- Bakıcı (misafir) bugün yalnız okur: `grant:` hiçbir koleksiyonun yazarı olamaz (RFC-0003 §5.9 `GUEST_CANNOT_WRITE`, RFC-0001 §15).
- Tatilde Coki'ye bakan bakıcı "mama verdim" yazamazsa aile bildiği bir şeyi göremez. Akşam maması kuralı boşuna çalar; Rosa tatilde bakıcıyı arar.
- Bakıcıyı ailenin koleksiyonuna okuyucu yapmak çözüm değildir: o zaman ailenin bütün ortak bilgisini görür. Misafir aileden değildir (RFC-0003 §7).

## 2. Öneri özeti

- Bakıcı, yalnız ebeveynin izin verdiği **tek bir koleksiyona**, yalnız izin verilen **olay türlerini**, yalnız izin verilen **özne** (ör. Coki) için **bırakabilir**.
- Bırakma, cihazların bugün kullandığı yoldur (RFC-0001 §10 `REC_DROP`): mühürlü bırakılır, bakıcı koleksiyonu **okuyamaz**, başkasının yazdığını göremez, düzeltemez, silemez.
- İzni yeni defter olayı **36 `GRANT_WRITE`** verir; herhangi bir ebeveyn imzalar. Misafir kaldırılınca (`REVOKE`) izin de biter.
- `GUEST_CANNOT_WRITE` kuralı aynen kalır: misafir hiçbir koleksiyonun `writers` listesine girmez. Yeni yol yalnız bırakmadır.
- Bakıcının bıraktığı olay, ailenin olaylarıyla aynı koleksiyonda durur. Rutin, kural ve günlük onu ayrıca bir şey yapmadan görür. Yazan "Selin (bakıcı)" olarak görünür.

## 3. Defter olayı 36 — `GRANT_WRITE`

```
[ ['grantId', c.fixed16], ['collectionId', c.fixed16],
  ['types', c.array(c.string)], ['subjects', c.array(c.string)] ]
```

| Kural | Hata |
|-------|------|
| İmzacı: en az bir aktif ebeveyn | `NO_PARENT_SIGNATURE` |
| `grantId` aktif bir misafir (`GRANT` var, `REVOKE` yok) | `NO_TARGET` |
| Koleksiyon var; `sensitivity = 'normal'`; `kind` `kasa` ya da `kisisel` değil | `NOT_COLLECTION_ELIGIBLE` |
| Koleksiyonda `dropKey` var (yoksa önce `COLLECTION` ile eklenir, §5) | `NO_DROP_KEY` |
| `types`: 0–16 öğe; her biri ad alanlı olay türü (`yuva.`, `mekan.`); `hf.` türü olamaz (tek istisna: misafirin örtük `hf.sos` izni, RFC-0031 §4.1; `GRANT_WRITE` ile verilmez) | `INVALID_BODY` |
| `subjects`: 1–8 öğe; her biri `varlik:`, `yer:` ya da `uye:` başvurusu (RFC-0006 §4.3) | `INVALID_BODY` |
| Bir misafirin en çok 2 koleksiyonda `GRANT_WRITE`'ı olabilir | `GUEST_LIMIT` |
| `level = '2.3'` | `LEVEL_TOO_LOW` |

- **Etkisi:** `(grantId, collectionId)` için geçerli izin bu olayın içeriğidir. Aynı çift için yeni `GRANT_WRITE` öncekinin yerine geçer.
- **İzni kaldırmak:** `types` boş bir `GRANT_WRITE`. Misafirin `REVOKE`'u bütün izinlerini de bitirir.
- **Süre:** Defter saate bakmaz (K15). `GRANT.expiresAt` dolunca ebeveyn telefonu `REVOKE` önerir ya da kendiliğinden yazar (RFC-0003 §5.5). Süre dolup `REVOKE` yazılana kadar bırakılan olaylar geçerlidir; misafir uygulaması süre dolunca kendini kapattığı için bu pencere küçüktür. Bu sınır bilinçli olarak kabul edilir.

## 4. Bırakmanın geçerliliği

Bir `REC_DROP`, misafirden geldiğinde RFC-0001 §10'daki denetimlere ek olarak şunları sağlarsa geçerlidir:

| # | Koşul | Sağlanmazsa |
|---|-------|-------------|
| 1 | `OpInner.authorId` = `grantId`; imza misafirin anahtarıyla geçerli | Atılır |
| 2 | İşlemin `ledgerSeq` anında `(grantId, collectionId)` için geçerli bir `GRANT_WRITE` var (yetki aralığı tablosuna `grant:` satırı olarak girer, RFC-0001 §7.2) | Atılır |
| 3 | `OpInner.type` izinli `types` içinde | Atılır |
| 4 | Olayın `_subj` alanı izinli `subjects` içinde | Atılır |
| 5 | `op = 2` (append-event); dosya eki yok (v1) | Atılır |
| 6 | Kodlanmış olay ≤ 4 KB | Atılır |

- Koşulların hepsi defter ve olay içeriğine bağlıdır; saate ya da geliş sırasına bağlı değildir. Her telefon aynı sonuca varır.
- `REVOKE`'tan sonra bırakılan olay koşul 2'den düşer. Kesim (RFC-0001 §8) aynen uygulanır.

## 5. Bırakma anahtarı

- Bugün `dropKey` yalnız `kind = 'olaylar'` koleksiyonda olabilir (RFC-0003 §5.9). Bu kural genişler: `dropKey`, `sensitivity = 'normal'` olan ve `kind`'ı `kasa` ya da `kisisel` olmayan her koleksiyonda olabilir.
- `GRANT_WRITE` yazan ebeveyn telefonu, koleksiyonda `dropKey` yoksa önce yeni `dropKey`'li bir `COLLECTION` önerir. Gizli yarısı okuyuculara bugünkü gibi `REC_KEY.dropSecret` ile gider (RFC-0001 §10.1).
- Okuyucu çıkınca `dropKey` bugünkü gibi yenilenir. Misafir yeni anahtarı bir sonraki `GUEST_VIEW`'den alır.

## 6. Misafirin gördüğü

`GUEST_VIEW`'e bir alan eklenir:

```
drops : array<{ collectionId: fixed16, dropKey: fixed32, types: array<string>, subjects: array<string> }>
```

- Yalnız düzey 2.3'te gönderilir. Bugün mağazada misafir uygulaması olmadığı için eski bir alıcı yoktur.
- Misafir, bıraktığı olayları **kendi telefonunda** ayrıca tutar ve "Senin yazdıkların" diye gösterir. Ailenin koleksiyonunu okuyamadığı için başkalarının yazdığını görmez.
- Misafirin gördüğü kart ve bilgi, bugünkü gibi `Bakıcı:<misafir>` koleksiyonundan gelir (okuyucu olarak).

## 7. Olay ve vaka (RFC-0006)

- Misafirin bıraktığı olay, koleksiyondaki diğer olaylar gibi rutine ve kurala girer. "Akşam maması verildi · Selin" kuralın eksiğini kapatır.
- Misafir vaka sahiplenemez ve kapatamaz: `hf.vaka.sahip` ve `hf.vaka.kapat` bugünkü gibi yalnız üyedir. Misafir bildirim merdiveninin kitlesinde değildir.
- Misafirin bıraktığı kapatan olay vakayı çözer (RFC-0032 §6); misafir yine vaka kapatamaz.
- Ailedeki bir üye, misafirin olayını "Bu olay yanlış" diye işaretleyebilir (`hf.olay.duzelt`, RFC-0006 §7.3).

## 8. Düzey ve yetenek

- Yetenek biti: `MISAFIR_YAZAR = 16384` (`HELLO.caps`, `JOIN_HELLO.caps`).
- Bütün aktif üyeler bu biti bildirince bir ebeveyn `PROTOCOL_LEVEL { level: '2.3' }` yazar. Olay 36 ancak bundan sonra yazılabilir (kurucu §6 sürüm kapısı düzeni).
- Düzey 2.3 gelmeden ürün "Bakıcı yazabilsin" seçeneğini gösterir ama kapalı tutar: "Ailedeki herkes uygulamasını güncellediğinde açılır."

## 8.1 Kanal komutları (410–419)

Uygulama ile telefondaki çekirdek arasındaki komutlar (RFC-0024). Aralık `protocol/command-ranges.json`'a eklenir.

| No | Ad | Girdi → Çıktı | Kim |
|----|----|---------------|-----|
| 410 | `CAREGIVER_WRITE_GRANT` (`LedgerApi.grantCaregiverWrite`) | `{ grantId, collectionId, types, subjects }` → `null`; `types` boşsa izni kaldırır | Ebeveyn |
| 411 | `GUEST_PERMISSIONS` (`GuestWriteApi.permissions`) | `{}` → `[{ collectionId, types, subjects }]` (son `GUEST_VIEW.drops`) | Misafir |
| 412 | `GUEST_DROP` (`GuestWriteApi.drop`) | `{ collectionId, type, subj, govde }` → `{ recordId }` | Misafir |
| 413 | `GUEST_MY_WRITES` (`GuestWriteApi.myWrites`) | `{ collectionId? }` → `[{ recordId, type, subj, at }]` (yalnız telefonda) | Misafir |
| 414–419 | ayrılmış | | |

- **Yeni aile:** `LedgerApi.createFamily` yeni ailede kurucunun bildiği en yüksek düzeyi yazar; düzey 2.3'ü bilen istemcide bu 2.3'tür (RFC-0017'deki 2.2 düzeni gibi).

## 9. Ürünlerde kullanım

| Ürün | Koleksiyon | `types` | `subjects` |
|------|------------|---------|------------|
| Yuva Pati | Hayvanın günlüğünün durduğu koleksiyon (Tüm Aile) | `yuva.pet.beslenme`, `yuva.pet.su`, `yuva.pet.kum`, `yuva.pet.yuruyus`, `yuva.pet.ilac-verildi`, `yuva.pet.not` | `varlik:<Coki>` |
| Yuva Bakım | Yaşlının olaylarının durduğu `Olaylar:<yer>` | `yuva.bakim.ugradi`, `yuva.bakim.not` | `uye:<Elena>` |

- **Bilinen sınır:** Yuva Defteri'nin Bakım Masası'ndaki ilaç dozları `Sağlık:<üye>` koleksiyonundadır ve bu koleksiyon kasa gibi korunur. Bakıcı oraya bırakamaz; "ilacı verdim" v1'de Yuva Bakım'ın `yuva.bakim.not`'u olarak gider. Sağlık koleksiyonuna bakıcı yazması ayrı bir karardır.
- Bakıcıya izin verirken ürün ekranı neyi yazabileceğini açıkça listeler; ebeveyn parmak izi ya da yüzle onaylar.

## 10. Güvenlik değerlendirmesi

| Tehdit | Önlem |
|--------|-------|
| Bakıcı ailenin bilgisini okur | Okuyucu olmaz; yalnız mühürlü bırakır. `GUEST_CANNOT_WRITE` aynen geçerli. |
| Bakıcı sahte ya da çok olay yazar | Yalnız izinli tür ve özne; yazan her zaman "bakıcı" görünür; "Bu olay yanlış" ve `REVOKE` her an. Arayüz, bakıcının yazma sıklığını sınırlar. |
| Bakıcı başkasının olayını değiştirir ya da siler | Yalnız `op = 2`; `put` ve `del` kapalı. |
| Süresi dolan bakıcı yazmaya devam eder | Uygulama süre dolunca kapanır; `REVOKE`'tan sonraki olaylar geçersiz (§3, §4). |
| Bakıcının telefonu çalınır | Ebeveyn `REVOKE` yazar; misafir zaten okuyamadığı için çalınan telefonda aile verisi yoktur. |
| Kasa ya da kişisel bilgiye yazma | Bu koleksiyonlarda `GRANT_WRITE` geçersiz (§3). |

## 11. Kurucu belgede değişecekler (1.15)

| Bölüm | Değişiklik |
|-------|------------|
| §6 olay tablosu | Satır: "36 · `GRANT_WRITE` · Herhangi bir ebeveyn (RFC-0030, düzey 2.3)". |
| §6 düzey | "Düzey 2.3 (RFC-0030): `MISAFIR_YAZAR = 16384`; olay 36." |
| §7.4 ya da §7.7 | "Misafir yalnız okur; ebeveynin izin verdiği tek koleksiyona, izinli tür ve özne için yalnız bırakabilir (RFC-0030)." |
| §22 | HF62 eklenir. |

**HF62:** Misafir (bakıcı) hiçbir koleksiyonun yazarı olmaz, ama ebeveynin `GRANT_WRITE` ile izin verdiği koleksiyona, izinli tür ve özne için mühürlü olay bırakabilir; okuyamaz, düzeltemez, silemez (RFC-0030). — Gerekçe: Yazamayan bakıcının anlamı yok; okuyan bakıcı ise ailenin bilgisini görür (Kerem, 24 Ekim 2026).

## 12. Diğer RFC'lerde değişecekler

| RFC | Yer | Değişiklik |
|-----|-----|------------|
| 0001 | §7 koşul 6 | "`append-event` yalnız `device:` yazarları içindir" → "`device:` yazarları ve `GRANT_WRITE` izni olan misafir içindir (RFC-0030 §4)". |
| 0001 | §15 | "Misafir yalnız okur" satırına: "İzinli koleksiyona yalnız bırakır (RFC-0030)." |
| 0003 | §5.9 | "`dropKey` yalnız `kind = 'olaylar'` koleksiyonda" → §5'teki genişletilmiş kural. `GUEST_CANNOT_WRITE` aynen. |
| 0003 | §7 | `GUEST_VIEW`'e `drops` alanı (§6). |
| 0003 | §6.1 oturum tablosu | Üye ↔ misafir satırına: "misafirden yalnız bütün öğeleri `REC_DROP` (kind 1) olan `REC_OPS`" (dell D78 notu c). |
| 0006 | §10.2 | `hf.vaka.sahip` ve `hf.vaka.kapat` "yalnız üye" kalır; misafirin olayı vakaya girer (§7). |

## 13. Ürün belgelerine etkisi

- Yuva Pati: P45 "Bakıcı ekle" ekranına "Günlüğe yazabilir: mama, su, kum kabı, yürüyüş, ilaç" seçimi; P46 bakıcının ekranında büyük "Mama verdim" düğmeleri ve "Senin yazdıkların"; P23 günlükte "Selin (bakıcı)" yazarı.
- Yuva Bakım: B41 ve B42 aynı biçimde; "Uğradım" ve not.
- Yuva Defteri: değişmez (Bakıcıyla paylaş kopyası okuma olarak kalır).

## 14. Alternatifler

| Seçenek | Neden seçilmedi |
|---------|-----------------|
| Bakıcıyı Tüm Aile'nin yazarı yapmak | Yazar okuyucu da olmak zorunda; bakıcı ailenin bütün ortak bilgisini görür. |
| Bakıcı kendi `Bakıcı:<misafir>` koleksiyonuna yazsın, aile oradan kopyalasın | Kopyalayan üye yazar olarak görünür; kural ve rutin iki koleksiyona bakmak zorunda kalır; çift olay riski. |
| Bakıcı yazamaz, Yuva Hat'tan mesaj atar | Kerem'in kararına ters; kural ve rutin mesajı görmez. |

## 15. Test vektörleri

`protocol/vectors/guest-write.json`: geçerli `GRANT_WRITE`; kasa koleksiyonuna `GRANT_WRITE` (`NOT_COLLECTION_ELIGIBLE`); izinli tür ve öznede bırakma (geçerli); izinsiz türde (atılır); izinsiz öznede (atılır); `op = 1` (atılır); `REVOKE`'tan sonra bırakma (atılır); `types` boş `GRANT_WRITE` sonrası bırakma (atılır); düzey 2.2'de olay 36 (`LEVEL_TOO_LOW`).

## 16. Hata kodları

| Kod | Nerede | Anlam |
|-----|--------|-------|
| `NO_DROP_KEY` | Olay 36 | Koleksiyonda `dropKey` yok (yeni) |
| `NOT_COLLECTION_ELIGIBLE` | Olay 36 | Kasa, kişisel ya da `normal` olmayan koleksiyon |
| `GUEST_LIMIT` | Olay 36 | Misafirin ikiden çok koleksiyonda izni olur |
| `NO_TARGET` | Olay 36 | Misafir aktif değil |
| `LEVEL_TOO_LOW` | Olay 36 | Düzey 2.3 yazılmamış |
| `INVALID_BODY` | Olay 36 | Tür ya da özne listesi kurala uymuyor |
| `TYPE_NOT_ALLOWED` | Bırakma | Tür izinli `types` içinde değil; olay atılır |
| `SUBJECT_NOT_ALLOWED` | Bırakma | Özne izinli `subjects` içinde değil; atılır |
| `EXTRA_FORBIDDEN` | Bırakma | Olayda dosya eki var (v1); atılır |
| `DROP_TOO_LARGE` | Bırakma | Kodlanmış olay 4 KB'tan büyük; atılır |

## 17. Geri dönüş yolu

- Olay 36 ve düzey 2.3 henüz hiçbir ailede yazılmadı. Karar geri alınırsa ürünler seçeneği göstermez; düzey 2.3 yazılmamış ailelerde hiçbir şey değişmez.
- Düzey yazıldıktan sonra geri alınırsa ebeveynler bütün `GRANT_WRITE`'ları `types` boş olarak yazar; bakıcı yeniden yalnız okur.
