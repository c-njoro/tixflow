// src/pages/api/exhibitor/[token]/export.ts — the exhibitor's leads as CSV.
import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '@/lib/prisma';
import { loadExhibitor } from '@/lib/exhibitors';

// Quote every field, and neutralise leading = + - @ so a spreadsheet never
// runs an attendee-typed name or note as a formula.
const csvField = (value: unknown) => {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }
  const exhibitor = await loadExhibitor(req, res);
  if (!exhibitor) return;

  const leads = await prisma.exhibitorLead.findMany({ where: { exhibitorId: exhibitor.id }, orderBy: { createdAt: 'asc' } });
  const ratingLabel = (r: number | null) => (r === 3 ? 'Hot' : r === 2 ? 'Warm' : r === 1 ? 'Cold' : '');
  const rows = [
    ['Name', 'Email', 'Rating', 'Notes', 'Scanned at'],
    ...leads.map((l) => [l.name, l.email, ratingLabel(l.rating), l.notes, l.createdAt.toISOString()]),
  ];
  const csv = rows.map((row) => row.map(csvField).join(',')).join('\r\n');
  const filename = `leads-${exhibitor.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.csv`;

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).send(`﻿${csv}`);
}
