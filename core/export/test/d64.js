// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// D64: test kapsamı — ZIP okuyucusunun ve yazıcısının bozuk ve sınır aşan girdi retleri, kabın EXPORT_MEMORY yolları,
// başlık denetimleri, akışla okuyucunun kesik, fazla ve biçimsiz parça retleri, arşivin INVALID_ARCHIVE yolları.
// ZIP baytları elle bozulur; dev tampon ayrılmaz (büyük sınırlar dışa açılan sabitle ve sahte boyla sınanır).
const test = require('brittle')
const b4a = require('b4a')
const sodium = require('sodium-native')
const K = require('..')
const Z = require('../zip')
const A = require('../archive')

const hataOf = (fn) => { try { fn(); return null } catch (err) { return err.message } }
const hataOfAsync = async (fn) => { try { await fn(); return null } catch (err) { return err.message } }
const MIB = 1024 * 1024
const HIZLI = { opslimit: 3, memlimit: 64 * MIB }
const PAROLA = 'test-parolasi-d64'
const ACIK = { urun: 'u', bicim: 'b' }

// Küçük uçlu alan okuma ve yazma (Bare'de Buffer'ın writeUInt* yöntemleri yok sayılır)
const dv = (b) => new DataView(b.buffer, b.byteOffset, b.byteLength)
const yaz16 = (b, o, x) => dv(b).setUint16(o, x, true)
const yaz32 = (b, o, x) => dv(b).setUint32(o, x, true)
const oku16 = (b, o) => dv(b).getUint16(o, true)

// Tek girdili geçerli arşiv: yerel başlık 0'da, merkezi dizin ve EOCD sonda
const AD = 'icerik.json'
const VERI = b4a.from('{"a":1}')
function tekZip () { return b4a.from(Z.zipYaz([{ ad: AD, bytes: VERI }])) }
const cdOf = (z) => z.byteLength - 22 - (46 + AD.length) // merkezi dizinin başı
const eocdOf = (z) => z.byteLength - 22

// Gerçek tampon ayırmadan büyük boy bildiren bayt dizisi (sınır denetimleri byteLength'e bakar)
class SahteBoy extends Uint8Array {
  constructor (boy) { super(0); this._boy = boy }
  get byteLength () { return this._boy }
}

test('zip: ad denetimi denetim karakterini reddeder', (t) => {
  t.absent(Z.adGecerli('a\u0001b'))
  t.absent(Z.adGecerli('a\u007fb'))
  t.ok(Z.adGecerli('a/b.txt'))
})

test('zipYaz: girdi sayısı, bayt olmayan veri ve sınır boyu reddedilir', (t) => {
  t.is(hataOf(() => Z.zipYaz(new Array(65536))), 'INVALID_ZIP', '65535 girdiden fazlası')
  t.is(hataOf(() => Z.zipYaz([{ ad: 'a', bytes: 'metin' }])), 'INVALID_ZIP', 'bayt olmayan veri')
  t.is(hataOf(() => Z.zipYaz([{ ad: 'a', bytes: new SahteBoy(Z.MAX_BOY) }])), 'ZIP_TOO_LARGE', 'ZIP64 gerektiren boy')
})

test('zipAkis: girdi sayısı, geçersiz ve sınır aşan boy, bayt olmayan parça reddedilir', async (t) => {
  const bos = { boy: 0, crc: 0, parcalar: [] }
  const z = Z.zipAkis(() => {})
  t.is(hataOf(() => z.girdi('a', { ...bos, boy: -1 })), 'ZIP_TOO_LARGE', 'eksi boy')
  t.is(hataOf(() => z.girdi('b', { ...bos, boy: 1.5 })), 'ZIP_TOO_LARGE', 'tam sayı olmayan boy')
  t.is(hataOf(() => z.girdi('c', { ...bos, boy: Z.MAX_BOY })), 'ZIP_TOO_LARGE', 'ZIP64 gerektiren boy')
  t.is(hataOf(() => Z.zipAkis(() => {}).girdi('d', { ...bos, boy: Z.MAX_BOY - 1 })), 'ZIP_TOO_LARGE', 'başlıkla 4 GiB aşan ofset')
  t.is(hataOf(() => Z.zipAkis(() => {}).girdi('e', { boy: 1, crc: 0, parcalar: ['x'] })), 'INVALID_ZIP', 'bayt olmayan parça')
  t.is(await hataOfAsync(() => Z.zipAkis(async () => {}).girdiAsync('f', { boy: 1, crc: 0, parcalar: [7] })), 'INVALID_ZIP', 'eşzamansız: bayt olmayan parça')

  const cok = Z.zipAkis(() => {})
  for (let i = 0; i < 65535; i++) cok.girdi('g' + i, bos)
  t.is(hataOf(() => cok.girdi('fazla', bos)), 'INVALID_ZIP', '65536. girdi')
})

