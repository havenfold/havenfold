# Security policy

Havenfold is pre-alpha and has not had an independent security audit. Please do not use it for real data yet.
We still want to hear about every vulnerability.

## Reporting a vulnerability

- Use GitHub's **private vulnerability reporting** on this repository ("Security" tab → "Report a
  vulnerability"). If that is not possible, email **info@havenfolddev.com** with "Havenfold security" in the
  subject (a dedicated `security@havenfold.io` address will replace it).
- Do not open a public issue, pull request or discussion for a security problem.
- Include what you found, how to reproduce it, the affected commit or version, and the impact you expect.
  A failing test is the most useful form of a report.

## What happens next

- We acknowledge your report within **3 working days**.
- We confirm or reject the issue and share our assessment within **14 days**.
- We follow **90-day coordinated disclosure**: we aim to release a fix within 90 days of your report, and we
  agree the publication date with you. If a fix needs more time, we tell you why and propose a new date.
  If the issue is being exploited in the wild, we may publish sooner.
- We credit reporters in the advisory unless you ask us not to.

## Scope

In scope: everything in this repository: the protocol, the core packages, the phone worklet, the node
software, the installer and erase mode, task images, the SDK and `export-open`.

Especially interesting: ways to join a community without the ceremony, ways for a device to vote or to read
content its role does not allow, ways to read sealed envelopes on a relay, vault share leakage, erase mode that
leaves recoverable data, and update or supply-chain attacks on the node software.

Out of scope: products built on Havenfold (Yuva, Mekan) and their app stores; report those to the product's own
contact. Known limits listed in [`docs/audit/sinirlar-ve-kapsam-disi.md`](docs/audit/sinirlar-ve-kapsam-disi.md)
are known, but a practical attack that uses one is still welcome.

## Safe harbour

We will not take legal action against research done in good faith that respects this policy, avoids harm to
other people's data and devices, and gives us reasonable time to fix the problem before disclosure.
