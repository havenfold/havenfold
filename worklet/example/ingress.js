// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// example/ingress.js — örnek telefon girişi (paketleme denemesi: scripts/pack.sh example/ingress.js …).
// Gerçek üründe giriş ürünün deposundadır (Yuva Defteri apps/mobile/worklet/). Sözleşme (RFC-0027 §5, kollar/D-durum.md):
//   argv: --dizin=<yazılabilir, yedeğe girmeyen klasör> --acilan=<geçici klasör> (sır yok)
//   ilk IPC çerçevesi: { id, komut: 1, govde: { anahtarHex, archivePubHex, sayac } } (platform anahtarı, Arşiv açık
//   anahtarı, son 'kalici' sayacı); cevap { id, sonuc: { hazir: true } } ya da { id, hata } (STATE_CORRUPT gibi; dosya alanıyla)
/* global Bare, BareKit */
'use strict'
const { start, ipc: { cerceveYaz, baslangicBekle } } = require('..')
const { urunSunucusu } = require('./product')

const arg = (ad) => { const a = (Bare.argv || []).find((x) => String(x).startsWith('--' + ad + '=')); return a ? String(a).slice(ad.length + 3) : null }
const yaz = (j) => { try { BareKit.IPC.write(cerceveYaz(JSON.stringify(j))) } catch {} }

baslangicBekle({ ipc: BareKit.IPC }).then(async ({ id, anahtar, archivePubHex, sayac }) => {
  try {
    await start({ urunSunucusu, dizin: arg('dizin'), acilanDizin: arg('acilan'), appId: 'ornek', anahtar, archivePubHex, sayac })
    yaz({ id, sonuc: { hazir: true } })
  } catch (err) {
    // Açılış hatası uygulamaya bildirilir; çekirdek kendiliğinden sıfırlanmaz
    yaz({ id, hata: err.message, dosya: err.dosya || null })
  }
}, (err) => yaz({ id: null, olay: 'channel', govde: { hata: err.message } }))
