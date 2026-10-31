// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// lib/preflight.js — kurulum öncesi ön kontrol kararları (RFC-0007 §8.4)
//
// Saf ve bağımlılıksız: kurulum ortamında USB'deki Node ile çalışır. Girdi `hf-on-kontrol`'ün topladığı gerçeklerdir
// (/proc/cpuinfo, /proc/meminfo, lsblk -J, pil ve TPM sysfs dosyaları); çıktı karar ve ekran metinleridir.
const K = require('../erase/discovery')

const GiB = 1024 ** 3
// MemTotal, çekirdeğin ayırdığı bellek yüzünden fiziksel RAM'den küçüktür: 4 GB'lık makine ~3,7 GiB gösterir
const RAM_EN_AZ = 3.5 * GiB
const RAM_RAHAT = 7 * GiB
const DISK_EN_AZ = 64e9
// x86-64-v2: CMPXCHG16B, LAHF-SAHF, POPCNT, SSE3, SSE4.1, SSE4.2, SSSE3
const V2 = ['lm', 'cx16', 'lahf_lm', 'popcnt', 'pni', 'sse4_1', 'sse4_2', 'ssse3']

const MESAJ = {
  islemci: 'Bu işlemci desteklenmiyor.',
  ram: 'Bu bilgisayarın belleği yetersiz (en az 4 GB gerekir).',
  ramHafif: 'Bellek 8 GB\'tan az: işçi hafif çalışır.',
  disk: 'En az 64 GB\'lık bir iç disk bulunamadı.',
  pilSoru: 'Kasada kabarma, touchpad\'in yükselmesi, kapağın tam kapanmaması var mı? (E/H)',
  pilSismis: 'Şişmiş pilli cihaz eklenmez. Pili çıkarın ya da cihazı kullanmayın.',
  onay: 'Bu disk tamamen silinecek. Devam etmek için SIL yazın.',
  tpmYok: 'Disk şifrelenmeyecek. Bu cihaz kasa payı tutmayacak. Çalınırsa kimliği ve emanet üst bilgisi açığa çıkar; içerik çıkmaz.',
  tpmOnay: 'Devam etmek için TAMAM yazın.',
  digerDiskler: 'Diğer diskler kurulumda dokunulmadan kalır.',
  kapanis: 'Kurulum durdu. Bilgisayar 60 saniye sonra kapanacak.'
}

function islemciUygun (cpuinfo) {
  const satir = String(cpuinfo || '').split('\n').find((x) => /^flags\s*:/.test(x))
  if (!satir) return false
  const f = new Set(satir.replace(/^flags\s*:/, '').trim().split(/\s+/))
  return V2.every((x) => f.has(x))
}

function ramBayt (meminfo) {
  const m = /^MemTotal:\s+([0-9]+)\s+kB/m.exec(String(meminfo || ''))
  return m ? Number(m[1]) * 1024 : 0
}

// Hedef disk adayları: USB ve çıkarılabilir diskler hariç, en az 64 GB. Kurulum USB'si ve loop/zram zaten dışlanır.
function adaylar (lsblk) {
  return K.diskleriBul(lsblk).filter((d) => d.veriYolu !== 'usb' && !d.cikarilabilir && d.boyut >= DISK_EN_AZ)
}

// Tek iç disk varsa o; birden çoksa NVMe, sonra SSD, sonra en büyük
function hedefSec (liste) {
  const puan = (d) => (d.veriYolu === 'nvme' ? 2 : !d.donen ? 1 : 0)
  return [...liste].sort((a, b) => puan(b) - puan(a) || b.boyut - a.boyut)[0] || null
}

const diskEtiketi = (d) => `${d.model || 'Bilinmeyen disk'} · ${K.boyutMetni(d.boyut)} · seri …${(d.seri || '????').slice(-4)}`

// g: { cpuinfo, meminfo, lsblk, pil: bool, tpmSurum: string|null }
// Dönüş: { durdur: mesaj | null, uyarilar, hedef, digerleri, pil, tpm, ram }
function karar (g) {
  const sonuc = { durdur: null, uyarilar: [], hedef: null, digerleri: [], pil: !!g.pil, tpm: String(g.tpmSurum || '').trim() === '2', ram: ramBayt(g.meminfo) }
  if (!islemciUygun(g.cpuinfo)) return { ...sonuc, durdur: MESAJ.islemci }
  if (sonuc.ram < RAM_EN_AZ) return { ...sonuc, durdur: MESAJ.ram }
  if (sonuc.ram < RAM_RAHAT) sonuc.uyarilar.push(MESAJ.ramHafif)
  const liste = adaylar(g.lsblk)
  const hedef = hedefSec(liste)
  if (!hedef) return { ...sonuc, durdur: MESAJ.disk }
  sonuc.hedef = { yol: hedef.yol, seri: hedef.seri, model: hedef.model, boyut: hedef.boyut, etiket: diskEtiketi(hedef) }
  sonuc.digerleri = K.diskleriBul(g.lsblk).filter((d) => d.yol !== hedef.yol && !d.harici).map(diskEtiketi)
  if (sonuc.digerleri.length) sonuc.uyarilar.push(MESAJ.digerDiskler)
  return sonuc
}

// Rastgele 4 onaltılık hane (hf-on-kontrol /dev/urandom'dan 2 bayt verir): ev ağında aile adı görünmez (§10)
function hostAdi (ikiBaytHex) {
  if (!/^[0-9a-f]{4}$/i.test(ikiBaytHex)) throw new Error('INVALID_HOSTNAME')
  return 'havenfold-' + ikiBaytHex.toLowerCase()
}

module.exports = { MESAJ, V2, islemciUygun, ramBayt, adaylar, hedefSec, diskEtiketi, karar, hostAdi, DISK_EN_AZ }
