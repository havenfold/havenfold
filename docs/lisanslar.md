# Üretim bağımlılıklarının lisansları

> dell, D37; D65 (24 Ekim 2026). Tablo elle yazılmaz: `node scripts/license-check.js --yaz` kilit dosyalarından
> yazar; `scripts/check.sh` her koşuda lisansları ve bu tablonun kilitlerle aynı olduğunu denetler.

Kapsam: kök kilit (`core/*`, `sdk`, `node`, `tools/export-open` çalışma alanları) ve `worklet/package-lock.json`'da
geliştirme bağımlılığı olmayan her paket; telefon taşıyıcısının zinciri (`hyperdht`, `@hyperswarm/secret-stream`,
`noise-*`, `sodium-universal` …) worklet kilidinden gelir. Geliştirme araçları (`bare`, `bare-runtime`, `bare-pack`, `brittle`,
`bare-subprocess`, `bare-pipe`) pakete girmez; listede yoktur. Düğüm paketi iki çalışma zamanı ikilisi taşır: resmî
Node.js 22 linux ikilisi (MIT; içindeki OpenSSL, ICU, V8 … bildirimleri Node'un `LICENSE` dosyasında) ve Bare
(`bare-runtime-linux-*`, Apache-2.0). Lisans ve bildirim metinleri paketin `LICENSES/node/` ve `LICENSES/bare/`
dizinlerindedir (`node/scripts/runtime.sh`, `pack.sh`); biri eksikse `release-build.js paket` durur (`NO_LICENSE`).

## Kurallar

- İzinli lisanslar: MIT, ISC, Apache-2.0, BSD-2-Clause, BSD-3-Clause, 0BSD; kendi paketlerimiz MPL-2.0 (çekirdek) ve
  Apache-2.0 (SDK, `export-open`; kurucu §17.1). GPL, AGPL, LGPL, SSPL ve lisansı yazılmamış paket yok.
- Her dış paketin kilitte sürümü, kaynağı (`resolved`) ve özeti (`integrity`) var; `package.json`'larda bütün
  bağımlılıklar tam sürümle (`^`, `~`, aralık yok) ya da `file:` ile.
- Bilinen açık: `npm audit --omit=dev` `worklet`'te 0; kökte 2 orta düzey girdi, ikisi de aynı açık (25 Ekim 2026):
  `xml2js` <0.5.0 prototip kirlenmesi (GHSA-776f-qx25-q3cc), `dbus-next` üzerinden. `xml2js` 0.5.0'da düzeltildi,
  ama `dbus-next`'in düzeltilmiş sürümü kullanan bir sürümü yok; npm bu zincire otomatik düzeltme sunmuyor.
  Değerlendirme: `dbus-next` yalnız kutunun afet modunda (`node/disaster/dbus-adapter.js`) sistem veri yolunda BlueZ'le konuşur;
  `xml2js` yalnız sistem veri yolundaki iki servisin iç gözlem (introspection) XML'ini çözer: `org.bluez` ve veri yolunun
  kendisi (`org.freedesktop.DBus`, sinyal eşleşmesi için). İkisi de kök yetkili sistem servisidir,
  D-Bus izin kuralı kutu kullanıcısının çağrılarını `org.bluez`'e (ve her istemcinin konuştuğu veri yolu servisine) sınırlar ve afet modu varsayılan kapalıdır. Havenfold
  üzerinden sömürülebilirlik doğrulanmadı. `dbus-next` ya da `xml2js` için düzeltme çıkınca uyum testiyle yükseltilir.
  Ağ gerektirdiği için kontrolde koşmaz; sürüm yükseltmesinden önce elle koşulur.

## Tablo

| Paket | Sürüm | Lisans | Tür | Kilit |
|-------|-------|--------|-----|-------|
| @havenfold/ai | 0.0.0 | MPL-2.0 | çalışma alanı | kök, worklet |
| @havenfold/core | 0.0.0 | MPL-2.0 | çalışma alanı | kök, worklet |
| @havenfold/disaster | 0.0.0 | MPL-2.0 | çalışma alanı | kök, worklet |
| @havenfold/edge | 0.0.0 | MPL-2.0 | çalışma alanı | kök, worklet |
| @havenfold/events | 0.0.0 | MPL-2.0 | çalışma alanı | kök, worklet |
| @havenfold/export | 0.0.0 | MPL-2.0 | çalışma alanı | kök, worklet |
| @havenfold/records | 0.0.0 | MPL-2.0 | çalışma alanı | kök, worklet |
| @havenfold/sdk | 0.0.0 | Apache-2.0 | çalışma alanı | kök, worklet |
| @havenfold/services | 0.0.0 | MPL-2.0 | çalışma alanı | kök, worklet |
| @havenfold/tasks | 0.0.0 | MPL-2.0 | çalışma alanı | kök, worklet |
| @havenfold/transport | 0.0.0 | MPL-2.0 | çalışma alanı | kök, worklet |
| @havenfold/vault | 0.0.0 | MPL-2.0 | çalışma alanı | kök, worklet |
| crypto | 0.0.0 | MPL-2.0 | çalışma alanı | kök |
| export-open | 0.0.0 | Apache-2.0 | çalışma alanı | kök |
| havenfold-node | 0.0.0 | MPL-2.0 | çalışma alanı | kök |
| usocket | 0.0.0 | MPL-2.0 | çalışma alanı | kök |
| @hyperswarm/secret-stream | 6.9.2 | Apache-2.0 | dış | kök, worklet |
| @nornagon/put | 0.0.8 | MIT | dış | kök |
| adaptive-timeout | 1.0.1 | Apache-2.0 | dış | kök, worklet |
| b4a | 1.9.0 | Apache-2.0 | dış | kök, worklet |
| bare-addon-resolve | 1.11.0 | Apache-2.0 | dış | kök, worklet |
| bare-ansi-escapes | 2.2.3 | Apache-2.0 | dış | kök, worklet |
| bare-assert | 1.3.0 | Apache-2.0 | dış | kök, worklet |
| bare-events | 2.9.2 | Apache-2.0 | dış | kök, worklet |
| bare-fs | 4.8.4 | Apache-2.0 | dış | kök, worklet |
| bare-inspect | 3.1.10 | Apache-2.0 | dış | kök, worklet |
| bare-module-resolve | 1.12.6 | Apache-2.0 | dış | kök, worklet |
| bare-path | 3.1.2 | Apache-2.0 | dış | kök, worklet |
| bare-semver | 1.1.0 | Apache-2.0 | dış | kök, worklet |
| bare-stream | 2.13.4 | Apache-2.0 | dış | kök, worklet |
| bare-type | 1.4.0 | Apache-2.0 | dış | kök, worklet |
| bare-url | 2.5.5 | Apache-2.0 | dış | kök, worklet |
| bits-to-bytes | 1.3.0 | ISC | dış | kök, worklet |
| blind-relay | 1.6.1 | Apache-2.0 | dış | kök, worklet |
| bogon | 1.3.0 | MIT | dış | kök, worklet |
| compact-encoding | 3.5.2 | Apache-2.0 | dış | kök, worklet |
| compact-encoding-bitfield | 1.1.0 | Apache-2.0 | dış | kök, worklet |
| compact-encoding-net | 1.3.0 | Apache-2.0 | dış | kök, worklet |
| dbus-next | 0.10.2 | MIT | dış | kök |
| dht-rpc | 6.27.0 | MIT | dış | kök, worklet |
| duplexer | 0.1.2 | MIT | dış | kök |
| event-stream | 3.3.4 | MIT | dış | kök |
| events-universal | 1.0.1 | Apache-2.0 | dış | kök, worklet |
| fast-fifo | 1.3.2 | MIT | dış | kök, worklet |
| from | 0.1.7 | MIT | dış | kök |
| generate-object-property | 2.0.0 | MIT | dış | kök, worklet |
| generate-string | 1.0.1 | MIT | dış | kök, worklet |
| hexy | 0.2.11 | MIT | dış | kök |
| hypercore-crypto | 3.7.0 | MIT | dış | kök, worklet |
| hypercore-id-encoding | 1.3.0 | Apache-2.0 | dış | kök, worklet |
| hyperdht | 6.34.1 | MIT | dış | kök, worklet |
| hyperdht-address | 1.1.1 | Apache-2.0 | dış | kök, worklet |
| hyperschema | 1.26.2 | Apache-2.0 | dış | kök, worklet |
| is-property | 1.0.2 | MIT | dış | kök, worklet |
| jsbi | 2.0.5 | Apache-2.0 | dış | kök |
| kademlia-routing-table | 1.0.6 | MIT | dış | kök, worklet |
| long | 4.0.0 | Apache-2.0 | dış | kök |
| map-stream | 0.1.0 | MIT | dış | kök |
| nanoassert | 2.0.0 | ISC | dış | kök, worklet |
| nat-sampler | 1.0.1 | MIT | dış | kök, worklet |
| noise-curve-ed | 2.1.0 | ISC | dış | kök, worklet |
| noise-handshake | 4.2.0 | Apache-2.0 | dış | kök, worklet |
| pause-stream | 0.0.11 | MIT | dış | kök |
| protomux | 3.13.0 | MIT | dış | kök, worklet |
| queue-tick | 1.0.1 | MIT | dış | kök, worklet |
| record-cache | 1.2.0 | MIT | dış | kök, worklet |
| require-addon | 1.3.0 | Apache-2.0 | dış | kök, worklet |
| safe-buffer | 5.2.1 | MIT | dış | kök |
| safety-catch | 1.0.3 | MIT | dış | kök, worklet |
| sax | 1.2.4 | ISC | dış | kök |
| shamir-secret-sharing | 0.0.4 | Apache-2.0 | dış | kök |
| signal-promise | 1.0.3 | MIT | dış | kök, worklet |
| sodium-native | 5.2.0 | MIT | dış | kök, worklet |
| sodium-secretstream | 1.2.0 | MIT | dış | kök, worklet |
| sodium-universal | 5.0.1 | MIT | dış | kök, worklet |
| split | 0.3.3 | MIT | dış | kök |
| stream-combiner | 0.0.4 | MIT | dış | kök |
| streamx | 2.28.1 | MIT | dış | kök, worklet |
| teex | 1.0.1 | MIT | dış | kök, worklet |
| text-decoder | 1.2.7 | Apache-2.0 | dış | kök, worklet |
| through | 2.3.8 | MIT | dış | kök |
| time-ordered-set | 2.0.1 | MIT | dış | kök, worklet |
| timeout-refresh | 2.0.1 | MIT | dış | kök, worklet |
| udx-native | 1.22.0 | Apache-2.0 | dış | kök, worklet |
| unslab | 1.3.0 | Apache-2.0 | dış | kök, worklet |
| which-runtime | 1.4.0 | Apache-2.0 | dış | kök, worklet |
| xache | 1.3.0 | MIT | dış | kök, worklet |
| xml2js | 0.4.23 | MIT | dış | kök |
| xmlbuilder | 11.0.1 | MIT | dış | kök |
| z32 | 1.1.0 | MIT | dış | kök, worklet |
