// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// placement.js — isteyen telefonun yerleştirmesi (RFC-0002 §8)
//
// Seçim belirlenimcidir: aynı bildirimlerden, aynı onaylardan ve aynı saatten her telefon aynı adayları aynı sırayla
// bulur. Bölme tamsayı aritmetiğiyle yapılır (kesirli kısım = kalan). Yeniden deneme durum makinesi saf tutulur:
// eylemleri döner, görevi imzalayıp göndermek çağıranın işidir.
const b4a = require('b4a')
const { turGirdisi } = require('./capability')

const hex = (b) => (typeof b === 'string' ? b : b4a.toString(b, 'hex'))
function fail (code) { throw new Error(code) }

const KABUL_SURESI_MS = 30_000
const EN_COK_DENEME = 3
const BACKUP = 'hf.task.backup'

// battery null: pili yok, prizde sayılır
const prizde = (caps) => !caps.battery || caps.battery.onAC

// §8 madde 2: a, b'den önce gelir eğer a.load × b.cores < b.load × a.cores; eşitlikte prizdeki, sonra küçük kimlik
function karsilastir (a, b) {
  const x = a.caps.load1x100 * b.caps.cores
  const y = b.caps.load1x100 * a.caps.cores
  if (x !== y) return x < y ? -1 : 1
  if (prizde(a.caps) !== prizde(b.caps)) return prizde(a.caps) ? -1 : 1
  return b4a.compare(b4a.from(a.id, 'hex'), b4a.from(b.id, 'hex'))
}

const sirala = (adaylar) => [...adaylar].sort(karsilastir)

// §8 madde 1. defter: YetenekDefteri; uye: isteyenin kimliği (onay anahtarı); onay: OnayDefteri.
// İçerik gören işi yalnız işçi sınıfı alır; kutu içerik görmez, yalnız şifreli yedeği tutar (kurucu §4, H4).
// uygun: ek süzgeç (n → bool); RFC-0008 §5 özellik denetimi (@havenfold/edge profil.yerlestirmeSuzgeci) bununla verilir.
function adaylar (defter, { type, version, ramMB, standing = false, uye, onay, now = defter.now(), uygun = null }) {
  const out = []
  for (const n of defter.cevrimici(now)) {
    const c = n.caps
    if (!(c.class === 'isci' || (c.class === 'kutu' && type === BACKUP))) continue
    if (c.cores < 1 || !turGirdisi(c, type, version, { standing })) continue
    if (c.maxTaskRamMB < ramMB || c.status !== 'hazir') continue
    if (!onay.var(uye, n.id)) continue
    if (uygun && !uygun(n)) continue
    out.push(n)
  }
  return sirala(out)
}

// §8 madde 3: birim sayısını çekirdeklerle orantılı paylaştırır. cores: sıralanmış adayların çekirdekleri.
// Dönüş: her adayın birim sayısı (aynı sırayla); 0 alan adaya parça verilmez.
function bol (birim, cores) {
  const toplam = cores.reduce((a, b) => a + b, 0)
  if (!Number.isSafeInteger(birim) || birim < 1 || toplam < 1) fail('INVALID_DIVISION')
  const pay = cores.map((c) => Math.floor((birim * c) / toplam))
  const kalan = cores.map((c, i) => ({ i, r: (birim * c) % toplam })) // kesirli kısım × toplam
  let artan = birim - pay.reduce((a, b) => a + b, 0)
  kalan.sort((a, b) => b.r - a.r || a.i - b.i) // eşitlikte sıralamada önce gelen
  for (const { i } of kalan) {
    if (artan === 0) break
    pay[i]++
    artan--
  }
  return pay
}

// Parçalar: bölünürse ardışık birim aralıkları (1'den başlar), bölünmezse ilk adaya tek parça
function planla (siraliAdaylar, { birim = 1, bolunur = false } = {}) {
  if (!siraliAdaylar.length) return []
  if (!bolunur) return [{ no: 0, isci: siraliAdaylar[0].id, from: 1, to: birim }]
  const pay = bol(birim, siraliAdaylar.map((a) => a.caps.cores))
  const out = []
  let bas = 1
  pay.forEach((n, i) => {
    if (n < 1) return // her parça en az 1 birim
    out.push({ no: out.length, isci: siraliAdaylar[i].id, from: bas, to: bas + n - 1 })
    bas += n
  })
  return out
}

// §8 madde 5: aday yoksa iş telefonda yapılır ya da "Bu iş için evde uygun cihaz yok" denir
const adaySonucu = (siraliAdaylar, telefondaYapilabilir) =>
  siraliAdaylar.length ? { yer: 'isci' } : telefondaYapilabilir ? { yer: 'telefon' } : { yer: null, hata: 'NO_ELIGIBLE_DEVICE' }

// §8 madde 4: TASK_ACCEPT 30 saniyede gelmezse, TASK_REJECT gelirse, TASK_RESULT deadline'a kadar gelmezse ya da
// 'hata' / 'sure' ile gelirse parça sıradaki adaya verilir. Aynı parça en çok 3 kez denenir. Her denemede yeni taskId
// gerekir (workerId göreve imzalıdır, §6.1). Sırada bir sonraki aday: güncel sıralı listede son denenenden sonra gelen,
// bu parça için denenmemiş ilk aday.
//
// Eylemler: { eylem: 'gonder', parca, isci, deneme, deadline } · { eylem: 'iptal', parca, taskId, isci }
//           { eylem: 'basarisiz', parca, code } · { eylem: 'bitti', sonuclar }
// Her deneme kendi deadline'ını taşır: şimdi + ilk süre, üst sınırla (RFC-0019 §11.2 d). sure: ilk süre (ms),
// ustSinir: mutlak son an (ms). Görev imzalanamazsa çağıran gonderilemedi() der ve parça başarısız olur.
class Yerlestirici {
  constructor ({ parcalar, adaylar: adayListesi, sure = null, ustSinir = Infinity, now = Date.now }) {
    this.adaylar = adayListesi // () → sıralı aday kimlikleri (hex)
    this.sure = sure
    this.ustSinir = ustSinir
    this.now = now
    this.p = parcalar.map((x) => ({ ...x, deneme: 0, denenen: [], taskId: null, durum: 'yeni', sonuc: null }))
    this.byTask = new Map() // taskIdHex → parça no
  }

