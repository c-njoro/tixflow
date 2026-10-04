// src/lib/ticketImage.tsx
//
// The ticket people actually receive: a 4×6-inch badge-style image
// (1080×1620, JPEG) rendered with next/og. Top: the event's cover image with
// organiser, title, date and venue. Bottom: a white stub with a QR code big
// enough for any gate scanner, plus the holder, tier and ticket code.
// Used by the confirmation email, WhatsApp (both providers) and
// /api/tickets/[code]/image (web pages + the Cloud API template header).
import fs from 'fs/promises';
import path from 'path';
import { ImageResponse } from 'next/og';
import QRCode from 'qrcode';
import { prisma } from './prisma';

export const TICKET_WIDTH = 1080;
export const TICKET_HEIGHT = 1620;
const HERO_HEIGHT = 820;
const PAGE = '#0B0F17';

export interface TicketCardData {
  ticketCode: string;
  holderName: string;
  tierName: string;
  tierColor: string;
  eventTitle: string;
  eventDate: Date;
  eventEndDate: Date | null;
  location: string;
  coverImageUrl: string | null;
  organiser: string;
  logoUrl: string | null;
  index: number; // 1-based position within the buyer's order
  total: number;
}

// ---- data -------------------------------------------------------------------

// Everything a card needs, for one or more ticket codes. "Ticket 2 of 3"
// counts tickets from the same order.
export async function loadTicketCards(ticketCodes: string[]): Promise<TicketCardData[]> {
  const tickets = await prisma.ticket.findMany({
    where: { ticketCode: { in: ticketCodes } },
    include: {
      ticketTier: { select: { name: true, tierColor: true } },
      event: {
        select: {
          title: true,
          date: true,
          endDate: true,
          location: true,
          coverImageUrl: true,
          tenant: { select: { businessName: true, logoUrl: true } },
        },
      },
    },
  });
  const orderIds = [...new Set(tickets.map((t) => t.orderId).filter((id): id is string => !!id))];
  const siblings = orderIds.length
    ? await prisma.ticket.findMany({
        where: { orderId: { in: orderIds } },
        orderBy: { createdAt: 'asc' },
        select: { ticketCode: true, orderId: true },
      })
    : [];

  return ticketCodes
    .map((code) => tickets.find((t) => t.ticketCode === code))
    .filter((t): t is (typeof tickets)[number] => !!t)
    .map((t) => {
      const group = t.orderId ? siblings.filter((s) => s.orderId === t.orderId) : [];
      const position = group.findIndex((s) => s.ticketCode === t.ticketCode);
      return {
        ticketCode: t.ticketCode,
        holderName: t.certificateName || t.buyerName,
        tierName: t.ticketTier.name,
        tierColor: t.ticketTier.tierColor,
        eventTitle: t.event.title,
        eventDate: t.event.date,
        eventEndDate: t.event.endDate,
        location: t.event.location,
        coverImageUrl: t.event.coverImageUrl,
        organiser: t.event.tenant.businessName,
        logoUrl: t.event.tenant.logoUrl,
        index: position >= 0 ? position + 1 : 1,
        total: group.length || 1,
      };
    });
}

// ---- assets -----------------------------------------------------------------

const globalForFonts = globalThis as unknown as { __tixflowTicketFonts?: Promise<{ name: string; data: Buffer; weight: 400 | 600 | 700; style: 'normal' }[]> };

function loadFonts() {
  globalForFonts.__tixflowTicketFonts ??= Promise.all(
    ([400, 600, 700] as const).map(async (weight) => ({
      name: 'Poppins',
      data: await fs.readFile(path.join(process.cwd(), 'node_modules/@fontsource/poppins/files', `poppins-latin-${weight}-normal.woff`)),
      weight,
      style: 'normal' as const,
    }))
  );
  return globalForFonts.__tixflowTicketFonts;
}

// Cloudinary can resize on the fly — fetch exactly what the card needs
// instead of a multi-megabyte original.
function cloudinarySized(url: string, transform: string) {
  return url.includes('res.cloudinary.com') && url.includes('/upload/') ? url.replace('/upload/', `/upload/${transform}/`) : url;
}

// Remote images are fetched here (with a timeout) and inlined, so a slow or
// missing cover never breaks ticket delivery — the card falls back to a
// gradient.
// Cached for a few minutes: an order of 5 tickets shares one cover and
// logo, and a retry covers the odd slow first fetch.
const IMAGE_CACHE_MS = 10 * 60_000;
const globalForImages = globalThis as unknown as { __tixflowTicketImages?: Map<string, { at: number; value: string | null }> };
const imageCache = (globalForImages.__tixflowTicketImages ??= new Map());

