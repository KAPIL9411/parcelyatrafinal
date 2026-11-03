# Remote homepage, festive campaigns and the staff CMS

This document covers the server-driven homepage that ships with the app: the contract the app
renders, the release model behind it, the endpoints, the campaign scheduler, the client caching
rules, and the staff console that edits it. It also records what was actually exercised, so no one
has to infer coverage from a capability appearing in a list.

The short version: the contract, migration, public and admin APIs, scheduler, client offline cache
and staff console are implemented and exercised by tests against PostgreSQL semantics (PGlite). A
campaign published through the API was observed in the running Expo app with no rebuild. **The app
was rendered through Expo Web, not on Android or iOS.** The native file cache and native AppState
events were not exercised; the web build keeps its cache in memory (see §8).

A server-driven configuration can restyle, retitle, reorder and hide **existing** screens and
sections. It cannot install native code, add a UI component the build does not contain, or change
the fixed composition (header → hero → search → live shipment → sections → account block). The
contract enforces that with allowlists, not convention.

---

## 1. The contract

`packages/domain/src/homepage.ts` is the only definition. The API validates with it before writing,
the app validates with it before rendering, and the web console validates with it before saving.
Nothing else parses homepage JSON.

`HomepageDocument` as served by `GET /v1/homepage`:

| Field | Type | Meaning |
| --- | --- | --- |
| `schema_version` | `1` | Contract version; a client refuses an unknown major |
| `version` | integer | Monotonic release version, `max(base, campaign)` |
| `published_at` | ISO 8601 | When the visible configuration was published |
| `generated_at` | ISO 8601 | Response time; excluded from the ETag |
| `expires_at` | ISO 8601 \| null | When the active campaign stops applying |
| `campaign` | object \| null | `id`, `name`, `version`, `priority`, `starts_at`, `ends_at` |
| `theme` | object | Colour tokens, gradient, decoration |
| `hero` | array | One or more hero banners, ordered |
| `sections` | array | Ordered section list |
| `refresh_after_seconds` | integer | How soon the client should ask again (≥ 30) |

A `HomepageConfig` (what an editor saves) carries the same `theme`, `hero` and `sections` without the
release metadata. The release rows add `name`, `priority`, `platforms`, `starts_at`, `ends_at`,
`note` and audit columns; those are not content.

### Theme

Every colour is optional and falls back to the shipped palette, so a campaign can change one accent
without restating the whole theme.

| Field | Notes |
| --- | --- |
| `key`, `name` | Slug and console label; `key` is what the tests and logs identify |
| `brand`, `brand_dark`, `brand_soft` | Primary action colours |
| `navy`, `accent`, `canvas`, `surface`, `partner` | Structural colours |
| `gradient` | Two or three `#rrggbb` stops for the full-bleed hero wash. Default `#0b3bff → #1230c8 → #061a7a` |
| `hero_gradient` | Legacy two-stop form, read only when `gradient` is absent. The console writes `gradient` |
| `hero_text`, `hero_muted` | Text over the hero |
| `badge_background`, `badge_text` | Trust badges |
| `decor` | `none` \| `lights` \| `confetti`: the festive overlay the hero draws over the gradient |
| `decoration` | Legacy primitive name (`none`, `route`, `sparkle`, `confetti`, `lamp`). Read when `decor` is absent; the parser normalises it to the primitive the app bundles |

Colours must be `#rrggbb`. A named CSS colour, an rgba string or a gradient in a colour field is
refused at save time.

### Hero

| Field | Notes |
| --- | --- |
| `id`, `headline` | Required |
| `eyebrow`, `subtitle` | Short overline and supporting line |
| `image_url` | Must be `…/v1/homepage/media/<uuid>` on this API |
| `gradient` | Two stops, used when there is no artwork |
| `text_color` | Hero text colour |
| `trust_badges` | Up to three short strings |
| `cta` | `{ label, action }` |
| `countdown_to` | ISO instant; the client renders a countdown chip |
| `active_from`, `active_until` | Optional per-hero window; outside it the hero is skipped |

### Sections

Eleven renderable kinds:

