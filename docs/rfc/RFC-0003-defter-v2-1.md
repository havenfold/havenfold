# RFC-0003 — Defter v2.1: cihazlar, misafirler, koleksiyonlar ve geçiş

> Durum: **Onaylandı** (Kerem, 23 Ekim 2026) · Kurucu belge 1.1 ile yürürlükte · Yazan: Havenfold çekirdek ekibi · Onay: Kerem
> Kurucu belge: §6, §7.7, §9.5, §11, §22 (HF5, HF6). Bu RFC, RFC-0001, RFC-0002 ve RFC-0004'ün temelidir.
> Kod yeri: önce `havenfold/core` altında ayrı paket (`@havenfold/defter-v21`). Yuva Hat'a taşıma aşaması B ile girer (kurucu belge §18.4).

## 1. Sorun

Kurucu belge deftere yeni varlıklar ekliyor: bağlı cihazlar, misafirler, yerler, varlıklar, koleksiyonlar, izinler. Mağazadaki Yuva Hat (protokol v2) bu olayları tanımıyor ve bilinmeyen olay türünü reddediyor:

- `encoding.js` ve `quorum.js` `UNKNOWN_EVENT` hatası veriyor.
- `connection-manager.js` `ledger_rejected` deyip oturumu kapatıyor.

Geçişin aileleri bölmeden yapılması gerekiyor.

## 2. Geçiş

### 2.1 Kurucu belgeden ayrılan karar

Kurucu belge §6.3, bilinmeyen olayı "zincire ekle, durumu değiştirme" diye tolere eden bir uyum kuralı öneriyordu. Bu RFC o kuralı **kaldırıyor**:

- Tolere eden eski istemci, yeni istemcinin geçersiz saydığı bir olayı zincire ekleyebilir. Böylece iki istemci sessizce ayrı zincirlerde kalır.
- Sonradan güncellenen eski istemci kendi zincirini yeniden kuramaz.

Sessiz ayrışma, gürültülü redden daha tehlikelidir.

### 2.2 Sürüm kapısı

1. **HELLO yetenek bitleri:**
   - Protokol 2.1'i bilen istemci `HELLO.caps` içinde `LEDGER_V21 = 32` bitini gönderir.
   - Kayıt katmanını bilen ayrıca `KAYIT = 64`, görev katmanını bilen `GOREV = 128` bitini ekler.
   - Bugün kullanılan bitler: `AUDIO 1`, `VIDEO 2`, `PTT_LIVE 4`, `RELAY 8`, `BOX 16`.
2. **`JOIN_HELLO`'ya `caps` alanı** eklenir (tören, `ceremony/protocol.js`). Eski istemcinin gönderdiği `JOIN_HELLO`'da bu alan yoktur; yokluğu `caps = 0` sayılır. `caps` doluysa tören MAC'inin son parçasıdır: `mac = derive(sec, 'hf/toren/mac', el sıkışma özeti, taraf, u64be(caps))`; `caps = 0` iken MAC eski biçimde kalır. Yolda bit düşürmek ya da eklemek töreni `INVALID_CEREMONY` ile kapatır (RFC-0021 §2 madde 81; vektör `protocol/vectors/ceremony.json`).
3. Telefon her üyenin son gördüğü `caps` değerini ve tarihini saklar.
4. **`PROTOCOL_LEVEL`** (olay 22) yalnız olayı yazan telefonda şu koşullar sağlanınca yazılır:
   - Defterdeki bütün aktif ve bekleyen olmayan üyeler (telefonlar ve kutu) son 30 gün içinde `LEDGER_V21` bitiyle görülmüş olmalı.
   - Defterde bekleyen üye bulunmamalı. Bekleyenler HELLO yapamadığı için durumları bilinemez.
   - Bu koşullar defter doğrulamasının parçası **değildir**. Defter belirlenimci kalmalıdır: olayı alan telefonlar yalnız imzayı ve imzacının rolünü denetler.
5. **13–21 ve 23 numaralı olaylar** ancak defterde `PROTOCOL_LEVEL { level: '2.1' }` varsa yazılabilir. Yoksa `LEVEL_TOO_LOW` hatasıyla reddedilir. Tek istisna `KIND`'dır (§5.8).
6. **Düzey yazıldıktan sonra katılım:** `JOIN_HELLO`'da `LEDGER_V21` biti olmayan cihaz `UPDATE_REQUIRED` ile reddedilir.
7. **Kalmış eski istemci:** Düzey yazıldıktan sonra güncellenmemiş bir cihaz kalırsa (ör. bir yıl kapalı kalmış telefon), ilk v2.1 olayında `UNKNOWN_EVENT` hatası verir ve oturumu kapatır. Bu cihazla mesajlaşma durur. Güncel telefonlar durumu `caps` bilgisinden anlar ve "<Ad>'ın Yuva Hat'ı eski, güncellenmeden mesajlaşamaz" der. Eski cihaz güncellenince defteri baştan eşitler. Durum gürültülü ve güvenlidir.
8. Olayların `v` alanı **2** kalır (`ledger.js` `V = 2`).
9. **Arayüz:** Düzey yazılmadan önce "Cihaz ekle", "Misafir ekle" ve Defter özellikleri görünmez. Yerlerinde "Ailedeki herkes Yuva Hat'ı güncellemeli: <adlar>" yazar.

**Yuva Hat'ın sonraki mağaza sürümü bu RFC'nin tamamını içerir.** Kurucu belge §6.3 madde 1 ve HF6 bu RFC ile değişir (§13).

## 3. Kimlikler

- Bütün imzacı kimlikleri aynı işlevle türetilir: `id = hash('member-id', ukaPub)[0..16]` (`memberIdOf`). Üye, cihaz ve misafir aynı kimlik uzayındadır.
- **Tek kimlik kuralı:** Bir kimlik defterde ya üye, ya cihaz, ya da misafir olabilir. Herhangi birinde daha önce görülmüş bir kimlik yeniden eklenemez (`IDENTITY_ALREADY_EXISTS`). Bu kural bugünkü `MEMBER_EXISTS` kuralının genişlemesidir.
- `deviceId` cihazın kimliğidir. `grantId` misafir cihazının kimliğidir. Misafir uygulaması her davet için yeni kimlik üretir.
- **Birleşik cihaz** (kurucu belge §6.1): Kutu kimliği ile işçi kimliği ayrı anahtar çiftleridir; kimlikleri farklıdır.

