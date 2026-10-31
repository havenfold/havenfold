// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// `havenfold durum`, `katil` ve `ekran` (RFC-0007 §7, §4.2, §4.3): sahte çekirdek ve denetçi soketleriyle
const test = require('brittle')
const { ana, katil, ekran, KOD } = require('../command')
const { IPC } = require('../ipc/types')

function sahte ({ kimlikler = ['isci'], toren = null } = {}) {
  const yanit = {
    denetci: { surum: '1.2.3', kanal: 'kararli', tpm: 'muhur-ok', disk: 'luks-tpm', pil: { limit: 'cekirdek', start: 60, stop: 80 }, uyarilar: ['WIFI'] },
    isci: { id: 'aabbccddeeff00112233445566778899', bagli: true, duzey: '2.2', oturum: 3, gorevler: ['hf.task.ocr'] },
    kutu: { id: '11223344556677889900aabbccddeeff', bagli: true, duzey: '2.2', oturum: 5 }
  }
  return {
    async istek (kapsam, type) {
      if (kapsam !== 'denetci' && !kimlikler.includes(kapsam)) { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e }
      return { type: IPC.DURUM_CEVAP, mesaj: { json: JSON.stringify(yanit[kapsam]) } }
    },
    akis (kapsam) {
      const m = (toren || {})[kapsam] || []
      return { async * [Symbol.asyncIterator] () { for (const x of m) yield x } }
    }
  }
}

