// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// box-transport.js — kutunun ağ taşıyıcısı (RFC-0028 §7 d, D58). Telefonda bayrakla, düğümde açık: kurucu `deneysel: true`
// olmadan EXPERIMENTAL_DISABLED verir, ama kutu (box.js) bayrağı koddan verir ve taşıyıcıyı her zaman açar (düğümün işi).
//
// Kutu telefonlarla aynı buluşmayı kullanır: çift sırrından saatlik dilimle türeyen dinleme ve arama anahtarları,
// Noise üstünde HELLO ile oturum (worklet/tasiyici). Rolü `kutu`: kutunun kimliği defterde başka bir rolde görünürse
// buluşmaya girmez (kutu oy vermez, kayıt okumaz; RFC-0001 §12.2). Kutu arka plana geçmediği için askıya alınmaz. Tören
// (QR'ı kutu gösterir, telefon tarar) aynı taşıyıcının tören kancasıyla.
// Taşıyıcı /tasiyici paketindedir (core/transport; telefon ve düğüm ortak).
'use strict'

function fail (code) { throw new Error(code) }

// dht: HyperDHT düğümü; cihaz(): { kimlik, ledger, defter, aileBagla, now } (worklet Kalici'nin görüntüsü)
function kutuTasiyici ({ dht, cihaz, deneysel = false, ...secenek }) {
  if (deneysel !== true) fail('EXPERIMENTAL_DISABLED')
  if (!dht) fail('NO_DHT')
  const { DhtTasiyici } = require('@havenfold/transport')
  const { dhtTorenTasiyici } = require('@havenfold/transport/ceremony')
  const b4a = require('b4a')
  // Ailedeyken yalnız kutu rolüyle; aile yoksa (tören bekleniyor) taşıyıcı boş kalır
  const kutuOlarak = () => {
    const d = cihaz()
    if (!d || !d.ledger) return d
    const m = d.ledger.members.get(b4a.toString(d.kimlik.memberId, 'hex'))
    return m && m.active && m.role === 'kutu' ? d : null
  }
  // cihazlar: aynı evdeki işçi kutuyu arar ve afet UYARI'larını bırakır (RFC-0012 §6.4, §10; D90). Kutunun cihaz
  // oturumunda zarf süzgeci 'cihaz|uye' tablosudur (envelope.js); kutu kayıt okumaz.
  const tasiyici = new DhtTasiyici({ dht, cihaz: kutuOlarak, deneysel: true, cihazlar: true, ...secenek })
  const toren = dhtTorenTasiyici({ dht, cihaz, tamam: () => tasiyici.yokla(), deneysel: true })
  return { tasiyici, toren, ag: tasiyici.ag }
}

module.exports = { kutuTasiyici }
