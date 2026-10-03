// pages/[tenantSlug]/index.tsx
import { useEffect } from "react";
import { GetServerSideProps } from "next";
import Link from "next/link";
import { getTenantStorefront } from "@/lib/publicQueries";
import { captureRef } from "@/lib/referral";

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
    <div className="min-h-screen bg-[#0B0F17] text-white">
      <header className="border-b border-slate-800/80 p-6 flex items-center gap-4">
        {tenant.logoUrl && (
          <img
            src={tenant.logoUrl}
            alt={tenant.businessName}
            className="h-10 w-10 rounded-full object-cover"
          />
        )}
        <h1 className="text-lg font-mono font-bold uppercase tracking-wider">
          {tenant.businessName}
        </h1>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-4">
        <h2 className="text-xs font-mono uppercase tracking-widest text-slate-500">
          Upcoming Events
        </h2>

        {tenant.events.length === 0 ? (
          <p className="text-sm text-slate-500">
            No upcoming events right now — check back soon.
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {tenant.events.map((event) => (
              <Link
                key={event.slug}
                href={`/${tenant.slug}/${event.slug}`}
                className="block border border-slate-800/80 rounded-xl overflow-hidden hover:border-slate-600 transition"
              >
                {event.coverImageUrl && (
                  <img
                    src={event.coverImageUrl}
                    alt={event.title}
                    className="w-full h-40 object-cover"
                  />
                )}
                <div className="p-4">
                  {event.category && (
                    <div className="text-[10px] font-mono uppercase tracking-widest text-slate-500 mb-1">
                      {event.category}
                    </div>
                  )}
                  <h3 className="text-sm font-semibold">{event.title}</h3>
                  <p className="text-xs text-slate-500 mt-1">
                    {new Date(event.date).toLocaleString()} &middot;{" "}
                    {event.location}
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
