// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// start.js — telefondaki çekirdeği kurar ve ürünün komut sunucusunu Bare Kit IPC'ye bağlar (RFC-0024, RFC-0027 §5)
//
//   const { start } = require('@havenfold/worklet')
//   await start({ dizin, anahtar, archivePubHex, sayac, urunSunucusu: (c) => komutSunucusu({ ...c.nesneler, … }) })
//
// Çekirdek kalıcı durumdan kurulur (persistence.js). urunSunucusu(c) ürünün RFC-0024 sunucusunu ({ isle, olaylariBagla,
// reddet? }) döner; c şunları taşır:
//   c.nesneler  { ledger, replika, kayit, defter, gorev, gorulme, caps, kasa, aile } — SDK nesneleri (aile yoksa kayit,
//               gorev ve kasa null). kasa: VaultApi; 224 UNLOCK kasa.unlock(archiveKeyHex), 19 LOCK kasa.kilitle().
//   c.aileKur({ aileAdi, benimAdim })  yeni aile; durum hemen yazılır; yeni nesneler döner
//   c.kaydet()  durumu hemen yazar (her komuttan sonra, değişiklikten 1 sn sonra ve Bare 'suspend' olayında kendiliğinden)
//   c.kimlik, c.now, c.S (SDK), c.aile (bu örneğin yerelNo'su; RFC-0034)
//   c.zamanla(fn, ms = 60000)  düzenli iş (ör. CareDeskApi.process: bildirim merdiveni uygulama ön planda değilken de yürür);
//               iş bitince durum yazılır, hata { olay: 'core-error', veri: { hata } } olur. Dönüş: durdur()
//   c.aileBagla(ledger)  törenle gelen defteri bağlar (yeni üye ya da kutu); durum hemen yazılır
//   c.torenTasiyici, c.yerelKanal  platformun tören taşıyıcısı ve yerel kanal kancası (CeremonyApi, LocalApi için)
//   c.esitleyici  cihazlar arası eşitleme (synchronizer.js; ag kancası verildiyse, yoksa null)
//   c.zarfGonder(peerHex, type, bytes, id), c.urunZarfi(type, fn, teslim)  ürün zarfları (SHARE_PREVIEW, AFET_MSG; kalıcı kuyruk; synchronizer.js)
//   c.afetSaklama()  DisasterApi'nin kalıcı saklaması (afet hâli ve depo; RFC-0031 §8.3, D104)
//   c.urunSaklama(onek)  ürünün kalıcı küçük durumu (persistence.js)
//   c.cekirdekHatasi(err)  yakalanmamış çekirdek hatasını uygulamaya bildirir
// Uygulamaya giden olay: { olay: 'persisted', veri: { sayac } } her yazımdan sonra (uygulama sayacı platform kasasında
// tutar, sonraki başlatmada verir; RFC-0027 §5 c) ya da { olay: 'persisted', veri: { hata } } yazım başarısızsa.
// Çekirdeğin kendi düzenli işleri: kasa kilidi yoklaması ve görevlerin zaman aşımı ve yeniden denemesi (TaskApi.tick,
// 5 sn'de bir); kapat() ikisini de durdurur.
// Tek örnek (§5 f): ikinci start ALREADY_STARTED; kapat() sonrası yeniden başlatılabilir.
//
// Birden çok aile (RFC-0034 §5, §6, §8): süreçte aile başına bir çekirdek örneği çalışır. Kök örnek dizinin kökündedir
// (bugünkü düzen, her zaman vardır); ek örnekler aileler/<yerelNo>/ altında. Her örnekte ayrı Kalici, SDK nesneleri,
// eşitleyici, taşıyıcı cihazı ve ürün sunucusu (urunSunucusu(c) örnek başına bir kez); ortak olan IPC bağı, HyperDHT
// düğümü (tasiyici verildiyse), platform anahtarı (örnek başına türetilir), Arşiv açık anahtarı ve dizin kilidi.
//   - Çerçeve: { id, komut, govde, aile? }. aile = yerelNo. Aileye özgü komutta aile yoksa: tek örnek varsa o, birden çok
//     örnek varsa FAMILY_AMBIGUOUS; bilinmeyen yerelNo NO_FAMILY. 420 FAMILIES, 421 FAMILY_ADD, 422 JOIN_PREPARE çekirdekte
//     işlenir, aile istemez.
//   - Birden çok örnek varken her olay ve geri çağrı çerçevesi aile taşır; geri çağrının kimliği '<yerelNo>:<kimlik>'
//     olur (cevabı { cagriId } doğru örneğe döner). Tek örnekte çerçeveler bugünkü gibidir.
//   - Sayaç haritası: start({ sayaclar: { kok: n, <yerelNo>: n } }); 'persisted' olayı birden çok örnekte aile taşır.
//     Haritada olup diskte olmayan ek örnek STATE_ROLLED_BACK ile açılmaz; diğerleri açılır.
//   - Açılmayan ek örnek (bozuk, geri alınmış) yalnız kendini durdurur: { olay: 'family-error', veri: { aile, hata } }.
//     Kök örnek açılamazsa start bugünkü gibi hata verir.
//   - Sınırlar (§4.2): en çok 3 aile (FAMILY_LIMIT), aynı aile iki kez yok (FAMILY_EXISTS; törenden önce QR'daki
//     famHint, JOIN_LEDGER'da familyId), aynı anda tek katılım (JOIN_IN_PROGRESS), kutu, uç ya da işçi tek aile
//     (DEVICE_SINGLE_COMMUNITY).
'use strict'
/* global Bare, BareKit */
const fs = require('#fs')
const b4a = require('b4a')
const S = require('@havenfold/sdk')
const { zarf: { Z } } = require('@havenfold/core')
const { Kalici, atomikYaz, yeniYerelNo, YEREL_NO } = require('./persistence')
const { ipcBagla } = require('./ipc')
const YE = require('./local-pairing')
const { Esitleyici } = require('./synchronizer')
const { MisafirEsitleyici } = require('./guest-synchronizer')

const hex = (b) => (typeof b === 'string' ? b : b4a.toString(b, 'hex'))
// Açılan dosyanın adı: yalnız harf, rakam, nokta, tire, alt çizgi; en çok 80 karakter
const guvenliAd = (ad) => String(ad || 'dosya').replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '_').slice(0, 80) || 'dosya'
const ACILAN_OMUR_MS = 10 * 60_000 // RFC-0014; RFC-0027 §5 e
const GECIKMELI_MS = 1000
const KASA_DENETIM_MS = 30_000
// TaskApi.tick (RFC-0002 §8 madde 4): TASK_ACCEPT 30 sn'de gelmezse ya da deadline geçerse parça sıradaki adaya
const GOREV_TICK_MS = 5_000
// RFC-0034
const AILE_EN_COK = 3 // §4.2; ücretle değişmez
const TOREN_MISAFIR = 3 // core/core/protocol/join-hello.js TOREN.MISAFIR
const KATILIM_MS = 10 * 60_000 // §4.3: tören 10 dakikada bitmezse katılım örneği silinir
const AYRILMA_MS = 72 * 3_600_000 // §4.5: LEAVE hiçbir üyeye ya da kutuya ulaşmazsa örnek 72 saat sonra silinir
const AYRILMA_GECIKME_MS = 3000 // LEAVE'in yankısı geldikten sonra silmeye kadar (işleyici bitsin, giden yazılar gitsin)
const AILE_KOMUT = S.FAMILY_COMMAND
const ISARET = 'silinecek' // örneğin silme işareti (§4.5 silme sırası); düz JSON, sır içermez
// Kök örneğin dosyaları (sıfırlamada silinir; kilit ve aileler/ kalır)
const KOK_DOSYALARI = ['kimlik', 'hlc', 'durum', 'arsiv', 'dosyalar', 'gomme']
const CIHAZ_PLATFORM = new Set(['kutu', 'isci', 'uc'])
const CREATE_FAMILY = 2
const IZIN_EN_COK_MS = 7 * 86_400_000 // §4.4: hf.aile-izni yazılıştan en çok 7 gün sonrasına kadar geçerli
const VAULT_ARCHIVE_MOVE = 389 // Arşiv anahtarı cihazda tek: birden çok örnekte DESTEKLENMIYOR (inceleme 25 madde 3)

let calisan = null // bu süreçteki tek örnek

// Dizindeki her dosyayı siler (açılan dosyaların geçici klasörü)
function dizinBosalt (d) {
  let liste = []
  try { liste = fs.readdirSync(d) } catch { return }
  for (const f of liste) try { fs.unlinkSync(d + '/' + f) } catch {}
}

const unref = (t) => { if (t && typeof t.unref === 'function') t.unref(); return t }

function isaretOku (d) {
  try { const j = JSON.parse(b4a.toString(fs.readFileSync(d + '/' + ISARET))); return j && typeof j === 'object' ? j : null } catch { return null }
}
function isaretYaz (d, j) { atomikYaz(d + '/' + ISARET, b4a.from(JSON.stringify(j))) }
// Örnek klasörünü siler: önce işaret 'siliniyor', sonra dosyalar, işaret en son (yarıda kalan silme açılışta tamamlanır).
// Dönüş: hepsi silindi mi. Bir dosya silinemezse işaret 'siliniyor' kalır (kaldırılmaz) ve false döner: çağıran örneği
// açmaz, hatayı bildirir; sonraki açılış silmeyi yeniden dener (açılış öncesi inceleme: hata yutulmaz)
function yokMu (d) {
  try { fs.lstatSync(d); return false } catch (err) { return !!err && err.code === 'ENOENT' }
}
function klasorSil (d, { kok = false } = {}) {
  // İşaret yazılamazsa hiçbir şey silinmez: işaretsiz yarım silme sonraki açılışta yarı silinmiş örnek olarak açılırdı.
  // Silinmiş sayılmak için klasör gerçekten yok olmalı (ENOENT); erişim hatası "yok" değildir (Codex 5. tur)
  try { isaretYaz(d, { asama: 'siliniyor' }) } catch { return yokMu(d) }
  let tamam = true
  const sil = (y) => { try { fs.rmSync(y, { recursive: true, force: true }) } catch { tamam = false } }
  if (kok) {
    for (const f of KOK_DOSYALARI) sil(d + '/' + f)
    if (tamam) try { fs.unlinkSync(d + '/' + ISARET) } catch {}
  } else {
    for (const f of (() => { try { return fs.readdirSync(d) } catch { return [] } })()) if (String(f) !== ISARET) sil(d + '/' + f)
    if (tamam) sil(d)
  }
  return tamam
}
const kodOf = (err) => (err && /^[A-Z][A-Z0-9_]{1,63}$/.test(err.message) ? err.message : 'INTERNAL_ERROR')
function fail (code) { throw new Error(code) }

