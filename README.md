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

## Pricing, plans & billing

All numbers live in `src/lib/plans.ts` (plus env overrides).

- **Paid events:** `PLATFORM_FEE_PERCENT` (default 5) % per ticket, never less than `MIN_TICKET_FEE` (default KES 20), capped at the ticket's own price. It applies after any promo discount. The organiser chooses per event whether buyers pay it on top as a booking fee (`passFeeToBuyer`) or it comes out of their sales. The fee is stored on each order as `platformFee`. Cash box-office sales pay it too, deducted from the next payout. Paid events include 3 Event Space rooms, certificates and exhibitors. Withdrawals are free unless `PAYOUT_FEE_PERCENT` is set.
- **Free tickets on any event:** every KES 0 ticket counts towards the event's plan — tickets on free ticket types and comps issued from Attendees (orders of kind `comp`), on paid events too. The first 300 are included; Plus/Pro raise it to 1,000 / unlimited. Paid tickets are never capped by the plan. This stops one cheap paid ticket type unlocking unlimited free registrations.
- **Free events:** the Free plan is 300 registrations, 1 room and up to 100 people per room. Plus (KES 2,500) and Pro (KES 6,000) are bought per event from **Plan & Gear**, by M-Pesa or card (an `event_plan` order). Moving up from Plus to Pro costs the difference. Limits are enforced at registration, room creation, room join, and certificates/exhibitors.
- **Organiser balance** (`getTenantBalance`) = M-Pesa and card takings − ticket fees − payouts (pending or done, including refunds) − commission owed to promoters. Event-plan purchases are platform revenue and never count towards it.

## Selling features

