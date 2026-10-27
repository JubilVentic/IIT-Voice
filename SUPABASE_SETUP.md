# Connect IIT Voice to Supabase and Vercel

The React website and Python API stay in the same Vercel project. Supabase stores application data in a private `iit_voice` Postgres schema. The current IIT Voice login, account verification and role permissions stay in the Python API. Supabase Auth is not used in this first integration.

Local SQLite continues to work when `DATABASE_URL` is blank. Selecting Supabase does not upload or erase the local database. Cloud accounts start separately; existing local passwords are not automatically copied.

## 1. Save the connection string locally

In the existing Supabase project, open **Connect → Transaction pooler** and copy the PostgreSQL URI. Replace its password placeholder with the project's **database password**, URL-encoded if it contains special characters. This is different from a publishable/anon API key.

Add this to `.env.local`:

```dotenv
DATABASE_URL=postgresql://postgres.PROJECT_REF:ENCODED_DATABASE_PASSWORD@POOLER_HOST:6543/postgres
```

Use the exact username and host shown by Supabase. Keep this value server-side; never name it `VITE_DATABASE_URL`, commit it, or paste it into chat. The driver requires encrypted transport and disables prepared statements for transaction pooling.

## 2. Create the application tables and first Main Admin

Run from the project directory:

```sh
python3 -m pip install -r requirements.txt
python3 -B server.py --init-db
python3 -B server.py --create-admin your-email@example.edu
```

The last command prompts privately for a password. Use your own email and name. Initialization creates the private schema, tables, offices and default category routing; it does not seed sample reports. It can be repeated without clearing existing records.

Alternatively, run `supabase/migrations/202610270001_iit_voice.sql` in Supabase's SQL Editor, then run the initialization command to populate office routing. Use the schema picker in Supabase's Table Editor to inspect `iit_voice`. These accounts will not appear under Supabase **Authentication → Users**, because the application keeps its existing authentication.

RLS is enabled with no browser policies, and the schema is not a public Data API schema. The backend connects using the database owner and enforces IIT Voice role checks. Do not expose `iit_voice` through Supabase's browser Data API.

## 3. Try it locally

Restart the existing development server after changing database settings:

```sh
npm run dev
```

Sign in using the Main Admin created in step 2. Cloud data starts without local accounts or reports. Create and verify the test accounts through **Users & access**. One-click local demo accounts are not created automatically in Supabase.

## 4. Configure Vercel and redeploy

Keep the Vite framework, `npm run build` build command, and `dist` output directory. The checked-in `api/index.py` and `vercel.json` deploy the Python handler and route `/api/*` to it on the same origin as the website.

Add these server-side Vercel environment variables for the deployment environments you want to use:

| Variable               | Value                                      |
| ---------------------- | ------------------------------------------ |
| `DATABASE_URL`         | The same Supabase transaction-pooler URI   |
| `GEMINI_API_KEY`       | Your existing key, if photo AI is enabled  |
| `IIT_VOICE_AI_MODEL`   | Your existing model setting, if customized |
| `IIT_VOICE_DEMO_LOGIN` | `0`                                        |

Secure session cookies are enabled automatically on Vercel. Keep secrets out of `VITE_*` variables. `.vercelignore` excludes local databases, backups and environment files from uploads.

Push the integration files and redeploy after saving the environment variables. The development startup probe uses `/api/health` (process readiness only), so cloud database latency does not stop a healthy API. Check `/api/me`: an unauthenticated request should return HTTP **401** with JSON, rather than an HTML page. Then sign in and submit a test report; verify it remains after a deployment/restart.

Evidence photos remain private database records (`BYTEA`) in this first version, accessed through the authenticated API. Supabase Storage can be introduced later if evidence volume calls for it; no public bucket is required now.

## Verification

The normal unit and browser tests always use disposable SQLite even if `.env.local` contains a cloud connection. They never seed, clear or reset the Supabase project. A live Supabase connection and deployed Vercel routing must be checked separately after configuration.

References: [Supabase database connections](https://supabase.com/docs/guides/database/connecting-to-postgres), [Vercel Python API functions](https://vercel.com/docs/functions/runtimes/python/api-directory).