test('zipOku: bayt olmayan girdi ve EOCD bozuklukları', (t) => {
  t.is(hataOf(() => Z.zipOku('zip')), 'INVALID_ZIP')
  t.is(hataOf(() => Z.zipOku(b4a.alloc(10))), 'INVALID_ZIP', 'EOCD için kısa')

  let z = tekZip()
  yaz16(z, eocdOf(z) + 20, 3) // yorum uzunluğu
  t.is(hataOf(() => Z.zipOku(z)), 'INVALID_ZIP', 'yorum')

  z = tekZip()
  yaz16(z, eocdOf(z) + 4, 1) // disk numarası
  t.is(hataOf(() => Z.zipOku(z)), 'INVALID_ZIP', 'çok diskli')

  z = tekZip()
  yaz32(z, eocdOf(z) + 16, Z.MAX_BOY) // merkezi dizin ofseti ZIP64 işareti
  t.is(hataOf(() => Z.zipOku(z)), 'ZIP_TOO_LARGE', 'ZIP64 ofset işareti')

  z = tekZip()
  yaz32(z, eocdOf(z) + 12, Z.MAX_BOY) // merkezi dizin boyu ZIP64 işareti
  t.is(hataOf(() => Z.zipOku(z)), 'ZIP_TOO_LARGE', 'ZIP64 boy işareti')

  z = tekZip()
  yaz32(z, eocdOf(z) + 16, cdOf(z) - 1)
  t.is(hataOf(() => Z.zipOku(z)), 'INVALID_ZIP', 'ofset + boy EOCD\'ye denk gelmiyor')

  z = tekZip()
  yaz16(z, eocdOf(z) + 8, 2); yaz16(z, eocdOf(z) + 10, 2) // iki girdi bildiriliyor, dizinde bir tane
  t.is(hataOf(() => Z.zipOku(z)), 'INVALID_ZIP', 'bildirilenden az merkezi girdi')
})

test('zipOku: dosya sınırının ötesine okuma reddedilir', (t) => {
  // Merkezi girdi EOCD'nin içine taşıyor: alanlar dosya sonunu aşar
  const eocd = (n, mBoy, mBas) => {
    const e = b4a.alloc(22)
    yaz32(e, 0, 0x06054b50); yaz16(e, 8, n); yaz16(e, 10, n); yaz32(e, 12, mBoy); yaz32(e, 16, mBas)
    return e
  }
  const imza = (uz) => { const b = b4a.alloc(uz); yaz32(b, 0, 0x02014b50); return b }
  // 6 baytlık merkezi dizin: ad uzunluğu (u16, o+28) dosyanın son baytını aşar
  t.is(hataOf(() => Z.zipOku(b4a.concat([imza(6), eocd(1, 6, 0)]))), 'INVALID_ZIP', 'u16 sınır dışı')
  // 20 baytlık merkezi dizin: yerel başlık ofseti (u32, o+42) dosya sonunu aşar
  t.is(hataOf(() => Z.zipOku(b4a.concat([imza(20), eocd(1, 20, 0)]))), 'INVALID_ZIP', 'u32 sınır dışı')
})

