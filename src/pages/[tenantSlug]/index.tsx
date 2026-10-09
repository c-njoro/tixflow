// pages/[tenantSlug]/index.tsx
import { useEffect } from "react";
import { GetServerSideProps } from "next";
import Link from "next/link";
import Head from "next/head";
import { Wordmark } from "@/components/dashboard/Sidebar";
import { getTenantStorefront } from "@/lib/publicQueries";
import { captureRef } from "@/lib/referral";
import { formatDateTime } from '@/lib/format';

interface StorefrontEvent {
  slug: string;
  title: string;
  date: string;
  location: string;
  coverImageUrl: string | null;
  category: string | null;
}

interface Props {
  tenant: {
    businessName: string;
    slug: string;
    logoUrl: string | null;
    events: StorefrontEvent[];
  };
}

// pages/[tenantSlug]/index.tsx
export default function TenantStorefrontPage({ tenant }: Props) {
  // A promoter's storefront link (?ref=code) credits whichever event they buy.
  useEffect(() => captureRef(tenant.slug), [tenant.slug]);

  return (
    <div className="min-h-screen bg-ink text-white">
      <Head>
        <title>{`${tenant.businessName} — events on Tixflow`}</title>
      </Head>
      <header className="border-b border-slate-800/60">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <Link href="/" aria-label="Tixflow home">
            <Wordmark />
          </Link>
          <Link href="/lookup" className="px-3 h-9 inline-flex items-center rounded-lg text-sm text-slate-300 hover:text-white hover:bg-slate-800/40 transition-colors">
            My tickets
          </Link>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 pt-12 pb-24">
        <div className="flex items-center gap-5">
          {tenant.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={tenant.logoUrl} alt="" className="h-16 w-16 rounded-2xl object-cover ring-1 ring-slate-700/60" />
          ) : (
            <span className="grid place-items-center h-16 w-16 rounded-2xl bg-slate-800 font-display text-2xl font-semibold text-slate-200">
              {tenant.businessName.slice(0, 1)}
            </span>
          )}
          <div>
            <h1 className="font-display text-4xl sm:text-5xl font-semibold leading-none">{tenant.businessName}</h1>
            <p className="mt-2 text-sm text-slate-400 tabular-nums">
              {tenant.events.length} upcoming event{tenant.events.length === 1 ? '' : 's'}
            </p>
          </div>
        </div>

        {tenant.events.length === 0 ? (
          <div className="mt-12 py-16 rounded-2xl border border-dashed border-slate-800 text-center">
            <p className="text-slate-300">No upcoming events right now.</p>
            <p className="mt-1 text-sm text-slate-500">Check back soon.</p>
          </div>
        ) : (
          <div className="mt-12 grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
            {tenant.events.map((event) => (
              <Link key={event.slug} href={`/${tenant.slug}/${event.slug}`} className="group block">
                <div className="relative aspect-[16/10] rounded-xl overflow-hidden border border-slate-800/70 bg-raised">
                  {event.coverImageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={event.coverImageUrl}
                      alt=""
                      loading="lazy"
                      className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-[1.03]"
                    />
                  )}
                </div>
                <div className="pt-4 space-y-1">
                  {event.category && <div className="text-sm text-slate-500">{event.category}</div>}
                  <h2 className="font-display text-xl leading-snug font-semibold text-white">{event.title}</h2>
                  <p className="text-sm text-slate-400">
                    {formatDateTime(event.date)} · {event.location}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

export const getServerSideProps: GetServerSideProps<Props> = async (
  context,
) => {
  const { tenantSlug } = context.params as { tenantSlug: string };

  const tenant = await getTenantStorefront(tenantSlug);
  if (!tenant) {
    return { notFound: true };
  }

  return {
    props: {
      tenant: JSON.parse(JSON.stringify(tenant)), // serialize Date objects
    },
  };
};
