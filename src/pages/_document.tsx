import { Html, Head, Main, NextScript } from "next/document";
import { THEME_INIT_SCRIPT } from "@/lib/theme";

export default function Document() {
  return (
    <Html lang="en" data-theme="dark">
      <Head>
        {/* Sets light/dark mode before the first paint, so pages never flash the wrong one. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        {/* The sidebar's "t" mark (src/components/dashboard/Sidebar.tsx). */}
        <link rel="icon" href="/favicon.ico" sizes="32x32" />
        <link rel="icon" href="/icon-192.png" type="image/png" sizes="192x192" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
      </Head>
      <body className="antialiased">
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
