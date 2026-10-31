# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
# was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
# shellcheck shell=bash
# target/common.sh — Kurulum USB'si (hf-hedefe-kur) ve var olan Ubuntu (havenfold-kur) için ortak kurulum adımları
# (RFC-0007 §5, §8.5, §8.6, §10; RFC-0026). Kaynak olarak okunur (`. common.sh`), tek başına çalışmaz.
#
# Çağıranın tanımlaması gerekenler:
#   KOK        hedef kök: Kurulum USB'sinde /target, var olan Ubuntu'da boş ('')
#   KURULUM    kurulum aracının dizini (node, lib/, erase/, vendor/, node_modules/, target/)
#   PAKET_DIZ  düğüm paketi, bildirim.bin, kok.durum ve paket.json'un durduğu dizin
#   hedefte    işlev: komutu hedef sistemde çalıştırır (USB'de chroot, var olan Ubuntu'da doğrudan)
#
# Paket düzeni (RFC-0007 §5 ve node/systemd birimlerinin ExecStart satırları): kökte `node` ve `bare` çalışma
# zamanları, bin/havenfold, cekirdek/, denetci/; birimler ve dağıtım dosyaları systemd/ ve deploy/ altında (depodaki
# node/systemd, node/deploy). Paket derleme hattı henüz tanımlı değil: iki dizin hem kökte hem node/ altında aranır.
# Kullanıcılar, gruplar ve dizinler paketteki sysusers.conf ve tmpfiles.conf'tan gelir (geliştirme kurulumu
# node/deploy/havenfold-install-sudo.sh de aynılarını kullanır). systemd birimleri paketin ve kurulum aracının
# target/systemd/ dizinindendir; kopyalanır, güncel bağına bağlanmaz (RFC-0026 b).

HF_ONEK='yuva/v2/hf/release-pkg/' # core/core/crypto/kdf.js PREFIX + RFC-0007 §3 etiketi

hf_adim () { printf '\n== %s\n' "$1"; }
hf_cli () { "$KURULUM/node" "$KURULUM/lib/cli.js" "$@"; }
hf_bilgi () { hf_cli bilgi --dosya "$PAKET_DIZ/paket.json" --alan "$1"; }

# Protokol özeti: BLAKE2b-256(önek ‖ dosya) = core/core/crypto/kdf.js hash('hf/release-pkg/', dosya). b2sum anahtarsız
# BLAKE2b'dir; -l 256 çıktı uzunluğunu 32 bayt yapar (libsodium crypto_generichash ile aynı).
hf_ozet () { { printf '%s' "$HF_ONEK"; cat "$1"; } | b2sum -l 256 | cut -d' ' -f1; }