/**
 * @param {object} o
 * @param {Function} o.urunSunucusu   (c) → { isle, olaylariBagla, reddet? } (ya da Promise'i); her aile örneği için bir kez
 * @param {string} o.dizin            uygulamanın yazılabilir, yedeğe girmeyen klasörü
 * @param {Uint8Array} o.anahtar      32 B platform anahtarı (iOS Keychain AfterFirstUnlockThisDeviceOnly, Android Keystore);
 *                                    zorunlu, yoksa NO_KEY
 * @param {string} o.archivePubHex    Arşiv katmanının açık anahtarı (kasa anahtarlarını mühürler); zorunlu
 * @param {number} [o.sayac]          uygulamanın sakladığı son 'kalici' sayacı (kök örnek; geri alma denetimi)
 * @param {object} [o.sayaclar]       örnek başına sayaçlar { kok: n, <yerelNo>: n } (RFC-0034 §5.2); kok verilirse sayac yerine
 * @param {boolean} [o.testKipi]      yalnız test: anahtarsız açık kip (telefon paketinde kapalı)
 * @param {Function} [o.now]          saat (ms)
 * @param {string} [o.appId]          bu uygulamanın kimliği (LedgerApi, RFC-0017)
 * @param {string} [o.acilanDizin]    açılan dosyaların (RECORD_OPEN → { path }) yazılacağı geçici klasör
 * @param {object} [o.ipc]            IPC akışı (varsayılan BareKit.IPC)
 * @param {string} [o.platform]       cihaz sertifikasındaki platform (varsayılan Bare.platform)
 * @param {number} [o.acilanOmurMs]   açılan dosyanın en uzun ömrü (varsayılan 10 dakika; testte kısaltılır)
 * @param {object} [o.torenTasiyici]  platformun tören taşıyıcısı ({ davet, katil }; CeremonyApi), ürüne c.torenTasiyici ile geçer
 *                                    (yalnız kök örnek; ek örnekler tasiyici ile)
 * @param {object} [o.yerelKanal]     yerel kanal kancası ({ var, birak, sor? }; LocalApi), ürüne c.yerelKanal ile geçer
 * @param {Function} [o.uygunCihaz]   (id) → bool: KRA ve YA dağıtımında cihaz payı alabilecek kutu ve işçiler (TPM mührü
 *                                    kurulumda doğrulanmış; RFC-0004 §3.1)
 * @param {object} [o.kutuPay]        bu çekirdek ailenin kutusuysa pay tutucusu ({ payAl, surumIstegiAl, payIstegiAl } (peer, bytes, yol); node/box-share.js)
 * @param {object} [o.tasiyici]      tek ayarla telefon taşıyıcısı (RFC-0028; D76): { deneysel: true, ad?, cihazAdi?,
 *                                    onyukleme? (yalnız test: yerel testnet) }. Verilirse çekirdek kendi HyperDHT
 *                                    düğümünü (uygulama başına, §7 f; bütün aile örneklerine tek düğüm, RFC-0034 §6), ağ
 *                                    kancasını ve tören taşıyıcısını örnek başına kurar; ag ve torenTasiyici verilmez.
 *                                    deneysel: true olmadan EXPERIMENTAL_DISABLED (bayrak kapalı)
 * @param {number} [o.gorevTickMs]    görevlerin zaman aşımı ve yeniden deneme yoklaması (varsayılan 5 sn; testte kısaltılır)
 * @param {number} [o.kasaDenetimMs]  kasa kilidi, ayrılma süresi ve uzaktan üye etkinleştirme yoklaması (varsayılan 30 sn; testte kısaltılır)
 * @param {object} [o.ag]             platformun ağ kancası ({ gonder(peerHex, type, bytes), dinle?({ baglandi, koptu, al }) };
 *                                    doğrulanmış doğrudan oturumlar). Verilirse kök örnekte cihazlar arası eşitleme kurulur
 * @param {number} [o.katilimMs]      katılım örneğinin ömrü (varsayılan 10 dakika; testte kısaltılır)
 * @param {Function} [o.sosBildiren]  (familyIdHex) → bool: bu cihazda hf.sos'u bildiren uygulama bu mu (RFC-0017 §9; SDK
 *                                    reportingApp ile, yerel kanal listesinden). Verilmezse her kimlik SOS alındısı yazar
 * @param {Function} [o.yerelAileler] () → [{ familyId, rol } | familyId hex]: telefondaki başka Eser uygulamalarının
 *                                    aileleri (yerel kanal aile listesi, RFC-0034 §3, §4.6; platform okur). 3 sınırı ve
 *                                    famHint denetimi bunları da sayar; rolü cocuk olan aile yeni aileyi engeller (§4.4)
 */
