// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// privilege-main.js — kök yardımcının açılışı (RFC-0007 §4.3, §6.4, §10.1; RFC-0026 b, d, g)
//
// Birimler bunu /usr/lib/havenfold/yetki/ana.js olarak çalıştırır; kod oradaki kendi kopyasından yüklenir, güncel
// sürümden (/opt/havenfold/guncel) değil (RFC-0026 b; paket düzeni node/scripts/pack.sh).
//   ana.js deneme-denetle [--acilis]  havenfold-deneme.service, havenfold-acilis.service (kök, soketsiz)
//   ana.js pil-uygula                 havenfold-pil.service: dugum.toml'daki eşikler (kök, soketsiz)
//   ana.js                            havenfold-yetki.service (havenfold-yetki.socket ile açılır, yalnız kök)
//
// Soket kipi (RFC-0033 §9 l): yetki dosya izni ve grup üyeliğiyle verilir, SO_PEERCRED yok. Soket dizini 0750
// root:havenfold-denetci, soket 0660 (privilege-socket.js): yalnız denetçi bağlanabildiği için soketten gelen istek
// 'havenfold-denetci' sayılır ve yardımcının işlem başına kuralıyla (IZIN) denetlenir. systemd'nin verdiği soket yoksa
// NO_SOCKET, çıkış 3. Son bağlantıdan 30 sn sonra kapanır (çıkış 0); systemd sonraki bağlantıda yeniden açar.
//
// Pil (RFC-0007 §10.1): yalnız 1. adım, çekirdeğin standart arayüzü (charge_control_start/end_threshold). Üreticinin
// koruma modu (2. adım) için bilinen yollar listesi henüz yok: o cihazlarda limit 'yok'.
'use strict'
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const { YetkiYardimcisi } = require('./privilege-helper')
const { yetkiSunucusu, systemdSoketi } = require('./privilege-socket')

const PIL_VARSAYILAN = { start: 60, stop: 80 } // kurucu §9.3

// dugum.toml [pil] bölümü: baslangic, bitis (tamsayı). Yoksa varsayılan.
function pilAyari (kok) {
  let s = ''
  try { s = fs.readFileSync(path.join(kok, 'etc/havenfold/dugum.toml'), 'utf8') } catch {}
  const e = { ...PIL_VARSAYILAN }
  let bolum = ''
  for (const satir of s.split('\n')) {
    const b = /^\s*\[([a-z]+)\]/.exec(satir)
    if (b) { bolum = b[1]; continue }
    const m = /^\s*(baslangic|bitis)\s*=\s*(\d+)\s*(#.*)?$/.exec(satir)
    if (bolum === 'pil' && m) e[m[1] === 'baslangic' ? 'start' : 'stop'] = Number(m[2])
  }
  return e
}

// sysfs yazıcı: her BAT* için bitiş (ve varsa başlangıç). Sürücü başlangıcın bitişten küçük olmasını ister: önce bitiş,
// tutmazsa ters sıra.
function pilYazici (kok = '/') {
  const ps = path.join(kok, 'sys/class/power_supply')
  return ({ start, stop }) => {
    let yazildi = false
    let ent = []
    try { ent = fs.readdirSync(ps).filter((x) => /^BAT\w*$/.test(x)) } catch {}
    for (const bat of ent) {
      const bas = path.join(ps, bat, 'charge_control_start_threshold')
      const bit = path.join(ps, bat, 'charge_control_end_threshold')
      if (!fs.existsSync(bit)) continue
      const sira = fs.existsSync(bas) ? [[bit, stop], [bas, start]] : [[bit, stop]]
      try {
        for (const [p, v] of sira) fs.writeFileSync(p, String(v))
      } catch {
        try { for (const [p, v] of [...sira].reverse()) fs.writeFileSync(p, String(v)) } catch { continue }
      }
      yazildi = true
    }
    return yazildi ? { limit: 'cekirdek', start, stop } : { limit: 'yok' }
  }
}

function yardimci (kok) {
  return new YetkiYardimcisi({
    kok,
    systemctl: (args) => execFileSync('systemctl', args, { stdio: 'ignore' }),
    pilYaz: pilYazici(kok)
  })
}

// HF_KOK yalnız test içindir: yardımcı kök olarak ve systemd altında çalıştığından üretimde reddedilir (test-env.js)
function kokOnEki (env = process.env) {
  require('./test-env').testOrtamiDenetle(env, { adlar: ['HF_KOK'] })
  return env.HF_KOK || '/'
}

// Dönüş: çıkış kodu (RFC-0007 §7: 0 tamam, 1 kullanım, 2 yetki yok, 3 durum uygun değil)
// ortam: soket etkinleştirmesinin değişkenleri (LISTEN_FDS, LISTEN_PID); fd: yalnız test (systemd'nin fd 3'ü yerine)
async function ana (argv = process.argv.slice(2), { kok = kokOnEki(), yaz = (s) => console.log(s), hataYaz = (s) => console.error(s), kokMu = () => typeof process.getuid === 'function' && process.getuid() === 0, ortam = process.env, fd = null, bostaMs } = {}) {
  const [islem, ...ek] = argv
  if (islem === undefined) {
    if (!kokMu()) { hataYaz('havenfold-yetki: UNAUTHORIZED: yalnız kök'); return 2 }
    const dinleyen = fd !== null ? fd : systemdSoketi(ortam)
    if (dinleyen === null) { hataYaz('havenfold-yetki: NO_SOCKET: havenfold-yetki.socket ile açılır'); return 3 }
    return new Promise((resolve) => {
      yetkiSunucusu({ y: yardimci(kok), fd: dinleyen, ...(bostaMs !== undefined ? { bostaMs } : {}), bitti: () => resolve(0) }).catch((err) => {
        hataYaz('havenfold-yetki: ' + (/^[A-Z_]+$/.test(err.message) ? err.message : 'INTERNAL_ERROR'))
        resolve(3)
      })
    })
  }
  if (!['deneme-denetle', 'pil-uygula'].includes(islem) || ek.some((x) => x !== '--acilis') || (islem === 'pil-uygula' && ek.length)) {
    hataYaz('kullanım: ana.js deneme-denetle [--acilis] | pil-uygula')
    return 1
  }
  if (!kokMu()) { hataYaz('havenfold-yetki: UNAUTHORIZED: yalnız kök'); return 2 }
  try {
    const y = yardimci(kok)
    const r = islem === 'pil-uygula'
      ? await y.isle('root', 'pil-esigi', pilAyari(kok))
      : await y.isle('root', 'deneme-denetle', { acilis: ek.includes('--acilis') })
    yaz(JSON.stringify(r))
    return 0
  } catch (err) {
    hataYaz('havenfold-yetki: ' + (/^[A-Z_]+$/.test(err.message) ? err.message : 'INTERNAL_ERROR'))
    return 3
  }
}

module.exports = { ana, pilAyari, pilYazici }