test('zipOku: merkezi dizin girdisi bozuklukları', (t) => {
  let z = tekZip()
  yaz16(z, cdOf(z) + 34, 1) // disk numarası
  t.is(hataOf(() => Z.zipOku(z)), 'INVALID_ZIP', 'girdide disk numarası')

  z = tekZip()
  yaz16(z, cdOf(z) + 28, 200) // ad merkezi dizinin dışına taşar
  t.is(hataOf(() => Z.zipOku(z)), 'INVALID_ZIP', 'ad uzunluğu taşıyor')

  z = tekZip()
  yaz16(z, cdOf(z) + 8, oku16(z, cdOf(z) + 8) | 1); yaz16(z, 6, oku16(z, 6) | 1)
  t.is(hataOf(() => Z.zipOku(z)), 'ZIP_ENCRYPTED', 'ZIP içi şifreleme bayrağı')

  z = tekZip()
  yaz16(z, 6, oku16(z, 6) ^ 0x0800) // yerel başlıkta UTF-8 bayrağı yok, merkezi dizinde var
  t.is(hataOf(() => Z.zipOku(z)), 'INVALID_ZIP', 'yerel bayrak merkezi dizinle farklı')

  z = tekZip()
  yaz32(z, 14, 0x12345678) // yerel CRC
  t.is(hataOf(() => Z.zipOku(z)), 'INVALID_ZIP', 'yerel CRC merkezi dizinle farklı')

  z = tekZip()
  yaz16(z, 28, 100) // yerel ek alan veriyi merkezi dizinin içine kaydırır
  t.is(hataOf(() => Z.zipOku(z)), 'INVALID_ZIP', 'veri merkezi dizine taşıyor')

  // Merkezi dizin ile EOCD arasında artık bayt
  z = tekZip()
  const cd = cdOf(z)
  const artik = b4a.concat([z.subarray(0, eocdOf(z)), b4a.alloc(5), z.subarray(eocdOf(z))])
  yaz32(artik, artik.byteLength - 22 + 12, z.byteLength - 22 - cd + 5)
  t.is(hataOf(() => Z.zipOku(artik)), 'INVALID_ZIP', 'merkezi dizinden sonra artık bayt')
  t.alike(Z.zipOku(tekZip())[0].bytes, VERI, 'bozulmamış arşiv açılır')
})

test('kap: anahtar türetimi libsodium hata verince EXPORT_MEMORY (eşzamanlı ve eşzamansız)', async (t) => {
  const salt = b4a.alloc(16, 7)
  t.is(hataOf(() => K.anahtarTuret(PAROLA, salt, 0, 64 * MIB)), 'EXPORT_MEMORY', 'opslimit 0')
  t.is(await hataOfAsync(() => K.anahtarTuretAsync(PAROLA, salt, 0, 64 * MIB)), 'EXPORT_MEMORY', 'eşzamansız: opslimit 0')
  t.is(await hataOfAsync(() => K.anahtarTuretAsync(PAROLA, b4a.alloc(3), 3, 64 * MIB)), 'EXPORT_MEMORY', 'eşzamansız: kısa salt')
})

// Başlığı (uzunluk alanıyla) verilen baytlarla değiştirir; gövde aynı kalır
function baslikBayt (kap, hb) {
  const { govde } = K.baslikOku(kap)
  const uz = b4a.alloc(4)
  new DataView(uz.buffer, uz.byteOffset).setUint32(0, hb.byteLength)
  return b4a.concat([K.SIHIR, b4a.from([K.SURUM]), uz, hb, govde])
}
const baslikJson = (kap, f) => baslikBayt(kap, b4a.from(JSON.stringify(f({ ...K.baslikOku(kap).baslik }))))