async function start ({ urunSunucusu, dizin, anahtar = null, archivePubHex = null, sayac = null, sayaclar = null, testKipi = false, now = Date.now, appId = null, acilanDizin = null, ipc = null, platform = null, acilanOmurMs = ACILAN_OMUR_MS, torenTasiyici = null, yerelKanal = null, ag = null, uygunCihaz = () => false, kutuPay = null, tasiyici = null, gorevTickMs = GOREV_TICK_MS, kasaDenetimMs = KASA_DENETIM_MS, katilimMs = KATILIM_MS, yerelAileler = null, sosBildiren = null } = {}) {
  if (calisan) throw new Error('ALREADY_STARTED')
  if (tasiyici !== null && (typeof tasiyici !== 'object' || tasiyici.deneysel !== true)) throw new Error('EXPERIMENTAL_DISABLED')
  if (tasiyici && (ag || torenTasiyici)) throw new Error('TRANSPORT_TWICE')
  if (typeof urunSunucusu !== 'function') throw new Error('NO_PRODUCT_SERVER')
  if (sayaclar !== null && (typeof sayaclar !== 'object' || Array.isArray(sayaclar))) throw new Error('INVALID_KEY')
  const akis = ipc || (typeof BareKit !== 'undefined' ? BareKit.IPC : null)
  if (!akis) throw new Error('NO_IPC')
  calisan = { hazirlaniyor: true }
  try {
    return await kur()
  } catch (err) {
    calisan = null
    throw err
  }

  async function kur () {
    const kokDizin = String(dizin || '').replace(/\/$/, '')
    const ailelerDizin = kokDizin + '/aileler'
    const plt = platform || (typeof Bare !== 'undefined' && Bare.platform ? Bare.platform : 'bare')
    const bareVar = typeof Bare !== 'undefined' && typeof Bare.on === 'function'
    // Tek ayarla taşıyıcı (D76): tek DHT düğümü bütün örneklere (RFC-0034 §6); ağ kancası ve tören örnek başına
    let T = null
    let qrCoz = null
    let dht = null
    if (tasiyici) {
      T = require('@havenfold/transport')
      qrCoz = require('@havenfold/transport/ceremony').qrCoz
      dht = T.dhtAc(Array.isArray(tasiyici.onyukleme) ? { bootstrap: tasiyici.onyukleme, firewalled: false } : {})
    }

    const ornekler = new Map() // yerelNo → örnek (kök ilk)
    const bozuklar = new Map() // yerelNo → hata kodu: açılamayan ek örnekler (FAMILIES'de durum 'bozuk')
    let kok = null
    let kokHata = null // kök örnek açılamadıysa hata kodu (ek örnekler yine açılır; inceleme 25 madde 6)
    let bag = null
    let katilim = null // { o, zaman } süren katılım (§4.2: en çok 1)
    let kanalGonder = null // ipcBagla'nın gönderimi (olaylariBagla ile gelir)
    let aileKuyrugu = Promise.resolve() // 420–422 ve 389 sırası
    const cokMu = () => ornekler.size > 1

    // Uygulamaya çerçeve: birden çok örnek varken aileye özgü olay ve geri çağrı aile taşır (RFC-0034 §8.1)
    const cerceve = (obj) => (kanalGonder ? kanalGonder(JSON.stringify(obj)) : false)
    // Ek örneğin olayı her zaman aile taşır (Kalici ilk yazımını örnek haritaya girmeden yapar; inceleme 25 madde 1);
    // kök örnek yalnız birden çok örnek varken, kok: true ile (uygulama kökün sayacını 'kok' anahtarına yazar)
    const etiketli = (o) => !o.kok || cokMu()
    const olayGonder = (o, olay, veri) => cerceve(!o.kok ? { olay, veri, aile: o.yerelNo } : cokMu() ? { olay, veri, aile: o.yerelNo, kok: true } : { olay, veri })
    const acilistaSilinen = [] // bağlantıdan önce silinen örnekler: sayac: null olayı bağlanınca (madde 4)
    let kokSilindi = false // kökün yarım silmesi açılışta tamamlandı
    // Geri çağrı kimliği '<yerelNo>:<JSON>' (türü korur; madde 11)
    const cagriKodla = (o, id) => o.yerelNo + ':' + JSON.stringify(id)
    function cagriCoz (id) {
      const m = typeof id === 'string' ? /^([0-9a-f]{32}):(.*)$/.exec(id) : null
      if (!m) return null
      try { return { o: ornekler.get(m[1]) || null, id: JSON.parse(m[2]) } } catch { return { o: null, id: null } }
    }
    const ortakOlay = (olay, veri) => cerceve({ olay, veri })

    // Açılan dosyalar (RECORD_OPEN → { path }) bütün örneklerde tek geçici klasörde
    const acilanlar = new Map() // yol → { o, kasa, zamanlayici }
    const acilanSil = (yol) => {
      const a = acilanlar.get(yol)
      if (a && a.zamanlayici) clearTimeout(a.zamanlayici)
      acilanlar.delete(yol)
      try { fs.unlinkSync(yol) } catch {}
    }
    if (acilanDizin) {
      fs.mkdirSync(acilanDizin, { recursive: true })
      dizinBosalt(acilanDizin) // önceki oturumdan kalanlar (RFC-0027 §5 e)
    }

    // Ek örneklerin sayaçları: haritada olan ama diskte olmayan örnek geri alınmıştır (RFC-0034 §5.2)
    const harita = sayaclar || {}
    const kokSayac = Number.isSafeInteger(harita.kok) ? harita.kok : sayac
    const diskteki = new Set()
    try { for (const f of fs.readdirSync(ailelerDizin)) if (YEREL_NO.test(String(f))) diskteki.add(String(f)) } catch {}

    // --- Örnek ---------------------------------------------------------------------------------------------------
    async function ornekAc (yerelNo, { sayacV = null } = {}) {
      const o = { yerelNo, kok: yerelNo === null, isler: new Set(), gecikmeli: null, gidenSayac: null, kapandi: false, esitleyici: null, tas: null }
      const dizinO = o.kok ? kokDizin : ailelerDizin + '/' + yerelNo
      const kayitKancalari = {
        // attach({ path }): platformun verdiği yoldan okur; çekirdeğin kendi dizini (kimlik, durum, arsiv) eklenemez
        dosyaOku: (yol) => {
          const y = String(yol || '')
          if (!y || y.split('/').includes('..') || y === kokDizin || y.startsWith(kokDizin + '/')) return null
          try { return fs.readFileSync(y) } catch { return null }
        }
      }
      const agO = tasiyici ? 'tasiyici' : (o.kok ? ag : null)
      if (agO) {
        // Yüklenen dosyanın BLOB_DATA mesajları kutuya (ağ yoksa attach eski gibi mesajları döner)
        kayitKancalari.dosyaYuklendi = (ref, mesajlar) => o.esitleyici.yuklendi(ref, mesajlar)
        // TaskApi'nin işçiye gönderimi (RFC-0002 §6; TASK, TASK_CANCEL) eşitleyicinin süzgecinden
        kayitKancalari.gorevGonder = (p, type, bytes) => (o.esitleyici ? o.esitleyici._gonder(hex(p), type, bytes) : false)
      }
      if (acilanDizin) {
        kayitKancalari.dosyaYaz = (ref, bytes) => {
          const yol = acilanDizin.replace(/\/$/, '') + '/' + hex(ref.blobId).slice(0, 32) + '-' + guvenliAd(ref.name)
          atomikYaz(yol, bytes)
          if (acilanlar.has(yol)) clearTimeout(acilanlar.get(yol).zamanlayici)
          const n = o.kalici.nesneler
          const kasa = !!(n.kayit && n.kayit._kasaDosyasi(hex(ref.blobId)))
          acilanlar.set(yol, { o, kasa, zamanlayici: unref(setTimeout(() => acilanSil(yol), acilanOmurMs)) })
          return yol
        }
      }
      const kalici = new Kalici({ dizin: dizinO, anahtar, testKipi, archivePubHex, sayac: sayacV, now, appId, platform: plt, kayitKancalari, kaydedildi: (s) => kaliciOlay(o, { sayac: s }), uygunCihaz, yerelNo, olay: (ad, veri) => olayGonder(o, ad, veri), sosBildiren })
      if (o.kok) kalici.aileGecidi = kokAileGecidi
      o.kalici = kalici
      o.yerelNo = kalici.yerelNo
      // LOCK ve işlemsizlik: bu örneğin kasa kaynaklı açılan dosyaları silinir (kilit örnek başına, §5.3)
      kalici.kilitlenince = () => { for (const [yol, a] of [...acilanlar]) if (a.kasa && a.o === o) acilanSil(yol) }

      o.kaydet = () => {
        if (o.gecikmeli) { clearTimeout(o.gecikmeli); o.gecikmeli = null }
        if (o.kapandi) return
        try {
          kalici.kaydet()
        } catch (err) {
          kaliciOlay(o, { hata: (err && err.message) || 'INTERNAL_ERROR' })
        }
      }
      // IPC dışı değişiklikler (taşıyıcıdan gelen işlem ve anahtar, defter) 1 sn sonra yazılır
      o.kirli = () => { if (!o.gecikmeli && !o.kapandi) o.gecikmeli = unref(setTimeout(o.kaydet, GECIKMELI_MS)) }
      let dinlenen = null
      o.dinle = () => {
        const n = kalici.nesneler
        if (!n.aile || dinlenen === n.kayit) return
        dinlenen = n.kayit
        n.kayit.on('change', o.kirli)
        n.defter.on('ledger', () => { o.kirli(); uyelikDenetle(o) })
        if (n.kasa) n.kasa.on('vault', o.kirli) // teslim, pay alındı, kurulum: alındı diske yazılmadan kaybolmasın
      }
      o.sonra = () => { o.dinle(); if (o.esitleyici) o.esitleyici.akit(); o.kaydet() }

      const cekirdekHatasi = (err) => olayGonder(o, 'core-error', { hata: kodOf(err) })
      // Aile bağlanırken aynı aile telefonda başka örnekte varsa FAMILY_EXISTS (RFC-0034 §4.2; JOIN_LEDGER). Eşleşme
      // (RFC-0017 §6.2, 365) öbür uygulamadaki aileye eklenmenin kendisidir: orada yalnız bu uygulamanın örneklerine bakılır
      const aileBagla = (ledger, { eslesme = false } = {}) => {
        if (ledger && ledger.familyId && (eslesme ? buUygulamadaMi(o, ledger.familyId) : baskaAiledeMi(o, ledger.familyId))) { katilimSil(o); fail('FAMILY_EXISTS') }
        const n = kalici.aileBagla(ledger)
        o.dinle()
        if (o.esitleyici) o.esitleyici.akit()
        katilimBitti(o)
        return n
      }

      // Taşıyıcı: örnek başına DhtTasiyici ve tören taşıyıcısı, ortak düğüm
      let torenO = o.kok ? torenTasiyici : null
      let agKanca = o.kok ? ag : null
      if (tasiyici) {
        const cihazOf = () => o.tasiyiciCihazi({ ad: tasiyici.ad || '', cihazAdi: tasiyici.cihazAdi || '' })
        const zaman = Number.isSafeInteger(tasiyici.yoklamaMs) ? { yoklamaMs: tasiyici.yoklamaMs, hizliMs: tasiyici.yoklamaMs } : {}
        // cihazlar: ailedeki işçilerle de oturum (telefon arar, işçi dinler); defterde aktif cihaz yoksa etkisi yok
        // Düğüm görünümü: askıya alma ve sürdürme yok; paylaşılan düğümü start bir kez askıya alır (inceleme 25 madde 12)
        const gorunum = { createServer: (...a) => dht.createServer(...a), connect: (...a) => dht.connect(...a), on: (...a) => dht.on(...a), off: (...a) => dht.off(...a) }
        const dt = new T.DhtTasiyici({ dht: gorunum, cihaz: cihazOf, deneysel: true, cihazlar: tasiyici.cihazlar !== false, ...zaman })
        const toren = T.dhtTorenTasiyici({ dht, cihaz: cihazOf, tamam: () => dt.yokla(), deneysel: true })
        o.tas = { dt, toren }
        agKanca = dt.ag
        torenO = toren
      }
      if (o.tas) torenO = torenSarmali(o, torenO)

      const c = {
        // RFC-0017 §6.2 adım 6 (D105; local-pairing.js): yeni uygulamada kabul (365), eski uygulamada ilk paket (366),
        // yeni uygulamada paketi alma. Kanal numaraları İstek 184'te
        eslesKabul: (okBytes) => YE.eslesKabul(kalici, okBytes, { aileBagla: (L) => aileBagla(L, { eslesme: true }) }),
        yerelEsitle: (o2) => YE.yerelEsitle(kalici, o2),
        yerelPaketAl: (o2) => { const r = YE.yerelPaketAl(kalici, o2); o.sonra(); return r },
        torenTasiyici: torenO,
        yerelKanal: o.kok ? yerelKanal : null, // yerel kanal aile listesi D93'te; o zamana kadar yalnız kök (madde 13)
        cekirdekHatasi,
        aile: o.yerelNo,
        zamanla (fn, ms = 60_000) {
          const t = unref(setInterval(async () => {
            try { await fn(); o.kirli() } catch (err) { cekirdekHatasi(err) }
          }, ms))
          o.isler.add(t)
          return () => { clearInterval(t); o.isler.delete(t) }
        },
        get nesneler () { return kalici.nesneler },
        get kimlik () { return kalici.kimlik },
        now,
        S,
        kalici,
        get esitleyici () { return o.esitleyici },
        // Ürün zarfları (RFC-0010 §8.1 SHARE_PREVIEW): gönderim ve işleyici; eşitleme yoksa gönderim false, işleyici kaydedilmez
        zarfGonder: (p, type, bytes, id) => (o.esitleyici ? o.esitleyici.zarfGonder(p, type, bytes, id) : false),
        afetSaklama: () => kalici.afetSaklama(),
        urunZarfi: (type, fn, teslim) => { if (o.esitleyici) o.esitleyici.urunZarfi(type, fn, teslim) },
        // Ürünün kalıcı küçük durumu (kalici.urunSaklama; önek 'ad/'): her komuttan sonra durumla yazılır
        urunSaklama: (onek) => kalici.urunSaklama(onek),
        // Misafir kipi (D99): GuestWriteApi.drop sonucunun mesajı aile üyelerine (açık oturum yoksa kuyrukta bekler)
        misafirGonder: (mesaj) => { if (!o.misafirEs) fail('NO_NETWORK'); return o.misafirEs.gonder(mesaj) },
        aileKur: ({ aileAdi = '', benimAdim } = {}) => { const n = kalici.aileKur({ aileAdi, benimAdim }); o.dinle(); if (o.esitleyici) o.esitleyici.akit(); katilimBitti(o); return n },
        aileBagla,
        kaydet: () => o.kaydet()
      }
      o.c = c
      o.tasiyiciCihazi = (ek = {}) => {
        const n = kalici.nesneler
        return {
          kimlik: kalici.kimlik,
          ledger: n.aile ? ayrilmaGorunumu(o, n.ledger) : null,
          defter: n.defter,
          aileBagla: (L) => aileBagla(L),
          now,
          torenAnahtarlari: kalici.torenAnahtarlari || null,
          torenAnahtariKaydet: (p, k) => kalici.torenAnahtariKaydet(p, k),
          // Misafir kipi (D99): taşıyıcının çift sırları görünümden; misafir töreninin sonu; ebeveynde bakıcı eklendi
          misafirLedger: n.misafir ? n.misafir.ledger : null,
          misafirBagla: (bayt, { aileAdi = null, grantHash = null } = {}) => {
            kalici.misafirBagla(bayt, { toren: true, aileAdi, grantHash })
            katilimBitti(o) // katılım örneği misafir kipine geçti: süre dolunca silinmez
            olayGonder(o, 'guest', { durum: 'basladi' })
            if (o.misafirEs) o.misafirEs.bosalt()
          },
          bakiciEklendi: (r) => {
            // Misafirin örtük SOS bırakma anahtarı açıldıysa gizli yarı bu telefonun replikasına (RFC-0031 §4.1)
            if (r && r.sosBirakma && n.kayit) n.kayit.r.addDropSecret(r.sosBirakma.collectionId, r.sosBirakma.secret)
            o.dinle()
            o.kirli()
          },
          ...ek
        }
      }

      if (agKanca) {
        // LEAVE bir üyeye ya da kutuya ulaşınca örnek silinir (§4.5): ulaştığı, karşı tarafın LEAVE'i defterine alıp aynı
        // oturumdan geri göndermesiyle (yankı) bilinir; sokete yazmak ulaşmak sayılmaz (açılış öncesi inceleme). Yankı
        // gelmezse 72 saat kuralı geçer. Silme kısa bir gecikmeyle: yankının geldiği işleyici bitsin, soket kapanmasın.
        o.esitleyici = new Esitleyici({
          kalici,
          ag: agKanca,
          kutuPay: o.kok ? kutuPay : null,
          degisti: () => o.kirli(),
          hata: (err) => cekirdekHatasi(err),
          tasiyiciAcik: () => (o.tas ? o.tas.dt.acik : true),
          olay: (ad, veri) => olayGonder(o, ad, veri),
          ayrilmaAlindi: () => { if (o.ayrilma && !o.ayrilma.ulasti) o.ayrilma.ulasti = unref(setTimeout(() => ayrilmaBitti(o), AYRILMA_GECIKME_MS)) },
          davetIptal: () => davetIptalEdildi(o)
        })
        kalici.kaydetmedenOnce = () => { try { o.esitleyici.cikisiBosalt() } catch (err) { cekirdekHatasi(err) } }
        // Misafir kipinde (D99) oturumlar misafir eşitleyicisine; aile kurulunca ya da ailesizken aile eşitleyicisine
        o.misafirEs = new MisafirEsitleyici({ kalici, ag: agKanca, degisti: () => o.kirli(), hata: (err) => cekirdekHatasi(err), olay: (ad, veri) => olayGonder(o, ad, veri) })
        const misafirde = () => !!kalici.nesneler.misafir && !kalici.nesneler.aile
        if (typeof agKanca.dinle === 'function') {
          agKanca.dinle({
            // İkinci argüman taşıyıcının bağlantı bilgisi ({ caps, yerel }): HELLO.caps eşitleyicide CapsBook'a yazılır
            // (HIDE_PRESENCE, UZAKTAN_IPTAL); atılırsa davet iptali UPDATE_PENDING olur (Codex 13. tur)
            baglandi: (p, x) => (misafirde() ? o.misafirEs.baglandi(p, x) : o.esitleyici.baglandi(p, x)),
            koptu: (p) => { o.misafirEs.koptu(p); o.esitleyici.koptu(p) },
            al: (p, type, bytes, yol) => (misafirde() ? o.misafirEs.al(p, type, bytes, yol) : o.esitleyici.al(p, type, bytes, yol))
          })
        }
      }

      try {
        o.sunucu = await urunSunucusu(c)
        if (!o.sunucu || typeof o.sunucu.isle !== 'function' || typeof o.sunucu.olaylariBagla !== 'function') throw new Error('NO_PRODUCT_SERVER')
      } catch (err) {
        if (o.tas) o.tas.dt.kapat().catch(() => {})
        kalici.kapat()
        throw err
      }
      o.dinle()
      o.kapat = ({ yazmadan = false } = {}) => {
        if (o.kapandi) return
        if (!yazmadan) o.kaydet()
        o.kapandi = true
        if (o.birak) { try { o.birak() } catch {} }
        for (const t of o.isler) clearInterval(t)
        o.isler.clear()
        if (o.gecikmeli) clearTimeout(o.gecikmeli)
        for (const [yol, a] of [...acilanlar]) if (a.o === o) acilanSil(yol)
        const dt = o.tas && o.tas.dt
        kalici.kapat()
        return dt ? dt.kapat().catch(() => {}) : Promise.resolve()
      }
      ornekler.set(o.yerelNo, o)
      if (kanalGonder) olaylariBagla(o)
      if (o.tas) o.tas.dt.baslat() // suspend/resume ve ön/arka plan bütün örneklere birlikte (RFC-0034 §6; aşağıda)
      if (o.esitleyici) o.esitleyici.esitlemeGuncelle()
      return o
    }

    function kaliciOlay (o, veri) {
      if (olayGonder(o, 'persisted', veri) && 'sayac' in veri) o.gidenSayac = veri.sayac
    }

    // Ürün sunucusunun olay ve geri çağrı çerçeveleri: birden çok örnekte aile eklenir, geri çağrı kimliği öneklenir
    function olaylariBagla (o) {
      // Açılışta doğrulanamayan misafir görünümü (persistence.js): misafirlik düştü, uygulama bir kez öğrenir
      if (o.kalici.misafirAcilisHatasi) { olayGonder(o, 'guest', { durum: 'dustu', hata: o.kalici.misafirAcilisHatasi }); o.kalici.misafirAcilisHatasi = null }
      o.birak = o.sunucu.olaylariBagla((metin) => {
        if (!kanalGonder) return false
        if (!etiketli(o)) return kanalGonder(metin)
        let j
        try { j = JSON.parse(metin) } catch { return kanalGonder(metin) }
        if (!j || typeof j !== 'object') return kanalGonder(metin)
        j.aile = o.yerelNo
        if ('cagri' in j && j.id !== undefined && j.id !== null) j.id = cagriKodla(o, j.id)
        return kanalGonder(JSON.stringify(j))
      })
    }

    // --- Aile kuralları ------------------------------------------------------------------------------------------
    const familyIdOf = (o) => { const n = o.kalici.nesneler; return n.aile && n.ledger.familyId ? n.ledger.familyId : null }
    function buUygulamadaMi (o, familyId) {
      for (const x of ornekler.values()) if (x !== o) { const f = familyIdOf(x); if (f && b4a.equals(f, familyId)) return true }
      return false
    }
    function baskaAiledeMi (o, familyId) { return buUygulamadaMi(o, familyId) || digerAileler().has(hex(familyId)) }
    // Tören: QR'daki famHint (familyId'nin ilk 8 baytı; RFC-0028 §5 a) telefondaki bir ailenin ise tören başlamaz;
    // katılım töreni kapanırsa katılım örneği silinir
    function torenSarmali (o, t) {
      return {
        ...t,
        davet: (...a) => t.davet(...a),
        katil: async (kod) => {
          try {
            const q = qrCoz ? qrCoz(kod) : null
            if (q && !q.famHint.every((x) => x === 0)) {
              for (const x of ornekler.values()) { const f = familyIdOf(x); if (x !== o && f && b4a.equals(f.subarray(0, 8), q.famHint)) fail('FAMILY_EXISTS') }
              // Aile başka bir Eser uygulamasında varsa: aynı kişi ikinci kez giremez, RFC-0017 eşleşmesine yönlendirilir
              const ipucu = hex(q.famHint)
              for (const f of digerAileler()) if (f.startsWith(ipucu)) fail('FAMILY_EXISTS')
            }
          } catch (err) {
            if (err.message === 'FAMILY_EXISTS') { katilimSil(o); throw err }
          }
          // Boş kökte üye, kutu ya da cihaz katılımı: izin, aile sınırı ve cihaz kuralı törenden önce (kokAileGecidi
          // bağlanırken yine denetler; aile tarafında üye eklenmeden reddedilsin). Misafir töreni bu denetime girmez (K3).
          let tur = null
          try { tur = qrCoz ? qrCoz(kod).kind : null } catch {}
          if (o.kok && !doluMu(o) && tur !== null && tur !== TOREN_MISAFIR) yeniAileDenetle()
          const oturum = await t.katil(kod)
          if (oturum && typeof oturum.on === 'function') oturum.on('kapandi', () => { if (katilim && katilim.o === o && !doluMu(o)) katilimSil(o) })
          return oturum
        }
      }
    }
    // Örnek dolu mu: ailede ya da misafir kipinde (D99). Misafir örneği katılım süresi dolunca ya da açılışta "ailesiz"
    // sayılıp silinmez; misafir kipindeki kökte aile kurulmaz, katılım ek örnekte yapılır (açılış öncesi inceleme)
    const doluMu = (o) => !!(o.kalici.nesneler.aile || o.kalici.nesneler.misafir)
    function katilimBitti (o) {
      if (!katilim || katilim.o !== o) return
      clearTimeout(katilim.zaman)
      katilim = null
      ortakOlay('families', aileListesi())
    }
    function katilimSil (o) {
      if (!katilim || katilim.o !== o) return
      if (doluMu(o)) return katilimBitti(o) // aile (ya da misafirlik) başka yoldan bağlandıysa silinmez (madde 7)
      clearTimeout(katilim.zaman)
      katilim = null
      ornekSil(o)
    }
    // Örneği kapatıp klasörünü siler (katılım, ayrılma, çıkarılma, yerel silme; §4.5). Kök örnek sıfırlanır.
    function ornekSil (o) {
      if (o.kok) return kokSifirla()
      if (katilim && katilim.o === o) { clearTimeout(katilim.zaman); katilim = null }
      if (kanalGonder) kaliciOlay(o, { sayac: null }) // sayaç haritasından çıkar
      else acilistaSilinen.push(o.yerelNo)
      ornekler.delete(o.yerelNo)
      const p = o.kapat({ yazmadan: true })
      // Silinemezse örnek bozuk olarak kalır (açılmaz, 424 ile yeniden silinir; işaret açılışta da yeniden dener)
      if (!klasorSil(ailelerDizin + '/' + o.yerelNo)) bozuklar.set(o.yerelNo, 'ERASURE_INCOMPLETE')
      if (kanalGonder) ortakOlay('family-removed', { aile: o.yerelNo }) // uygulama o ailenin planlanmış bildirimlerini iptal eder
      ortakOlay('families', aileListesi())
      return p
    }
    // Kök örneğin ailesi bitti (ya da kök bozuk): dosyaları silinir, yeni ailesiz kimlikle açılır (§4.5)
    let sifirlaniyor = null
    function kokSifirla () {
      if (sifirlaniyor) return sifirlaniyor
      sifirlaniyor = (async () => {
        const eski = kok
        const eskiNo = eski ? eski.yerelNo : 'kok'
        if (eski) {
          if (kanalGonder) kaliciOlay(eski, { sayac: null })
          ornekler.delete(eski.yerelNo)
          await eski.kapat({ yazmadan: true })
        } else if (kanalGonder) cerceve({ olay: 'persisted', veri: { sayac: null }, kok: true })
        // Kökün dosyaları silinemezse eski kimlikle yeniden açılmaz: kök hata durumunda kalır, 424 'kok' yeniden dener
        if (!klasorSil(kokDizin, { kok: true })) { kok = null; kokHata = 'ERASURE_INCOMPLETE'; ortakOlay('families', aileListesi()); fail('ERASURE_INCOMPLETE') }
        kokHata = null
        kok = await ornekAc(null)
        // Kök haritada ilk sırada kalsın (FAMILIES)
        const diger = [...ornekler].filter(([y]) => y !== kok.yerelNo)
        ornekler.clear()
        ornekler.set(kok.yerelNo, kok)
        for (const [y, x] of diger) ornekler.set(y, x)
        ortakOlay('family-removed', { aile: eskiNo })
        ortakOlay('families', aileListesi())
      })().finally(() => { sifirlaniyor = null })
      return sifirlaniyor
    }
    // Bu kimliğin üyeliği: 'yok' (ailesiz), 'suruyor', 'bitti' (ayrıldı ya da silmesiz çıkarıldı), 'silinmeli'
    function uyelikOf (o) {
      const n = o.kalici.nesneler
      if (!n.aile) return 'yok'
      const m = n.ledger.members.get(hex(o.kalici.kimlik.memberId)) || n.ledger.devices.get(hex(o.kalici.kimlik.memberId))
      if (!m) return 'yok'
      if (m.active) return 'suruyor'
      return m.wipe ? 'silinmeli' : 'bitti'
    }
    // Defter değişince: silmeli çıkarılma (REMOVE_MEMBER wipe, imzasız ROTATE_DEVICE'ta ek kimlik) yalnız o örneği siler
    function uyelikDenetle (o) {
      if (o.kapandi || o.silmeBekliyor) return
      const u = uyelikOf(o)
      // Ayrılma bekliyor ama üyelik sürüyor: kendi LEAVE'imiz çatal çözümünde öbür dalda kaldı. LEAVE yeniden yazılır;
      // yazılmazsa 72 saat sonra örnek silinir ama kimlik ailede aktif kalırdı (hayalet üye; açılış öncesi inceleme)
      if (u === 'suruyor' && o.ayrilma) {
        try {
          const r = o.kalici.nesneler.defter.leave()
          if (r && r.durum === 'uygulandi') { clearTimeout(o.ayrilma.ulasti); o.ayrilma.gorunum = null; o.ayrilma.ulasti = null; if (o.esitleyici) o.esitleyici.akit(); o.kirli() }
        } catch (err) { olayGonder(o, 'core-error', { hata: kodOf(err) }) }
        return
      }
      if (u !== 'silinmeli') return
      // D106 K4: bekleyen uzaktan üyenin daveti iptal edildi (REVOKE); uygulama "Davet iptal edildi" der, yerel aile silinir
      const ben = o.kalici.nesneler.ledger.members.get(hex(o.kalici.kimlik.memberId))
      if (ben && ben.revoked) olayGonder(o, 'invite-revoked', { memberId: hex(o.kalici.kimlik.memberId) })
      silmeyiBaslat(o)
    }
    function silmeyiBaslat (o) {
      o.silmeBekliyor = true
      // Silinemezse hata FAMILIES'de görünür (kök: kokHata; ek: bozuk); burada sessiz kalır, işlenmemiş ret olmaz
      setImmediate(() => { if (!o.kapandi) Promise.resolve(ornekSil(o)).catch(() => {}) })
    }
    // D106 K4, Codex 10. tur: bekleyen telefon iptali defterden değil sınırlı iptal oturumundan öğrenir (aileyle eşitlemesi
    // yok); esitleyici zarfı törende alınan defterle doğruladı. Olay ve silme defter yolundakiyle aynı
    function davetIptalEdildi (o) {
      if (o.kapandi || o.silmeBekliyor) return
      olayGonder(o, 'invite-revoked', { memberId: hex(o.kalici.kimlik.memberId) })
      silmeyiBaslat(o)
    }
    // Ayrılma bekliyorken (423, §4.5) taşıyıcı defteri LEAVE'den önceki hâliyle görür: kendi LEAVE'imizle pasif olan
    // kimlik eş listesinden ve HELLO'dan düşer, telefon çevrimdışıyken ayrıldıysa LEAVE'i taşıyacak oturum hiç kurulmazdı
    // (açılış öncesi inceleme). Karşı taraf bizi hâlâ üye görür; oturum kurulunca eşitleyici gerçek defteri (LEAVE dahil)
    // gönderir. Görünüm yalnız bizim LEAVE'imizden önceki olaylardır; defter uzayınca yeniden kurulur.
    function ayrilmaGorunumu (o, L) {
      if (!o.ayrilma) return L
      const m = L.members.get(hex(o.kalici.kimlik.memberId)) // ham kimlik: ek kimlik ana kimliğe çözülmez (RFC-0017)
      const { ledger: { Ledger, T, encodeEvent, decodeEvent } } = require('@havenfold/core')
      if (!m || m.active || !Number.isSafeInteger(m.removedSeq) || L.events[m.removedSeq]?.type !== T.LEAVE) return L
      if (o.ayrilma.gorunum && o.ayrilma.gorunumLen === L.len) return o.ayrilma.gorunum
      const G = new Ledger()
      for (const e of L.events.slice(0, m.removedSeq)) G.apply(decodeEvent(encodeEvent(e)))
      G.now = L.now
      o.ayrilma.gorunum = G
      o.ayrilma.gorunumLen = L.len
      return G
    }
    // D106 K3: daveti bu telefon başlattıysa bekleme bitince ACTIVATE_MEMBER kendiliğinden yazılır (her yoklamada; öbür
    // ebeveynler 1 saat sonra ürün düğmesiyle). Aynı üyeye ikinci ACTIVATE etkisizdir (defter BEKLEMIYOR ile reddeder)
    function uzaktanEtkinlestir (o) {
      const n = o.kalici.nesneler
      if (o.kapandi || !n.aile || typeof n.defter.remoteToActivate !== 'function') return
      let yazildi = false
      for (const id of n.defter.remoteToActivate()) {
        try { if (n.defter.activateMember(id).durum === 'uygulandi') yazildi = true } catch (err) { olayGonder(o, 'core-error', { hata: kodOf(err) }) }
      }
      if (yazildi) o.sonra()
    }
    // LEAVE 72 saatte hiçbir üyeye ya da kutuya ulaşmadıysa örnek yine silinir (§4.5)
    function ayrilmaSuresi (o) {
      if (o.ayrilma && !o.kapandi && now() - o.ayrilma.zaman >= AYRILMA_MS) ayrilmaBitti(o)
    }
    function ayrilmaBitti (o) {
      if (o.kapandi || !o.ayrilma || o.silmeBekliyor) return
      o.silmeBekliyor = true
      Promise.resolve(ornekSil(o)).catch(() => {}) // hata FAMILIES'de görünür (uyelikDenetle ile aynı)
    }
    function durumOf (o) {
      if (katilim && katilim.o === o) return 'katiliyor'
      if (o.ayrilma) return 'silinecek'
      return o.kalici.nesneler.aile ? 'hazir' : 'ailesiz'
    }
    function aileListesi () {
      const liste = []
      for (const o of ornekler.values()) {
        const n = o.kalici.nesneler
        const L = n.aile ? n.ledger : null
        const ben = L ? L.members.get(hex(o.kalici.kimlik.memberId)) : null
        // familyId ve kimlik (ana | ek): uygulamanın yerel kanala bıraktığı aile listesi için (§4.6; telefondan çıkmaz)
        const meHex = hex(o.kalici.kimlik.memberId)
        const pid = L && ben ? L.personIdOf(meHex) : null
        const kimlik = pid ? (L.persons.get(pid)?.primary === meHex ? 'ana' : 'ek') : null
        liste.push({ aile: o.yerelNo, ad: L ? L.familyName : '', rol: ben ? ben.role : (L ? 'cihaz' : null), benimAdim: ben ? ben.name : '', durum: durumOf(o), kok: o.kok, duzey: L ? L.level : null, familyId: L ? hex(L.familyId) : null, kimlik })
      }
      if (kokHata) liste.unshift({ aile: 'kok', ad: '', rol: null, benimAdim: '', durum: 'bozuk', kok: true, duzey: null, hata: kokHata })
      for (const [y, hata] of bozuklar) liste.push({ aile: y, ad: '', rol: null, benimAdim: '', durum: 'bozuk', kok: false, duzey: null, hata })
      return liste
    }
    // Telefonun başka uygulamalarının aileleri (yerel kanal, RFC-0034 §4.6): familyId hex → o uygulamadaki rol ya da null
    // (rolsüz eski liste). Öğe { familyId, rol } ya da yalnız familyId dizgisi; geçersiz değer sayılmaz. Aynı aile iki
    // uygulamada farklı rolle görünürse cocuk öne geçer (tutucu)
    function digerAileRolleri () {
      let l = []
      try { l = typeof yerelAileler === 'function' ? yerelAileler() || [] : [] } catch {}
      const out = new Map()
      for (const x of Array.isArray(l) ? l : []) {
        const f = typeof x === 'string' ? x : x && typeof x === 'object' ? x.familyId : null
        if (typeof f !== 'string' || !/^[0-9a-f]{64}$/.test(f)) continue
        const rol = x && typeof x === 'object' && typeof x.rol === 'string' ? x.rol : null
        if (!out.has(f) || rol === 'cocuk') out.set(f, rol)
      }
      return out
    }
    function digerAileler () { return new Set(digerAileRolleri().keys()) }
    // Telefonun üye olduğu aileler: bu uygulamanın aileli, katılmakta olan ve bozuk örnekleri ile yerel kanaldaki öbür
    // uygulamaların bu uygulamada olmayan aileleri (§3 aile listesi, §4.2, K3)
    function aileSayisi () {
      const kendi = new Set()
      let n = 0
      for (const o of ornekler.values()) {
        const f = familyIdOf(o)
        if (f) { kendi.add(hex(f)); n++ } else if (katilim && katilim.o === o) n++
      }
      n += bozuklar.size + (kokHata ? 1 : 0)
      for (const f of digerAileler()) if (!kendi.has(f)) n++
      return n
    }
    function cihazMi () {
      if (CIHAZ_PLATFORM.has(plt)) return true
      if (!kok) return false
      const n = kok.kalici.nesneler
      if (!n.aile) return false
      const me = hex(kok.kalici.kimlik.memberId)
      // Cihaz olarak bağlı kimlik ya da defterde rolü kutu olan telefon (inceleme 25 madde 9; vektör 13)
      return (!n.ledger.members.has(me) && n.ledger.devices.has(me)) || n.ledger.members.get(me)?.role === 'kutu'
    }
    // Yeni aile (kurma ya da katılma) öncesi denetim: kök bozuk değil, cihaz başka toplulukta değil, aile sınırı, çocuk
    // rolündeki telefonda her ailenin ebeveyn izni. Dönüş: kullanılacak izinler (izinleriKullan, işlem başarılıysa).
    // hedef: bağlanacak ailenin familyId'si (biliniyorsa). Telefon o ailede başka bir Eser uygulamasıyla zaten varsa
    // (RFC-0017 eşleşmesi) aile yeni değildir: sınır, cihaz ve çocuk kuralı uygulanmaz (§4.2, §4.4)
    function yeniAileDenetle (hedef = null) {
      if (kokHata) fail('ROOT_CORRUPT') // kök sıfırlanana kadar yeni aile yok (inceleme 25 madde 6)
      if (hedef && digerAileler().has(hedef)) return []
      const n = aileSayisi()
      if (n > 0 && cihazMi()) fail('DEVICE_SINGLE_COMMUNITY') // cihaz platformu ilk topluluğuna katılabilir
      if (n >= AILE_EN_COK) fail('FAMILY_LIMIT')
      return izinleriBul()
    }
    // Kök örneğin aile edinmesi (CREATE_FAMILY, 421'in kök yolu, törenle bağlanma, ürünün c.kalici üstünden bağlaması)
    // aynı denetimden geçer: kök boşken de telefon başka örnekte ya da başka uygulamada ailede olabilir (açılış öncesi
    // inceleme; RFC-0034 §4.2, §4.4). Kalici.aileBagla bu kancayı aileyi bağlamadan önce çağırır, dönen işlevi bağladıktan
    // sonra. Ek örnekler 421/422'de denetlenir; ekOrnekAc yalnız oradan çağrılır.
    function kokAileGecidi (ledger = null) {
      const izinler = yeniAileDenetle(ledger && ledger.familyId ? hex(ledger.familyId) : null)
      return () => izinleriKullan(izinler)
    }

    // --- Çocuk rolündeki telefon (§4.4, K1) ---------------------------------------------------------------------
    // Telefon bir örnekte çocuksa yeni aile kuramaz ve yeni aileye katılamaz; ancak çocuk olduğu her ailede geçerli
    // ebeveyn izni (hf.aile-izni, Tüm Aile) varsa olur. İzin tek kullanımlık: kullanılan kayıt örneğin ürün saklamasında.
    const izinSaklama = (o) => o.kalici.urunSaklama('aile-izni/')
    const ebeveynMi = (L, id) => { const m = L.members.get(L.canonical(id) || id); return !!m && m.active && m.role === 'ebeveyn' }
    function izinleriBul () {
      const bulunan = []
      for (const o of ornekler.values()) {
        const n = o.kalici.nesneler
        if (!n.aile) continue
        const L = n.ledger
        const me = L.canonical(hex(o.kalici.kimlik.memberId))
        const ben = me ? L.members.get(me) : null
        if (!ben || !ben.active || ben.role !== 'cocuk') continue
        const cid = require('@havenfold/core').v23.tumAileOf(L)
        const kullanilan = new Set(izinSaklama(o).get('kullanilan') || [])
        let izin = null
        if (cid) {
          for (const r of n.kayit.query(cid, { type: 'hf.aile-izni' })) {
            const f = r.fields || {}
            const yazar = L.members.get(L.canonical(r.authorId) || r.authorId)
            const yazildi = Number.isSafeInteger(f._t) ? f._t : r.olusturma
            if (f._subj !== 'uye:' + me || kullanilan.has(r.recordId)) continue
            if (!yazar || !yazar.active || yazar.role !== 'ebeveyn') continue // çocuk ya da yetişkin yazmışsa yok sayılır
            // Alanlar birleşmiş hâldir: kaydın bütün işlemleri (ilk yazım ve sonraki değişiklikler) aktif bir ebeveynin
            // olmalı; çocuk ya da başkası gecerli'yi değiştirdiyse izin sayılmaz (açılış öncesi inceleme)
            if (!n.kayit.history(cid, r.recordId).every((x) => ebeveynMi(L, x.authorId))) continue
            if (!Number.isSafeInteger(f.gecerli) || f.gecerli <= now() || f.gecerli > yazildi + IZIN_EN_COK_MS) continue
            izin = r.recordId
            break
          }
        }
        if (!izin) fail('FAMILY_PERMISSION_REQUIRED')
        bulunan.push({ o, izin })
      }
      // Başka bir Eser uygulamasında çocuk (yerel kanal rolü; Codex 10. tur, sınır 28): izin o uygulamanın defterinde,
      // burada doğrulanamaz. Tutucu kural reddeder; aile çocuğun olduğu uygulamadan kurulur ya da katılınır, bu uygulama
      // sonra eşleşmeyle eklenir (yeni aile sayılmaz). Bu uygulamada da olan aile yukarıda kendi defteriyle denetlendi
      const kendi = new Set()
      for (const o of ornekler.values()) { const f = familyIdOf(o); if (f) kendi.add(hex(f)) }
      for (const [f, rol] of digerAileRolleri()) if (rol === 'cocuk' && !kendi.has(f)) fail('CHILD_IN_OTHER_APP')
      return bulunan
    }
    function izinleriKullan (bulunan) {
      for (const { o, izin } of bulunan || []) {
        const s = izinSaklama(o)
        s.set('kullanilan', [...new Set([...(s.get('kullanilan') || []), izin])].slice(-64))
        o.kaydet()
      }
    }
    // 425: o ailenin ebeveyni, çocuğa en çok 7 günlük izin yazar
    function izinVer (o, govde) {
      const n = o.kalici.nesneler
      if (!n.aile) fail('NO_FAMILY')
      const L = n.ledger
      const me = L.canonical(hex(o.kalici.kimlik.memberId))
      if (L.members.get(me)?.role !== 'ebeveyn') fail('PARENT_REQUIRED')
      const { cocukId, saat } = govde || {}
      const cocuk = typeof cocukId === 'string' ? L.canonical(cocukId) : null
      if (!cocuk || L.members.get(cocuk)?.role !== 'cocuk' || !L.members.get(cocuk).active) fail('NOT_CHILD')
      if (!Number.isSafeInteger(saat) || saat < 1 || saat * 3_600_000 > IZIN_EN_COK_MS) fail('INVALID_BODY')
      const cid = require('@havenfold/core').v23.tumAileOf(L)
      if (!cid) fail('NO_COLLECTION')
      const olay = new S.EventApi({ kayit: n.kayit, now })
      const t = now()
      const recordId = olay.write(cid, 'hf.aile-izni', { t, subj: 'uye:' + cocuk, gecerli: t + saat * 3_600_000 })
      o.sonra()
      return { recordId }
    }
    async function ekOrnekAc () {
      let y = yeniYerelNo()
      while (ornekler.has(y) || bozuklar.has(y) || diskteki.has(y)) y = yeniYerelNo()
      fs.mkdirSync(ailelerDizin + '/' + y, { recursive: true })
      try {
        return await ornekAc(y)
      } catch (err) {
        try { fs.rmSync(ailelerDizin + '/' + y, { recursive: true, force: true }) } catch {}
        throw err
      }
    }

    // 420–422 (RFC-0034 §8.2)
    async function aileKomutu (komut, govde) {
      if (komut === AILE_KOMUT.FAMILIES) return aileListesi()
      if (komut === AILE_KOMUT.FAMILY_LEAVE) {
        const o = ornekler.get(govde && govde.aile)
        if (!o) fail('NO_FAMILY')
        if (o.ayrilma) return { durum: 'silinecek' }
        if (uyelikOf(o) !== 'suruyor') fail('NO_MEMBERSHIP')
        const r = o.kalici.nesneler.defter.leave()
        if (r.durum !== 'uygulandi') fail('LEAVE_NOT_APPLIED')
        // Önce işaret (yeniden açılışta da silinecek), sonra eşitleme: LEAVE bir üyeye ya da kutuya ulaşınca silinir
        o.ayrilma = { zaman: now() }
        isaretYaz(o.kok ? kokDizin : ailelerDizin + '/' + o.yerelNo, { asama: 'bekliyor', neden: 'ayrildi', zaman: o.ayrilma.zaman })
        ortakOlay('families', aileListesi())
        o.sonra()
        return { durum: 'silinecek' }
      }
      if (komut === AILE_KOMUT.FAMILY_LOCAL_REMOVE) {
        const y = govde && govde.aile
        if (y === 'kok' && kokHata) { await kokSifirla(); return null }
        if (bozuklar.has(y)) {
          if (!klasorSil(ailelerDizin + '/' + y)) { bozuklar.set(y, 'ERASURE_INCOMPLETE'); fail('ERASURE_INCOMPLETE') }
          bozuklar.delete(y)
          cerceve({ olay: 'persisted', veri: { sayac: null }, aile: y })
          ortakOlay('family-removed', { aile: y })
          ortakOlay('families', aileListesi())
          return null
        }
        const o = ornekler.get(y)
        if (!o) fail('NO_FAMILY')
        const u = uyelikOf(o)
        // Üyeliği bitmiş, katılım ya da ailesiz ek örnek; ayrılması bekleyen de (kişi beklemeden siler)
        if (u === 'suruyor' && !o.ayrilma) fail('MEMBERSHIP_IN_PROGRESS')
        if (u === 'yok' && o.kok) fail('MEMBERSHIP_IN_PROGRESS') // ailesiz kökte silinecek bir şey yok
        await ornekSil(o)
        return null
      }
      if (komut === AILE_KOMUT.FAMILY_ADD) {
        const { aileAdi = '', benimAdim } = govde || {}
        if (typeof benimAdim !== 'string' || !benimAdim) fail('INVALID_BODY')
        if (kokHata) fail('ROOT_CORRUPT')
        // Kök örnek ailesizse aile orada kurulur (bugünkü CREATE_FAMILY yolu)
        let o = doluMu(kok) ? null : kok // misafir kipindeki kökte aile kurulmaz: ek örnek
        let izinler = null
        if (!o) {
          if (katilim) fail('JOIN_IN_PROGRESS')
          izinler = yeniAileDenetle()
          o = await ekOrnekAc()
        }
        // Aile ürünün kendi CREATE_FAMILY yoluyla kurulur (ürün bağlamını yeniler)
        const cevap = await o.sunucu.isle(JSON.stringify({ id: 0, komut: 2, govde: { aileAdi, benimAdim } }))
        let j = null
        try { j = cevap ? JSON.parse(cevap) : null } catch {}
        if (!o.kalici.nesneler.aile) {
          if (!o.kok) await ornekSil(o)
          if (!(j && typeof j.hata === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/.test(j.hata))) fail('FAMILY_SETUP_FAILED')
          fail(j.hata)
        }
        izinleriKullan(izinler)
        o.sonra()
        ortakOlay('families', aileListesi())
        return { aile: o.yerelNo }
      }
      if (komut === AILE_KOMUT.JOIN_PREPARE) {
        if (katilim) fail('JOIN_IN_PROGRESS')
        if (kokHata) fail('ROOT_CORRUPT')
        if (!doluMu(kok)) { yeniAileDenetle(); return { aile: kok.yerelNo } } // bugünkü akış (ilk aile); izin bağlanınca kullanılır
        const izinler = yeniAileDenetle()
        const o = await ekOrnekAc()
        izinleriKullan(izinler)
        katilim = { o, zaman: unref(setTimeout(() => katilimSil(o), katilimMs)) }
        ortakOlay('families', aileListesi())
        return { aile: o.yerelNo }
      }
      fail('UNSUPPORTED')
    }

    // --- Yönlendirici: kanal çerçevesi aileye göre örneğin sunucusuna -------------------------------------------
    function sec (aile) {
      if (aile === undefined || aile === null) {
        if (cokMu()) fail('FAMILY_AMBIGUOUS')
        return kok || [...ornekler.values()][0] || fail('NO_FAMILY')
      }
      if (typeof aile !== 'string' || !ornekler.has(aile)) fail('NO_FAMILY')
      return ornekler.get(aile)
    }
    const yonlendirici = {
      async isle (metin) {
        let j = null
        try { j = JSON.parse(metin) } catch {}
        if (!j || typeof j !== 'object' || Array.isArray(j)) return (kok || [...ornekler.values()][0]).sunucu.isle(metin) // ürün sunucusu reddeder
        // Geri çağrının cevabı: kimlik '<yerelNo>:<kimlik>' ise o örneğe, değilse kök örneğe (tek örnekteki gibi)
        if ('cagriId' in j && !('komut' in j)) {
          const m = cagriCoz(j.cagriId)
          const o = m ? m.o : kok
          if (!o) return null
          if (m) j.cagriId = m.id
          const cevap = await o.sunucu.isle(m ? JSON.stringify(j) : metin)
          o.sonra()
          return cevap
        }
        if (Object.values(AILE_KOMUT).includes(j.komut) && j.komut !== AILE_KOMUT.FAMILY_PERMIT_GRANT) {
          // 420–422 tek kuyrukta sırayla: denetim ile örneğin sayılması arasında başka istek araya girmez (madde 2)
          const is = aileKuyrugu.then(() => aileKomutu(j.komut, j.govde))
          aileKuyrugu = is.catch(() => {})
          try {
            return JSON.stringify({ id: j.id ?? null, sonuc: await is })
          } catch (err) {
            return JSON.stringify({ id: j.id ?? null, hata: kodOf(err) })
          }
        }
        // Arşiv anahtarı cihazda tek; taşıma bütün örneklere birlikte uygulanana kadar birden çok örnekte yok (madde 3).
        // 389 da 421/422 ile aynı kuyrukta: örnek sayısı denetimi ile taşıma arasında yeni örnek açılamaz; başarılı
        // taşımadan sonra açılan örnekler yeni açık anahtarı alır (archivePubHex güncellenir)
        if (j.komut === VAULT_ARCHIVE_MOVE) {
          const is = aileKuyrugu.then(async () => {
            if (ornekler.size > 1 || bozuklar.size > 0 || kokHata) return JSON.stringify({ id: j.id ?? null, hata: 'UNSUPPORTED' }) // bozuk kök de bir örnektir
            let o
            try { o = sec(j.aile) } catch (err) { return JSON.stringify({ id: j.id ?? null, hata: err.message }) }
            let cevap
            try { cevap = await o.sunucu.isle(metin) } finally { o.sonra() }
            let c2 = null
            try { c2 = cevap ? JSON.parse(cevap) : null } catch {}
            const yeni = j.govde && j.govde.yeniArchivePubHex
            if (c2 && !('hata' in c2) && typeof yeni === 'string' && /^[0-9a-f]{64}$/.test(yeni) && o.kalici.arsivPub && b4a.toString(o.kalici.arsivPub, 'hex') === yeni) archivePubHex = yeni
            return cevap
          })
          aileKuyrugu = is.catch(() => {})
          return is
        }
        let o
        try { o = sec(j.aile) } catch (err) { return JSON.stringify({ id: j.id ?? null, hata: err.message }) }
        if (j.komut === AILE_KOMUT.FAMILY_PERMIT_GRANT) {
          try { return JSON.stringify({ id: j.id ?? null, sonuc: izinVer(o, j.govde) }) } catch (err) { return JSON.stringify({ id: j.id ?? null, hata: kodOf(err) }) }
        }
        // CREATE_FAMILY yalnız kök örnek ailesizken (§4.3; madde 8); 421 kendi çağrısını içeriden yapar
        if (j.komut === CREATE_FAMILY && !o.kok) return JSON.stringify({ id: j.id ?? null, hata: 'FAMILY_EXISTS' })
        try {
          return await o.sunucu.isle(metin)
        } finally {
          o.sonra()
        }
      },
      olaylariBagla (gonder) {
        kanalGonder = gonder
        for (const o of ornekler.values()) olaylariBagla(o)
        return () => {
          kanalGonder = null
          for (const o of ornekler.values()) if (o.birak) { try { o.birak() } catch {} o.birak = null }
        }
      },
      reddet (id, hataKodu) {
        const m = cagriCoz(id)
        const o = m ? m.o : kok
        if (!o || typeof o.sunucu.reddet !== 'function') return
        o.sunucu.reddet(m ? m.id : id, hataKodu)
      }
    }

    // --- Açılış --------------------------------------------------------------------------------------------------
    // Yarıda kalan silmeler önce tamamlanır (§4.5 silme sırası; vektör 8)
    for (const y of [...diskteki]) {
      const i = isaretOku(ailelerDizin + '/' + y)
      if (i && i.asama === 'siliniyor') {
        diskteki.delete(y)
        if (klasorSil(ailelerDizin + '/' + y)) acilistaSilinen.push(y)
        else bozuklar.set(y, 'ERASURE_INCOMPLETE') // açılmaz; FAMILIES'de bozuk, 424 ile yeniden silinir
      }
    }
    const kokIsaret = isaretOku(kokDizin)
    let kokSilinemedi = false
    if (kokIsaret && kokIsaret.asama === 'siliniyor') { kokSilindi = true; kokSilinemedi = !klasorSil(kokDizin, { kok: true }) }
    try {
      if (kokSilinemedi) fail('ERASURE_INCOMPLETE') // eski kimliğin dosyalarıyla açılmaz
      kok = await ornekAc(null, { sayacV: kokSilindi ? null : kokSayac })
    } catch (err) {
      // Kök açılamazsa: ek örnek yoksa bugünkü gibi start düşer; varsa kök aile-hata ile durur, ekler açılır (madde 6)
      if (!diskteki.size) {
        if (dht) dht.destroy().catch(() => {})
        throw err
      }
      kokHata = kodOf(err)
    }
    if (kok) {
      // Uygulama kökün sayacını yerelNo anahtarıyla yazdıysa (çok örnekte kök olayı aile taşır) o da kökün sayacıdır:
      // kök için ayrı bozuk satırı olmaz, geri alma denetimi yine yapılır (madde 5)
      const kokNoSayac = harita[kok.yerelNo]
      if (Number.isSafeInteger(kokNoSayac) && !Number.isSafeInteger(harita.kok) && kok.kalici.acilisSayac !== null && kok.kalici.acilisSayac < kokNoSayac) {
        const e = new Error('STATE_ROLLED_BACK')
        if (!diskteki.size) {
          kok.kapat({ yazmadan: true })
          if (dht) dht.destroy().catch(() => {})
          throw e
        }
        ornekler.delete(kok.yerelNo)
        kok.kapat({ yazmadan: true })
        kok = null
        kokHata = e.message
      }
    }
    for (const y of Object.keys(harita)) if (y !== 'kok' && (!kok || y !== kok.yerelNo) && YEREL_NO.test(y) && !diskteki.has(y) && !bozuklar.has(y) && !acilistaSilinen.includes(y) && Number.isSafeInteger(harita[y])) bozuklar.set(y, 'STATE_ROLLED_BACK')
    for (const y of [...diskteki].sort()) {
      try {
        const o = await ornekAc(y, { sayacV: Number.isSafeInteger(harita[y]) ? harita[y] : null })
        const i = isaretOku(ailelerDizin + '/' + y)
        if (i && i.asama === 'bekliyor') o.ayrilma = { zaman: Number(i.zaman) || now() }
      } catch (err) {
        bozuklar.set(y, kodOf(err))
      }
    }
    if (kok && kokIsaret && kokIsaret.asama === 'bekliyor' && !kokSilindi) kok.ayrilma = { zaman: Number(kokIsaret.zaman) || now() }
    // Katılım örneği yeniden açılışta sürmez: ailesiz ek örnek silinir (tören süreçle birlikte bitti)
    for (const o of [...ornekler.values()]) if (!o.kok && !doluMu(o)) ornekSil(o)
    // Kapalıyken gelmiş çıkarılma ya da süresi dolmuş ayrılma
    for (const o of [...ornekler.values()]) { uyelikDenetle(o); ayrilmaSuresi(o) }

    // reddet kancası yalnız ürün sunucusunda varsa (yoksa ipc katmanı komutu kendisi reddeder)
    const ornekSunucu = (kok || [...ornekler.values()][0] || {}).sunucu
    if (!ornekSunucu || typeof ornekSunucu.reddet !== 'function') delete yonlendirici.reddet
    bag = ipcBagla({ ipc: akis, sunucu: yonlendirici })
    // Bağlantıdan önceki yazımların (ilk açılış, göç) sayacı kaybolmasın: bağlanınca son sayaç bir kez
    for (const o of ornekler.values()) if (o.gidenSayac !== o.kalici.sayac || etiketli(o)) olayGonder(o, 'persisted', { sayac: o.kalici.sayac })
    for (const y of acilistaSilinen) { cerceve({ olay: 'persisted', veri: { sayac: null }, aile: y }); ortakOlay('family-removed', { aile: y }) }
    if (kokHata) ortakOlay('family-error', { aile: 'kok', hata: kokHata })
    for (const [y, hata] of bozuklar) ortakOlay('family-error', { aile: y, hata })

    // Kasa 5 dakika işlemsizlikte kilitlenir (VaultApi.locked tembel denetler; burada düzenli yoklanır; örnek başına)
    const kasaDenetim = unref(setInterval(() => {
      for (const o of [...ornekler.values()]) {
        const k = o.kalici.nesneler.kasa
        if (k) k.locked()
        ayrilmaSuresi(o)
        uzaktanEtkinlestir(o)
        if (o.esitleyici && !o.kapandi) o.esitleyici.beklemeYokla() // bekleyen uzaktan üyenin süresi doldu: eşitleme açılır
      }
    }, kasaDenetimMs))
    // Görevlerin zaman aşımı ve yeniden denemesi uygulama ön planda değilken de yürür (RFC-0002 §8 madde 4)
    const gorevTick = unref(setInterval(() => {
      for (const o of ornekler.values()) {
        const g = o.kalici.nesneler.gorev
        if (g) try { g.tick() } catch (err) { o.c.cekirdekHatasi(err) }
      }
    }, gorevTickMs))

    const hepsiniKaydet = () => { for (const o of ornekler.values()) o.kaydet() }
    // Uygulama arka plana geçince (Bare Kit suspend) bütün örneklerin durumu yazılır. Taşıyıcı: örnekler oturumlarını
    // kapatır, paylaşılan düğüm bir kez askıya alınır; sürdürmede tersi (RFC-0034 §6, RFC-0028 §6; inceleme 25 madde 12)
    const taslar = () => [...ornekler.values()].filter((o) => o.tas).map((o) => o.tas.dt)
    const esitlemeyiGuncelle = () => { for (const o of ornekler.values()) if (o.esitleyici) o.esitleyici.esitlemeGuncelle() }
    const platform_ = {
      suspend: async () => { hepsiniKaydet(); if (!dht) return; await Promise.all(taslar().map((dt) => dt.askiya().catch(() => {}))); esitlemeyiGuncelle(); await dht.suspend().catch(() => {}) },
      resume: async () => { if (!dht) return; await dht.resume().catch(() => {}); await Promise.all(taslar().map((dt) => dt.devam().catch(() => {}))); esitlemeyiGuncelle() },
      arkaplan: () => { for (const dt of taslar()) dt.arkaPlan(true) },
      onplan: () => { for (const dt of taslar()) dt.arkaPlan(false) }
    }
    if (bareVar) for (const [ad, f] of Object.entries(platform_)) Bare.on(ad, f)

    let kapandi = false
    const w = {
      // Kök örnek (tek aileli kullanım ve testler); kök bozuksa null, sıfırlanınca yenisi
      get kalici () { return kok ? kok.kalici : null },
      get sunucu () { return kok ? kok.sunucu : null },
      get esitleyici () { return kok ? kok.esitleyici : null },
      get tasiyici () { return kok && kok.tas ? kok.tas.dt : undefined },
      aileBagla: (L) => kok.c.aileBagla(L),
      // Taşıyıcının (@havenfold/transport) cihaz kancası: kimlik, defter, aile bağlama ve tören anahtarları (RFC-0028 §7 c).
      // ek: { ad, cihazAdi } (törende karşı tarafa görünen)
      tasiyiciCihazi: (ek = {}) => kok.tasiyiciCihazi(ek),
      // Aile örnekleri (RFC-0034): yerelNo → { yerelNo, kok, kalici, sunucu, esitleyici, c }
      ornekler,
      ornek: (y) => ornekler.get(y) || null,
      aileler: () => aileListesi(),
      durum: bag.durum,
      kaydet: hepsiniKaydet,
      // yazmadan: süreç düşmüş gibi (test; durum yazılmaz, yalnız kaynaklar bırakılır)
      kapat ({ yazmadan = false } = {}) {
        if (kapandi) return
        kapandi = true
        if (!yazmadan) hepsiniKaydet()
        bag.kapat()
        clearInterval(kasaDenetim)
        clearInterval(gorevTick)
        if (katilim) clearTimeout(katilim.zaman)
        for (const yol of [...acilanlar.keys()]) acilanSil(yol)
        if (acilanDizin) dizinBosalt(acilanDizin)
        if (bareVar && typeof Bare.off === 'function') for (const [ad, f] of Object.entries(platform_)) Bare.off(ad, f)
        // Ek örnekler önce, kök örnek (dizin kilidi) en son
        const bekle = []
        for (const o of [...ornekler.values()].reverse()) bekle.push(o.kapat({ yazmadan: true }))
        if (dht) Promise.all(bekle).then(() => dht.destroy()).catch(() => {})
        calisan = null
      }
    }
    calisan = w
    return w
  }
}

module.exports = { start, ACILAN_OMUR_MS, GOREV_TICK_MS, AILE_EN_COK, AILE_KOMUT, klasorSil }