| `type` | What it renders |
| --- | --- |
| `campaign_hero` | A full-width promotional block (title, body, artwork, CTA) |
| `category_nav` | The horizontal shortcut strip (Send, Carry, Track, Business, Help) |
| `category_grid` | The 2-up cream card grid with badge, title and bottom-right artwork — the six send categories |
| `quick_actions` | A compact grid of icon actions |
| `popular_routes` | City-pair cards with indicative pricing |
| `promo_cards` | A row of image/label cards |
| `trust` | Trust badges and short proof points |
| `business_promo` | Business-shipping block |
| `carry_promo` | Carry-and-earn block |
| `how_it_works` | Numbered steps |
| `announcements` | Short notices, optionally dismissible by the client |

The composition is fixed, in this order: translucent overlay header → full-bleed themed hero with
decor overlay → search card overlapping the hero seam → live parcel card (when the signed-in user
has one) → the ordered `sections` → trust footer → floating pill tab bar. Only the middle moves.
The booking search bar is **not** a section, because a configuration must not be able to remove
the primary action or move it below the fold. The tab bar sits 24 dp above the safe area, 64 dp
tall, and the page scrolls beneath it.

Each section has `id`, `type`, `enabled`, `order` (ascending, ties by `id`), optional `title`,
`subtitle`, `background`, `text_color`, `accent_color`, `image_url`, `action`, `items[]`, and an
optional `starts_at` / `ends_at` window. `HomeItem` adds `title`, `body`, `icon`, `badge`,
`image_url`, `action`.

### Navigation allowlist

`HomeAction` is one of:

- `{ kind: 'route', route: <one of HOME_ROUTES> }`
- `{ kind: 'send' }`
- `{ kind: 'none' }`

`HOME_ROUTES` is 14 in-app paths (`/send`, `/bookings`, `/trips`, `/trips/new`, `/help`,
`/notifications`, `/inbox`, `/profile`, `/verification`, `/info/pricing`, `/info/prohibited`,
`/info/safety`, `/info/business`, `/info/grievance`). There is no way to express an external URL,
a `javascript:` target, or a route the router cannot resolve. The app calls `router.push` on a value
from that list, never on a server-supplied string.

`HOME_ICONS` and `HOME_DECORATIONS` work the same way: an editor picks a key, and an unknown key is
a validation error rather than a missing glyph.

### Unknown content

- **Editors (strict):** an unknown section type is refused with `VALIDATION_FAILED` and the issue
  list. A typo is caught before it can reach production.
- **Readers (permissive):** an unknown section type is dropped; the rest of the page renders. This
  is what lets an older app open a page written by a newer editor without a blank screen.
- A duplicate section `id` is refused in both modes, because two sections with one key are an
  ordering bug waiting to happen.

There is no HTML, no script and no markdown field. Every string is rendered as text.

---

## 2. Release model

Migration `apps/api/migrations/0011_homepage_cms.sql` adds two tables.

`homepage_releases` holds every release of both kinds:

| Column | Notes |
| --- | --- |
| `id` | uuid |
| `version` | `bigserial`, unique; monotonic across all releases |
| `kind` | `homepage` \| `campaign` |
| `status` | `draft` \| `published` \| `archived` |
| `name` | Console label, 1–80 chars |
| `config` | jsonb, validated before write |
| `priority` | 0–1000, campaigns only |
| `platforms` | Subset of `{android,ios,web}` |
| `starts_at`, `ends_at` | Campaign window; required when published |
| `note` | Publish note, ≤ 500 chars |
| `created_by`, `published_by`, `published_at` | Audit |
| `rolled_back_from` | The version a rollback copied, or null |

Constraints that make the rules structural rather than procedural:

- Two partial unique indexes allow **exactly one published homepage** and **exactly one homepage
  draft**. Publishing must archive the previous release in the same transaction or the insert fails.
- `homepage_campaign_window` refuses a published campaign without a window.
- `homepage_window_order` refuses `ends_at <= starts_at`.
- `platforms <@ ARRAY['android','ios','web']` refuses any other platform string.

`homepage_media` is the artwork allowlist:

| Column | Notes |
| --- | --- |
| `id` | uuid; this is the public URL |
| `object_key` | Storage key, unique |
| `content_type` | `image/jpeg` or `image/png` |
| `byte_size`, `created_by`, `created_at` | Audit |

A banner image URL must resolve to one of these rows. The media table is the allowlist, so a draft's
artwork is not discoverable by guessing an origin, and artwork from another host cannot be rendered
even if it is valid JSON.

Releases are immutable once published. An edit writes a draft; a publish archives the live
homepage and flips the draft; a rollback **inserts a new published row** copying an older version,
recording `rolled_back_from`. History is linear and nothing is rewritten in place.

---

## 3. Scheduling

`activeCampaign` is one query:

```sql
WHERE kind = 'campaign' AND status = 'published'
  AND starts_at <= $1 AND ends_at > $1 AND $2 = ANY (platforms)
ORDER BY priority DESC, published_at DESC NULLS LAST, version DESC
LIMIT 1
```

Consequences worth stating plainly:

- The window is evaluated against **server time** on every request. No job activates or expires a
  campaign; there is no scheduler to be late, and a redeploy does not re-evaluate anything.
- Overlaps resolve to exactly one campaign by a total order (priority, then publish time, then
  version), so two identical requests cannot receive two different pages.
- A campaign with an already-finished window is refused at publish time, not merely ignored later.
- Unpublishing the winner reveals the next eligible campaign on the following request.
- A campaign that names only `ios` never restyles Android or web.

`refresh_after_seconds` is 300 normally. When a live campaign ends sooner than that, it shrinks to
the remaining seconds (floored at 30), so the client schedules a poll at the boundary instead of
lingering with festive artwork for a whole window.

---

## 4. Endpoints

### Public (no auth)

| Route | Behaviour |
| --- | --- |
| `GET /v1/homepage?platform=android\|ios\|web` | Resolves the live base page plus the single live campaign. Drafts are excluded by the query, not by a filter. `ETag` over the document minus `generated_at`; `304` on match; `cache-control: public, max-age=15..60, stale-while-revalidate=240`; `x-homepage-version` |
| `GET /v1/home?platform=android\|ios\|web` | The same document through the same handler, under the shorter name the mobile app reads. An alias, not a second source, so the two cannot drift; identical `ETag` and cache headers |
| `GET /v1/homepage/media/:id` | Serves registered artwork by uuid. Immutable (`max-age=31536000`), `nosniff`, sandboxed CSP. An unknown id is `404` |

The short HTTP cache window is deliberate: a publish should be visible quickly. The ETag makes a
poll cheap when nothing has changed.

### Staff (`/v1/admin/homepage…`, authenticated)

| Route | Read roles | Write |
| --- | --- | --- |
| `GET /admin/homepage` | all staff | — |
| `GET /admin/homepage/draft`, `/preview` | all staff | — |
| `PUT /admin/homepage/draft` | — | `trust_safety` |
| `DELETE /admin/homepage/draft` | — | `trust_safety` |
| `POST /admin/homepage/publish` | — | `trust_safety` |
| `POST /admin/homepage/rollback` | — | `trust_safety` |
| `POST /admin/homepage/campaigns` | — | `trust_safety` |
| `PUT /admin/homepage/campaigns/:id` | — | `trust_safety` |
| `POST /admin/homepage/campaigns/:id/duplicate` | — | `trust_safety` |
| `DELETE /admin/homepage/campaigns/:id` | — | `trust_safety` |
| `POST /admin/homepage/campaigns/:id/publish` | — | `trust_safety` |
| `POST /admin/homepage/campaigns/:id/unpublish` | — | `trust_safety` |
| `POST /admin/homepage/media` | — | `trust_safety` |
| `GET /admin/homepage/media` | all staff | — |

`READ_ROLES` is `support_agent`, `verification_reviewer`, `trust_safety`, `finance`,
`admin_readonly`. `WRITE_ROLES` is `trust_safety` only.

`admin_readonly` is deliberately excluded from writes: a role whose name promises it cannot change
anything must not publish under that name. The configured owner in `ADMIN_EMAILS` receives all five
staff roles, including `trust_safety`, so the owner keeps the write path. The web console mirrors
this list to decide which controls to show, but the server is the authority.

