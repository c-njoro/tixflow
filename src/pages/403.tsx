// pages/403.tsx — "you can't open this". Next has no automatic 403, so
// pages send people here (or render <StatusPage code={403} />) themselves.
import StatusPage from "@/components/site/StatusPage";

export default function ForbiddenPage() {
  return <StatusPage code={403} />;
}
