# Competitor Feature Matrix

**Status:** Draft v0.1 · **Research date:** 2026-10-24
Cells: `Y` = publicly evidenced, `N` = publicly contradicted/absent, `?` = **not verified (do not assume)**,
`—` = not applicable to that model.

> This matrix is deliberately sparse. A blank confidence would be worse than a `?`.

| Capability | Parcel Yatra (proposed) | Porter | Kootr | Bus parcel counter | National courier |
|---|---|---|---|---|---|
| Peer traveller carries parcel | **Y (design)** | N (professional drivers) | Y (air travellers) | N | N |
| Inter-city | **Y** | N (on-demand intra-city per public positioning) | Y (claimed) | Y | Y |
| Intra-city on-demand | N | Y | N | N | N |
| Car mode | **Y (pilot)** | N | N | — | — |
| Bike mode | Flagged off | Y (2W ≤ 20 kg) | N | — | — |
| Air mode | N (excluded) | N | Y | — | Y (cargo) |
| Bus / train mode | N (excluded) | N | N | Y (bus) | N |
| Sender app | Y (planned) | Y | Y | N | Y |
| Traveller app | Y (planned) | Y (driver app) | Y | — | — |
| Web booking | Y | Y (estimate) | Y (marketing site) | N | Y |
| Phone OTP auth | Y | ? | ? | — | Y (inferred) |
| Google sign-in | Y (planned) | ? | ? | — | ? |
| Traveller KYC before first job | **Y (mandatory)** | ? | ? ("verified" claimed) | — | — |
| Public ID-verification detail | Y (in our docs) | ? | ? | — | — |
| Route/date-based matching | **Y** | N (on-demand) | ? | — | N |
| Flexible delivery window | **Y** | N | ? | N | Y (day-level) |
| Price shown before booking | Y | Y | ? | Y (in person) | Y |
| Transparent price breakdown | **Y (design)** | ? | ? | N | ? |
| Published prohibited-goods list | Y | **Y** (E-04) | ? | N | Y |
| OTP handover (pickup) | **Y** | ? | ? | N | N |
| OTP delivery confirmation | **Y** | ? | Y ("PIN-verified", 4-digit) | N | Y (signature) |
| Photo proof of parcel | **Y** | ? | ? | N | N |
| Live tracking | **N (by design)** | ? | ? | N | Y |
| Status events | Y | ? | ? | N | Y |
| In-app chat | Y (text only) | ? | ? | N | ? |
| Call masking | ? (P1) | ? | ? | N | ? |
| Cash on delivery | **N** | ? | ? | Y | Y |
| Digital payment | Y (sandbox at pilot) | Y | ? | N | Y |
| Delayed payout to carrier | **Y (design, gated)** | ? | ? | — | — |
| Dispute workflow | **Y (design)** | ? | ? | N (verbal) | Y |
| Insurance/claims promised | **N (until confirmed)** | ? | ? | N | Y (limited) |
| Ratings | Y (post-pilot detail) | ? | ? | N | ? |
| Business/bulk API | N (post-pilot) | **Y** | ? | N | Y |
| Enterprise offering | N | **Y** (Porter Enterprise) | N | N | Y |
| Multi-language UI | Hindi + English (planned) | ? | ? | Hindi (in person) | Y |
| Accessibility commitment | Y (WCAG 2.2 AA target) | ? | ? | N | ? |
| Published privacy policy | Draft in pack | Y | Y (link exists) | N | Y |
| Public scale figures | None yet | **Y (self-claimed, E-08)** | None | — | Public reports (not verified) |

## Reading the matrix

1. **Parcel Yatra's differentiators are Y where competitors are `?` or N**: inter-city peer matching
   with flexible windows, transparent pricing, document workflows, OTP+photo proof, dispute handling.
2. **Porter is not a feature competitor** — it is a price and convenience benchmark.
3. **Kootr overlaps conceptually** but on air; several `?` cells are exactly the questions we would want
   answered before claiming superiority. We do not claim it.
4. **Bus counters beat everyone on price.** Any claim that we are "cheaper" is unsupported.

## Verification backlog

| Unknown | How to resolve | Cost |
|---|---|---|
| Kootr pricing + prohibited list + liability terms | Read their FAQ/terms in a normal browser (client-rendered) | Low |
| Porter actual Bareilly/Delhi pricing | Use their public estimate with a location | Low |
| Borzo model + pricing | Visit site | Low |
| National courier inter-city SLAs/prices | Public rate cards | Low |
| Bus parcel price Bareilly→Delhi | In-person survey | 1 day |

These are tracked in `research/SOURCE_REGISTER.md` §7, which lists what was not opened and why.
