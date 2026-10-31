// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// platform.js — düğümün platform alanları; denetçinin sağlık ölçümü ve kutunun durumu aynı kaynaktan okur (Codex 12. tur:
// kutu yalnız HF_DISK ortam değişkenine bakıyor, USB ile şifreli kurulan kutuyu "disk şifresiz" gösteriyordu)
const fs = require('fs')
const path = require('path')

// Platform alanları (RFC-0007 §11.1): TPM aygıtı var mı (mühür denemesini ilk-ayar yapar; denetçi kimlik dizinini
// okuyamaz, burada yalnız aygıt), Güvenli Önyükleme (EFI değişkeni SecureBoot-<GUID>: 4 bayt öznitelik ‖ 1 bayt değer),
// disk şifrelemesi: /etc/crypttab'da satır ve TPM bağı. Bağı kök olan hf-luks-yenile her açılışta denetleyip
// /etc/havenfold/disk-sifreleme'ye yazar (luks-tpm | luks). Parolalı, TPM bağsız LUKS Havenfold kurulumu değildir ve
// 'sifresiz' sayılır: uyarı görünür, TPM mührü varmış gibi bildirilmez (alanın değerleri: health.js DISK).
function platformOku (kok) {
  const efi = path.join(kok, 'sys/firmware/efi/efivars')
  let secureBoot = false
  try {
    const ad = fs.readdirSync(efi).find((a) => a.startsWith('SecureBoot-'))
    if (ad) { const b = fs.readFileSync(path.join(efi, ad)); secureBoot = b.byteLength >= 5 && b[4] === 1 }
  } catch {}
  const tpm = fs.existsSync(path.join(kok, 'dev/tpmrm0')) ? 'var' : 'yok'
  let luks = false
  try { luks = fs.readFileSync(path.join(kok, 'etc/crypttab'), 'utf8').split('\n').some((l) => l.trim() && !l.trim().startsWith('#')) } catch {}
  let bag = ''
  try { bag = fs.readFileSync(path.join(kok, 'etc/havenfold/disk-sifreleme'), 'utf8').trim() } catch {}
  return { tpm, secureBoot, disk: luks && tpm === 'var' && bag === 'luks-tpm' ? 'luks-tpm' : 'sifresiz' }
}

module.exports = { platformOku }
