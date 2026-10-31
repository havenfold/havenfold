# Contributing to Havenfold

Thank you for your interest. Havenfold is pre-alpha; the protocol still changes daily. Small, focused
contributions with tests are the easiest to review.

## Before you start

- Read the founding document ([Turkish](KURUCU-BELGE.md), [English](docs/en/FOUNDING-DOCUMENT.md)), at least
  §3 (principles), §13 (security model) and the section of the layer you want to change.
- **Changes to the protocol or the core need an RFC.** Open an issue first, then a pull request that adds
  `docs/rfc/RFC-NNNN-short-name.md`. Code follows once the RFC is accepted. Bug fixes that make the code match
  an accepted RFC do not need a new RFC.
- Security problems are not reported in issues. See [SECURITY.md](SECURITY.md).

## Developer Certificate of Origin

Contributions are accepted under the [Developer Certificate of Origin 1.1](https://developercertificate.org/).
There is no CLA. Every commit must carry a sign-off line with your real name and an email you control:

```
Signed-off-by: Your Name <you@example.com>
```

`git commit -s` adds it for you. By signing off you certify that you wrote the change, or otherwise have the
right to submit it under the license of the files you touch.

## Development setup

Requirements: Node.js 22 (CI tests only 22; Node.js 24 is not supported yet), npm, git. macOS or Linux. The repository has an `.nvmrc`, so `nvm use` picks
the right Node.js version.

```bash
npm ci
(cd worklet && npm ci)
npm run demo     # two phones form a family and sync a record, on a local testnet
npm test
```

While you work on one package, run only its tests:

```bash
cd core/records && npx brittle-node test/*.js
```

`npm test` (`scripts/check.sh`) must pass before a pull request is reviewed. It runs every package's tests on
Node.js, the core packages and the SDK again on the Bare runtime, and the vector, license, SPDX and coverage checks;
CI runs the same script.

## Rules for code

- **No custom cryptography.** Use only the algorithms in founding document §13.2, through libsodium or the
  existing core primitives. A new construction is protocol design and goes through an RFC and review.
- **Test vectors are append-only.** Never change an existing file in `protocol/vectors/`. A new wire format
  or derivation gets a new, versioned vector file.
- **Numbers are allocated, not invented.** Envelope types, event types, command numbers and derivation labels
  are allocated in `protocol/` and in an RFC. Do not pick a free number in code.
- **Dependencies:** code that ships in the core, the node software or the phone may only depend on MIT, BSD,
  ISC, Apache-2.0 or MPL-2.0 packages, pinned to an exact version. No GPL, AGPL or LGPL. `npm test` checks this.
- **License headers:** every source file (`.js`, `.sh`, `.yml`, …) starts with an SPDX line in the license of
  its directory (see README, "Licensing"), for example `// SPDX-License-Identifier: MPL-2.0`. MPL-2.0 files also
  carry the MPL notice on the next line: `This Source Code Form is subject to the terms of the Mozilla Public
  License, v. 2.0. If a copy of the MPL was not distributed with this file, You can obtain one at
  https://mozilla.org/MPL/2.0/.` Markdown, JSON and license texts carry no header: documentation is CC BY 4.0
  and other files follow the directory's license (README, "Licensing"). `node scripts/spdx.js` checks this.
- **Style:** follow the surrounding code: CommonJS, no semicolons, `brittle` tests. Names other code or users see
  (packages, files, classes, methods, events, errors, commands) are English; comments and many internal names are
  still Turkish, and protocol labels keep their Turkish spelling (README, "Language"). Write a failing test first for
  every bug fix.

## Internal notation

The history of the code and the documents carries some internal shorthand from the time the project was private.
It is a historical trace; do not use it in new contributions, and ask in the pull request if one gets in your way.

- `D76`, `A3`, `LA29` and similar: internal work item numbers.
- "İstek N": an internal request, and "inceleme N": an internal review round.
- `kollar/…`: task files in the private working archive, which is not published.
- `mac`, `dell`, `air`, `lenovo`: names of the development lanes (machines) that wrote a change.

## Language

Issues and pull requests are welcome in English or Turkish. Names other code or users see are English (see
"Style"); code comments, many internal names and the RFCs are in Turkish, and maintainers can help translate.
Where a translated document and the Turkish original differ, the Turkish original prevails.

## Pull requests

- One topic per pull request. Describe what changes and why, and link the RFC or issue.
- Keep unrelated formatting changes out.
- A maintainer reviews and merges. Changes to the core or the protocol also need the project lead's approval
  (see [GOVERNANCE.md](GOVERNANCE.md)).
