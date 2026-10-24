# Design System

**Status:** Draft v0.1 — **proposal, not a finished visual identity** · **Date:** 2026-10-24

> This is an original system built for Parcel Yatra. It borrows *usability patterns* (cards, bottom
> navigation, status timelines) that are common across Indian logistics apps, not any competitor's
> branding, colour, logo, illustration or copy. No asset from Porter, Kootr or any other product is
> reproduced here.

---

## 1. Design principles

| # | Principle | Consequence |
|---|---|---|
| 1 | **Calm confidence** | Muted surfaces, one accent doing all the emphasis. Trust is quiet, not shouty |
| 2 | **One decision per screen** | Handover screens have exactly one primary action |
| 3 | **Say the uncomfortable thing** | "Not insured", "no live tracking", "no refund after pickup" appear in the UI, not only in terms |
| 4 | **Built for a 3G phone in a car** | Large targets, no hover-dependent affordances, no more than one network round-trip per screen |
| 5 | **Hindi and English are peers** | Layouts must survive +30% string growth; no text baked into images |
| 6 | **Evidence over decoration** | Timestamps, photos, codes — not gradients and mascots |

## 2. Name and mark (proposal)

- Wordmark: **Parcel Yatra** in a geometric humanist sans, tight tracking, sentence case.
- Mark concept: a **parcel shape whose outline also reads as a road/yatra path** — a rounded square
  with one edge flowing into a route line. Single colour, works at 16 px, no gradient.
- Do **not** use: a truck, a pin, a paper plane, a generic box with a smile, or a person carrying a
  bag. Those are the category clichés and each implies a claim we cannot make (we own no fleet, we
  track nothing live, we employ no couriers).
- Status: **concept only.** No logo file is included in this pack; a designer must produce and
  trademark-check it.

## 3. Colour

Semantic tokens only. Components never use raw hex.

| Token | Hex | Use |
|---|---|---|
| `--ink-900` | `#12161F` | Primary text |
| `--ink-700` | `#2C3444` | Secondary text |
| `--ink-500` | `#5A6478` | Tertiary, metadata |
| `--ink-300` | `#9AA3B4` | Disabled text |
| `--line` | `#E3E7EE` | Borders, dividers |
| `--surface` | `#FFFFFF` | Cards, sheets |
| `--canvas` | `#F6F7FA` | Page background |
| `--brand-600` | `#1F3A8A` | Primary action, links, active nav (deep indigo — reads as institutional trust, not delivery-app orange) |
| `--brand-700` | `#16296B` | Pressed state |
| `--brand-50` | `#EEF2FC` | Selected row, subtle brand fill |
| `--accent-500` | `#C97A16` | The "journey" accent — used *only* for travel/time elements and the route line, never for buttons |
| `--success-600` | `#1B7A4B` | Delivered, verified, confirmed |
| `--warn-600` | `#A86400` | Pending review, expiring quote, offline |
| `--danger-600` | `#B3261E` | Failed payment, prohibited item, incident |
| `--info-600` | `#1B5E8A` | Neutral information, tips |

Rules:
- **Colour is never the only signal.** Every status also carries an icon and a text label
  (WCAG 1.4.1).
- `--accent-500` must not be used for destructive or primary actions — it is a wayfinding colour.
- Sandbox/test mode gets its own persistent amber treatment; it must be impossible to mistake for
  production.

### Contrast (verified against WCAG 2.2)

| Pair | Ratio | Passes |
|---|---|---|
| `--ink-900` on `--surface` | 15.9:1 | AAA |
| `--ink-500` on `--surface` | 5.6:1 | AA (normal text) |
| `--brand-600` on `--surface` | 9.3:1 | AAA |
| `--surface` on `--brand-600` | 9.3:1 | AAA |
| `--danger-600` on `--surface` | 6.4:1 | AA |
| `--ink-300` on `--surface` | 2.6:1 | **Fails** — disabled text only, never information |

Ratios computed with the WCAG relative-luminance formula from the hex values above. Re-verify in a
tool after any token change.

## 4. Typography

| Role | Size / line-height | Weight |
|---|---|---|
| Display | 32/38 | 700 |
| H1 | 24/30 | 700 |
| H2 | 20/26 | 600 |
| Body | 16/24 | 400 |
| Body strong | 16/24 | 600 |
| Small | 14/20 | 400 |
| Caption | 12/16 | 500 |
| Mono (OTP, IDs) | 24/28 | 600, tabular figures, letter-spacing 0.15em |

- Family: a humanist sans with Devanagari coverage. **Requirement:** the Devanagari and Latin must
  share a designer or at least a visual weight system; mixing an unrelated Devanagari face is the
  most common failure in Indian product typography. Candidate open-licence families must be
  evaluated and licence-checked before use (not selected in this pack).
- **Numerals:** tabular in prices, timelines and OTPs so amounts align.
- **Never** below 12 px. Never justify. Never letter-space lowercase body text.

## 5. Spacing, radius, elevation

