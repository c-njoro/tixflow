// components/space/DocumentPage.tsx
import { useState } from 'react';
import { pageUrl, type SpaceDocument } from './types';

// One page of a document, with the next page preloaded so flipping forward
// during a talk is instant even on slow venue Wi-Fi.
export default function DocumentPage({ doc, page, className = '' }: { doc: SpaceDocument; page: number; className?: string }) {
  const src = pageUrl(doc, page);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  if (failedSrc === src) {
    return (
      <div className="p-6 text-center text-sm text-slate-400 border border-dashed border-slate-800 rounded-lg">
        This page couldn&apos;t be loaded.{' '}
        <a href={doc.url} target="_blank" rel="noopener noreferrer" className="underline">
          Open the original file
        </a>
      </div>
    );
  }

  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        key={src}
        src={src}
        alt={`${doc.title} — page ${page}`}
        onError={() => setFailedSrc(src)}
        className={`w-full h-auto rounded-lg bg-[#fff] ${className}`}
      />
      {page < doc.pageCount && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={pageUrl(doc, page + 1)} alt="" aria-hidden className="hidden" />
      )}
    </>
  );
}
