// components/space/types.ts
// Client-side shapes of the Event Space API responses (dates arrive as strings).

export type PollResults =
  | { kind: 'choice'; total: number; counts: number[] }
  | { kind: 'text'; total: number; answers: { text: string; count: number }[] };

export interface SpaceDocument {
  id: string;
  title: string;
  format: string;
  pageCount: number;
  url: string;
  pageUrlTemplate: string;
  createdAt: string;
}

export interface PublicQuestion {
  id: string;
  text: string;
  authorName: string | null;
  upvotes: number;
  status: 'visible' | 'answered';
  createdAt: string;
}

export type ScreenMode = 'join' | 'poll' | 'questions' | 'document';

export interface PublicSpaceState {
  joinCode: string;
  title: string;
  welcomeMessage: string | null;
  isOpen: boolean;
  moderateQuestions: boolean;
  screenMode: ScreenMode;
  event: { title: string; date: string; endDate: string | null; location: string; organiser: string };
  announcements: { text: string; createdAt: string }[];
  poll: {
    id: string;
    question: string;
    kind: 'choice' | 'text';
    options: string[];
    status: 'live' | 'closed';
    showResults: boolean;
    responseCount: number;
    results: PollResults | null;
  } | null;
  documents: SpaceDocument[];
  live: { documentId: string; page: number } | null;
  questions: PublicQuestion[];
  spotlightQuestion: PublicQuestion | null;
  activeCount: number;
  // The event's other open rooms, for switching between parallel tracks.
  otherRooms: { title: string; joinCode: string }[];
}

export interface ParticipantState {
  myResponse: { optionIndex: number | null; text: string | null } | null;
  votedQuestionIds: string[];
  myPendingQuestions: { id: string; text: string; createdAt: string }[];
}

export const pageUrl = (doc: Pick<SpaceDocument, 'pageUrlTemplate'>, page: number) =>
  doc.pageUrlTemplate.replace('{page}', String(page));