test('durum: roller, kısa kimlik, bağlılık, görevler, sürüm, TPM, pil, uyarılar', async (t) => {
  const cikti = []
  t.is(await ana(['durum'], { baglanti: sahte({ kimlikler: ['kutu', 'isci'] }), yaz: (s) => cikti.push(s) }), KOD.TAMAM)
  t.is(cikti[0], [
    'Kutu kimliği 11223344 · topluluğa bağlı: evet · defter düzeyi 2.2 · açık oturum 5',
    'İşçi kimliği aabbccdd · topluluğa bağlı: evet · defter düzeyi 2.2 · açık oturum 3',
    'Çalışan görev: hf.task.ocr',
    'Sürüm 1.2.3 · kanal kararli',
    'TPM: muhur-ok · disk: luks-tpm',
    'Pil sınırı: 60–80 (cekirdek)',
    'Uyarılar: WIFI'
  ].join('\n'))
  const b = sahte()
  b.istek = async () => { throw Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' }) }
  t.is(await ana(['durum'], { baglanti: b, yaz: () => {} }), KOD.DURUM, 'denetçi yok')
})

test('katil: QR çizilir, resim adları yazılır; birleşik rol iki tören; kullanım hatası', async (t) => {
  const qr = (rol) => [{ type: IPC.KATIL_QR, mesaj: { qr: 'HFJ1:' + rol, resimler: ['elma', 'kedi', 'ev', 'gemi', 'yıldız'], kalanSn: 60 } }, { type: IPC.KATIL_SONUC, mesaj: { ok: true, code: '' } }]
  const cikti = []
  t.is(await ana(['katil', '--rol', 'birlesik'], { baglanti: sahte({ toren: { kutu: qr('kutu'), isci: qr('isci') } }), yaz: (s) => cikti.push(s) }), KOD.TAMAM)
  t.ok(cikti.some((s) => s.includes('█')), 'QR yarım blokla')
  t.ok(cikti.includes('Telefonda şu 5 resim görünmeli: elma · kedi · ev · gemi · yıldız'))
  t.is(cikti.filter((s) => s.endsWith('topluluğa eklendi.')).length, 2)
  t.ok(cikti.indexOf('Birleşik cihaz: önce kutu kimliği.') < cikti.indexOf('Aynı cihazın işçi kimliği.'))
  t.is(cikti[0], 'Bu cihazı ele geçiren biri kutu ve işçi kimliklerinin ikisine de ulaşabilir.', 'dürüstlük notu törenden önce')
  t.is(await ana(['katil', '--rol', 'yonetici'], { baglanti: sahte(), yaz: () => {} }), KOD.KULLANIM)
  t.is(await ana(['katil'], { baglanti: sahte({ toren: { isci: [{ type: IPC.KATIL_SONUC, mesaj: { ok: false, code: 'VERIFICATION_FAILED' } }] } }), yaz: () => {} }), KOD.VERIFICATION_FAILED)
  t.is(await ana(['bilinmeyen'], { baglanti: sahte(), yaz: () => {} }), KOD.KULLANIM)
  // Codex 12. tur: çıkış kodları sabit; tanımsız ad (ad değişikliğinde KOD.DOGRULAMA) undefined → süreç 0 ile çıkardı ve
  // hf-ilk-acilis'in `havenfold katil && break` döngüsü başarısız töreni başarı sayardı
  t.is(KOD.VERIFICATION_FAILED, 5)
  for (const v of Object.values(KOD)) t.ok(Number.isInteger(v))
  const dort = [{ type: IPC.KATIL_QR, mesaj: { qr: 'HFJ1:x', resimler: ['elma', 'kedi', 'ev', 'gemi'], kalanSn: 60 } }]
  t.is(await ana(['katil'], { baglanti: sahte({ toren: { isci: dort } }), yaz: () => {} }), KOD.VERIFICATION_FAILED, '5 resim beklenir')
})

test('katil: Linux konsolunda QR qrCiz ile çizilir (fb0), metin altından sürer; qrCiz null dönerse yarım blok; PNG her iki yolda', async (t) => {
  const akisi = () => [{ type: IPC.KATIL_QR, mesaj: { qr: 'yuva://j/2/abc', resimler: [], kalanSn: 60 } }, { type: IPC.KATIL_QR, mesaj: { qr: 'yuva://j/2/def', resimler: [], kalanSn: 60 } }, { type: IPC.KATIL_SONUC, mesaj: { ok: true, code: '' } }]
  const cizilen = []
  const png = []
  const pngYaz = (m) => { png.push(m); return '/ev/havenfold-katil.png' }
  let cikti = []
  t.is(await ana(['katil', '--rol', 'kutu'], { baglanti: sahte({ toren: { kutu: akisi() } }), yaz: (s) => cikti.push(s), pngYaz, qrCiz: (m) => { cizilen.push(m); return '\x1b[40;1H' } }), KOD.TAMAM)
  t.alike(cizilen, ['yuva://j/2/abc', 'yuva://j/2/def'], 'her yeni QR yeniden çizilir')
  t.absent(cikti.some((s) => s.includes('█') || s.includes('▀')), 'yarım blok yok')
  t.is(cikti[0], '\x1b[40;1H', 'imleç QR\'ın altına')
  t.is(cikti[1], 'QR resim olarak: /ev/havenfold-katil.png')
  t.ok(cikti.includes('Telefonda "Cihaz ekle → Aile Kutusu"yu seçip okutun.'), 'kutu rolünün yönergesi')
  t.ok(cikti.includes('QR 60 saniye geçerli.'))
  cikti = []
  t.is(await ana(['katil'], { baglanti: sahte({ toren: { isci: akisi() } }), yaz: (s) => cikti.push(s), pngYaz, qrCiz: () => null }), KOD.TAMAM)
  t.ok(cikti[0].startsWith('\x1b[2J\x1b[H') && cikti[0].includes('█'), 'konsol değil: yarım blok')
  t.ok(cikti.includes('Telefonda "Cihaz ekle → Ev Makinesi"ni seçip okutun.'))
  cikti = []
  t.is(await ana(['katil'], { baglanti: sahte({ toren: { isci: akisi() } }), yaz: (s) => cikti.push(s), qrCiz: () => { throw new Error('EIO') } }), KOD.TAMAM)
  t.ok(cikti[0].includes('█'), 'çizim hata verirse yarım blok')
  t.is(png.length, 4, 'PNG iki yolda da yazılır')
})

test('katil: çekirdek susarsa da tören süresi dolunca durur', async (t) => {
  const susan = { akis: () => ({ [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}), return: () => ({ done: true }) }) }) }
  const cikti = []
  t.is(await katil(susan, (s) => cikti.push(s), { torenMs: 20 }), KOD.DURUM)
  t.is(cikti.at(-1), 'Tören 10 dakikada tamamlanmadı. Yeniden denemek için komutu yeniden çalıştırın.')
})

