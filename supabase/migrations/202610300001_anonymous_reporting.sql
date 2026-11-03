-- Run as the project database owner before deploying anonymous reporting.
-- Existing accounts and reports remain identified (0); nothing is deleted.
BEGIN;
ALTER TABLE IF EXISTS iit_voice.users
  ADD COLUMN IF NOT EXISTS is_guest INTEGER NOT NULL DEFAULT 0 CHECK (is_guest IN (0, 1));
ALTER TABLE IF EXISTS iit_voice.reports
  ADD COLUMN IF NOT EXISTS anonymous INTEGER NOT NULL DEFAULT 0 CHECK (anonymous IN (0, 1));
ALTER TABLE IF EXISTS iit_voice_demo.users
  ADD COLUMN IF NOT EXISTS is_guest INTEGER NOT NULL DEFAULT 0 CHECK (is_guest IN (0, 1));
ALTER TABLE IF EXISTS iit_voice_demo.reports
  ADD COLUMN IF NOT EXISTS anonymous INTEGER NOT NULL DEFAULT 0 CHECK (anonymous IN (0, 1));
COMMIT;
