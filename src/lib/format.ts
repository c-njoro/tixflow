// src/lib/format.ts
//
// Dates for display, always in Kenyan time and day-month order
// (e.g. "20 Dec 2026, 13:00"), whatever the viewer's browser locale.
export const formatDateTime = (value: string | number | Date) =>
  new Date(value).toLocaleString('en-KE', {
    timeZone: 'Africa/Nairobi',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

export const formatDate = (value: string | number | Date) =>
  new Date(value).toLocaleDateString('en-KE', { timeZone: 'Africa/Nairobi', day: 'numeric', month: 'short', year: 'numeric' });