## 4. Durum

`Ledger` sınıfına şunlar eklenir:

```
devices     : Map<hex, { id, class, name, placeId, signPub, udaPub, cert, active, addedSeq, anchor, removedSeq?, wipe? }>
grants      : Map<hex, { id, name, signPub, udaPub, cert, collections, taskTypes, expiresAt, active, addedSeq, anchor, grantedBy }>
places      : Map<hex, { id, name, kind, active }>
beings      : Map<hex, { id, kind, name, placeId, active }>
collections : Map<hex, { id, name, kind, owner, readers, writers, sensitivity, taskAccess, history, dropKey, seq, hash }>
permits     : Map<"subject|type", { allow, seq }>
level       : '2.0' | '2.1'
kind        : 'aile' | 'ekip'
```

**Sayım kuralı:** Bütün sayı sınırları (cihaz, misafir, yer, varlık, koleksiyon) yalnız `active = true` olan öğeleri sayar. Süre ya da saat sayıma girmez. Kaldırılmış (`remove = true`) yer ve varlıklar sayılmaz.

## 5. Yeni olaylar

Gövdeler `compact-encoding` ile, `encoding.js`'teki `struct` düzeniyle kodlanır. `fixed16` 16 bayt, `fixed32` 32 bayttır; `deviceCert` mevcut kodlayıcıdır.

### 5.1 Olay 13 — `DEVICE_ATTACH`

```
[ ['deviceCert', deviceCert], ['class', c.string], ['name', c.string], ['placeId', fixed16],
  ['caps', c.buffer], ['ceremonyTranscriptHash', c.fixed32] ]
```

- `class ∈ {'isci', 'uc', 'aksesuar'}`.
- `placeId` yoksa 16 sıfır bayttır.
- `caps`, ilk `NODE_CAPS`'in kodlanmış halidir. Yalnız bilgi verir, yetki vermez.

| Kural | Hata |
|-------|------|
| İmzacılar: yeni cihaz + en az bir aktif ebeveyn | `NO_NEW_DEVICE_APPROVAL`, `NO_PARENT_SIGNATURE` |
| `ceremonyTranscriptHash` sıfır olamaz | `INVALID_TRANSCRIPT` |
| Aktif cihaz sayısı < 16 | `DEVICE_LIMIT` |
| `placeId` sıfır değilse aktif bir yer olmalı | `NO_PLACE` |
| Kimlik daha önce görülmemiş olmalı | `IDENTITY_ALREADY_EXISTS` |
| `level = '2.1'` | `LEVEL_TOO_LOW` |

### 5.2 Olay 14 — `DEVICE_DETACH`

```
[ ['deviceId', fixed16], ['reason', c.string], ['wipe', c.bool], ['wipeReportHash', c.fixed32] ]
```

| Kural | Hata |
|-------|------|
| İmzacı: herhangi bir aktif ebeveyn **ya da** cihazın kendisi. Cihaz yalnız kendi çıkışını imzalar. | `DEVICE_CANNOT_VOTE`, `NO_PARENT_SIGNATURE` |
| Hedef aktif bir cihaz olmalı | `NO_TARGET` |
| `wipeReportHash` sıfır değilse `wipe = true` olmalı | `INVALID_BODY` |

**Etki:**

- Cihaz pasif olur, `removedSeq` yazılır.
- Cihazla çift sırrı üretilmez.
- Cihazın yazar olduğu koleksiyonlarda yetkisi biter: kesim yayımlanır (RFC-0001 §8).
- Cihazın kasa payı varsa sır döndürülür (RFC-0004 §6).

### 5.3 Olay 15 — `PLACE`

```
[ ['placeId', fixed16], ['name', c.string], ['kind', c.string], ['remove', c.bool] ]
```

- İmzacı: herhangi bir ebeveyn.
- En çok 8 aktif yer.
- `kind ∈ {'ev', 'yazlik', 'diger'}`. Mekan türleri RFC-0005'te gelir.
- Kaldırılan yere bağlı cihazların `placeId` değeri okumada sıfır sayılır.

### 5.4 Olay 16 — `BEING`

```
[ ['beingId', fixed16], ['kind', c.string], ['name', c.string], ['placeId', fixed16], ['remove', c.bool] ]
```

- İmzacı: herhangi bir ebeveyn.
- En çok 32 aktif varlık.
- `kind` serbest metindir (`kedi`, `kopek`, `bitki`…).

### 5.5 Olay 17 — `GRANT`

```
[ ['to', deviceCert], ['name', c.string], ['collections', c.array(fixed16)], ['taskTypes', c.array(c.string)],
  ['expiresAt', c.uint], ['ceremonyTranscriptHash', c.fixed32] ]
```

| Kural | Hata |
|-------|------|
| İmzacılar: misafir cihazı + en az bir aktif ebeveyn | `NO_NEW_DEVICE_APPROVAL`, `NO_PARENT_SIGNATURE` |
| Aktif misafir sayısı < 4 | `GUEST_LIMIT` |
| Her koleksiyon var olmalı, `kind = 'bakici'` ve `sensitivity = 'normal'` olmalı | `NOT_COLLECTION_ELIGIBLE` |
| `taskTypes` v2.1'de boş olmalı: misafir görev veremez | `INVALID_BODY` |
| Kimlik daha önce görülmemiş olmalı | `IDENTITY_ALREADY_EXISTS` |
| `level = '2.1'` | `LEVEL_TOO_LOW` |

