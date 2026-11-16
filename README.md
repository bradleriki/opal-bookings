# Opal Carindale site bookings

BADGE · Opal Carindale RACF · Crane & Delivery Bookings. A web app for booking the tower crane, loading zone,
materials hoist, concrete boom pump and mobile crane, for anyone on site — no Claude or BADGE login needed.

- **App:** one Cloudflare Worker. `public/` is the app people use (installable on a phone); `src/worker.js` is the API.
- **Database:** Cloudflare D1 (`migrations/`). Double-booking is blocked by the database itself (one row per resource per half-hour).
- **Sign-in:** 6-digit email codes, no passwords. New companies are approved once by the site team.
- **Email:** sent through [Resend](https://resend.com) from a domain you own.
- **Site rules:** `public/js/rules.js` — zones, load chart, shutdowns, public holidays, starting programme (Rev 5f1 IS). Shared by the app and the server.

## Run it locally

```bash
npm install
npm run db:migrate:local
npx wrangler dev
```

`.dev.vars` (not committed) turns on dev mode: codes are printed in the browser console instead of emailed.
Example:

```
DEV_MODE=1
ADMIN_EMAILS=you@example.com
APP_URL=http://localhost:8787
```

Tests: `npm test` (site rules) and, with `wrangler dev` running, `npm run test:api` (end-to-end API).

## First deploy

1. `npx wrangler login` (or set `CLOUDFLARE_API_TOKEN`).
2. `npx wrangler d1 create opal-bookings` and paste the `database_id` into `wrangler.jsonc`.
3. Set the site team: `npx wrangler secret put ADMIN_EMAILS` (comma-separated emails). In `wrangler.jsonc` `vars`: set `MAIL_FROM`
   (e.g. `Opal Carindale bookings <bookings@yourdomain.com.au>`) and, after the first deploy, `APP_URL`.
4. `npx wrangler secret put RESEND_API_KEY`
5. `npm run deploy` — applies the database schema and deploys. The app is then at
   `https://opal-bookings.<your-subdomain>.workers.dev`.

### Email domain (needed for sign-in codes)

1. Buy a domain in the Cloudflare dashboard (Domain Registration).
2. Create a free Resend account, add the domain, and add the DNS records Resend shows (in Cloudflare DNS).
3. Create a Resend API key with sending access and save it with `wrangler secret put RESEND_API_KEY`.

## Automatic deploys

`.github/workflows/deploy.yml` tests every push and deploys `main`. Add repository secrets
`CLOUDFLARE_API_TOKEN` (permissions: Workers Scripts edit, D1 edit) and `CLOUDFLARE_ACCOUNT_ID`.

## Site team

The first admins are the emails in the `ADMIN_EMAILS` Worker secret. In the app, **Site team** lets you approve companies,
make other people site team, switch people off or delete their details, change pour/crane/hoist dates and
the booking cut-off, and export bookings to CSV.
