# RFC-0035 — Açılış kapısının daraltılması

> Durum: **Onaylandı** (Kerem, 25 Ekim 2026), kurucu belge 1.20 · 25 Ekim 2026 · Yazan: Havenfold çekirdek ekibi · Onay: Kerem
> Kaynak: Kerem, 25 Ekim 2026: "Marka başvurusu ve Havenfold'un alan adlarını sonra arayacağız. Patentlere de sonra bakarız. Önemli olan bizim işe başlayabilmemiz. Fikir herkes tarafından görülebilir, bu çok önemli değil. Önemli olan bu repoyu daha iyi tanıtabilmek. Devam edelim." Laptop denemesi için: "Gerek yok."
> Etkilenen bölümler: kurucu belge §17.3, §18.1, §20.1, §20.2, §22; RFC-0033 §3, §6.
> **Protokol değişikliği: yok.**

## 1. Sorun

RFC-0033'ten sonra kapıda yalnız kod dışı işler kaldı: üç evde kurulum, alan adları ve marka başvurusu, patent kararı, ilk sürümün kök anahtarla imzası. Kerem depoyu bunları beklemeden açmaya karar verdi; öncelik projeyi tanıtmak ve işe başlamak.

## 2. Karar

1. Şu maddeler **açılış koşulu değildir**, açılıştan sonra yapılır:
   - Ev Makinesi v0'ın üç evde çalışması (Faz 1'in çıkış ölçütü olarak kalır).
   - `havenfold.io` ve `havenfold.org` alan adları ve TÜRKPATENT marka başvurusu.
   - İlk etiketli sürümün kök anahtarla imzalı bildirimi (CI testleri, kabuk denetimi ve amd64/arm64 derlemesi kapıda kalır).
2. **Patent:** açılıştan önce patent başvurusu yapılmaz. Kerem bunu bilerek seçti: depo açılınca patent adayları (kurucu §20.1) yayımlanmış olur. Avrupa Patent Ofisi'nde yayından sonra başvuru yolu kapanır; Türkiye'de buluşçunun kendi açıklamasından sonra 12 aylık ek süre vardır (SMK m. 84; başvuru düşünülürse vekille doğrulanmalı). Karar §22'ye yazılır.
3. **İletişim:** alan adı alınana kadar güvenlik bildirimleri GitHub'ın özel güvenlik açığı bildirimiyle, diğer konular `info@havenfolddev.com` adresiyle (kurucu §18.1) alınır. `security@`, `hello@` ve `conduct@havenfold.io` alan adı alınınca devreye girer.
4. **Kapıda kalanlar:** lisans dosyaları ve SPDX başlıkları; İngilizce README; CONTRIBUTING, CODE_OF_CONDUCT, SECURITY, TRADEMARKS, GOVERNANCE; kurucu belgenin İngilizcesi; tehdit modeli; temizlik ve gizli bilgi taraması (`scripts/public-repo.sh`); CI (test, lint, derleme). Görev imajlarının kaynak arşivleri imajlar yayımlandığında aynı yerde yayımlanır.

## 3. Kurucu belgede değişecekler (1.20)

- §20.2: yukarıdaki üç madde "açılıştan sonra" olarak işaretlenir; patent maddesi "karar §22'de" olur.
- §18.1: iletişim satırına "güvenlik bildirimleri GitHub özel güvenlik açığı bildirimiyle" eklenir.
- §22.1: HF67 satırı.

## 4. Risk

- Patent: yukarıda; geri alınamaz.
- Marka: ad herkese görünür olur, başvuru yapılmadan başkası başvurabilir. Başvuru açılıştan hemen sonra önerilir.
- Alan adı: açılış ilgiyi artırabilir, erken alınması önerilir.
