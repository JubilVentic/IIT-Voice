# IIT Voice

A working campus-reporting pilot for MSU–IIT, with a React interface built by Vite, a Python JSON API, and persistent SQLite storage. The full-width workspace uses white and neutral surfaces with maroon and gold accents, without an outer window frame or pink backdrop. Phone layouts use a sticky header with an expandable role menu, stacked cards and forms, touch-sized controls, responsive maps, and a close button that stays visible in long report dialogs. Wide administration tables scroll within their panels. The supplied MSU–IIT Tibanga site plan is the interactive campus basemap. React renders all screens and manages UI state; Python handles authentication, permissions, report workflows, and persistence.

Requirements: Node.js 22.12+ or 24+, npm, and Python 3.9+. The Python backend uses the standard library plus Pillow for photo processing and python-dotenv for local configuration. Frontend dependencies are locked in `package-lock.json`.

## Run locally

```sh
npm ci
python3 -m pip install -r requirements.txt
python3 -B server.py --seed-demo
npm start
```

`npm start` builds the React frontend into `dist/` and starts the Python API at port 8000. If your database already contains accounts, skip `--seed-demo`; your existing accounts, password, reports, and sessions continue to work.

Open **http://127.0.0.1:8000**. Seeding prints a randomly generated password shared by these sample accounts:

| Account                    | Access             |
| -------------------------- | ------------------ |
| `admin@iitvoice.local`     | Main Admin         |
| `validator@iitvoice.local` | Validator Admin    |
| `student@iitvoice.local`   | Student campus app |
| `faculty@iitvoice.local`   | Faculty campus app |

Seeding only works on an empty database. Sample concerns and pins are illustrative and do not represent university records. The password is not stored in source code. If you lose it during a local demonstration, create another Main Admin account using the command below and an unused email.

For an empty installation without demo accounts:

```sh
python3 -B server.py --create-admin your-email@example.edu
npm start
```

The command prompts for name and password. Requests to register through the application always create an unverified campus-member account. A Main Admin must verify affiliation before sign-in is allowed. Email entry is **not** proof of university membership. The current verification mechanism is a manual admin decision; there is no university directory or SSO integration.

## React development

Start both the Python API and React development server with one command:

```sh
npm run dev
```

Vite starts Python automatically and waits for it to be ready before serving the frontend. An already-running IIT Voice API is reused. Stopping Vite also stops the API process it started; separately started backends remain running. Python dependencies from `requirements.txt` must already be installed. If needed, set `IIT_VOICE_PYTHON` to your virtual environment's Python executable. `IIT_VOICE_API_PORT` changes both the auto-started backend port and proxy target (default 8000).

Open **http://127.0.0.1:5173**. Vite proxies `/api` requests to Python on port 8000, keeping cookie-based login and CSRF checks working. JSX and CSS edits update during development. For the combined application at port 8000, run `npm run build` after frontend edits; no Python restart is required for new build assets. Backend changes require a server restart.

## What works

