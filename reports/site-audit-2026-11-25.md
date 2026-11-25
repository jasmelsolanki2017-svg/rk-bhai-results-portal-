# Website Technical Audit — 25 November 2026

**Project:** RK Bhai Results Portal  
**Audit ID:** SITE-AUDIT-2026-11-25-01  
**Scope:** Repository source review of Express/MongoDB backend, public frontend, admin frontend, GitHub Pages deployment workflow, and automatic result-sync workflow.  
**Method:** Static code inspection. No credentials were used and no production data was changed.

## Audit limitation

The live GitHub Pages and Render endpoints could not be reached from the audit environment. Render deployment metadata and application logs were inspected: the latest deployment is live and logs show MongoDB connected, but direct HTTP status, real browser rendering, mobile-device behavior, actual backup/restore, and end-to-end login were **not independently verified**. Findings below are based on source review plus deployment logs, not a penetration test.

## Executive summary

- No confirmed critical vulnerability was established in this source and deployment-log review.
- Re-audit on 25 Nov 2026: 10 active findings remain (7 Medium, 3 Low); A-01 and A-02 remain out of the active list as deployed code fixes, with browser retests still pending.
- Render deployment for commit `f323119` is live; service logs show Node started and MongoDB connected. Direct live HTTP/browser checks could not be completed from this audit environment.
- A new operational issue was confirmed: large public snapshot reads return empty content and trigger repeated snapshot rewrites.
- Admin pages are intentionally gated by an admin session before the static frontend is served.
- Passwords are bcrypt-hashed; session cookies are HttpOnly and SameSite=Strict, and Secure in production.
- The admin login has a basic in-memory throttle, but the user login does not have an equivalent throttle.
- Main improvements are needed in session lifetime/revocation, CSRF defence-in-depth, Content Security Policy, rate limiting, health/readiness monitoring, backup handling, and automated tests.
- Public SEO metadata is basic; canonical/social metadata and sitemap/robots files were not found in the files searched.

## Findings

| ID | Priority | Area | Finding | Evidence / impact | Recommended action |
|---|---|---|---|---|---|
| A-03 | Medium | Login protection | Admin login has an in-memory limit of 10 attempts per 15 minutes; user login has no matching throttle. In-memory limits reset on restart and are not shared across multiple instances. | `server.js`: `adminLoginRateLimit` is attached to `/api/admin/login`; `/api/user/login` has no limiter. | Add shared rate limiting for both login routes (MongoDB/Redis-backed if multiple instances), plus progressive delay and monitoring. |
| A-04 | Medium | Browser security | Helmet is enabled, but Content Security Policy is explicitly disabled. | `app.use(helmet({ contentSecurityPolicy: false }))`. | Introduce a tested CSP in report-only mode first; then enforce it after checking inline scripts/styles and required external resources. |
| A-05 | Medium | API resource limits | Global JSON body limit is 25 MB. Some image endpoints accept base64 payloads. No general API request-rate limit was found in the reviewed server setup. | `express.json({ limit: "25mb" })`; popup image validation allows large data URLs. | Set route-specific body limits, compress/store images outside MongoDB where practical, and add API rate limits. |
| A-06 | Medium | Monitoring | `/api/health` returns `{ok:true}` without checking MongoDB readiness. | The API middleware deliberately bypasses `/api/health`; database can be disconnected while this endpoint still reports OK. | Keep a liveness endpoint and add a separate readiness endpoint that checks MongoDB connection state and a lightweight DB operation. |
| A-07 | Medium | Backup / restore | Admin backup export contains user records including password hashes. The route is admin-protected, but downloaded backup files are sensitive. | `GET /api/admin/backup` exports users, cities and results. | Warn on download, protect local copies, encrypt backups at rest, restrict access, and periodically test restore on a non-production database. Never share backup files publicly. |
| A-08 | Medium | Automated testing | `package.json` has only start/dev scripts. The sync workflow syntax-checks two sync scripts, but does not run backend, frontend, API, or integration tests. | `package.json` scripts; `.github/workflows/automatic-result-sync.yml`. | Add unit tests for date/market parsing and result validation, API auth tests, and a deployment smoke test. Include `server.js` and browser scripts in syntax checks. |
| A-09 | Low | SEO | Homepage has title and description, but canonical URL, Open Graph/Twitter metadata, sitemap.xml and robots.txt were not found in the inspected files/search. | `public/index.html` head; repository search for sitemap/robots. | Add canonical/social metadata and a correct sitemap/robots policy if public indexing is intended. Verify with Search Console. |
| A-10 | Low | PWA cache | Service worker caches the app shell. Cache version changes are manual, so a missed version bump can leave some visitors with stale assets. | `public/sw.js` uses a fixed cache name. | Bump cache version on release or generate it during deployment; test update flow on Android Chrome. |
| A-11 | Medium | Public snapshot sync / GitHub load | The public snapshot read through GitHub Contents API returns an empty `content` field for the large `data/public-results.json` file. The sync code then logs `Unexpected end of JSON input` and continues to rewrite the snapshot rather than safely determining whether it changed. Since the Pages workflow runs on every push, repeated writes can trigger unnecessary Pages deployments and repository churn. | `scripts/auto-sync-results.js` lines 962–980; `data/public-results.json` fetch returned empty content; Render logs at 15:18 and 15:19 UTC show compare failures followed by snapshot rewrites (13,615 then 13,616 records). | Read large files via Git blob/raw download or compare a stable hash/metadata before writing; skip writes when content is unchanged. Verify commit/deploy frequency after fix. |
| A-12 | Low | Result-sync diagnostics | Several comments/status messages say two independent domains are sufficient, while `buildConsensus()` actually requires three independent domains. The AI host comment says `kingsofsatta.com`, while `AI_ALLOWED_HOSTS` currently enables `1xsatta.today`. This makes the documented behavior misleading even though the actual code path is explicit. | `scripts/auto-sync-results.js`: `AI_ALLOWED_HOSTS`, `buildConsensus()` threshold `>= 3`, and summary/log text near the publish step. | Align comments and status messages with the actual configured AI host and three-domain consensus rule; confirm intended AI source before changing the allowlist. |

