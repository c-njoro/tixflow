// src/lib/holds.ts
//
// Seats set aside that aren't sold yet, and so aren't for sale to anyone
// else: a waitlist offer's seats (src/lib/waitlist.ts) and a group's
// unpaid seats (src/lib/groups.ts). Subtracted wherever availability is
// checked (checkAvailability, the public event page).
import { prisma } from './prisma';

// Held seats per tier. `except`: the hold of the person checking out, whose
// own seats are of course available to them.
export async function heldSeats(tierIds: string[], except: { offerId?: string | null; groupId?: string | null } = {}) {
  const held = new Map<string, number>();
  if (tierIds.length === 0) return held;
  const now = new Date();
  const [offers, groups] = await Promise.all([
    prisma.waitlistEntry.findMany({
      where: { ticketTierId: { in: tierIds }, status: 'offered', offerExpiresAt: { gt: now } },
      select: { id: true, ticketTierId: true, quantity: true },
    }),
    prisma.groupBooking.findMany({
      where: { ticketTierId: { in: tierIds }, status: { in: ['pending', 'open'] }, expiresAt: { gt: now } },
      select: { id: true, ticketTierId: true, size: true, paidSeats: true },
    }),
  ]);
  const add = (tierId: string, n: number) => held.set(tierId, (held.get(tierId) ?? 0) + Math.max(n, 0));
  for (const o of offers) if (o.id !== except.offerId) add(o.ticketTierId, o.quantity);
  for (const g of groups) if (g.id !== except.groupId) add(g.ticketTierId, g.size - g.paidSeats);
  return held;
}
