# Accessibility

**Status:** Draft v0.1 · **Date:** 2026-10-24
**Target:** WCAG 2.2 Level AA for sender, traveller and receiver surfaces. Admin console targets AA
for keyboard and screen-reader access; some data grids may be exempt-by-scope.

> Accessibility matters more here than in most products: our users include people who have never used
> an app to send anything, people on cheap Android devices, and people reading Devanagari on low-DPI
> screens. "Accessible" and "usable in Bareilly" are largely the same requirement.

---

## 1. Conformance statement (intended, not yet achieved)

> Parcel Yatra aims to conform to WCAG 2.2 Level AA. This has **not** been independently audited.
> No conformance claim may be published until an audit is complete.

## 2. Perceivable

| Requirement | Implementation |
|---|---|
| 1.1.1 Non-text content | Every icon has an `aria-label` or adjacent text. Decorative images `alt=""`. Photos uploaded by users have no alt text requirement but their container labels do ("Sealed parcel photo, 24 Oct, 9:41 am") |
| 1.3.1 Info and relationships | Semantic HTML: `<main>`, `<nav>`, `<h1>`–`<h3>`, `<table>` for tables. React Native: `accessibilityRole` on every interactive element |
| 1.3.2 Meaningful sequence | DOM order matches visual order; no CSS reordering that breaks reading order |
| 1.3.5 Identify input purpose | `autocomplete="tel"`, `"name"`, `"email"`, `"one-time-code"` on the OTP field |
| 1.4.1 Use of colour | Status = colour + icon + text label. Never colour alone |
| 1.4.3 Contrast (minimum) | 4.5:1 body, 3:1 large text. Verified token pairs in `ux/DESIGN_SYSTEM.md` §3 |
| 1.4.4 Resize text | Up to 200% without loss of content or function; layouts reflow, no horizontal scroll at 320 px |
| 1.4.10 Reflow | 320 px width, no two-dimensional scrolling except data grids |
| 1.4.11 Non-text contrast | Input borders, focus rings and status chips ≥ 3:1 |
| 1.4.12 Text spacing | Line-height 1.5, paragraph 2em, letter-spacing 0.12em, word-spacing 0.16em must not clip |
| 1.4.13 Content on hover/focus | Dismissible, hoverable, persistent (tooltips only) |

### Devanagari specifics
- Line-height ≥ 1.6 for Hindi body text (matras need vertical room and get clipped at 1.4).
- Never truncate with `text-overflow: ellipsis` on a single line in Hindi — the meaning often lives at
  the end.
- Test with the longest realistic Hindi string, not a 5-word sample.

## 3. Operable

| Requirement | Implementation |
|---|---|
| 2.1.1 Keyboard | All functions keyboard-operable on web. No keyboard trap in modals — focus returns to the trigger |
| 2.2.2 Pause, stop, hide | No auto-advancing carousels. Quote countdown is a timer but never blocks an action |
| 2.3.1 Three flashes | Nothing flashes. Hard rule: zero flashing content |
| 2.4.1 Bypass blocks | "Skip to content" link on every page |
| 2.4.3 Focus order | Logical; sheets trap focus while open |
| 2.4.6 Headings and labels | One `<h1>` per page; form labels are visible, not placeholder-only |
| 2.4.7 Focus visible | 2 px `--brand-600` outline with 2 px offset, never removed |
| 2.4.11 Focus not obscured (2.2) | Sticky bottom bars must not cover the focused element; scroll padding accounts for them |
| 2.5.1 Pointer gestures | No multi-point or path gestures as the only way to do anything |
| 2.5.3 Label in name | Visible label is contained in the accessible name |
| 2.5.7 Dragging movements (2.2) | The capacity slider has +/- buttons as an alternative |
| 2.5.8 Target size (2.2) | Minimum 24×24 CSS px; **we target 48×48** for all primary actions |

### Timers — an honest exception

The quote has a 15-minute expiry and the booking request has a 30-minute window. These are
**essential** timers (WCAG 2.2.1 exception): they protect price integrity and traveller capacity.
Mitigations:
- The countdown is always visible, never a surprise.
- Expiry never destroys entered data; it changes the CTA and requires re-consent.
- The user can extend the booking window once without penalty.

## 4. Understandable