  baslat () {
    return this.p.map((x) => this._gonder(x, x.isci)).filter(Boolean)
  }

  _gonder (x, isci) {
    x.isci = isci
    x.deneme++
    x.denenen.push(isci)
    x.durum = 'gonderilecek'
    const deadline = this.sure === null ? null : Math.min(this.now() + this.sure, this.ustSinir)
    return { eylem: 'gonder', parca: x.no, isci, deneme: x.deneme, deadline }
  }

  // İmzalama ya da gönderim hata verdi: parça başarısız (inceleme görev 2)
  gonderilemedi (parca, code = 'SEND_FAILED') {
    const x = this.p[parca]
    if (x.durum !== 'gonderilecek') return []
    x.durum = 'basarisiz'
    return [{ eylem: 'basarisiz', parca: x.no, code }]
  }

  // Kullanıcı iptal etti: parça başka işçiye gitmez; gönderilmişse işçiye iptal gider (inceleme görev 3)
  iptal (parca) {
    const x = this.p[parca]
    if (x.durum === 'bitti' || x.durum === 'basarisiz' || x.durum === 'iptal') return []
    const gitti = x.durum === 'bekliyor' || x.durum === 'kabul'
    x.durum = 'iptal'
    return gitti ? [{ eylem: 'iptal', parca: x.no, taskId: x.taskId, isci: x.isci }] : []
  }

  // Bütün parçaları iptal eder
  hepsiniIptal () { return this.p.flatMap((x) => this.iptal(x.no)) }

  // Çağıran görevi imzaladıktan ve gönderdikten sonra bildirir
  gonderildi (parca, taskId, deadline, at = this.now()) {
    const x = this.p[parca]
    if (x.durum !== 'gonderilecek') return
    x.taskId = hex(taskId)
    x.deadline = deadline
    x.gonderimAt = at
    x.durum = 'bekliyor'
    this.byTask.set(x.taskId, parca)
  }

  // Yalnız parçanın şu anki işçisinden gelen cevap işlenir; eski taskId'ye gelen geç cevap atılır
  _parca (taskId, from) {
    const no = this.byTask.get(hex(taskId))
    if (no === undefined) return null
    const x = this.p[no]
    if (x.taskId !== hex(taskId) || x.isci !== hex(from)) return null
    if (x.durum !== 'bekliyor' && x.durum !== 'kabul') return null
    return x
  }

  kabul (taskId, from) {
    const x = this._parca(taskId, from)
    if (!x || x.durum !== 'bekliyor') return []
    x.durum = 'kabul'
    return []
  }

  red (taskId, from) {
    const x = this._parca(taskId, from)
    return x ? this._yenidenDene(x, false) : []
  }

  // result: çözülmüş TASK_RESULT
  sonuc (taskId, from, result) {
    const x = this._parca(taskId, from)
    if (!x) return []
    if (result.status === 'ok') {
      x.durum = 'bitti'
      x.sonuc = result
      return this._bittiMi()
    }
    if (result.status === 'iptal') {
      x.durum = 'basarisiz'
      return [{ eylem: 'basarisiz', parca: x.no, code: 'CANCELLED' }]
    }
    return this._yenidenDene(x, false)
  }

  tick (now = this.now()) {
    const out = []
    for (const x of this.p) {
      // Zaman aşımında eski işçiye iptal gider: kabul mesajı yolda kaybolmuş olabilir
      if (x.durum === 'bekliyor' && now - x.gonderimAt >= KABUL_SURESI_MS) out.push(...this._yenidenDene(x, true))
      else if (x.durum === 'kabul' && now >= x.deadline) out.push(...this._yenidenDene(x, true))
    }
    return out
  }

  _yenidenDene (x, iptalGonder) {
    const out = []
    if (iptalGonder) out.push({ eylem: 'iptal', parca: x.no, taskId: x.taskId, isci: x.isci })
    x.durum = 'yeni'
    if (x.deneme >= EN_COK_DENEME) {
      x.durum = 'basarisiz'
      return [...out, { eylem: 'basarisiz', parca: x.no, code: 'TRIAL_ENDED' }]
    }
    const liste = this.adaylar()
    const i = liste.indexOf(x.isci)
    const sirada = [...liste.slice(i + 1), ...liste.slice(0, Math.max(i, 0))].find((id) => !x.denenen.includes(id))
    if (!sirada) {
      x.durum = 'basarisiz'
      return [...out, { eylem: 'basarisiz', parca: x.no, code: 'NO_ELIGIBLE_DEVICE' }]
    }
    return [...out, this._gonder(x, sirada)]
  }

  _bittiMi () {
    if (!this.p.every((x) => x.durum === 'bitti')) return []
    return [{ eylem: 'bitti', sonuclar: this.p.map((x) => ({ parca: x.no, from: x.from, to: x.to, isci: x.isci, sonuc: x.sonuc })) }]
  }
}

module.exports = { KABUL_SURESI_MS, EN_COK_DENEME, karsilastir, sirala, adaylar, bol, planla, adaySonucu, Yerlestirici }
