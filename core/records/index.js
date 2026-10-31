// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// @havenfold/records — kayıt katmanı (RFC-0001)
const { zarf: { Z }, giris } = require('@havenfold/core')
const E = require('./sync')
const A = require('./key')
const Ks = require('./cutoff')
const D = require('./file')
const { decodeCanonical } = require('./encoding')

// Gelen zarfların kanonik çözücüleri (tek giriş noktası, inceleme 3 S7)
for (const [type, coz] of [
  [Z.REC_VV, E.decodeVv], [Z.REC_IDS, E.decodeIds], [Z.REC_OPS, E.decodeOps], [Z.REC_BUCKETS, E.decodeBuckets],
  [Z.REC_BUCKET_IDS, E.decodeBucketIds], [Z.REC_PRUNE, E.decodePrune], [Z.REC_KEY, A.decodeRecKey],
  [Z.REC_KEY_REQ, A.decodeRecKeyReq], [Z.REC_CUTOFF, Ks.decodeCutoff], [Z.BLOB_REQ, D.decodeBlobReq],
  [Z.BLOB_DATA, D.decodeBlobData], [Z.BLOB_DEL, D.decodeBlobDel], [Z.BLOB_HAVE, (b) => decodeCanonical(D.blobHave, b, 'INVALID_MESSAGE')]
]) giris.kaydet(type, coz)

module.exports = {
  kodlama: require('./encoding'),
  hlc: require('./hlc'),
  birlestir: require('./merge'),
  yetki: require('./permission'),
  islem: require('./operation'),
  anahtar: require('./key'),
  kesim: require('./cutoff'),
  alanlar: require('./fields'),
  esitleme: require('./sync'),
  kutu: require('./box'),
  dosya: require('./file'),
  temizlik: require('./cleanup'),
  misafir: require('./guest'),
  uygulama: require('./app'),
  ...require('./replica')
}
