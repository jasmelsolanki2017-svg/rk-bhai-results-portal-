# RK Bhai Results & Archive

A separate, mobile-first Node.js + Express + MongoDB application for admin-published informational results and historical records.

## Included
- Black/gold responsive public results page
- Public read-only published results
- Admin-only login and record management API
- Password hash stored in environment variables (no default credentials)
- HttpOnly, SameSite cookie session
- Helmet security headers and input size limit

## Not included
No betting, wagers, deposits, payments, predictions, number-selection tools, winnings or user-submitted betting picks.

## Run locally
1. Install Node.js 20+.
2. Copy .env.example to .env.
3. Create a MongoDB database and set MONGODB_URI.
4. Generate a bcrypt hash: node -e "console.log(require('bcryptjs').hashSync('YOUR_STRONG_PASSWORD', 12))"
5. Set ADMIN_USERNAME, ADMIN_PASSWORD_HASH, and a long random JWT_SECRET.
6. Run npm install then npm start.
7. Open http://localhost:3000.

## Admin API
Login: POST /api/admin/login with JSON username and password.
After login: GET /api/admin/results, POST /api/admin/results, PATCH /api/admin/results/:id, DELETE /api/admin/results/:id, POST /api/admin/logout.
Public endpoint: GET /api/results.

## Deployment
Deploy as a Node web service and set environment variables in the host dashboard. Use a managed MongoDB database. Never commit .env or real credentials.

## Before public launch
Add CSRF protection for cookie-authenticated admin write routes, rate limiting for login, audit logging, backups, and test deployment configuration. Review applicable local laws and platform terms before publishing.
