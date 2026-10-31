# Governance

Havenfold is young. Today it is led by one company; this document says how decisions are made now and how
that is meant to change.

## Roles

- **Project lead:** Kerem Eser, founder of Eser Teknoloji. Accepts or rejects RFCs, approves changes to the
  founding document, the protocol and the core, and appoints maintainers. Where the founding document and the RFCs
  say "Kerem", they mean the project lead.
- **Maintainers:** review and merge pull requests in the areas they are responsible for. They are
  listed in a `MAINTAINERS.md` file once there are maintainers outside Eser Teknoloji.
- **Contributors:** anyone who sends an issue, a review or a pull request under the
  [Developer Certificate of Origin](CONTRIBUTING.md#developer-certificate-of-origin).

Eser Teknoloji is the company behind the Mekan products (mekanapp.com). Project mail goes to
info@havenfolddev.com.

## How decisions are made

- **The founding document is the top-level rule.** Architecture, principles, names and number allocations in
  [`KURUCU-BELGE.md`](KURUCU-BELGE.md) apply to all work. It changes only through an accepted RFC; every change
  raises its version and is recorded in its §22.
- **Protocol and core changes go through an RFC** in [`docs/rfc/`](docs/rfc/). An RFC is discussed in its pull
  request. The project lead accepts or rejects it and writes the reason in the RFC.
- **Everything else** (bug fixes, tests, documentation, tooling) is decided by review: one maintainer approval
  and a green `npm test`.
- Disagreements are discussed in the open, in the issue or pull request. The project lead decides when
  discussion does not converge, and writes down why.

## Commitments that governance cannot change

- Published code will not be relicensed under a more restrictive license.
- A free feature will not be moved to a paid tier.
- If the project is sold, the trademark and the repository will be transferred to a foundation.
- Contributions are accepted under the DCO; no CLA will be introduced that would allow relicensing.

## Towards a foundation

No earlier than two years after the repository becomes public, the project lead will evaluate moving the
trademarks and the repository to an independent foundation or association, with a technical steering
committee elected by maintainers.