test('katil (D76): kutu önce resimsiz QR verir (PNG de yazılır), telefon okutunca 5 resmin adları gelir; denetçisiz kutu durumu', async (t) => {
  const akisi = [
    { type: IPC.KATIL_QR, mesaj: { qr: 'yuva://j/2/abc', resimler: [], kalanSn: 180 } },
    { type: IPC.KATIL_QR, mesaj: { qr: '', resimler: ['Kedi', 'At', 'Ev', 'Gemi', 'Yıldız'], kalanSn: 550 } },
    { type: IPC.KATIL_SONUC, mesaj: { ok: true, code: '' } }
  ]
  const cikti = []
  const png = []
  t.is(await ana(['katil', '--rol', 'kutu'], { baglanti: sahte({ toren: { kutu: akisi } }), yaz: (s) => cikti.push(s), pngYaz: (m) => { png.push(m); return '/ev/havenfold-katil.png' } }), KOD.TAMAM)
  t.alike(png, ['yuva://j/2/abc'], 'QR PNG olarak da')
  t.ok(cikti.includes('QR resim olarak: /ev/havenfold-katil.png'))
  t.ok(cikti.includes('Telefonda şu 5 resim görünmeli: Kedi · At · Ev · Gemi · Yıldız'))
  t.ok(cikti.includes('Kutu kimliği topluluğa eklendi.'))
  t.is(await ana(['katil', '--rol', 'kutu'], { baglanti: sahte({ toren: { kutu: [{ type: IPC.KATIL_QR, mesaj: { qr: '', resimler: [], kalanSn: 1 } }] } }), yaz: () => {} }), KOD.VERIFICATION_FAILED, 'QR ve resim yoksa geçersiz')
  // Denetçisiz kutu: yalnız kutunun durumu
  const kutuDurumu = { id: 'ab'.repeat(16), bagli: true, duzey: '2.1', oturum: 2, aile: { ad: 'Rivera', uye: 3 }, tasiyici: { acik: true, dinleme: 3, oturum: 2 }, depolama: { emanet: 12, dosya: 4, pay: 1, zarf: 1 }, tpm: 'var', disk: 'sifresiz', surum: '0.0.0', kanal: 'deneme', uyarilar: ['disk şifresiz (RFC-0007 §8.6)'] }
  const yalnizKutu = { istek: async (kapsam) => { if (kapsam !== 'kutu') throw new Error('yok'); return { type: IPC.DURUM_CEVAP, mesaj: { json: JSON.stringify(kutuDurumu) } } }, akis: () => { throw new Error('yok') } }
  const d = []
  t.is(await ana(['durum'], { baglanti: yalnizKutu, yaz: (s) => d.push(s) }), KOD.TAMAM)
  const m = d.join('\n')
  for (const x of ['Kutu kimliği abababab', 'topluluğa bağlı: evet', 'TPM: var · disk: sifresiz', 'Aile: Rivera · 3 kişi · taşıyıcı: açık (3 dinleme, 2 oturum)', 'Depolama: 12 işlem emanette · 4 dosya · 1 pay · 1 kasa zarfı', 'disk şifresiz']) t.ok(m.includes(x), x)
})

