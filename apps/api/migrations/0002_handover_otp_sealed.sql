-- Handover codes are shown to the sender in-app (the receiver has no account and no stored phone
-- number), so the server must be able to recover the code after issuing it. Verification still uses
-- `code_hash`; this sealed copy is AES-256-GCM ciphertext and is never returned to anyone but the
-- sender's own authenticated session.
ALTER TABLE handover_otps ADD COLUMN code_sealed text;

COMMENT ON COLUMN handover_otps.code_sealed IS
  'AES-256-GCM sealed handover code (lib/seal.ts). Nullable for rows created before 0002.';
