// src/lib/eventSpace.ts
//
// Shared logic for Event Spaces: join codes, the attendee identity cookie,
// poll result maths, and the public state every attendee phone and the
// projector screen poll for.
//
// Real-time model: attendee pages poll GET /api/space/[code]?v=<version>
// every few seconds. Every change attendees could see bumps
// EventSpace.version (always via bumpSpace below), so an unchanged space
// costs one indexed lookup and a tiny response. The full public state is
// cached in memory per space — same single `next start` process assumption
// as src/lib/whatsapp.ts and src/lib/rateLimit.ts.
import crypto from 'crypto';
import type { NextApiRequest, NextApiResponse } from 'next';
import { serialize } from 'cookie';
import type { EventSpace, Prisma, SpaceDocument, SpacePoll } from '@prisma/client';
import { prisma } from './prisma';
import { getAppUrl } from './mpesaCallbacks';
import { deleteImage } from './cloudinary';

export const SCREEN_MODES = ['join', 'poll', 'questions', 'document'] as const;
export const QUESTION_STATUSES = ['pending', 'visible', 'answered', 'hidden'] as const;

export const MAX_POLL_OPTIONS = 8;
export const MAX_ANSWER_LENGTH = 80;
export const MAX_QUESTION_LENGTH = 300;
const MAX_ANNOUNCEMENTS = 20;
// Ranked text answers shown per poll — the long tail isn't useful on a screen.
const MAX_TEXT_GROUPS = 40;

// ---- Join codes & URLs ----------------------------------------------------

// No 0/O/1/I/L — people read these off a projector and type them in.
const JOIN_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function randomJoinCode(length = 6) {
  const bytes = crypto.randomBytes(length);
  return Array.from(bytes, (b) => JOIN_CODE_ALPHABET[b % JOIN_CODE_ALPHABET.length]).join('');
}

export async function generateUniqueJoinCode(): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = randomJoinCode();
    const taken = await prisma.eventSpace.findUnique({ where: { joinCode: code }, select: { id: true } });
    if (!taken) return code;
  }
  throw new Error('Could not generate a unique join code.');
}

export const normalizeJoinCode = (code: string) => code.trim().toUpperCase();

export const spaceUrl = (joinCode: string) => `${getAppUrl()}/space/${joinCode}`;

// ---- Attendee identity ----------------------------------------------------

// A random id in an httpOnly cookie, nothing more. Deliberately not a JWT:
// a token signed with JWT_SECRET could be pasted into the session cookie
// and parsed by getSession() as a (tenant-less) staff session.
const PARTICIPANT_COOKIE = 'tixflow_space_pid';
const PARTICIPANT_ID_PATTERN = /^[a-f0-9]{32}$/;

export function getParticipantId(req: NextApiRequest): string | null {
  const value = req.cookies?.[PARTICIPANT_COOKIE];
  return value && PARTICIPANT_ID_PATTERN.test(value) ? value : null;
}

export function ensureParticipantId(req: NextApiRequest, res: NextApiResponse): string {
  const existing = getParticipantId(req);
  if (existing) return existing;

  const pid = crypto.randomBytes(16).toString('hex');
  res.setHeader(
    'Set-Cookie',
    serialize(PARTICIPANT_COOKIE, pid, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 365,
      path: '/',
    })
  );
  return pid;
}

// lastSeenAt powers the "people here now" count. Writing it on every poll
// would be a DB write per attendee every few seconds — once a minute is plenty.
const globalForSeen = globalThis as unknown as { __tixflowSpaceSeen?: Map<string, number> };
const lastSeenWrites = globalForSeen.__tixflowSpaceSeen ?? new Map<string, number>();
globalForSeen.__tixflowSpaceSeen = lastSeenWrites;
const SEEN_WRITE_INTERVAL_MS = 60_000;
export const ACTIVE_WINDOW_MS = 3 * 60_000;

export async function touchParticipant(spaceId: string, participantId: string, force = false) {
  const key = `${spaceId}:${participantId}`;
  const now = Date.now();
  if (!force && now - (lastSeenWrites.get(key) ?? 0) < SEEN_WRITE_INTERVAL_MS) return;
  lastSeenWrites.set(key, now);

  if (lastSeenWrites.size > 50_000) {
    for (const [k, t] of lastSeenWrites) if (now - t > SEEN_WRITE_INTERVAL_MS) lastSeenWrites.delete(k);
  }

  await prisma.spaceParticipant.upsert({
    where: { spaceId_participantId: { spaceId, participantId } },
    create: { spaceId, participantId },
    update: { lastSeenAt: new Date(now) },
  });
}

// ---- Mutations ------------------------------------------------------------

// Every change attendees could see must go through here so their pages
// pick it up.
export async function bumpSpace(spaceId: string, data: Prisma.EventSpaceUpdateInput = {}) {
  const updated = await prisma.eventSpace.update({
    where: { id: spaceId },
    data: { ...data, version: { increment: 1 } },
  });
  stateCache.delete(spaceId);
  return updated;
}

