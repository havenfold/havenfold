# RFC index (English)

Every change to the founding document, the protocol or the core goes through an RFC in [`docs/rfc/`](../rfc/).
The RFCs are written in Turkish; this page gives a short English summary of each. The Turkish table is
[`docs/rfc/README.md`](../rfc/README.md), and where this page and an RFC differ, the RFC prevails.

**About "Approved".** Every RFC below is marked *Onaylandı* (approved). Today that means approved by one person,
the project owner, after internal review; see [GOVERNANCE.md](../../GOVERNANCE.md). It does not mean an outside
review or audit.

**Reading order:** RFC-0003, then 0001, 0002 and 0004; then 0016 and 0005–0015. RFCs 0019–0027 are addenda that
came back from implementation and review.

| RFC | Title | Summary | Status |
|-----|-------|---------|--------|
| [0001](../rfc/RFC-0001-kayit-katmani.md) | Record layer | Shared data for every product: collections defined in the ledger, encrypted and signed operations, field-level merging, epoch keys, cutoffs for writers who leave, files, sync. Code: `core/records`. | Approved, 23 Oct 2026 |
| [0002](../rfc/RFC-0002-gorev-katmani.md) | Task layer | How a member hands a job to a worker: capability declarations, task envelopes, worker checks, first-use approval, placement, coordinator, continuous tasks, task images. Code: `core/tasks`, `node`, `images`. | Approved, 23 Oct 2026 |
| [0003](../rfc/RFC-0003-defter-v2-1.md) | Ledger v2.1 | Adds linked devices, guests, places, collections and permissions to the ledger, with a compatibility rule so older clients are not broken. The base of 0001, 0002 and 0004. | Approved, 23 Oct 2026 |
| [0004](../rfc/RFC-0004-kasa.md) | Vault | Shamir shares of the backup key and the vault recovery key, share holders and thresholds, recovery after a lost phone, rotation. Code: `core/vault`; not released before an independent audit. | Approved, 23 Oct 2026 |
| [0005](../rfc/RFC-0005-mekan-ekip.md) | Team community | The `ekip` (team) community for businesses: roles (owner, manager, employee, temporary), places, large teams, and rules against per-employee monitoring. | Approved, 23 Oct 2026 |
| [0006](../rfc/RFC-0006-olay-ve-rutin.md) | Events and routines | The event envelope, the event type catalogue, the routine engine, rules, cases with deterministic identities, the notification ladder and cards. Code: `core/events`. | Approved, 23 Oct 2026 |
| [0007](../rfc/RFC-0007-dugum-kurulum-guncelleme.md) | Node, installer, updates | `havenfold-node`: processes and users, local IPC, the Installer USB, first boot, turning a laptop into a server, secure erasure, and signed updates with a root key. Code: `node`, `installer`. | Approved, 23 Oct 2026 |
| [0008](../rfc/RFC-0008-konteynersiz-isci-ve-android-uc.md) | Containerless worker and edge device | Workers on Windows and macOS without containers (limited jobs, clear warnings), and old Android phones as edge devices such as cameras and screens. Code: `core/edge`. | Approved, 23 Oct 2026 |
| [0009](../rfc/RFC-0009-uzaktan-erisim-ve-buyuk-aktarim.md) | Remote access and large transfers | Reaching the home box from outside behind carrier NAT: an access ladder (port mapping, HyperDHT hole punching, the family's own tunnel, then a paid blind relay) and a transfer store for large files. | Approved, 23 Oct 2026 |
| [0010](../rfc/RFC-0010-hizmet-paylasimi.md) | Service sharing | Sending a one-time, time-limited, scoped package to a business outside the community (a vet, a care service), with consent, a verified directory and revocation. Code: `core/services`, `services/receiver`. | Approved, 23 Oct 2026 |
| [0011](../rfc/RFC-0011-konteyner-uygulamalari-ve-yerel-tunel.md) | Container apps and local tunnel | Running ready-made software (Home Assistant, Immich and the like) on a worker, reached from the phone through a tunnel inside the Noise session, without opening ports. | Approved, 23 Oct 2026 |
| [0012](../rfc/RFC-0012-afet-modu.md) | Disaster mode | Short messages inside the family when there is no internet or power: states, local links (local network, Bluetooth LE), message format, store-and-forward. Code: `core/disaster`. | Approved, 23 Oct 2026 |
| [0013](../rfc/RFC-0013-yapay-zeka-katmani.md) | AI layer | Where models run, routing between local and outside models, a local index on the phone, the assistant's limits, protection against prompt injection, child mode. Code: `core/ai`. | Approved, 23 Oct 2026 |
| [0014](../rfc/RFC-0014-disa-aktarma-kabi.md) | Export container | One encrypted export format for every product (Argon2id, `secretstream`, a ZIP inside) and a tool that opens it without Havenfold. Code: `core/export`, `tools/export-open`. | Approved, 23 Oct 2026 |
| [0015](../rfc/RFC-0015-sdk-ortak-alanlar.md) | SDK common fields | Shared needs of products: a member's last-seen time, the single list of reserved record fields and their types, and resolving member IDs after a phone change. Code: `sdk`. | Approved, 23 Oct 2026 |
| [0016](../rfc/RFC-0016-onayli-belge-ekleri.md) | Addenda to approved documents | Collects the changes that RFC-0005–0015 make to the founding document and RFC-0001–0004 in one place and resolves number clashes. | Approved, 23 Oct 2026 |
| [0017](../rfc/RFC-0017-ayni-ailede-birden-cok-uygulama.md) | Several apps in one family | Ledger v2.2: a person has one primary identity that votes and up to four secondary identities for other apps or devices that do not vote. | Approved, 23 Oct 2026 |
| [0018](../rfc/RFC-0018-yuva-defteri-kapsami.md) | Scope of Yuva Defteri | A product decision: the story archive moves from Yuva Defteri to a separate product. No protocol change. | Approved, 23 Oct 2026 |
| [0019](../rfc/RFC-0019-uygulama-ekleri.md) | Implementation addenda 1 | Error codes, field types, limits and orderings that the first implementation had to choose, written into the documents so a second implementation answers the same way. | Approved, 23 Oct 2026 |
| [0020](../rfc/RFC-0020-defter-inceleme-kararlari.md) | Ledger review decisions | Decisions from the ledger review: event mode, a pending primary identity, a guest's successor. | Approved, 23 Oct 2026 |
| [0021](../rfc/RFC-0021-kasa-inceleme-kararlari.md) | Vault and container review decisions | Warning and approval periods, version selection and a canonical ZIP for the export container. | Approved, 23 Oct 2026 |
| [0022](../rfc/RFC-0022-ekip-inceleme-kararlari.md) | Team review decisions | Duration of temporary members, handover in a team, the manager's area, leaving a team. | Approved, 23 Oct 2026 |
| [0023](../rfc/RFC-0023-uygulama-ekleri-3.md) | Implementation addenda 3 | Team details, the shared AI core, and a meaning layer for crisis detection. | Approved, 23 Oct 2026 |
| [0024](../rfc/RFC-0024-uygulama-cekirdek-kanali.md) | App–core command channel | The numbered command channel between a phone app and the core in its Bare worklet: framing, errors, events, callbacks; graded responses in crisis detection. | Approved, 23 Oct 2026 |
| [0025](../rfc/RFC-0025-uygulama-ekleri-4.md) | Implementation addenda 4 | The class of a newly scanned file and the channel's missing commands. | Approved, 23 Oct 2026 |
| [0026](../rfc/RFC-0026-dugum-guncelleme-guvenligi.md) | Node update security | Keeps the root key state and the highest installed version where only root can write, makes versions monotonic and lets the privilege helper roll back independently. | Approved, 23 Oct 2026 |
| [0027](../rfc/RFC-0027-uygulama-ekleri-5.md) | Implementation addenda 5 | Vault and export commands, moving the Archive key, persistence of the phone core, the personal bridge and the derivation-label rule. | Approved, 24 Oct 2026 |
| [0028](../rfc/RFC-0028-telefon-tasiyicisi.md) | Phone transport | Rendezvous, sessions and the ceremony over HyperDHT and Noise on phones and boxes. Code: `core/transport`; behind a flag on phones. | Approved, 24 Oct 2026 |
| [0029](../rfc/RFC-0029-yuva-acil-pati-bakim.md) | Yuva Acil, Pati and Bakım as separate apps | A product decision: emergency, pet and care become separate apps; edge mode and SOS in every Yuva app. No protocol change. | Approved, 24 Oct 2026 |
| [0030](../rfc/RFC-0030-misafirin-sinirli-yazmasi.md) | Limited writing by guests | A guest such as a caregiver can drop permitted events into one collection without being able to read it: new ledger event `GRANT_WRITE`, protocol level 2.3. | Approved, 24 Oct 2026 |
| [0031](../rfc/RFC-0031-sos-alanlari.md) | SOS fields | Optional fields of the `hf.sos` event: location, silent SOS, link to disaster mode, and SOS from a caregiver. | Approved, 24 Oct 2026 |
| [0032](../rfc/RFC-0032-kural-gun-saati-ve-kapatan-olay.md) | Time of day in rules | Rules gain a time of day, multi-day windows and an event that closes a case. No ledger change. | Approved, 24 Oct 2026 |
| [0033](../rfc/RFC-0033-herkese-acilis-takvimi.md) | Public opening schedule | The schedule and the exact meaning of each item of the gate for making this repository public, and the clean-history rule. | Approved, 24 Oct 2026 |
| [0034](../rfc/RFC-0034-bir-telefonda-birden-cok-aile.md) | Several families on one phone | A phone can belong to up to three families with separate, unlinkable identities in each. | Approved, 25 Oct 2026 |
| [0035](../rfc/RFC-0035-acilis-kapisinin-daraltilmasi.md) | Narrowing the opening gate | Trademark, domain names, patents, the three-home trial and the signed first release move to after the opening. | Approved, 25 Oct 2026 |
| [0036](../rfc/RFC-0036-katilimda-uygulama-ve-aile-adi.md) | App and family name at joining | The joining device learns the family's name during the ceremony, and each app records itself with a `hf.uygulama` record. | Approved, 25 Oct 2026 |
| [0037](../rfc/RFC-0037-sos-kisi-basina-teslim.md) | Per-person delivery of an SOS | The sender sees who received an SOS: each recipient's core writes its own signed `hf.sos.alindi` record when it decrypts the SOS; there is no read receipt. | Approved, 25 Oct 2026 (on the project owner's authority) |
| [0038](../rfc/RFC-0038-acilis-oncesi-icerik.md) | Pre-opening content | What changes before the repository opens: §15 limited to what the core supports, patent wording as defensive publication, personal details and local paths removed, documents under CC BY 4.0, MPL Exhibit A and `NOTICE`. | Approved, 25 Oct 2026 |