test('kap: başlık denetimleri (JSON, nesne, salt biçimi, ürün alanları, boy)', (t) => {
  const kap = K.kapla(b4a.from('icerik'), PAROLA, { ...ACIK, ...HIZLI })
  t.is(hataOf(() => K.baslikOku(baslikBayt(kap, b4a.from('{bozuk')))), 'INVALID_EXPORT', 'JSON değil')
  t.is(hataOf(() => K.baslikOku(baslikBayt(kap, b4a.from('null')))), 'INVALID_EXPORT', 'nesne değil')
  t.is(hataOf(() => K.baslikOku(baslikJson(kap, (h) => ({ ...h, salt: 'kisa' })))), 'INVALID_EXPORT', 'salt biçimi')
  t.is(hataOf(() => K.baslikOku(baslikJson(kap, (h) => ({ ...h, salt: 7 })))), 'INVALID_EXPORT', 'salt metin değil')
  // Kanonik olmayan base64: son karakterin artık bitleri sıfır değil
  t.is(hataOf(() => K.baslikOku(baslikJson(kap, (h) => ({ ...h, salt: 'AAAAAAAAAAAAAAAAAAAAAB==' })))), 'INVALID_EXPORT', 'kanonik olmayan salt')
  t.is(hataOf(() => K.baslikOku(baslikJson(kap, (h) => ({ ...h, bicimSurum: '1' })))), 'INVALID_EXPORT', 'bicimSurum sayı değil')
  t.is(hataOf(() => K.kapla(b4a.from('x'), PAROLA, { bicim: 'b', ...HIZLI })), 'INVALID_EXPORT', 'urun yok')
  t.is(hataOf(() => K.kapla(b4a.from('x'), PAROLA, { urun: 'u'.repeat(5000), bicim: 'b', ...HIZLI })), 'INVALID_EXPORT', 'başlık 4096 baytı aşıyor')
})

test('kap: bayt olmayan içerik ve sınırı aşan boy reddedilir', async (t) => {
  t.is(await hataOfAsync(() => K.kaplaAsync('metin', PAROLA, { ...ACIK, ...HIZLI })), 'INVALID_EXPORT', 'eşzamansız: bayt değil')
  const y = K.kapYazici(PAROLA, { ...ACIK, ...HIZLI })
  t.is(hataOf(() => y.yaz('metin')), 'INVALID_EXPORT', 'yazıcıya bayt olmayan parça')
  y.iptal()
  t.is(hataOf(() => K.kapla(new SahteBoy(K.MAX_KAP + 1), PAROLA, { ...ACIK, ...HIZLI })), 'ZIP_TOO_LARGE', '2 GiB üstü içerik')
})

test('kap: akış başı geçersizse okuyucu kurulmaz', (t) => {
  const key = b4a.alloc(32, 1)
  t.is(hataOf(() => new K.KapOkuyucu(key, {}, b4a.alloc(0), b4a.alloc(3))), 'INVALID_EXPORT')
  t.alike(key, b4a.alloc(32), 'anahtar sıfırlandı')
})

// Elle akış: bir MESSAGE parçası (kısa), son parça yok — biçim kuralına aykırı
function kisaMesajKabi () {
  const y = K.kapYazici(PAROLA, { ...ACIK, ...HIZLI })
  return b4a.concat([y.baslangic(), y._it(b4a.from('kisa'), sodium.crypto_secretstream_xchacha20poly1305_TAG_MESSAGE)])
}

test('kap: tam olmayan MESSAGE parçası INVALID_EXPORT (bütün ve akışla açma)', (t) => {
  const kap = kisaMesajKabi()
  t.is(hataOf(() => K.ac(kap, PAROLA)), 'INVALID_EXPORT', 'ac')
  const { okuyucu, kalan } = K.kapOkuyucu(kap, PAROLA)
  t.alike(okuyucu.besle(kalan), [])
  t.is(hataOf(() => okuyucu.bitir()), 'INVALID_EXPORT', 'akışla okuyucu')
})

