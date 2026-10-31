// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Sahte komut çıktıları (silme ortamı testleri). Biçimler Ubuntu 24.04'teki araçlarınkiyle aynıdır: util-linux 2.39
// (lsblk -J), nvme-cli 2.8 (-o json), hdparm 9.65, smartmontools 7.4 (-j). Değerler uydurmadır; seri numaraları sahte.
const MiB = 1024 * 1024

// Bir dizüstü: NVMe (LUKS'lu bölümüyle), SATA HDD (HPA'lı), donmuş SATA SSD, eMMC (boot bölümleriyle), takılı yedek
// USB disk, silme ortamının açıldığı Kurulum USB'si (iso9660) ve loop aygıtı.
const LSBLK = {
  blockdevices: [
    { name: 'loop0', path: '/dev/loop0', type: 'loop', size: 1048576, rota: false, rm: false, hotplug: false, tran: null, model: null, serial: null, fstype: 'squashfs', label: null, parttype: null, mountpoints: ['/run/live/rootfs'] },
    {
      name: 'sdc', path: '/dev/sdc', type: 'disk', size: 8 * MiB, rota: false, rm: true, hotplug: true, tran: 'usb', model: 'Flash Disk', serial: 'USBKURULUM01', fstype: 'iso9660', label: 'Ubuntu-Server 24.04.3 LTS amd64', parttype: null, mountpoints: [null],
      children: [
        { name: 'sdc1', path: '/dev/sdc1', type: 'part', size: 6 * MiB, rota: false, rm: true, hotplug: true, tran: null, model: null, serial: null, fstype: 'iso9660', label: 'Ubuntu-Server 24.04.3 LTS amd64', parttype: '0x0', mountpoints: ['/cdrom'] },
        { name: 'sdc2', path: '/dev/sdc2', type: 'part', size: 1 * MiB, rota: false, rm: true, hotplug: true, tran: null, model: null, serial: null, fstype: 'vfat', label: 'ESP', parttype: 'c12a7328-f81f-11d2-ba4b-00a0c93ec93b', mountpoints: [null] }
      ]
    },
    {
      name: 'nvme0n1', path: '/dev/nvme0n1', type: 'disk', size: 2 * MiB, rota: false, rm: false, hotplug: false, tran: 'nvme', model: 'SAHTE NVMe 512GB', serial: 'NVME0SERI1234', fstype: null, label: null, parttype: null, mountpoints: [null],
      children: [
        { name: 'nvme0n1p1', path: '/dev/nvme0n1p1', type: 'part', size: 256 * 1024, rota: false, rm: false, hotplug: false, tran: 'nvme', model: null, serial: null, fstype: 'vfat', label: null, parttype: 'c12a7328-f81f-11d2-ba4b-00a0c93ec93b', mountpoints: [null] },
        { name: 'nvme0n1p2', path: '/dev/nvme0n1p2', type: 'part', size: 256 * 1024, rota: false, rm: false, hotplug: false, tran: 'nvme', model: null, serial: null, fstype: 'ext4', label: null, parttype: '0fc63daf-8483-4772-8e79-3d69d8477de4', mountpoints: [null] },
        { name: 'nvme0n1p3', path: '/dev/nvme0n1p3', type: 'part', size: 1536 * 1024, rota: false, rm: false, hotplug: false, tran: 'nvme', model: null, serial: null, fstype: 'crypto_LUKS', label: null, parttype: '0fc63daf-8483-4772-8e79-3d69d8477de4', mountpoints: [null] }
      ]
    },
    { name: 'sda', path: '/dev/sda', type: 'disk', size: 1 * MiB, rota: true, rm: false, hotplug: false, tran: 'sata', model: 'SAHTE HDD 1TB', serial: 'HDDSERI5678', fstype: null, label: null, parttype: null, mountpoints: [null] },
    { name: 'sdb', path: '/dev/sdb', type: 'disk', size: 2 * MiB, rota: false, rm: false, hotplug: false, tran: 'sata', model: 'SAHTE SSD 256GB', serial: 'SSDSERI9012', fstype: null, label: null, parttype: null, mountpoints: [null] },
    { name: 'mmcblk0', path: '/dev/mmcblk0', type: 'disk', size: 1 * MiB, rota: false, rm: false, hotplug: false, tran: null, model: null, serial: '0x1a2b3c4d', fstype: null, label: null, parttype: null, mountpoints: [null] },
    { name: 'mmcblk0boot0', path: '/dev/mmcblk0boot0', type: 'disk', size: 4 * MiB, rota: false, rm: false, hotplug: false, tran: null, model: null, serial: null, fstype: null, label: null, parttype: null, mountpoints: [null] },
    { name: 'sdd', path: '/dev/sdd', type: 'disk', size: 1 * MiB, rota: false, rm: false, hotplug: true, tran: 'usb', model: 'Yedek Disk', serial: 'YEDEK777', fstype: null, label: null, parttype: null, mountpoints: [null] }
  ]
}

// nvme id-ctrl -o json (kısaltılmış). sanicap 0x3: şifreleme ve blok silme; oacs 0x17: Format NVM var; fna 0x4
const NVME_BLOK = { vid: 5197, ssvid: 5197, sn: 'NVME0SERI1234       ', mn: 'SAHTE NVMe 512GB                        ', fr: '1B2QEXM7', oacs: 23, fna: 4, sanicap: 3 }
const NVME_KRIPTO = { ...NVME_BLOK, sanicap: 1 }
const NVME_FORMAT = { ...NVME_BLOK, sanicap: 0, fna: 0 }
const NVME_HICBIRI = { ...NVME_BLOK, sanicap: 0, oacs: 0, fna: 0 }

