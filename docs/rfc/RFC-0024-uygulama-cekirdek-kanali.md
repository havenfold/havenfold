# RFC-0024 — Uygulama ile telefondaki çekirdek arasındaki komut kanalı; kriz tespitinde kademeli cevap

> Durum: **Onaylandı** (Kerem, 23 Ekim 2026) · 23 Ekim 2026 · Yazan: Havenfold çekirdek ekibi · Onay: Kerem
> Kaynak: Yuva Defteri L13 (gerçek çekirdeğe bağlayıcı). Kurucu belge §6 (çekirdek telefonda Bare Worklet'te çalışır).
> Etkilenen RFC'ler: 0001 (§16 komut aralığı 240–249), 0013 (270–279), 0015 (350–351), 0017 (360–364), 0023 (104).

## 1. Sorun

Çekirdek telefonda Bare Worklet'te çalışır; uygulama (React Native) onunla numaralı komutlarla konuşur. RFC'ler komut aralıklarını ayırmış, ama kayıt katmanının (240–249) tek tek komut numaraları ve kanalın kendisi (çerçeve, hata, olay, geri çağrı) yazılmamış. Yuva Defteri gerçek çekirdeğe bağlanırken bunlara ihtiyaç var.

## 2. Kanal

- Taşıyıcı: Bare Kit IPC (uygulama ile worklet arası, aynı süreç grubu). Testte aynı Node sürecinde doğrudan bağlanır.
- Çerçeve: UTF-8 JSON, en çok 1 MiB. Baytlar (`Uint8Array`) `{ "$b": "<base64>" }` olarak yazılır; kimlikler zaten hex dizgidir.
- İstek: `{ id, komut, govde }` (uygulama → worklet). Cevap: `{ id, sonuc }` ya da `{ id, hata: "<KOD>" }`. Hata kodları RFC'lerdeki adlardır; çekirdek başka bir şey fırlatırsa `INTERNAL_ERROR`.
- Olay: `{ olay: "<ad>", veri }` (worklet → uygulama): `kayit-degisim` (`collectionId`, `recordIds`), `defter`, `vaka`, `yz` (kriz bayrağı içermez, RFC-0023 §2 f).
- Geri çağrı: `{ cagri: "<ad>", id, veri }` (worklet → uygulama), cevap `{ cagriId: id, sonuc }`. Tek geri çağrı bugün `onayEkrani`'dır (RFC-0023 104): çekirdek onay ekranını uygulamadan ister, uygulama kullanıcının gördüğü ve dokunduğu son değerleri döner; jeton çekirdekte üretilir ve uygulamaya hiç verilmez.
- Kanal yalnız aynı uygulamanın worklet'iyle kurulur; başka uygulamayla konuşma RFC-0017 yerel kanalıdır.

## 3. Kayıt komutları (240–249)

| No | Ad | Gövde → sonuç |
|----|----|---------------|
| 240 | `RECORD_COLLECTIONS` | `{}` → `CollectionInfo[]` |
| 241 | `RECORD_GET` | `{ collectionId, recordId }` → `Kayit \| null` |
| 242 | `RECORD_QUERY` | `{ collectionId, type?, where?, limit? }` → `Kayit[]` |
| 243 | `RECORD_PUT` | `{ collectionId, recordId \| null, type, fields }` → `recordId` |
| 244 | `RECORD_DEL` | `{ collectionId, recordId }` → `null` |
| 245 | `RECORD_ATTACH` | `{ bytes, mime, name }` → `BlobRef` |
| 246 | `RECORD_OPEN` | `{ blobRef }` → `{ path }` |
| 247 | `RECORD_HISTORY` | `{ collectionId, recordId }` → `GecmisSatiri[]` |
| 248 | `RECORD_COPIES` | `{ blobId }` → `{ telefon, kutu, isci }` |
| 249 | ayrılmış | |

Görev (250–259), olay (260–269), yapay zeka (270–279), SDK ortak (350–351) ve eşleşme (360–364) numaraları kendi RFC'lerindeki gibidir; bu kanal onları aynen taşır. Bu komutların gövdesi, SDK yönteminin adlandırılmış bağımsız değişkenleridir (`{ ad: değer }`); sonuç SDK'nın döndürdüğü değerdir.

## 3a. Defter komutları (Yuva Hat çizelgesindeki numaralar)

Yuva Hat çekirdeği ileride `@havenfold/core`'a geçeceği için (kurucu belge §18.4) aynı işlerin numaraları korunur:

| No | Ad | Gövde → sonuç |
|----|----|---------------|
| 2 | `CREATE_FAMILY` | `{ aileAdi, ad }` → aile bilgisi |
| 13 | `MEMBER_REMOVE` | `{ personId, wipe }` → `{ durum, oneriId?, waitingFor? }` |
| 200 | `FAMILY_INFO` | `{}` → `{ ad, duzey, tur, ben, cihazlar, misafirler }` |
| 201 | `MEMBERS` | `{}` → kişiler (kişi başına bir satır; ek kimlikler `identities` ile) |

## 4. Hata kodları

`INTERNAL_ERROR`, `NO_COMMAND`, `INVALID_FRAME`, `HENUZ_BAGLANMADI` (bağlayıcıda karşılığı yazılmamış komut; sessizce taklide düşülmez).

## 5. Kriz tespitinde kademeli cevap (RFC-0023 §2 eki; Kerem kararı Mac'e bıraktı, 23 Ekim 2026)

**Sorun.** Anlam katmanında tek eşikle hem yakalama hem yanlış alarm hedefi tutmuyor. Mac'teki 100 + 100'lük sette duyarlı eşik %94 yakalama ve %11 yanlış alarm, sıkı eşik %83 yakalama ve %4 yanlış alarm veriyor. Tam kriz ekranını yersiz göstermek çocuğu korkutur ve uyarıyı değersizleştirir. Krizi kaçırmak ise daha ağırdır.

| # | Karar |
|---|-------|
| a | Kriz tespiti üç sonuç verir: `tam`, `sinir`, yok. **Tam:** kelime listesi eşleşir ya da anlam benzerliği yüksek eşiği geçer. **Sınır:** anlam benzerliği düşük eşikle yüksek eşik arasında kalır. |
| b | **Tam** sonuçta bugünkü kriz akışı değişmez (RFC-0013 §12): model çağrılmaz, sabit şablon, geçmişe ve paylaşılan koleksiyona yazılmaz. |
| c | **Sınır** sonuçta soru normal yoldan cevaplanır. Cevabın altına küçük, sakin bir satır eklenir: "Zor bir şey mi yaşıyorsun?" ve "Yardım" düğmesi. Düğme tam kriz ekranını açar. Bu bilgi geçmişe (`hf.ai.konusma`) yazılmaz, olayla ve günlükle yayılmaz, kimseye haber gitmez. |
| d | **Eşikler** model başına `esikler[<modelHash>]`'te iki değerdir: `yuksek` ve `dusuk`. Ayarlama yalnız çalışma setinde ve çekirdeğin ek setinde yapılır. Yüksek eşik, yanlış alarmı en çok %2 olacak biçimde seçilir. Düşük eşik, sınır satırının yanlış gösterimini en çok %15'te tutarak yakalamayı en yükseğe çıkarır. Kesin değerleri Mac, kendi setiyle ölçüp yazar. |
| e | **Ölçüt** (Mac'teki sette): tam ve sınırın birleşimi ≥ %95 yakalama; tam sonucun yanlış alarmı ≤ %5; sınır satırının zararsız cümlede görünmesi ≤ %15. |
| f | Her zaman görünen Yardım düğmesi (RFC-0023 §2 f) yerinde kalır. |
