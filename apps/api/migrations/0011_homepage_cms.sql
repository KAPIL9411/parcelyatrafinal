-- Remote homepage and campaign configuration.
--
-- One table holds every release, because a homepage and a festival campaign are the same object
-- with different lifetimes:
--
--   kind='homepage'  one live release at a time (a partial unique index enforces it)
--   kind='campaign'  any number of live releases, each with a window and a priority
--
-- Releases are immutable once published. Editing always writes a draft row; publishing flips the
-- draft and archives the previous homepage release. Rollback is therefore just "publish a copy of an
-- older version" — the history stays linear and nothing is ever rewritten in place, which is what
-- makes an audit trail worth reading.
--
-- Drafts are ordinary rows with status='draft'. The public endpoint never selects them, so a draft
-- cannot leak by forgetting a filter on the read path: it is excluded by the same predicate that
-- picks the published one.

CREATE TABLE homepage_releases (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Monotonic across every release, so a client can tell one publish from the next.
  version          bigserial NOT NULL UNIQUE,
  kind             text NOT NULL CHECK (kind IN ('homepage', 'campaign')),
  status           text NOT NULL CHECK (status IN ('draft', 'published', 'archived')),
  name             text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  -- The validated configuration document. Normalised by @py/domain before it is written.
  config           jsonb NOT NULL,
  priority         integer NOT NULL DEFAULT 0,
  -- Which clients a campaign targets. A release that names no platform applies everywhere.
  platforms        text[] NOT NULL DEFAULT '{android,ios,web}'
    CHECK (platforms <@ ARRAY['android','ios','web']::text[]),
  starts_at        timestamptz,
  ends_at          timestamptz,
  note             text CHECK (note IS NULL OR char_length(note) <= 500),
  created_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  published_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  published_at     timestamptz,
  rolled_back_from bigint,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  -- A live campaign without a window would never activate, and would be impossible to reason about
  -- when several overlap. Refuse it at the storage layer, not only in the route.
  CONSTRAINT homepage_campaign_window CHECK (
    kind <> 'campaign' OR status <> 'published' OR (starts_at IS NOT NULL AND ends_at IS NOT NULL)
  ),
  CONSTRAINT homepage_window_order CHECK (
    starts_at IS NULL OR ends_at IS NULL OR ends_at > starts_at
  )
);

-- Exactly one published base homepage. Publishing a new one must archive the old one in the same
-- transaction, which is what this index turns into a hard guarantee.
CREATE UNIQUE INDEX homepage_releases_single_live_homepage
  ON homepage_releases (kind)
  WHERE kind = 'homepage' AND status = 'published';

-- One draft per kind keeps "the draft" unambiguous in the console. Campaigns are drafts of their own
-- row instead, so this applies to the base homepage only.
CREATE UNIQUE INDEX homepage_releases_single_homepage_draft
  ON homepage_releases (kind)
  WHERE kind = 'homepage' AND status = 'draft';

CREATE INDEX homepage_releases_campaign_window
  ON homepage_releases (status, priority DESC, starts_at, ends_at)
  WHERE kind = 'campaign';

CREATE INDEX homepage_releases_history
  ON homepage_releases (kind, version DESC);

-- Uploaded artwork, addressed by an opaque id.
--
-- The public homepage references `.../v1/homepage/media/<id>` rather than a Cloudinary URL or a
-- signed token: the row is the allowlist. An editor cannot point a banner at an arbitrary origin,
-- and a URL that leaves this table stops resolving.
CREATE TABLE homepage_media (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  object_key   text NOT NULL UNIQUE,
  content_type text NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png')),
  byte_size    integer NOT NULL CHECK (byte_size > 0),
  created_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX homepage_media_created ON homepage_media (created_at DESC);
