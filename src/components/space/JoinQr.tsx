// components/space/JoinQr.tsx
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

// Rendered in the browser so the QR always points at whatever host the
// organiser is actually on.
interface Props {
  joinCode: string;
  size?: number;
  className?: string;
  // Wraps the QR in a download link — for organisers printing it out.
  downloadName?: string;
}

export default function JoinQr({ joinCode, size = 240, className = '', downloadName }: Props) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    const url = `${window.location.origin}/space/${joinCode}`;
    QRCode.toDataURL(url, { width: Math.max(size * 2, downloadName ? 1024 : 0), margin: 2 })
      .then(setDataUrl)
      .catch(() => setDataUrl(null));
  }, [joinCode, size, downloadName]);

  // A className with its own width (e.g. the projector's viewport-scaled
  // QR) sizes the placeholder too, so nothing jumps when the image arrives.
  const sizedByClass = /(^|\s)w-/.test(className);
  if (!dataUrl) {
    return (
      <div
        style={sizedByClass ? undefined : { width: size, height: size }}
        className={`bg-white/10 rounded-lg aspect-square ${className}`}
      />
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  const img = <img src={dataUrl} alt="Scan to join" width={size} height={size} className={`rounded-lg bg-[#fff] ${className}`} />;
  return downloadName ? (
    <a href={dataUrl} download={downloadName} title="Download QR code">
      {img}
    </a>
  ) : (
    img
  );
}
