# task-backup — `hf.task.backup`

Şifreli yedek bloklarını saklama işi. **Yerleşik iştir, konteyner imajı yoktur** (RFC-0002 §11.2, kurucu §8.7): denetçi
blokları şifreli hâlde `/var/lib/havenfold/yedek/<kapsam>/` altında tutar (`node/supervisor.js` `yedekYaz`, `yedekOku`,
`yedekSil`). Bu dizinde yalnız sözleşme (`CONTRACT.md`) ve lisans (`LICENSE`, Apache-2.0) vardır.

Yedek aracı (restic gibi) kullanılmaz: istemci blokları kendisi şifreler, düğüm içerik görmez ve yalnız saklar. Bu
yüzden imajda GPL/AGPL bileşen ve kaynak arşivi de yoktur.