export function addAnnouncement(space: EventSpace, text: string) {
  return [{ text, createdAt: new Date() }, ...space.announcements].slice(0, MAX_ANNOUNCEMENTS);
}

// Deletes a space and everything in it, including uploaded files.
export async function deleteSpace(spaceId: string) {
  const documents = await prisma.spaceDocument.findMany({ where: { spaceId }, select: { publicId: true } });
  await Promise.all(
    documents.map((doc) =>
      deleteImage(doc.publicId).catch((err) =>
        console.error('CRITICAL_ORPHANED_SPACE_DOCUMENT_CLEANUP_FAILED:', doc.publicId, err)
      )
    )
  );

  await prisma.$transaction([
    prisma.spacePollResponse.deleteMany({ where: { spaceId } }),
    prisma.spacePoll.deleteMany({ where: { spaceId } }),
    prisma.spaceQuestionVote.deleteMany({ where: { spaceId } }),
    prisma.spaceQuestion.deleteMany({ where: { spaceId } }),
    prisma.spaceDocument.deleteMany({ where: { spaceId } }),
    prisma.spaceParticipant.deleteMany({ where: { spaceId } }),
    prisma.eventSpace.delete({ where: { id: spaceId } }),
  ]);
  stateCache.delete(spaceId);
}

// ---- Polls ----------------------------------------------------------------

// "Machine Learning!", "machine learning" and " MACHINE   learning " all
// count as the same answer.
export function normalizeAnswer(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'&+#-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_ANSWER_LENGTH);
}

export type PollResults =
  | { kind: 'choice'; total: number; counts: number[] }
  | { kind: 'text'; total: number; answers: { text: string; count: number }[] };

export async function getPollResults(poll: SpacePoll, includeHidden = false): Promise<PollResults> {
  if (poll.kind === 'choice') {
    const groups = await prisma.spacePollResponse.groupBy({
      by: ['optionIndex'],
      where: { pollId: poll.id },
      _count: { _all: true },
    });
    const counts = poll.options.map(() => 0);
    for (const group of groups) {
      if (group.optionIndex !== null && group.optionIndex < counts.length) {
        counts[group.optionIndex] = group._count._all;
      }
    }
    return { kind: 'choice', total: counts.reduce((a, b) => a + b, 0), counts };
  }

  const groups = await prisma.spacePollResponse.groupBy({
    by: ['normalized'],
    where: {
      pollId: poll.id,
      ...(!includeHidden && poll.hiddenAnswers.length > 0 && { normalized: { notIn: poll.hiddenAnswers } }),
    },
    _count: { _all: true },
  });
  const answers = groups
    .filter((g) => g.normalized)
    .map((g) => ({ text: g.normalized as string, count: g._count._all }))
    .sort((a, b) => b.count - a.count || a.text.localeCompare(b.text));

  return {
    kind: 'text',
    total: answers.reduce((sum, a) => sum + a.count, 0),
    answers: answers.slice(0, MAX_TEXT_GROUPS),
  };
}

// ---- Documents ------------------------------------------------------------

const isPdf = (doc: Pick<SpaceDocument, 'format'>) => doc.format.toLowerCase() === 'pdf';

// `{page}` is substituted on the client. PDFs render one page at a time as
// a JPG via Cloudinary's pg_<n> transformation; images are a single page.
export function documentPageUrlTemplate(doc: Pick<SpaceDocument, 'url' | 'publicId' | 'format'>): string {
  if (!isPdf(doc)) return doc.url;
  const cloud = process.env.CLOUDINARY_CLOUD_NAME;
  return `https://res.cloudinary.com/${cloud}/image/upload/pg_{page},w_1400,c_limit,q_auto/${doc.publicId}.jpg`;
}

export const serializeDocument = (doc: SpaceDocument) => ({
  id: doc.id,
  title: doc.title,
  format: doc.format,
  pageCount: doc.pageCount,
  url: doc.url,
  pageUrlTemplate: documentPageUrlTemplate(doc),
  createdAt: doc.createdAt,
});

// ---- Public state ---------------------------------------------------------

interface CachedState {
  version: number;
  builtAt: number;
  state: PublicSpaceState;
}

const globalForState = globalThis as unknown as { __tixflowSpaceState?: Map<string, CachedState> };
const stateCache = globalForState.__tixflowSpaceState ?? new Map<string, CachedState>();
globalForState.__tixflowSpaceState = stateCache;

// While answers are pouring in the version moves on almost every request;
// rebuilding at most this often keeps a full room from hammering the DB.
const MIN_REBUILD_INTERVAL_MS = 1_500;
// Even with no changes, refresh now and then so the people count stays current.
const MAX_STATE_AGE_MS = 15_000;

