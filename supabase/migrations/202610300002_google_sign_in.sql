-- Apply as project owner before deploying Google sign-in.
-- Google authentication uses the regular schema, never the online demo schema.
BEGIN;
ALTER TABLE iit_voice.users ADD COLUMN IF NOT EXISTS google_subject TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS users_google_subject ON iit_voice.users(google_subject);
CREATE TABLE IF NOT EXISTS iit_voice.oauth_flows (
  token_hash TEXT PRIMARY KEY,
  verifier TEXT NOT NULL,
  profile TEXT NOT NULL DEFAULT '{}',
  expires DOUBLE PRECISION NOT NULL
);
ALTER TABLE iit_voice.oauth_flows ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON iit_voice.oauth_flows FROM PUBLIC;
COMMIT;
