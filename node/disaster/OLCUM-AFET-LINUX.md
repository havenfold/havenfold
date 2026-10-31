# Ölçüm notu: afet modu, Linux düğüm (D85, 25 Ekim 2026)

Bu not RFC-0012 §17 adım 6'nın (saha denemesi) Linux tarafına girdi olarak yazıldı. Gerçek radyo ölçümü **yapılamadı**; nedenleri ve yapılması gerekenler aşağıda.

## Deneme makinesi (Ubuntu Server 24.04 dizüstü)

| Öğe | Durum |
|-----|-------|
| Bluetooth donanımı | Var: `hci0`, USB arayüzü, sürücü `btusb` (ürün `cf3/e300`, Qualcomm Atheros QCA61x4) |
| BlueZ | Kurulu değil: `bluetoothctl` yok, `bluetooth.service` etkin değil |
| D-Bus istemcisi | `dbus-next` 0.10.2 (MIT, saf JavaScript; İstek 164 onaylandı, D91): `node/disaster/dbus-adapter.js`. Özel `dbus-daemon` ve sahte `org.bluez` ile sınandı (`node/test/disaster-dbus.js`); sistem veri yolunda `org.bluez` yok hatası alınıyor (BlueZ kurulu değil). |
| Güç kaynağı | `/sys/class/power_supply`: `AC` (Mains, online 1), `BAT0` (Battery, capacity 0, `Not charging`), `ucsi-source-psy-USBC000:001` (USB). `gucOku` bunu `{ prizde: true, pil: 0, sarj: 'sarj-degil' }` okur. |

## Bluetooth adresi (RFC-0012 açıklama 2 madde 6)

Düğüm sabit genel adres kullanmamalı: sabit adres, dilimler arası değişen etiketlere rağmen cihazın izlenmesini açar. BlueZ'de çözülebilir özel adres (RPA) açılır: `/etc/bluetooth/main.conf` içinde `[General]` bölümüne `Privacy = device` (BlueZ ≥ 5.67), ardından `systemctl restart bluetooth`. Kurulum (`node/deploy`) bu satırı BlueZ kurulumuyla birlikte yazmalı (İstek 167). Ölçümde adresin 15 dakikada bir değiştiği `btmgmt info` ile doğrulanmalı.

## Ölçüm için gerekenler

1. Yönetici: `sudo apt install bluez` ve `sudo systemctl enable --now bluetooth` (sudo kullanıcıya kalır).
2. ~~D-Bus istemcisi~~: yapıldı (D91).
3. Kutu kullanıcısının `org.bluez`'e D-Bus erişimi: `node/deploy/havenfold-dbus.conf` (`/usr/share/dbus-1/system.d/havenfold.conf`; kurulum betiği 6. adımda kurar, sudo). `bluetooth` grubu gerekmez.
4. `/etc/havenfold/dugum.toml`'a `afet = "acik"`; kutu yeniden başlatılır. Günlükte `afet: Bluetooth başlatılamadı` yoksa düğüm GATT hizmetini ve tarama süzgecini kaydetmiştir.

## Ölçülecekler (adım 6 ile)

- Düğüm ↔ Android telefon ve düğüm ↔ iPhone (ön plan, arka plan): keşiften ilk TAGS okumasına süre, bağ kurulumu (etiket + Noise IK + HELLO), 10 mesajlık eşitleme süresi, MTU (§6.4 en az 185), menzil (iç mekân, 1 ve 2 duvar).
- Çevre rolünde BlueZ bildirimi abone bütün merkezlere gider; bu yüzden düğüm çevre rolünde aynı anda tek oturum yürütür (`bluez.js`). Merkez rolünde en çok 3. İkinci merkezin bekleme süresi ölçülmeli.
- Pil < %30'da pencereli tarama (5 sn / 3 dk; §9.3): telefonun düğümü bulma süresi.
- Güç: prizi çekip 2 dakika sonra `kesinti` olayı ve ETKİN geçişi; priz dönünce `geldi`. Deneme makinesinde pil kapasitesi 0 göründüğü için pil yüzdesi ölçümü bu makinede anlamsız.
