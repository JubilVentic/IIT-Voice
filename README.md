# IIT Voice

A working campus-reporting pilot for MSU–IIT, with a React interface built by Vite, a Python JSON API, and persistent SQLite storage. The maroon, gold, and white design, Google campus embed, and interactive report pins are preserved. React renders all screens and manages UI state; Python handles authentication, permissions, report workflows, and persistence.

Requirements: Node.js 22.12+ or 24+, npm, and Python 3.9+. The Python backend uses the standard library only. Frontend dependencies are locked in `package-lock.json`.

## Run locally

```sh
npm ci
python3 -B server.py --seed-demo
npm start
```

`npm start` builds the React frontend into `dist/` and starts the Python API at port 8000. If your database already contains accounts, skip `--seed-demo`; your existing accounts, password, reports, and sessions continue to work.

Open **http://127.0.0.1:8000**. Seeding prints a randomly generated password shared by these sample accounts:

| Account | Access |
| --- | --- |
| `admin@iitvoice.local` | Main Admin |
| `validator@iitvoice.local` | Validator Admin |
| `student@iitvoice.local` | Student campus app |
| `faculty@iitvoice.local` | Faculty campus app |

Seeding only works on an empty database. Sample concerns and pins are illustrative and do not represent university records. The password is not stored in source code. If you lose it during a local demonstration, create another Main Admin account using the command below and an unused email.

For an empty installation without demo accounts:

```sh
python3 -B server.py --create-admin your-email@example.edu
npm start
```

The command prompts for name and password. Requests to register through the application always create an unverified campus-member account. A Main Admin must verify affiliation before sign-in is allowed. Email entry is **not** proof of university membership. The current verification mechanism is a manual admin decision; there is no university directory or SSO integration.

## React development

Run the API in one terminal:

```sh
python3 -B server.py
```

Run the React development server in another:

```sh
npm run dev
```

Open **http://127.0.0.1:5173**. Vite proxies `/api` requests to Python on port 8000, keeping cookie-based login and CSRF checks working. JSX and CSS edits update during development. For the combined application at port 8000, run `npm run build` after frontend edits; no Python restart is required for new build assets. Backend changes require a server restart.

## What works

- Cookie-based login, logout, password hashing, login throttling, and CSRF checks.
- Separate student/campus-member, Validator Admin, and Main Admin interfaces, with server-enforced permissions. Faculty and staff are campus members unless explicitly granted an admin role.
- Report submission with category, suggested priority, written location, optional geographic pin, and optional PNG/JPEG evidence.
- A real interactive Leaflet/OpenStreetMap map. Leaflet is bundled with the React app; map tiles still need internet access. The approximate center and example pins need local verification. No authoritative campus geofence is configured.
- The provided Google Maps iframe as the default campus view, with a separate **Report pins** view for IIT Voice concerns. The iframe shows the campus place and supports Google's normal map interaction; report pins and location selection use Leaflet. Google Maps JavaScript API integration would be needed to place application-controlled report markers directly on a Google map.
- Review queue, search, category/status filters, request for information, rejection, duplicate linking, validation, and office routing.
- A separately reviewed public title and campus summary. Unvalidated/rejected/duplicate reports stay restricted. Reporter identity, original title/description, comments, internal notes, and evidence are not exposed to other campus viewers.
- Progress, resolution, closure, and reopening managed by Main Admin.
- Reporter/admin comments, private admin notes, in-app notifications, restricted evidence viewing, and audit records.
- Account verification, role assignment, deactivation, and default office routing managed by Main Admin.

There are exactly **two admin roles**. Students have no admin dashboard. Responsible offices are routing destinations; they do not have separate account roles in this implementation. Main Admin coordinates office work and records progress. Leadership access, if required, must be designed separately rather than assuming it grants administration rights.

## Status workflow

```text
Submitted → Needs information → Validated → In progress → Resolved → Closed
     └─────────────→ Validated
     └─────────────→ Rejected / Duplicate
Resolved / Closed → In progress (reopened)
```

Validator Admin handles initial review only. Main Admin handles both review and subsequent progress. Accepted concerns require a responsible office; public visibility requires a reviewed summary. Every decision needs a note. Comments and evidence stay private to the reporter and admins; internal notes are hidden from the reporter too.

## Files