# ozetler: "<onaltılık özet>  <göreli yol>" satırları; hepsi tutmalı
hf_ozetleri_denetle () {
  local dizin=$1 liste=$2 beklenen yol gercek
  while read -r beklenen yol; do
    [ -n "$yol" ] || continue
    case "$yol" in /*|*..*) echo "HATA: geçersiz yol: $yol" >&2; return 1 ;; esac
    gercek=$(hf_ozet "$dizin/$yol")
    if [ "$gercek" != "$beklenen" ]; then echo "HATA: özet tutmuyor: $yol" >&2; return 1; fi
  done < "$liste"
}

# Kurulum aracının kendisi sabit yola (güncel bağı onu değiştirmez): ilk açılış ve LUKS yenileme buradan çalışır
hf_kurulum_kopyala () {
  local h="$KOK/usr/lib/havenfold/kurulum"
  rm -rf "$h.yeni"
  mkdir -p "$h.yeni"
  cp -a "$KURULUM/." "$h.yeni/"
  chown -R root:root "$h.yeni"
  chmod -R go-w "$h.yeni"
  rm -rf "$h"
  mv "$h.yeni" "$h"
}

# Paketteki bir dizin: kökte, node/ ya da lib/node/ altında (node/scripts/pack.sh düzeni: kod lib/ altında)
hf_paket_yolu () {
  local a
  for a in "$HF_SURUM_DIZ/$1" "$HF_SURUM_DIZ/node/$1" "$HF_SURUM_DIZ/lib/node/$1"; do [ -e "$a" ] && { echo "$a"; return 0; }; done
  return 1
}

# Düğüm paketi: /opt/havenfold/surumler/<sürüm>; guncel bağı; /usr/local/bin/havenfold → guncel/bin/havenfold (§5)
hf_paket_ac () {
  local surum dizin
  surum=$(hf_bilgi surum)
  dizin=$(hf_cli paket-ac --kok "${KOK:-/}" --bilgi "$PAKET_DIZ/paket.json" --usb "$PAKET_DIZ")
  chown -R root:root "$dizin"
  ln -sfn "surumler/$surum" "$KOK/opt/havenfold/guncel"
  [ -f "$dizin/node" ] || { echo "HATA: pakette Node çalışma zamanı yok" >&2; return 1; }
  [ -f "$dizin/bin/havenfold" ] || echo "UYARI: pakette bin/havenfold yok"
  mkdir -p "$KOK/usr/local/bin"
  ln -sfn /opt/havenfold/guncel/bin/havenfold "$KOK/usr/local/bin/havenfold"
  HF_SURUM_DIZ=$dizin
  echo "guncel → surumler/$surum"
}

# Kullanıcılar, gruplar, dizinler (RFC-0007 §4.1, §5)
hf_kullanicilar () {
  local d
  d=$(hf_paket_yolu deploy) && [ -f "$d/sysusers.conf" ] && [ -f "$d/tmpfiles.conf" ] || { echo "HATA: pakette sysusers/tmpfiles yok" >&2; return 1; }
  install -D -m 0644 "$d/sysusers.conf" "$KOK/usr/lib/sysusers.d/havenfold.conf"
  install -D -m 0644 "$d/tmpfiles.conf" "$KOK/usr/lib/tmpfiles.d/havenfold.conf"
  hedefte systemd-sysusers /usr/lib/sysusers.d/havenfold.conf
  # USB kurulumunda hedefin /run'ı açılışta kurulur; var olan Ubuntu'da birimler hemen başlar ve ReadWritePaths'teki
  # /run/havenfold/* yoksa 226/NAMESPACE ile düşer (Codex 12. tur)
  if [ -n "$KOK" ]; then hedefte systemd-tmpfiles --create --prefix=/var/lib/havenfold --prefix=/etc/havenfold /usr/lib/tmpfiles.d/havenfold.conf
  else hedefte systemd-tmpfiles --create --prefix=/var/lib/havenfold --prefix=/etc/havenfold --prefix=/run/havenfold /usr/lib/tmpfiles.d/havenfold.conf; fi
}

# Kökün durumu yalnız kökün dizininde (RFC-0026 a): kök anahtar durumu USB'den ya da havenfold-kur'un içinden;
# yetki.durum kurulan sürümle. Yetki yardımcısının kodu sabit yolda, kurulan sürümün kopyası (RFC-0026 b).
hf_yetki () {
  local y="$KOK/var/lib/havenfold/yetki"
  install -d -m 0700 -o root -g root "$y"
  # Var olan kök durumu ve yetki durumu korunur: dönemi düşük kök geri yazılmaz, en yüksek sürümden düşük ya da geri
  # çekilmiş sürüm kurulmaz (RFC-0026 c; yeniden kurulum, havenfold-kur --etiket)
  hf_cli kok-durumu-sec --yeni "$PAKET_DIZ/kok.durum" --eski "$y/kok.durum" --cikti "$y/kok.durum.yeni"
  chown root:root "$y/kok.durum.yeni"
  mv "$y/kok.durum.yeni" "$y/kok.durum"
  hf_cli yetki-durumu --bilgi "$PAKET_DIZ/paket.json" --onceki "$y/yetki.durum" > "$y/yetki.durum.yeni"
  chmod 0600 "$y/yetki.durum.yeni"
  mv "$y/yetki.durum.yeni" "$y/yetki.durum"
  local s="$KOK/usr/lib/havenfold/yetki" k="$HF_SURUM_DIZ"
  # pack.sh düzeninde yardımcının kendi kopyası yetki/ altındadır (ana.js, node, lib/)
  [ -f "$HF_SURUM_DIZ/yetki/ana.js" ] && k="$HF_SURUM_DIZ/yetki"
  rm -rf "$s"
  mkdir -p "$s"
  cp -a "$k/." "$s/"
  chown -R root:root "$s"
  chmod -R go-w "$s"
  # ZIP izin taşımaz; açan taraf yalnız kökteki node ve bare'i 0755 yapar (paket yetki/node'u 0644 açar)
  for x in node bare; do if [ -f "$s/$x" ]; then chmod 0755 "$s/$x"; fi; done
  [ -f "$s/ana.js" ] || echo "UYARI: pakette yetki yardımcısının giriş dosyası (ana.js) yok; havenfold-yetki, -pil, -acilis ve -deneme birimleri bu sürümde çalışmaz."
}

# systemd birimleri: paketin ve kurulum aracının birimleri /etc/systemd/system'e kopyalanır
hf_birimler () {
  local b s
  s=$(hf_paket_yolu systemd) || { echo "HATA: pakette systemd birimleri yok" >&2; return 1; }
  for b in "$s"/*.service "$s"/*.socket "$s"/*.timer "$KURULUM"/target/systemd/*.service; do
    [ -e "$b" ] && install -m 0644 "$b" "$KOK/etc/systemd/system/$(basename "$b")"
  done
  hedefte systemctl enable "$@"
}

hf_dugum_toml () {
  install -d -m 0755 "$KOK/etc/havenfold"
  hf_cli dugum-toml --rol "$1" --kanal "$2" --pil-sinir "$3" > "$KOK/etc/havenfold/dugum.toml"
  chmod 0644 "$KOK/etc/havenfold/dugum.toml"
}

# Pil eşiği (§10.1): plan saf işlevden; yazma bu makinenin /sys'ine (kurulum ortamı aynı donanımdır). Her açılışta
# havenfold-pil.service yeniden yazar. Bazı sürücüler başlangıç bitişten büyükse reddeder: ters sırayla yeniden denenir.
HF_PIL_SINIR=yok
hf_pil () {
  local var plan
  var=$(for a in $(hf_cli pil-adaylari); do [ -e "$a" ] && echo "$a"; done; true)
  plan=$(printf '%s\n' "$var" | hf_cli pil-plani)
  HF_PIL_SINIR=$("$KURULUM/node" -e "process.stdout.write(JSON.parse(process.argv[1]).limit)" "$plan")
  # Yazılacaklar değişkende tutulur: kökken tahmin edilebilir adlı geçici dosya (/tmp/hf-pil.<pid>) yok
  local yazilacak tur sira
  yazilacak=$("$KURULUM/node" -e "for (const [y, d] of JSON.parse(process.argv[1]).yaz) console.log(y + ' ' + d)" "$plan")
  for tur in ileri geri; do
    local tamam=1 y d
    if [ "$tur" = ileri ]; then sira=$yazilacak; else sira=$(tac <<< "$yazilacak"); fi
    while read -r y d; do
      [ -n "$y" ] || continue
      printf '%s' "$d" > "$y" 2>/dev/null || tamam=0
    done <<< "$sira"
    [ "$tamam" = 1 ] && break
  done
  if [ "$HF_PIL_SINIR" = yok ]; then
    "$KURULUM/node" -e "console.log('Uyarı: ' + JSON.parse(process.argv[1]).uyari)" "$plan"
  else
    echo "Pil sınırı: $HF_PIL_SINIR"
  fi
}

# Laptopu sunucu yapma ayarları (§10)
hf_laptop () {
  install -D -m 0644 /dev/null "$KOK/etc/systemd/logind.conf.d/havenfold.conf"
  hf_cli dosya --ad logind > "$KOK/etc/systemd/logind.conf.d/havenfold.conf"
  # shellcheck disable=SC2046
  hedefte systemctl mask $(hf_cli dosya --ad uyku-hedefleri)
  install -D -m 0644 /dev/null "$KOK/etc/default/grub.d/90-havenfold.cfg"
  hf_cli dosya --ad grub > "$KOK/etc/default/grub.d/90-havenfold.cfg"
  hedefte update-grub || echo "Uyarı: update-grub çalışmadı; consoleblank bir sonraki grub güncellemesinde gelir."
  hf_pil
}

# Güncelleme, bellek, ısı (§10)
hf_sistem_ayarlari () {
  install -D -m 0644 /dev/null "$KOK/etc/apt/apt.conf.d/52havenfold-unattended-upgrades"
  hf_cli dosya --ad unattended > "$KOK/etc/apt/apt.conf.d/52havenfold-unattended-upgrades"
  install -D -m 0644 /dev/null "$KOK/etc/sysctl.d/90-havenfold.conf"
  hf_cli dosya --ad sysctl > "$KOK/etc/sysctl.d/90-havenfold.conf"
  hedefte apt-mark hold secureboot-db >/dev/null 2>&1 || true # §8.5: PCR 7'yi değiştirir; yerel onaya bırakılır
  if grep -q GenuineIntel /proc/cpuinfo; then
    hedefte sh -c 'dpkg -s thermald >/dev/null 2>&1 || DEBIAN_FRONTEND=noninteractive apt-get install -y thermald' \
      || echo "Uyarı: thermald kurulamadı (ağ yok olabilir); sonra 'apt-get install thermald'."
  fi
}

# nftables `inet havenfold` tablosu (§10); kip: usb (gelen düşer) | var-olan (hiçbir şeyi engellemez)
hf_nft () {
  install -d -m 0755 "$KOK/etc/havenfold"
  hf_cli dosya --ad nft --kip "$1" > "$KOK/etc/havenfold/havenfold.nft"
  chmod 0644 "$KOK/etc/havenfold/havenfold.nft"
}
