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
| `OTP_SECRET` | Hashing emailed confirmation codes (optional, falls back to `JWT_SECRET`) |
| `MPESA_CALLBACK_SECRET` | Appended to every Daraja callback URL; callbacks without it are rejected |
| `CRON_SECRET` | Authorises `/api/cron/reconcile` |
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

## Event Space (live attendee companion)

Each event can have one Event Space, managed from **Dashboard → Event → Event Space**. Attendees join by scanning its QR code (or opening `/space/<CODE>`). They don't need an account: anyone with the link can join, since the organiser controls who's in the room. Inside they get live polls (multiple choice, or open answers shown as a ranked word cloud), Q&A with upvotes and optional moderation, shared documents with a "follow the presenter" mode, and announcements. `/space/<CODE>/screen` is the projector view, and the dashboard controls what it shows.

- **Invites:** ticket holders get the link by email (and WhatsApp, if they gave a number) 1 hour before the event starts (`INVITE_LEAD_MS` in `src/lib/spaceInvites.ts`). If the space is created later than that, they go out immediately. People who buy a ticket after that also get the link with their ticket. Add this cron line alongside the reconcile job:
  ```
  */5 * * * * curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://<your-domain>/api/cron/space-invites
  ```
- **Documents:** PDFs are uploaded to Cloudinary and shown page by page as images, which works on any plan. Free plans block downloading the original PDF (it returns 401), so the "Open the original file" link is hidden for PDFs. To offer downloads, enable *Cloudinary Settings → Security → "Allow delivery of PDF and ZIP files"* and set `NEXT_PUBLIC_ALLOW_PDF_DOWNLOAD=true`.
- **Live updates** use polling every 3s with a version check plus an in-memory cache (`src/lib/eventSpace.ts`), and assume the same single `next start` process as WhatsApp and rate limiting.
- After pulling this change, run `npx prisma db push` to create the new collections' indexes (the unique indexes are what stop double voting).

## WhatsApp ticket delivery (optional, unofficial)

Tickets are always sent by email — that's the source of truth for ticket ownership and lookup. If a buyer also gives a WhatsApp number at checkout (or at `/lookup`), the same tickets/link are additionally sent via an unofficial WhatsApp Web connection ([Baileys](https://github.com/WhiskeySockets/Baileys)), since it doesn't require Meta Business API approval. This is a bonus channel only:

- Connect it from `/platform-admin` → the "WhatsApp" tab → scan the QR code with the phone that should send tickets, the same way you'd link WhatsApp Web.
- It's one number for the whole platform (like the M-Pesa shortcode), and only works reliably as a single `next start` process — it won't survive being deployed across multiple serverless instances.
- Because it's unofficial, WhatsApp can disconnect the number at any time without warning. The app auto-reconnects on drops and on server restart where possible, but a real logout needs a human to re-scan.
- Once you get your Meta Business API approval, swap `src/lib/whatsapp.ts`'s `sendTicketWhatsapp`/`sendWhatsappText` for calls to the official Cloud API — every call site (checkout, lookup) is already isolated behind those two functions.

You can start editing the page by modifying `pages/index.tsx`. The page auto-updates as you edit the file.

The `pages/api` directory is mapped to `/api/*`. Files in this directory are treated as [API routes](https://nextjs.org/docs/pages/building-your-application/routing/api-routes) instead of React pages.

This project uses [`next/font`](https://nextjs.org/docs/pages/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn-pages-router) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/pages/building-your-application/deploying) for more details.
