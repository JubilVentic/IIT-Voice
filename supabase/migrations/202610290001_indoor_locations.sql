-- Add indoor reporting positions without changing existing report records.
-- Run as the project database owner in Supabase SQL Editor before deploying.
BEGIN;
ALTER TABLE IF EXISTS iit_voice.reports
  ADD COLUMN IF NOT EXISTS indoor_location TEXT NOT NULL DEFAULT '{}';
ALTER TABLE IF EXISTS iit_voice_demo.reports
  ADD COLUMN IF NOT EXISTS indoor_location TEXT NOT NULL DEFAULT '{}';
COMMIT;
