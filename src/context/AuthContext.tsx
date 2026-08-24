// context/AuthContext.tsx
import {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
} from "react";
import { useRouter } from "next/router";

interface TenantUser {
  id: string;
  name: string;
  email: string;
  companyName: string;
  role: 'admin' | 'scanner_staff';
}

interface AuthContextType {
  user: TenantUser | null;
  loading: boolean;
  login: (userData: TenantUser) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<TenantUser | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  // Check if tenant session exists on initial load
  useEffect(() => {
    const savedUser = localStorage.getItem("tixflow_tenant");
    if (savedUser) {
      setUser(JSON.parse(savedUser));
    }
    setLoading(false);
  }, []);

  const login = (userData: TenantUser) => {
    setUser(userData);
    localStorage.setItem("tixflow_tenant", JSON.stringify(userData));
    router.push("/dashboard");
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem("tixflow_tenant");
    router.push("/");
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}