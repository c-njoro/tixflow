// components/site/AssistantWidget.tsx
//
// The website chat assistant (Biz Smart widget, see docs/assistant/). It
// loads once, on the first public page someone opens, and draws itself
// into <body>. It stays loaded across client-side navigation, so on the
// working screens it's only hidden (see globals.css): organiser dashboards,
// the gate, the projector, and the in-room Event Space, whose bottom tab bar
// the launcher would cover.
import Script from "next/script";
import { useRouter } from "next/router";
import { useEffect } from "react";

const WIDGET_SRC = "https://bizsmart-api-t2l6.onrender.com/widget.js";
// Public by design: it only identifies Tixflow to the widget server.
const WIDGET_KEY = "wk_713d14f3d0db5921bf990528440cd7ea";

const HIDDEN_ON = ["/dashboard", "/platform-admin", "/space", "/exhibitor"];

export default function AssistantWidget() {
  const { pathname } = useRouter();
  const hidden = HIDDEN_ON.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  useEffect(() => {
    if (hidden) document.documentElement.dataset.noAssistant = "";
    else delete document.documentElement.dataset.noAssistant;
  }, [hidden]);

  if (hidden) return null;
  return <Script src={WIDGET_SRC} data-key={WIDGET_KEY} data-theme="dark" strategy="lazyOnload" />;
}
