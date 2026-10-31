# RFC-0026 — Düğümde güncelleme güvenliği: kökün durumu, sürüm tekdüzeliği, bağımsız geri dönüş

> Durum: **Onaylandı** (Kerem, 23 Ekim 2026) · 23 Ekim 2026 · Yazan: Havenfold çekirdek ekibi · Onay: Kerem
> Kaynak: dell'in D12 (RFC-0007 düğüm yazılımının temeli) uygulaması üstüne Mac'in incelemesi (`kollar/D-inceleme-11.md`).
> Kurucu belge: §13, §22. Etkilenen RFC: 0007 (§5, §6, §12, §17, §19).

## 1. Sorun

RFC-0007, kök yetkili yardımcının bildirimi "kendisi doğrulamasını" ister. Ama doğrulamanın dayandığı kök anahtar durumu ve en yüksek sürüm bilgisi, denetçinin (ağa çıkan, kök olmayan süreç) yazabildiği dizinde tutuluyor. Ayrıca yardımcının kendi kodu da güncellenen sürümden çalışıyor. Sonuç: ele geçirilmiş bir denetçi kendi anahtarını kök durumuna yazıp kendi paketini kurdurabiliyor ve bir sonraki çalıştırmada kod root olarak çalışıyor. İmzalı ama açığı bilinen eski bir sürüme ebeveyn onayı olmadan da dönülebiliyor. Sağlık denetimli geri dönüş ise yeni sürümün kendi kodu tarafından yürütülüyor; bozuk sürüm kendini geri almıyor.

## 2. Kararlar

| # | Karar | Neden |
|---|-------|-------|
| a | **Kökün durumu yalnız kökün yazabildiği yerdedir.** Kök anahtar durumu (`kok.durum`), en yüksek kurulu sürüm (`enYuksek`), geri çekilmiş ve bozuk sürüm listesi `/var/lib/havenfold/yetki/` altında, sahibi root, 0700. Denetçi bunları okuyabilir (kopya ile), yazamaz. ROOT_ROTATION'ı yardımcı kendisi doğrular ve uygular. | Ele geçirilmiş denetçi kendi anahtarını yazıp kök yetkisi alıyordu. |
| b | **Yardımcının kodu güncellenen sürümden çalışmaz.** Yardımcı, kurulumda gelen ve yalnız ayrı bir kök onayıyla (ebeveynin UPDATE_APPROVE'u ve ROOT_ROTATION taahhüdüne bağlı) değişen sabit bir yoldan (`/usr/lib/havenfold/yetki/`) çalışır. `guncel` bağı yardımcıyı hiçbir zaman değiştirmez. | Saldırganın paketi bir sonraki etkinleştirmede root olarak çalışıyordu. |
| c | **Sürüm tekdüzeliği yardımcıdadır.** `paket-ac` ve `surum-gec`, kökün dizinindeki `enYuksek`'ten düşük sürümü yalnız o sürümün bildirim özetine bağlı geçerli bir ebeveyn UPDATE_APPROVE'uyla kabul eder; onayı yardımcı kendisi doğrular. Geri çekilmiş (`revoked`) ve bozuk sürüm hiçbir yoldan kurulmaz. `surum-geri` yalnız açık bir sağlık denetimi penceresinde, son geçişin bir önceki sürümüne çalışır. | İmzalı eski bir sürüme onaysız dönülebiliyordu. |
| d | **Geri dönüş yeni koddan bağımsızdır.** Geçişten önce yardımcı kalıcı bir deneme kaydı yazar (`deneme { onceki, yeni, bitis }`, kökün dizininde). Bir systemd zamanlayıcısı ve açılış sayacı, pencere içinde denetçiden "sağlıklı" bildirimi gelmezse ya da düğüm üç kez açılıp sağlıklı olmazsa yardımcıya `surum-geri` yaptırır. Sağlık bildirimi çekirdeklerin MERHABA'sına dayanır; denetçinin kendi beyanı yetmez. | Yeni sürüm denetçiyi yeniden başlatınca deneme durumu kayboluyordu; bozuk sürüm geri dönmüyordu. |
| e | **Bekleyen güncelleme kalıcıdır ve en yüksek bildirim korunur.** Bekleyen güncelleme kalıcı tutulur. Daha düşük bir bildirim bekleyenin yerini almaz. Kurulu sürümden düşük bildirim sessizce yok sayılır; düşürme onay akışını yalnız ebeveyn başlatır. | Bir eş, geri çekilmiş daha eski bir sürümü kurdurabiliyor ya da sahte onay isteği gösterebiliyordu. |
| f | **Soket dizinleri (RFC-0007 §5 ve §6.1 netleştirmesi).** `/run/havenfold/<rol>/` dizininin sahibi o rolün çekirdeği, grubu `havenfold-yonetim`, izni 0750'dir. Denetçinin soketi `/run/havenfold/denetci/` altında ayrı bir dizindedir; çekirdekler oraya grup üyeliğiyle bağlanır. Ekran hizmeti ayrı bir kullanıcıyla (`havenfold-ekran`) çalışır, denetçi kimliğini paylaşmaz. | Tablolar birbiriyle çelişiyor, denetçi ile yönetim grubu birleşiyordu. |
| g | **Yardımcı birimi sertleştirilir.** `ProtectSystem=strict`, yalnız gereken yollar `ReadWritePaths`, `CapabilityBoundingSet` en dar küme, `SystemCallFilter=@system-service`, `RestrictAddressFamilies=AF_UNIX`, `PrivateNetwork=yes`, `PrivateDevices=yes`, `RestrictSUIDSGID=yes`, `ProtectKernelTunables=yes`, `ProtectControlGroups=yes`. Pil hizmeti de aynı biçimde sertleştirilir ve güncellenen sürümden çalışmaz. | Kök hizmetleri sertleştirilmemişti. |

## 3. Hata kodları

| RFC | Kodlar |
|-----|--------|
| 0007 | `APPROVAL_REQUIRED` (düşürme), `VERSION_REVOKED`, `NO_TRIAL`, `ROOT_STATE_NOT_WRITABLE` |

## 4. Koda yansıyan düzeltmeler

§2'nin bütün maddeleri dell'in kodunda değişiklik ister. Görevi `kollar/D-cekirdek.md` D20'dedir; bulgular `kollar/D-inceleme-11.md`'dedir.

## 5. Kurucu belgede değişecekler

| Bölüm | Değişiklik |
|-------|------------|
| §22 | HF58: "Düğümde kök yardımcının güvendiği durum yalnız kökün dizinindedir; yardımcı güncellenen sürümden çalışmaz; düşürme ebeveyn onayı ister; geri dönüş yeni koddan bağımsızdır (RFC-0026)." |

## Ek: açılış öncesi inceleme (25 Ekim 2026)

- **Dönülecek sürüm yoksa (d).** İlk kurulumun ilk geçişinde önceki sürüm yoktur. Sağlık penceresi dolunca yardımcı sürümü bozuk işaretler, `guncel` bağı yerinde kalır, son geçiş `geri-alinamadi` olur. Denetçinin güncelleyicisi bunu başarı saymaz: sürüm bozuk, `enYuksek` yükselmez, güncelleme durumu `hata` (`ROLLBACK_FAILED`; sağlık bildiriminde `GUNCELLEME_HATA`).
- **Var olan Ubuntu'da yeniden kurulum (a, c).** `havenfold-kur` bildirimi makinedeki kök durumuyla (gömülüden yeniyse) doğrular; sürüm düşürmeyi ve geri çekilmiş sürümü paketteki Node çalışmadan reddeder (RFC-0007 §8.6 uygulama notu).
