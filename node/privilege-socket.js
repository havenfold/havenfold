// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// privilege-socket.js — yetki yardımcısının soket kipi ve denetçinin istemcisi (RFC-0007 §4.3, §5, §6.1, §6.4; RFC-0033 §9 l)
//
// Karar (RFC-0033 §9 l, RFC-0007 Ek): SO_PEERCRED için yerel eklenti yazılmaz; yerel soketlerde yetki dosya izni ve
// grup üyeliğiyle verilir. Yardımcının soketi /run/havenfold/yetki/yetki.sock: dizin 0750 root:havenfold-denetci,
// soket 0660 root:havenfold-denetci (havenfold-denetci grubunun tek üyesi denetçi kullanıcısıdır; sysusers.conf).
// İşçi, kutu, ekran ve yönetim grubu dizine giremez. Bu yüzden soketten gelen her istek DENETÇİDEN gelmiş sayılır ve
// yardımcı onu kendi kuralıyla (privilege-helper.js IZIN; ör. luks-kurtarma yalnız denetçi ve kök) 'havenfold-denetci'
// kullanıcısı olarak denetler. Kökün işleri (deneme-denetle, pil-uygula) soketten değil, komut satırından ve kök
// birimlerinden gelir. Birleşik düğümde de aynı: soket dosya izniyle açılır (denetçinin kendi çekirdek soketlerindeki
// NO_PEERCRED kuralı ayrıdır, supervisor-main.js).
//
// RFC-0007 §5 ve §6.1 tabloları soketi /run/havenfold/yetki.sock yazar. /run/havenfold herkese açık bir dizin olduğu
// için (çekirdeklerin dizinleri altında) yalnız soket dosyasının iznine kalmamak adına soket kendi dizinine alındı
// (RFC-0026 f'deki denetçi soketleri gibi); grup RFC tablosundaki havenfold-denetci.
//
// Çerçeve RFC-0007 §6.2 (node/ipc/frame.js): YETKI_ISTEK (29) { islem, girdi: JSON } → YETKI_CEVAP (30) { ok, code,
// cikti: JSON }. İstek bağlantı başına sırayla işlenir. Systemd soketle açar (Accept=no, LISTEN_FDS); son bağlantı
// kapandıktan bostaMs sonra sunucu kapanır, birim biter, sonraki bağlantıda systemd yeniden açar.
'use strict'
const fs = require('fs')
const net = require('net')
const path = require('path')
const { IPC } = require('./ipc/types')
const { cerceveYaz, mesajCoz, CerceveOkuyucu, hataCercevesi } = require('./ipc/frame')

function fail (code) { throw new Error(code) }

const YETKI_SOKETI = '/run/havenfold/yetki/yetki.sock'
const SOKET_ARAYANI = 'havenfold-denetci' // dizine yalnız denetçi girebilir
const DIZIN_IZNI = 0o750
const SOKET_IZNI = 0o660
const BOSTA_MS = 30_000
const ISTEK_MS = 15 * 60_000 // paket-ac büyük paketi akışla özetler

// Dizin yoksa açılır; varsa gerçek dizin olmalı (bağ değil). İzin ve grup her açılışta yeniden yazılır.
function dizinHazirla (dizin, gid) {
  try {
    const st = fs.lstatSync(dizin)
    if (!st.isDirectory()) fail('INVALID_SOCKET_DIR')
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
    fs.mkdirSync(dizin, { mode: DIZIN_IZNI })
  }
  fs.chmodSync(dizin, DIZIN_IZNI)
  if (gid !== null) fs.chownSync(dizin, -1, gid)
}

/**
 * Yardımcının soket sunucusu. y: YetkiYardimcisi; ya fd (systemd'nin verdiği dinleyen soket) ya da yol + gid (dizini
 * ve soketi kendisi açar; testler ve systemd dışı açılış). bitti(): boşta kapanınca.
 */
