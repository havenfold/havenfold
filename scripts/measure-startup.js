// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// measure-startup.js — telefondaki çekirdeğin soğuk açılışı (D57)
//
// Çalıştırma (telefondaki Bare sürümü, düşük uç profil: tek çekirdek):
//   taskset -c 0 bare scripts/measure-startup.js [--deneme 7]
// Soğuk açılış = yeni Bare süreci başlatılır → worklet yüklenir → start (kalıcı dizin açılır, durum çözülür,
// olaylar ve işlemler yeniden doğrulanır) → ilk cevap (200 FAMILY_INFO). Yuva Defteri Air A7'nin tanımı. Senaryolar:
// ailesiz (ilk açılış) ve tanıtım ailesi (D35 tohumu `ana`). Her senaryo N kez, ortanca. Ayrıca modül başına yükleme
// süresi ve yığını (her modül ayrı süreçte). Telefon paketinin boyutu kabukta ölçülür (bare-pack Node CLI'si). Ağ yok.
/* global Bare */
'use strict'
const BARE = typeof Bare !== 'undefined'
const ARGV = (BARE ? Bare.argv : process.argv).slice(2)
const simdi = () => Date.now()
const cik = (k) => (BARE ? Bare.exit(k) : process.exit(k))

// --- Ana süreç -----------------------------------------------------------------------------------------------------

// Çocuk süreç: scripts/measure-startup/<betik>.js (ayrı dosyalar: Bare düz yazılmış require'ları dosyayla birlikte yükler,
// ana betiğin modülleri çocuğun süresine girmesin)
function surec (betik, args = []) {
  const { spawn } = require('../worklet/node_modules/bare-subprocess')
  return new Promise((resolve, reject) => {
    const bas = simdi()
    const p = spawn(Bare.argv[0], [betik.startsWith('/') ? betik : __dirname + '/measure-startup/' + betik + '.js', ...args], { stdio: ['ignore', 'pipe', 'inherit'] })
    let cikti = ''
    let ilk = null
    p.stdout.on('data', (d) => { cikti += d.toString(); if (ilk === null && cikti.includes('SONUC ')) ilk = simdi() - bas })
    p.on('exit', (kod) => {
      const s = cikti.split('\n').find((x) => x.startsWith('SONUC '))
      if (kod !== 0 || !s) reject(new Error('SUREC ' + kod + ' ' + cikti.slice(-300)))
      else resolve({ duvar: ilk, ...JSON.parse(s.slice(6)) })
    })
  })
}

function calistir (args) {
  const { spawnSync } = require('../worklet/node_modules/bare-subprocess')
  const r = spawnSync(Bare.argv[0], args, { stdio: ['ignore', 'pipe', 'inherit'] })
  if (r.status !== 0) throw new Error('CALISMADI ' + args.join(' '))
  return r
}

const ortanca = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] }

async function main () {
  if (!BARE) { console.error('Bare ile çalıştırın'); cik(2) }
  const fs = require('../worklet/node_modules/bare-fs')
  const b4a = require('b4a')
  const sodium = require('sodium-native')
  const N = parseInt((ARGV[ARGV.indexOf('--deneme') + 1]) || '7', 10) || 7
  const PAKET = ARGV.includes('--paket') ? ARGV[ARGV.indexOf('--paket') + 1] : null // bare-pack ile paketlenmiş startup.js
  const kok = __dirname + '/../worklet/.gecici/acilis-' + simdi().toString(36)
  const rastgeleHex = (n) => { const b = b4a.alloc(n); sodium.randombytes_buf(b); return b4a.toString(b, 'hex') }
  const arsivSk = b4a.alloc(32); sodium.randombytes_buf(arsivSk)
  const arsivPk = b4a.alloc(32); sodium.crypto_scalarmult_base(arsivPk, arsivSk)
  const anahtar = rastgeleHex(32)
  const arsiv = b4a.toString(arsivPk, 'hex')
  const satirlar = []
  try {
    // Senaryolar: ailesiz (tohum 'yok') ve tanıtım ailesi ('ana')
    const senaryolar = []
    for (const s of ['yok', 'ana']) {
      const dizin = kok + '/' + s
      fs.mkdirSync(dizin, { recursive: true })
      calistir([__dirname + '/../worklet/scripts/seed.js', dizin, s, '--anahtar', anahtar, '--arsiv', arsiv])
      let durumBoy = 0
      try { durumBoy = fs.statSync(dizin + '/durum').size } catch {}
      senaryolar.push({ s, dizin, durumBoy })
    }
    const bos = []
    for (let i = 0; i < N; i++) bos.push((await surec('empty')).duvar)
    satirlar.push(`| Bare boş süreç (taban) | ${ortanca(bos)} ms | — | — | — | — |`)
    const betikler = [['startup', 'kaynaktan'], ...(PAKET ? [[PAKET, 'paketten']] : [])]
    for (const [betik, nasil] of betikler) for (const { s, dizin, durumBoy } of senaryolar) {
      const r = []
      for (let i = 0; i < N; i++) r.push(await surec(betik, [dizin, anahtar, arsiv]))
      const o = (k) => ortanca(r.map((x) => x[k]))
      const yukleme = o('duvar') - o('calisma') - o('start') - o('ilkCevap')
      satirlar.push(`| Soğuk açılış ${nasil}, ${s === 'ana' ? 'tanıtım ailesi (ana)' : 'ailesiz (ilk açılış)'} | **${o('duvar')} ms** (en çok ${Math.max(...r.map((x) => x.duvar))}) | ${yukleme} ms | ${o('start')} ms | ${o('ilkCevap')} ms | ${o('rssMiB')} MiB, durum ${Math.round(durumBoy / 1024)} KiB |`)
    }
    // Modül başına yükleme (ayrı süreç, soğuk)
    const moduller = ['b4a', 'sodium-native', '@havenfold/core', '@havenfold/records', '@havenfold/tasks', '@havenfold/events', '@havenfold/vault', '@havenfold/export', '@havenfold/ai', '@havenfold/sdk', '../worklet/persistence', '../worklet/synchronizer', '../worklet', '../worklet/example/product', '@havenfold/transport', '../worklet/node_modules/hyperdht']
    const modSatir = []
    for (const m of moduller) {
      const yol = m.startsWith('@havenfold/') ? '../worklet/node_modules/' + m : m
      const r = []
      for (let i = 0; i < 3; i++) r.push(await surec('module', [yol.startsWith('.') ? __dirname + '/' + yol : yol]))
      modSatir.push(`| \`${m.replace('../worklet/node_modules/', '').replace('../', '')}\` | ${ortanca(r.map((x) => x.ms))} ms | ${ortanca(r.map((x) => x.yiginKiB))} KiB |`)
    }
    console.log(`Çalışma ortamı: Bare ${Bare.version}, ${N} deneme, ortanca`)
    console.log('')
    console.log('| Ölçü | Duvar saati (süreç → ilk cevap) | Modül yükleme ve süreç | start | İlk cevap (200) | Bellek |')
    console.log('|------|---------------------------------|---------------|--------|-----------------|--------|')
    for (const s of satirlar) console.log(s)
    console.log('')
    console.log('| Modül (ayrı süreçte ilk require) | Süre | Yığın |')
    console.log('|----------------------------------|------|-------|')
    for (const s of modSatir) console.log(s)
  } finally {
    try { fs.rmSync(kok, { recursive: true, force: true }) } catch {}
  }
  cik(0)
}

main().catch((err) => { console.error('HATA', err.stack || err.message); cik(1) })
