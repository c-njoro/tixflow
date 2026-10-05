// pages/t/[code].tsx
//
// The page an SMS ticket link opens: the ticket card (QR inside), big
// enough to scan straight off the phone screen. Public by ticket code —
// the code is the credential shown at the gate either way.
import type { GetServerSideProps } from 'next';
import Head from 'next/head';
import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import TicketCard from '@/components/TicketCard';

interface Props {
  ticketCode: string;
  status: string;
  tierName: string;
  holder: string;
  event: { title: string; date: string; location: string };
}

export default function ShortTicketPage({ ticketCode, status, tierName, holder, event }: Props) {
  const valid = status === 'active' || status === 'scanned';
  return (
    <div className="min-h-screen bg-[#0B0F17] text-white">
      <Head>
        <title>{`Ticket · ${event.title}`}</title>
      </Head>
      <main className="max-w-md mx-auto p-6 space-y-5">
        <div className="text-center space-y-1">
          <h1 className="text-xl font-bold">{event.title}</h1>
          <p className="text-sm text-slate-400">
            {new Date(event.date).toLocaleString('en-KE', { timeZone: 'Africa/Nairobi', dateStyle: 'medium', timeStyle: 'short' })} ·{' '}
            {event.location}
          </p>
          <p className="text-sm text-slate-300">
            {holder} · {tierName}
          </p>
        </div>
        {valid ? (
          <TicketCard ticketCode={ticketCode} label={tierName} />
        ) : (
          <div className="p-4 rounded-xl border border-rose-800/50 bg-rose-950/30 text-rose-400 text-sm text-center">
            This ticket is {status}.
          </div>
        )}
        <p className="text-center text-xs text-slate-500">
          Show this at the gate. Lost it? <Link href="/lookup" className="underline">Find your tickets</Link>
        </p>
      </main>
    </div>
  );
}

export const getServerSideProps: GetServerSideProps<Props> = async ({ params }) => {
  const code = typeof params?.code === 'string' ? params.code.toUpperCase() : '';
  if (!/^TIX-[0-9A-F]{6,20}$/.test(code)) return { notFound: true };
  const ticket = await prisma.ticket.findUnique({
    where: { ticketCode: code },
    include: { event: { select: { title: true, date: true, location: true } }, ticketTier: { select: { name: true } } },
  });
  if (!ticket) return { notFound: true };
  return {
    props: {
      ticketCode: ticket.ticketCode,
      status: ticket.status,
      tierName: ticket.ticketTier.name,
      holder: ticket.buyerName,
      event: { title: ticket.event.title, date: ticket.event.date.toISOString(), location: ticket.event.location },
    },
  };
};
