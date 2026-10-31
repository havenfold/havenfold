// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// PR #5 bağımsız inceleme: temiz bulunan noktaların sınanması (bunların GEÇMESİ beklenir).
'use strict'
/* global Bare */
const test = require('brittle')
const b4a = require('b4a')
const fs = typeof Bare !== 'undefined' ? require('bare-fs') : require('fs')
const W = __dirname + '/..'
const { Kalici, Depo, coz } = require(W + '/persistence.js')
const { Ayirici, cerceveYaz } = require(W + '/ipc.js')
const S = require('@havenfold/sdk')
const AR = require(W + '/../protocol/command-ranges.json')
const sodium = require('sodium-native')

const ANAHTAR = b4a.alloc(32, 0x42)
const ARSIV = (() => {
  const pk = b4a.alloc(32); const sk = b4a.alloc(32)
  sodium.crypto_box_seed_keypair(pk, sk, b4a.alloc(32, 7))
  return { pubHex: b4a.toString(pk, 'hex'), skHex: b4a.toString(sk, 'hex') }
})()
const saat = () => { let t = 1_800_000_000_000; return () => t++ }
let sira = 0
function dizin (t) {
  const d = __dirname + '/../.gecici/pr5t-' + Date.now().toString(36) + '-' + (sira++)
  fs.mkdirSync(d, { recursive: true })
  t.teardown(() => { try { fs.rmSync(d, { recursive: true, force: true }) } catch {} })
  return d
}

test('göç yarıda kalırsa (yalnız kimlik şifreli) sonraki açılış tamamlar; düz kipteki kasa anahtarları arsive taşınır', (t) => {
  const d = dizin(t)
  const now = saat()
  const k = new Kalici({ dizin: d, testKipi: true, now }) // Arşiv anahtarı yok: kasa anahtarları durumda
  const n = k.aileKur({ aileAdi: 'Rivera', benimAdim: 'Alex' })
  n.defter.myPersonalVault()
  n.kayit.sync()
  const cid = n.kayit.collections().find((x) => x.name === 'Benim kasam').collectionId
  const rid = n.kayit.put(cid, null, 'yuva.defter.sifre', { ad: 'Banka', parola: 'p4r0l4' })
  const tum = n.kayit.collections().find((x) => x.name !== 'Benim kasam').collectionId
  const rid2 = n.kayit.put(tum, null, 'yuva.defter.not', { baslik: 'not' })
  k.kaydet()
  k.kapat()
  // Çöküş benzetimi: göç yalnız kimlik dosyasını şifrelemiş
  const acik = new Depo({ dizin: d, testKipi: true })
  const sif = new Depo({ dizin: d, anahtar: ANAHTAR })
  sif.yaz('kimlik', acik.oku('kimlik'))
  const k2 = new Kalici({ dizin: d, anahtar: ANAHTAR, archivePubHex: ARSIV.pubHex, now })
  t.teardown(() => k2.kapat())
  for (const f of ['kimlik', 'hlc', 'durum', 'arsiv']) t.is(fs.readFileSync(d + '/' + f)[5], 1, f + ' şifreli')
  const durum = coz(JSON.parse(b4a.toString(sif.oku('durum'))))
  t.absent(durum.replika.anahtarlar.some((s) => s.cid === cid), 'kasa anahtarı durumdan arsive taşındı')
  t.is(k2.nesneler.kayit.get(tum, rid2).fields.baslik, 'not')
  k2.nesneler.kasa.unlock(ARSIV.skHex)
  t.is(k2.nesneler.kayit.get(cid, rid).fields.parola, 'p4r0l4', 'kasa kaydı arsivden açılıyor')
})

