-- 0005 — indexes added during the Phase D performance audit.
--
-- Why: `payments.provider_ref` is the lookup key every provider webhook uses
-- (`SELECT ... FROM payments WHERE provider_ref = $1`), and there was no index on it. Every
-- incoming webhook forced a full scan of the payments table. `refunds.payment_id` is read on
-- every refund eligibility check (`SUM ... WHERE payment_id IN (SELECT ...)`), and audit-log
-- filters on `action` and `actor_id` were scanning the whole append-only table.
--
-- The remaining indexes back the admin list endpoints (booking/dispute/audit), which now
-- expose an offset page rather than a truncated head.

-- Payment lookup by provider reference.
CREATE INDEX IF NOT EXISTS payments_provider_ref_idx ON payments(provider_ref)
  WHERE provider_ref IS NOT NULL;

-- Refunds grouped per payment. The eligibility check reads this on every refund create.
CREATE INDEX IF NOT EXISTS refunds_payment_idx ON refunds(payment_id, created_at DESC);

-- Audit log filters by action and actor (both plain equality, not range).
CREATE INDEX IF NOT EXISTS audit_action_idx ON audit_log(action, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_actor_idx ON audit_log(actor_id, created_at DESC);

-- Admin booking search filters on status + created_at ordering.
CREATE INDEX IF NOT EXISTS bookings_status_created_idx ON bookings(status, created_at DESC);

-- Verification queue is filtered on state and ordered by created_at.
CREATE INDEX IF NOT EXISTS verifications_state_created_idx ON verifications(state, created_at DESC);

-- Disputes queue is filtered on state and ordered by created_at.
CREATE INDEX IF NOT EXISTS disputes_state_created_idx ON disputes(state, created_at DESC);

-- Notifications: unread badge / list by user + status.
CREATE INDEX IF NOT EXISTS notifications_user_status_idx ON notifications(user_id, status, created_at DESC);
