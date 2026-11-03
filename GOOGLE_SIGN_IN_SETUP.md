# Continue with Google: setup for IIT Voice

The access page offers **Continue with Google** and **Continue anonymously**. Email/password sign-in and account requests have been removed. Google sign-in stays disabled until its environment settings are supplied; anonymous reporting works independently. Isolated demo buttons remain available when demo mode is enabled.

Google authenticates the person; IIT Voice still decides their permissions. An approved existing university account keeps its saved role, office, reports, and approval status. A first-time Google user confirms their name and affiliation, then receives reporter access immediately. No IIT Voice password or Main Admin approval is required for a new Google reporter. Existing pending or disabled accounts remain restricted.

## 1. Check your Supabase project

1. Open the existing **IIT Voice** project in [Supabase](https://supabase.com/dashboard).
2. Open **Authentication** in the left menu.
3. Open **Sign In / Providers** (sometimes labelled **Providers**), then **Google**.
4. If Google is disabled or its client settings are empty, complete the setup below. Creating the database alone does not configure Google sign-in.

Keep this panel open. It displays your project's Google **callback URL**, usually:

```text
https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback
```

Copy the actual URL shown by Supabase. This first callback goes from Google to Supabase. See the [official Supabase Google setup guide](https://supabase.com/docs/guides/auth/social-sign-in/auth-google).

## 2. Create the Google OAuth client

1. Open [Google Cloud Console](https://console.cloud.google.com/) and select or create the project used for IIT Voice.
2. Open **Google Auth Platform**. Complete **Branding** with the app name `IIT Voice`, a support email, and developer contact details.
3. Under **Audience**, use the university's internal audience if its Google Workspace administrators manage this project. Otherwise, use External; while the app is in Testing, add the university Google accounts that will test it.
4. Under **Data Access**, use only the basic sign-in scopes: `openid`, email, and profile. IIT Voice does not request Gmail, Drive, or Calendar access.
5. Open **Clients → Create client → Web application**. Name it `IIT Voice Web`.
6. In **Authorized redirect URIs**, paste the Supabase callback URL from step 1. This is the Supabase URL, not your Vercel homepage.
7. Save. Copy the Google client ID and client secret privately into the **Google provider panel in Supabase**, enable Google, and save there.

Do not paste the client secret in chat, source code, screenshots, or a `VITE_` variable. It belongs in Supabase's Google provider settings. The Gemini API key is a different credential and cannot be used here.

## 3. Allow the return to IIT Voice

In **Supabase → Authentication → URL Configuration**:

- Set **Site URL** to `https://iit-voice.vercel.app`.
- Add these **Redirect URLs** for the environments you use:

```text
http://127.0.0.1:5173/api/auth/google/callback**
https://iit-voice.vercel.app/api/auth/google/callback**
```

The suffix allows the one-use browser-flow query parameter. Each entry stays restricted to the named origin and callback path. Do not replace these with a wildcard for every website. If you use `localhost` instead of `127.0.0.1`, add that exact local origin too and use it consistently.

This second callback goes from Supabase back to IIT Voice. [Supabase redirect configuration](https://supabase.com/docs/guides/auth/redirect-urls) supports these patterns; both redirects are needed for the complete flow.

## 4. Configure IIT Voice locally

Find the project's **Project URL** and **Publishable API key** in Supabase's project connection/API settings. A legacy `anon` key is also supported. Do not use `service_role`, a secret key, the database password, the Gemini key, or the Google client secret.

Add these settings to your private `.env.local`, keeping its existing settings:

```dotenv
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_PUBLISHABLE_KEY=YOUR_PROJECT_PUBLISHABLE_KEY
IIT_VOICE_PUBLIC_URL=http://127.0.0.1:5173
```

Replace the placeholders with the values from your project. Restart `npm run dev` so Python reads them. The Google button becomes available when these settings are present and valid.

Local demo mode still uses its isolated SQLite database. Google authentication can verify an actual university Google identity, but the resulting IIT Voice profile belongs only to that local test database. Demo buttons remain independent of Google and continue using the existing sample accounts.

## 5. Prepare Supabase and Vercel when you are ready to deploy

1. Before deploying these changes, apply the anonymous-reporting migration, if not already applied, and then `supabase/migrations/202610300002_google_sign_in.sql` in Supabase's SQL Editor as the project owner. Existing data is retained.
2. In the existing Vercel project's Production environment, add `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` using the same project's values.
3. Set Production `IIT_VOICE_PUBLIC_URL=https://iit-voice.vercel.app`. Do not copy the local URL into Production.
4. Leave `DATABASE_URL` unchanged. Google sign-in uses the regular IIT Voice database and never the online demo schema.
5. Commit, push, and deploy when ready. No commit, push, environment upload, or deployment is performed automatically by this code change.

## What happens when someone signs in

- The browser goes to Supabase and Google. Google confirms account ownership; IIT Voice never asks for the Google password.
- The backend exchanges a one-use code with Supabase using PKCE, then asks Google's UserInfo endpoint for the verified identity. It accepts only a verified email at `@g.msuiit.edu.ph`. Google's hosted-domain claim must also match either `msuiit.edu.ph` or `g.msuiit.edu.ph`, since an organization's hosted domain can differ from the email domain. The account picker hints at Workspace accounts generally; this hint never replaces the backend's exact checks. See [Google's identity claims](https://developers.google.com/identity/openid-connect/openid-connect).
- Google access/refresh tokens are not stored in browser local storage, sent to React, or saved as IIT Voice session cookies. IIT Voice creates its existing HttpOnly session after identity and account-access checks.
- A matching approved account keeps its ID and permissions. Google login cannot promote someone to validator, office, or Main Admin. Disabled and pending accounts remain blocked.
- A new Google user confirms their name and chooses Student, Faculty, or Staff, without a password. Their verified university identity grants immediate reporter access and signs them in; no Main Admin approval is required. Affiliation is self-declared and never grants administrative permissions. Existing pending or disabled accounts remain restricted; Google sign-in does not undo an administrator's access decision.
- Supabase's **Authentication → Users** contains Google identities. IIT Voice's private `iit_voice.users` table still stores its profiles, approvals, and roles. They serve different purposes; a Supabase Auth identity alone does not grant access to private reports.

The new `google_subject` column binds the stable Google identity to the existing account. `oauth_flows` stores short-lived browser-flow records and pending onboarding data, expiring after ten minutes. Expired rows are cleaned up when a new Google flow starts. Neither table is exposed through the browser Data API. Provider codes and tokens are not logged.

## Quick checks

1. With Google setup incomplete, the button explains that one-time setup is needed; anonymous access still works.
2. Choose a personal Gmail account: IIT Voice should reject it before issuing an application session.
3. Choose a university account that already has approved access: it should open the same workspace, with the same reports and role.
4. Choose a new university account: confirm affiliation and continue directly to the campus workspace. It must be a reporter account, with no access to Main Admin pages. The access page must have no password fields or account-request form, and the former password login and registration endpoints must reject requests.
5. Cancel Google sign-in or wait more than ten minutes: the app should explain that you must start again, without leaving a half-signed-in session.

If Google reports `redirect_uri_mismatch`, compare the Google client's authorized redirect URI with the Supabase callback. If it returns to the homepage without completing, check the Supabase return URLs and `IIT_VOICE_PUBLIC_URL`. If the university blocks the consent screen, ask its Google Workspace administrator whether this OAuth application is permitted. Do not bypass those controls.

Automated tests use fake credentials and mocked Google/Supabase responses. A live university-account sign-in still needs to be checked after the provider configuration above is complete.