async function fetchDataUrl(url: string): Promise<string | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
      if (!res.ok) continue;
      const type = res.headers.get('content-type') || 'image/jpeg';
      if (!type.startsWith('image/')) return null;
      return `data:${type};base64,${Buffer.from(await res.arrayBuffer()).toString('base64')}`;
    } catch {
      // retry once
    }
  }
  return null;
}

async function imageDataUrl(url: string | null, transform: string): Promise<string | null> {
  if (!url) return null;
  const key = cloudinarySized(url, transform);
  const cached = imageCache.get(key);
  if (cached && Date.now() - cached.at < IMAGE_CACHE_MS) return cached.value;
  const value = await fetchDataUrl(key);
  // Don't cache failures — the next ticket gets a fresh attempt.
  if (value) imageCache.set(key, { at: Date.now(), value });
  if (imageCache.size > 50) imageCache.delete(imageCache.keys().next().value!);
  return value;
}

// Readable text on the tier colour, whatever the organiser picked.
function textOn(hex: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return '#ffffff';
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.45 ? '#0B0F17' : '#ffffff';
}

const NAIROBI = 'Africa/Nairobi';
const dayLabel = (d: Date) =>
  d.toLocaleDateString('en-KE', { timeZone: NAIROBI, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const timeLabel = (d: Date) => d.toLocaleTimeString('en-KE', { timeZone: NAIROBI, hour: 'numeric', minute: '2-digit' });

function whenLine(start: Date, end: Date | null) {
  if (!end) return { day: dayLabel(start), time: timeLabel(start) };
  if (dayLabel(start) === dayLabel(end)) return { day: dayLabel(start), time: `${timeLabel(start)} – ${timeLabel(end)}` };
  return { day: `${dayLabel(start)} – ${dayLabel(end)}`, time: timeLabel(start) };
}

const titleSize = (title: string) => (title.length <= 16 ? 92 : title.length <= 28 ? 74 : title.length <= 44 ? 60 : 50);

// ---- rendering --------------------------------------------------------------

export async function renderTicketCard(data: TicketCardData): Promise<TicketImage> {
  const [fonts, cover, logo, qr] = await Promise.all([
    loadFonts(),
    imageDataUrl(data.coverImageUrl, `w_${TICKET_WIDTH},h_${HERO_HEIGHT},c_fill,g_auto,q_auto,f_jpg`),
    imageDataUrl(data.logoUrl, 'w_160,h_160,c_fill,q_auto,f_png'),
    QRCode.toDataURL(data.ticketCode, { width: 640, margin: 1, errorCorrectionLevel: 'M' }),
  ]);
  const when = whenLine(data.eventDate, data.eventEndDate);
  const tierText = textOn(data.tierColor);

  const element = (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: PAGE, fontFamily: 'Poppins' }}>
      {/* Hero: cover image, darkened towards the bottom so text stays readable */}
      <div style={{ position: 'relative', display: 'flex', width: TICKET_WIDTH, height: HERO_HEIGHT }}>
        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={cover} alt="" width={TICKET_WIDTH} height={HERO_HEIGHT} style={{ position: 'absolute', top: 0, left: 0, objectFit: 'cover' }} />
        ) : (
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: TICKET_WIDTH,
              height: HERO_HEIGHT,
              backgroundImage: `linear-gradient(135deg, ${data.tierColor === '#000000' ? '#1e3a5f' : data.tierColor} 0%, #0B0F17 100%)`,
            }}
          />
        )}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: TICKET_WIDTH,
            height: HERO_HEIGHT,
            backgroundImage: 'linear-gradient(180deg, rgba(11,15,23,0.55) 0%, rgba(11,15,23,0.15) 35%, rgba(11,15,23,0.92) 100%)',
          }}
        />
        <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', width: '100%', padding: 64 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            {logo && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logo} alt="" width={72} height={72} style={{ borderRadius: 18, border: '3px solid rgba(255,255,255,0.85)' }} />
            )}
            <div style={{ display: 'flex', fontSize: 30, fontWeight: 600, letterSpacing: 6, color: 'rgba(255,255,255,0.92)', textTransform: 'uppercase' }}>
              {data.organiser}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div
              style={{
                display: 'flex',
                alignSelf: 'flex-start',
                padding: '10px 28px',
                borderRadius: 999,
                background: data.tierColor,
                color: tierText,
                fontSize: 30,
                fontWeight: 700,
                letterSpacing: 4,
                textTransform: 'uppercase',
                border: '3px solid rgba(255,255,255,0.35)',
              }}
            >
              {data.tierName}
            </div>
            <div style={{ display: 'flex', fontSize: titleSize(data.eventTitle), fontWeight: 700, color: '#ffffff', lineHeight: 1.05 }}>
              {data.eventTitle}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, color: 'rgba(255,255,255,0.9)' }}>
              <div style={{ display: 'flex', fontSize: 38, fontWeight: 600 }}>{when.day}</div>
              <div style={{ display: 'flex', fontSize: 32 }}>
                {when.time} · {data.location}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Perforation between hero and stub */}
      <div style={{ display: 'flex', alignItems: 'center', height: 60, background: '#ffffff', position: 'relative' }}>
        <div style={{ position: 'absolute', left: -30, top: 0, width: 60, height: 60, borderRadius: 30, background: PAGE }} />
        <div style={{ position: 'absolute', right: -30, top: 0, width: 60, height: 60, borderRadius: 30, background: PAGE }} />
        <div style={{ position: 'absolute', left: 60, top: 28, width: TICKET_WIDTH - 120, borderTop: '4px dashed #cbd5e1' }} />
      </div>

      {/* Stub: the part that gets scanned */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexGrow: 1, background: '#ffffff', padding: '6px 64px 48px' }}>
        <div style={{ display: 'flex', width: '100%', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <div style={{ display: 'flex', flexDirection: 'column', maxWidth: 640 }}>
            <div style={{ display: 'flex', fontSize: 22, fontWeight: 600, letterSpacing: 4, color: '#64748b' }}>TICKET HOLDER</div>
            <div style={{ display: 'flex', fontSize: 44, fontWeight: 700, color: '#0B0F17', lineHeight: 1.15 }}>{data.holderName}</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
            <div style={{ display: 'flex', fontSize: 22, fontWeight: 600, letterSpacing: 4, color: '#64748b' }}>ADMIT</div>
            <div style={{ display: 'flex', fontSize: 44, fontWeight: 700, color: '#0B0F17' }}>
              {data.total > 1 ? `${data.index} of ${data.total}` : 'One'}
            </div>
          </div>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={qr} alt="" width={520} height={520} style={{ marginTop: 18 }} />
        <div style={{ display: 'flex', marginTop: 8, fontSize: 40, fontWeight: 700, letterSpacing: 6, color: '#0B0F17' }}>{data.ticketCode}</div>
        <div style={{ display: 'flex', marginTop: 4, fontSize: 22, color: '#94a3b8' }}>Show this QR code at the entrance · Tixflow</div>
      </div>
    </div>
  );

  const response = new ImageResponse(element, {
    width: TICKET_WIDTH,
    height: TICKET_HEIGHT,
    fonts: fonts.map((f) => ({ ...f, data: f.data.buffer.slice(f.data.byteOffset, f.data.byteOffset + f.data.byteLength) as ArrayBuffer })),
  });
  return toJpeg(Buffer.from(await response.arrayBuffer()));
}

