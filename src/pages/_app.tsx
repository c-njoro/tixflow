// pages/_app.tsx
import "@/styles/globals.css";
import "@fontsource/poppins/300.css";
import "@fontsource/poppins/400.css";
import "@fontsource/poppins/500.css";
import "@fontsource/poppins/600.css";
import "@fontsource/poppins/700.css";
import type { AppProps } from "next/app";
import { useRouter } from "next/router";
import { useEffect } from "react";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import DashboardLayout from "@/components/dashboard/DashboardLayout";

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
      <div className="min-h-screen bg-[#0B0F17] flex items-center justify-center font-mono text-xs text-slate-500 uppercase tracking-widest">
        Checking Account...
      </div>
    );
  }

  return <>{children}</>;
}

export default function App({ Component, pageProps }: AppProps) {
  const router = useRouter();
  const isDashboardRoute = router.pathname.startsWith("/dashboard");

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
    </AuthProvider>
  );
}