- `grantId` = `to`'nun kimliği.
- Misafir, listelenen koleksiyonların okuyucusu olur. Bu, koleksiyonun `readers` listesinde `grant:<id>` yazmasıyla aynı etkidir.
- **Süre:** Defter saate bakmaz (K15). `expiresAt` dolunca:
  - Telefonlar o misafire anahtar ve veri göndermeyi keser.
  - Ebeveyn telefonları "Bakıcının süresi doldu, kaldırılsın mı?" önerisi gösterir. Ebeveyn GRANT verirken "süre dolunca kendiliğinden kaldır" seçtiyse, kendi telefonu `REVOKE`'u sormadan imzalar.
  - İki ebeveyn aynı anda `REVOKE` yazarsa ikinci olay `NO_TARGET` ile geçersiz olur ve düşer. Çatallanma olursa K10 kuralı çözer.
  - Misafir uygulaması da süre dolunca kendi verisini siler.
- **90 gün sınırı:** Olayı yazan telefon `expiresAt`'i en çok 90 gün sonrasına izin verir. Bu, defter kuralı değil yazan tarafın kuralıdır, çünkü `ts` yazana bağlıdır.

### 5.6 Olay 18 — `REVOKE`

```
[ ['grantId', fixed16], ['reason', c.string] ]
```

- İmzacı: herhangi bir aktif ebeveyn.
- Hedef aktif bir misafir olmalı (`NO_TARGET`).
- Etki: Misafir pasif olur. Okuduğu koleksiyonlarda yeni dönem başlar (RFC-0001 §9.1). Misafire `GUEST_REVOKED` (0x9D) bildirimi gider.
- **Bekleyen uzaktan üyenin daveti (D106, İstek 181 K1; Kerem kararı 25 Ekim 2026):** `grantId` uzaktan eklenmiş ve henüz etkinleşmemiş bir üye (`ADD_MEMBER { remote: true }`, `ACTIVATE_MEMBER` gelmemiş) olabilir. İmzacı herhangi bir aktif ebeveyn; tek imza yeter (bekleme süresi içinde ya da sonra, etkinleşmeden önce). Etkinleşmiş üye ya da bekleyen cihaz değişimi hedef olamaz (`NO_TARGET`). Etki: üye pasif olur, kişisi kalkar, yerel ailesi silinir (`wipe`); yeni gelen "Davet iptal edildi" görür. Yeni kural olduğu için yazan telefon, ailenin bütün aktif telefonları, kutusu ve cihazları son 30 günde HELLO'da `UZAKTAN_IPTAL` (65536) bitini bildirmeden yazmaz (`UPDATE_PENDING`); eski sürüm bu olayı reddeder ve eşitlemesi takılırdı. Bu kapı cihaz değişimiyle bekleyen telefonları da sayar: onlar da defteri doğrular (Codex 10. tur). Öbür uzaktan bekleyenler sorulmaz: oturumları olmadığı için bitleri görülmez; uzaktan katılım bu biti törende ister (RFC-0028 §5 d2 K1), sorulsalardı aynı anda bekleyen iki uzaktan davet birbirinin iptalini kilitlerdi.
- **İptalin yeni gelene ulaşması (Codex 10. tur, 28 Ekim 2026):** Bekleyen üyeyle oturum yoktur (K11); iptal ona eşitlemeyle ulaşamaz. Sınırlı iptal oturumu (§6.1, rol `davetli`) bunu taşır: bekleyen telefon beklerken yalnız yetkilileri (ebeveyn; ekipte sahip ve yönetici) arar. Aile tarafı onu yalnız `REVOKE`'tan sonraki 30 gün içinde tanır ve tek bir zarf yollar: `GUEST_REVOKED { grantId: üye, event: REVOKE, signerId, sig }` (misafir iptaliyle aynı zarf ve etiket, `hf/guest-revoked/`). Yeni gelen zarfı törende aldığı defterle doğrular: imzalayan o defterde yetkili, imza bu aile ve bu kimlik için, olay bu kimliğin davetini iptal eden `REVOKE`. Sonra `davet-iptal` olayı ve yerel aile silinir. Çevrimdışı kalan yeni gelen 30 gün içinde bağlanmazsa iptali öğrenmez (`docs/audit/sinirlar-ve-kapsam-disi.md` madde 30).

### 5.7 Olay 19 — `SHARE_CONSENT`

```
[ ['shareId', fixed16], ['service', c.string], ['scope', c.string], ['ownerId', fixed16],
  ['expiresAt', c.uint], ['payloadHash', c.fixed32] ]
```

- **İmzacı:**
  - `ownerId` bir üyeyse o üye imzalar. Rolü `cocuk` ise bir ebeveyn imzalar.
  - `ownerId` = 16 sıfır (ortak koleksiyon verisi) ise herhangi bir ebeveyn imzalar.
- Yalnız onay kaydıdır. Paket biçimi hizmet geçidinin RFC'sindedir.

### 5.8 Olay 20 — `KIND`

```
[ ['kind', c.string] ]
```

- Yalnız `seq = 1`'de, tek imzacı kurucu olabilir. Düzey kapısından muaftır, çünkü düzey olayı ondan önce yazılamaz.
- Olay yoksa topluluk `aile` sayılır.
- `kind = 'ekip'` RFC-0005 ile geçerlidir. RFC-0005'in olayları 24–26'dır (`ASSIGN`, `TERM`, `NOTICE`); yalnız ekipte geçerlidir.

### 5.9 Olay 21 — `COLLECTION`

```
[ ['collectionId', fixed16], ['name', c.string], ['kind', c.string],
  ['readers', c.array(c.string)], ['writers', c.array(c.string)],
  ['sensitivity', c.string], ['taskAccess', c.bool], ['history', c.bool], ['dropKey', c.fixed32] ]
```

| Alan | Değerler |
|------|----------|
| `kind` | `'genel'`, `'kisisel'`, `'bakici'`, `'olaylar'` |
| `sensitivity` | `'normal'`, `'kasa'` |
| `readers` öğesi | `rol:ebeveyn`, `rol:yetiskin`, `rol:cocuk`, `uye:<hex16>`, `grant:<hex16>` |
| `writers` öğesi | `readers` değerleri + `device:<hex16>` |
| `dropKey` | Yoksa 32 sıfır |

