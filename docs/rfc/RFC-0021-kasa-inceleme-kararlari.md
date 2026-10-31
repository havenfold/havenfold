# RFC-0021 — Kasa ve kap incelemesinden kararlar: uyarı süresi, onay süresi, sürüm seçimi, kanonik ZIP

> Durum: **Onaylandı** (Kerem, 23 Ekim 2026) · 23 Ekim 2026 · Yazan: Havenfold çekirdek ekibi · Onay: Kerem
> Kaynak: dell'in D9 kasa düzeltmeleri (`8adb7ed`) üstüne Mac'in incelemesi (`kollar/D-inceleme-5.md`) kap düzeltmeleri (`577bbb2`) üstüne incelemesi (`kollar/D-inceleme-6.md`) ve dell'in durum dosyasındaki 75–96. istekler.
> Kurucu belge: §13, §22. Etkilenen RFC'ler: 0002, 0003, 0004, 0005, 0006, 0013, 0014, 0015, 0017, 0019, 0020.

## 1. Sorun

Kasa düzeltmeleri testlerden geçti, ama inceleme üç yerde RFC-0004'ün açık bıraktığı bir boşluk buldu:

- Eski telefona uyarı yalnız ilk pay isteği gelince gidiyor. 72 saat ise tutucunun değişimi ilk gördüğü andan sayılıyor. Saldırgan isteği 71. saatin sonunda gönderirse sahibin tepki süresi bir dakikaya iniyor.
- Pay sahibi onay verene kadar geçen sürede istekçi aileden çıkarılabiliyor; pay yine de veriliyor. Onayın ne kadar geçerli kaldığı yazılmamış.
- Birleştirme, eldeki paylardan en büyük sürümü seçiyor. Tek kötü tutucu, daha büyük sürümlü sahte bir pay grubuyla kendi sırrını kabul ettirebiliyor.

## 2. Kararlar

| # | Karar | Neden |
|---|-------|-------|
| a | **Uyarı beklemeden gider; 72 saat uyarıdan sayılır.** Pay sahibi, 72 saat kuralına giren bir olayı (RFC-0019 §11.4 b) ilk gördüğü anda, istek beklemeden `security { type: 'rotate_pending_share' }` bildirimini gönderir. Bildirim kişinin bütün aktif kimliklerine, olayın düşürdüğü eski kimliğe ve diğer ebeveynlere gider. 72 saat, bildirimin gönderildiği andan sayılır. | Uyarı penceresi saldırganın seçtiği ana bağlı olmasın; `replaces` ile pasifleşen eski kimlik uyarıyı göremiyordu. |
| b | **Onay en çok 10 dakika geçerlidir; pay verilirken denetimler yinelenir.** İsteğin tazeliği (5 dakika, RFC-0019 §11.4 a) ilk denetimde aranır. Pay sahibinin onayı istekten sonra en çok 10 dakika içinde gelmelidir. Pay verilmeden hemen önce tazelik dışındaki bütün denetimler (üyelik, rol, 72 saat, günlük sınır) yeniden çalışır. Onay, isteğin kendisine bağlı bir jetonla verilir. | Onay beklenirken aileden çıkarılan kişiye pay gidiyordu; uydurma bir istek nesnesi denetimsiz pay alıyordu. |
| c | **Sürüm, dizinden seçilir.** Birleştirme yalnız beklenen `(secretId, kind, version)` paylarını kullanır; beklenen sürüm, dizinin bilinen en son sürümüdür (`KASA_VERSION_RES`). Her tutucudan en çok bir pay alınır. Eşik 2 ya da 3'tür; başka eşikli pay reddedilir. Ağdan gelen her pay, kâğıt payla aynı denetimden geçer (x ≠ 0, eşik, tür). | Tek kötü tutucu, daha büyük sürümlü tutarlı bir sahte grupla sahte sırrı kabul ettirebiliyordu ya da birleştirmeyi çökertebiliyordu. |
| e | **Kanonik ZIP (RFC-0014 §4).** Kabın ZIP'i şu kurallara uyar; uymayan dosya `INVALID_ZIP` ile açılmaz, iki okuyucu da (çekirdek ve export-open, RFC-0014 §8.5) aynı kuralı uygular. Girdiler sıralı ve örtüşmesizdir: her girdinin yerel başlığı bir öncekinin verisinin bittiği yerde başlar. Yerel başlıktaki ad baytları, yöntem, bayraklar, CRC ve boyutlar merkezi dizindekiyle aynıdır. Merkezi dizin son verinin hemen ardından başlar; çok diskli alanlar sıfırdır. | Aynı veri bloğunu yüzlerce girdi gösterebiliyordu: 1 MiB'lık kap belleğe 512 MiB, 10 KB'lık kap diske 256 MiB yazdırabiliyordu. |
| f | **Dosya adları her işletim sisteminde güvenlidir.** Yazıcı ve okuyucu şunları reddeder: `:` ve 0x20 altı karakterler, sonu nokta ya da boşlukla biten parça, Windows'un ayrılmış adları (`CON`, `PRN`, `AUX`, `NUL`, `COM1–9`, `LPT1–9`, uzantılı halleri dahil). Ad çakışması `NFC` ve Unicode büyük/küçük harf katlamasıyla (`toUpperCase().toLowerCase()`) denetlenir. | Windows'ta alternatif veri akışı ve ayrılmış ad; macOS'ta ſ/s, ς/σ, ß/ss çakışması. |
| g | **Dışa aktarmada iç kimlik yazılmaz.** `kayitDisa`, `kayit:<hex32>` ve `kayit:<hex32>/<hex32>` biçimlerini (`_subj` dahil) ve metin içinde geçen `uye:`, `kayit:` kimliklerini görünen ada ya da `[kaynak]` başvurusuna çevirir; çevrilemeyen kimlik `[bilinmeyen]` olur. | `_subj` ve metin içindeki kimlikler dışarı çıkıyordu. |
| h | **Telefonda parola maliyeti sınırlıdır.** Telefon `opslimit ≤ 8` ve `memlimit ≤ 512 MiB` olan kabı açar; üstünü açmaz ve "Bu dosya telefonda açılamayacak kadar ağır; bilgisayarda export-open ile açın" der (`EXPORT_MEMORY`). Bilgisayardaki sınırlar RFC-0014 §4'teki gibi kalır (≤ 16, ≤ 1 GiB). Ürünün telefondaki içe aktarma yolu bu sınırı varsayılan olarak uygular. | Geçerli bir kap olmadan da dosya, parola doğrulanmadan önce telefona dakikalarca iş yaptırabiliyordu. |
| d | **Bilinen sınır:** döndürmede yalnız `calindi` durumunda bloklar yeniden anahtarlanır (RFC-0004 §6). Aileden çıkarılan bir kişi eski bir dizin kopyası ve eski paylarla eşik kadar pay toplayabilirse değişmemiş blokları açabilir. Tek başına eşik altında kaldığı için bu kabul edilir. Üye çıkarıldığında ebeveyn "yeniden anahtarla" seçeneğini görür. | Tercih belgede açık dursun. |