test('UNLOCK: yanlış anahtar, bozuk biçim ve doğru anahtar; kilit açılmadan arsiv okunmaz', (t) => {
  const d = dizin(t)
  const k = new Kalici({ dizin: d, anahtar: ANAHTAR, archivePubHex: ARSIV.pubHex, now: saat() })
  t.teardown(() => k.kapat())
  const n = k.aileKur({ aileAdi: 'Rivera', benimAdim: 'Alex' })
  const hata = (f) => { try { f(); return null } catch (e) { return e.message } }
  t.is(hata(() => n.kasa.unlock('AB'.repeat(32))), 'INVALID_KEY')
  t.is(hata(() => n.kasa.unlock('ab'.repeat(31))), 'INVALID_KEY')
  t.is(hata(() => n.kasa.unlock('ab'.repeat(32))), 'WRONG_LOCK_KEY')
  t.ok(n.kasa.locked())
  t.absent(k.arsivAcik)
  n.kasa.unlock(ARSIV.skHex)
  t.ok(k.arsivAcik && !n.kasa.locked())
})

test('IPC: 1 MiB + 1 önek akışı durdurur; parça parça 1 MiB çerçeve tek seferde birleşir', (t) => {
  const al = []
  let gecersiz = 0
  const a = new Ayirici({ durOnGecersiz: true, tamam: (m) => al.push(m.length), gecersiz: () => gecersiz++ })
  const buyuk = cerceveYaz('x'.repeat(1024 * 1024))
  for (let i = 0; i < buyuk.byteLength; i += 4093) a.yaz(buyuk.subarray(i, i + 4093))
  t.alike(al, [1024 * 1024])
  const b = b4a.alloc(4)
  new DataView(b.buffer, b.byteOffset, 4).setUint32(0, 1024 * 1024 + 1)
  a.yaz(b)
  a.yaz(cerceveYaz('{}'))
  t.is(gecersiz, 1)
  t.alike(al, [1024 * 1024], 'geçersiz önekten sonra hiçbir bayt işlenmedi')
})

test('kanal numaraları RFC-0027 tablolarıyla aynı; aralık tablosu RFC-0003 §10 ve RFC-0017 ile', (t) => {
  const K = S.CHANNEL_COMMAND
  const KK = S.VAULT_COMMAND
  t.alike([KK.LOCK, KK.UNLOCK], [19, 224], '§1')
  t.alike([K.VAULT_STATUS, K.VAULT_PAPER_SHARE, K.VAULT_PAPER_PRINTED, K.VAULT_PERSONAL, K.VAULT_CHILD_BACKUP], [365, 366, 367, 368, 369], '§1a kasa')
  t.alike([K.VAULT_SETUP_BK, K.VAULT_SETUP_VRK, KK.VAULT_SETUP_BK, KK.VAULT_SETUP_VRK], [387, 388, 387, 388], '§1a kurulum')
  t.alike([K.EXPORT, K.IMPORT, K.RECORD_MOVE], [390, 391, 249], '§2, §3')
  t.alike([K.INVITE_START, K.INVITE_CONFIRM, K.JOIN, K.INVITE_CANCEL], [3, 4, 5, 205], 'tören (Yuva Hat)')
  t.alike([K.LOCAL_DRAFT, K.PERSONAL_MODE_START, K.PERSONAL_MODE_MOVE, K.CARE_PROCESS, K.CARE_MISSED, K.CARE_CLAIM, K.SHIELD_ENABLE, K.SHIELD_REPORT], [352, 353, 354, 355, 356, 357, 358, 359])
  const r = (no) => AR.araliklar.find((x) => no >= x.bas && no <= x.son)
  // D45 uyarlaması: 280–287 RFC-0005 §17'deki adlarıyla TeamApi'nin kanal komutları oldu (kollar/D-cekirdek.md D45)
  t.is(r(280).sdk, true, '280–289 RFC-0005 ekip')
  t.alike([K.TEAM_CREATE, K.TEAM_PLACES], [280, 287], 'RFC-0005 §17')
  t.ok(/RFC-0017/.test(r(360).sahip), '360–364 eşleşme')
  // D40 uyarlaması: RFC-0027 §1a 389'u VAULT_ARCHIVE_MOVE olarak ayırdı (Mac, 026f28d)
  t.is(S.CHANNEL_COMMAND.VAULT_ARCHIVE_MOVE, 389, '389 VAULT_ARCHIVE_MOVE')
})
