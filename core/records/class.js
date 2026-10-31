// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// class.js — hf. türlerinde katalogdaki yazar sınıfı (RFC-0006 §5.2, RFC-0019 §11.1 d, l)
//
// Katalogda yazar sınıfı olan bir hf. türünün kaydında, sınıfa uymayan yazarın işlemi geçerli kümede kalır ama
// görünüme ve temizliğe katılmaz. Sınıf işlemin ledgerSeq anındaki role göre denetlenir:
//   uye: yazar o anda üye (telefon); cihaz: yazar cihaz; ikisi: ikisi de;
//   kendi: yalnız kaydı oluşturan üye (RFC-0036 §3.3 madde 2–3): kayda yalnız onun işlemleri katılır ve türü belirleyen
//   işlemin _subj'i 'uye:<yazar>' olmalıdır (çözülmez, rotatedTo uygulanmaz); değilse kaydın hiçbir işlemi katılmaz.
//   Kutu ve cihaz bu sınıfa uymaz. Hata kodu yoktur: uymayan işlem görünüme girmez.
// hf.saklama'yı yalnız ebeveyn yazar (§11.1 d). Katalogda olmayan türlere ve hf. dışı türlere bakılmaz.
const b4a = require('b4a')
const KATALOG = require('@havenfold/core/protocol/event-types.json') // RFC-0020 69: katalog pakete kopyalanır

const SINIF = new Map(KATALOG.turler.map((t) => [t.tur, t.yazar]))
const YALNIZ_EBEVEYN = new Set(['hf.saklama'])

const sinifOf = (type) => (typeof type === 'string' && type.startsWith('hf.') ? SINIF.get(type) || null : null)

// kendi sınıfı: işlem kaydı oluşturan yazarın mı ve kaydın _subj'i o yazar mı (st: reduceRecord durumu)
function kendininMi (o, st) {
  const sahip = st && st.typeStamp && st.typeStamp.authorId
  if (!sahip || !b4a.equals(o.inner.authorId, sahip)) return false
  const subj = st.fields.get('_subj')
  return !!subj && subj.value === 'uye:' + b4a.toString(sahip, 'hex')
}

// rol: işlemin ledgerSeq anında yazarın rolü ('cihaz' ya da üyenin rolü; bilinmiyorsa null).
// o, st: kendi sınıfında işlem ve kaydın durumu (birlestir.reduceAll verir).
// Dönüş: işlem bu türün kaydına katılabilir mi
function sinifaUyar (type, rol, o = null, st = null) {
  const s = sinifOf(type)
  if (!s) return true
  if (!rol) return false
  if (s === 'kendi') return rol !== 'cihaz' && rol !== 'kutu' && !!o && kendininMi(o, st)
  if (YALNIZ_EBEVEYN.has(type)) return rol === 'ebeveyn' || rol === 'sahip' // ekipte sahip (RFC-0005 §14)
  if (s === 'ikisi') return true
  return s === 'cihaz' ? rol === 'cihaz' : rol !== 'cihaz'
}

module.exports = { sinifOf, sinifaUyar, YALNIZ_EBEVEYN }
