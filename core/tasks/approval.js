// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// approval.js — ilk kullanım onayı (RFC-0002 §7, kurucu §8.4)
//
// Telefon bir üyenin verisini bir işçiye ilk kez göndermeden önce üyeye sorar. Cevap (üye, deviceId) çifti için
// üyenin telefonunda saklanır; Arşiv katmanına ve üyenin yedeğine ürün yazar (toJSON / fromJSON), aileyle paylaşılmaz.
// İşçi çıkarılıp yeniden eklenirse deviceId yenidir; onay kendiliğinden yeniden sorulur.
const b4a = require('b4a')

const hex = (b) => (typeof b === 'string' ? b : b4a.toString(b, 'hex'))
const key = (uye, cihaz) => hex(uye) + '|' + hex(cihaz)

// §7'deki soru. Ek, cihaz adının ünlü uyumuna bağlı olmasın diye "<ad> cihazında" biçimi kullanılır.
const soruMetni = (cihazAdi) =>
  `Bu iş evdeki ${cihazAdi} cihazında yapılacak. ${cihazAdi} belgeyi işi bitirene kadar görür, sonra siler. İzin veriyor musun?`

// Onay kişi başınadır (RFC-0019 4.14, RFC-0017 §4.3): anahtar (personId, deviceId). personOf(kimlik) → personId; verilmezse
// kimliğin kendisi (tek uygulamalı aile). Aynı telefondaki uygulamalar onayı yerel kanaldan paylaşır.
class OnayDefteri {
  constructor (kayitlar = [], { personOf = null } = {}) {
    this.personOf = personOf
    this.m = new Map() // "kisi|cihaz" → { izin, at }
    for (const k of kayitlar) this.m.set(key(k.uye, k.cihaz), { izin: k.izin, at: k.at })
  }

  _k (uye, cihaz) { return key((this.personOf && this.personOf(hex(uye))) || uye, cihaz) }

  // Kişinin bu cihaza verisini göndermeye izni var mı
  var (uye, cihaz) { return this.m.get(this._k(uye, cihaz))?.izin === true }

  // Onayın zamanı (ms) ya da null (YzYetenek.isciler[].onayAt, D15 11)
  zaman (uye, cihaz) { const x = this.m.get(this._k(uye, cihaz)); return x && x.izin === true ? x.at : null }

  // Hiç sorulmamışsa true: telefon göndermeden önce sorar
  soruGerekli (uye, cihaz) { return !this.m.has(this._k(uye, cihaz)) }

  // Cevap ya da "Verilerimi bu cihaza gönder" anahtarı
  ver (uye, cihaz, izin, at = Date.now()) { this.m.set(this._k(uye, cihaz), { izin: !!izin, at }) }

  // Koordinatörlü işte belgedeki her işçi için onay aranır: onayı olmayanlar
  eksikler (uye, cihazlar) { return cihazlar.map(hex).filter((c) => !this.var(uye, c)) }

  // Defterde artık aktif olmayan cihazların kayıtları (yeni deviceId yeni onay ister; eskisi işe yaramaz)
  temizle (L) {
    for (const k of [...this.m.keys()]) if (!L.devices.get(k.split('|')[1])?.active && L.sessionRole(k.split('|')[1]) !== 'uye') this.m.delete(k)
  }

  toJSON () { return [...this.m].map(([k, v]) => ({ uye: k.split('|')[0], cihaz: k.split('|')[1], izin: v.izin, at: v.at })) }
  static fromJSON (a, opts) { return new OnayDefteri(a, opts) }
}

module.exports = { OnayDefteri, soruMetni }
