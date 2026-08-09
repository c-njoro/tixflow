// Inside components/dashboard/Header.tsx
import {
  Bars3Icon,
  ArrowLeftStartOnRectangleIcon,
} from "@heroicons/react/24/outline";
import { useAuth } from "@/context/AuthContext"; // Import the hook

interface HeaderProps {
  onToggleSidebar: () => void;
}

export default function Header({ onToggleSidebar }: HeaderProps) {
  const { logout } = useAuth(); // Grab the logout function

  return (
    <div className="absolute top-4 left-4 right-4 w-auto h-14 bg-[#131924]/75 backdrop-blur-md border border-slate-800/90 rounded-xl hidden md:flex items-center justify-between px-6 z-30 shadow-lg">
      {" "}
      <button
        onClick={onToggleSidebar}
        className="p-1.5 border border-slate-800 rounded-lg bg-[#0E131F]/60 text-slate-400 hover:text-white hover:border-slate-700 transition"
      >
        <Bars3Icon className="w-4 h-4" />
      </button>
      <div className="flex items-center space-x-4">
        <span className="text-xs font-mono text-slate-400 uppercase tracking-wider">
          Account Dashboard
        </span>
        <span className="h-4 w-px bg-slate-800" />

        {/* Updated Sign Out Button */}
        <button
          onClick={logout}
          className="text-slate-500 hover:text-rose-400 p-1 transition flex items-center space-x-1"
          title="Sign Out"
        >
          <span className="text-[11px] font-mono uppercase tracking-wider hidden sm:inline">
            Sign Out
          </span>
          <ArrowLeftStartOnRectangleIcon className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