test('durum (D76): denetçi soketine yetki yoksa (EACCES) ama kutuya ulaşılıyorsa kutu durumu gösterilir; hiçbirine ulaşılamazsa YETKI', async (t) => {
  const kutuDurumu = { id: 'cd'.repeat(16), bagli: false, duzey: null, oturum: 0, aile: null, tasiyici: { acik: true, dinleme: 0, oturum: 0 }, depolama: { emanet: 0, dosya: 0, pay: 0, zarf: 0 }, tpm: 'var', disk: 'sifresiz', uyarilar: [] }
  const eacces = () => { const e = new Error('EACCES'); e.code = 'EACCES'; return e }
  const b = { istek: async (kapsam) => { if (kapsam === 'denetci') throw eacces(); if (kapsam === 'kutu') return { type: IPC.DURUM_CEVAP, mesaj: { json: JSON.stringify(kutuDurumu) } }; throw new Error('ENOENT') }, akis: () => { throw new Error('yok') } }
  const d = []
  t.is(await ana(['durum'], { baglanti: b, yaz: (s) => d.push(s) }), KOD.TAMAM)
  t.ok(d.join('\n').includes('TPM: var'))
  const hepsi = { istek: async () => { throw eacces() }, akis: () => { throw new Error('yok') } }
  t.is(await ana(['durum'], { baglanti: hepsi, yaz: () => {} }), KOD.YETKI, 'hiçbirine yetki yok')
})

test('ekran (§4.3): denetçi henüz yokken düşmez, gelince durumu çizer; metin değişmedikçe yeniden çizmez', async (t) => {
  const b = sahte()
  let tur = 0
  const asil = b.istek
  b.istek = async (...a) => { if (tur === 0) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); return asil(...a) }
  const cikti = []
  const beklenen = []
  t.is(await ekran(b, (s) => cikti.push(s), { turSayisi: 3, bekle: async (ms) => { beklenen.push(ms); tur++ } }), KOD.TAMAM)
  t.alike(beklenen, [10_000, 10_000], 'turlar arası 10 saniye')
  t.is(cikti.length, 2, 'ilk tur ve denetçi gelince; üçüncü tur aynı metin, çizilmez')
  t.ok(cikti[0].startsWith('\x1b[9;1]\x1b[2J\x1b[H'), 'ilk çizimde kararma süresi 1 dakika')
  t.ok(cikti[0].includes('Denetçiye bağlanılamadı') && cikti[0].includes('Yeniden deneniyor'))
  t.ok(cikti[1].startsWith('\x1b[2J\x1b[H') && cikti[1].includes('İşçi kimliği aabbccdd'))
  t.absent(cikti[1].includes('Yeniden deneniyor'))
})

test('ekran: ana komut olarak tanınır; durum hata fırlatsa da düşmez', async (t) => {
  const b = sahte()
  b.istek = async () => { throw new Error('beklenmedik') }
  const cikti = []
  t.is(await ekran(b, (s) => cikti.push(s), { turSayisi: 1 }), KOD.TAMAM)
  t.ok(cikti[0].includes('Yeniden deneniyor'))
  const k = []
  await ana(['yok'], { baglanti: b, yaz: (s) => k.push(s) })
  t.ok(k[0].includes('screen'), 'kullanım satırında')
})

test('ekran: bağlanıp cevap vermeyen soket döngüyü durdurmaz (istek zaman aşımı)', async (t) => {
  const b = sahte()
  b.istek = () => new Promise(() => {}) // hiç cevap yok
  const cikti = []
  t.is(await ekran(b, (s) => cikti.push(s), { turSayisi: 2, istekMs: 20, bekle: async () => {} }), KOD.TAMAM)
  t.is(cikti.length, 1, 'iki tur bitti; metin aynı, bir kez çizildi')
  t.ok(cikti[0].includes('Denetçiye bağlanılamadı') && cikti[0].includes('Yeniden deneniyor'))
})