## 3. Kabul edilen uygulama ayrıntıları ve kararlar (dell 75–96)

| # | Ayrıntı ya da karar |
|---|---------------------|
| 75 | `ROTATE_DEVICE.oldSigned` gövdenin sonunda seçimlidir; yoksa bayt yazılmaz. Yuva Hat'ın v1 zincirinde kip imzalardan çıkar; düzey 2.1 ve üstünde bayraksız olay `MODE_MISMATCH`. |
| 76 | `APP_PRIMARY` alan sırası `{ personId, newPrimaryId, against, oldSigned, parentSigned }`. Devri düşen ek kimliğin ACTIVATE'i `SECONDARY_IDENTITY_CANNOT_VOTE`. |
| 77 | Sonradan eklenen imza olayın gücünü de değiştiremez (`DEVICE_DETACH` dahil). |
| 78 | `successorProof`: `array({ event: buffer, newPub: fixed32 })`, en çok 4; `successorOf` kalktı. Görünümün `peers` listesinde aktif kutular `role: 'kutu'` ile yer alır. `GUEST_REVOKED` SET_ROLE'da `neden: 'ebeveynlik-dustu'`. |
| 79 | Kapatma olayında ad, tür, `sensitivity`, `taskAccess`, `history`, `dropKey` öncekiyle aynı olmalıdır (`INVALID_CLOSE`). |
| 80 | Gelen her zarf `giris.gelenZarf`'tan geçer. **Karar:** yalnız doğrudan oturumda geçerli türler şunlardır: `0xB8–0xBB` (RFC-0013 model dağıtımı ve bildirim iletme), `0xE2–0xE4` (RFC-0008 uç akışı), `0xE8–0xE9` (RFC-0017, yalnız yerel kanal). Liste `giris.js`'de tek yerde tutulur; yeni bir RFC doğrudan tür eklerse bu listeye de ekler. Emanetten ya da Posta Kutusu'ndan gelirse atılır. |
| 81 | JOIN_HELLO'da `caps = 0` iken alan yazılmaz. **Karar:** `caps` tören `mac`'inin kapsamına girer (RFC-0003 §2.2'ye eklenir). Yuva Hat tören akışı bunu mağaza incelemesi bittikten sonraki sürümde uygular; o zamana kadar Yuva Hat'ın kodu değişmez. |
| 82 | `hf.kural.cihazlar: [hex16]`: kuralı görev parametresiyle çalıştıran cihazlar; cihazın açtığı kural vakası yalnız listedeki cihazdan geçerlidir (RFC-0006 §9.1 tablosuna eklenir). |
| 83 | Motor, `bastirildi` gibi karar alanlarını yalnız üye işlemlerinden birleşen görünümden okur. |
| 84 | Kuralın türü belirleyen işleminden önce **biten** pencereler değerlendirilmez; kural yazıldığında süren pencere değerlendirilir. |
| 85 | **Karar:** kural ya da rutin silinirken ona bağlı açık vakalar `kapat { sonuc: 'kaynak-silindi' }` ile kapatılır (SDK yardımcısı yapar). |
| 86 | **Karar:** Node 22 LTS yeterlidir; RFC-0006 §17'deki "Node 24" sabitlemesi "Node 22 ya da üstü" olur. |
| 87 | Görev emanet zarf kimliği `hash('hf/task-zarf/', taskId, u64be(sıra))[0..16]`; HOLD `{ forMemberId, fromMemberId, type, zarfId, sealed }`. |
| 88–91 | Yeni kodlar §4'tedir. SDK: `kaydet` jetonu `hash('hf/yz-onay/', collectionId, tür, recordId, adla sıralı alan kodlamaları)`; onay ekranı platformun `onayEkrani` işlevi; `run()` `{ id, yer, taskIds }` döner. Kap: `kayitDisa` `{ alanlar, yapay_zeka_alanlari }` döner; dosya yolu `dosyalar/<hex(blobId)>.<uzantı>`. Kasa: `PayTutucu.denetle` `{ onayGerekli, jeton }`, `ver(jeton)`, `birlestir(paylar, { secretId, kind, version })`. |
| 92 | Düğüm kodunda gelen her zarfın `giris.gelenZarf`'tan geçtiği bir testle sabitlenir (D12). |
| 93 | export-open'ın hedef klasörü var olmamalıdır (boş olsa da `TARGET_EXISTS`, çıkış kodu 2); export-open onu geçici klasörden yeniden adlandırarak kendisi oluşturur. |
| 94 | Çekirdekte `acAsync` ve `iceAlAsync` telefon sınırını varsayılan uygular; bilgisayar yolu `telefon: false` ister. Akışla okuma `kapOkuyucu(bas, parola)`. Telefonda arşivin açılmış toplamı en çok 512 MiB. |
| 95 | Kanonik ZIP'te yorum yoktur: EOCD dosyanın son 22 baytıdır; yorumlu ZIP `INVALID_ZIP`. |
| 96 | Ekipte yer türleri `sube`, `depo`, `ciftlik`, `ofis`, `diger`'dir (`ev` yok); ailede `sube` yoktur. **Karar:** RFC-0017'nin ekipte okunuşu: v2.2 olaylarında (APP_ATTACH, APP_PRIMARY) "ebeveyn" yerine RFC-0005'in yönetim yeter sayısı aranır. Çatallanmada ekipte imza sayımı, ayrışmadan önceki defterin yönetimiyle yapılır. |

## 4. Hata kodları

| RFC | Kodlar |
|-----|--------|
| 0004 | `APPROVAL_EXPIRED`, `VERSION_MISMATCH`, `DUPLICATE_HOLDER`, `INVALID_THRESHOLD`, `STATE_STORE_REQUIRED`, `INVALID_ROOT`, `NO_APPROVAL`, `VERSION_REQUIRED`, `RANDOM_SOURCE_CORRUPT`, `NO_READER_CHECK`, `REQUEST_STALE` |
| 0002 | `INVALID_ORDER`, `SEND_FAILED` |
| 0003 / 0017 | `INVALID_CLOSE`, `INVITE_EXPIRED`, `TYPE_NOT_ALLOWED` |
| 0014 | `ZIP_TOO_LARGE`, `EXPORT_MEMORY`, `INVALID_ZIP`, `INVALID_ZIP_NAME`, `TARGET_EXISTS` |
| 0015 | `AI_APPROVAL_REQUIRED`, `INVALID_APPROVAL_TOKEN`, `NO_APPROVAL_SCREEN`, `COLLECTION_REQUIRED`, `TYPE_MISMATCH`, `NO_RECORD`, `CAPS_REQUIRED`, `NO_PRESENCE`, `NO_IDENTITY`, `PROPOSAL_NOT_ALLOWED` |

## 5. Koda yansıyan düzeltmeler

§2'nin a, b, c, e, f, g ve h maddeleri ile §3'teki 80, 81 ve 85 kararları kodda değişiklik ister (81 Yuva Hat'ta mağaza incelemesinden sonra). Görevi `kollar/D-cekirdek.md` D9'dadır; bulgular `kollar/D-inceleme-5.md` ve `kollar/D-inceleme-6.md`'dedir.

## 6. Kurucu belgede değişecekler

| Bölüm | Değişiklik |
|-------|------------|
| §22 | HF53: "Kasa uyarısı beklemeden gider ve 72 saat uyarıdan sayılır; onay 10 dakika geçerlidir; birleştirme sürümü dizinden seçer; kap kanonik ZIP'tir ve telefonda parola maliyeti sınırlıdır (RFC-0021)." |
