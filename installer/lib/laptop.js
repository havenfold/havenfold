// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// lib/laptop.js — laptopu sunucu yapma ayarları ve ağ, güncelleme, bellek dosyaları (RFC-0007 §10, §10.1)
//
// Saf ve bağımlılıksız: yazılacak dosyaların içeriği ve pil eşiği planı. Dosyaları kabuk (target/common.sh) yazar.

const LOGIND = `# /etc/systemd/logind.conf.d/havenfold.conf — RFC-0007 §10: kapak kapanınca ve tuşla uyku yok
[Login]
HandleLidSwitch=ignore
HandleLidSwitchExternalPower=ignore
HandleLidSwitchDocked=ignore
HandleSuspendKey=ignore
HandleHibernateKey=ignore
IdleAction=ignore
`

const UYKU_HEDEFLERI = ['sleep.target', 'suspend.target', 'hibernate.target', 'hybrid-sleep.target', 'suspend-then-hibernate.target']

// Ekran ışığı 60 sn'de söner: çekirdek satırına consoleblank=60
const GRUB = `# /etc/default/grub.d/90-havenfold.cfg — RFC-0007 §10: konsol 60 saniyede kararır
GRUB_CMDLINE_LINUX_DEFAULT="$GRUB_CMDLINE_LINUX_DEFAULT consoleblank=60"
`

// Yalnız güvenlik yamaları; yeniden başlatmayı denetçi sıralar (§12.7). 50unattended-upgrades'in listesi #clear ile
// boşaltılır, yoksa APT listeleri birleştirir.
const UNATTENDED = `// /etc/apt/apt.conf.d/52havenfold-unattended-upgrades — RFC-0007 §10, §12.7
#clear Unattended-Upgrade::Allowed-Origins;
#clear Unattended-Upgrade::Origins-Pattern;
Unattended-Upgrade::Allowed-Origins { "\${distro_id}:\${distro_codename}-security"; };
Unattended-Upgrade::Automatic-Reboot "false";
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
`

const SYSCTL = `# /etc/sysctl.d/90-havenfold.conf — RFC-0007 §10: 4 GB takas, az kullanılır
vm.swappiness=10
`

// nftables `inet havenfold` tablosu (§10). Gelen trafikte kurulu bağlantılar, geri döngü, IPv6 komşu keşfi ve
// çekirdeğin HyperDHT UDP portu (boş küme; RFC'de sabit port yok, taşıyıcı çalışma anında ekler: havenfold-nft.service). Kurulum USB'si yolunda geri kalanı düşer.
// Var olan Ubuntu'da (§8.6) SSH'a, güvenlik duvarına ve servislere dokunulmaz: zincirin politikası 'accept'tir; tablo
// yalnız afet modu ve uygulama kuralları için yer tutar.
function nftKurallari ({ kip }) {
  if (!['usb', 'var-olan'].includes(kip)) throw new Error('INVALID_MODE')
  const dus = kip === 'usb'
  return `#!/usr/sbin/nft -f
# /etc/havenfold/havenfold.nft — RFC-0007 §10; havenfold-nft.service yükler (${dus ? 'Kurulum USB\'si: gelen trafik düşer' : 'var olan Ubuntu: hiçbir şeyi engellemez'})
table inet havenfold
delete table inet havenfold
table inet havenfold {
  set hyperdht_udp {
    type inet_service
    flags interval
  }
  chain gelen {
    type filter hook input priority filter; policy ${dus ? 'drop' : 'accept'};
    ct state established,related accept
    iif "lo" accept
${dus ? '    ct state invalid drop\n' : ''}    meta l4proto ipv6-icmp icmpv6 type { nd-neighbor-solicit, nd-neighbor-advert, nd-router-advert, packet-too-big, time-exceeded, parameter-problem, destination-unreachable } accept
    meta l4proto icmp icmp type { destination-unreachable, time-exceeded, parameter-problem } accept
    udp dport @hyperdht_udp accept
  }
}
`
}

// Pil şarj sınırı (§10.1). dosyalar: var olan sysfs dosyaları. Sıra: çekirdeğin standart arayüzü (iki eşik varsa
// 60/80, yalnız bitiş varsa 80), üreticinin koruma modu (sabit eşik), hiçbiri yoksa 'yok'.
const URETICI = [
  // [yol, yazılacak, sürücünün sabit bitiş eşiği]
  ['/sys/bus/platform/drivers/ideapad_acpi/VPC2004:00/conservation_mode', '1', 60],
  ['/sys/devices/platform/samsung/battery_life_extender', '1', 80],
  ['/sys/devices/platform/lg-laptop/battery_care_limit', '80', 80],
  ['/sys/devices/platform/sony-laptop/battery_care_limiter', '80', 80]
]
const BASLANGIC = 60
const BITIS = 80

function pilPlani (dosyalar) {
  const set = new Set(dosyalar.map((x) => String(x).trim()).filter(Boolean))
  const piller = [...new Set([...set].map((x) => (/^(\/sys\/class\/power_supply\/[^/]+)\/charge_control_(start|end)_threshold$/.exec(x) || [])[1]).filter(Boolean))].sort()
  const yaz = []
  let ikisi = false
  for (const p of piller) {
    const bas = p + '/charge_control_start_threshold'
    const son = p + '/charge_control_end_threshold'
    if (set.has(bas) && set.has(son)) { yaz.push([bas, String(BASLANGIC)], [son, String(BITIS)]); ikisi = true } else if (set.has(son)) yaz.push([son, String(BITIS)])
  }
  if (yaz.length) return { limit: 'cekirdek', limitStart: ikisi ? BASLANGIC : 0, limitStop: BITIS, yaz }
  const u = URETICI.find(([yol]) => set.has(yol))
  if (u) return { limit: 'uretici', limitStart: 0, limitStop: u[2], yaz: [[u[0], u[1]]] }
  return { limit: 'yok', limitStart: 0, limitStop: 0, yaz: [], uyari: 'Pil sınırı yok. BIOS\'ta pil koruma ya da "çoğunlukla prizde" ayarı varsa açın.' }
}

// Kabuğun bakacağı aday yollar (kalıplar kabukta genişler)
const PIL_ADAYLARI = ['/sys/class/power_supply/BAT*/charge_control_start_threshold', '/sys/class/power_supply/BAT*/charge_control_end_threshold', ...URETICI.map((u) => u[0])]

// /etc/havenfold/dugum.toml (§5): rol, kanal, pil eşikleri, bakım penceresi; sır içermez
function dugumToml ({ rol = 'isci', kanal = 'kararli', pil = null }) {
  if (!['isci', 'kutu', 'birlesik'].includes(rol) || !['kararli', 'deneme'].includes(kanal)) throw new Error('INVALID_SETTINGS')
  return `# /etc/havenfold/dugum.toml — RFC-0007 §5: rol, kanal, pil eşikleri, bakım penceresi. Sır içermez.
rol = "${rol}"            # isci | kutu | birlesik
kanal = "${kanal}"       # kararli | deneme (değişiklik ebeveyn onayıyla, §12.3)

[pil]
sinir = "${pil ? pil.limit : 'yok'}"
baslangic = ${BASLANGIC}
bitis = ${BITIS}

[bakim]
# Yerel saatle 03:00 + 20 × (sıra mod 6) dakika (§12.7); sıra defterden hesaplanır
saat = "03:00"
`
}

module.exports = { LOGIND, UYKU_HEDEFLERI, GRUB, UNATTENDED, SYSCTL, nftKurallari, pilPlani, PIL_ADAYLARI, URETICI, dugumToml, BASLANGIC, BITIS }