Every write is audited with the before/after version. Editor saves are validated strictly; publish
and rollback re-validate permissively, so a release written under an older contract still publishes
with its unknown sections dropped rather than failing forever.

Media registration requires all three of: the storage key belongs to the caller, it starts with
`campaign_art/`, and the object's bytes exist. The uploaded file itself goes through the existing
files pipeline (`POST /v1/files/upload?purpose=campaign_art`, JPEG/PNG, ≤ 10 MB).

---

## 5. Client behaviour

`apps/mobile/src/homepage/use-homepage.ts`:

1. First frame uses `defaultHomepageDocument()` from the shared package. It is never blank.
2. The cached document is read and applied before any network call, so there is no spinner and no
   layout shift on a warm start.
3. A background request runs against `/v1/home` with the stored ETag. A `304` keeps the current
   page.
4. A response is parsed with the same contract the server used before it is applied. Invalid JSON,
   a refused schema or an unknown major is a failed refresh, not a render.
5. Identical content (version, theme, hero, sections) keeps the previous object identity, so the
   page does not re-render or restart image loads.
6. On failure the current page stays, and a banner says "Showing the last saved page. Pull down to
   try again." with a **Retry** action.
7. **Except:** if the document on screen is a campaign that has expired (`isStaleCampaign`, with a
   6-hour clock-skew grace), the client falls back to the default page rather than showing last
   month's festival. This also runs when a campaign first loads from cache after its window.
8. A timer polls at `max(60, refresh_after_seconds)`. Returning to the foreground triggers a refresh
   if the last attempt was more than 60 s ago.

`cache.ts` writes `{document, etag}` to a file under the app's document directory on native, and to
a module-scoped variable on web. The cache is validated on read; a corrupt file is ignored, not
rendered. No token, user id or account data is part of the cached document — the homepage is public
content.

The web console (`apps/web/src/components/HomepageAdmin.tsx` + `HomepageEditor.tsx`) provides page
and campaign editing, a device-width preview, duplicate/delete, drag-and-drop section reordering
(handle on each section; drop inserts before the target), per-section windows, upload, schedule,
publish, unpublish and restore from history. A preset bar (Default, Normal, Diwali 2026, Holi 2027,
Raksha Bandhan 2027, Christmas 2026) replaces the theme and hero while keeping the section list, so
a festive look is one click and still editable. The theme palette edits the gradient as from /
optional middle / to stops and the overlay as `decor`.

There is also a **raw JSON** tab. It is not an escape hatch: an applied document goes through the
same strict parser as a save, the console lists the validator's issues by path, and a document with
an unknown section type is refused. The JSON is the draft you are editing — Save still decides
whether it is published.

The phone-width preview (a 390 px frame that shrinks to the viewport) renders the same section
shapes as the app, including the 2-up `category_grid`, from the draft rather than from the last
publish.

---

## 6. Environment and deployment

No new secret is required. The homepage uses what the API already has:

| Variable | Use |
| --- | --- |
| `PUBLIC_API_URL` | Base for absolute media URLs (`…/v1/homepage/media/<id>`). Must be the public API origin, including `/v1` |
| `WEB_ORIGINS` | Must include the deployed web console origin (already required by the console) |
| `ADMIN_EMAILS` | Grants the staff roles, including `trust_safety`, at Google sign-in |

Deployment order:

1. Apply migrations — `npm run db:migrate`, or boot the API, which runs pending migrations. `0011`
   is additive: two new tables, no altered column.
2. The API calls `ensureHomepageSeed` at boot. It inserts the published default page with
   `ON CONFLICT … DO NOTHING`, so a restart does not create a second release and does not overwrite
   an edited page.
3. Deploy the API before the web console; the console's new tab fails closed against an older API
   (routes absent → the request fails; no mutation is attempted).
4. Deploy the app build at leisure. The old app simply does not call `/v1/homepage`; the new app
   works against an API that has the routes.

Rollback of a bad page is a console action (restore an older version), not a deploy.

---