- **Promo codes** (event → Promo Codes): a fixed KES off per ticket or a % off. A code can cover this event or all events, specific ticket types, a cap on tickets, an end date, and can be tied to a promoter, who is then credited with the sale. Buyers apply codes at checkout. The server re-prices everything (`src/lib/pricing.ts`, `src/lib/checkoutQuote.ts`), so the shown total is the charged total.
- **Card payments (IntaSend):** Visa, Mastercard, Apple Pay and Google Pay through IntaSend's hosted checkout, for tickets and event plans. Buyers return via `/pay/<order>/<key>`; IntaSend refuses redirect URLs with a query string. Set the IntaSend webhook to `{APP_URL}/api/intasend/webhook` with challenge `INTASEND_WEBHOOK_CHALLENGE`. Webhooks are never trusted on their own: the invoice is re-read from IntaSend with the secret key before fulfilling. The reconcile cron also asks IntaSend about pending card orders.
- **Box office** (event → Box Office, admins and gate staff): sells at the tier's **door price** (blank = online price), for cash or M-Pesa STK, and can admit the buyer immediately. Tickets go by SMS, WhatsApp or email, and print as 58 mm receipts via the browser print dialog. A Sunmi V2s's built-in printer works this way. Takings are shown per seller, for counting cash.
- **Re-entry:** set "re-entries per ticket" on the event. At the gate, Exit marks a ticket as outside, and the next Entry counts one re-entry. Scanning in a ticket that's already inside is rejected as a likely copy. Rules are in `src/lib/gate.ts`; every scan is logged in `ScanLog`.
- **Gate scanning / offline:** the check-in page handles keyboard-wedge scanners (Sunmi V2s, USB/Bluetooth), the phone camera and typing, with a big colour result and a beep. "Download list" saves the event's tickets on the device. With no signal it decides locally, queues the scans and syncs them in time order (`/api/events/<id>/scan-sync`), flagging any the server disagrees with.
- **Gate gear rental:** organisers request scanners and scanning staff from Plan & Gear, with an estimate from `RENTAL_DEVICE_PER_DAY` / `RENTAL_STAFF_PER_DAY`. Requests appear under **Platform admin → Gear** and are emailed to `PLATFORM_ALERT_EMAIL`.
- **Refunds:** buyers request a refund from their ticket page (`/lookup`) before the event. The organiser approves (tickets cancelled, seats released, promo use returned) or rejects with a note. Approval queues a B2C payout to the buyer in the normal platform-admin payout queue, labelled "Buyer refund" and deducted from the organiser's balance. The booking fee isn't refunded. The refund's status follows its payout, and a failed one can be retried by the organiser.
- **SMS fallback (Africa's Talking):** with `AT_USERNAME`, `AT_API_KEY` and optionally `AT_SENDER_ID` set, tickets go by SMS (links to `/t/<code>`) when there's no WhatsApp or WhatsApp failed, and always for box-office sales. `AT_USERNAME=sandbox` uses the AT sandbox.

## Promoters

**Dashboard → Promoters.** Each promoter has a tracked link (`/<org>?ref=<code>` or `/<org>/<event>?ref=<code>`) and their own private stats page (`/promoter/<token>`). The `ref` is remembered on the buyer's device for 30 days, last click wins. Commission (a % of the sale, or KES per ticket) is fixed on each order when it's placed.

Commission owed to promoters is held back from the organiser's withdrawable balance. Paying a promoter goes through the same safeguards as the organiser's own payouts: an emailed confirmation code, then platform-admin approval, then M-Pesa B2C to the promoter's number. The promoter receives exactly the commission; the platform fee is added on top and comes out of the organiser's balance.

## WhatsApp

Tickets always go by email, which is the source of truth for ticket ownership and lookup. WhatsApp is an extra channel: tickets, lookup links, Event Space invites, reminders, Lipa Pole Pole updates, feedback requests and certificates. Every send goes through `src/lib/whatsappSender.ts`, which uses one of two providers, chosen by `WHATSAPP_PROVIDER`:

| `WHATSAPP_PROVIDER` | What it is | Where it works |
| --- | --- | --- |
| `baileys` (default) | Unofficial WhatsApp Web link ([Baileys](https://github.com/WhiskeySockets/Baileys)). Connect it in `/platform-admin` → WhatsApp → scan the QR with the sending phone. The login is stored in MongoDB (`WhatsappAuthKey`), so it survives restarts and deploys. | One long-running server process (Render, Railway, a VPS). **Not** Vercel or other serverless hosts, which can't keep the connection open and run several copies at once. |
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

1. **Create the service.** Either **New → Blueprint** with this repo (it reads `render.yaml`: one free web service in Frankfurt, health checks on `/api/health`, random values for every secret), or **New → Web Service** by hand with build command `npm ci && npm run build`, start command `npm start`, and the variables from `render.yaml`. You fill in `DATABASE_URL`, the M-Pesa, Resend and Cloudinary keys, and the platform-admin login.
2. **Plan.** The **free** plan works. The WhatsApp login lives in MongoDB, so no disk is needed. A free instance sleeps after 15 idle minutes; the 5-minute cron jobs below keep it awake (750 free hours a month covers one service running all month), and after any restart the scheduler reconnects WhatsApp by itself. **Starter** never sleeps. Never run more than one instance.
3. **MongoDB Atlas.** Under Network Access, allow Render's outbound IPs (listed on the service's *Connect* tab), or `0.0.0.0/0`.
4. **Public URL.** Leave `NEXT_PUBLIC_APP_URL` empty to use the `onrender.com` address automatically. M-Pesa callbacks, emailed links and QR codes all use it. Once you add a custom domain, set `NEXT_PUBLIC_APP_URL` to it and redeploy (`NEXT_PUBLIC_*` values are baked in at build time).
5. **Cron.** Two jobs, every 5 minutes, each a `POST` with header `Authorization: Bearer <CRON_SECRET>`:
   - `https://<your-url>/api/cron/reconcile`
   - `https://<your-url>/api/cron/scheduled`

   Either use a free scheduler such as [cron-job.org](https://cron-job.org) (it supports custom headers), or add a Render Cron Job running `curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://<your-url>/api/cron/scheduled` (and the same for `reconcile`).
6. **Database.** Run `npx prisma db push` against the production database after schema changes; this repo doesn't use migrations.
7. **M-Pesa payouts (B2C/B2B).** Commit Safaricom's public certificate as `certs/sandbox_cert.cer` or `certs/production_cert.cer`; see `src/lib/mpesaB2C.ts` for the download links. These are public certificates, safe to commit.
8. **WhatsApp.** Open `/platform-admin` → WhatsApp → Connect, and scan the QR code once. The login is saved in MongoDB and survives restarts and deploys. Disconnecting from that tab (or logging the device out on the phone) deletes it.
