#!/usr/bin/env node
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// test-root.js — YALNIZ TEST: sanal makine denemesi için geçici kök durumu (RFC-0007 §12.2 kokDurumuEnc).
//
//   node installer/test/vm/test-root.js --anahtar test-kok.pem --cikti kok.durum
//
// Anahtar iş akışında `openssl genpkey -algorithm ed25519` ile üretilir, bildirim release-sign.js ile imzalanınca
// silinir; hiçbir yere yüklenmez ve yazdırılmaz. Bu betik yalnız açık yarıyı okur. Yedek kökün taahhüdü
// (nextRootHash) rastgele 32 baytın özetidir: test kökü döndürülmez. Gerçek kök anahtar bu yolda hiç yoktur.
const fs = require('fs')
const crypto = require('crypto')
const c = require('compact-encoding')
const S = require('../../../node/release')

function arg (ad) {
  const i = process.argv.indexOf('--' + ad)
  if (i < 0 || !process.argv[i + 1]) throw new Error('MISSING_ARGUMENT: --' + ad)
  return process.argv[i + 1]
}

const spki = crypto.createPublicKey(fs.readFileSync(arg('anahtar'))).export({ format: 'der', type: 'spki' })
if (spki.byteLength !== 44) throw new Error('ANAHTAR: Ed25519 değil')
const rootPub = spki.subarray(12)
const kok = { keyEpoch: 1, rootPub, nextRootHash: S.rootHash(crypto.randomBytes(32)) }
fs.writeFileSync(arg('cikti'), c.encode(S.kokDurumuEnc, kok), { mode: 0o644 })
console.log('Test kök durumu yazıldı: kök dönemi 1, parmak izi ' + S.rootHash(rootPub).toString('hex').slice(0, 16) + '… (GEÇİCİ TEST KÖKÜ)')
