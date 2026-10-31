// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// network.js — önyükleme listesi ve uygulama başına DHT düğümü (RFC-0028 §7 e, f; D74)
//
// Önyükleme düğümleri paketle (sürümle) gelen bootstrap.json'dan okunur: genel HyperDHT düğümleri ve EserX'in yedek
// düğümleri. Uzaktan değiştirme yolu yoktur. Aynı telefondaki her uygulama kendi DHT düğümünü açar (yalıtım; taşıyıcının
// yerel kanaldan paylaşılması ayrı karar, RFC-0017 §10).
'use strict'
const DHT = require('hyperdht')
const LISTE = require('./bootstrap.json')

function fail (code) { throw new Error(code) }
const BICIM = /^(?:\d{1,3}(?:\.\d{1,3}){3}@)?[A-Za-z0-9.-]+:\d{1,5}$/

// Dönüş: genel + EserX düğümleri ("ip@ad:port" dizgileri, HyperDHT'nin bootstrap biçimi); biçimsiz girdi INVALID_BOOTSTRAP
function onyukleme (liste = LISTE) {
  const out = [...(liste.genel || []), ...(liste.eserx || [])]
  for (const x of out) if (typeof x !== 'string' || !BICIM.test(x)) fail('INVALID_BOOTSTRAP')
  if (!out.length) fail('INVALID_BOOTSTRAP')
  return out
}

// Bu uygulamanın kendi DHT düğümü. secenek: HyperDHT seçenekleri (testte bootstrap: yerel testnet)
function dhtAc (secenek = {}) {
  return new DHT({ bootstrap: onyukleme(), ...secenek })
}

module.exports = { onyukleme, dhtAc, ONYUKLEME: LISTE }