- Cookie-based login, logout, password hashing, login throttling, and CSRF checks.
- Separate student/campus-member, Validator Admin, and Main Admin interfaces, with server-enforced permissions. Faculty and staff are campus members unless explicitly granted an admin role.
- Report submission with one primary category and additional applicable categories, admin-assessed priority, written location, optional geographic pin, and optional PNG/JPEG evidence.
- The cleaned **MSU–IIT Tibanga site development plan** replaces Google Maps and OpenStreetMap tiles in all map views, including location selection and report concentrations. The drawing-only 3594 × 2049 PNG is bundled locally, so the basemap needs no external map requests. **Report pins** is the default; **Campus plan** hides reports to explore the drawing. **Fit campus** restores the whole-campus view.
- `src/campus-plan.js` converts stored GPS coordinates to drawing coordinates and back using an initial affine alignment fitted to nine matched building centers from the existing local GPS snapshot (Gymnasium, Administration, Main Library, CED, CCS, TBI, Bahay Alumni, PRISM and New CASS). The maximum fit residual at these approximate anchors is about 23 PDF points; this is not surveyed accuracy. Confirm alignment against campus landmarks before operational use. Existing report coordinates are unchanged. Map clicks and pin drags still save latitude/longitude; current location preserves zoom and reports an error if the device is beyond the plan coverage. The rectangular drawing coverage is **not an authoritative campus jurisdiction boundary**.
- The cleaned source PDF remains in `output/pdf/tibanga-site-map-trees-hidden.pdf`; the original supplied PDF is unchanged. Vegetation layers are hidden in the copy; buildings, roads, labels and drawing proportions are preserved. The image remains in the supplied orientation. Geographic north points approximately to the right on this drawing.
- Report pins use location-pin shapes. **Color pins by** switches between priority colors/letters and primary-category colors/numbers, with a matching legend. Category, priority and status filters combine; category filters also match additional categories without duplicating the report. A marker popup includes its status, priority and all categories. Changing color mode preserves the current zoom; filtering fits the matching pins. Filters only narrow reports already permitted for the current account.
- Review queue, search, category/status filters, request for information, rejection, duplicate linking, validation, and office routing.
- A separately reviewed public title and campus summary. Unvalidated/rejected/duplicate reports stay restricted. Reporter identity, original title/description, comments, internal notes, and evidence are not exposed to other campus viewers.
- Progress, resolution, closure, and reopening managed by Main Admin.
- Reporter/admin comments, private admin notes, in-app notifications, restricted evidence viewing, and audit records.
- Account verification, role assignment, deactivation, and default office routing managed by Main Admin.

There are **two administration roles** plus a **Responsible Office** role. Students have no admin dashboard. Responsible Office accounts belong to one office and can access only validated or later concerns assigned to that office. They post updates/evidence and manage work progress; Main Admin handles final closure and reopening. Leadership access, if required, must be designed separately rather than assuming it grants administration rights.

## Status workflow

```text
Submitted → Needs information → Validated → In progress → Resolved → Closed
     └─────────────→ Validated
     └─────────────→ Rejected / Duplicate
Resolved / Closed → In progress (reopened)
```

Validator Admin submits a valid/not-valid decision, an urgency assessment (Low, Normal, High or Urgent), a decision note, and the office/admin assignment for valid concerns. An assigned office and active assigned admin are required for a valid decision. Office users start work, add updates/evidence, and mark work resolved. Main Admin retains oversight, closure, reopening, publication, categories and priority. Accepted concerns require a responsible office; public visibility requires a reviewed summary. Every decision needs a note. Comments and evidence stay private to the reporter, administrators and assigned office; internal notes are hidden from the reporter too.

## Files

- `server.py`: database schema, account setup, API, authorization, upload handling.
- `index.html` and `src/main.jsx`: React app entry point.
- `src/App.jsx`: session state, API client, role-aware navigation, and app shell.
- `src/components/`: shared UI components, native modal dialog, and React-managed Leaflet campus-plan views.
- `src/pages/Dashboards.jsx`: campus, validator, Main Admin and Responsible Office screens.
- `src/pages/ReportForms.jsx`: submission, review, comments, and evidence forms.
- `src/lib.js`: shared labels, form actions, and evidence helpers.
- `src/styles.css`: responsive visual design.
- `vite.config.js`: build settings and development API proxy.
- `dist/`: compiled React assets served by Python, regenerated by `npm run build` and excluded from Git.
- `tests/test_system.py`: isolated HTTP integration tests for permissions, privacy, verification, workflow, uploads, and revocation.
- `data/iit-voice.sqlite3`: runtime data; created automatically and excluded from Git.

## Source formatting

Keep editable source readable; Vite compresses only generated production assets in `dist/`.
Prettier formats React, JavaScript, CSS, HTML, JSON and Markdown. Ruff formats Python.
Install the development tools once, then use the shared formatting commands:

```sh
npm install
python3 -m pip install -r requirements-dev.txt
npm run format
npm run format:check
```

These commands skip generated builds, dependencies, local data, image assets, and environment files.
They format code without changing application logic.

## Tests

```sh
npm test
npm run build
```