| Requirement | Implementation |
|---|---|
| 3.1.1 Language of page | `lang="en-IN"` or `lang="hi-IN"` set per user preference, and switched on language change |
| 3.1.2 Language of parts | Mixed-language strings wrapped in `lang` attributes |
| 3.2.2 On input | No automatic form submission on field change (except the 6-digit OTP, which is disclosed) |
| 3.2.3 Consistent navigation | Same nav order on every screen |
| 3.2.4 Consistent identification | "Cancel booking" always means the same thing; never reused for "cancel this dialog" |
| 3.2.6 Consistent help (2.2) | Help link is in the same relative position on every screen |
| 3.3.1 Error identification | Errors are text, next to the field, and state what to do |
| 3.3.2 Labels or instructions | Every field has a visible label and, where needed, an example |
| 3.3.3 Error suggestion | "Enter a 10-digit mobile number starting with 6–9", not "invalid input" |
| 3.3.7 Redundant entry (2.2) | Never re-ask for data already given in the same session (address, phone) |
| 3.3.8 Accessible authentication (2.2) | OTP is auto-read from SMS where the platform allows; paste is enabled; no cognitive puzzle; no blocking of password managers |

## 5. Robust

| Requirement | Implementation |
|---|---|
| 4.1.2 Name, role, value | Custom controls expose role/state (`aria-expanded`, `aria-checked`, `accessibilityState`) |
| 4.1.3 Status messages (2.2) | `aria-live="polite"` for "Booking confirmed", `role="alert"` for errors. In React Native: `AccessibilityInfo.announceForAccessibility` |

## 6. Screen-reader flows that must be scripted and tested

1. Sign up: phone → OTP → name. Focus moves to the first invalid field, not the top of the page.
2. Create parcel: every field announces label, required state and current value.
3. Price breakdown: announced as a list of label/amount pairs, then the total; not as a table soup.
4. Match card: single announcement combining band, route, time, price and verification.
5. OTP screen: "6 digit code, box 1 of 6" and each digit announced as it is typed.
6. Status timeline: "Step 3 of 5, In transit, since 9:45 am".
7. Error recovery: error announced once, not on every re-render.

## 7. Platform specifics

### Web
- Landmark regions, skip link, `aria-current="page"`.
- Never `display:none` on focusable content.
- Modals: `role="dialog"` `aria-modal="true"`, labelled by the heading, focus trapped, Escape closes.
- Toasts: `role="status"`, and also present in the DOM history so they are not lost.

### Android (React Native)
- `accessible`, `accessibilityLabel`, `accessibilityHint`, `accessibilityRole` on every interactive element.
- TalkBack tested on a low-end device (≤ 2 GB RAM is the realistic target).
- Font scale 200%: no fixed-height containers around text.
- OTP: `autocomplete="sms-otp"` / `textContentType="oneTimeCode"` where available.

### Receiver web page
- Must work at 200% zoom on a 360 px screen — this is the most constrained surface and the least
  forgiving user (first-time, possibly elderly).
- The OTP box is the only input; the rest is text.

### Admin
- Keyboard shortcuts documented in-app (`?` opens the list).
- Tables: `<th scope>`, caption, and a "skip table" landmark.
- Colour-coded rows must also carry a text flag.

## 8. Content accessibility

- Reading level: aim for Class 8 comprehension in both languages.
- No idiom that fails in translation ("ballpark", "circle back").
- Numbers spelled out where a screen reader would misread a symbol-heavy string.
- `₹` announced as "rupees" via `aria-label` or a visually-hidden prefix.

## 9. Testing plan

| Method | Frequency | Owner |
|---|---|---|
| Automated axe/Lighthouse scan | Every PR (CI) | Engineering |
| Keyboard-only pass | Every release | QA |
| TalkBack pass (Android, 2 devices) | Every release | QA |
| VoiceOver pass (iOS, when iOS ships) | Every release | QA |
| 200% text zoom pass | Every release | QA |
| Contrast check of every new token | On change | Design |
| Manual screen-reader script (§6) | Every release | QA |
| User testing with 3 assistive-tech users | Before scale-up, not pilot | Research |

Automated tools catch ~30–40% of issues. **A green axe score is not an accessibility claim.**

## 10. Known risks at pilot

| Risk | Mitigation |
|---|---|
| Devanagari clipping at large font scale | Line-height 1.6, no fixed heights, device testing |
| Low-end Android performance | No heavy animation; skeleton states; bundle size budget |
| OTP screen with TalkBack | Explicit test case; digits announced individually |
| Admin data grids | Scope-reduced with a documented exception |
| No independent audit | Stated openly; audit is a pre-scale gate, not a pilot gate |

## 11. Definition of done for a screen

- [ ] Keyboard/TalkBack operable end-to-end
- [ ] All nine global states announced correctly
- [ ] Contrast verified for every text/background pair used
- [ ] 320 px + 200% zoom tested
- [ ] Hindi string tested at maximum length
- [ ] Error messages mapped to the catalogue and announced once
- [ ] No information conveyed by colour alone
