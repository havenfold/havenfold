# RFC-0038 — Açılış öncesi içerik

> Durum: **Onaylandı** (Kerem, 25 Ekim 2026), kurucu belge 1.23 · 25 Ekim 2026 · Yazan: Havenfold çekirdek ekibi · Onay: Kerem
> Kaynak: Kerem'in 25 Ekim 2026 kararları: (1) `arastirma/2-ekosistem-stratejisi.md` ve `arastirma/4-havenfold-alan-adi.md` açık depoya girmez, kapalı arşivde kalır; 1 ve 3 "kuruluş öncesi araştırma" notuyla kalır. (2) Kurucu belge §15 kısaltılır. (3) Patent dili "savunma yayını" olarak yazılır. (4) "Alan adları boş" cümleleri silinir. (5) README'de yapay zeka cümlesi yok; belgelerdeki mevcut izlere dokunulmaz. (6) `GOVERNANCE.md`'de proje sahibinin adı yazılır: "Kerem Eser, founder of Eser Teknoloji". (7) Test vektörlerindeki ilk adlar şimdilik kalır. (8) Telif: "Copyright © 2026 Eser Teknoloji and contributors".
> Etkilenen bölümler: kurucu belge §0, §1, §5.1, §9.1, §11, §13.3, §15, §17.1, §17.3, §18, §19, §20.1, §20.2, §22, §24; RFC-0005 §12.3 (kaynak başvurusu), RFC-0033 §5, RFC-0035 §4; `docs/mimari.md`; `scripts/public-repo.sh`, `scripts/spdx.js`.
> **Protokol değişikliği: yok.** Numara, zarf, olay, düzey ve kod davranışı değişmez. Yalnız belge içeriği, lisans bildirimleri ve açılış betikleri.

## 1. Sorun

Depo herkese açılmadan önce belgelerde açık depoya ait olmayan ya da eskimiş içerik var:

1. Kurucu belge §15 ürünlerin iç ayrıntılarını taşıyor: kotalar, donanım, mağaza sürüm içerikleri, bir marka başvuru numarası, Mekan ürünlerinin bugünkü iç yığını ve bir bağımlılığın lisans durumu. Çekirdeğin bunlara ihtiyacı yok; ürün kararları ürün depolarındadır.
2. §20.1 ve HF67 patent konusunu "patent adayları" ve "başvuru yapılmadı" diye anlatıyor. Kerem'in kararı savunma yayınıdır; metin bunu söylemeli.
3. §17.3 ve RFC-0035 §4 alan adlarının o günkü durumunu yazıyor. Bu bilgi açık depoda gereksiz ve çabuk eskir.
4. §18.1–18.3 kişisel GitHub hesabını, kapalı ürün depolarının adlarını, kişisel iki adımlı doğrulama durumunu, yerel klasör yollarını ve ajan makinesi düzenini yazıyor.
5. Belgelerin lisansı tek satırda ("Dokümanlar: CC BY 4.0"); kurucu belge, `arastirma/` ve README dosyaları dizin kuralının dışında kalıyor. Bir `.md` dosyası SPDX satırı taşıyor, diğerleri taşımıyor.
6. §1 "Bugünkü durum", §5.1 "Yazılacak" satırları, §9.1 ve HF12'deki "Node 24 LTS" ve §20.2 kutucukları koddan geride.
7. MPL-2.0 dosyalarında Exhibit A bildirimi yok; telif satırı hiçbir yerde yazılı değil.
8. `scripts/public-repo.sh` gözden geçirme taramasının kişi adı ve mahalle kalıplarını kendi içinde yayımlıyor.

## 2. Karar

### 2.1 Kurucu belge §15

§15, çekirdeğin desteklemesi gereken ürünlerle sınırlanır: ürün başına ne olduğu ve Havenfold'un hangi katmanını kullandığı. Alt bölüm numaraları (15.1–15.5) başka bölümlerden ve RFC'lerden başvurulduğu için korunur. Çıkanlar:

- kotalar ve ücret paketlerinin ayrıntısı (kamera ve ücret kuralı HF25 olarak kısa kalır);
- donanım ayrıntıları;
- mağaza sürüm içerikleri ve sürüm planları;
- marka başvuru numarası;
- Mekan ürünlerinin bugünkü iç yığını ve dosya adları;
- bir bağımlılığın bugünkü lisans durumunu anlatan satır.

