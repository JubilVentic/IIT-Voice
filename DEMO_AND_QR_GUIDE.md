# Demo accounts and the IIT Voice QR code

## Local demo accounts

On your development computer, set `IIT_VOICE_DEMO_LOGIN=1` in `.env.local`, save it, then restart `npm run dev`.

The login page shows one-click sample accounts for:

- Main Admin
- Validator Admin
- Student
- Faculty
- Physical Plant
- ICT

Local startup creates missing sample accounts without adding sample concerns or map pins. Existing accounts, passwords, reports, and assignments are retained. An existing account with the same sample email is not converted into a demo account.

The local demo server uses a separate SQLite database at `data/demo/iit-voice.sqlite3`, even when `DATABASE_URL` is configured for Supabase. Demo actions stay in that local test database. If `IIT_VOICE_DATA` is set, it selects the local demo directory instead.

To return to your normal Supabase accounts and records, set `IIT_VOICE_DEMO_LOGIN=0` and restart the development server. Neither database is erased when you switch modes.

Local demo sign-in requires the local loopback server and local requests. The CLI database setup and admin-creation commands still target the configured database; automatic SQLite isolation applies to the local demo server.

## Online demos in the existing Supabase project

You do not need another Supabase project. The same IIT Voice project contains two separate groups of tables:

| Schema           | Purpose                               | Database connection            |
| ---------------- | ------------------------------------- | ------------------------------ |
| `iit_voice`      | Regular users, reports, and evidence  | Existing `DATABASE_URL`        |
| `iit_voice_demo` | Shared demo accounts and test reports | Restricted `DEMO_DATABASE_URL` |

The demo connection uses the database role `iit_voice_demo_app`. It owns the demo tables, has no permission to use the regular `iit_voice` schema, and cannot create roles or databases. The application checks those restrictions on every demo connection. Neither schema is exposed through Supabase's browser Data API.

Both groups share the project's storage and resource limits. Demo information is shared among testers; enter test information only. Demo administrators can change demo accounts and records, affecting other testers.

### One-time setup

With the existing owner's `DATABASE_URL` saved privately in `.env.local`, run:

```sh
python3 -B setup_online_demo.py
```

This creates the restricted role, demo tables, default offices and routing, and six sample accounts. It does not copy or change regular records or add sample reports or pins.

The restricted connection is saved privately in `.env.demo.local` as `DEMO_DATABASE_URL`. The file is Git-ignored and excluded from Vercel uploads. No credentials are printed. If the private file exists, rerunning checks that connection and adds missing sample accounts while preserving demo data.

### Enable on the deployed login page

1. Deploy the updated code to the existing IIT Voice Vercel project.
2. In that project's environment settings, add **`DEMO_DATABASE_URL`** as a server-only secret for **Production**, using the private value in `.env.demo.local` without its `DEMO_DATABASE_URL=` prefix. Never use a `VITE_` name or substitute the owner's connection.
3. Leave the existing `DATABASE_URL` unchanged. `IIT_VOICE_DEMO_LOGIN` can remain `0` on Vercel; it controls local demos.
4. Redeploy after saving the variable, then check the demo buttons and normal sign-in.

The buttons appear beside normal sign-in on the same website. A demo button starts a session using only `iit_voice_demo`; normal password sign-in and account requests use `iit_voice`. A banner identifies the shared demo workspace. Changing a cookie prefix cannot turn a demo session into a regular session: its token exists only in the demo tables.

To disable online demos, remove `DEMO_DATABASE_URL` and redeploy. Demo cookies then fail authentication and do not fall back to regular tables. Neither schema is erased.

Local demo mode continues using isolated SQLite. To test the Supabase-backed demo locally, set `IIT_VOICE_DEMO_LOGIN=0` and restart. The backend loads `.env.local` and `.env.demo.local`; normal sign-in uses regular Supabase tables and demo buttons use demo tables.

## QR code

The QR code opens the live system:

**https://iit-voice.vercel.app/**

It contains only the website address. It does not contain credentials, automatically sign anyone in, or point at your computer's localhost address.

The login page has an **Open on your phone** section and a **Download QR code** link.

Available files:

- `src/assets/iit-voice-qr.png`: a high-resolution image for sharing and printing.
- `src/assets/iit-voice-qr.svg`: a vector version that stays sharp when resized.

The image has a white quiet zone around the black code. Keep that border intact when printing or placing it on posters. The generated PNG was decoded locally to verify that it points to the address above.

If the system's public address changes, regenerate both QR assets. A separate online demo can have its own QR code once its address exists.

Reference: [Supabase database connection guide](https://supabase.com/docs/guides/database/connecting-to-postgres).