test('version: bin/havenfold gibi surumBilgisi verilmeden denetçinin durumundan sürüm ve kanal yazar; soket yoksa açıklar', async (t) => {
  for (const ad of ['version', 'surum']) {
    const cikti = []
    t.is(await ana([ad], { baglanti: sahte(), yaz: (s) => cikti.push(s) }), KOD.TAMAM, ad)
    t.alike(cikti, ['havenfold-node 1.2.3 · kanal kararli'], ad)
  }
  const yok = { async istek () { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e } }
  const cikti = []
  t.is(await ana(['version'], { baglanti: yok, yaz: (s) => cikti.push(s) }), KOD.DURUM)
  t.ok(/Sürüm bilgisi alınamadı/.test(cikti.join('\n')), 'boş çıkmaz')
  const yetkisiz = { async istek () { const e = new Error('EACCES'); e.code = 'EACCES'; throw e } }
  t.is(await ana(['version'], { baglanti: yetkisiz, yaz: () => {} }), KOD.YETKI)
})

test('join: --role ana bayrak, --rol eski ad; tanınmayan bayrak işçi töreni başlatmaz', async (t) => {
  const qr = (rol) => [{ type: IPC.KATIL_QR, mesaj: { qr: 'HFJ1:' + rol, resimler: ['elma', 'kedi', 'ev', 'gemi', 'yıldız'], kalanSn: 60 } }, { type: IPC.KATIL_SONUC, mesaj: { ok: true, code: '' } }]
  for (const bayrak of ['--role', '--rol']) {
    const cikti = []
    t.is(await ana(['join', bayrak, 'kutu'], { baglanti: sahte({ kimlikler: ['kutu'], toren: { kutu: qr('kutu') } }), yaz: (s) => cikti.push(s) }), KOD.TAMAM, bayrak)
    t.ok(cikti.some((s) => s.endsWith('topluluğa eklendi.')), bayrak)
  }
  let toren = false
  const izle = { ...sahte(), akis () { toren = true; return { async * [Symbol.asyncIterator] () {} } } }
  const cikti = []
  t.is(await ana(['join', '--rle', 'kutu'], { baglanti: izle, yaz: (s) => cikti.push(s) }), KOD.KULLANIM)
  t.absent(toren, 'tören başlamadı')
  t.ok(cikti[0].includes('join [--role isci|kutu|birlesik]'))
})

test('join: yalnız argümansız ya da geçerli iki argümanlı rol seçimi; diğer her biçim tören başlatmaz (Codex 13. tur)', async (t) => {
  const yanlislar = [
    ['--bilinmeyen'], ['kutu'], ['--role'], ['--rol'], ['--role', ''], ['--role', 'yonetici'], ['--role', '--role'],
    ['--role', 'kutu', 'fazla'], ['kutu', '--role', 'isci'], ['--role', 'kutu', '--role', 'isci'], ['--role=kutu']
  ]
  for (const arg of yanlislar) {
    let toren = false
    const izle = { ...sahte(), akis () { toren = true; return { async * [Symbol.asyncIterator] () {} } } }
    const cikti = []
    t.is(await ana(['join', ...arg], { baglanti: izle, yaz: (s) => cikti.push(s) }), KOD.KULLANIM, JSON.stringify(arg))
    t.absent(toren, 'tören başlamadı: ' + JSON.stringify(arg))
    t.ok(cikti.some((s) => s.includes('join [--role isci|kutu|birlesik]')), 'kullanım yazıldı: ' + JSON.stringify(arg))
  }
  const qr = (rol) => [{ type: IPC.KATIL_QR, mesaj: { qr: 'HFJ1:' + rol, resimler: ['elma', 'kedi', 'ev', 'gemi', 'yıldız'], kalanSn: 60 } }, { type: IPC.KATIL_SONUC, mesaj: { ok: true, code: '' } }]
  t.is(await ana(['join'], { baglanti: sahte({ toren: { isci: qr('isci') } }), yaz: () => {} }), KOD.TAMAM, 'argümansız işçi')
  t.is(await ana(['join', '--role', 'isci'], { baglanti: sahte({ toren: { isci: qr('isci') } }), yaz: () => {} }), KOD.TAMAM, 'açık işçi')
})