## 7. Tests

Run with `npm test`. The homepage suite is `apps/api/test/homepage.test.ts`: the real Fastify app
through `app.inject`, a dedicated PGlite directory cleared at start, staff sessions created directly
in the database.

| Area | What is asserted |
| --- | --- |
| Default page | Public, `ETag` + `304` with an empty body, cache headers, version header, the shipped headline |
| Alias | `/v1/home` returns the same version, theme, sections, `ETag` and cache headers as `/v1/homepage`, and answers `304` to the canonical `ETag` |
| Contract | The served document passes the app-side parser |
| Authorisation | Anonymous `401`; ordinary user `403 ROLE_REQUIRED`; support reads but cannot write; `admin_readonly` reads but is refused `PUT`/publish/rollback/campaign-create |
| Draft privacy | A saved draft never appears on the public route; publish moves the visible version; publishing consumes the draft |
| Publish validation | A corrupted draft row is refused at publish with `VALIDATION_FAILED` and issues |
| Rollback | Copies the oldest release into a new, higher version; history stays linear; the public page matches |
| Editor validation | Unknown section type, `https://` route, foreign image host and a non-hex colour are each refused, and a refused save leaves no draft |
| Reader tolerance | Unknown sections are dropped for readers; strict mode refuses them |
| Campaigns | Draft campaign not live; published campaign applies inside its window; expiry via `resolveHomepage(at)`; unpublish restores the base; platform targeting; priority order; already-ended window refused; published campaign immutable (`409`) and duplicable |
| Media | Foreign object key `404`; wrong upload purpose refused; missing bytes refused; registered artwork served publicly with `immutable` and the stored content type; a banner may only use a registered URL |
| Windows | `ends_at <= starts_at` refused before it reaches the database |

Counts from the run that produced this document (2026-10-28): domain **90**, API **70**, mobile
**8**; 0 failed, 0 skipped. `npm run typecheck` is clean for all four workspaces and `npm run build`
succeeds (the web bundle prints a pre-existing >500 kB chunk-size warning).

---

## 8. Verified against the running stack

The API ran on PGlite with migrations through `0011`; the web console and the Expo app pointed at
it. These were observed, not inferred:

- The default page served with `ETag`, `304` on re-read, and the app rendered header, hero, badges,
  search, categories, routes and sections.
- A draft headline saved in the console did not appear publicly until **Publish**; after publishing
  the visible version moved and the draft was gone.
- A campaign scheduled for the future was **not** live. A campaign whose window was open *was* live,
  with its theme applied, `expires_at` set and `refresh_after_seconds` shrunk to the remaining
  window.
- **Automatic expiry:** with no job and no deploy, once server time passed `ends_at` the same API
  returned the default page.
- **Rollback:** restoring an old version produced a new, higher version with the old content.
- A campaign created and published **only through the API** appeared in the running app as its own
  eyebrow and headline with no rebuild and no app update.
- **The app's own refresh timer was observed.** The app loaded a campaign at 04:51:13Z; the
  campaign was unpublished through the API at 04:51:21Z, while the app still showed it. At
  04:56:29Z — one `refresh_after_seconds` interval later, with no reload, no navigation and no
  manual refresh — a new `GET /v1/homepage` returned the fallback campaign and the page changed to
  it in place. When that campaign was unpublished too, the next poll (05:01:47Z) returned the
  shipped default page, again in place.
- The `admin_readonly` refusal is covered by a test rather than a click-through; the console hides
  the write controls for that role.

### The redesigned composition (2026-10-28)

The default release was published through the real admin API (draft `PUT`, then `POST publish`) from
a `trust_safety` session, then observed in Expo Web at a 319×570 CSS px viewport:

- The hero painted the three-stop gradient (`#0b3bff → #1230c8 → #061a7a`), 320 px tall, with the
  translucent header on top and the search card overlapping the seam.
- The `category_grid` rendered 2-up at x = 29 / 177 with cream cards, and the page reported no
  horizontal overflow.
- The floating tab bar measured 287 × 64 px, radius 999 px, 24 px above the viewport bottom.
  Scrolled to the end, the last content line ended 16 px above the bar.