- İlk `COLLECTION` olayı koleksiyonu oluşturur. Aynı `collectionId` ile sonrakiler koleksiyonu **değiştirir**.
- `kind` değiştirilemez (`TYPE_IMMUTABLE`). Koleksiyon silinmez; kapatmak için `readers: []` yazılır.
- **`owner`:** `kisisel` koleksiyonun sahibi, oluşturan olaydaki tek `uye:` okuyucudur. Durumda saklanır, hiç değişmez.

**İmza kuralları (yukarıdan aşağı, ilk uyan geçerli):**

| Durum | Gereken imza | Hata |
|-------|--------------|------|
| `kind = 'kisisel'` | Yalnız `owner`. Oluşturmayı da değişiklikleri de yalnız sahibi imzalar. Ebeveyn dahil kimse kendini ekleyemez. | `PERSONAL_COLLECTION` |
| Önceki halinde `readers` tam olarak tek bir `uye:` öğesinden oluşuyor | O üye + aşağıdaki kurallar | `NO_READER_APPROVAL` |
| Yeni ya da önceki `sensitivity = 'kasa'` | Bütün aktif ebeveynler | `NO_PARENT_APPROVAL` |
| Diğer | Herhangi bir aktif ebeveyn | `NO_PARENT_SIGNATURE` |

**Ek kurallar:**

| Kural | Hata |
|-------|------|
| `kasa` ise `taskAccess = false`, `writers` içinde `device:` yok, `readers` içinde `grant:` yok | `VAULT_RULE` |
| `kisisel` ise `owner` her zaman `readers` içinde | `PERSONAL_COLLECTION` |
| `device:` yalnız `kind = 'olaylar'` koleksiyonda | `DEVICE_WRITER_FORBIDDEN` |
| `grant:` yalnız `kind = 'bakici'` koleksiyonda | `GUEST_FORBIDDEN` |
| `dropKey` yalnız `kind = 'olaylar'` koleksiyonda; düzey 2.3'ten sonra `sensitivity = 'normal'` olan ve `kind`'ı `kasa` ya da `kisisel` olmayan her koleksiyonda (RFC-0030 §5) | `INVALID_BODY` |
| `writers` içindeki her `rol:` ve `uye:` öğesi `readers` içinde de olmalı (yazar okuyamazsa anahtar alamaz). `device:` bu kuralın dışındadır. | `NOT_WRITER_READER` |
| `grant:` hiçbir koleksiyonun `writers` listesinde olamaz: misafir yalnız okur; izinli koleksiyona yalnız bırakır (RFC-0030) | `GUEST_CANNOT_WRITE` |
| `uye:<id>` aktif bir telefon üyesi olmalı; kutu olamaz | `INVALID_MEMBER` |
| En çok 64 koleksiyon | `COLLECTION_LIMIT` |
| `level = '2.1'` | `LEVEL_TOO_LOW` |

### 5.10 Olay 22 — `PROTOCOL_LEVEL`

```
[ ['level', c.string] ]
```

- İmzacı: herhangi bir aktif ebeveyn.
- `level = '2.1'` olmalı; düzey ancak yükselir (`LEVEL_CANNOT_DOWNGRADE`).
- Yazma koşulları §2.2 madde 4'tedir; defter doğrulaması bunları denetlemez.

### 5.11 Olay 23 — `TASK_PERMIT`

```
[ ['subject', c.string], ['taskTypes', c.array(c.string)], ['allow', c.bool] ]
```

- `subject`: `rol:<rol>` ya da `uye:<hex16>`.
- İmzacı: herhangi bir aktif ebeveyn.
- **Varsayılan** (ilgili kayıt yokken):
  - `ebeveyn` ve `yetiskin` her türü verebilir.
  - `cocuk` hiçbir türü veremez.
  - Misafir görev veremez (v2.1).
  - `kutu` yalnız `hf.task.backup` verebilir.
- **Karar:** Bir (subject, tür) için en büyük `seq`'li kayıt geçerlidir. `uye:` kaydı `rol:` kaydından önce gelir.
- Sürekli görevi yalnız `ebeveyn` verebilir; `TASK_PERMIT` bunu değiştiremez.

### 5.12 Misafirlerin bağlı olduğu ebeveyn

- `GRANT`'ı imzalayan ebeveyn (`grantedBy`) defterdeki `rotatedTo` zinciriyle çözülür.
- Zincirin aktif ucu kalmazsa (ebeveyn atıldı ya da ayrıldı), o ebeveynin verdiği bütün misafirlikler aynı olayla **kendiliğinden pasif olur**. Etkisi `REVOKE` ile aynıdır. Kural belirlenimcidir: yalnız defter olaylarına bakar.

### 5.13 Cihaz değişiminde kimliklerin izlenmesi

Şu alanlar her denetimde defterdeki `rotatedTo` zincirinin **aktif ucuna** çözülür:

- `COLLECTION.readers` ve `writers` içindeki `uye:<id>`;
- `kisisel` koleksiyonun `owner` alanı;
- `TASK_PERMIT.subject` içindeki `uye:<id>`;
- misafirin `grantedBy` alanı.

Böylece telefonunu değiştiren üye kendi kişisel koleksiyonunu yönetmeye devam eder.

### 5.14 Öneri ve imza toplama

- `proposals.js`'teki `PROPOSABLE` kümesine eklenir: `DEVICE_ATTACH`, `DEVICE_DETACH`, `PLACE`, `BEING`, `GRANT`, `REVOKE`, `SHARE_CONSENT`, `COLLECTION`, `PROTOCOL_LEVEL`, `TASK_PERMIT`.
- Cihaz ve misafir imzaları olayın ilk halinde bulunur (yeni kimlik, kendi çıkışı); `mergeSigs` ile sonradan eklenmez.
- `mergeSigs` cihaz ve misafir kimliklerini bugünkü gibi atlar.
- **Çatallanma:** Çatallanma kararında `signerCount` yalnız üye imzalarını sayar. Cihaz ve misafir imzaları sayılmaz.