- `server.py`: database schema, account setup, API, authorization, upload handling.
- `index.html` and `src/main.jsx`: React app entry point.
- `src/App.jsx`: session state, API client, role-aware navigation, and app shell.
- `src/components/`: shared UI components, native modal dialog, and React-managed Leaflet/Google map views.
- `src/pages/Dashboards.jsx`: campus, validator, and Main Admin screens.
- `src/pages/ReportForms.jsx`: submission, review, comments, and evidence forms.
- `src/lib.js`: shared labels, form actions, and evidence helpers.
- `src/styles.css`: responsive visual design.
- `vite.config.js`: build settings and development API proxy.
- `dist/`: compiled React assets served by Python, regenerated by `npm run build` and excluded from Git.
- `tests/test_system.py`: isolated HTTP integration tests for permissions, privacy, verification, workflow, uploads, and revocation.
- `data/iit-voice.sqlite3`: runtime data; created automatically and excluded from Git.

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

Alternatively, use an installed Chrome with `IIT_VOICE_BROWSER_CHANNEL=chrome npm run test:browser`. The browser test uses disposable demo data and checks sign-in, role isolation, account/routing screens, submission, validation, resolution, map loading, and mobile overflow. Screenshots are saved in `test-results/` and excluded from Git. Third-party map resources need internet access for this check.

## Configuration

| Setting | Purpose |
| --- | --- |
| `IIT_VOICE_DATA` | Alternate persistent database directory |
| `IIT_VOICE_SECURE_COOKIE=1` | Add the Secure flag to session cookies when serving through HTTPS |
| `--port 8000` | Local HTTP port |
| `--host 127.0.0.1` | Listening interface; localhost by default |

## University deployment work

This is a runnable pilot, not a completed production university deployment. Before a rollout, replace the standard-library development HTTP server with a supported production server/framework; configure HTTPS, university SSO or an approved affiliation-verification process, password recovery, managed backups, retention rules, and incident monitoring. Confirm emergency routing, actual participating offices, campus map boundaries, accessibility, and handling of sensitive cases with the university. Notifications are in-app only; email/SMS delivery, due-date escalation, and real university-record integration are not implemented.

Evidence has size/type restrictions and remains private, but a production upload pipeline should decode/re-encode images, remove location metadata, and scan files. The local database and its backups must be access-restricted. Audit history is append-only through the API, not tamper-proof against database operators. Account management changes require an explicit confirmation in the interface.

Map implementation references: [Leaflet quick start](https://leafletjs.com/examples/quick-start/) and [OpenStreetMap attribution](https://www.openstreetmap.org/copyright).

### Pin location detection

Selecting a report pin fills the location from the bundled OpenStreetMap building outlines. Pins within 25 meters of an outline are labeled “Near …”; unmapped locations use the selected coordinates. The location remains editable for room/floor details, and changing or clearing the pin replaces or clears the location. This is a community map snapshot, not an authoritative university building register.

`src/campus-buildings.json` contains 40 named building outlines retrieved on 2026-10-09 from the [OpenStreetMap API](https://api.openstreetmap.org/api/0.6/map?bbox=124.241,8.239,124.245,8.244). © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), ODbL 1.0. Location detection runs locally; update the snapshot when campus buildings change.

Student reports start at Normal priority. Validator Admins and Main Admins set the reviewed priority.

Report forms include separate optional location details (up to 500 characters), visible only to the reporter and admins. “Use current location” requests browser permission on demand and reports device accuracy; denied/unavailable GPS leaves manual selection available. The selected pin is draggable and recenters into view when moved outside the map. Location details remain intact when the pin changes. Browser tests simulate GPS; real device accuracy depends on the browser/device.

Current-location lookup first requests standard accuracy with a cached position up to one minute old (12-second timeout), then retries precise positioning for 20 seconds on timeout/unavailable errors. Permission denial is not retried. Clicking or dragging a pin cancels pending results so a delayed device location cannot overwrite manual selection. If the browser cannot obtain a position, use a manual pin or open the app in a browser with Location Services enabled.

Admin priority assessment uses four labeled colors: Low (green), Normal (blue), High (gold), and Urgent (red). Initial validator reviews can assign urgency with a recorded decision note. Review queues sort by urgency, then oldest submission; report lists include a priority filter. Priority changes are recorded in activity/audit records and notify the reporter. Main Admin manages priority after validation.