- The browser console showed only React DevTools' informational line.
- The console's editor was exercised in the browser against the same live draft:
  - **Preset:** clicking *Diwali 2026* rewrote the theme key to `diwali-2026`, the brand to
    `#b91c1c`, the hero eyebrow to `DIWALI`, and the gradient to `#8a1c1c → #c2410c → #4a0f0f` in
    the from / middle / to fields.
  - **Drag reorder:** dropping the *Promo cards* handle on the *Category grid* card moved it to
    position 1 in the draft list.
  - **Raw JSON:** adding a section with `type: "unknown_widget"` and pressing *Apply JSON* was
    refused with `sections[8].type: must be one of …; got "unknown_widget"`; *Revert* cleared it.
  - **Preview draft:** the dialog rendered the draft hero and all six categories
    (Documents, Certificates, Samples, Cosmetics, Printed, Puja items). The harness viewport was
    319 CSS px, so the phone frame shrank to fit rather than being measured at its 390 px maximum.
  - None of this was saved: the server still reported *No draft* afterwards. The edits existed in
    the page's state only.

### Limits of this verification

- **No device or emulator.** The app was rendered through Expo Web against the local API. Android
  and iOS visual behaviour, native file caching and native AppState transitions are unexercised.
- The web build caches the homepage in memory, so a reload always exercises the default → network
  path; the file cache path is native-only and was verified by unit-level reasoning, not by a run.
- A synthetic `visibilitychange` in the browser harness did not trigger the app's own refresh
  handler, so the foreground-refresh branch is not demonstrated end to end. The timer branch *was*
  observed (above). Treat the foreground branch as implemented and typechecked, not as observed.
- No real CDN. Browser HTTP caching can serve a page within `max-age + stale-while-revalidate`;
  every "is it live" check in this verification used `cache-control: no-cache` or a cache-busting
  window.
- No push. A campaign reaches a closed app the next time it opens, not before.

---

## 9. What this system cannot do

- Change the app's layout or component set. The composition is fixed and the contract names existing
  section kinds only.
- Deliver native code, a new screen or a new icon font without an app release.
- Target one user or one city. Campaigns target platforms, not audiences; per-user content would
  need a different contract and a privacy decision.
- Replace the booking flow. A CTA opens a real screen; it does not perform an action by itself.
- Serve arbitrary images. Only registered JPEG/PNG objects under `campaign_art/` on this API.

---

## 10. Where this build differs from the original brief

The brief named specific libraries, hosts and categories. Several are not in the app's dependency
set or the existing API, and the working alternative is recorded here rather than silently
substituted.

| Asked for | Shipped | Reason |
| --- | --- | --- |
| `expo-blur` on the pill nav | 97%-opaque white surface with a floating shadow | `expo-blur` is not installed; a native module for one surface was not justified |
| `expo-image` | React Native `Image` | `expo-image` is not installed; the art is a handful of static files |
| `react-native-reanimated` for stagger/press | RN `Animated` (`Reveal.tsx`) and a `Pressable` transform | Same reason; it honours reduced-motion and adds no native dependency |
| `AsyncStorage` for the cached page | File on native, module variable on web (`cache.ts`) | The cache predates the brief; neither needs a key-value package |
| Cloudinary / Vercel Blob signature route, auto-WebP | Existing files pipeline + `homepage_media` allowlist, JPEG/PNG ≤ 10 MB | Reuses the audited upload path; no second storage vendor and no transcode step |
| Express | Fastify 5 | The API was already Fastify; helmet, CORS and rate limiting are equivalent |
| `GET /home` | `/v1/homepage` canonical, `/v1/home` alias | One handler serves both, so older clients and docs keep working |
| Grid: Sweets, Gifts, Clothes, Electronics, Medicines | Documents, Certificates, Samples, Cosmetics, Printed, Puja items | The send flow's own categories. Perishable food, medicines and high-value electronics are refused by `eligibility.ts`, so a card for them would lead to a dead end |

Not implemented, and not claimed: WebP conversion or client-side compression; a second media host;
native Android/iOS verification of the layout (Expo Web only, see §8).