## Positive controls observed

- Admin page routes are checked for a valid admin session before static files are served.
- Password hashes use bcrypt.
- Session cookies are HttpOnly and SameSite=Strict; Secure is enabled in production.
- Helmet security headers are enabled, although CSP is disabled.
- Admin login has a basic 10-attempt / 15-minute in-memory throttle.
- User passwords must be changed on first login and new passwords have a minimum length check.
- Public CSV export neutralizes spreadsheet formula-leading characters.
- Public result API filters to published, non-deleted records and approved city records.
- GitHub Pages deployment copies public-facing files rather than the Admin Panel files.

## Not verified in this audit

- Production HTTP status and response headers.
- Real browser console errors and broken links.
- Android/mobile layout and PWA install/update behavior.
- Admin/user login, session expiry and logout in a live browser.
- MongoDB backup download and restore on a test database.
- GitHub Pages and Render deployment success/availability.
- Live automatic sync accuracy, source freshness and AI/parser agreement.
- Search Console indexing and Core Web Vitals.

## Fix order

1. A-01: **code deployed**; complete live expiry/revocation browser tests.
2. A-02: **code deployed**; complete same-origin/cross-origin CSRF browser tests.
3. A-03: rate-limit user login and make throttling durable.
4. A-04: introduce a tested Content Security Policy.
5. A-06: add a real database readiness check.
6. A-07: formalize encrypted backups and restore testing.
7. A-08: add automated tests and deployment smoke checks.
8. A-05, A-09, A-10: API resource controls, SEO metadata, and PWA cache versioning.

## Implemented code fixes (removed from active findings)

The following two items have been removed from the active findings list because their code changes are deployed on Render. This is a code-deployment status, not a claim that browser-level verification has passed:

- **A-01 — Admin session:** 12-hour JWT/cookie lifetime, MongoDB sessionVersion validation and logout revocation. Commits `f39810a`, `194eb9a`. Existing admins may need to sign in again. Browser verification of expiry and revocation is still outstanding.
- **A-02 — CSRF Origin validation:** authenticated cookie-based write requests require same-origin Origin/Referer. Commit `5e15f82`. Same-origin success and cross-origin rejection still need browser verification; requests without session cookies are outside this middleware.

## Re-audit update — 25 Nov 2026, 21:00 IST

- Latest Render deploy for commit `f3231194798210d7c2903292c8581e7886cb5f04` is **Live**. Startup logs confirm `RK portal running on 10000` and `MongoDB connected`.
- The Admin result-share message time removal is included in that live commit; code now builds the message with `Date :` only.
- Render logs show two failed public-snapshot comparisons (`Unexpected end of JSON input`) followed by rewrites of 13,615 and 13,616 records. The repository fetch of `data/public-results.json` returned an empty content field, consistent with the large-file Contents API limitation.
- The Pages workflow triggers on every push (no `paths` filter), so repeated snapshot commits can also cause avoidable Pages deployments.
- The source-sync parser's actual consensus threshold is three independent domains. Some log strings/comments still incorrectly say two; the AI allowlist is `1xsatta.today` while a nearby comment says `kingsofsatta.com`.
- A-01/A-02 remain recorded under implemented fixes, not active findings. Browser verification is still pending.

## Fix tracking (updated 25 Nov 2026)

| Finding | Code change | Deployment / verification status |
|---|---|---|

## Re-audit log

| Date | Audit ID | Result | Notes |
|---|---|---|---|
| 25 Nov 2026 | SITE-AUDIT-2026-11-25-01 | Baseline created | Static source audit; live checks pending. |
| 25 Nov 2026, 21:00 IST | SITE-AUDIT-2026-11-25-02 | Re-audit completed | Reviewed current `main` source, Render deploy metadata/logs and sync/Pages workflows. Added A-11 snapshot rewrite/GitHub churn and A-12 misleading sync diagnostics. Direct browser/HTTP checks remain unavailable. |

**How to use next time:** Open Admin Panel → Admin Menu → Website Audit. Compare each finding ID with the current code and update its status (Open / Fixed / Retest needed). Do not mark a finding Fixed until the changed code and relevant live test both pass.
