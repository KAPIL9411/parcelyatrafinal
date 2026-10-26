-- 0008 — a traveller offering to carry a parcel that is waiting on their route.
--
-- Why: discovery ran one way only. `GET /v1/parcels/:id/matches` shows a sender the trips that could
-- carry their parcel, and a traveller had no equivalent list and no way to act on one. A traveller who
-- publishes a trip with 8 kg free and cannot see or respond to what is waiting on that corridor is a
-- calendar, not a marketplace. The other half of the matching feature was missing.
--
-- Shape:
--   - one row per (parcel, trip). `UNIQUE` is the anti-spam rule as well as the data rule: offering
--     twice is the same offer, so the route is safely retryable and the sender is notified once;
--   - it records interest, not commitment. The sender still chooses, still gets the quote, and still
--     creates the booking, so capacity reservation, pricing and the booking state machine are
--     untouched by this table;
--   - no free text. A message from a stranger to a stranger needs the authorisation and moderation
--     machinery the booking conversation has. This is deliberately a flag, not a second chat.
--
-- Additive only: one new table and its read indexes. No column is altered and no row is rewritten.

CREATE TABLE IF NOT EXISTS trip_interests (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parcel_id    uuid NOT NULL REFERENCES parcels(id) ON DELETE CASCADE,
  trip_id      uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  traveller_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (parcel_id, trip_id)
);

-- Sender side reads "who has offered on this parcel"; the traveller's list marks what they already offered for.
CREATE INDEX IF NOT EXISTS trip_interests_parcel_idx ON trip_interests(parcel_id, created_at DESC);
CREATE INDEX IF NOT EXISTS trip_interests_traveller_idx ON trip_interests(traveller_id, created_at DESC);
