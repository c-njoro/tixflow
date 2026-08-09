// pages/_app.tsx
import "@/styles/globals.css";
import type { AppProps } from "next/app";
import { useRouter } from "next/router";
import { useEffect } from "react";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import DashboardLayout from "@/components/dashboard/DashboardLayout";

// 1. Import Poppins from next/font
import { Poppins } from "next/font/google";

// 2. Configure the font with desired weights and subsets
const poppins = Poppins({
  weight: ["300", "400", "500", "600", "700"],
  subsets: ["latin"],
  display: "swap", // optional, improves loading performance
});

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
      {/* 3. Apply the font class to the main container */}
      <main className={poppins.className}>
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