test('kap: kesik, fazla ve bozuk akış (akışla okuyucu ve ac)', (t) => {
  // Tam 64 KiB içerik: tek parça, TAG_FINAL ile ve tam boy
  const kap = K.kapla(b4a.alloc(K.CHUNK, 5), PAROLA, { ...ACIK, ...HIZLI })
  const bas = K.baslikOku(kap)
  const ilkBoy = bas.on.byteLength + K.HEADERBYTES

  // Son parçadan sonra tam boy parça: EXPORT_EXCESS
  const fazla = b4a.concat([kap, b4a.alloc(K.CHUNK + K.ABYTES)])
  const o1 = K.kapOkuyucu(fazla, PAROLA)
  t.is(hataOf(() => o1.okuyucu.besle(o1.kalan)), 'EXPORT_EXCESS', 'akış: son parçadan sonra bayt')

  // Akış başından sonra ABYTES'tan kısa artık: EXPORT_TRUNCATED
  const kesik = b4a.concat([kap.subarray(0, ilkBoy), b4a.alloc(5)])
  const o2 = K.kapOkuyucu(kesik, PAROLA)
  t.alike(o2.okuyucu.besle(o2.kalan), [])
  t.is(hataOf(() => o2.okuyucu.bitir()), 'EXPORT_TRUNCATED', 'akış: kısa son parça')
  t.is(hataOf(() => K.ac(kesik, PAROLA)), 'EXPORT_TRUNCATED', 'ac: kısa son parça')

  // İlk parçanın bir baytı değişmiş: EXPORT_UNVERIFIED
  const bozuk = b4a.from(kap)
  bozuk[ilkBoy + 3] ^= 1
  const o3 = K.kapOkuyucu(bozuk, PAROLA)
  t.is(hataOf(() => o3.okuyucu.besle(o3.kalan)), 'EXPORT_UNVERIFIED', 'akış: ilk parça doğrulanmadı')

  // İki parçalı kapta ikinci parçanın bir baytı değişmiş: EXPORT_CORRUPT
  const iki = K.kapla(b4a.alloc(K.CHUNK + 1, 6), PAROLA, { ...ACIK, ...HIZLI })
  const bozuk2 = b4a.from(iki)
  bozuk2[bozuk2.byteLength - 1] ^= 1
  const o4 = K.kapOkuyucu(bozuk2, PAROLA)
  t.is(o4.okuyucu.besle(o4.kalan).length, 1, 'ilk parça açıldı')
  t.is(hataOf(() => o4.okuyucu.bitir()), 'EXPORT_CORRUPT', 'akış: sonraki parça doğrulanmadı')
})

test('kap: akışla okuyucuda telefon sınırı', (t) => {
  const kap = K.kapla(b4a.from('telefon'), PAROLA, { ...ACIK, ...HIZLI })
  const { okuyucu, kalan } = K.kapOkuyucu(kap, PAROLA, { telefon: true })
  t.alike(b4a.concat([...okuyucu.besle(kalan), ...okuyucu.bitir()]), b4a.from('telefon'), 'sınır içinde açılır')
  const agir = baslikJson(kap, (h) => ({ ...h, opslimit: K.TELEFON_OPS + 1 }))
  t.is(hataOf(() => K.kapOkuyucu(agir, PAROLA, { telefon: true })), 'EXPORT_MEMORY', 'opslimit telefon sınırının üstünde')
})

test('arşiv: kayıt dışa aktarımında varsayılan uzantı, çevrilemeyen başvuru, boş kaynak, geçersiz değer', (t) => {
  const blobId = b4a.alloc(32, 0xab)
  const f = A.kayitDisa({
    ek: { blobId, size: 3, mime: 'application/x-bilinmez' },
    not: 'bkz. kayit:' + '12'.repeat(16),
    _src: null
  }, { basvuruMetni: () => null })
  t.alike(f.alanlar, {
    ek: { dosya: 'dosyalar/' + 'ab'.repeat(32) + '.bin', mime: 'application/x-bilinmez', boyut: 3 },
    not: 'bkz. [bilinmeyen]'
  })
  t.is(hataOf(() => A.kayitDisa({ x: { a: 1 } })), 'INVALID_VALUE', 'blobId taşımayan nesne')
  t.is(hataOf(() => A.kayitDisa({ x: undefined })), 'INVALID_VALUE', 'tanımsız değer')
})

test('arşiv: icerik.json JSON değilse INVALID_ARCHIVE; BENIOKU yoksa null', (t) => {
  t.is(hataOf(() => A.arsivOku(Z.zipYaz([{ ad: 'icerik.json', bytes: b4a.from('{bozuk') }]))), 'INVALID_ARCHIVE')
  const a = A.arsivOku(Z.zipYaz([{ ad: 'icerik.json', bytes: b4a.from('{"bicim":"b"}') }]))
  t.is(a.benioku, null)
  t.alike(a.icerik, { bicim: 'b' })
})

