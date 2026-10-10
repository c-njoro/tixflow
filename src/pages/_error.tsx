// pages/_error.tsx — every other error status (400, 401, 429, 503…), on the
// server or during client-side navigation. 404 and 500 have their own
// static pages.
import type { NextPageContext } from "next";
import StatusPage from "@/components/site/StatusPage";

function ErrorPage({ statusCode }: { statusCode: number }) {
  return <StatusPage code={statusCode} />;
}

ErrorPage.getInitialProps = ({ res, err }: NextPageContext) => ({
  statusCode: res?.statusCode ?? err?.statusCode ?? 404,
});

export default ErrorPage;
