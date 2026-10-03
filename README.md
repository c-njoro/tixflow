This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/pages/api-reference/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Payments & Payouts (Kenya / Daraja)

All buyer payments go through M-Pesa STK Push (Daraja) into your one platform shortcode — configured via `MPESA_*` env vars. Tenants request payouts to their own M-Pesa or bank (via the bank's M-Pesa paybill); a platform admin reviews and approves each request from `/platform-admin`, which triggers the actual Daraja B2C (M-Pesa) or B2B (bank) transfer.

Before payouts work end-to-end you'll need to:
- Set `MPESA_B2C_INITIATOR_NAME` and `MPESA_B2C_INITIATOR_PASSWORD` (used for both B2C and B2B) in `.env`.
- Place Safaricom's public certificate at `certs/sandbox_cert.cer` (or `certs/production_cert.cer`) — see `src/lib/mpesaB2C.ts` for the download links.
- Set `PLATFORM_FEE_PERCENT` to whatever cut the platform takes per withdrawal (default `3`, i.e. 3%) — this one value controls every future payout's fee.
- Set `NEXT_PUBLIC_APP_URL` to a publicly reachable URL (e.g. via ngrok in development) so Safaricom's STK, B2C, and B2B callbacks can reach `/api/mpesa/*`.
- `MPESA_B2C_RESULT_URL` / `MPESA_B2B_RESULT_URL` (and the `_TIMEOUT_URL` pair) are now optional — they default to `${NEXT_PUBLIC_APP_URL}/api/mpesa/b2c-result` / `b2b-result`.

### Required secrets

In production the app refuses to run a route that needs a missing secret (there are no hardcoded fallbacks any more). Generate each with `openssl rand -base64 32`:

| Variable | Used for |
| --- | --- |
| `JWT_SECRET` | Tenant login sessions (also the fallback for the two below) |
| `PLATFORM_ADMIN_JWT_SECRET` | Platform-admin sessions — separate on purpose, no fallback |
| `TICKET_LOOKUP_JWT_SECRET` | "Find my tickets" magic links (optional, falls back to `JWT_SECRET`) |
| `LINK_SIGNING_SECRET` | Personal feedback-survey and certificate links (optional, falls back to `JWT_SECRET`) |
| `OTP_SECRET` | Hashing emailed confirmation codes (optional, falls back to `JWT_SECRET`) |
| `MPESA_CALLBACK_SECRET` | Appended to every Daraja callback URL; callbacks without it are rejected |
| `CRON_SECRET` | Authorises `/api/cron/reconcile` and `/api/cron/scheduled` |
| `PLATFORM_ADMIN_USERNAME` / `PLATFORM_ADMIN_PASSWORD` | Platform-admin login |

### Reconcile job

Daraja callbacks aren't guaranteed to arrive. `/api/cron/reconcile` asks Safaricom directly about any order still pending after ~45s (issuing tickets or failing it), expires orders that never resolve, and logs payouts stuck in `processing` for 30+ minutes. Run it every few minutes:

```
*/5 * * * * curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://<your-domain>/api/cron/reconcile
```

A buyer's checkout page also triggers the same check for their own order while it's waiting.

Payouts stuck in `processing` show up under "In progress" on `/platform-admin`. Check the M-Pesa portal, then mark each one Completed (with the transaction code) or Failed (returns the amount to the tenant's balance).

### Rate limiting

Login, platform-admin login, STK push, OTP and ticket-lookup endpoints are rate-limited in memory (`src/lib/rateLimit.ts`), which assumes the same single `next start` process as WhatsApp. If you run behind a reverse proxy, make sure it sets `X-Forwarded-For` itself rather than passing through a client-supplied one.

### Scheduled jobs

`/api/cron/scheduled` runs every time-based job other than payment reconciliation: Event Space invites, event reminders, Lipa Pole Pole reminders and expiry, and post-event feedback surveys. Run it every few minutes next to the reconcile job:

```
*/5 * * * * curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://<your-domain>/api/cron/scheduled
```

(`/api/cron/space-invites` is an alias for the same job.) Each run first backfills new schema defaults onto older documents, once per server start (`src/lib/backfillDefaults.ts`), because MongoDB `where` filters don't match fields that were never stored. Messages go out spaced apart, so the unofficial WhatsApp number isn't flagged for bulk sending.

After pulling schema changes, run `npx prisma db push` to create new collections and indexes. If API routes return 404 in `npm run dev` after routes have been renamed, delete `.next/dev` and restart: the dev server can keep a stale route cache.

## Event features

Every event's dashboard page has a tools grid linking to the following.

- **Event Space** (live attendee companion), one or more rooms per event. Attendees join a room by scanning its QR code (or opening `/space/<CODE>`); no account is needed. Each room has live polls (multiple choice, or open answers shown as a ranked word cloud), Q&A with upvotes and optional moderation, shared documents with a "follow the presenter" mode, and announcements. `/space/<CODE>/screen` is the projector view, controlled from the dashboard. Ticket holders get one email/WhatsApp message listing every room, 1 hour before the event (`INVITE_LEAD_MS` in `src/lib/spaceInvites.ts`). If the room is created after that, it goes out right away; later buyers get it with their ticket.
  - PDFs are uploaded to Cloudinary and shown page by page as images, which works on any plan. Free plans block downloading the original PDF, so that link is hidden for PDFs unless you enable *Cloudinary Settings → Security → "Allow delivery of PDF and ZIP files"* and set `NEXT_PUBLIC_ALLOW_PDF_DOWNLOAD=true`.
  - Live updates poll every 3s with a version check plus an in-memory cache (`src/lib/eventSpace.ts`). Like WhatsApp and rate limiting, this assumes a single `next start` process.
- **Reminders:** email and WhatsApp to ticket holders the day before and about 2 hours before, with a Google Maps link. Toggle per event on the event page.
- **Gate:** live check-ins, arrivals per 5 minutes, progress per ticket type, scans per staff member, and the latest admissions.
- **Lipa Pole Pole:** the organiser sets a minimum deposit % and a deadline (days before the event). The buyer's deposit reserves their seats, they top up from their personal plan page (`/plan/<id>?key=…`), and tickets are issued once it's fully paid. Reminders go out 7, 3 and 1 day before the deadline. Unpaid plans expire at the deadline and release their seats. The organiser can extend or reopen a plan (if the seats are still free) or cancel it. Money already paid stays in the balance; settle refunds with the buyer directly.
- **Feedback:** a survey (ratings, choices, free text) sent automatically N hours after the event ends to scanned-in attendees, or sent on demand. Each person gets their own signed link and can answer once. Answers are stored without names.
- **Certificates:** a printable A4 certificate of attendance for every scanned-in ticket (`/certificate/<code>?t=…`, "Save as PDF" from the browser). The attendee can set the name it shows. Sent from the Certificates page, or automatically with the feedback survey.
- **Exhibitors:** sponsors get a private portal link (`/exhibitor/<token>`) to scan attendees' ticket QR codes at their stand, add notes and a hot/warm/cold rating, and export leads to CSV. Leads contain name and email only, never phone numbers.

## Promoters

**Dashboard → Promoters.** Each promoter has a tracked link (`/<org>?ref=<code>` or `/<org>/<event>?ref=<code>`) and their own private stats page (`/promoter/<token>`). The `ref` is remembered on the buyer's device for 30 days, last click wins. Commission (a % of the sale, or KES per ticket) is fixed on each order when it's placed.

Commission owed to promoters is held back from the organiser's withdrawable balance. Paying a promoter goes through the same safeguards as the organiser's own payouts: an emailed confirmation code, then platform-admin approval, then M-Pesa B2C to the promoter's number. The promoter receives exactly the commission; the platform fee is added on top and comes out of the organiser's balance.

## WhatsApp

Tickets always go by email, which is the source of truth for ticket ownership and lookup. WhatsApp is an extra channel: tickets, lookup links, Event Space invites, reminders, Lipa Pole Pole updates, feedback requests and certificates. Every send goes through `src/lib/whatsappSender.ts`, which uses one of two providers, chosen by `WHATSAPP_PROVIDER`:

| `WHATSAPP_PROVIDER` | What it is | Where it works |
| --- | --- | --- |
| `baileys` (default) | Unofficial WhatsApp Web link ([Baileys](https://github.com/WhiskeySockets/Baileys)). Connect it in `/platform-admin` → WhatsApp → scan the QR with the sending phone. | One long-running server with a writable disk (Render, Railway, a VPS). **Not** Vercel or other serverless hosts. |
| `cloud` | Meta's official WhatsApp Cloud API with pre-approved templates. | Anywhere, serverless included. |

Baileys is unofficial: WhatsApp can disconnect or ban the number without warning. The app reconnects after drops and restarts, but a real logout needs someone to re-scan the QR code.

### Moving to the official Meta Cloud API

The code is already in place; switching is configuration only. Every message has a template defined in `src/lib/whatsappTemplates.json`, eight in all, every one in the UTILITY category.

1. In [Meta for Developers](https://developers.facebook.com/), create an app (type Business), add the **WhatsApp** product, and connect your WhatsApp Business Account and phone number.
2. In Business Settings → System Users, create a system user, give it the app and your WhatsApp account, and generate a **permanent token** with the `whatsapp_business_messaging` and `whatsapp_business_management` permissions.
3. Note the ids: the **Phone number ID** and **WhatsApp Business Account ID** (WhatsApp → API Setup) and the **App ID** (app dashboard).
4. Submit the templates for approval: put `WHATSAPP_CLOUD_TOKEN`, `WHATSAPP_BUSINESS_ACCOUNT_ID` and `META_APP_ID` in your local `.env` and run:
   ```
   node scripts/create-whatsapp-templates.mjs --dry-run   # preview
   node scripts/create-whatsapp-templates.mjs             # submit
   node scripts/create-whatsapp-templates.mjs --status    # wait until all say APPROVED
   ```
5. On the server, set `WHATSAPP_CLOUD_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` and `WHATSAPP_PROVIDER=cloud`, then redeploy. The platform-admin WhatsApp tab shows "Cloud API".

Notes:
- **Ticket template:** its header image is the ticket's QR code, which Meta fetches from `<your URL>/api/tickets/qr/<code>`. The app must be reachable on a public HTTPS URL.
- **Changing wording:** edit `whatsappTemplates.json` (positional `{{1}}`… placeholders, never the first or last thing in the body) and the matching builder in `whatsappTemplates.ts`, then submit again. A send fails loudly if its parameter count doesn't match the template.
- **Optional settings:** `WHATSAPP_TEMPLATE_LANGUAGE` (default `en`) must match the language the templates were approved in. `WHATSAPP_GRAPH_VERSION` defaults to `v23.0`.
- **Pricing:** Meta charges per template message; utility templates are the cheapest category.

## Deploying on Render

The app needs one long-running Node server. That's why it doesn't fully work on Vercel: Baileys can't run there, and background sends and the in-memory caches assume a single process. Render runs it as a normal server and gives you a public URL (`https://<name>.onrender.com`) for both the website and the API.

1. **Blueprint.** Push this repo to GitHub, then in Render choose **New → Blueprint** and pick the repo. Render reads `render.yaml`: one Starter web service in Frankfurt, a 1 GB disk at `/var/data` for the WhatsApp login, health checks on `/api/health`, and random values generated for every secret. You'll be asked for the rest: `DATABASE_URL`, the M-Pesa, Resend and Cloudinary keys, and the platform-admin login.
2. **Plan.** Use **Starter or higher**. The free plan sleeps after 15 idle minutes (dropping the WhatsApp connection and missing cron runs) and can't have a disk (so the QR code needs re-scanning after every deploy).
3. **MongoDB Atlas.** Under Network Access, allow Render's outbound IPs (listed on the service's *Connect* tab), or `0.0.0.0/0`.
4. **Public URL.** Leave `NEXT_PUBLIC_APP_URL` empty to use the `onrender.com` address automatically. M-Pesa callbacks, emailed links and QR codes all use it. Once you add a custom domain, set `NEXT_PUBLIC_APP_URL` to it and redeploy (`NEXT_PUBLIC_*` values are baked in at build time).
5. **Cron.** Two jobs, every 5 minutes, each a `POST` with header `Authorization: Bearer <CRON_SECRET>`:
   - `https://<your-url>/api/cron/reconcile`
   - `https://<your-url>/api/cron/scheduled`

   Either use a free scheduler such as [cron-job.org](https://cron-job.org) (it supports custom headers), or add a Render Cron Job running `curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://<your-url>/api/cron/scheduled` (and the same for `reconcile`).
6. **Database.** Run `npx prisma db push` against the production database after schema changes; this repo doesn't use migrations.
7. **M-Pesa payouts (B2C/B2B).** Commit Safaricom's public certificate as `certs/sandbox_cert.cer` or `certs/production_cert.cer`; see `src/lib/mpesaB2C.ts` for the download links. These are public certificates, safe to commit.
8. **WhatsApp.** Open `/platform-admin` → WhatsApp → Connect, and scan the QR code once. The login is saved to the disk and survives deploys.

Render doesn't do zero-downtime deploys for a service with a disk: expect a few seconds of downtime per deploy. That's the trade-off for the single-process design.
