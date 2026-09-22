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

You can start editing the page by modifying `pages/index.tsx`. The page auto-updates as you edit the file.

[API routes](https://nextjs.org/docs/pages/building-your-application/routing/api-routes) can be accessed on [http://localhost:3000/api/hello](http://localhost:3000/api/hello). This endpoint can be edited in `pages/api/hello.ts`.

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
