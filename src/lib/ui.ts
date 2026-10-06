// src/lib/ui.ts
//
// Shared class strings for the dashboard and app surfaces, so every form,
// panel and button looks the same everywhere. (Colours: ink #0B0F17,
// panel #0E131F, slate text; see src/styles/globals.css.)

export const inputClass =
  'block w-full bg-[#0B0F17] border border-slate-800 rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-500/20 disabled:opacity-50 transition-colors';

export const labelClass = 'block text-sm font-medium text-slate-300';

export const cardClass = 'p-5 sm:p-6 bg-[#0E131F] border border-slate-800/70 rounded-2xl';

const buttonBase =
  'inline-flex items-center justify-center gap-2 h-9 px-3.5 text-[13px] font-medium rounded-lg transition-colors disabled:opacity-40 disabled:pointer-events-none whitespace-nowrap';

export const buttonClass = `${buttonBase} border border-slate-700 text-slate-200 hover:text-white hover:bg-slate-800/60`;

export const primaryButtonClass = `${buttonBase} bg-slate-100 text-[#0B0F17] hover:bg-white`;

export const dangerButtonClass = `${buttonBase} border border-rose-900/60 text-rose-300 hover:bg-rose-950/40`;

// Section headings inside panels.
export const sectionTitleClass = 'text-base font-semibold text-white';
