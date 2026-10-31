// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// D41 (1fac72e) bağımsız saldırı testleri: ExportApi.export({ yaz }) ve arsiv.disaAktarAkis.
// Her test DOĞRU davranışı sınar; "not ok" bulgunun doğrulanmasıdır. Koşturma: node d41-saldiri.js | bare d41-saldiri.js
'use strict'
const W = __dirname + '/../..' // D44: depo kökü (kaynak: kollar/D-inceleme-15-testler/d41-saldiri.js)
const NM = '' // paket adları bulunduğu paketten çözülür
const test = require(NM + 'brittle')
const b4a = require(NM + 'b4a')
const S = require(NM + '@havenfold/sdk')
const { arsiv: AR } = require(NM + '@havenfold/export')
const A = require(W + '/core/records/test/helpers/family.js')

const hex = (b) => b4a.toString(b, 'hex')
const hataOfA = async (fn) => { try { await fn(); return null } catch (err) { return err.message } }
const KASA = hex(A.K_KASA)
const TA = hex(A.K_TUM_AILE)
const HIZLI = { opslimit: 3, memlimit: 64 * 1024 * 1024 }
const PAROLA = 'yirmi-dort-karakterli-p'

function kur () {
  const L = A.anaDefter()
  const saat = { t: A.TS0 + 3_600_000 }
  const kasa = new S.VaultApi({ ledger: L, me: A.K.husniye, now: () => saat.t, anahtarDogrula: (h) => h === 'ab'.repeat(32) })
  const kayit = new S.RecordApi({ replika: A.replika(L, A.K.husniye, { now: () => saat.t }), kasa })
  const kap = new S.ExportApi({ kayit, kdf: HIZLI, gizliAlanlar: (tur) => (tur === 'yuva.defter.sifre' ? ['parola', 'ek'] : []), now: () => saat.t })
  return { L, kasa, kayit, kap, saat }
}

// S1: kasa kilidi ön geçişte denetlenir, dosyalar ise Argon2id beklemesinden SONRA akış sırasında açılır. Bu arada
// LOCK (ya da 5 dk işlemsizlik) olursa kap başlığı ve icerik.json yaz'a gitmiş, sonra VAULT_LOCKED fırlar: çağıranın
// dosyasında yarım kap kalır. (Eski yol her şeyi beklemeden önce topluyordu.) Doğru: hata varsa yaz hiç çağrılmamış
// olmalı, ya da dışa aktarma kilit öncesi anlık görüntüyle tamamlanmalı.
test('S1 (D41): Argon2id sırasında kasa kilitlenirse yarım çıktı kalmamalı', async (t) => {
  const { kasa, kayit, kap } = kur()
  kasa.unlock('ab'.repeat(32))
  const dosya = kayit.attach({ bytes: b4a.alloc(5000, 1), mime: 'application/pdf', name: 'hesap.pdf' }).blobRef
  kayit.put(KASA, null, 'yuva.defter.sifre', { ad: 'Banka', parola: 'gizli123', belge: dosya })
  const parcalar = []
  const p = kap.export({ koleksiyonlar: [KASA], parola: PAROLA, yaz: (b) => parcalar.push(b4a.from(b)) })
  kasa.lock() // ön geçiş bitti, Argon2id bekleniyor
  const e = await hataOfA(() => p)
  t.comment('sonuç: ' + (e || 'tamamlandı') + ', yaz çağrısı: ' + parcalar.length + ', bayt: ' + parcalar.reduce((a, b) => a + b.byteLength, 0))
  if (e) t.is(parcalar.length, 0, 'hata dönen dışa aktarma yaz\'a hiçbir şey vermemeli')
  else t.pass('tutarlı anlık görüntüyle tamamlandı')
})