export type PublicSpaceState = Awaited<ReturnType<typeof buildPublicState>>;

type SpaceWithEvent = EventSpace & {
  event: { title: string; date: Date; endDate: Date | null; location: string; tenant: { businessName: string } };
};

async function buildPublicState(space: SpaceWithEvent) {
  const base = {
    joinCode: space.joinCode,
    title: space.title,
    welcomeMessage: space.welcomeMessage,
    isOpen: space.isOpen,
    moderateQuestions: space.moderateQuestions,
    screenMode: space.screenMode,
    event: {
      title: space.event.title,
      date: space.event.date,
      endDate: space.event.endDate,
      location: space.event.location,
      organiser: space.event.tenant.businessName,
    },
  };
  if (!space.isOpen) {
    return { ...base, announcements: [], poll: null, documents: [], live: null, questions: [], spotlightQuestion: null, activeCount: 0 };
  }

  const [livePoll, documents, questions, activeCount] = await Promise.all([
    space.livePollId ? prisma.spacePoll.findFirst({ where: { id: space.livePollId, spaceId: space.id } }) : null,
    prisma.spaceDocument.findMany({ where: { spaceId: space.id }, orderBy: { createdAt: 'asc' } }),
    prisma.spaceQuestion.findMany({
      where: { spaceId: space.id, status: { in: ['visible', 'answered'] } },
      orderBy: [{ upvotes: 'desc' }, { createdAt: 'asc' }],
      take: 100,
      select: { id: true, text: true, authorName: true, upvotes: true, status: true, createdAt: true },
    }),
    prisma.spaceParticipant.count({
      where: { spaceId: space.id, lastSeenAt: { gte: new Date(Date.now() - ACTIVE_WINDOW_MS) } },
    }),
  ]);

  let poll = null;
  if (livePoll) {
    // The projector shows results whenever the organiser puts the poll on
    // screen, so they're included then even if phones aren't showing them.
    const includeResults = livePoll.showResults || space.screenMode === 'poll';
    poll = {
      id: livePoll.id,
      question: livePoll.question,
      kind: livePoll.kind as 'choice' | 'text',
      options: livePoll.options,
      status: livePoll.status as 'live' | 'closed',
      showResults: livePoll.showResults,
      responseCount: livePoll.responseCount,
      results: includeResults ? await getPollResults(livePoll) : null,
    };
  }

  const liveDocument = documents.find((d) => d.id === space.liveDocumentId);
  const spotlightQuestion = space.spotlightQuestionId
    ? questions.find((q) => q.id === space.spotlightQuestionId) ?? null
    : null;

  return {
    ...base,
    announcements: space.announcements.slice(0, 5),
    poll,
    documents: documents.map(serializeDocument),
    live: liveDocument
      ? { documentId: liveDocument.id, page: Math.min(Math.max(space.liveDocumentPage, 1), liveDocument.pageCount) }
      : null,
    questions,
    spotlightQuestion,
    activeCount,
  };
}

export async function findSpaceByCode(code: string) {
  return prisma.eventSpace.findUnique({
    where: { joinCode: normalizeJoinCode(code) },
    include: {
      event: {
        select: { title: true, date: true, endDate: true, location: true, status: true, tenant: { select: { businessName: true } } },
      },
    },
  });
}

export async function getPublicState(space: SpaceWithEvent): Promise<{ version: number; state: PublicSpaceState }> {
  const cached = stateCache.get(space.id);
  const now = Date.now();
  if (cached) {
    const fresh = cached.version === space.version && now - cached.builtAt < MAX_STATE_AGE_MS;
    const throttled = now - cached.builtAt < MIN_REBUILD_INTERVAL_MS;
    if (fresh || throttled) return { version: cached.version, state: cached.state };
  }

  const state = await buildPublicState(space);
  stateCache.set(space.id, { version: space.version, builtAt: now, state });
  return { version: space.version, state };
}

// The bits of state that differ per attendee: what they already answered
// and which questions they upvoted.
export async function getParticipantState(spaceId: string, participantId: string | null, livePollId: string | null) {
  if (!participantId) return { myResponse: null, votedQuestionIds: [], myPendingQuestions: [] };

  const [response, votes, pending] = await Promise.all([
    livePollId
      ? prisma.spacePollResponse.findUnique({
          where: { pollId_participantId: { pollId: livePollId, participantId } },
          select: { optionIndex: true, text: true },
        })
      : null,
    prisma.spaceQuestionVote.findMany({ where: { spaceId, participantId }, select: { questionId: true } }),
    prisma.spaceQuestion.findMany({
      where: { spaceId, participantId, status: 'pending' },
      orderBy: { createdAt: 'desc' },
      select: { id: true, text: true, createdAt: true },
    }),
  ]);

  return {
    myResponse: response,
    votedQuestionIds: votes.map((v) => v.questionId),
    myPendingQuestions: pending,
  };
}
