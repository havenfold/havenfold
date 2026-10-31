// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// command.js — `havenfold` komutu (RFC-0007 §7). Bu sürümde: status, join, setup, version, screen. Diğerleri sonraki adımlarda.
// Eski Türkçe alt komutlar (durum, katil, ilk-ayar, surum, ekran) takma ad olarak çalışır: kurulu kutuların birimleri ve notları.
//
// Çekirdeklerle ve denetçiyle yönetim soketlerinden konuşur (YONETIM_SOKETI; grup havenfold-yonetim). Soket erişimi 'baglanti' kancasından geçer: { istek(kapsam, type, mesaj) → Promise<{ type, mesaj }>,
// akis(kapsam, type, mesaj) → AsyncIterable<{ type, mesaj }> }. Çıkış kodları: 0 tamam, 1 kullanım, 2 yetki yok,
// 3 durum uygun değil, 4 ağ, 5 doğrulama başarısız.
const { IPC } = require('./ipc/types')
const { qrKodla, terminaleCiz } = require('./qr')

const KOD = { TAMAM: 0, KULLANIM: 1, YETKI: 2, DURUM: 3, AG: 4, VERIFICATION_FAILED: 5 }
// Yönetim soketlerinin tek tanımı (RFC-0007 §6.1, RFC-0026 f): çekirdeklerinki kendi /run/havenfold/<rol>/ dizininde;
// denetçininki ayrı dizinde, çünkü /run/havenfold/denetci/ çekirdeklerin bağlandığı dizindir (grup havenfold-cekirdek)
// ve yönetim grubu oraya giremez. bin/havenfold ve denetçi (supervisor-main.js) buradan alır.
const YONETIM_SOKETI = {
  kutu: '/run/havenfold/kutu/yonetim.sock',
  isci: '/run/havenfold/isci/yonetim.sock',
  denetci: '/run/havenfold/denetci-yonetim/yonetim.sock'
}
const ROLLER = ['isci', 'kutu', 'birlesik']
const TOREN_MS = 10 * 60_000

const kisa = (id) => (typeof id === 'string' && id.length >= 8 ? id.slice(0, 8) : '—')
const evetHayir = (x) => (x ? 'evet' : 'hayır')

// Durum özeti (§7 satır 1). d: { kimlikler: [{ rol, id, bagli, duzey, oturum }], gorevler, uyarilar, surum, kanal,
// tpm, disk, pil: { limit, start, stop } | null }
function durumMetni (d) {
  const s = []
  for (const k of d.kimlikler || []) {
    s.push(`${k.rol === 'kutu' ? 'Kutu' : 'İşçi'} kimliği ${kisa(k.id)} · topluluğa bağlı: ${evetHayir(k.bagli)} · defter düzeyi ${k.duzey || '—'} · açık oturum ${k.oturum ?? 0}`)
  }
  if (!(d.kimlikler || []).length) s.push('Kimlik yok: henüz topluluğa katılmadı (havenfold katil)')
  s.push(`Çalışan görev: ${(d.gorevler || []).length ? d.gorevler.join(', ') : 'yok'}`)
  s.push(`Sürüm ${d.surum || '—'} · kanal ${d.kanal || '—'}`)
  s.push(`TPM: ${d.tpm || '—'} · disk: ${d.disk || '—'}`)
  s.push(`Pil sınırı: ${d.pil ? (d.pil.limit === 'yok' ? 'yok' : `${d.pil.start}–${d.pil.stop} (${d.pil.limit})`) : 'pil yok'}`)
  s.push(`Uyarılar: ${(d.uyarilar || []).length ? d.uyarilar.join(', ') : 'yok'}`)
  return s.join('\n')
}

