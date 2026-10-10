// pages/404.tsx — any address that doesn't exist (and `notFound: true`).
import StatusPage from "@/components/site/StatusPage";

export default function NotFoundPage() {
  return <StatusPage code={404} />;
}