function yetkiSunucusu ({ y, fd = null, yol = null, gid = null, bostaMs = BOSTA_MS, bitti = () => {} }) {
  let acik = 0
  let bosta = null
  const sunucu = net.createServer((soket) => {
    acik++
    if (bosta) { clearTimeout(bosta); bosta = null }
    const okuyucu = new CerceveOkuyucu()
    let kuyruk = Promise.resolve()
    soket.on('error', () => {})
    soket.on('close', () => { acik--; zamanla() })
    soket.on('data', (parca) => {
      let mesajlar
      try { mesajlar = okuyucu.besle(parca) } catch { soket.destroy(); return }
      for (const b of mesajlar) kuyruk = kuyruk.then(() => isle(b)).then((f) => { if (!soket.destroyed) soket.write(f) }, () => soket.destroy())
    })
  })

  async function isle (b) {
    let m
    try { m = mesajCoz(b) } catch (err) { return hataCercevesi(err.reqId || 0, err.message) }
    if (m.type !== IPC.YETKI_ISTEK) return hataCercevesi(m.reqId, 'UNSUPPORTED')
    try {
      let girdi
      try { girdi = JSON.parse(m.mesaj.girdi) } catch { fail('INVALID_INPUT') }
      const r = await y.isle(SOKET_ARAYANI, m.mesaj.islem, girdi)
      return cerceveYaz(IPC.YETKI_CEVAP, m.reqId, { ok: true, code: '', cikti: JSON.stringify(r === undefined ? null : r) })
    } catch (err) {
      return cerceveYaz(IPC.YETKI_CEVAP, m.reqId, { ok: false, code: /^[A-Z][A-Z0-9_]{1,63}$/.test(err.message) ? err.message : 'INTERNAL_ERROR', cikti: '' })
    }
  }

  function zamanla () {
    if (acik > 0 || !bostaMs) return
    bosta = setTimeout(() => { sunucu.close(); bitti() }, bostaMs)
  }

  return new Promise((resolve, reject) => {
    sunucu.once('error', reject)
    const hazir = () => { sunucu.removeListener('error', reject); zamanla(); resolve(sunucu) }
    if (fd !== null) return sunucu.listen({ fd }, hazir)
    if (!yol) return reject(new Error('NO_SOCKET'))
    if (Buffer.byteLength(yol) > 103) return reject(new Error('SOCKET_PATH_TOO_LONG'))
    try {
      dizinHazirla(path.dirname(yol), gid)
      try { fs.unlinkSync(yol) } catch {}
    } catch (err) { return reject(err) }
    sunucu.listen(yol, () => {
      try {
        fs.chmodSync(yol, SOKET_IZNI)
        if (gid !== null) fs.chownSync(yol, -1, gid)
      } catch (err) { sunucu.close(); return reject(err) }
      hazir()
    })
  })
}

// Denetçinin istemcisi: istek başına bağlanır (soketle açılan birim için), cevabı bekler, kapatır. Dönüş:
// (islem, girdi) → Promise<çıktı>; ok: false ise kodla düşer.
function yetkiIstemcisi (yol = YETKI_SOKETI, { sureMs = ISTEK_MS } = {}) {
  return (islem, girdi) => new Promise((resolve, reject) => {
    const s = net.createConnection(yol)
    const okuyucu = new CerceveOkuyucu()
    let bitti = false
    const son = (err, deger) => {
      if (bitti) return
      bitti = true
      clearTimeout(z)
      s.destroy()
      if (err) reject(err)
      else resolve(deger)
    }
    const z = setTimeout(() => son(new Error('PRIVILEGE_TIMEOUT')), sureMs)
    // Bağlanamadı: NO_PERMISSION (istek gitmedi). İstek gittikten sonra cevapsız kopma PRIVILEGE_DISCONNECTED: yardımcı
    // işi yapmış olabilir (surum-gec denetçiyi yeniden başlatır; update.js gec, Codex 12. tur)
    let gitti = false
    const kopma = () => son(new Error(gitti ? 'PRIVILEGE_DISCONNECTED' : 'NO_PERMISSION'))
    s.on('error', kopma)
    s.on('close', kopma)
    s.on('connect', () => { s.write(cerceveYaz(IPC.YETKI_ISTEK, 1, { islem, girdi: JSON.stringify(girdi) })); gitti = true })
    s.on('data', (parca) => {
      let mesajlar
      try { mesajlar = okuyucu.besle(parca) } catch { return son(new Error('INVALID_REPLY')) }
      for (const b of mesajlar) {
        let m
        try { m = mesajCoz(b) } catch { return son(new Error('INVALID_REPLY')) }
        if (m.type === IPC.HATA) return son(new Error(m.mesaj.code))
        if (m.type !== IPC.YETKI_CEVAP) return son(new Error('INVALID_REPLY'))
        if (!m.mesaj.ok) return son(new Error(m.mesaj.code))
        try { return son(null, JSON.parse(m.mesaj.cikti)) } catch { return son(new Error('INVALID_REPLY')) }
      }
    })
  })
}

// systemd soket etkinleştirmesi (sd_listen_fds): LISTEN_PID bu süreç ve tek soket → fd 3
function systemdSoketi (ortam = process.env, pid = process.pid) {
  return ortam.LISTEN_FDS === '1' && ortam.LISTEN_PID === String(pid) ? 3 : null
}

module.exports = { YETKI_SOKETI, SOKET_ARAYANI, DIZIN_IZNI, SOKET_IZNI, BOSTA_MS, yetkiSunucusu, yetkiIstemcisi, systemdSoketi, dizinHazirla }