## 6. Cihaz ve misafir bağlantısı

### 6.1 HELLO ve oturum rolü

`verifyHello` bugün yalnız aktif üyeyi kabul ediyor. v2.1'de `hello.memberId`:

- aktif bir üyeyse rol `uye`,
- aktif bir cihazsa rol `cihaz`,
- aktif bir misafirse rol `misafir`

olarak oturuma yazılır. Sertifika denetimi üyelerdeki gibidir.

| Oturum | İzin |
|--------|------|
| Üye ↔ üye | Bugünkü gibi |
| Üye ↔ cihaz | Defter eşitleme; kayıt (kutunun kör emaneti ve yalnız yazan cihazın `REC_DROP` göndermesi); görev; dosya |
| Cihaz ↔ cihaz | Yalnız görev ve dosya. Görev yalnız geçerli delegasyonla işlenir (RFC-0002 §9). |
| Üye ↔ misafir | Yalnız `GUEST_VIEW`, `GUEST_REVOKED`, kayıt (misafirin koleksiyonları, yalnız okuma; düzey 2.3'te misafirden yalnız bütün öğeleri `REC_DROP` olan `REC_OPS`, RFC-0030), dosya |
| Misafir ↔ cihaz ya da misafir | Kurulmaz |
| Yetkili ↔ davetli (Codex 10. tur) | Yalnız yetkiliden `GUEST_REVOKED` (§5.6). Davetli: bekleme süresi dolmamış uzaktan eklenen (kendi tarafında) ya da `REVOKE`'la düşmüş uzaktan davetli, iptalden sonraki 30 gün (aile tarafında, `Ledger.davetliMi`). Aile tarafında davetli oturum rolü değildir; ondan gelen her zarf süzgeçte düşer. Yalnız taşıyıcı bu rolü tanır (`verifyHello(…, { davetli: true })`); afet yolu tanımaz. İptal edilmemiş bekleyenle oturum yine yoktur (K11). |

**Sonraki RFC'lerin mesajları:** Oturum tablosuna eklenenler: `UPDATE_*` (RFC-0007), `NODE_PROFILE`, `UC_*`, `APP_WIPE_REPORT` (RFC-0008), `APP_LINK` (RFC-0011), `VAKA_*` (RFC-0006), `EKIP_CIKIS*` (RFC-0005), `HIZMET_*` (RFC-0010). Her mesajın hangi oturumda geçerli olduğu kendi RFC'sinde yazılıdır.

**Misafir kuralı (kritik):**

- Oturum rolü `misafir` ise `LEDGER_REQ`, `LEDGER_EVENTS` ve `LEDGER_PROPOSE` gönderilmez ve cevaplanmaz. Bugün `connection-manager.js` bunları her oturuma gönderiyor; bu davranış rol denetimiyle değişir.
- Misafir töreninde (`kind = 3`) `JOIN_LEDGER` yerine `GUEST_VIEW` gönderilir. Misafir onu yalnız 5 resmi onaylayıp bu törenin `GRANT` taslağını (transkripti bu tören) imzaladıktan sonra ve görünümün `GRANT`'ı o taslaksa kabul eder (RFC-0034 Ek i).

### 6.2 Çift sırrı

- `pairSecret` aynen kullanılır.
- **`anchorHash`:**
  - Üye ↔ üye: bugünkü gibi (`anchorFor`).
  - Üye ↔ cihaz ya da misafir: her zaman cihazın `DEVICE_ATTACH` (misafirde `GRANT`) olayının özeti; üye sonradan eklenmiş olsa bile.
  - Cihaz ↔ cihaz: `addedSeq` değeri büyük olanın olayının özeti.
- **`ceremonyKey`:** Cihazı ya da misafiri ekleyen ebeveyn için törenden gelen ek sırdır; diğerleri için 32 sıfır.
- **Alt anahtarlar:** Mevcut `pairSubkeys` aynen kullanılır, ek olarak `taskKey = derive(pair, 'hf/task/')`.
- Cihaz ve misafir PREKEY yayınlamaz, ratchet kurmaz.
- *Uygulama notu (açılış öncesi inceleme, 25 Ekim 2026):* Bekleyen üyeyle (uzaktan eklenmiş, `ACTIVATE_MEMBER` gelmemiş; ya da K16 düzeninde bekleyen cihaz değişimi) çift sırrı yoktur. Bekleyen **biz** isek bekleme süremiz (`readyAt`) dolduktan sonra üye gibi çift sırrı kurarız: etkinleştirme olayı bize ancak bir oturumla gelebilir. Karşı taraf bizi etkinleştirmedikçe kendi defterinde bekleyen gördüğü için oturumu kabul etmez (`core/core/core/pairs.js`). Süresi dolan misafirlikte (GRANT `expiresAt`; defter saate bakmaz, K15) çift sırrı yoktur: ebeveyn ve misafir tarafında yeni oturum, afet mesajı ve yeni `GUEST_VIEW` olmaz; misafir telefonu bırakmayı durdurur ve yerel kuyruğunu siler (Codex 9. tur).

### 6.3 Emanet

Emanet bugünkü biçimle yapılır: `HOLD { forMemberId, fromMemberId, sealed }` (`messenger.js`). `forMemberId` ve `fromMemberId` cihaz ve misafir kimliklerini de kabul eder.

### 6.4 Emanet ve Posta Kutusu yolunda mühür

Topluluk içi **bütün** zarf türleri (0x80–0xFE), emanet ya da Posta Kutusu yolundan geçerken K12 mührüyle kapatılır:

```
sealed = nonce(24) ‖ XChaCha20-Poly1305(anahtar, gövde, AD = gönderen(16) ‖ alıcı(16) ‖ tür(1) ‖ zarf id(16))
anahtar = derive(pair, 'hf/task/')   görev türleri 0x90–0x97 için
anahtar = derive(pair, 'ctrl')   diğerleri için
```

- `messenger.js`'teki `CTRL_TYPES` kümesi hepsini kapsar.
- Yalnız doğrudan oturumda geçerli olan bir tür emanetten gelirse atılır.
- Doğrudan Noise oturumunda ek mühür gerekmez.
- Mühür olmadan kutuya giden `REC_KEY`, `KASA_SHARE_RES` ya da `TASK_RESULT` içeriği kutu görebilirdi; bu kural bunu engeller.

## 7. Cihazın ve misafirin gördüğü defter

| Kim | Ne alır | Neden |
|-----|---------|-------|
| Bağlı cihaz | **Tam defter**, kutuyla aynı | `eventHash` gövdeyi kapsar; bir olayın gövdesi çıkarılırsa zincir bozulur. Cihaz görevi gönderenin yetkisini kendisi doğrular (RFC-0002 §6.2). |
| Misafir | **`GUEST_VIEW`** | Misafir aileden değildir. Aile listesini, planları ve bağları görmez. |

```
GUEST_VIEW (0x9A) {
  familyId    : fixed32
  ledgerLen   : uint
  ledgerHead  : fixed32
  grant       : buffer                    // GRANT olayının kodlanmış hali (imzalarıyla)
  peers       : array<{ id: fixed16, signPub: fixed32, udaPub: fixed32, role: string, anchor: fixed32, writerOf: array<fixed16> }>
  collections : array<buffer>             // ilgili COLLECTION olaylarının kodlanmış hali (imzalarıyla)
  epochs      : array<{ collectionId: fixed16, epochSeq: uint, epochHash: fixed32 }>
  signerId    : fixed16
  sig         : fixed64                   // Ed25519(signer, hash('hf/guest-view/', familyId, gönderilen baytlar sig hariç))
}
GUEST_REVOKED (0x9D) { grantId: fixed16, revokeEvent: buffer, sig }
// Düzey 2.3 (RFC-0030 §6): GUEST_VIEW'in sonuna
//   drops : array<{ collectionId: fixed16, dropKey: fixed32, types: array<string>, subjects: array<string> }>
```

- `peers` yalnız misafirin koleksiyonlarının okuyucularını ve yazarlarını içerir.
- **Misafirin kabul kuralı:**
  - Görünümü **yalnız `GRANT`'ı imzalayan ebeveyn** imzalar. O ebeveyn telefon değiştirirse yeni imzacı, bir önceki görünümün `peers` listesinde onun yeni kimliği olarak bildirilir.
  - `ledgerLen` yalnız artabilir.
  - O ebeveyn aileden çıkarsa misafirlik kendiliğinden düşer (§5.12); misafir artık görünüm almaz ve `GUEST_REVOKED` bekler.
- Misafir, koleksiyon işlemlerinin yazarlarını `peers` anahtarlarıyla doğrular. Çift sırlarını `familyId` ve `anchor` ile türetir.
- `GUEST_REVOKED` gelince misafir uygulaması verisini siler ve kapanır. Mesaj içinde imzalı `REVOKE` olayı bulunur; misafir olayın imzasını `peers` içindeki ebeveyn anahtarıyla doğrular.
- Kurucu belge §6.6'daki "indirgenmiş görünüm" ifadesi bu bölümle değişir (§13).

## 8. Emeklilik ve silme raporu

Kurucu belge §9.5'teki akışın protokol tarafı:

1. **Başlatma:** Ebeveyn telefonu cihaza `RETIRE_BEGIN { deviceId }` (0x98) gönderir. Cihaz, taşınacakların listesini döner: `RETIRE_LIST { holds, blobs, shares }` (0x99). Taşıma RFC-0001 ve RFC-0002 yollarıyla yapılır.
2. **Silme ortamı:** Cihaz Kurulum USB'sinin silme modundan açılır. Silme ortamı **kendi tek kullanımlık** Ed25519 rapor anahtarını belleğinde üretir. Cihazın kendi işletim sistemi bu anahtarı hiç görmez.
3. **Anahtar QR'ı:** Silme ortamı açık anahtarı ve bilet kimliklerini (`ids`, `hostId`, `retireNonce`) ekranda `HFK1` biçimli QR olarak gösterir (RFC-0007 §13.5). Ebeveyn telefonla okutur. Telefon açık anahtarı geçici olarak saklar.
4. **Sanitize:** Silme ortamı diski sanitize eder ve raporu üretir:

   ```
   WIPE_REPORT {
     deviceId: fixed16, serial: string, model: string, diskModel: string, diskSerial: string,
     method: string ('nvme-sanitize-crypto' | 'nvme-sanitize-block' | 'ata-sanitize' | 'ata-secure-erase' | 'overwrite-verify' | 'clear-unverified'),
     tool: string, toolVersion: string, driveStatus: string,
     startedAt: uint, finishedAt: uint, result: string ('ok' | 'dogrulanamadi' | 'hata'),
     reportPub: fixed32, sig: fixed64        // Ed25519(rapor anahtarı, hash('hf/wipe-report/', gönderilen baytlar sig hariç))
   }
   wipeReportHash = hash('hf/wipe-report-id/', WIPE_REPORT'un tam kodlaması)
   ```

   `blkdiscard` geçerli bir yöntem değildir.
5. **Rapor QR'ı:** Silme ortamı raporu QR ile gösterir. Rapor büyükse sıralı parçalar halinde verir (`HFW1:<sıra>/<toplam>:<base45>`). Telefon okutur.
6. **Kayıt:** Telefon şunları denetler: `reportPub`, 3. adımdaki anahtarla aynı mı; `sig` geçerli mi. Sonra raporu "Ebeveynler" koleksiyonuna `hf.wipe.report` türünde kayıt olarak yazar ve PDF'ini üretir.
7. **Çıkarma:** Telefon `DEVICE_DETACH { wipe: true, wipeReportHash }` yazar. Kutu için `REMOVE_MEMBER` yazılır, `reason = 'wipe:' + hex(wipeReportHash)`.

Çalınan ya da ulaşılamayan cihazda yalnız 7. adım yapılır; `wipeReportHash` sıfırdır.

- **Çok diskli cihaz:** Rapor kümesinin özeti `hf/wipe-report-set/` etiketiyle alınır (RFC-0007).
- **İşletim sistemi silinmeyen cihaz** (tepsi uygulaması, eski Android) `uygulama-verisi-silindi` raporu verir; rapor `WIPE_REPORT`'tan ayrı bir türdür (RFC-0008).

## 9. Çatallanma kuralı (K10 güncellemesi)

`sync.js`:

```js
const parentSigned = (e, L) => e.sigs.some((s) => L.member(s.memberId)?.role === 'ebeveyn')
const isStrong  = (e, L) => e.type === T.REMOVE_MEMBER || e.type === T.ROTATE_DEVICE || e.type === T.REVOKE ||
                            (e.type === T.DEVICE_DETACH && parentSigned(e, L))
const isRemoval = (e, L) => e.type === T.REMOVE_MEMBER || e.type === T.LEAVE || e.type === T.REVOKE || e.type === T.DEVICE_DETACH
```

- Ebeveynin yazdığı cihaz çıkarma ve misafir kaldırma çatallanmada kaybolmaz.
- Cihazın kendi imzaladığı çıkış "güçlü" sayılmaz. Böylece bir cihaz kendi çıkışıyla başka bir dalı (ör. bir `COLLECTION` değişikliğini) zincirden itemez.

## 10. Numaralar (`KARARLAR.md` K19 olarak işlenecek)

| Tür | Numara |
|-----|--------|
| Defter olayları | 13 `DEVICE_ATTACH`, 14 `DEVICE_DETACH`, 15 `PLACE`, 16 `BEING`, 17 `GRANT`, 18 `REVOKE`, 19 `SHARE_CONSENT`, 20 `KIND`, 21 `COLLECTION`, 22 `PROTOCOL_LEVEL`, 23 `TASK_PERMIT` |
| HELLO yetenek bitleri | `LEDGER_V21 32`, `KAYIT 64`, `GOREV 128`, `BAGLANTI 256` (RFC-0009), `AFET 512` (RFC-0012), `YZ 1024` (RFC-0013), `UYGULAMA 2048` (RFC-0011), `HIDE_PRESENCE 4096` (RFC-0015) |
| Tören `kind` | `0` üye (bugün), `1` kutu, `2` bağlı cihaz, `3` misafir |
| Kayıt zarfları (RFC-0001) | `0x80 REC_VV`, `0x81 REC_OPS`, `0x82 REC_KEY`, `0x83 REC_KEY_REQ`, `0x84 BLOB_REQ`, `0x85 BLOB_DATA`, `0x86 BLOB_DEL`, `0x87 REC_IDS`, `0x88 REC_CUTOFF`, `0x89 REC_PRUNE`, `0x8A REC_BUCKETS`, `0x8B REC_BUCKET_IDS` |
| Görev zarfları (RFC-0002) | `0x90 TASK`, `0x91 TASK_ACCEPT`, `0x92 TASK_REJECT`, `0x93 TASK_PROGRESS`, `0x94 TASK_RESULT`, `0x95 TASK_CANCEL`, `0x96 NODE_CAPS`, `0x97 TASK_DELEGATION` |
| Diğer zarflar | `0x98 RETIRE_BEGIN`, `0x99 RETIRE_LIST`, `0x9A GUEST_VIEW`, `0x9B KASA_SHARE_REQ`, `0x9C KASA_SHARE_RES`, `0x9D GUEST_REVOKED`, `0x9E KASA_VERSION_REQ`, `0x9F KASA_VERSION_RES` |
| Çekirdek komutları | 240–249 kayıt, 250–259 görev (`packages/protocol/komutlar.js`); 260–269 RFC-0006, 270–279 RFC-0013, 280–289 RFC-0005, 290–299 RFC-0009, 300–309 RFC-0010, 310–319 RFC-0012, 320–329 RFC-0011, 330–339 RFC-0007, 340–349 RFC-0008, 350–359 RFC-0015 |
| Sonraki RFC'lerin zarf aralıkları | 0xA0–0xA7 RFC-0009, 0xA8–0xAF RFC-0011, 0xB0–0xB7 RFC-0012, 0xB8–0xBF RFC-0013, 0xC0–0xC7 RFC-0006, 0xC8–0xCF RFC-0005, 0xD0–0xD7 RFC-0010, 0xD8–0xDF RFC-0007, 0xE0–0xE7 RFC-0008; 0xE8 `APP_PAIR_REQ`, 0xE9 `APP_PAIR_OK`, 0xEA `APP_LOCAL_SYNC` (RFC-0017 §6.2), 0xF0 `BLOB_HAVE` (RFC-0019 §9), 0xF1 `KASA_SHARE_PUT`, 0xF2 `KASA_SHARE_ACK` (RFC-0027 §1b), 0xF3 `KASA_ENV_PUT`, 0xF4 `KASA_ENV_ACK`, 0xF5 `KASA_ENV_REQ`, 0xF6 `KASA_ENV_RES` (RFC-0027 §9 g); 0xEB–0xEF ve 0xF7–0xFE boş, 0xFF ayrılmış |
| Türetme etiketleri | Hepsi `hf/` ile başlar, `/` ile biter (RFC-0001 §3). Kayıt: `hf/rec-*/`, `hf/blob-*/`. Görev: `hf/task/`, `hf/task-*/`, `hf/node-caps/`. Defter: `hf/guest-view/`, `hf/wipe-report/`, `hf/wipe-report-id/`. Kasa: `hf/kasa-*/`. Her RFC kendi tam listesini metinde verir. |

## 11. Test vektörleri

`protocol/vectors/ledger-v21.json`:

1. Her yeni olayın gövde kodlaması ve özeti.
2. `PROTOCOL_LEVEL` yokken `DEVICE_ATTACH` → `LEVEL_TOO_LOW`. `KIND` seq 1'de → geçerli.
3. Cihaz kendi `DEVICE_DETACH`'ını imzalar → geçerli. Başka bir cihazınkini imzalar → `DEVICE_CANNOT_VOTE`.
4. Ebeveyn, ergenin `kisisel` koleksiyonuna kendini ekler → `PERSONAL_COLLECTION`.
5. `kasa` koleksiyonunda `taskAccess: true` ya da `grant:` okuyucu → `VAULT_RULE`.
6. 17. cihaz → `DEVICE_LIMIT`. Bir cihaz çıkarılır, sonra 16. eklenir → geçerli.
7. `KIND ekip` → RFC-0005 ile geçerli; ekip vektörleri RFC-0005 §18'dedir (`EKIP_HENUZ_YOK` kalktı).
8. Çatallanma: ebeveynin yazdığı `DEVICE_DETACH` dalı güçlüdür; cihazın kendi yazdığı değildir.
9. Daha önce üye olmuş bir kimlik cihaz olarak eklenir → `IDENTITY_ALREADY_EXISTS`.
10. Aynı misafir için iki `REVOKE` → ikincisi `NO_TARGET`.

## 12. Güvenlik değerlendirmesi

| Tehdit | Önlem |
|--------|-------|
| Eski ve yeni istemcinin sessizce ayrışması | Tolere etme yok; sürüm kapısı ve gürültülü red |
| Çalınan cihaz kendini yeniden ekler | Kimlik yeniden kullanılamaz; yeni tören gerekir |
| Tek ebeveynin sınırsız cihaz eklemesi | 16 cihaz sınırı. Her ekleme defterde görünür, öbür ebeveyne `hf.device.added` olayı gider. |
| Ebeveynin kişisel veriye erişmesi | `kisisel` koleksiyonu yalnız sahibi değiştirir |
| Misafirin aile bilgisini görmesi | Misafir oturumuna defter gönderilmez; `GUEST_VIEW` yalnız ilgili kişileri içerir |
| Kaldırılmış ebeveynin misafire sahte görünüm göndermesi | Görünüm yalnız önceki görünümdeki ebeveynden ve artan `ledgerLen` ile kabul edilir. Kaldırılmış ebeveyn sonraki görünümlerde ebeveyn olarak listelenmez. |
| Kutunun emanet edilen anahtarları görmesi | Topluluk içi zarf türlerinin tamamı (0x80–0xFE) emanet yolunda mühürlü |
| Sahte silme raporu | Rapor anahtarını silme ortamı üretir; açık anahtar silmeden önce QR ile telefona geçer |

## 13. Kurucu belgede değişecekler

| Bölüm | Değişiklik |
|-------|------------|
| §6.3 "Geriye uyum" ve HF6 | Tolere eden uyum kuralı kaldırılır. Yerine §2.2'deki sürüm kapısı gelir. Yuva Hat'ın sonraki mağaza sürümü v2.1'in tamamını içerir. |
| §6.3 tablo | `GRANT`'tan `autoRevoke` çıkarılır (§5.5). `KIND` düzey kapısından muaftır. |
| §6.6 | Bağlı cihaz tam defteri alır. Yalnız misafir `GUEST_VIEW` alır. |
| §9.5 madde 2 | Rapor anahtarını silme ortamı üretir, cihazın işletim sistemi değil. |
| §15.1 "Bir sonraki mağaza sürümü" | "Uyum kuralı" yerine "protokol v2.1'in tamamı, `HELLO` ve `JOIN_HELLO` yetenek bitleri". |

## 14. Uygulama sırası

1. Gövde kodlayıcıları, `Ledger` durum alanları ve kurallar; vektörler 1–10.
2. HELLO ve `JOIN_HELLO` yetenek bitleri, `caps` saklama.
3. Oturum rolleri, misafir kuralı, `PairBook` genişlemesi.
4. Emanet mührünün genişlemesi (`CTRL_TYPES`).
5. `PROTOCOL_LEVEL` arayüz akışı.
6. Emeklilik mesajları (Faz 1, silme USB'siyle birlikte).
7. Yuva Hat'a taşıma (aşama B) ve mağaza sürümü.

## Ek (RFC-0016, 23 Ekim 2026)

- §5.8: `KIND = 'ekip'` RFC-0005 ile geçerli; `EKIP_HENUZ_YOK` kalktı; RFC-0005'in olayları 24–26.
- §6.1: Oturum tablosuna sonraki RFC'lerin mesajları eklendi (`UPDATE_*`, `NODE_PROFILE`, `UC_*`, `APP_WIPE_REPORT`, `APP_LINK`, `VAKA_*`, `EKIP_CIKIS*`, `HIZMET_*`).
- §6.4: Mühür bütün topluluk içi zarf türlerini (0x80–0xFE) kapsar; yalnız doğrudan oturumluk tür emanetten gelirse atılır.
- §8: Anahtar QR'ı `HFK1` biçiminde; çok diskte `hf/wipe-report-set/`; işletim sistemi silinmeyen cihazda `uygulama-verisi-silindi` raporu.
- §10: HELLO bitleri 256–4096, çekirdek komut aralıkları 260–359 ve zarf aralıkları 0xA0–0xE7 eklendi.
- §11, §12: `KIND ekip` test vektörü ve mühür güvenlik satırı bu eklere göre düzeltildi.

## Ek: RFC-0033 (onaylı, 24 Ekim 2026)

- **Törende `DEVICE_ATTACH`** (RFC-0033 §9 n): `class` törende taşınmaz (düğümün cihaz töreni `isci`), `caps` boştur (§5.1'deki "ilk NODE_CAPS" törenden sonra gelir), `placeId` 0, `name` JOIN_HELLO'daki ad. İstemci, yeni cihazın imzası eksik `DEVICE_ATTACH`'ı reddetmez, öneri sayar; imza törende `JOIN_SIG` ile tamamlanır.
- **Üye ↔ cihaz oturumu** (§9 o): §6.1 tablosunun alt kümesi: yalnız defter eşitlemesi ve cihazın `BLOB_REQ`'i; kayıt özeti, LEDGER_PROPOSE ve kayıt dosyası isteği cihaza gitmez.
