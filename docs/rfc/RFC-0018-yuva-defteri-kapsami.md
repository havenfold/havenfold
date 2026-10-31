# RFC-0018 — Yuva Defteri'nin kapsamı: Hikâye Arşivcisi Anılar'a taşınır

> Durum: **Onaylandı** (Kerem, 23 Ekim 2026) · 23 Ekim 2026 · Yazan: Havenfold çekirdek ekibi · Onay: Kerem
> Karar kaynağı: Kerem, 23 Ekim 2026 — önce Yuva Defteri'nin içeriğine karar verilir; diğer Yuva ürünlerinin hangi uygulamada olacağı sonraya bırakılır.
> Kurucu belge: §15.2, §15.3, §22. Protokol değişikliği yoktur.

## 1. Sorun

Kurucu belge §15.2, Yuva Defteri'nin v2'sine Bakım Masası ile birlikte **Hikâye Arşivcisi**'ni koyuyordu. Hikâyeler ev bilgisiyle, belgelerle ya da sağlıkla ilgili değildir. Yaptığı iş (sesli aile tarihi, tarif, fotoğrafla birlikte saklama) Anılar ürününün işiyle aynıdır (§15.3).

## 2. Karar

| Bölüm | Yer |
|-------|-----|
| v0 Defter (şablonlar, arama, @Yuva, Sohbetten Plana, takvim) | Yuva Defteri |
| v1 Kasa | Yuva Defteri. Belgeler zaten Defter'de; ayrı uygulama aynı belgeyi iki yerde tutar. |
| v1.5 Aile Kalkanı | Yuva Defteri. Güvenlik kelimesi Kasa altyapısına dayanır; büyük ekran Defter'in bir görünümüdür. |
| v2 Bakım Masası | Yuva Defteri. İlaç ve randevu sağlık özeti, takvim ve hatırlatmalarla aynı veridir. |
| Hikâye Arşivcisi | **Yuva Defteri'nden çıkar, Anılar'a gider.** |

Yuva Defteri'nin tanımı: ailenin bilgisi, belgeleri, güvenliği ve sağlığı.

## 3. Açık bırakılan

Diğer Yuva ürünlerinin (Bakım, Kamera, Pati, Acil ve Deprem, Çocuk, Anılar, Annemin Ritmi, Evine Sor, Kuş Penceresi) ayrı uygulama mı yoksa bir uygulamanın modülü mü olacağı sonra kararlaştırılır. Bilinen çelişki: §14.1 "her ürün kendi uygulamasıdır" der; §15.1 ve RFC-0008 bazılarını Yuva Hat'ın modülü sayar. O karar verilene kadar bu satırlar değişmez.

## 4. Kurucu belgede değişecekler (1.4)

| Bölüm | Değişiklik |
|-------|------------|
| §15.2 v2 | "Bakım Masası (ilaç, randevu, "aldım" onayı, acil durum kartı)." Hikâye Arşivcisi çıkar. |
| §15.3 Anılar | "Fotoğraf yedeği … ; Hikâye Arşivcisi (sesli aile tarihi, tarif; orijinal ses ve ham metin her zaman korunur) buraya taşındı (RFC-0018)." |
| §22 | HF50 eklenir. |

## 5. Ürün belgelerine etkisi

Yuva Defteri `docs/00`, `01`, `02`, `06`, `07`: Hikâye türleri (`yuva.defter.hikaye`, `.hikaye_sorusu`, `.tarif`), v2'deki Hikâyeler maddeleri ve `hf.task.transcribe` ön koşulu çıkar; YD49 eklenir. Hikâye kuralları (YD37) Anılar'ın belgesi yazılırken oraya taşınır.

## 6. Geri dönüş yolu

Kayıt türleri henüz hiçbir yerde kullanılmadı. Karar geri alınırsa türler aynı adlarla geri eklenir.
