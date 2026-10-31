# Havenfold overview

A two-page English summary of the founding document. The authoritative text is
[`KURUCU-BELGE.md`](../../KURUCU-BELGE.md) (Turkish); a full English translation is
[`FOUNDING-DOCUMENT.md`](FOUNDING-DOCUMENT.md). Section numbers below (§) refer to the founding document.
Status of the code: see the [README](../../README.md#status).

## What

Havenfold is an open-source core that turns the devices in a home or a small workplace into one secure local
cloud. Phones, old laptops, old Android phones, cameras and dedicated boxes speak one protocol, join one community
and appear as one whole. Eser Teknoloji's home products (Yuva) and workplace products (Mekan) are built on it; they
are separate, closed products. Havenfold itself is the protocol, the core packages, the node software, the
installer and the SDK (§1, §2).

## Why

Homes and workplaces have devices that still work but sit unused. Wiped and made secure, they can become the
family's or the business's own cloud. When cloud companies shut down, data is lost; in Havenfold, data stays
with its owner (§1).

## Principles

The ten shared principles (§3), in short: no accounts, identity lives on the device; joining happens in person,
remote joining is an exception with extra locks; one vote per person, devices never vote; nobody else can read the
content, services carry only sealed envelopes; data stays in place, the cloud is an optional accelerator; data
leaves the community only through approved, scoped routes; monitoring is always visible, an adult is never
monitored in secret; guidance, not diagnosis; no lock-in, data exports in an open format; honest language ("even we
cannot see your content, and we do not know who you are", never "there is no server").

Havenfold adds seven of its own:

- **H1 Centreless cluster.** No permanent manager node; the device that wants a job distributes it.
- **H2 One protocol, one core.** Phones, boxes, workers and hardware run the same core; no second implementation.
- **H3 Devices do not vote.** A stolen device cannot take over the community.
- **H4 Separate the role, separate the knowledge.** The box sees traffic metadata, the worker sees the content of
  the jobs it runs; they are separate identities with separate keys, even on the same hardware.
- **H5 Honest "one machine".** Devices are shown as one machine, but memory and processors are not merged; the
  largest single job is always shown.
- **H6 Safe retirement.** Every device that leaves is securely erased, with a report.
- **H7 No custom cryptography.** Only listed algorithms and audited libraries.

## Architecture

| Part | What it does | Where it runs |
|------|--------------|---------------|
| Core (`core/core`) | Identity, ledger, quorum, pair secrets, envelopes, the single entry point for incoming data | Phones (Bare worklet), boxes and workers |
| Record layer (`core/records`) | Collections and records: encrypted, signed operations, field-level merging, epoch keys, cutoffs, files | Inside the core |
| Task layer (`core/tasks`) | Capability declarations, task envelopes, placement, worker checks, continuous tasks | Inside the core; jobs run on workers |
| Events (`core/events`) | Event records, routines, rules, cases, notification ladder | Phones and workers |
| Vault (`core/vault`) | Shamir shares of recovery keys, thresholds, recovery, rotation | Inside the core |
| Transport (`core/transport`) | Rendezvous, sessions and the ceremony over HyperDHT and Noise | Phones and nodes |
| Node software (`node`) | Supervisor, box and worker cores, health, signed updates, privilege helper, systemd units | Linux first; Windows and macOS later |
| Installer USB (`installer`) | Installation with disk encryption and TPM binding, erase mode | Linux |
| SDK (`sdk`) | The interface products use | Product apps |

Data moves over, in order of preference: a direct HyperDHT and Noise connection; the community's box, which
relays and holds encrypted envelopes; a blind Mailbox for envelopes and wake-ups (not yet in this repository);
optional extra routes for remote access; and, in a disaster, local networks and Bluetooth (§11). No VPN or
central control plane is used for connections inside a community.

**What each device can be (§5.2):** an iPhone or Android phone is a member device (holds a share, approves,
shows the panel), never a worker; an old Android phone can be a box or an edge device (camera, screen), never
both; an old laptop converted to Linux is the main worker and can be a box; a Raspberry Pi and Eser's own boxes
come later. Minimum for a worker: x86-64 or ARM64, 4 GB RAM, 64 GB disk.

## Roles

A **community** is the security boundary, with its own ledger and keys; it is a family (`aile`) or a team
(`ekip`).

- **Persons** vote according to their role. Family roles: parent, adult, child (a child signs but does not count
  toward a quorum). Team roles: owner, manager, employee, temporary. Each person has one primary identity that
  votes and up to four secondary identities for other apps or devices, which do not vote.
- **The box** is a member role that carries traffic: relay, hold, backup store. It never votes and never sees
  content.
- **Linked devices** are not members: workers run jobs, edge devices sense or display, accessories show
  notifications and approvals.
- **Guests** (a caregiver, a subcontractor) get time-limited, narrow access through the same ceremony.

Joining is an in-person **ceremony**: a QR code that refreshes every 60 seconds, the same 5 pictures on both
screens, and a parent's signature. Data leaves the community by exactly four routes: a bond, a personal bridge,
service sharing and export.

## Security model, in brief

The full model is §13 and the audit package in [`docs/audit/`](../audit/). Some of the expected behaviours:

- **A box is stolen:** its disk holds encrypted envelopes, an encrypted backup and vault shares, which open
  nothing on their own. A parent removes it with one signature and the vault secret is rotated.
- **A worker is stolen or has malware:** it sees only the jobs given to it, runs them in a container without
  network access, and never receives a person's data without that person's first-use approval.
- **A removed member keeps writing:** authority checks against the ledger, signed cutoffs and a new epoch key
  exclude the writes.
- **Eser's services are compromised:** the Mailbox sees only encrypted bytes; the family list, content and
  collections are not with Eser.
- **A malicious update:** phones update only from app stores; a node installs only packages in a manifest signed
  with the offline root key, and downgrades need a parent's approval.
- **A fake device is added:** the ceremony is in person and needs matching pictures and a parent's biometric
  signature.

**Algorithms (§13.2):** Noise IK, X25519, Ed25519, XChaCha20-Poly1305, BLAKE2b with labelled derivation, Double
Ratchet (for messages; not in this repository), HMAC-SHA256, Shamir over GF(256), Argon2id and libsodium's
`secretstream`. The libraries are `sodium-native` (libsodium) and, for Shamir, `shamir-secret-sharing`. Adding an
algorithm needs an RFC and independent review.

**Audit:** every change to cryptographic code gets a second review. No independent security audit has been done
yet; the vault is not released before one (§13.3).
