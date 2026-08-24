import { useState, FormEvent } from "react";
import { useRouter } from "next/router";
import { useAuth } from "@/context/AuthContext";
import {
  TicketIcon,
  QrCodeIcon,
  BanknotesIcon,
  ChartBarIcon,
  UserGroupIcon,
  PhotoIcon,
} from "@heroicons/react/24/outline";

export default function AuthPage() {
  const router = useRouter();
  const { login } = useAuth();
  const [isLogin, setIsLogin] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  // Form fields
  const [businessName, setBusinessName] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setErrorMessage("");

    const endpoint = isLogin ? "/api/auth/login" : "/api/auth/register-tenant";
    const payload = isLogin
      ? { email, password }
      : { businessName, name, email, password };

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          result.error || "Something went wrong. Please try again.",
        );
      }

      if (isLogin) {
        login({
          id: result.data.user.id,
          name: result.data.user.name,
          email: result.data.user.email,
          role: result.data.user.role,
          companyName: result.data.tenant.businessName,
        });
        // login() handles router.push('/dashboard')
      } else {
        setIsLogin(true);
        setErrorMessage(
          "Account created successfully! Please log in to your workspace.",
        );
      }
    } catch (err: any) {
      setErrorMessage(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const features = [
    { icon: TicketIcon, label: "Unlimited events & ticket tiers" },
    { icon: QrCodeIcon, label: "Door check‑in with QR scan" },
    { icon: BanknotesIcon, label: "Direct payouts to your account" },
    { icon: ChartBarIcon, label: "Real‑time sales dashboard" },
    { icon: UserGroupIcon, label: "Staff access control" },
    { icon: PhotoIcon, label: "Branded event storefront" },
  ];

  return (
    <div className="min-h-screen bg-[#0B0F17] text-slate-100 flex items-center justify-center overflow-hidden relative">
      {/* Background ambient glows */}
      <div className="absolute top-[-30%] left-[-20%] w-[70rem] h-[70rem] bg-indigo-900/10 rounded-full blur-[150px] pointer-events-none" />
      <div className="absolute bottom-[-30%] right-[-20%] w-[70rem] h-[70rem] bg-slate-800/20 rounded-full blur-[150px] pointer-events-none" />

      <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 z-10">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-center min-h-[90vh] py-8">
          {/* ---- LEFT PANEL (desktop only) ---- */}
          <div className="hidden lg:flex flex-col justify-center space-y-10 relative">
            {/* Decorative ticket silhouette */}
            <div className="relative w-full max-w-sm mx-auto">
              <svg
                viewBox="0 0 200 120"
                className="w-full h-auto text-indigo-500/20 drop-shadow-2xl"
              >
                <path
                  d="M20 20 L180 20 L180 50 L160 50 Q160 70 180 70 L180 100 L20 100 L20 70 L40 70 Q40 50 20 50 Z"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="4"
                  strokeLinejoin="round"
                />
                <circle
                  cx="100"
                  cy="60"
                  r="12"
                  fill="currentColor"
                  opacity="0.3"
                />
                <path
                  d="M60 40 L140 40"
                  stroke="currentColor"
                  strokeWidth="2"
                  opacity="0.2"
                />
                <path
                  d="M60 80 L140 80"
                  stroke="currentColor"
                  strokeWidth="2"
                  opacity="0.2"
                />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-5xl font-bold text-white/10 tracking-widest">
                  TIX
                </span>
              </div>
            </div>

            <div>
              <h1 className="text-4xl xl:text-5xl font-bold tracking-tight">
                TIXFLOW<span className="text-slate-500">.OS</span>
              </h1>
              <p className="mt-3 text-lg text-slate-400 max-w-md leading-relaxed">
                Sell tickets. Manage events. Get paid.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-md">
              {features.map(({ icon: Icon, label }) => (
                <div
                  key={label}
                  className="flex items-center gap-2 text-sm text-slate-300"
                >
                  <Icon className="w-4 h-4 text-indigo-400 shrink-0" />
                  {label}
                </div>
              ))}
            </div>

            {/* Floating decorative shapes */}
            <div className="absolute -top-10 -right-10 w-48 h-48 border border-slate-800/30 rounded-full -z-10 animate-pulse-slow" />
            <div className="absolute bottom-20 left-0 w-32 h-32 bg-indigo-500/10 rounded-full blur-2xl -z-10 animate-float" />
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-indigo-600/5 rounded-full blur-3xl -z-10" />
          </div>

          {/* ---- RIGHT PANEL: FORM CARD ---- */}
          <div className="flex items-center justify-center lg:justify-end">
            <div className="w-full max-w-md">
              {/* Brand on mobile */}
              <div className="lg:hidden text-center mb-6">
                <h1 className="text-2xl font-bold tracking-tight">
                  TIXFLOW<span className="text-slate-500">.OS</span>
                </h1>
                <p className="text-sm text-slate-400 mt-1">
                  Sell tickets. Manage events.
                </p>
              </div>

              <div className="bg-[#131924]/60 backdrop-blur-xl border border-slate-800/80 py-8 px-6 shadow-2xl rounded-2xl sm:px-10 transition-all">
                {errorMessage && (
                  <div
                    className={`mb-6 p-3 text-xs font-medium border rounded-md ${
                      errorMessage.includes("successfully")
                        ? "bg-emerald-950/30 text-emerald-400 border-emerald-800/50"
                        : "bg-rose-950/30 text-rose-400 border-rose-800/50"
                    }`}
                  >
                    {errorMessage}
                  </div>
                )}

                <form className="space-y-5" onSubmit={handleSubmit}>
                  {!isLogin && (
                    <>
                      <div>
                        <label className="block text-xs font-medium uppercase tracking-wider text-slate-400">
                          Organization Name
                        </label>
                        <div className="mt-1">
                          <input
                            type="text"
                            required
                            value={businessName}
                            onChange={(e) => setBusinessName(e.target.value)}
                            placeholder="e.g., Summit Tech Group"
                            className="block w-full bg-[#0B0F17] border border-slate-800 rounded-md px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-slate-400 focus:border-slate-400 transition"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-xs font-medium uppercase tracking-wider text-slate-400">
                          Administrator Full Name
                        </label>
                        <div className="mt-1">
                          <input
                            type="text"
                            required
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="Alex Mercer"
                            className="block w-full bg-[#0B0F17] border border-slate-800 rounded-md px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-slate-400 focus:border-slate-400 transition"
                          />
                        </div>
                      </div>
                    </>
                  )}

                  <div>
                    <label className="block text-xs font-medium uppercase tracking-wider text-slate-400">
                      Email Address
                    </label>
                    <div className="mt-1">
                      <input
                        type="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="name@company.com"
                        className="block w-full bg-[#0B0F17] border border-slate-800 rounded-md px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-slate-400 focus:border-slate-400 transition"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium uppercase tracking-wider text-slate-400">
                      Password
                    </label>
                    <div className="mt-1">
                      <input
                        type="password"
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="••••••••"
                        className="block w-full bg-[#0B0F17] border border-slate-800 rounded-md px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-slate-400 focus:border-slate-400 transition"
                      />
                    </div>
                  </div>

                  <div className="pt-2">
                    <button
                      type="submit"
                      disabled={isLoading}
                      className="w-full flex justify-center py-2.5 px-4 border border-slate-700 rounded-md text-sm font-medium text-white bg-slate-800 hover:bg-slate-700 focus:outline-none focus:ring-1 focus:ring-slate-400 disabled:opacity-50 disabled:cursor-not-allowed transition"
                    >
                      {isLoading
                        ? "Processing..."
                        : isLogin
                          ? "Sign In"
                          : "Initialize Workspace"}
                    </button>
                  </div>
                </form>

                <div className="mt-6 border-t border-slate-800/80 pt-6 text-center">
                  <button
                    type="button"
                    onClick={() => {
                      setIsLogin(!isLogin);
                      setErrorMessage("");
                    }}
                    className="text-xs text-slate-400 hover:text-white transition underline underline-offset-4"
                  >
                    {isLogin
                      ? "Need a workspace? Register your organization"
                      : "Already have a platform profile? Sign in"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile footer */}
      <div className="lg:hidden absolute bottom-4 text-center text-[10px] text-slate-600 w-full pointer-events-none">
        No monthly fee • Just a small cut per ticket
      </div>
    </div>
  );
}