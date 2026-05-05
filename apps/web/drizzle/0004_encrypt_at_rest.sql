-- Encrypt sensitive document columns at rest.
--
-- Before this migration, `documents.prosemirror_state` (the full raw doc text
-- the user typed) and `documents.validated_json` (the structured extraction)
-- were stored as plaintext jsonb. Anyone with raw DB access could read
-- everything a user wrote, even before "finalize" wrapped a copy in
-- `encrypted_payload` for embedding in Word/Docs files.
--
-- This migration:
--   1. Adds AES-256-GCM ciphertext columns (encrypted/iv/tag) for both fields.
--   2. Drops the plaintext columns. We do NOT migrate existing rows: the
--      production deployment has no users yet, and pre-existing dev rows are
--      either test data or stale extraction state from broken sessions.
--      A real migration with users would copy + encrypt under a transaction
--      with a one-shot script before the DROP.
--
-- After this migration the only plaintext that ever sits on disk is the
-- bi-temporal `extraction_episodes.patch` log, which is treated separately
-- (see migration 0005).

ALTER TABLE "documents"
  ADD COLUMN "prosemirror_encrypted" text,
  ADD COLUMN "prosemirror_iv" text,
  ADD COLUMN "prosemirror_tag" text,
  ADD COLUMN "validated_encrypted" text,
  ADD COLUMN "validated_iv" text,
  ADD COLUMN "validated_tag" text;

ALTER TABLE "documents"
  DROP COLUMN "prosemirror_state",
  DROP COLUMN "validated_json";