Aynı türden içerik §11 (Mekan'ın bugünkü uzaktan erişimi), §17.1 (bağımlılık kuralındaki ürün başvurusu), HF27 ve HF37'de (bağımlılık adı) de kaldırılır; kural aynen kalır: kapalı ürünler AGPL bağımlılık kullanamaz, Mekan imajlarında Apache ya da MIT lisanslı modeller kullanılır. Çıkarılan metin depo dışındaki çalışma arşivinde saklanır.

### 2.2 Savunma yayını (§20.1, HF67)

- Havenfold'un teknik yenilikleri açık yayımlanır. Eser bunlar için patent başvurusu yapmaz.
- Açık yayın, başkalarının bu yenilikler için patent almasını engeller.
- Katkıcıların patent izni lisanslarda zaten vardır: MPL-2.0 §2.1(b) ve Apache-2.0 §3.
- "Patent adayı" ifadesi kalkar; teknik yenilik listesi kalır. HF28 "HF67 ile kapandı" notunu alır.

### 2.3 Alan adı durumu (§17.3, RFC-0035 §4)

§17.3'teki ad ve alan adı durum listesi silinir; "alan adı alınınca" diye geleceğe dönük ifadeler kalır. RFC-0035 §4'teki alan adı durum cümlesi kaldırıldı; RFC'nin geri kalanı değişmez. Alan adı ön kontrolü (`arastirma/4-havenfold-alan-adi.md`) kapalı arşivde kalır.

### 2.4 GitHub ve çalışma düzeni (§18, §19)

- §18.1: organizasyon (`github.com/havenfold`), iletişim, zorunlu iki adımlı doğrulama, ikinci organizasyon sahibi ve `main` dal koruması kalır. Kişisel hesap, kapalı ürün depolarının adları, eski organizasyon adı ve kişisel iki adımlı doğrulama durumu çıkar. Ürün depoları için tek cümle: "Ürün depoları ayrı ve kapalıdır." HF21, HF36 ve §19 madde 6 buna göre yazılır.
- §18.2–18.3: yerel yollar ve makine düzeni çıkar. Tek not: "`AGENTS.md`, `kollar/` ve makine düzeni çalışma arşivine aittir, açık depoda yer almaz." Herkes için geçerli kurallar (PR, `--force` yok, gizli dosyalar, sürüm kök anahtarı) §18.3'te kalır.
- Aynı kişisel ayrıntılar `docs/rfc/RFC-0029` (ürün depoları sütunu) ve `docs/audit/sinirlar-ve-kapsam-disi.md`'de genelleştirilir. `core/core/KAYNAK.md`'deki kaynak depo satırı kalır (kopyalanan kodun kökeni).

### 2.5 Belgelerin lisansı (§17.1)

- Belgeler, `KURUCU-BELGE.md`, `arastirma/` ve README/BENIOKU dosyaları dahil, CC BY 4.0'dır.
- `.md` dosyaları SPDX satırı taşımaz; dizindeki `LICENSE` ve README'deki lisans kuralı onları kapsar. `installer/BENIOKU.md`'deki SPDX satırı kalkar. `arastirma/LICENSE` CC BY 4.0 metnini taşır (`LICENSES/CC-BY-4.0.txt` kopyası).
- Kökte `NOTICE` dosyası telif satırını taşır: "Copyright © 2026 Eser Teknoloji and contributors."
- MPL-2.0 dosyaları SPDX satırının hemen altında MPL-2.0 Exhibit A bildirimini taşır; `scripts/spdx.js` bunu ekler ve denetler.

### 2.6 Araştırma raporları (§24)

`arastirma/2-ekosistem-stratejisi.md` ve `arastirma/4-havenfold-alan-adi.md` açık depoya girmez; `scripts/public-repo.sh` onları açık ağaçtan siler. `arastirma/1-cihaz-platformu.md` ve `arastirma/3-aile-asistani.md` başlarında "kuruluş öncesi araştırma" notuyla kalır. §24 ve RFC-0005'teki başvurular buna göre yazılır.

**Ek (28 Ekim 2026, Codex 10. tur):** `arastirma/kurulum/` (kurulum araştırması; iç makine adları taşır) de açık depoya girmez. `scripts/public-repo.sh` `arastirma/` için izin listesi kullanır: yalnız yukarıdaki iki rapor, `LICENSE` ve `denetim/` kalır; araştırmaya sonradan eklenen her klasör kendiliğinden dışarıda kalır.

### 2.7 Eskimiş durum cümleleri

- §1 "Bugünkü durum" bugüne göre yazılır: kayıt, görev, kasa, olay, taşıyıcı, yapay zeka, düğüm yazılımı, Kurulum USB'si ve OCR imajı kodda var ve testli; gerçek bir evde henüz çalışmadı; bağımsız denetim yok; telefon uygulamaları ayrı, kapalı depolarda.
- §5.1 tablosunun "Bugünkü durum" sütunu koda göre yazılır; protokolün yeri "numara tabloları ve test vektörleri `protocol/`'de, protokolün metni RFC'lerde" olur.
- §9.1 ve HF12: hedef çekirdeklerin Bare'de çalışmasıdır (RFC-0007 §4.1); bugün kutu, işçi ve denetçi paketle gelen Node 22 ile çalışır, Bare çekirdek telefonda çalışır (RFC-0021 madde 86: Node 22 ya da üstü).
- §13.3: bağımsız güvenlik denetimi açılıştan sonra, Faz 3'te yapılır; kasanın yayını için koşuldur, açılış için değil (RFC-0033 §2.5).
- §20.2 kutucukları gerçeğe göre işaretlenir.

### 2.8 Diğer düzeltmeler

- `docs/mimari.md`: RFC-0027 ve RFC-0028 onaylıdır; `core/disaster` vardır; paket tablosu ve grafa `core/disaster`, `core/services`, `core/edge`, `core/transport`, `services/receiver` eklenir.
- `protocol/` için "spesifikasyon" yerine "numara tabloları ve test vektörleri; protokolün metni RFC'lerdedir".
- RFC başlıklarında "Yazan" satırı "Havenfold çekirdek ekibi" olur; `docs/audit/` başlıklarındaki iç notlar sadeleşir.
- RFC-0033 §5 madde 4: istisna dosyası `.gitleaks.toml`'dur.
- `scripts/public-repo.sh`: kişi adı, yer ve makine kalıplarını depo dışındaki bir dosyadan okur (`HF_ACIK_KALIPLAR`, varsayılan `~/.calisma/EserX-gizli/acik-depo-kaliplar.txt`); dosya yoksa o adım atlanır ve uyarı verilir.

## 3. Kurucu belgede değişecekler (1.23)

- Başlık: sürüm 1.23, durum satırına 1.23.
- §0: onaylı RFC listesi RFC-0018–0037.
- §1, §5.1, §9.1, §13.3: §2.7.
- §11: Mekan'ın bugünkü uzaktan erişim satırı çıkar (§2.1).
- §15: §2.1.
- §17.1: belge lisansı satırı ve `.md` kuralı (§2.5); bağımlılık kuralındaki ürün başvurusu çıkar; protokol satırı §2.8'e göre.
- §17.3: §2.3.
- §18.1–18.3, §19 madde 6: §2.4.
- §20.1, §20.2 (patent maddesi ve kutucuklar): §2.2, §2.7.
- §22.1: HF12, HF21, HF27, HF28, HF36, HF37, HF67 güncellenir; HF70 satırı eklenir.
- §24: §2.6.

## 4. Risk ve geri dönüş

- Savunma yayını geri alınamaz; bu RFC'den önce de karar buydu (RFC-0035 §2). Değişen yalnız anlatım.
- Çıkarılan ürün ayrıntıları kaybolmaz; çalışma arşivinde durur. Yanlışlıkla çekirdeği ilgilendiren bir şey çıktıysa ayrı RFC'yle geri yazılır.
- Exhibit A bildirimi mekanik bir eklemedir; kod davranışını değiştirmez. Testler ve `scripts/spdx.js` denetimi bunu doğrular.

## Ek: RFC-0005, RFC-0016 ve RFC-0029

§15'teki kararın aynı gerekçesiyle (kapalı ürünün iç yapısı ve lisans durumu açık depoda yer almaz): RFC-0005 §16 (Mekanapp'in bugünkü yığını, M0–M4 taşıma aşamaları, model lisansı ayrıntısı) tek paragrafa indi, Havenfold için bağlayıcı kural kaldı (Mekan görev imajlarında yalnız Apache/MIT lisanslı modeller); RFC-0005 §2, §20 ve §21'deki bağlı satırlar, RFC-0016'daki model satırı ve RFC-0029 §7'deki Mekan AI Care cümlesi buna göre sadeleşti. Çıkan metin kapalı ürün belgelerindedir.
