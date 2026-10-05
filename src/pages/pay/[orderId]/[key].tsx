// pages/pay/[orderId]/[key].tsx
//
// Where IntaSend sends card payers back to. Forwards them to the page that
// shows their order's result — the event page for tickets, the Plan & Gear
// page for an organiser's plan purchase — which polls the order status.
import type { GetServerSideProps } from 'next';
import { prisma } from '@/lib/prisma';
import { safeEqual } from '@/lib/secrets';

export default function PayReturn() {
  return null;
}

export const getServerSideProps: GetServerSideProps = async ({ params }) => {
  const orderId = typeof params?.orderId === 'string' ? params.orderId : '';
  const key = typeof params?.key === 'string' ? params.key : '';
  const order = /^[a-f0-9]{24}$/i.test(orderId)
    ? await prisma.pendingOrder.findUnique({
        where: { id: orderId },
        select: { id: true, accessKey: true, kind: true, eventId: true },
      })
    : null;
  if (!order || !order.accessKey || !safeEqual(order.accessKey, key)) return { notFound: true };

  const query = `?order=${order.id}&key=${encodeURIComponent(key)}`;
  if (order.kind === 'event_plan') {
    return { redirect: { destination: `/dashboard/events/${order.eventId}/plan${query}`, permanent: false } };
  }
  const event = await prisma.event.findUnique({
    where: { id: order.eventId },
    select: { slug: true, tenant: { select: { slug: true } } },
  });
  if (!event) return { notFound: true };
  const destination = `/${event.tenant.slug}/${event.slug}${query}`;
  return { redirect: { destination, permanent: false } };
};
