# University sign-in and anonymous reporting

## University accounts

The access page offers **Continue with Google** and **Continue anonymously**. Email/password sign-in and the account-request form have been removed; their former API endpoints return HTTP 410. Google sign-in accepts only the exact `@g.msuiit.edu.ph` email domain, case-insensitively. Personal Gmail, `@msuiit.edu.ph`, other subdomains, and look-alike suffixes are rejected. All administrative roles use university accounts too.

**Continue with Google** verifies university Google account ownership once configured; see [Google sign-in setup](GOOGLE_SIGN_IN_SETUP.md). New Google users confirm their name and self-declared Student, Faculty, or Staff affiliation, then receive reporter access immediately without Main Admin approval. This profile step does not ask them to register credentials. Google sign-in never grants administrative permissions automatically and does not override restrictions on existing accounts.

Existing accounts are not renamed or deleted. Approved university accounts keep their IDs, roles, offices, and reports when signing in with Google. Pending or disabled accounts remain restricted. Before deploying, create a Main Admin with a university address if you do not already have one:

```sh
python3 -B server.py --create-admin your.name@g.msuiit.edu.ph
```

It prompts locally for the name, then provisions an approved Main Admin profile. Use **Continue with Google** with that same university email to enter; no IIT Voice password is requested. With `DATABASE_URL` configured, this command initializes the regular Supabase tables and creates that account there. Do not reuse a demo account as your real administrator.

## Reporting without an account

Choose **Continue anonymously**, then select **Student**, **Faculty**, **Staff**, or **Visitor**. These are self-declared reporter affiliations. “Staff” does not grant validator, office, or Main Admin access.

The application creates a separate guest identity and an HttpOnly browser session lasting up to 12 hours. It collects no name, email address, or password. Internally, a non-deliverable random address under `guest.invalid` satisfies the existing private users table; it is not returned to the client. Guests are excluded from Users & access and cannot be promoted through that API.

The normal map → evidence → details wizard opens immediately. Guest reports are always anonymous, even if a client sends `anonymous: false`. Reports and comments remain available in the same browser while that session is valid. Reloading retains access. Signing out, clearing cookies, expiry, or switching browsers/devices loses access; there is no recovery code in this version. The submitted concern remains available for staff to review and resolve.

Each guest session owns only its own private reports. Publicly approved campus summaries use the existing visibility rules. Guest submissions start in the validation queue with normal priority, and follow the same evidence screening and review rules as other reports.

Network rate limits cover guest session creation (10/hour), reports (10/hour), photo checks (20/hour), and comments (30/hour), using the existing database-backed limits table. New cookies do not reset a network's limit. People sharing campus Wi-Fi may share these limits; adjust the thresholds after observing pilot usage. This reduces abuse but does not verify a guest's affiliation or whether a report is true.

On Vercel, only the platform's forwarded client IP header is used; local servers ignore client-supplied forwarding headers. Only its SHA-256 digest is used as the limit key, and the limiter does not attach the IP to a concern. See [Vercel request headers](https://vercel.com/docs/headers/request-headers#x-vercel-forwarded-for).

## Anonymous reports from signed-in accounts

On the final report-details step, check **Submit anonymously**. The report remains linked to the account in the protected database so the reporter can follow it and receive updates. This is identity hiding within the application, not deletion of the database association or anonymity from database operators.

Reviewers see **Anonymous reporter** and the affiliation, without the reporter's account ID or email. Report activity uses the same anonymous name. Reporter-authored audit entries for that report omit the actor ID; staff actions remain attributable. Regular, identified reports are unchanged. Changing the report's workflow status does not remove anonymity.

Names and identifying details typed into descriptions, comments, public summaries, filenames, or visible in photographs are not automatically removed. The UI reminds reporters to avoid including these if anonymity matters.

## Database and deployment

Local SQLite startup adds `users.is_guest` and `reports.anonymous` automatically, keeping existing records. Restart `npm run dev` after pulling these changes so the Python API restarts too.

Before deploying to Vercel, run `supabase/migrations/202610300001_anonymous_reporting.sql` in Supabase's SQL Editor as the project owner. It adds the two columns to both regular and demo schemas when present. Existing accounts and reports default to non-guest and identified. The migration is idempotent and deletes nothing. New database initialization and online demo setup include these fields too.

The code and migration can be reviewed and committed together. No production migration, commit, push, or deployment is performed automatically by this change.

## Demo accounts in the final release

Demo buttons remain available during testing, using the existing isolated test database. Use their dedicated demo buttons; demo addresses cannot use university Google sign-in.

For the final release, disable local demo mode (`IIT_VOICE_DEMO_LOGIN=0`) and remove the Vercel `DEMO_DATABASE_URL` environment variable, then redeploy. This disables both the buttons and the demo login endpoint; it does not delete demo records. See `DEMO_AND_QR_GUIDE.md` for the isolation details.
