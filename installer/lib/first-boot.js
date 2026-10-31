// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// lib/first-boot.js — ilk açılışın saf kısmı (RFC-0007 §9): Wi-Fi netplan dosyası, yönetici parolası kuralı, durum
// özeti ve uyarılar, rol seçimi. Bağımlılıksız; kabuk (target/hf-ilk-acilis) çağırır.

function fail (code) { throw new Error(code) }

// §9 adım 2: Wi-Fi parolası USB'de hiç olmaz; yerelde sorulur, netplan dosyasına 0600 yazılır. Dizgeler JSON
// biçiminde (YAML çift tırnaklı dizge): SSID ya da paroladaki tırnak ve ters bölü kaçış hatası yapmaz.
function netplanWifi ({ arayuz, ssid, parola }) {
  if (!/^[a-z0-9]{1,15}$/.test(String(arayuz || ''))) fail('INVALID_INTERFACE')
  const s = String(ssid || '')
  if (!s || Buffer.byteLength(s) > 32) fail('INVALID_SSID')
  const p = String(parola || '')
  if (p && (p.length < 8 || p.length > 63)) fail('INVALID_PASSWORD') // WPA2/WPA3 kişisel
  const ag = p ? `{ password: ${JSON.stringify(p)} }` : '{}'
  return `# /etc/netplan/90-havenfold-wifi.yaml — RFC-0007 §9 adım 2 (0600; parola yalnız bu dosyada)
network:
  version: 2
  wifis:
    ${arayuz}:
      dhcp4: true
      dhcp6: true
      optional: true
      access-points:
        ${JSON.stringify(s)}: ${ag}
`
}

// §9 adım 4: en az 12 karakter
function parolaDenetle (p) {
  if (typeof p !== 'string' || [...p].length < 12) return 'Parola en az 12 karakter olmalı.'
  if (/[\n\r:]/.test(p)) return 'Parola satır sonu ya da ":" içeremez.'
  return null
}

// §9 adım 5. g: { ramBayt, cekirdek, disk: { model, boyut }, tpm: 'yok'|'var'|'muhur-ok', sifreleme: 'luks-tpm'|'luks'|'sifresiz',
// pil: null | { yuzde, limit }, ag: 'kablolu'|'wifi'|'yok' }
function durumOzeti (g) {
  const GB = (n) => Math.round(n / 1024 ** 3)
  const satirlar = [
    `Bellek: ${GB(g.ramBayt)} GB · Çekirdek: ${g.cekirdek || '—'}`,
    `Disk: ${g.disk ? `${g.disk.model || '—'} (${Math.round(g.disk.boyut / 1e9)} GB)` : '—'}`,
    `TPM: ${g.tpm === 'yok' ? 'yok' : 'var'} · Disk şifreleme: ${g.sifreleme === 'luks-tpm' ? 'açık (TPM ile)' : g.sifreleme === 'luks' ? 'açık (TPM bağı yok: açılışta kurtarma anahtarı)' : 'yok'}`,
    `Pil: ${g.pil ? `%${g.pil.yuzde} · sınır: ${g.pil.limit === 'yok' ? 'yok' : g.pil.limit}` : 'yok'}`,
    `Ağ: ${g.ag === 'kablolu' ? 'kablolu' : g.ag === 'wifi' ? 'Wi-Fi' : 'bağlı değil'}`
  ]
  const uyarilar = []
  if (g.tpm === 'yok') uyarilar.push('TPM yok: disk şifrelenmedi, bu cihaz kasa payı tutmayacak.')
  if (g.ag === 'wifi') uyarilar.push('Wi-Fi kullanılıyor: kablolu ağ daha güvenilirdir.')
  if (g.pil && g.pil.limit === 'yok') uyarilar.push('Pil sınırı yok. BIOS\'ta pil koruma ya da "çoğunlukla prizde" ayarı varsa açın.')
  uyarilar.push('Öneri: BIOS\'ta "elektrik gelince aç" (AC power recovery) ayarını açın.')
  return { satirlar, uyarilar }
}

// §9 adım 6: boş giriş varsayılan (işçi)
function rolSec (giris) {
  const g = String(giris || '').trim().toLowerCase()
  if (!g || g === '1' || g === 'isci' || g === 'işçi') return 'isci'
  if (g === '2' || g === 'kutu') return 'kutu'
  if (g === '3' || g === 'birlesik' || g === 'birleşik') return 'birlesik'
  return null
}

module.exports = { netplanWifi, parolaDenetle, durumOzeti, rolSec }