async function durum (baglanti, yaz) {
  const parcalar = {}
  let yetkisiz = false
  for (const kapsam of ['denetci', 'kutu', 'isci']) {
    try {
      const r = await baglanti.istek(kapsam, IPC.DURUM_ISTE, {})
      if (r.type === IPC.DURUM_CEVAP) parcalar[kapsam] = JSON.parse(r.mesaj.json)
    } catch (err) {
      // Bir kapsama yetki yoksa (ör. denetçi dizini havenfold-cekirdek grubunun) öbürlerine bakılır (D76)
      if (err.code === 'EACCES') yetkisiz = true
      // kimliği olmayan çekirdek çalışmaz; soketi yoktur
    }
  }
  if (yetkisiz && !Object.keys(parcalar).length) return KOD.YETKI
  // Denetçisiz kutu (D76: var olan Ubuntu'da yalnız kutu çekirdeği): kutu kendi durumunu verir
  if (!parcalar.denetci && !parcalar.kutu) { yaz('Denetçiye bağlanılamadı (havenfold-denetci çalışıyor mu?)'); return KOD.DURUM }
  const d = { ...(parcalar.denetci || parcalar.kutu), kimlikler: ['kutu', 'isci'].filter((k) => parcalar[k]).map((k) => ({ rol: k, ...parcalar[k] })) }
  for (const k of ['kutu', 'isci']) if (parcalar[k]?.gorevler) d.gorevler = [...(d.gorevler || []), ...parcalar[k].gorevler]
  yaz(durumMetni(d))
  const k = parcalar.kutu
  if (k && k.tasiyici) {
    yaz(`Aile: ${k.aile ? (k.aile.ad || 'adsız') + ' · ' + k.aile.uye + ' kişi' : 'yok'} · taşıyıcı: ${k.tasiyici.acik ? 'açık' : 'kapalı'} (${k.tasiyici.dinleme} dinleme, ${k.tasiyici.oturum} oturum)`)
    yaz(`Depolama: ${k.depolama.emanet} işlem emanette · ${k.depolama.dosya} dosya · ${k.depolama.pay} pay · ${k.depolama.zarf} kasa zarfı`)
  }
  return KOD.TAMAM
}

async function surum (baglanti, yaz) {
  let yetkisiz = false
  for (const kapsam of ['denetci', 'kutu']) {
    try {
      const r = await baglanti.istek(kapsam, IPC.DURUM_ISTE, {})
      if (r.type !== IPC.DURUM_CEVAP) continue
      const d = JSON.parse(r.mesaj.json)
      yaz(`havenfold-node ${d.surum || '—'} · kanal ${d.kanal || '—'}`)
      return KOD.TAMAM
    } catch (err) {
      if (err.code === 'EACCES') yetkisiz = true
    }
  }
  if (yetkisiz) return KOD.YETKI
  yaz('Sürüm bilgisi alınamadı: denetçiye bağlanılamadı (havenfold-denetci çalışıyor mu?)')
  return KOD.DURUM
}

// Durum ekranı (§4.3, §9 adım 12): havenfold-ekran.service tty1'de çalıştırır. Durumu aralıkla yeniden okur ve yalnız
// metin değişince yeniden çizer. Denetçi ya da çekirdek henüz açılmadıysa ya da soket hata verirse düşmez, bir sonraki
// turda yeniden dener: birim açılışta denetçiden önce kalkabilir. Linux konsolunun kararma süresi 1 dakikaya kurulur
// (CSI 9;1 ]; tuşa basınca açılır); başka terminalde bu dizi yok sayılır. Bağlanıp cevap vermeyen soket döngüyü
// durdurmasın diye her istek istekMs'de kesilir (TIMEOUT; o kapsam yok sayılır). turSayisi ve bekle testler içindir.
const KARARMA = '\x1b[9;1]'
const EKRAN_ARALIK_MS = 10_000
const EKRAN_ISTEK_MS = 5_000

function zamanli (baglanti, ms) {
  return {
    ...baglanti,
    istek (...a) {
      let zaman
      const z = new Promise((resolve, reject) => { zaman = setTimeout(() => reject(Object.assign(new Error('TIMEOUT'), { code: 'TIMEOUT' })), ms) })
      return Promise.race([baglanti.istek(...a), z]).finally(() => clearTimeout(zaman))
    }
  }
}