Tests use a temporary database and an ephemeral localhost port; they do not touch normal application data.

Optional browser tests need Playwright and a browser installation:

```sh
npx playwright install chromium
npm run test:browser
```

Alternatively, use an installed Chrome with `IIT_VOICE_BROWSER_CHANNEL=chrome npm run test:browser`. The browser test uses disposable demo data and checks sign-in, role isolation, account/routing screens, submission, validation, resolution, map loading, and mobile overflow. Screenshots are saved in `test-results/` and excluded from Git. The campus plan is bundled locally. Tests use disposable SQLite even when Supabase is configured.

## Configuration

| Setting                     | Purpose                                                           |
| --------------------------- | ----------------------------------------------------------------- |
| `IIT_VOICE_DATA`            | Alternate persistent database directory                           |
| `IIT_VOICE_SECURE_COOKIE=1` | Add the Secure flag to session cookies when serving through HTTPS |
| `--port 8000`               | Local HTTP port                                                   |
| `--host 127.0.0.1`          | Listening interface; localhost by default                         |

## Supabase and Vercel

Supabase Postgres is supported through the server-side `DATABASE_URL` setting. Leave it blank for the existing local SQLite database. The Vercel Python function keeps the existing login, role checks and evidence permissions, and uses the private `iit_voice` database schema. See [Supabase setup](SUPABASE_SETUP.md) for initialization, creating the first cloud Main Admin, Vercel environment variables and deployment verification. Existing local accounts and data are not automatically uploaded.

## University deployment work

This is a runnable pilot, not a completed production university deployment. Before a rollout, replace the standard-library development HTTP server with a supported production server/framework; configure HTTPS, university SSO or an approved affiliation-verification process, password recovery, managed backups, retention rules, and incident monitoring. Confirm emergency routing, actual participating offices, campus map boundaries, accessibility, and handling of sensitive cases with the university. Notifications are in-app only; email/SMS delivery, due-date escalation, and real university-record integration are not implemented.

Evidence has size/type restrictions and remains private, but a production upload pipeline should decode/re-encode images, remove location metadata, and scan files. The local database and its backups must be access-restricted. Audit history is append-only through the API, not tamper-proof against database operators. Account management changes require an explicit confirmation in the interface.

Map rendering uses the existing bundled Leaflet library with a local image overlay and `CRS.Simple`. Building-name lookup still uses the credited local OpenStreetMap snapshot below; it does not load OpenStreetMap tiles.

### Pin location detection

Selecting a report pin fills the location from the bundled OpenStreetMap building outlines. Pins within 25 meters of an outline are labeled “Near …”; unmapped locations use the selected coordinates. The location remains editable for room/floor details, and changing or clearing the pin replaces or clears the location. This is a community map snapshot, not an authoritative university building register.

