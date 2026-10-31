// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// profile.js — çalışma profili NODE_PROFILE (RFC-0008 §10.1), yerleştirmede özellik denetimi (§5, RFC-0002 §8 madde 1'e ek)
// ve kasa payı adaylığı (§10.1 `shareEligible`, §10.2; RFC-0004 §3.1)
//
// Profili cihaz üretir ve imzalar (denetçi, Android uç, iOS ekran); telefon her cihazın son profilini saklar. Profil
// göndermeyen cihaz yerleştirmede Linux düğümü sayılır, kasa payı adayı sayılmaz. Telefon pay adaylığını cihazın
// `shareEligible` beyanına değil, kendi kuralına göre verir.
const K = require('./encoding')

const { hex, fail } = K

// §5: Linux işçinin bildirdiği özellikler (profil göndermeyen cihaz bunlara sahip sayılır)
const LINUX_OZELLIK = { 'hf.task.ocr': ['metin', 'pdf'], 'hf.task.transcribe': ['wav', 'opus', 'm4a', 'mp3'] }
// §5, §10.2: çalışma ortamının yapabileceği görev türleri (null: kısıt yok, NODE_CAPS.tasks belirler)
const ORTAM_TURLERI = {
  'linux-konteyner': null,
  'windows-yerel': ['hf.task.backup', 'hf.task.ocr', 'hf.task.transcribe'],
  'macos-yerel': ['hf.task.backup', 'hf.task.ocr', 'hf.task.transcribe'],
  'android-kutu': ['hf.task.backup'],
  'android-uc': [],
  'ios-ekran': []
}
// Ses girdisinin MIME türü → özellik (§5: "girdinin MIME türü → biçim")
const SES_BICIMI = {
  'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav',
  'audio/ogg': 'opus', 'audio/opus': 'opus',
  'audio/mp4': 'm4a', 'audio/m4a': 'm4a', 'audio/x-m4a': 'm4a',
  'audio/mpeg': 'mp3', 'audio/mp3': 'mp3'
}

// signer: { signKeyPair: { secretKey } }
const profilKodla = (familyId, m, signer) => K.imzaliKodla(K.profilGovde, K.profilDenetle, K.ETIKET.NODE_PROFILE, familyId, m, signer.signKeyPair.secretKey)
const profilCoz = (buf) => K.imzaliCoz(K.profilGovde, buf, K.profilDenetle)

// Profili imzalayabilen: defterdeki aktif bağlı cihaz ya da aktif kutu üyesi (§10.1 "Kim gönderir")
function imzaciOf (L, nodeHex) {
  const d = L.devices.get(nodeHex)
  if (d) return d.active ? d.signPub : null
  const m = L.members.get(nodeHex)
  if (m && m.role === 'kutu' && L.sessionRole(nodeHex) === 'uye') return m.signPub
  return null
}

class ProfilDefteri {
  constructor ({ ledger }) {
    this.ledger = ledger
    this.son = new Map() // nodeHex → profil
  }

  // from: profili getiren doğrudan oturumun karşı tarafı (verilirse nodeId ile aynı olmalı; emanete gitmez, §12)
  al (bytes, { from = null } = {}) {
    const { m, body, sig } = profilCoz(bytes)
    const id = hex(m.nodeId)
    if (from !== null && from !== id) fail('UNAUTHORIZED')
    const pub = imzaciOf(this.ledger, id)
    if (!pub) fail('UNAUTHORIZED')
    if (!K.imzaGecerli(K.ETIKET.NODE_PROFILE, this.ledger.familyId, body, sig, pub)) fail('INVALID_SIGNATURE')
    const prev = this.son.get(id)
    if (prev && m.seq <= prev.seq) fail('STALE_MANIFEST')
    this.son.set(id, m)
    return m
  }

  // Defterde hâlâ aktif olan cihazın son profili; yoksa null (Linux düğümü sayılır)
  get (nodeHex) {
    const m = this.son.get(nodeHex)
    return m && imzaciOf(this.ledger, nodeHex) ? m : null
  }
}

// İsteğin gerektirdiği özellik (§5): OCR'da `output: 'pdf'` → pdf, değilse metin; seste girdinin MIME türü → biçim
// (bilinmeyen tür kendi adıyla aranır, kimsede bulunmaz). Özelliği olmayan türlerde null.
function gerekenOzellik (type, params = {}) {
  if (type === 'hf.task.ocr') return params.output === 'pdf' ? 'pdf' : 'metin'
  if (type === 'hf.task.transcribe') {
    const mime = String(params.mime || '').toLowerCase()
    return SES_BICIMI[mime] || mime || null
  }
  return null
}

// Profilin bu tür için bildirdiği özellikler; profil yoksa Linux listesi
function ozelliklerOf (profil, type) {
  if (!profil) return LINUX_OZELLIK[type] || []
  return profil.features.find((f) => f.type === type)?.features || []
}

// Aday mı (§5 yerleştirme kuralı): çalışma ortamı türü yapabilmeli; gereken özellik listede olmalı
function ozellikUyar (profil, type, params = {}) {
  if (profil) {
    const turler = ORTAM_TURLERI[profil.runtime]
    if (turler && !turler.includes(type)) return false
  }
  const gereken = gerekenOzellik(type, params)
  return gereken === null || ozelliklerOf(profil, type).includes(gereken)
}

// RFC-0002 §8 madde 1'deki adaylara ek süzgeç: yerlestirme.adaylar(defter, { …, uygun }) ile kullanılır
const yerlestirmeSuzgeci = (profiller, type, params = {}) => (n) => ozellikUyar(profiller.get(n.id), type, params)

// Kasa payı adayı (§10.1): yalnız Linux konteyner düğümü ve TPM mührü doğrulanmış (NODE_HEALTH.platform.tpm); profil
// göndermeyen cihaz aday değildir. Cihazın kendi shareEligible beyanına bakılmaz.
function kasaPayiAdayi (profil, saglik) {
  return !!profil && profil.runtime === 'linux-konteyner' && saglik?.platform?.tpm === 'muhur-ok'
}

// VaultApi.uygunCihaz için (U8): platformun kendi kuralı (temel: TPM mühürlü kutu ve işçiler) ve profil kuralı birlikte.
// saglik(id): cihazın son NODE_HEALTH'i (yoksa null)
const kasaPayiSuzgeci = ({ profiller, saglik, temel = () => true }) => (id) => !!temel(id) && kasaPayiAdayi(profiller.get(id), saglik(id))

module.exports = {
  LINUX_OZELLIK, ORTAM_TURLERI, SES_BICIMI, profilKodla, profilCoz, imzaciOf, ProfilDefteri,
  gerekenOzellik, ozelliklerOf, ozellikUyar, yerlestirmeSuzgeci, kasaPayiAdayi, kasaPayiSuzgeci
}