async function ekran (baglanti, yaz, { aralikMs = EKRAN_ARALIK_MS, istekMs = EKRAN_ISTEK_MS, bekle = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), turSayisi = Infinity } = {}) {
  const b = zamanli(baglanti, istekMs)
  let onceki = null
  for (let tur = 0; tur < turSayisi; tur++) {
    const satirlar = []
    let kod
    try { kod = await durum(b, (s) => satirlar.push(s)) } catch (err) { kod = KOD.DURUM; satirlar.push('Durum okunamadı: ' + (err.code || err.message)) }
    if (kod === KOD.YETKI) satirlar.push('Yönetim soketlerine erişim yok (havenfold-yonetim grubu).')
    if (kod !== KOD.TAMAM) satirlar.push(`Yeniden deneniyor (${Math.round(aralikMs / 1000)} saniye).`)
    const metin = 'Havenfold\n\n' + satirlar.join('\n')
    if (metin !== onceki) {
      yaz((onceki === null ? KARARMA : '') + '\x1b[2J\x1b[H' + metin)
      onceki = metin
    }
    if (tur + 1 < turSayisi) await bekle(aralikMs)
  }
  return KOD.TAMAM
}

// Tören (§7 satır 2, §4.2): QR yarım blokla çizilir (Linux konsolunda qrCiz ile çerçeve arabelleğine piksel olarak),
// 60 saniyede yenilenir, her yeni QR yeniden çizilir; 5 resmin adı metin olarak. Birleşik rolde dürüstlük notu
// törenden önce, sonra kutu, ardından işçi töreni. 10 dakikada tamamlanmazsa durur: süre çekirdekten mesaj gelmese de
// işler (inceleme 11 şüpheli).
const DURUST = 'Bu cihazı ele geçiren biri kutu ve işçi kimliklerinin ikisine de ulaşabilir.' // §4.2 dürüstlük notu
const TIMEOUT = Symbol('zaman-asimi')

// pngYaz(metin): QR'ı PNG olarak da yazar (bin/havenfold: ~/havenfold-katil.png). Kutu QR'ı önce resimsiz gönderir;
// telefon okutunca aynı türde 5 resmin adları gelir (D76). Eski biçim (QR ile birlikte 5 resim) de geçerlidir.
// qrCiz(metin): QR'ı kendisi çizer (bin/havenfold: tty1'de /dev/fb0, node/qr-screen.js) ve imleci QR'ın altına taşıyan
// diziyi döner; null dönerse yarım blok çizimi.
async function katil (baglanti, yaz, { rol = 'isci', simdi = Date.now, torenMs = TOREN_MS, pngYaz = null, qrCiz = null } = {}) {
  if (!ROLLER.includes(rol)) return KOD.KULLANIM
  const sira = rol === 'birlesik' ? ['kutu', 'isci'] : [rol]
  if (rol === 'birlesik') yaz(DURUST)
  for (const [i, r] of sira.entries()) {
    if (sira.length > 1) yaz(i === 0 ? 'Birleşik cihaz: önce kutu kimliği.' : 'Aynı cihazın işçi kimliği.')
    const bitis = simdi() + torenMs
    const it = baglanti.akis(r, IPC.KATIL_BASLAT, { rol: r })[Symbol.asyncIterator]()
    let sonuc = null
    while (true) {
      let zaman
      const z = new Promise((resolve) => { zaman = setTimeout(() => resolve(TIMEOUT), Math.max(0, bitis - simdi())) })
      const x = await Promise.race([it.next(), z])
      clearTimeout(zaman)
      if (x === TIMEOUT || simdi() >= bitis) {
        if (it.return) it.return()
        yaz('Tören 10 dakikada tamamlanmadı. Yeniden denemek için komutu yeniden çalıştırın.')
        return KOD.DURUM
      }
      if (x.done) break
      const m = x.value
      if (m.type === IPC.KATIL_QR) {
        const resim = m.mesaj.resimler
        if (!Array.isArray(resim) || (resim.length !== 5 && resim.length !== 0) || (!resim.length && !m.mesaj.qr)) { yaz('Tören verisi geçersiz: 5 resim beklenir.'); return KOD.VERIFICATION_FAILED }
        if (m.mesaj.qr) {
          let piksel = null
          if (qrCiz) { try { piksel = qrCiz(m.mesaj.qr) } catch {} }
          yaz(piksel ?? '\x1b[2J\x1b[H' + terminaleCiz(qrKodla(m.mesaj.qr)))
          if (pngYaz) { try { yaz('QR resim olarak: ' + pngYaz(m.mesaj.qr)) } catch {} }
          yaz(r === 'kutu' ? 'Telefonda "Cihaz ekle → Aile Kutusu"yu seçip okutun.' : 'Telefonda "Cihaz ekle → Ev Makinesi"ni seçip okutun.')
        }
        if (resim.length) yaz('Telefonda şu 5 resim görünmeli: ' + resim.join(' · '))
        yaz(m.mesaj.qr ? `QR ${m.mesaj.kalanSn} saniye geçerli.` : `Kalan süre ${m.mesaj.kalanSn} saniye.`)
      } else if (m.type === IPC.KATIL_SONUC) { sonuc = m.mesaj; break } else if (m.type === IPC.HATA) { yaz('Tören başlatılamadı: ' + m.mesaj.code); return KOD.DURUM }
    }
    if (!sonuc || !sonuc.ok) { yaz('Tören tamamlanamadı' + (sonuc ? ': ' + sonuc.code : '')); return sonuc && sonuc.code === 'VERIFICATION_FAILED' ? KOD.VERIFICATION_FAILED : KOD.DURUM }
    yaz(r === 'kutu' ? 'Kutu kimliği topluluğa eklendi.' : 'İşçi kimliği topluluğa eklendi.')
  }
  return KOD.TAMAM
}

