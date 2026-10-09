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
import Link from 'next/link';
import { Wordmark } from '@/components/dashboard/Sidebar';
import { inputClass, labelClass } from '@/lib/ui';

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
    <div className="min-h-dvh bg-ink text-slate-100 grid lg:grid-cols-[1.1fr_1fr]">
      <aside className="hidden lg:flex flex-col justify-between p-12 border-r border-slate-800/60 bg-deep">
        <Link href="/" aria-label="Tixflow home">
          <Wordmark />
        </Link>
        <div>
          <h1 className="font-display text-6xl xl:text-7xl leading-[0.95] font-semibold max-w-lg">
            Sell tickets. <span className="text-slate-500">Manage events.</span> Get paid.
          </h1>
          <ul className="mt-10 grid grid-cols-2 gap-x-8 gap-y-3 max-w-md">
            {features.map(({ icon: Icon, label }) => (
              <li key={label} className="flex items-center gap-2.5 text-sm text-slate-300">
                <Icon className="w-4 h-4 text-slate-500 shrink-0" />
                {label}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-sm text-slate-500">No monthly fee — just a small cut per ticket sold.</p>
      </aside>

      <main className="flex flex-col justify-center px-5 py-10 sm:px-10">
        <div className="w-full max-w-sm mx-auto">
          <Link href="/" aria-label="Tixflow home" className="lg:hidden inline-block mb-10">
            <Wordmark />
          </Link>
          <h2 className="font-display text-3xl font-semibold">{isLogin ? 'Log in' : 'Create your workspace'}</h2>
          <p className="mt-2 text-sm text-slate-400">
            {isLogin ? 'Welcome back. Log in to manage your events.' : 'Set up your organisation in a couple of minutes — no paperwork.'}
          </p>

          {errorMessage && (
            <div
              role="alert"
              className={`mt-6 p-3 text-sm border rounded-lg ${
                errorMessage.includes("successfully")
                  ? "bg-emerald-950/30 text-emerald-300 border-emerald-800/50"
                  : "bg-rose-950/30 text-rose-300 border-rose-800/50"
              }`}
            >
              {errorMessage}
            </div>
          )}

          <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
            {!isLogin && (
              <>
                <div>
                  <label htmlFor="businessName" className={labelClass}>
                    Organisation name
                  </label>
                  <input
                    id="businessName"
                    type="text"
                    required
                    autoComplete="organization"
                    value={businessName}
                    onChange={(e) => setBusinessName(e.target.value)}
                    placeholder="e.g. Summit Tech Group"
                    className={`${inputClass} mt-1.5`}
                  />
                </div>
                <div>
                  <label htmlFor="name" className={labelClass}>
                    Your full name
                  </label>
                  <input
                    id="name"
                    type="text"
                    required
                    autoComplete="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Wanjiru Kamau"
                    className={`${inputClass} mt-1.5`}
                  />
                </div>
              </>
            )}
                <div>
                  <label htmlFor="email" className={labelClass}>
                    Email
                  </label>
                  <input
                    id="email"
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@company.com"
                    className={`${inputClass} mt-1.5`}
                  />
                </div>
                <div>
                  <label htmlFor="password" className={labelClass}>
                    Password
                  </label>
                  <input
                    id="password"
                    type="password"
                    required
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="At least 8 characters"
                    className={`${inputClass} mt-1.5`}
                  />
                </div>
            <button
              type="submit"
              disabled={isLoading}
              className="w-full h-11 rounded-lg text-sm font-medium bg-slate-100 text-ink hover:bg-white disabled:opacity-50 transition-colors"
            >
              {isLoading ? 'Please wait…' : isLogin ? 'Log in' : 'Create workspace'}
            </button>
          </form>

          <p className="mt-8 text-sm text-slate-400">
            {isLogin ? 'New to Tixflow?' : 'Already have an account?'}{' '}
            <button
              type="button"
              onClick={() => {
                setIsLogin(!isLogin);
                setErrorMessage("");
              }}
              className="font-medium text-white underline hover:text-slate-200"
            >
              {isLogin ? 'Create a workspace' : 'Log in'}
            </button>
          </p>
        </div>
      </main>
    </div>
  );
}