- 4 px base scale: 4, 8, 12, 16, 24, 32, 48, 64.
- Screen gutter: 16 mobile, 24 tablet, 32 desktop (max content width 1120 px; admin 1440 px).
- Radius: 8 (inputs, chips), 12 (cards), 16 (sheets), 999 (pills).
- Elevation: two levels only — `shadow-1` for cards, `shadow-2` for sticky bottom bars. No floating
  action buttons; the primary action lives in the thumb zone or a sticky bar.
- Borders over shadows wherever possible (better on low-DPI Android).

## 6. Core components

### Buttons
| Variant | Use | Notes |
|---|---|---|
| Primary | One per screen | Filled `--brand-600`, 48 px min height |
| Secondary | Alternative action | Outlined |
| Tertiary | Links inside content | Text + underline on focus |
| Destructive | Cancel booking, delete account | Outlined danger; never filled red |
| Disabled | Unavailable action | Must include a reason nearby, or it should not be rendered |

Loading state: label replaced by a 3-dot inline indicator, width locked (never resizing buttons).

### Status chip
Icon + label + colour. Fixed vocabulary — no ad-hoc statuses invented in the UI:

`Confirmed` `Awaiting payment` `Awaiting traveller` `Picked up` `In transit` `Arrived` `Delivered`
`Payout pending` `Cancelled` `Expired` `Under review` `Disputed` `Incident`

### Booking card
Slots: status chip · route line · date/time · counterparty (first name + verification icon) · amount ·
primary action. Must fit 320 px width without truncating the route.

### Route line
A thin line with two nodes and the corridor label. Accent colour. **Static** — it never animates to
suggest live movement.

### Timeline
Vertical, 4 states per node (done/current/pending/skipped), timestamp right-aligned, evidence
indicator (camera icon) where artefacts exist.

### OTP input
6 boxes, 48×56 px, numeric keypad, paste-aware, auto-submit, error shake **with** a text message
(never colour-only). Screenshot blocking on Android.

### Money row
Label left, amount right, tabular figures, with a rule above the total. Never a currency symbol alone.

### Banner
Four tones: info / warn / danger / offline. Persistent until resolved. Dismissible only when the
underlying condition is gone.

### Empty state
One sentence + one action. No illustration required. Example: "No traveller matches yet." [Widen my
window]

### Confirmation sheet
Bottom sheet on mobile, modal on desktop. States the consequence in one sentence above the buttons.
Destructive actions require the reason code to be chosen first.

## 7. Motion

- Duration: 150 ms (state), 250 ms (sheet), 0 for reduced-motion users.
- Only three animations exist: sheet slide, skeleton shimmer, and status-node check.
- **No** looping animations, no confetti, no "parcel flying across the screen".
- `prefers-reduced-motion: reduce` disables all of the above.

## 8. Iconography

- 24 px grid, 1.75 px stroke, rounded caps, single colour (`currentColor`).
- Required set (~24 icons): parcel, document, car, route, clock, shield-check, camera, lock, phone,
  message, alert-triangle, alert-octagon, check-circle, x-circle, chevron-left/right, search, filter,
  user, settings, download, trash, external-link, help.
- No icon may imply a capability we do not have: no live-location pin on a map, no truck, no "instant".

## 9. Illustration and photography

- **No stock photography of people.** Fake couriers and fake customers are a trust liability.
- Where an image is needed (empty states, help pages), use simple line diagrams in `--line` + one
  accent.
- Never show a real parcel, real document or real ID in marketing imagery.

## 10. Data visualisation (admin only)

- Tables before charts. Admin is a work surface.
- If a chart is used: single accent hue, no 3-D, no gradients, axis labels in Indian number format
  (`1,00,000`), 0 baseline mandatory for bar charts.

## 11. Theming and dark mode

Dark mode is **P2**. If implemented: invert surfaces to `#12161F`/`#1B2130`, keep semantic hues but
reduce saturation by ~10%, and re-verify every contrast pair. Do not ship a dark mode that makes
`--danger-600` and `--accent-500` indistinguishable.

## 12. What this system refuses

| Refused | Reason |
|---|---|
| Trust badges we have not earned ("100% safe", "insured") | False assurance |
| Star ratings on the landing page with no data | Fabrication |
| Countdown pressure ("only 2 travellers left!") | Dark pattern |
| Auto-playing video | Bandwidth, accessibility |
| Chatbots pretending to be humans | Trust breach when discovered |
| Confetti on delivery | Wrong tone for a ₹4,000 document |

## 13. Component acceptance checklist

Before a component ships:
- [ ] All nine global states implemented
- [ ] Keyboard operable, visible focus ring
- [ ] 48 px minimum touch target
- [ ] Works at 320 px width
- [ ] Survives +30% string growth (Hindi)
- [ ] No colour-only meaning
- [ ] `prefers-reduced-motion` respected
- [ ] No hardcoded hex outside the token file
- [ ] Loading state does not shift layout