const KULLANIM = 'Kullanım: havenfold status | join [--role isci|kutu|birlesik] | setup | version | screen'
const TAKMA_AD = { durum: 'status', katil: 'join', 'ilk-ayar': 'setup', surum: 'version', ekran: 'screen' }

async function ana (argv, { baglanti, yaz = (s) => console.log(s), surumBilgisi = null, pngYaz = null, qrCiz = null } = {}) {
  const [ad, ...arg] = argv
  const komut = Object.prototype.hasOwnProperty.call(TAKMA_AD, ad) ? TAKMA_AD[ad] : ad
  if (komut === 'status') return durum(baglanti, yaz)
  if (komut === 'join') {
    // --role; --rol eski ad (kurulum betikleri). Yalnız iki biçim: argümansız (işçi) ya da tam iki argümanlı geçerli
    // rol seçimi. Tanınmayan bayrak, çıplak argüman ya da değersiz --role sessizce işçi töreni başlatmasın (Codex 12–13. tur)
    const rolSecimi = arg.length === 2 && (arg[0] === '--role' || arg[0] === '--rol') && ROLLER.includes(arg[1])
    if (arg.length !== 0 && !rolSecimi) { yaz(KULLANIM); return KOD.KULLANIM }
    return katil(baglanti, yaz, { rol: rolSecimi ? arg[1] : 'isci', pngYaz, qrCiz })
  }
  if (komut === 'screen') return ekran(baglanti, yaz) // havenfold-ekran.service
  if (komut === 'setup') return require('./setup').ana(arg, { yaz }) // RFC-0007 §8.3, §9 adım 7
  if (komut === 'version') {
    const b = surumBilgisi ? await surumBilgisi() : null
    if (b) {
      yaz(`havenfold-node ${b.paket} · çekirdek ${b.cekirdek} · denetçi ${b.denetci} · kök anahtar ${b.kokFp.slice(0, 16)}… (dönem ${b.keyEpoch})`)
      return KOD.TAMAM
    }
    // bin/havenfold surumBilgisi vermez: sürüm ve kanal denetçinin (yoksa kutunun) durumundan (Codex 12. tur: komut
    // önceden hiçbir şey yazmadan 3 ile çıkıyordu)
    return surum(baglanti, yaz)
  }
  if (['kur', 'emekli', 'usb-hazirla', 'sil-usb-hazirla', 'guncelle', 'geri-al', 'kanal', 'pil', 'wifi', 'gunluk', 'tani', 'kok-sabitle', 'kaldir'].includes(komut)) {
    yaz(`'havenfold ${komut}' bu sürümde yok.`)
    return KOD.DURUM
  }
  yaz(KULLANIM)
  return KOD.KULLANIM
}

module.exports = { KOD, YONETIM_SOKETI, ana, durum, katil, ekran, durumMetni }
