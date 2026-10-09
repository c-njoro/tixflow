// components/site/ThemeToggle.tsx
//
// Switches between light and dark mode (src/lib/theme.ts). Both icons are
// rendered and CSS shows the right one, so the server's HTML always matches.
import { MoonIcon, SunIcon } from '@heroicons/react/24/outline';
import { currentTheme, setTheme } from '@/lib/theme';

const toggle = () => setTheme(currentTheme() === 'light' ? 'dark' : 'light');

// Icon button, for the site header.
export function ThemeToggle({ className = '' }: { className?: string }) {
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Switch between light and dark mode"
      title="Light / dark mode"
      className={`w-9 h-9 inline-flex items-center justify-center rounded-lg text-slate-300 hover:text-white hover:bg-slate-800/40 transition-colors ${className}`}
    >
      <SunIcon className="w-[18px] h-[18px] light:hidden" />
      <MoonIcon className="w-[18px] h-[18px] hidden light:block" />
    </button>
  );
}

// Full-width row, for the dashboard sidebar.
export function ThemeToggleRow({ collapsed }: { collapsed: boolean }) {
  return (
    <button
      type="button"
      onClick={toggle}
      title="Light / dark mode"
      className={`w-full flex items-center gap-3 rounded-lg text-sm text-slate-400 hover:text-slate-100 hover:bg-slate-800/30 transition-colors ${
        collapsed ? 'justify-center h-10' : 'px-3 h-9'
      }`}
    >
      <SunIcon className="w-[18px] h-[18px] shrink-0 light:hidden" />
      <MoonIcon className="w-[18px] h-[18px] shrink-0 hidden light:block" />
      {!collapsed && (
        <span className="font-medium">
          <span className="light:hidden">Light mode</span>
          <span className="hidden light:inline">Dark mode</span>
        </span>
      )}
    </button>
  );
}
