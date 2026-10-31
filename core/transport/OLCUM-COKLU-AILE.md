# Ölçüm önerisi: bir telefonda birden çok aile, telefon geneli dinleme bütçesi (RFC-0034 A1; D94)

> 25 Ekim 2026. Durum: öneri. Ölçüm yapılmadı. Sayılar ölçümden sonra RFC-0034 §6'ya ve RFC-0028 §7 g–h'ye yazılır.

## Bugünkü durum (kod)

- RFC-0034 §6: bütün aile örnekleri tek HyperDHT düğümünü paylaşır (`worklet/start.js`). Her örneğin kendi
  `DhtTasiyici`'si vardır.
- `DhtTasiyici.yokla` her çift için dilim başına bir dinleme sunucusu kurar. Dilim bitmeden 5 dakika önce bir sonraki
  dilimin sunucusu da kurulur. Kutulu ailede arka planda yalnız kutu dinlenir (§7 h).
- **"En çok 16 dinleme sunucusu" sınırı (RFC-0028 §7 g) taşıyıcıda bugün uygulanmıyor.** Ne örnek başına ne telefon
  genelinde bir sayaç var. Tek aileli telefonda da sınır yok.
- Üç kutusuz, 8'er kişilik aile: 3 × 7 = 21 çift. Bu, dilim geçişinde 42'ye kadar dinleme sunucusu demek.

## Ölçülecekler

| # | Ölçü | Nasıl |
|---|------|-------|
| 1 | Dinleme sunucusu başına DHT duyuru trafiği (bayt/dk, paket/dk) | Yerel testnet'te `dht` olay sayaçları; gerçek DHT'de Linux deneme makinesinde `nethogs` ya da süreç başına `/proc/<pid>/net/dev` farkı |
| 2 | Sunucu sayısına göre bellek ve CPU (Node ve Bare) | 1, 4, 8, 16, 32, 42 sunucu; `process.memoryUsage`, `/proc/<pid>/stat` |
| 3 | Arka planda pil (Android deneme telefonunda) | Aynı sayılarla 1 saat ekran kapalı; Android `batterystats` |
| 4 | Oturumun kurulma süresi (arayan → HELLO) | Sunucu sayısı arttıkça yükseliyor mu; testnet ve gerçek DHT |
| 5 | Sıralı dinlemede (bütçe aşılınca) bir çiftin ulaşılamaz kaldığı en uzun süre | Önerilen paylaştırmayla benzetim |

## Önerilen paylaştırma (ölçümle sınanacak)

1. Telefon geneli bütçe `B` (RFC'deki 16; ölçüm 1–3'e göre kesinleşir).
2. Kutulu ailenin arka planda yalnız kutusu dinlenir (1 sunucu). Uygulama öndeyken ekrandaki aile önce gelir.
3. Kalan bütçe kutusuz ailelere üye sayısıyla orantılı paylaşılır, her aileye en az 1 sunucu.
4. Bütçe yetmezse çiftler yoklama aralığında (30 sn) sırayla dinlenir. Sıra, son oturumu en eski olan çiftten başlar.
5. Kodda yapılacak yer: `baslat` örneklerin `DhtTasiyici`'sine "en çok n sunucu" kotası verir; `yokla` kotayı aşan
   çiftleri sıraya koyar. Tek aileli telefonda kota `B` olur; böylece §7 g tek ailede de uygulanmış olur.

## Düzen

- Linux deneme makinesinde (Node) ve Bare'de: `worklet/test/multi-family.js`'teki üç süreçli testnet düzeni, 3 aile × 8 üye kadar sahte
  üyeyle (`core/transport/test/multi-family.js`'teki defter kurucuları).
- Android'de pil ölçümü deneme telefonunda; betik ve sonuç tablosu çekirdek tarafındadır.
- Gerçek DHT ölçümü dış ağa bağlanır: proje sahibinin onayıyla, kısa süreli.

## Karar bekleyen

- `B`'nin sayısı ve paylaştırma (ölçümden sonra).
- §7 g'nin tek aileli telefonda da uygulanması (bugün yok; ayrı iş, İstek 175).
