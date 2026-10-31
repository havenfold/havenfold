# Hizmet alıcısı (referans)

RFC-0010 §13.1 alıcı arayüzünün en küçük uygulaması ve paket açma aracı. Lisans AGPL-3.0-only (Posta Kutusu ile aynı gerekçe, kurucu §17.1).

- `receiver.js`: istek işleyici (HTTP'den bağımsız), bellek içi depo.
- `server.js`: HTTP sarmalayıcı. `node server.js <port> <kart.hex>…`. TLS önünde ters vekilde sonlanır.
- `tools.js`: `node tools.js ac <kart.hex> <anahtar.hex> <paket>` paketi açar, gövdeyi JSON basar.

**AGPL §13 (ağ üstünden kullanım):** Bu alıcıyı değiştirip ağda başkalarına hizmet olarak işletiyorsanız, onunla etkileşen
kullanıcılara çalışan sürümün tam kaynağını ücretsiz sunmalısınız. Bunun için alıcının istemcilere görünen bir yerinde
(hizmetin belgeleri, kart bilgisi ya da ters vekilin bir sayfası) değiştirilmiş kaynağın bulunduğu depoya ve tam kayda
bağlantı verin; kaynak, çalışan sürümle aynı kayıttan derlenebilir olmalıdır. Değiştirmeden işletiyorsanız §13
yükümlülüğü doğmaz; yine de bu deponun bağlantısını vermeniz önerilir. Alıcı bunun için `GET /source` uç noktasını
ve her cevapta `x-hf-source` başlığını sunar; değer `HF_SOURCE` ortam değişkeninden gelir (varsayılan bu depo).
Değiştirilmiş sürümde `HF_SOURCE`'u kendi deponuzun ve kaydınızın adresine çevirin. Eski adlar (`GET /kaynak`,
`x-hf-kaynak`, `HF_KAYNAK`) da çalışır.

Kök çalışma alanında değildir; bağımlılıklarını (`@havenfold/services`, `b4a`) deponun kök `node_modules`'ünden alır.

RFC'nin tablosuna eklenenler (İstek 12): hizmetin paket dosyasını çekmesi `GET /v1/b/{serviceId}/{blobId}/{index}` (x-hf-auth); `POST /v1/ack` gövdesinde isteğe bağlı 8 bayt u64be `useUntil` (cevap penceresi `min(useUntil, ack + 30 gün)`).
