// pages/_app.tsx
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "@fontsource-variable/bricolage-grotesque/standard.css";
import "@/styles/globals.css";
import type { AppProps } from "next/app";
import { useRouter } from "next/router";
import { useEffect } from "react";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import DashboardLayout from "@/components/dashboard/DashboardLayout";
import AssistantWidget from "@/components/site/AssistantWidget";
import { followSystemTheme } from "@/lib/theme";

// AuthGuard (unchanged)
function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      router.push("/");
    }
  }, [user, loading, router]);

  if (loading || !user) {
    return (
      <div className="min-h-screen bg-ink flex items-center justify-center text-sm text-slate-500">
        <span className="w-4 h-4 mr-3 rounded-full border-2 border-slate-700 border-t-slate-300 animate-spin" />
        Loading your workspace…
      </div>
    );
  }

  return <>{children}</>;
}

export default function App({ Component, pageProps }: AppProps) {
  const router = useRouter();
  const isDashboardRoute = router.pathname.startsWith("/dashboard");

  useEffect(() => followSystemTheme(), []);

  return (
    <AuthProvider>
      <main>
        {isDashboardRoute ? (
          <AuthGuard>
            <DashboardLayout>
              <Component {...pageProps} />
            </DashboardLayout>
          </AuthGuard>
        ) : (
          <Component {...pageProps} />
        )}
      </main>
      <AssistantWidget />
    </AuthProvider>
  );
}