const sanitizeLog = (sstat, sprog) => ({ nvme0: { sprog, sstat, cdw10_info: 0, time_over_write: 4294967295, time_block_erase: 60, time_crypto_erase: 10 } })

function hdparmI ({ model, seri, ssd, guvenlik, sanitize = false }) {
  const g = guvenlik
  const s = (x) => (x ? '\t\t' : '\tnot\t')
  return `
/dev/sdX:

ATA device, with non-removable media
\tModel Number:       ${model}
\tSerial Number:      ${seri}
\tFirmware Revision:  SAHTE01
\tTransport:          Serial, ATA8-AST, SATA 1.0a, SATA II Extensions, SATA Rev 2.5, SATA Rev 2.6, SATA Rev 3.0
Standards:
\tUsed: unknown (minor revision code 0x011b)
\tSupported: 11 10 9 8 7 6 5
Configuration:
\tLogical\t\tmax\tcurrent
\tLBA48  user addressable sectors:  2048
\tLogical  Sector size:                   512 bytes
\tPhysical Sector size:                  4096 bytes
\tNominal Media Rotation Rate: ${ssd ? 'Solid State Device' : '7200'}
Commands/features:
\tEnabled\tSupported:
\t   *\tSMART feature set
\t    \tSecurity Mode feature set
\t   *\tPower Management feature set
\t   *\tWrite cache
${sanitize ? '\t   *\tSANITIZE feature set\n\t   *\tCRYPTO_SCRAMBLE_EXT command\n\t   *\tBLOCK_ERASE_EXT command\n' : ''}\t   *\tData Set Management TRIM supported (limit 8 blocks)
Security:
\tMaster password revision code = 65534
${s(g.destek)}supported
${s(g.etkin)}enabled
${s(g.kilitli)}locked
${s(g.donmus)}frozen
\tnot\texpired: security count
${s(g.gelismis)}supported: enhanced erase
\t2min for SECURITY ERASE UNIT. 2min for ENHANCED SECURITY ERASE UNIT.
Logical Unit WWN Device Identifier: 5002538e00000000
Checksum: correct
`
}

const GUVENLIK = { destek: true, etkin: false, kilitli: false, donmus: false, gelismis: true }
const HDD_I = hdparmI({ model: 'SAHTE HDD 1TB', seri: 'HDDSERI5678', ssd: false, guvenlik: GUVENLIK })
const SSD_DONMUS_I = hdparmI({ model: 'SAHTE SSD 256GB', seri: 'SSDSERI9012', ssd: true, guvenlik: { ...GUVENLIK, donmus: true }, sanitize: true })
const SSD_SANITIZE_I = hdparmI({ model: 'SAHTE SSD 256GB', seri: 'SSDSERI9012', ssd: true, guvenlik: GUVENLIK, sanitize: true })
const SSD_GUVENLIK_I = hdparmI({ model: 'SAHTE SSD 256GB', seri: 'SSDSERI9012', ssd: true, guvenlik: GUVENLIK })
const SSD_GUVENLIK_SONRA_I = hdparmI({ model: 'SAHTE SSD 256GB', seri: 'SSDSERI9012', ssd: true, guvenlik: { ...GUVENLIK, etkin: false } })

const hpaN = (gorunen, yerel) => `\n/dev/sda:\n max sectors   = ${gorunen}/${yerel}, HPA is ${gorunen < yerel ? 'enabled' : 'disabled'}\n`
const DCO_YOK = '\n/dev/sda:\nDCO Revision: 0x0002\nThe following features can be selectively disabled via DCO:\n\tTransfer modes:\n\t\t udma0 udma1 udma2 udma3 udma4 udma5 udma6\n\tReal max sectors: 2048\n'
const DCO_GIZLI = DCO_YOK.replace('Real max sectors: 2048', 'Real max sectors: 4096')

const SANITIZE_SURUYOR = '\n/dev/sdb:\nIssuing SANITIZE_STATUS command\nSanitize status:\n    State:    SD2 Sanitize operation In Process\n    Progress: 0x8000 (50%)\n'
const SANITIZE_TAMAM = '\n/dev/sdb:\nIssuing SANITIZE_STATUS command\nSanitize status:\n    State:    SD0 Sanitize Idle\n    Last Sanitize Operation Completed Without Error\n'

const smart = (realloc) => ({ json_format_version: [1, 0], ata_smart_attributes: { revision: 16, table: [{ id: 5, name: 'Reallocated_Sector_Ct', value: 100, raw: { value: realloc, string: String(realloc) } }, { id: 9, name: 'Power_On_Hours', value: 98, raw: { value: 4321, string: '4321' } }] } })

module.exports = {
  MiB,
  LSBLK,
  NVME_BLOK,
  NVME_KRIPTO,
  NVME_FORMAT,
  NVME_HICBIRI,
  sanitizeLog,
  hdparmI,
  GUVENLIK,
  HDD_I,
  SSD_DONMUS_I,
  SSD_SANITIZE_I,
  SSD_GUVENLIK_I,
  SSD_GUVENLIK_SONRA_I,
  hpaN,
  DCO_YOK,
  DCO_GIZLI,
  SANITIZE_SURUYOR,
  SANITIZE_TAMAM,
  smart
}