test('kap: bütünüyle açan yollarda boy sınırı Argon2\'den önce (MAX_KAP; telefonda TELEFON_KAP; Codex 12. tur)', (t) => {
  const govde = (duz) => ({ byteLength: K.HEADERBYTES + duz + Math.ceil(duz / K.CHUNK) * K.ABYTES })
  t.execution(() => K.boyDenetle(govde(K.MAX_KAP)), 'tam 2 GiB düz metin geçer')
  t.is(hataOf(() => K.boyDenetle(govde(K.MAX_KAP + K.CHUNK))), 'ZIP_TOO_LARGE')
  t.execution(() => K.boyDenetle(govde(512 * 1024 * 1024), K.TELEFON_KAP), 'telefonda 512 MiB arşiv geçer')
  t.is(hataOf(() => K.boyDenetle(govde(1536 * 1024 * 1024), K.TELEFON_KAP)), 'ZIP_TOO_LARGE', 'telefonda 1,5 GiB açılmadan reddedilir')
  t.ok(K.TELEFON_KAP < K.MAX_KAP)
})

test('arşiv: icerik.json nesne değilse INVALID_ARCHIVE (null, dizi, sayı; iceAl ve iceAlAsync TypeError vermez; Codex 12. tur)', async (t) => {
  for (const x of ['null', '[]', '7', '"metin"']) {
    t.is(hataOf(() => A.arsivOku(Z.zipYaz([{ ad: 'icerik.json', bytes: b4a.from(x) }]))), 'INVALID_ARCHIVE', 'arsivOku ' + x)
  }
  const kap = K.kapla(Z.zipYaz([{ ad: 'icerik.json', bytes: b4a.from('null') }]), PAROLA, { ...ACIK, ...HIZLI })
  t.is(hataOf(() => A.iceAl(kap, PAROLA)), 'INVALID_ARCHIVE', 'iceAl')
  t.is(await hataOfAsync(() => A.iceAlAsync(kap, PAROLA, { telefon: false })), 'INVALID_ARCHIVE', 'iceAlAsync')
})

test('arşiv: başlıktaki biçimle arşivdeki biçim farklıysa INVALID_ARCHIVE (iceAl, iceAlAsync)', async (t) => {
  const zip = A.arsivYaz({ bicim: 'baska', icerik: {} })
  const kap = K.kapla(zip, PAROLA, { ...ACIK, ...HIZLI })
  t.is(hataOf(() => A.iceAl(kap, PAROLA)), 'INVALID_ARCHIVE', 'iceAl')
  t.is(await hataOfAsync(() => A.iceAlAsync(kap, PAROLA, { telefon: false })), 'INVALID_ARCHIVE', 'iceAlAsync telefon dışı')
  const dogru = K.kapla(A.arsivYaz({ bicim: 'b', icerik: { x: 1 } }), PAROLA, { ...ACIK, ...HIZLI })
  t.is((await A.iceAlAsync(dogru, PAROLA, { telefon: false })).icerik.x, 1, 'telefon dışı açılır')
})

test('arşiv: akışla dışa aktarmada geçersiz çağrı ve beklenmeyen dosya hatası', async (t) => {
  t.is(await hataOfAsync(() => A.disaAktarAkis({ parola: PAROLA, ...ACIK, icerikParcalari: () => [], yaz: null })), 'INVALID_ARCHIVE', 'yaz işlev değil')
  t.is(await hataOfAsync(() => A.disaAktarAkis({ parola: PAROLA, ...ACIK, icerikParcalari: null, yaz: () => {} })), 'INVALID_ARCHIVE', 'icerikParcalari işlev değil')
  let yazilan = 0
  const hata = await hataOfAsync(() => A.disaAktarAkis({
    parola: PAROLA,
    ...ACIK,
    kdf: HIZLI,
    icerikParcalari: function * () { yield b4a.from('{"bicim":"b","bicimSurum":1}') },
    dosyalar: [{ ad: 'a.txt', bytes: () => { throw new Error('DISK_ERROR') } }],
    oncesi: async () => {},
    yaz: (b) => { yazilan += b.byteLength }
  }))
  t.is(hata, 'DISK_ERROR', 'NO_FILE dışındaki hata yukarı çıkar, dosya atlanmaz')
  t.ok(yazilan > 0, 'o ana kadar yazılanlar çağıranın sorumluluğunda')
})
