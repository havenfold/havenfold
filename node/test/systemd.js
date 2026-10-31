// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// RFC-0007 §4.3, §5: birim dosyalarının sertleştirmesi ve yazılabilir yolları (yalnız dosya; bu makinede kurulmaz)
const test = require('brittle')
const fs = require('fs')
const path = require('path')

const oku = (ad) => fs.readFileSync(path.join(__dirname, '../systemd', ad), 'utf8')
const SERT = ['NoNewPrivileges=yes', 'ProtectSystem=strict', 'ProtectHome=yes', 'PrivateTmp=yes', 'DevicePolicy=closed', 'DeviceAllow=/dev/tpmrm0 rw', 'ProtectKernelTunables=yes', 'ProtectKernelModules=yes', 'ProtectControlGroups=yes', 'RestrictSUIDSGID=yes', 'LockPersonality=yes', 'RestrictRealtime=yes', 'CapabilityBoundingSet=', 'AmbientCapabilities=', 'SystemCallFilter=@system-service', 'SystemCallArchitectures=native', 'UMask=0077']
// Çekirdekler HyperDHT'yi Node'da çalıştırır: ağ arayüzleri için AF_NETLINK (havenfold-kutu-ubuntu.service gibi)
const FAMILIES = { 'havenfold-kutu.service': 'AF_UNIX AF_INET AF_INET6 AF_NETLINK', 'havenfold-isci.service': 'AF_UNIX AF_INET AF_INET6 AF_NETLINK', 'havenfold-denetci.service': 'AF_UNIX AF_INET AF_INET6' }

test('çekirdek ve denetçi birimleri: ortak sertleştirme, kendi kullanıcısı, yalnız kendi dizinleri', (t) => {
  const beklenen = {
    'havenfold-kutu.service': ['havenfold-kutu', '/var/lib/havenfold/kutu /run/havenfold/kutu'],
    'havenfold-isci.service': ['havenfold-isci', '/var/lib/havenfold/isci /run/havenfold/isci /run/havenfold/gorev'],
    'havenfold-denetci.service': ['havenfold-denetci', '/var/lib/havenfold/denetci /run/havenfold/denetci /run/havenfold/denetci-yonetim /var/lib/havenfold/yedek /run/havenfold/gorev']
  }
  for (const [ad, [kullanici, yollar]] of Object.entries(beklenen)) {
    const s = oku(ad)
    for (const satir of SERT) t.ok(s.split('\n').includes(satir), ad + ': ' + satir)
    t.ok(s.split('\n').includes('RestrictAddressFamilies=' + FAMILIES[ad]), ad + ': adres aileleri')
    t.ok(s.includes('\nUser=' + kullanici + '\n'), ad + ' kullanıcısı')
    t.ok(s.includes('\nReadWritePaths=' + yollar + '\n'), ad + ' yolları')
    t.absent(/^MemoryDenyWriteExecute/m.test(s), 'V8 JIT için yok')
  }
  t.ok(oku('havenfold-kutu.service').includes('After=havenfold-denetci.service'))
  const soket = oku('havenfold-yetki.socket')
  // RFC-0033 §9 l: dosya izniyle yetki; dizin tmpfiles'tan 0750 root:havenfold-denetci, soket 0660 aynı grup
  t.ok(soket.includes('ListenStream=/run/havenfold/yetki/yetki.sock') && soket.includes('SocketGroup=havenfold-denetci') && soket.includes('SocketMode=0660'))
  t.is(soket.split('\n').find((x) => x.startsWith('ListenStream=')).slice(13), require('../privilege-socket').YETKI_SOKETI, 'birim ve kod aynı yol')
  const tmp = fs.readFileSync(path.join(__dirname, '../deploy/tmpfiles.conf'), 'utf8').split('\n').map((x) => x.split(/\s+/))
  t.alike(tmp.find((x) => x[1] === '/run/havenfold/yetki').slice(2, 5), ['0750', 'root', 'havenfold-denetci'], 'yardımcı soketinin dizini')
  const su = fs.readFileSync(path.join(__dirname, '../deploy/sysusers.conf'), 'utf8')
  t.absent(/^m\s+\S+\s+havenfold-denetci\s*$/m.test(su), 'havenfold-denetci grubuna kimse eklenmez (yalnız denetçi)')
  for (const b of ['havenfold-kutu.service', 'havenfold-isci.service']) t.absent(/havenfold-yetki|havenfold-denetci/.test(oku(b).split('\n').find((x) => x.startsWith('SupplementaryGroups='))), b + ': yardımcı soketine giremez')
  // Açılış güvenlik incelemesi: denetçi yönetim grubunda değil (çekirdeklerin yönetim soketlerine erişmez); kendi yönetim
  // soketinin grubu setgid dizinden gelir
  t.absent(/^m\s+havenfold-denetci\s+havenfold-yonetim\s*$/m.test(su), 'sysusers: denetçi havenfold-yonetim üyesi değil')
  t.absent(oku('havenfold-denetci.service').split('\n').find((x) => x.startsWith('SupplementaryGroups=')).includes('havenfold-yonetim'), 'denetçi birimi havenfold-yonetim almaz')
  t.alike(tmp.find((x) => x[1] === '/run/havenfold/denetci-yonetim').slice(2, 5), ['2750', 'havenfold-denetci', 'havenfold-yonetim'], 'denetçinin yönetim soketi dizini setgid')
})