export interface TicketImage {
  data: Buffer;
  contentType: 'image/jpeg' | 'image/png';
  extension: 'jpg' | 'png';
}

// next/og only outputs PNG, which is ~1.8 MB for a photo cover. A
// high-quality JPEG is a fraction of that (emails with several tickets
// stay small) and the QR stays sharp. `sharp` ships with Next; if it can't
// load, the PNG is used as-is.
async function toJpeg(png: Buffer): Promise<TicketImage> {
  try {
    const sharp = (await import('sharp')).default;
    const data = await sharp(png).flatten({ background: PAGE }).jpeg({ quality: 88, mozjpeg: true }).toBuffer();
    return { data, contentType: 'image/jpeg', extension: 'jpg' };
  } catch (error) {
    console.error('TICKET_IMAGE_JPEG_FALLBACK:', error);
    return { data: png, contentType: 'image/png', extension: 'png' };
  }
}

// Cards for several tickets (one PNG each), in the order given. A ticket
// whose card can't be rendered is simply left out — callers fall back to a
// plain QR so delivery never fails because of the design.
export async function renderTicketImages(ticketCodes: string[]): Promise<({ ticketCode: string } & TicketImage)[]> {
  const cards = await loadTicketCards(ticketCodes);
  const out: ({ ticketCode: string } & TicketImage)[] = [];
  for (const card of cards) {
    try {
      out.push({ ticketCode: card.ticketCode, ...(await renderTicketCard(card)) });
    } catch (error) {
      console.error('CRITICAL_TICKET_IMAGE_RENDER_ERROR:', card.ticketCode, error);
    }
  }
  return out;
}
