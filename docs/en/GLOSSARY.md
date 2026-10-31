# Glossary: Turkish terms in Havenfold

Havenfold's code identifiers and file names are English. Code comments, the RFCs and most design documents are
still Turkish, and some protocol labels keep their Turkish spelling (see the README's
[Language](../../README.md#language) section). This list maps the Turkish terms you meet most often to English;
the second column shows how the term is written in comments, protocol labels and older documents. Where a
term has a precise definition, the founding document ([Turkish](../../KURUCU-BELGE.md) §4,
[English](FOUNDING-DOCUMENT.md) §4) and the architecture walkthrough ([`docs/mimari.md`](../mimari.md) §11) are
the reference.

In code, Turkish letters are written without diacritics: `ı → i`, `ş → s`, `ğ → g`, `ü → u`, `ö → o`,
`ç → c`. So `esitleyici` is *eşitleyici* and `dugum` is *düğüm*.

## Community and ledger

| Turkish | Written as | English | Note |
|---------|---------|---------|------|
| topluluk | | community | The security boundary: its own ledger and keys. |
| aile | `aile` | family | A community of kind `aile`. |
| ekip | `ekip` | team | A community of kind `ekip` (businesses, RFC-0005). |
| defter | `ledger/`, `LedgerApi` | ledger | The signed, hash-chained record of members, devices, roles and collections. |
| aile kaydı | | family record | What apps call the ledger on screen. |
| üye | | member | |
| kişi | | person | Votes; limits and quorums count persons. |
| ana kimlik | | primary identity | A person's voting identity (RFC-0017). |
| ek kimlik | | secondary identity | The same person in another app or on another device; does not vote. |
| rol | | role | |
| ebeveyn | `ebeveyn` | parent | Family role. |
| yetişkin | `yetiskin` | adult | Family role. |
| çocuk | `cocuk` | child | Family role; signs but is not counted in quorums. |
| sahip, yönetici, çalışan, geçici | `sahip`, `yonetici`, `calisan`, `gecici` | owner, manager, employee, temporary | Team roles. |
| misafir | `misafir` | guest | Time-limited, narrow access, for example a caregiver. |
| bakıcı | | caregiver | A typical guest. |
| tören | `toren` | ceremony | The in-person joining flow: QR code, 5 pictures, signatures. |
| davet | `davet` | invitation | |
| katıl | `katil` | join | The old name of `havenfold join` (still accepted). |
| öneri | `oneri`, `proposals` | proposal | A ledger event still waiting for signatures. |
| yeter sayı | `quorum` | quorum | |
| imza | `imza` | signature | |
| düzey | `duzey`, `LEVELS` | protocol level | 2.0, 2.1, 2.2, 2.3; only goes up. |
| yer | | place | A physical location: a home, a branch. |
| çift sırrı | `pairs` | pair secret | A secret two identities derive from the ledger; rendezvous and seals come from it. |
| emanet | `emanet`, HOLD | hold | A sealed envelope left with the box for an offline recipient. |
| resimler | `resimler` | pictures | The 5 pictures both screens show during the ceremony. |

## Records

| Turkish | Written as | English | Note |
|---------|---------|---------|------|
| kayıt | `kayit` | record | Also used for a git commit in Turkish commit messages ("kayıt mesajı"). |
| kayıt katmanı | `core/records` | record layer | RFC-0001. |
| koleksiyon | | collection | An encrypted compartment whose readers and writers are in the ledger. |
| işlem | `islem` | operation | One encrypted, signed change to a record. |
| dönem | `donem` | epoch | The period in which a collection's reader set is valid. |
| dönem anahtarı | | epoch key | |
| kesim | `kesim` | cutoff | The signed end of a former writer's valid operations. |
| okuyucu | `okuyucu` | reader | |
| yazar | `yazar` | writer | |
| yetki | `yetki` | authorization, permission | |
| birleştirme | `birlestir` | merging | Field-level last writer wins. |
| eşitleme | `esitleme` | sync | |
| eşitleyici | `esitleyici` | synchronizer | |
| dosya | `dosya` | file | Large data stored apart from the record. |
| mezar | `mezar` | tombstone | |
| temizlik | `temizlik` | cleanup | Removal of expired or deleted records. |
| duyarlılık | `sensitivity` | sensitivity | `kasa` marks a vault collection. |
| Tüm Aile, Ebeveynler, Kişisel, Kasa | | Whole Family, Parents, Personal, Vault | Default collection names. |

## Tasks and devices

| Turkish | Written as | English | Note |
|---------|---------|---------|------|
| görev | `gorev` | task | A job a member gives to a worker. |
| görev katmanı | `core/tasks` | task layer | RFC-0002. |
| işçi | `isci` | worker | A linked device that runs tasks. |
| yetenek | `yetenek` | capability | What a device declares it can do. |
| yerleştirme | `yerlestirme` | placement | Choosing workers for a task. |
| koordinatör | `koordinator` | coordinator | |
| sürekli görev | `surekli` | continuous task | |
| ilk kullanım onayı | `onay` | first-use approval | A person's consent before their data goes to a worker. |
| onay | `onay` | approval, consent | |
| teslim | `teslim` | delivery | |
| sonuç | `sonuc` | result | |
| imaj | `imaj` | image | Container image of a task. |
| cihaz | `cihaz` | device | |
| bağlı cihaz | | linked device | A device in the community that is not a member: worker, edge device, accessory. |
| uç, uç cihaz | `uc` | edge device | Senses or displays: camera, sensor, screen. |
| kutu | `kutu` | box | Always-on, non-voting role that relays and holds sealed copies. |
| Aile Kutusu | | Family Box | The box role on a family's spare machine. |
| Ev Makinesi | | Home Machine | All linked devices shown as one card. |
| düğüm | `dugum`, `node` | node | A machine running `havenfold-node`. |
| çekirdek | `cekirdek` | core | |
| denetçi | `denetci` | supervisor | The node process that runs tasks and talks to the cores. |
| yetki yardımcısı | `yetki-yardimcisi` | privilege helper | Does the work on a node that needs root. |
| ilk ayar | `ilk-ayar` | first setup | The old name of `havenfold setup` (still accepted). |
| ilk açılış | `ilk-acilis` | first boot | |
| kurulum | `kurulum`, `kur` | installation | |
| Kurulum USB'si | `installer/` | Installer USB | |
| silme | `silme`, `sil` | erasure, erase mode | |
| emeklilik | `emeklilik` | retirement | A device leaving the community. |
| sağlık | `saglik` | health | |
| pil | `pil` | battery | |
| güncelleme | `guncelleme` | update | |
| sürüm | `surum` | release, version | |
| sürüm bildirimi | `bildirim` | release manifest | |
| kök anahtar | `kok` | root key | The offline release signing key. |
| paket | `paket` | package | |
| durum | `durum` | status, state | The old name of `havenfold status` (still accepted); also the phone's state file. |
| dağıtım | `dagitim` | deployment files | |

## Vault

| Turkish | Written as | English | Note |
|---------|---------|---------|------|
| kasa | `kasa` | vault | RFC-0004. |
| pay | `pay` | share | A Shamir share. |
| tutucu | `tutucu` | holder | Who holds a share. |
| eşik | `esik` | threshold | |
| yedek | `yedek` | backup | |
| kurtarma | `kurtarma` | recovery | |
| döndürme | `dondurme` | rotation | |
| kilit | `kilit` | lock | |
| mühür | `muhur` | seal | |
| zarf | `zarf` | envelope | Also the general word for a protocol message. |
| Arşiv katmanı | `arsiv` | Archive layer | Where a phone seals vault keys; unlocked with biometrics. |
| YA | | backup key | *Yedek Anahtarı*. |
| KRA | | vault recovery key | *Kasa Kurtarma Anahtarı*. |

## Events

| Turkish | Written as | English | Note |
|---------|---------|---------|------|
| olay | `olay` | event | A signed, standard record (RFC-0006). |
| rutin | `rutin` | routine | A learned normal band. |
| kural | `kural` | rule | A fixed condition. |
| vaka | `vaka` | case | The shared state of a deviation or a rule trigger. |
| kart | `kart` | card | A subject's face in the chat. |
| bildirim merdiveni | `merdiven` | notification ladder | |
| uyarı | `uyari` | alert, warning | |
| kriz | `kriz` | crisis | |
| afet | `afet` | disaster | |
| afet modu | `core/disaster` | disaster mode | RFC-0012. |
| sakla-ilet | | store-and-forward | |
| keşif | `kesif` | discovery | |

## Network and channels

| Turkish | Written as | English | Note |
|---------|---------|---------|------|
| taşıyıcı | `tasiyici` | transport | RFC-0028. |
| buluşma | | rendezvous | |
| oturum | `oturum` | session | |
| giriş | `giris` | ingress | `giris.gelenZarf`: the single entry point for incoming envelopes. |
| kanal | `kanal` | channel | The numbered command channel between an app and the core (RFC-0024). |
| çerçeve | `cerceve` | frame | |
| komut | `komut` | command | |
| köprü | `kopru` | bridge | The personal bridge, one of four ways out of a community. |
| Posta Kutusu | | Mailbox | Blind envelope store; not in this repository yet. |
| röle | | relay | |
| doğrudan | `dogrudan` | direct | |
| ağ | `ag` | network | |

## Other areas

| Turkish | Written as | English | Note |
|---------|---------|---------|------|
| hizmet | `hizmet` | service | A business outside the community (RFC-0010). |
| hizmet paylaşımı | | service sharing | |
| kap | `kap` | export container | RFC-0014. |
| dışa aktarma | | export | |
| yapay zeka | `yz` | AI | RFC-0013. |
| asistan | `asistan` | assistant | |
| gömme | `gomme` | embedding | |
| dizin | `dizin` | index; directory | Both meanings occur. |
| çocuk modu | `cocuk` | child mode | |
| kalkan | `kalkan` | shield | Aile Kalkanı, Family Shield. |
| Bakım Masası | `bakim` | Care Desk | Medication and appointments in Yuva Defteri. |
| ürün | `urun` | product | |
| uygulama | `uygulama` | app | |
| kimlik | `kimlik` | identity | |
| anahtar | `anahtar` | key | |
| türetme | `turetme` | derivation | |
| etiket | `etiket` | label | Derivation label. |
| vektör | `vectors`, `vektor` | test vector | |
| bulanık test | `bulanik` | fuzz test | |
| denetim | `denetim` | audit; check | |
| kontrol | `kontrol` | check | `scripts/check.sh`, the full check. |
| kapsam | `kapsam` | coverage; scope | |
| inceleme | | review | |
| örnek | `ornek` | example | |
| yardımcı | `yardimci` | helper | |
| tohum | `tohum` | seed | Demo data. |
| ölçüm | `olc` | measurement | |
| hata | `hata` | error | Error codes are English words in capitals, for example `NO_PERMISSION`. The codes carried in `TASK_REJECT` and edge stream messages keep their Turkish spelling (protocol labels). |
| yok | `yok` | none, missing | Older documents write error codes such as `ANAHTAR_YOK`; the code today is `NO_KEY`. |

## Documents that keep Turkish names

Files and directories have English names. Turkish documents keep their Turkish names until they are translated:
`KURUCU-BELGE.md` (founding document; English translation in [`FOUNDING-DOCUMENT.md`](FOUNDING-DOCUMENT.md)),
`BENIOKU.md` (Turkish README of a directory), `KAYNAK.md` (where copied code came from), the RFCs in `docs/rfc/`,
and the audit, architecture and SDK guide documents in `docs/`. Installed system files keep their names on
existing nodes (`/opt/havenfold/guncel/cekirdek`, `havenfold-*.service`).
