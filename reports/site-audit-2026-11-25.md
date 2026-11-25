# Website Technical Audit — 25 November 2026

**Project:** RK Bhai Results Portal  
**Audit ID:** SITE-AUDIT-2026-11-25-01  
**Scope:** Repository source review of Express/MongoDB backend, public frontend, admin frontend, GitHub Pages deployment workflow, and automatic result-sync workflow.  
**Method:** Static code inspection. No credentials were used and no production data was changed.

## Audit limitation

The live GitHub Pages and Render endpoints could not be reached from the audit environment. Therefore HTTP status, real browser rendering, mobile-device behavior, MongoDB connectivity, actual backup/restore, and end-to-end login were **not independently verified**. Findings below are based on the checked source code, not a penetration test.

## Executive summary

- No confirmed critical vulnerability was established in this source-only review.
- Admin pages are intentionally gated by an admin session before the static frontend is served.
- Passwords are bcrypt-hashed; session cookies are HttpOnly and SameSite=Strict, and Secure in production.
- The admin login has a basic in-memory throttle, but the user login does not have an equivalent throttle.
- Main improvements are needed in session lifetime/revocation, CSRF defence-in-depth, Content Security Policy, rate limiting, health/readiness monitoring, backup handling, and automated tests.
- Public SEO metadata is basic; canonical/social metadata and sitemap/robots files were not found in the files searched.

## Findings

| ID | Priority | Area | Finding | Evidence / impact | Recommended action |
|---|---|---|---|---|---|
| A-01 | High | Admin session | **Code fix applied; live retest pending.** Admin JWT/cookie lifetime is now 12 hours; MongoDB-backed sessionVersion is checked on admin requests and incremented at logout to revoke prior admin tokens. | Commits `f39810a` and `194eb9a` in `server.js`. Existing admins must log in again after deployment; logout revokes all admin sessions sharing the global version. | Verify login, 12-hour expiry, logout revocation and protected-page/API behavior in a live browser. |
| A-02 | Medium | CSRF | **Origin validation code added; deployment and live retest pending.** Authenticated cookie-based POST/PUT/PATCH/DELETE requests now require Origin or Referer to match the service's own origin; missing, malformed or cross-origin values are rejected. SameSite=Strict remains enabled. | Commit `5e15f82`, `server.js` middleware after cookie parsing. Requests without an admin/user session cookie are not covered by this middleware; this is not a CSRF-token implementation. | Render deployment is live (commit `5e15f82`). Browser verification is still pending: test valid same-origin admin/user writes and rejection of cross-origin/missing-Origin writes for relevant routes. Check any legitimate cross-origin admin workflow before closing. |
| A-03 | Medium | Login protection | Admin login has an in-memory limit of 10 attempts per 15 minutes; user login has no matching throttle. In-memory limits reset on restart and are not shared across multiple instances. | `server.js`: `adminLoginRateLimit` is attached to `/api/admin/login`; `/api/user/login` has no limiter. | Add shared rate limiting for both login routes (MongoDB/Redis-backed if multiple instances), plus progressive delay and monitoring. |
| A-04 | Medium | Browser security | Helmet is enabled, but Content Security Policy is explicitly disabled. | `app.use(helmet({ contentSecurityPolicy: false }))`. | Introduce a tested CSP in report-only mode first; then enforce it after checking inline scripts/styles and required external resources. |
| A-05 | Medium | API resource limits | Global JSON body limit is 25 MB. Some image endpoints accept base64 payloads. No general API request-rate limit was found in the reviewed server setup. | `express.json({ limit: "25mb" })`; popup image validation allows large data URLs. | Set route-specific body limits, compress/store images outside MongoDB where practical, and add API rate limits. |
| A-06 | Medium | Monitoring | `/api/health` returns `{ok:true}` without checking MongoDB readiness. | The API middleware deliberately bypasses `/api/health`; database can be disconnected while this endpoint still reports OK. | Keep a liveness endpoint and add a separate readiness endpoint that checks MongoDB connection state and a lightweight DB operation. |
| A-07 | Medium | Backup / restore | Admin backup export contains user records including password hashes. The route is admin-protected, but downloaded backup files are sensitive. | `GET /api/admin/backup` exports users, cities and results. | Warn on download, protect local copies, encrypt backups at rest, restrict access, and periodically test restore on a non-production database. Never share backup files publicly. |
| A-08 | Medium | Automated testing | `package.json` has only start/dev scripts. The sync workflow syntax-checks two sync scripts, but does not run backend, frontend, API, or integration tests. | `package.json` scripts; `.github/workflows/automatic-result-sync.yml`. | Add unit tests for date/market parsing and result validation, API auth tests, and a deployment smoke test. Include `server.js` and browser scripts in syntax checks. |
| A-09 | Low | SEO | Homepage has title and description, but canonical URL, Open Graph/Twitter metadata, sitemap.xml and robots.txt were not found in the inspected files/search. | `public/index.html` head; repository search for sitemap/robots. | Add canonical/social metadata and a correct sitemap/robots policy if public indexing is intended. Verify with Search Console. |
| A-10 | Low | PWA cache | Service worker caches the app shell. Cache version changes are manual, so a missed version bump can leave some visitors with stale assets. | `public/sw.js` uses a fixed cache name. | Bump cache version on release or generate it during deployment; test update flow on Android Chrome. |

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

## Fix tracking (updated 25 Nov 2026)

| Finding | Code change | Deployment / verification status |
|---|---|---|
| A-01 | 12-hour admin JWT/cookie; MongoDB session-version validation and logout revocation. Commits `f39810a`, `194eb9a`. | Render deployment for `194eb9a` is live. Live browser expiry/revocation tests remain pending. |
| A-02 | Same-origin Origin/Referer validation for authenticated cookie-based write requests. Commit `5e15f82`. | Render deployment for `5e15f82` is live. Do not mark closed until positive/negative browser tests pass. |

## Re-audit log

| Date | Audit ID | Result | Notes |
|---|---|---|---|
| 25 Nov 2026 | SITE-AUDIT-2026-11-25-01 | Baseline created | Static source audit; live checks pending. |

**How to use next time:** Open Admin Panel → Admin Menu → Website Audit. Compare each finding ID with the current code and update its status (Open / Fixed / Retest needed). Do not mark a finding Fixed until the changed code and relevant live test both pass.