`src/campus-buildings.json` contains 40 named building outlines retrieved on 2026-10-09 from the [OpenStreetMap API](https://api.openstreetmap.org/api/0.6/map?bbox=124.241,8.239,124.245,8.244). © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), ODbL 1.0. Location detection runs locally; update the snapshot when campus buildings change.

Student reports start at Normal priority. Main Admin sets the reviewed priority.

Report forms include separate optional location details (up to 500 characters), visible only to the reporter and admins. “Use current location” requests browser permission on demand and reports device accuracy; denied/unavailable GPS leaves manual selection available. The selected pin is draggable and recenters into view when moved outside the map. Location details remain intact when the pin changes. Browser tests simulate GPS; real device accuracy depends on the browser/device.

Current-location lookup first requests standard accuracy with a cached position up to one minute old (12-second timeout), then retries precise positioning for 20 seconds on timeout/unavailable errors. Permission denial is not retried. Clicking or dragging a pin cancels pending results so a delayed device location cannot overwrite manual selection. If the browser cannot obtain a position, use a manual pin or open the app in a browser with Location Services enabled.

Admin priority assessment uses four labeled colors: Low (green), Normal (blue), High (gold), and Urgent (red). Validator Admin can assess urgency when submitting validation; Main Admin can adjust it with a recorded decision note. Report lists and review queues default to newest submissions first; their sort control also offers oldest-first and urgent-first (oldest within each priority). Area, category, status and priority filters combine. Priority changes are recorded in activity/audit records and notify the reporter. Main Admin manages priority after validation.

## Photo geotags and Gemini category suggestions

Uploading a photo in a new report checks its EXIF GPS on the server. **Use photo geotag** fills the report pin and campus location; verify the capture location before using it. If GPS metadata is missing or invalid (common with screenshots and shared images), the app does not invent a geotag. Select a pin manually or use current location.

Selecting a photo automatically sends a resized, metadata-free copy to Gemini for content screening and fills the Title and Categories fields with suggestions when a concern is visible. **Check photo again** retries the analysis. The reporter can override it. Unclear or unrelated photos return no category; reports still require admin validation, and AI never sets priority or approves reports. Original evidence remains restricted to the reporter and admins.

Put `GEMINI_API_KEY=your-api-key` in `.env.local` at the project root (see `.env.example`), then restart the server. Python loads this file automatically; existing shell environment variables take precedence. `.env.local` is ignored by Git, and the key must not use a `VITE_` prefix. You can also configure the key directly in the server environment:

```sh
export GEMINI_API_KEY="your-api-key"
# Optional override for a Gemini image-capable model:
export IIT_VOICE_AI_MODEL="gemini-3.5-flash-lite"
npm start
```

Get a key in [Google AI Studio](https://aistudio.google.com/apikey). Check your Gemini project quota and billing before enabling analysis. Requests are limited to 20 analysis attempts per signed-in account per hour. The default model is [Gemini 3.5 Flash-Lite](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite); the integration uses [GenerateContent](https://ai.google.dev/api/generate-content) with image input and a category JSON schema. Without a configured key, photo GPS still works, and evidence is marked **Unverified** for manual review.

Tests use generated images and mocked AI responses; a real Gemini response requires your server API key. Photos must be PNG/JPEG under 2 MB and 20 megapixels for analysis.

AI photo analysis now also suggests an editable report title. Filename, AI title/category/explanation, model and analysis time, EXIF GPS, and the report pin at upload are saved with each attachment and shown only to the reporter and admins. AI results are bound to the signed-in user and exact image bytes by a server-issued token, so changing a photo cannot reuse another photo’s analysis. Unsaved analysis tokens expire after 24 hours; submitted attachment metadata remains with the report. Metadata is saved alongside the original image; the image pixels are not altered or stamped.

Canceling a file picker does not close the report dialog. Escape while the report itself is focused, the close button, and Cancel still close the report normally. Submission is disabled while photo inspection/analysis is in progress.

## Automatic photo screening

Every evidence upload is screened on the server, including uploads made without the browser assistance or without an analysis token. Results are cached for 24 hours per user and exact image bytes; the client cannot forge a clearance. Gemini receives a metadata-free copy automatically when a photo is selected. Its sexually explicit content filter uses `BLOCK_MEDIUM_AND_ABOVE`, and provider safety blocks are treated as rejected attachments.

- **Photo blocked:** explicit sexual content or a provider safety block prevents saving the image. Remove/replace the image to continue; a report can still be submitted without a photo. Rejected image bytes are not saved in the database.
- **Needs manual review:** unclear or unrelated evidence, possible memes or manipulation is flagged with a short reason. The report can proceed, but the attachment thumbnail stays hidden until the reporter or an admin deliberately opens it.
- **No content concern flagged:** plausible campus evidence can be previewed normally. This does not verify the location, authenticity, or truth of the report.
- **Unverified:** missing configuration, quota/rate limits, connection failures or invalid AI output cannot count as clearance. The attachment can be submitted for manual review with its thumbnail hidden. Existing attachments without a screening result receive the same treatment.

Validators see the screening result/reason beside the filename, suggested title/category and location metadata. Photos and analysis remain private to the reporter and admins. AI can make mistakes and cannot reliably prove a photo is original, an event occurred, or that a student intended a prank. Admins still validate reports; screening does not suspend accounts or trigger disciplinary actions. Tests use harmless generated images and mocked safety verdicts, never explicit image fixtures.

## Categories and overlapping concerns

The scope diagram supplies nine categories in three areas:

| Area                    | Categories                                                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Physical & Environment  | Facilities, Infrastructure & Maintenance; Safety, Security & Risk; Environmental, Aesthetics & Landscaping          |
| Digital & Academic      | ICT, Internet & Digital Services; Student Needs & Learning Environment; Academic, Research & Innovation Enterprises |
| Operations & Governance | Administrative, HR & Workplace; Procurement, Property & Finance; Public Information, Policy & Legal                 |

Choose one **Primary category** and expand **Additional categories** to select all that apply. A damaged walkway light can belong to both facilities maintenance and safety. A report spanning different areas appears once under each matching area/category filter, retains one ID, and follows one review and resolution workflow. Totals count unique reports; category chart counts can overlap.

The primary category suggests a lead office; admins still confirm the responsible office. Office defaults are proposed configuration, not an authoritative university directory. Main Admin can correct categories; validators validate, assess urgency and assign concerns. Changes require a decision note and are recorded in activity and the audit log. Gemini suggestions now include multiple applicable categories, with the same screening and human-validation safeguards.

Startup migrates existing Safety / Repair & maintenance / Student needs reports to the corresponding new names and backfills their category lists. Existing report IDs, evidence, status, assigned offices and customized routing are retained. Legacy single-category API submissions still work. API requests accept a primary `category` plus a `categories` array; values are validated and deduplicated, and the primary category is always included.

Lists sort by submission date with report ID as a tie-breaker; updating an old report does not move it above newer submissions. Optional urgent-first sorting retains priority ordering. Category controls wait for ongoing photo analysis so a late AI response cannot overwrite a manual category correction.

## One-click demo accounts

Set `IIT_VOICE_DEMO_LOGIN=1` in `.env.local` and restart Python (or use `python3 -B server.py --demo-login`). The sign-in page shows **Try a demo account** buttons for active, verified sample accounts. Clicking a button starts the normal session for that account without copying credentials. Existing passwords and reports are retained. Student and Faculty still use the campus app; Main Admin and Validator Admin retain their actual permissions.

Demo sign-in defaults to disabled, requires a loopback-bound backend and loopback requests with a localhost host, and must stay disabled on publicly hosted installations. Set `IIT_VOICE_DEMO_LOGIN=0` to remove the buttons and disable the endpoint. Normal credential sign-in remains available. New sample accounts created with `create_account(..., demo=True)` appear automatically; changing an account's role updates its demo button. Registration cannot mark an account as a demo account. The four original seeded sample identities are marked during the schema upgrade.

Photo analysis also drafts the editable **Describe what you observed** field from visible conditions, without inventing a time, location, cause or eyewitness claim. Blank descriptions (or an unchanged prior AI draft) are filled automatically; user edits are preserved on re-analysis. **Use AI description draft** explicitly replaces the current text when desired. The final edited description is submitted normally, while the original AI draft remains private attachment metadata for validators. Failed/blocked/unclear analysis does not invent a description.

AI category analysis evaluates all nine categories independently and selects every supported match. When extra categories are suggested, the additional-category section opens automatically for review. With a single supported category, the form explains that AI found no supported extras; it does not force an overlap. Changing the primary category preserves AI-selected or existing multiple-category tags; a lone manual/default category can be replaced. Reporters can uncheck any additional category manually.

## Responsible Office access and handoff

Main Admin assigns the **Responsible Office** role and selects an office in **Users & access**. Each account belongs to one office. Validators submit **Valid — assign for action** or **Not valid — reject concern**, with a note. A valid decision requires a responsible office and an assigned admin from that office (or a Main Admin). Validators can select Low, Normal, High or Urgent while submitting validation; the choice is recorded in activity and the audit log, shared with the reporter and assigned office, and used in report/map filters. Validators cannot edit categories, publication, work progress, comments or evidence, and cannot revise completed validation. Main Admin manages later urgency changes.

Office dashboards, report lists, maps, report URLs, evidence downloads and notifications are restricted to the account's office and handed-off statuses. Public campus visibility does not expand office access. The office can post comments and screened evidence, start work, and mark it resolved. It cannot validate, change assignments/categories/priority, publish, close or reopen concerns. Main Admin controls final closure, reopening and any reassignment. Moving a report to a new office immediately removes the previous office's report, attachment and notification access. Changing an account's office revokes existing sessions.

Validated reports remain restricted until Main Admin reviews their public title/summary and publishes them. Validation alone never exposes raw descriptions or evidence to campus users. The users-table role constraint is migrated transactionally, preserving account IDs, passwords, sessions and existing report references; no existing accounts are silently promoted.

Local demo mode includes **Physical Plant** and **ICT** office buttons in addition to the original four sample accounts. Existing seeded demo installations receive these two sample office accounts automatically; no report is reassigned or created during that upgrade. Fresh demo seeds use the printed sample password for all six accounts. University office membership and routing defaults remain proposed configuration for verification.

## Completion evidence

Responsible Office and Main Admin cannot mark a concern **Resolved** or **Closed** until a staff member uploads an **After — completed work** photo for the current assignment. The browser disables completion until the upload succeeds, and the API independently enforces the requirement. After-work uploads must pass content screening and a separate concern-specific completion comparison. Unrelated, still-unresolved, inconclusive or unavailable results never count, even when the image is safe campus content. Before photos retain their existing manual-review treatment.

Office actions are explicit: **Start work** changes a validated concern to In progress; **Mark work complete** changes it to Resolved for Main Admin review. **Post update** adds a note without changing status. Starting already-started work is rejected instead of adding duplicate progress events.

After-work uploads cannot reuse any earlier evidence photo for the same report, including when only its filename or GPS/EXIF metadata changes. Previously accepted copies remain visible with a warning but cannot unlock resolution or closure, and do not consume fresh completion-photo slots. Gemini also compares the proposed after photo against the report title, description, categories and screened before photos. It distinguishes supports_completion, unrelated, still_unresolved and unclear. GPS/device metadata, reporter identity fields and location fields are not sent as comparison inputs. A successful comparison supports completion; it does not prove truth or replace Main Admin review.

Original attachments remain **Before — reported condition** photos. Report details show before and current after photos separately for comparison; if the original report had no photo, that absence is shown explicitly. Existing completed reports keep their status, but need an after photo before further resolution/closure decisions. Reopening or changing the responsible office requires fresh completion evidence and preserves earlier after photos in history. The upload limit reserves three original photos and three after photos per work round so original evidence cannot exhaust completion uploads.

Completion comparisons are cached for the exact image, user, report, office, work round, report text/categories and original evidence. Each provider call uses the existing per-account analysis limit. Generic category analysis tokens, client-supplied verdicts, or a clearance from another report cannot bypass the check. Context changes invalidate previous comparisons. The server checks this rule again at upload, resolution and closure.

Previously uploaded after photos remain visible, but cannot count until checked against the current concern. Main Admin and the assigned office can use **Check concern match again** on current-assignment after photos. Unrelated or inconclusive results remain attached with a warning; no existing photos or report statuses are deleted or reset. New unrelated after uploads are rejected before storage.

## Main Admin report summary

The Main Admin overview summarizes authorized reports with submission trends, a current-status chart, category counts, office workload, and a map of report concentration. Submission period (including custom dates), category, office, status, and priority filters apply to all charts, totals, and the matching report lists. Click a category, status, or office in a chart to filter the same selection.

Dates use Asia/Manila and include both boundary dates. Date filters select reports by submission date; status and office show their current values, not historical changes. Multi-category reports contribute to every applicable category but only once to report totals. Nearby map pins are grouped into fixed geographic grid cells, with color and counts showing report volume. Reports without pins remain included in summary totals. Select a concentration circle to open its reports, or switch to individual pins. Charts use the data already returned by the authenticated API; no new chart or mapping dependency is required.
