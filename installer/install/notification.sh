# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
# was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
# shellcheck shell=bash
# shellcheck disable=SC2034 # HF_* değişkenleri sonucu kaynak olarak okuyan betiğe taşır; t sayaç
# install/notification.sh — sürüm bildiriminin kabukta doğrulanması (RFC-0007 §12.1 madde 1–4 ve 9). havenfold-kur kaynak
# olarak okur. Var olan Ubuntu'da henüz Node yoktur; doğrulama yalnız sistem araçlarıyla yapılır:
#   - imza: OpenSSL 3 (Ed25519, -rawin): sig = Ed25519(kök, hash('hf/release/', body))
#   - özet: b2sum -l 256 (anahtarsız BLAKE2b-256) = core/core/crypto/kdf.js hash(etiket, …) = BLAKE2b-256(önek ‖ …)
#   - kodlama: compact-encoding (RFC-0001 §3) bu dosyada okunur; en kısa kodlama denetlenir
# Kendi kriptomuz yok: imza ve özet OpenSSL'in ve coreutils'indir. Bash 3.2 ile de çalışır (testler macOS'ta koşar).

HF_ETIKET_ONEK='yuva/v2/'

hf_hata () { HF_HATA=$1; return 1; }

# Onaltılık → ikili (stdout). xxd gerekmez.
hf_hex_ikili () {
  local h=$1 i
  for ((i = 0; i < ${#h}; i += 2)); do printf "\\x${h:i:2}"; done
}

# Dosyayı bayt dizisine (ondalık) okur: HF_B, HF_N
hf_dosya_oku () {
  # shellcheck disable=SC2207
  HF_B=($(od -An -v -tu1 "$1"))
  HF_N=${#HF_B[@]}
  HF_I=0
}

hf_bayt () {
  [ "$HF_I" -lt "$HF_SON" ] || { hf_hata FORMAT_ERROR; return 1; }
  HF_U=${HF_B[HF_I]}
  HF_I=$((HF_I + 1))
}

# compact-encoding uint: < 0xfd tek bayt; 0xfd u16le; 0xfe u32le; 0xff u64le. En kısa kodlama zorunlu.
hf_uint () {
  hf_bayt || return 1
  local b=$HF_U n k v=0
  if [ "$b" -lt 253 ]; then HF_U=$b; return 0; fi
  if [ "$b" -eq 253 ]; then n=2; elif [ "$b" -eq 254 ]; then n=4; else n=8; fi
  [ $((HF_I + n)) -le "$HF_SON" ] || { hf_hata FORMAT_ERROR; return 1; }
  for ((k = n - 1; k >= 0; k--)); do v=$(((v << 8) | HF_B[HF_I + k])); done
  HF_I=$((HF_I + n))
  if { [ "$n" -eq 2 ] && [ "$v" -lt 253 ]; } || { [ "$n" -eq 4 ] && [ "$v" -le 65535 ]; } || { [ "$n" -eq 8 ] && [ "$v" -le 4294967295 ] && [ "$v" -ge 0 ]; }; then
    hf_hata FORMAT_ERROR; return 1
  fi
  [ "$v" -ge 0 ] || { hf_hata FORMAT_ERROR; return 1; } # 2^63 ve üstü
  HF_U=$v
}

# n baytı onaltılık olarak: HF_H
hf_hex () {
  local n=$1 k x
  [ $((HF_I + n)) -le "$HF_SON" ] || { hf_hata FORMAT_ERROR; return 1; }
  HF_H=""
  for ((k = 0; k < n; k++)); do printf -v x '%02x' "${HF_B[HF_I + k]}"; HF_H+=$x; done
  HF_I=$((HF_I + n))
}

# Dizge: HF_S (yalnız ASCII alanlar okunur; diğerleri hf_dizge_atla ile geçilir)
hf_dizge () {
  hf_uint || return 1
  local n=$HF_U k o="" x
  [ $((HF_I + n)) -le "$HF_SON" ] || { hf_hata FORMAT_ERROR; return 1; }
  for ((k = 0; k < n; k++)); do printf -v x '\\%03o' "${HF_B[HF_I + k]}"; o+=$x; done
  HF_I=$((HF_I + n))
  # shellcheck disable=SC2059
  printf -v HF_S "$o"
}
hf_dizge_atla () {
  hf_uint || return 1
  [ $((HF_I + HF_U)) -le "$HF_SON" ] || { hf_hata FORMAT_ERROR; return 1; }
  HF_I=$((HF_I + HF_U))
}
hf_bool () { hf_bayt || return 1; [ "$HF_U" -le 1 ] || { hf_hata FORMAT_ERROR; return 1; }; }
hf_urls () { hf_uint || return 1; local k n=$HF_U; HF_URLS=""; for ((k = 0; k < n; k++)); do hf_dizge || return 1; HF_URLS+="$HF_S"$'\n'; done; }

# Kök durumu (kokDurumuEnc): { keyEpoch: uint, rootPub: fixed32, nextRootHash: fixed32 } → HF_KOK_DONEM, HF_KOK_PUB, HF_KOK_TAAHHUT
hf_kok_durumu_coz () {
  local d
  d=$(mktemp)
  hf_hex_ikili "$1" > "$d"
  hf_dosya_oku "$d"
  rm -f "$d"
  HF_SON=$HF_N
  hf_uint || return 1; HF_KOK_DONEM=$HF_U
  hf_hex 32 || return 1; HF_KOK_PUB=$HF_H
  hf_hex 32 || return 1; HF_KOK_TAAHHUT=$HF_H
  [ "$HF_I" -eq "$HF_N" ] || { hf_hata FORMAT_ERROR; return 1; }
}

# Var olan kurulumun durumu eksik mi (Codex 5. tur): kimlik işareti ya da durum dosyalarından biri varsa düğüm kurulmuştur;
# o zaman kök durumu ve yetki durumu ikisi de olmalı. Eksikse STATE_INCOMPLETE: kaybolan güven ya da sürüm durumu ilk kurulum
# sayılmaz (eski kök ve düşük sürüm yeniden kabul edilirdi). hf_kurulum_durumu <kök önek ('' ya da test dizini)>
hf_kurulum_durumu () {
  local k=$1/var/lib/havenfold kurulu=0 f
  for f in "$k/isci/kimlik" "$k/kutu/kimlik" "$k/yetki/kok.durum" "$k/yetki/yetki.durum"; do [ -e "$f" ] && kurulu=1; done
  [ "$kurulu" = 1 ] || return 0
  [ -e "$k/yetki/kok.durum" ] && [ -e "$k/yetki/yetki.durum" ] || { hf_hata STATE_INCOMPLETE; return 1; }
}

# Makinede kurulu kök durumu (/var/lib/havenfold/yetki/kok.durum) gömülüden yeni dönemdeyse bildirim onunla doğrulanır:
# kökü döndürülmüş makinede eski havenfold-kur, eski (belki ele geçmiş) kökle imzalanmış bildirimi kabul etmez. Aynı
# dönemde başka kök ROOT_CONFLICT, okunamayan dosya ROOT_STATE_CORRUPT. Sonuç HF_KOK_* ve HF_KOK_DURUMU'da (açılış öncesi
# inceleme). Önce hf_kok_durumu_coz gömülüyle çağrılmış olmalı.
hf_kurulu_kok_sec () {
  local f=$1 donem=$HF_KOK_DONEM pub=$HF_KOK_PUB taahhut=$HF_KOK_TAAHHUT h
  [ -e "$f" ] || return 0
  h=$(od -An -v -tx1 "$f" | tr -d ' \n') || { hf_hata ROOT_STATE_CORRUPT; return 1; }
  hf_kok_durumu_coz "$h" || { hf_hata ROOT_STATE_CORRUPT; return 1; }
  if [ "$HF_KOK_DONEM" -gt "$donem" ]; then HF_KOK_DURUMU=$h; return 0; fi
  if [ "$HF_KOK_DONEM" -eq "$donem" ] && { [ "$HF_KOK_PUB" != "$pub" ] || [ "$HF_KOK_TAAHHUT" != "$taahhut" ]; }; then
    hf_hata ROOT_CONFLICT; return 1
  fi
  HF_KOK_DONEM=$donem HF_KOK_PUB=$pub HF_KOK_TAAHHUT=$taahhut
}

# Var olan kurulumda sürüm tekdüzeliği (RFC-0026 c), paketteki Node çalışmadan ve kalıcı araçlara dokunulmadan: bildirimin
# sürümü kurulu en yüksekten düşükse VERSION_TOO_LOW; bildirimin kendi listesinde ya da yetki.durum'da geri çekilmiş/bozuk
# işaretliyse VERSION_REVOKED; yetki.durum okunamazsa PRIVILEGE_STATE_CORRUPT. Sistemin python3'üyle (installer/lib/package.js
# yetkiDurumu ile aynı karar). Önce hf_bildirim_dogrula.
HF_SURUM_PY='
import json, sys
def tamsayi(x): return isinstance(x, int) and not isinstance(x, bool)
try:
    with open(sys.argv[1], encoding="utf-8") as g: d = json.load(g)
    ok = isinstance(d, dict) and tamsayi(d.get("enYuksek")) and d["enYuksek"] >= 0
    listeler = [d.get(a, []) for a in ("revoked", "bozuk")] if ok else []
    ok = ok and all(isinstance(x, list) and all(tamsayi(v) for v in x) for x in listeler)
except Exception:
    ok = False
k = int(sys.argv[2])
if not ok: print("PRIVILEGE_STATE_CORRUPT")
elif k < d["enYuksek"]: print("VERSION_TOO_LOW")
elif any(k in x for x in listeler): print("VERSION_REVOKED")
else: print("TAMAM")
'
hf_surum_denetle () {
  local f=$1 s
  case " $HF_GERI_CEKILEN " in *" $HF_KOD "*) hf_hata VERSION_REVOKED; return 1 ;; esac
  [ -e "$f" ] || return 0
  s=$(python3 -I -c "$HF_SURUM_PY" "$f" "$HF_KOD") || { hf_hata PRIVILEGE_STATE_CORRUPT; return 1; }
  [ "$s" = TAMAM ] || { hf_hata "$s"; return 1; }
}

hf_ozet_etiketli () { # etiket dosya [bayt sayısı] → onaltılık BLAKE2b-256
  if [ -n "${3:-}" ]; then { printf '%s' "$HF_ETIKET_ONEK$1"; head -c "$3" "$2"; } | b2sum -l 256 | cut -d' ' -f1
  else { printf '%s' "$HF_ETIKET_ONEK$1"; cat "$2"; } | b2sum -l 256 | cut -d' ' -f1; fi
}

# Bildirimi doğrular ve istenen paket satırını bulur. hf_bildirim_dogrula <dosya> <kanal> <os> <arch>
# Önce hf_kok_durumu_coz çağrılmış olmalı. Çıktı: HF_SURUM, HF_KOD, HF_KANAL, HF_PAKET_ADI, HF_PAKET_BOYUT,
# HF_PAKET_OZET, HF_PAKET_URLS, HF_BILDIRIM_OZETI. Hata: HF_HATA (FORMAT_ERROR, ROOT_EPOCH_ERROR, SIGNATURE_ERROR, COMMITMENT_ERROR, PRODUCT_MISMATCH, CHANNEL_MISMATCH, NO_PACKAGE)
hf_bildirim_dogrula () {
  local f=$1 kanal=$2 os=$3 arch=$4 k n m t
  HF_HATA=""
  hf_dosya_oku "$f"
  [ "$HF_N" -ge 65 ] || { hf_hata FORMAT_ERROR; return 1; }
  HF_SON=$((HF_N - 64))
  hf_uint || return 1; [ "$HF_U" -eq 1 ] || { hf_hata FORMAT_ERROR; return 1; }
  hf_dizge || return 1; local urun=$HF_S
  hf_dizge || return 1; HF_SURUM=$HF_S
  hf_uint || return 1; HF_KOD=$HF_U
  hf_dizge || return 1; HF_KANAL=$HF_S
  hf_uint || return 1; hf_uint || return 1; hf_bool || return 1  # publishedAt, minFrom, urgent
  HF_PAKET_ADI=""
  hf_uint || return 1; n=$HF_U
  for ((k = 0; k < n; k++)); do
    hf_dizge || return 1; local pos=$HF_S
    hf_dizge || return 1; local parch=$HF_S
    hf_dizge || return 1; local pad=$HF_S
    hf_uint || return 1; local pboy=$HF_U
    hf_hex 32 || return 1; local poz=$HF_H
    hf_urls || return 1
    if [ "$pos" = "$os" ] && [ "$parch" = "$arch" ] && [ -z "$HF_PAKET_ADI" ]; then
      HF_PAKET_ADI=$pad HF_PAKET_BOYUT=$pboy HF_PAKET_OZET=$poz HF_PAKET_URLS=$HF_URLS
    fi
  done
  hf_uint || return 1; n=$HF_U                                     # images
  for ((k = 0; k < n; k++)); do
    for t in 1 2 3 4; do hf_dizge_atla || return 1; done           # type, version, arch, ociDigest
    hf_dizge_atla || return 1; hf_uint || return 1; hf_hex 32 || return 1; hf_urls || return 1   # archive
    hf_bool || return 1
    if [ "$HF_U" -eq 1 ]; then hf_dizge_atla || return 1; hf_hex 32 || return 1; hf_urls || return 1; fi
    hf_uint || return 1                                            # ramMB
    for t in 1 2 3 4; do hf_bool || return 1; done                 # policy
  done
  hf_uint || return 1; n=$HF_U                                     # assets
  for ((k = 0; k < n; k++)); do hf_dizge_atla || return 1; hf_uint || return 1; hf_hex 32 || return 1; hf_urls || return 1; done
  hf_uint || return 1; n=$HF_U                                     # installer
  for ((k = 0; k < n; k++)); do hf_dizge_atla || return 1; hf_dizge_atla || return 1; hf_uint || return 1; hf_hex 32 || return 1; hf_urls || return 1; done
  hf_uint || return 1; n=$HF_U                                     # installerDebs
  for ((k = 0; k < n; k++)); do hf_dizge_atla || return 1; hf_dizge_atla || return 1; hf_hex 32 || return 1; done
  hf_uint || return 1; n=$HF_U                                     # revoked
  HF_GERI_CEKILEN=""
  for ((k = 0; k < n; k++)); do hf_uint || return 1; HF_GERI_CEKILEN+=" $HF_U"; done
  hf_uint || return 1; n=$HF_U                                     # catalogKeys
  for ((k = 0; k < n; k++)); do hf_hex 32 || return 1; hf_uint || return 1; done
  hf_uint || return 1; local donem=$HF_U
  hf_hex 32 || return 1; local taahhut=$HF_H
  hf_dizge_atla || return 1                                        # notes
  [ "$HF_I" -eq "$HF_SON" ] || { hf_hata FORMAT_ERROR; return 1; }
  [[ "$HF_SURUM" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]] || { hf_hata FORMAT_ERROR; return 1; }
  m=$((10#${BASH_REMATCH[1]} * 1000000 + 10#${BASH_REMATCH[2]} * 1000 + 10#${BASH_REMATCH[3]}))
  [ "${BASH_REMATCH[2]}" -lt 1000 ] && [ "${BASH_REMATCH[3]}" -lt 1000 ] && [ "$m" -eq "$HF_KOD" ] || { hf_hata FORMAT_ERROR; return 1; }
  [ "$HF_KANAL" = kararli ] || [ "$HF_KANAL" = deneme ] || { hf_hata FORMAT_ERROR; return 1; }
  # 2. kök dönemi (büyükse önce kök döndürme zinciri gerekir: bu araç zincir uygulamaz, yeni havenfold-kur gerekir)
  [ "$donem" -eq "$HF_KOK_DONEM" ] || { hf_hata ROOT_EPOCH_ERROR; return 1; }
  # 3. imza
  local d
  d=$(mktemp -d)
  hf_hex_ikili "302a300506032b6570032100$HF_KOK_PUB" > "$d/kok.der"
  hf_ozet_etiketli 'hf/release/' "$f" "$HF_SON" > "$d/ozet.hex"
  HF_BILDIRIM_OZETI=$(cat "$d/ozet.hex")
  hf_hex_ikili "$HF_BILDIRIM_OZETI" > "$d/ozet"
  tail -c 64 "$f" > "$d/imza"
  if ! openssl pkeyutl -verify -pubin -inkey "$d/kok.der" -keyform DER -rawin -in "$d/ozet" -sigfile "$d/imza" > /dev/null 2>&1; then
    rm -rf "$d"; hf_hata SIGNATURE_ERROR; return 1
  fi
  rm -rf "$d"
  # 4. taahhüt
  [ "$taahhut" = "$HF_KOK_TAAHHUT" ] || { hf_hata COMMITMENT_ERROR; return 1; }
  # 5–6. ürün ve kanal
  [ "$urun" = havenfold-node ] || { hf_hata PRODUCT_MISMATCH; return 1; }
  [ "$HF_KANAL" = "$kanal" ] || { hf_hata CHANNEL_MISMATCH; return 1; }
  [ -n "$HF_PAKET_ADI" ] || { hf_hata NO_PACKAGE; return 1; }
}

# 9. dosya boyutu ve özeti
hf_paket_denetle () {
  local f=$1
  [ "$(wc -c < "$f" | tr -d ' ')" -eq "$HF_PAKET_BOYUT" ] || { hf_hata DIGEST_MISMATCH; return 1; }
  [ "$(hf_ozet_etiketli 'hf/release-pkg/' "$f")" = "$HF_PAKET_OZET" ] || { hf_hata DIGEST_MISMATCH; return 1; }
}
