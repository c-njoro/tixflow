// components/site/ErrorBoundary.tsx
//
// Catches a page crashing in the browser, so people get a way forward
// instead of a blank screen. Clears itself when they move to another page.
import { Component, type ErrorInfo, type ReactNode } from "react";
import StatusPage, { StatusBlock } from "@/components/site/StatusPage";

interface Props {
  children: ReactNode;
  resetKey: string; // the current address
  // "block" keeps the surrounding layout (the dashboard's sidebar) on screen.
  variant?: "page" | "block";
}

const CRASH = {
  verdict: "Error",
  tone: "rose" as const,
  title: "This page hit a problem.",
  message: "Reloading usually fixes it. If it keeps happening, tell us what you were doing when it stopped.",
};

export default class ErrorBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("CRITICAL_PAGE_CRASH:", error, info.componentStack);
  }

  componentDidUpdate(prev: Props) {
    if (this.state.failed && prev.resetKey !== this.props.resetKey) this.setState({ failed: false });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    if (this.props.variant === "block") {
      return <StatusBlock label="TIX-ERR" {...CRASH} actions={[{ label: "Reload page" }, { label: "Back to overview", href: "/dashboard" }]} />;
    }
    return <StatusPage label="TIX-ERR" content={{ ...CRASH, actions: [{ label: "Reload page" }, { label: "Browse events", href: "/" }] }} />;
  }
}
