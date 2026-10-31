#!/usr/bin/env bash
# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
# was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
# public-repo.sh — açılış günü: kapalı depodan herkese açık deponun ilk kaydına girecek temiz ağacı üretir ve tarar
# (kurucu §18.2, §20.2; RFC-0033 §5).
#
#   bash scripts/public-repo.sh <hedef> [--kayit <ref>]
#
# Ne yapar:
#   1. <ref>'in (varsayılan HEAD) ağacını git archive ile <hedef>'e çıkarır (git geçmişi gelmez).
#   2. İç dosyaları siler: kollar/, AGENTS.md ve CLAUDE.md (makine ve kol düzeni; dış katkı kuralları CONTRIBUTING.md'de).
#      arastirma/'da izin listesi: yalnız 1-cihaz-platformu.md, 3-aile-asistani.md (kurucu belge §24), LICENSE ve denetim/
#      kalır; geri kalan her şey silinir: 2-* ve 4-* (kapalı arşivde kalan raporlar; RFC-0038 §2.6), kurulum/ (iç makine
#      adları taşıyan kurulum araştırması) ve araştırmaya sonradan eklenen her iç klasör.
#   3. Ağacı tarar ve <hedef>/../acik-depo-rapor.txt'ye yazar:
#      KESİN  (çıkış kodu 1): iç ağ adresi, /home/ ve /Users/ yolları, kişisel e-posta (kurumsal iletişim adresi info@havenfolddev.com hariç, RFC-0035), gizli anahtar kalıbı.
#      GÖZDEN GEÇİR (yalnız rapor): kollar/ başvurusu ve depo dışındaki kalıp dosyasının kalıpları (kişi, yer ve makine
#      adları). Kalıp dosyası: HF_ACIK_KALIPLAR, yoksa ~/.calisma/EserX-gizli/acik-depo-kaliplar.txt. Biçim: satır başına
#      "<başlık><TAB><grep -E kalıbı>"; # ile başlayan ve boş satırlar atlanır. Dosya yoksa bu adım uyarıyla atlanır
#      ve tarama EKSİK sayılır.
#      Kalıplar bu betikte durmaz, çünkü betik açık ağaçta kalır (RFC-0038 §2.8).
#   4. gitleaks varsa yalnız ağaçta (--no-git) koşar; test vektörü istisnası .gitleaks.toml'da gerekçeli; başka bulgu KESİN sayılır.
#   Hariç tutmalar satıra değil her eşleşmeye (ya da dosya yoluna) uygulanır. gitleaks ya da kalıp dosyası yoksa ağaç
#   yine üretilir ama sonuç EKSİK'tir (çıkış kodu 2): açılış kapısı yalnız TAMAM'la (çıkış kodu 0) geçilir.
#
# Dokunmadıkları: kapalı depo, dallar, GitHub. Yeni depoyu kurmak ve ilk kaydı atmak Kerem'in adımıdır (RFC-0033 §5).
set -euo pipefail
HEDEF=${1:?kullanım: public-repo.sh <hedef> [--kayit <ref>]}
# Göreli hedef çağıranın klasörüne göredir (aşağıdaki cd'den önce)
case "$HEDEF" in /*) ;; *) HEDEF="$PWD/$HEDEF" ;; esac
cd "$(dirname "$0")/.."

KAYIT=HEAD
[ "${2:-}" = "--kayit" ] && KAYIT=${3:?--kayit <ref>}
[ -e "$HEDEF" ] && { echo "HATA: hedef var: $HEDEF (boş olmayan dizine yazılmaz)" >&2; exit 1; }

mkdir -p "$HEDEF"
git archive --format=tar "$KAYIT" | tar -x -C "$HEDEF"
rm -rf "$HEDEF/kollar" "$HEDEF/AGENTS.md" "$HEDEF/CLAUDE.md"
ARASTIRMA_ACIK=' 1-cihaz-platformu.md 3-aile-asistani.md LICENSE denetim '
if [ -d "$HEDEF/arastirma" ]; then
  for f in "$HEDEF"/arastirma/* "$HEDEF"/arastirma/.[!.]*; do
    [ -e "$f" ] || continue
    case "$ARASTIRMA_ACIK" in *" $(basename "$f") "*) ;; *) rm -rf "$f"; echo "silindi: arastirma/$(basename "$f")" ;; esac
  done
fi

RAPOR="$(cd "$HEDEF/.." && pwd)/acik-depo-rapor.txt"
: > "$RAPOR"
kesin=0
eksik=0

tara () { # tara <başlık> <grep -E kalıbı> [eşleşmede hariç kalıp] [yolda hariç kalıp]
  # Hariç tutma satıra değil her eşleşmeye uygulanır: izinli adresle aynı satırdaki başka adres kaçmaz (Codex 12. tur)
  local bulgu g=0
  # Geçersiz kalıpta grep 2 döner; aşağıdaki || true bunu "bulgu yok"a çevirirdi (Codex 12. tur)
  printf '' | grep -E -- "$2" >/dev/null 2>&1 || g=$?
  if [ "$g" -eq 2 ]; then
    printf '\n## %s: HATA: geçersiz kalıp\n' "$1" >> "$RAPOR"
    echo "HATA: geçersiz kalıp: $1" >&2
    kesin=1
    return 1
  fi
  bulgu=$(cd "$HEDEF" && grep -rInE --exclude=public-repo.sh -e "$2" . 2>/dev/null | while IFS= read -r s; do
      if [ -n "${4:-}" ] && printf '%s\n' "${s%%:*}" | grep -qE "$4"; then continue; fi
      if [ -n "${3:-}" ] && [ -z "$(printf '%s\n' "${s#*:*:}" | grep -oE -e "$2" | grep -viE "$3")" ]; then continue; fi
      printf '%s\n' "$s"
    done || true)
  [ -z "$bulgu" ] && return 1
  { printf '\n## %s (%s satır)\n' "$1" "$(printf '%s\n' "$bulgu" | wc -l | tr -d ' ')"; printf '%s\n' "$bulgu" | cut -c1-220; } >> "$RAPOR"
  return 0
}

echo "# Açık depo taraması — $(git rev-parse --short "$KAYIT") — $(date -u +%Y-%m-%dT%H:%MZ)" >> "$RAPOR"
echo "# KESİN" >> "$RAPOR"
tara 'İç ağ adresi (testler hariç: yerel adres denetiminin örnekleri)' '\b(192\.168|10\.[0-9]+\.[0-9]+|172\.(1[6-9]|2[0-9]|3[01]))\.[0-9]+\b' '' '/test/' && kesin=1
tara 'Ev dizini yolu' '/home/[a-z][A-Za-z0-9._-]*|/Users/[A-Za-z][A-Za-z0-9._-]*' '^/home/runner$' '/test/' && kesin=1
tara 'Kişisel ya da şirket e-postası' '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}' '^(info@havenfolddev\.com|git@github\.com|[^@]*@(havenfold\.io|example\.(com|org)|[a-z.]*\.example|ornek\.com(\.tr)?|users\.noreply\.github\.com|node[0-9]\.hyperdht\.org|tty[0-9][^@]*))$' && kesin=1
# PEM: satır başı (dosyadaki anahtar) ya da başlıktan hemen sonra base64 (dizgiye gömülü anahtar, \n ile)
tara 'Gizli anahtar kalıbı' '^-----BEGIN [A-Z ]*PRIVATE KEY-----|-----BEGIN [A-Z ]*PRIVATE KEY-----(\\r)?(\\n)?[A-Za-z0-9+/]{32}|ghp_[A-Za-z0-9]{20,}|github_pat_|sk-ant-|AKIA[0-9A-Z]{16}' && kesin=1
echo "# GÖZDEN GEÇİR" >> "$RAPOR"
tara 'kollar/ başvurusu' 'kollar/' || true
KALIPLAR=${HF_ACIK_KALIPLAR:-$HOME/.calisma/EserX-gizli/acik-depo-kaliplar.txt}
if [ -r "$KALIPLAR" ]; then
  while IFS=$'\t' read -r baslik kalip || [ -n "${baslik:-}" ]; do # satır sonu olmayan son satır da
    case "$baslik" in ''|'#'*) continue ;; esac
    [ -n "${kalip:-}" ] || { echo "UYARI: kalıp dosyasında kalıpsız satır atlandı: $baslik" >&2; continue; }
    tara "$baslik" "$kalip" || true
  done < "$KALIPLAR"
else
  echo "UYARI: kalıp dosyası yok ($KALIPLAR); kişi, yer ve makine adı taraması atlandı" | tee -a "$RAPOR" >&2
  eksik=1
fi

if command -v gitleaks >/dev/null 2>&1; then
  if ! (cd "$HEDEF" && gitleaks dir . --no-banner --redact --config .gitleaks.toml >> "$RAPOR" 2>&1); then
    echo "gitleaks bulgusu var (rapor sonunda); gerçek bulgu değilse .gitleaks.toml'a tek tek gerekçeyle" >&2
    kesin=1
  fi
else
  echo "UYARI: gitleaks yok; gizli bilgi taraması yalnız kalıplarla yapıldı" | tee -a "$RAPOR" >&2
  eksik=1
fi

echo "ağaç: $HEDEF"
echo "rapor: $RAPOR"
if [ "$kesin" -ne 0 ]; then echo "AÇIK DEPO HAZIR DEĞİL: KESİN bulgular var (rapor)"; exit 1; fi
# Tarama eksikse (gitleaks ya da kalıp dosyası yok) ağaç üretilir ama açılış kapısı geçilmiş sayılmaz
if [ "$eksik" -ne 0 ]; then echo "AÇIK DEPO TARAMASI EKSİK: gitleaks ya da kalıp dosyası yok; açılış kapısı sayılmaz"; exit 2; fi
echo "AÇIK DEPO TARAMASI TAMAM (GÖZDEN GEÇİR bölümüne bakın)"
