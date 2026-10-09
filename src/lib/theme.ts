// src/lib/theme.ts — browser only.
//
// Light / dark mode. The theme lives on <html data-theme>, set before the
// first paint by THEME_INIT_SCRIPT (in _document). Someone who picks a mode
// keeps it (localStorage); everyone else follows their device setting.
export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'tixflow-theme';
export const THEME_EVENT = 'tixflow-theme-change';

// Inlined in _document, so it must stay self-contained plain JS.
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('${STORAGE_KEY}');if(t!=='light'&&t!=='dark'){t=window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'}document.documentElement.setAttribute('data-theme',t)}catch(e){}})();`;

export function currentTheme(): Theme {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

function apply(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  window.dispatchEvent(new Event(THEME_EVENT));
}

export function setTheme(theme: Theme) {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {}
  apply(theme);
}

// Follow the device's setting while the visitor hasn't picked one.
export function followSystemTheme() {
  const media = window.matchMedia('(prefers-color-scheme: light)');
  const onChange = () => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(STORAGE_KEY);
    } catch {}
    if (saved !== 'light' && saved !== 'dark') apply(media.matches ? 'light' : 'dark');
  };
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}
