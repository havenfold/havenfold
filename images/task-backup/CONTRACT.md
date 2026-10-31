# `hf.task.backup` 1.0.0 — sözleşme

RFC-0002 §5'teki satır: girdi şifreli yedek blokları (dosya); parametre `{ ownerId, setId }`; çıktı
`{ stored: blobId[] }`; bölünmez; Faz 1.

## Yerleşik iş: konteyner imajı yoktur

RFC-0002 §11.2: `hf.task.backup` konteynersiz, denetçinin içinde çalışır; içerik açmaz, bloklar şifreli gelir ve
şifreli saklanır. Kurucu belge §8.7 tablosu da "yerleşik" der. Bu yüzden bu dizinde `Containerfile` yoktur ve bir
yedek aracı (restic vb.) kullanılmaz: blokları istemci zaten şifreleyip parçalamıştır, düğüm yalnız saklar.
Podman çalıştırıcısı bu türü reddeder (`BUILTIN_TASK`, `node/podman.js`). Dosya, RFC-0002 §5'in "her türün
sözleşmesi `images/<tür>/CONTRACT.md`'dedir" kuralı için buradadır.

## Akış (düğümde)

1. İşçi çekirdeği `TASK`'ı denetler (RFC-0002 §6.2). `collectionId` 16 sıfırdır, koleksiyon denetimi atlanır (madde 4).
2. Girdi bloklarını `BLOB_REQ` ile isteyenden ya da kutudan çeker. Bloklar şifreli kalır; `fileKey` kullanılmaz.
3. Her bloğu kendi `/run/havenfold/<kapsam>/` dizinine yazar ve denetçiye `YEDEK_YAZ { blobId, path, size }` gönderir
   (RFC-0007 §6.3). Denetçi bloğu `/var/lib/havenfold/yedek/<kapsam>/<blobId>`'ye kopyalar (`node/supervisor.js`
   `yedekYaz`: bağ izlenmez, boyut denetlenir, var olanın üstüne yazılmaz).
4. `TASK_RESULT { status: 'ok', inline: <çıktı> }`.

Okuma ve silme görev değildir: çekirdek `YEDEK_OKU` ve `YEDEK_SIL` kullanır.

## Parametre ve çıktı kodlaması

RFC'de kodlama yazmaz; bu sözleşmenin kararı UTF-8 JSON'dur (`hf.task.ocr` ile aynı):

```json
{ "ownerId": "<32 hex>", "setId": "<32 hex>" }
```

Çıktı `TASK_RESULT.inline` içinde:

```json
{ "stored": ["<64 hex blobId>", "..."] }
```

32 KB'a sığmayan liste (yaklaşık 480 bloktan fazlası) için RFC'de yol yoktur; isteyen işi daha küçük kümelere böler.

## Bu sürümde olmayan

İşçinin ağ tarafı (`node/worker.js` `IsciAgi`: `TASK`, `BLOB_REQ`, `TASK_RESULT`) var, ama bu türü 3. adıma
(`YEDEK_YAZ`) bağlamıyor: işçi `hf.task.backup`'ı yetenek bildiriminde sunmaz. 3. adımın denetçi tarafı vardır
(`docs/audit/sinirlar-ve-kapsam-disi.md` madde 11).
