// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Silme oturumu için sahte sistem: diskler bellekteki tamponlardır, komutlar taklit edilir. Hiçbir gerçek komut ve
// aygıt kullanılmaz. Her disk için davranış seçilebilir (NVMe yeteneği, SSD donmuş mu, yazmayı yok sayan bozuk disk …).
const b4a = require('b4a')
const sodium = require('sodium-native')
const O = require('./examples')

function belirlenimciRastgele (tohum) {
  let sayac = 0
  return (n) => {
    const out = b4a.alloc(n)
    const t = b4a.alloc(32)
    sodium.crypto_generichash(t, b4a.from(tohum + ':' + sayac++))
    // 32 baytlık tohumdan akış: xchacha20 anahtarı olarak
    sodium.crypto_stream_xchacha20(out, b4a.alloc(24), t)
    return out
  }
}

function sahteSistem ({
  lsblk = O.LSBLK,
  nvme = O.NVME_BLOK,
  ssd = O.SSD_DONMUS_I,
  ssdSonra = null, // uyku döngüsünden sonraki hdparm -I (verilmezse aynı)
  hdd = O.HDD_I,
  hpa = [1536, 2048],
  dco = O.DCO_YOK,
  realloc = 0,
  bozuk = [], // yazmayı yok sayan diskler
  sanitizeBasarisiz = false,
  cevaplar = ['E', 'SIL', '1'], // sırayla: harici disk sorusu (sdd), onay, son seçim
  esp = {}, // bölüm yolu → bilet baytları
  dmi = { product_serial: 'PF2ABCDE', sys_vendor: 'LENOVO', product_name: '20KH002JTX' }
} = {}) {
  const diskler = new Map()
  const bolumler = new Map() // bölüm yolu → [disk yolu, ofset]
  for (const d of lsblk.blockdevices) {
    if (d.type !== 'disk') continue
    const b = b4a.alloc(d.size)
    for (let i = 0; i < b.byteLength; i++) b[i] = (i * 7 + d.name.length) & 0xff // eski veri (sıfır değil)
    diskler.set(d.path, b)
    let o = 0
    for (const p of d.children || []) { bolumler.set(p.path, [d.path, o, p.size]); o += p.size }
  }
  const kayit = []
  const kirli = []
  const ekran = []
  const qrlar = []
  const cevap = [...cevaplar]
  let simdi = 1761300000000
  let sanitizeYoklama = 0
  let ssdUyku = false
  let hpaAcik = true
  let ssdKilitli = false
  const rastgele = belirlenimciRastgele('sahte-sistem')
  const tampon = (yol) => {
    if (diskler.has(yol)) return [diskler.get(yol), 0]
    if (bolumler.has(yol)) { const [d, o] = bolumler.get(yol); return [diskler.get(d), o] }
    throw new Error('AYGIT_YOK ' + yol)
  }
  const tamam = (stdout = '') => ({ status: 0, stdout: typeof stdout === 'string' ? stdout : JSON.stringify(stdout), stderr: '' })
  const hata = (status = 1) => ({ status, stdout: '', stderr: 'hata' })

  async function calistir (argv) {
    kayit.push(argv)
    simdi += 1000
    const [k, ...a] = argv
    const yol = a[a.length - 1]
    if (k === 'lsblk') return tamam(lsblk)
    if (k === 'nvme' && a[0] === 'id-ctrl') return tamam(nvme)
    if (k === 'nvme' && a[0] === 'sanitize') {
      const d = diskler.get(a[1] + 'n1')
      if (!sanitizeBasarisiz) d.fill(0)
      return tamam()
    }
    if (k === 'nvme' && a[0] === 'sanitize-log') {
      sanitizeYoklama++
      return tamam(sanitizeYoklama === 1 ? O.sanitizeLog(0x0002, 32768) : O.sanitizeLog(sanitizeBasarisiz ? 0x0003 : 0x0101, 65535))
    }
    if (k === 'nvme' && a[0] === 'format') { diskler.get(a[1]).fill(0); return tamam() }
    if (k === 'hdparm' && a[0] === '-I') {
      if (yol === '/dev/sda') return tamam(hdd)
      if (yol === '/dev/sdb') return tamam(ssdUyku && ssdSonra ? ssdSonra : ssdKilitli ? O.SSD_GUVENLIK_SONRA_I : ssd)
      return hata()
    }
    if (k === 'hdparm' && a[0] === '-N') return tamam(O.hpaN(hpaAcik ? hpa[0] : hpa[1], hpa[1]))
    if (k === 'hdparm' && a.includes('-N')) { hpaAcik = false; return tamam() }
    if (k === 'hdparm' && a[0] === '--dco-identify') return tamam(dco)
    if (k === 'hdparm' && a.includes('--sanitize-block-erase')) { diskler.get(yol).fill(0); return tamam() }
    if (k === 'hdparm' && a[0] === '--sanitize-status') return tamam(O.SANITIZE_TAMAM)
    if (k === 'hdparm' && a.includes('--security-set-pass')) { ssdKilitli = true; return tamam() }
    if (k === 'hdparm' && (a.includes('--security-erase-enhanced') || a.includes('--security-erase'))) { diskler.get(yol).fill(0); return tamam() }
    if (k === 'smartctl') return { status: 4, stdout: JSON.stringify(O.smart(realloc)), stderr: '' }
    if (k === 'cryptsetup' && a[0] === 'isLuks') return yol === '/dev/nvme0n1p3' ? tamam() : hata()
    if (k === 'cryptsetup' && a[0] === 'erase') return tamam()
    if (k === 'rtcwake') { ssdUyku = true; return tamam() }
    if (k === 'mmc' && a[0] === 'sanitize') return hata()
    return hata(127)
  }

  return {
    kayit,
    ekran,
    qrlar,
    diskler,
    sistem: {
      calistir,
      dosyaOku: async (yol) => { const ad = yol.split('/').pop(); return dmi[ad] !== undefined ? b4a.from(dmi[ad] + '\n') : null },
      espOku: async (bolum) => esp[bolum] || null,
      boyut: async (yol) => (bolumler.has(yol) ? bolumler.get(yol)[2] : tampon(yol)[0].byteLength),
      // Sayfa önbelleği: yazılanlar önce kirli kalır, aynı aygıttan okunurken görünür, diske ancak boşaltmada iner
      // (çekirdeğin geri yazması bütün aygıtları kapsar). Diske donanım silmesinden sonra inen kirli sayfa silineni
      // yeniden yazar: sanal makinede NVMe Format'tan sonra LUKS başlığının rastgele baytları böyle geri geldi.
      blokOku: async (yol, ofset, n) => {
        const [b, o] = tampon(yol)
        const out = b4a.from(b.subarray(o + ofset, o + ofset + n))
        for (const [y, of, buf] of kirli) {
          if (y !== yol) continue
          const bas = Math.max(of, ofset)
          const son = Math.min(of + buf.byteLength, ofset + n)
          if (bas < son) buf.copy(out, bas - ofset, bas - of, son - of)
        }
        return out
      },
      blokYaz: async (yol, ofset, buf) => {
        if (bozuk.includes(yol)) return
        tampon(yol)
        kirli.push([yol, ofset, b4a.from(buf)])
      },
      onbellekBosalt: async () => {
        for (const [y, of, buf] of kirli.splice(0)) { const [b, o] = tampon(y); b.set(buf, o + of) }
      },
      bekle: async (ms) => { simdi += ms },
      simdi: () => simdi,
      rastgeleBayt: rastgele,
      yaz: (s) => ekran.push(s),
      sor: async (s) => { ekran.push(s); return cevap.length ? cevap.shift() : '' },
      qrGoster: async (m, baslik) => { qrlar.push({ metinler: m, baslik }) }
    }
  }
}

module.exports = { sahteSistem, belirlenimciRastgele }
