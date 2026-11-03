# Responsive Behaviour

**Status:** Draft v0.1 · **Date:** 2026-10-24

---

## 1. Breakpoints

| Token | Range | Primary target |
|---|---|---|
| `xs` | 320–479 px | Low-end Android, small phones, 200% zoom on a 360 px device |
| `sm` | 480–767 px | Large phones, small tablets in portrait |
| `md` | 768–1023 px | Tablets, small laptops |
| `lg` | 1024–1439 px | Desktop |
| `xl` | ≥ 1440 px | Large desktop, admin |

Content max width: 1120 px (public/sender/traveller), 1440 px (admin). Gutters 16 / 24 / 32.

## 2. Device reality check

The pilot's likely devices, and what that implies:

| Reality | Design consequence |
|---|---|
| 360×640 px is the median Android screen | Design at 360, not at 390 |
| 2–4 GB RAM, mid-tier SoC | Bundle budget, no heavy shadows/blur |
| 2G/3G in transit | Text-first states, no image-dependent information |
| Mixed English/Hindi keyboards | Never rely on a symbol key being reachable |
| Phone held one-handed while travelling | Primary actions in the bottom 40% of the screen |
| Screen brightness outdoors | Contrast above the minimum, not at it |

## 3. Layout patterns per breakpoint

### 3.1 Navigation

| Breakpoint | Pattern |
|---|---|
| `xs`–`sm` | Bottom tab bar (5 items), sticky, respecting safe-area insets |
| `md` | Bottom bar persists; content centres at 720 px |
| `lg`–`xl` | Top horizontal nav; bottom bar removed; content max 1120 px |

No hamburger drawer at any breakpoint for primary navigation.

### 3.2 Landing page
- `xs`: single column; hero → price strip → 3-step how-it-works (vertical) → trust → limits → footer.
- `md`: 2-column for steps, hero text at 40% width.
- `lg`: hero split 55/45 with the price card on the right; steps become 3 columns.

### 3.3 Send wizard
- `xs`–`sm`: one step per screen, sticky bottom CTA, progress dots at top (not a percentage — steps are
  not equal effort).
- `md`+: steps become a 3-column layout — left step rail, centre form, right live price summary. The
  summary is the same component used on the price screen.
- Never show the price summary before it is valid (it would be a fabricated number).

### 3.4 Match results
- `xs`: stacked cards, one per row, 100% width, primary action full-width inside the card.
- `sm`: same, with the price right-aligned.
- `md`: 2-column grid.
- `lg`: list + sticky detail pane (master/detail). Selecting a card updates the pane; keyboard
  navigable with arrow keys.
- `xl`: same, wider detail pane with the map-less route diagram larger.

### 3.5 Booking detail
- `xs`: single column; status timeline collapsed to "current + next" with "show all".
- `lg`: two columns — timeline left (60%), actions/support right (40%), sticky.
- The status chip is always visible without scrolling (sticky sub-header).

### 3.6 Handover screens
- `xs`–`sm`: full-bleed, one action, OTP boxes sized to fill the width (min 44 px each).
- `md`+: centred card, max 480 px wide — deliberately narrow because the task is narrow.
- **No** responsive enrichment here. A wider screen must not add information; it adds distraction at
  the worst moment.

### 3.7 Tables (admin)
- `< lg`: not supported. Admin shows an explicit "This console needs a larger screen" message rather
  than a broken table. Staff use desktop.
- `lg`+: full table with sticky header, column pinning for booking ID, and horizontal scroll inside the
  table container only.

## 4. Component adaptation rules

| Component | `xs` | `md` | `lg` |
|---|---|---|---|
| Button group | Stacked, full width | Inline, auto width | Inline |
| Form | Single column | Single column | Two columns for related pairs (city/area) |
| Card | Full-bleed, 16 px gutter | Fixed 12 px radius card, 24 px gutter | Grid cell |
| Modal | Bottom sheet, drag-to-dismiss | Centred dialog | Centred dialog |
| Tabs | Scrollable segmented control | Segmented control | Side tabs |
| Timeline | Compact | Full | Full + evidence thumbnails |
| Sticky bar | Bottom, above safe area | Bottom | Not used; actions inline |

## 5. Images and media

- No hero images at `xs` — text and one illustration at most.
- Any image uses `srcset` with width descriptors; maximum 1200 px source.
- Aspect ratio reserved via `aspect-ratio` to prevent layout shift (CLS target < 0.1).
- No video at pilot.

## 6. Typographic scaling

- Base 16 px; `rem`-based throughout.
- Scale down display sizes at `xs` (32 → 28) but **never** below 16 px for body.
- Respect the OS font-scale setting up to 200%; layout must reflow rather than clip.
- Fluid type via `clamp()` only between the two defined bounds — no unbounded scaling.

## 7. Touch and pointer

| Breakpoint | Interaction assumption |
|---|---|
| `xs`–`sm` | Touch only. 48 px targets. No hover-dependent reveals |
| `md` | Touch + keyboard (tablets with cases) |
| `lg`+ | Pointer + keyboard. Hover states are additive, never required |

Every hover-revealed action must also be reachable via focus or always visible on touch.

## 8. Orientation

- Portrait is primary. Landscape is supported for match results and admin.
- OTP screens work in landscape without the keyboard covering the input (use `scroll-padding` and a
  visible focused field).
- No orientation lock. Locking orientation is hostile to accessibility mounts.

## 9. Safe areas and system UI

- Respect `env(safe-area-inset-*)` on iOS and Android cutouts.
- Sticky bottom bars sit above the keyboard when an input is focused (`visualViewport` handling).
- Status bar colour follows the surface (`--canvas`), not a brand colour.

## 10. Performance budgets (per route)

| Metric | Budget (p75, 3G) |
|---|---|
| First contentful paint | < 1.8 s |
| Largest contentful paint | < 2.5 s |
| Interaction to next paint | < 200 ms |
| Cumulative layout shift | < 0.1 |
| JS transferred (initial route) | < 180 KB gzip |
| Total image weight (first view) | < 150 KB |

Violating a budget blocks release (`release/GO_NO_GO_CRITERIA.md`).

## 11. Offline and flaky-network behaviour

| Screen | Offline behaviour |
|---|---|
| Landing / help | Served from cache with a stale-date note |
| Send wizard | Draft persisted locally; submission queued |
| Matches | Last results shown with an explicit "as of 09:41" stamp |
| Booking detail | Last known state + "may be out of date" |
| Handover | **Queued submission**; never a fake success |
| Payment | Blocked with a clear message; never retried blindly |
| Admin | Blocked; staff must not act on stale money data |

Service-worker caching must never cache API responses containing personal data across users.

## 12. Print

Only the booking receipt and the prohibited-items page need print styles. Both are single-column,
black on white, with the URL and timestamp in the footer. Admin printing is out of scope.

## 13. Responsive acceptance checklist

- [ ] No horizontal scroll at 320 px on any screen
- [ ] Every primary action reachable with one thumb at 360×640
- [ ] Sticky bars do not cover focused inputs or focused buttons
- [ ] Layout survives 200% text zoom
- [ ] Hindi strings do not truncate at `xs`
- [ ] Tables are replaced (not squashed) below `lg`
- [ ] No information appears only on large screens (nothing is desktop-exclusive except admin)
- [ ] Performance budgets met on a throttled 3G profile
