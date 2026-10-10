// pages/500.tsx — a page failed on the server.
import StatusPage from "@/components/site/StatusPage";

export default function ServerErrorPage() {
  return <StatusPage code={500} />;
}