// S2: dosya varlığı ön geçişte denetlenir (eksikse eksikDosya sayılır), baytlar sonra okunur. Arada dosya depodan
// silinirse (eşzamanlı silme, MemoryBlobStore LRU) dışa aktarma akışın ortasında NO_FILE ile düşer ve yarım çıktı kalır.
// Eski yol bu dosyayı eksikDosya sayıp tamamlıyordu.
test('S2 (D41): ön geçişten sonra silinen dosya dışa aktarmayı yarıda düşürmemeli (eksikDosya sayılmalı)', async (t) => {
  const { kayit, kap } = kur()
  const dosya = kayit.attach({ bytes: b4a.alloc(5000, 2), mime: 'application/pdf', name: 'garanti.pdf' }).blobRef
  kayit.put(TA, null, 'yuva.defter.garanti', { urun: 'Kombi', belge: dosya })
  const parcalar = []
  const p = kap.export({ koleksiyonlar: [TA], parola: PAROLA, yaz: (b) => parcalar.push(b4a.from(b)) })
  kayit.depo.delete(hex(dosya.blobId))
  const e = await hataOfA(() => p)
  t.is(e, null, 'dışa aktarma tamamlanmalı (dosya eksik sayılır); hata: ' + e + ', yarım yaz çağrısı: ' + parcalar.length)
})

// S3: ölçüm ve yazım geçişleri arasında aynı boyda farklı veri gelirse (çağıranın sözleşme ihlali) yalnız boy denetlenir;
// CRC ilk geçişten kalır, dışa aktarma başarılı döner, ama kap geri yüklenemez (ZIP_CHECKSUM). Sessiz bozuk yedek.
test('S3 (D41): iki geçişte farklı veri (aynı boy) sessizce bozuk kap üretmemeli', async (t) => {
  let n = 0
  const parcalar = []
  const e = await hataOfA(() => AR.disaAktarAkis({
    parola: PAROLA, urun: 'yuva-defteri', bicim: 'yuva-defter-arsiv', bicimSurum: 1, kdf: HIZLI,
    icerikParcalari: function * () { n++; yield b4a.from('{"bicim":"yuva-defter-arsiv","bicimSurum":1,"olusturma":' + (n === 1 ? '1' : '2') + ',"koleksiyonlar":[]}') },
    yaz: (b) => parcalar.push(b4a.from(b))
  }))
  if (e) { t.pass('akış hata verdi: ' + e); return }
  const ac = await hataOfA(() => AR.iceAlAsync(b4a.concat(parcalar), PAROLA))
  t.is(ac, null, 'başarılı dönen dışa aktarmanın kabı açılmalı; açılış: ' + ac)
})

// Temiz olması beklenenler (yeşil): gizli alan ve kilit denetimi akış yolunda
test('T1 (D41): akış yolunda gizli alan, gizli alanın _ai adı ve yalnız gizli alanın andığı dosya çıkmaz; kilitliyken yaz çağrılmaz', async (t) => {
  const { kasa, kayit, kap } = kur()
  const parcalar0 = []
  t.is(await hataOfA(() => kap.export({ koleksiyonlar: [KASA], parola: PAROLA, yaz: (b) => parcalar0.push(b) })), 'VAULT_LOCKED')
  t.is(parcalar0.length, 0, 'kilitliyken yaz çağrılmadı')
  kasa.unlock('ab'.repeat(32))
  const gizliDosya = kayit.attach({ bytes: b4a.from('gizli ek'), mime: 'application/pdf', name: 'gizli.pdf' }).blobRef
  kayit._yaz(KASA, null, 'yuva.defter.sifre', { ad: 'Banka', parola: 'gizli123', ek: gizliDosya, _ai: ['ad', 'parola'], _aiyol: 'kural/1', _conf: 90 })
  const parcalar = []
  const r = await kap.export({ koleksiyonlar: [KASA], parola: PAROLA, yaz: (b) => parcalar.push(b4a.from(b)) })
  const a = await kap.import({ bytes: b4a.concat(parcalar), parola: PAROLA })
  const k = a.icerik.koleksiyonlar[0].kayitlar[0]
  t.absent('parola' in k.alanlar)
  t.absent('ek' in k.alanlar)
  t.alike(k.yapay_zeka_alanlari, ['ad'])
  t.is(a.dosyalar.length, 0, 'yalnız gizli alanın andığı dosya çıkmadı')
  t.is(r.eksikDosya, 0)
  t.absent(b4a.concat(parcalar).includes(b4a.from('gizli123')), 'düz metin yok')
})
