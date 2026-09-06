"use client";
import Link from "next/link";
import { useEffect } from "react";
import { isNative, NativeRecorder } from "@/lib/audio";
import { usePathname } from "next/navigation";
import {
  Focus,
  Play,
  History,
  SlidersHorizontal,
  HardDrive,
  ArrowUpRight,
  LayoutDashboard,
} from "lucide-react";
export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  useEffect(() => {
    if (!isNative()) return;
    let cancelled = false;
    let remove: (() => Promise<void>) | undefined;
    const apply = (data: { textScale?: number }) => {
      if (!cancelled && data.textScale)
        document.documentElement.style.fontSize = `${16 * data.textScale}px`;
    };
    NativeRecorder.accessibilitySettings()
      .then(apply)
      .catch(() => {});
    NativeRecorder.addListener("accessibilityChanged", apply).then((handle) => {
      if (cancelled) void handle.remove();
      else remove = () => handle.remove();
    });
    return () => {
      cancelled = true;
      void remove?.();
    };
  }, []);
  const items = [
    { href: "/research/", label: "Overview", icon: LayoutDashboard },
    { href: "/sessions/", label: "Session history", icon: History },
    { href: "/settings/", label: "Configuration", icon: SlidersHorizontal },
  ];
  if (path === "/" || path.startsWith("/train")) return <>{children}</>;
  if (path.startsWith("/settings") || path.startsWith("/guide")) return <main id="main" className="setup-workspace">{children}</main>;
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to main content
      </a>
      <aside className="sidebar">
        <Link href="/" className="brand" aria-label="MLPT home">
          <span className="brand-icon">
            <Focus aria-hidden="true" />
          </span>
          <span>
            MLPT<span className="brand-sub">Researcher workspace</span>
          </span>
        </Link>
        <div className="nav-label">RESEARCHER</div>
        <nav aria-label="Main navigation">
          {items.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              aria-current={path === href ? "page" : undefined}
              className={path === href ? "nav-item active" : "nav-item"}
            >
              <Icon size={21} aria-hidden="true" />
              {label}
            </Link>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="local-status">
            <HardDrive size={18} aria-hidden="true" />
            <span>Stored on this device</span>
          </div>
          <p>Local training data</p>
          <a href="/">
            Participant app <ArrowUpRight size={16} aria-hidden="true" />
          </a>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <span>MLPT researcher workspace</span>
          <span className="pill">
            <span className="status-dot" />
            Local workspace
          </span>
        </header>
        <main id="main" tabIndex={-1}>
          {children}
        </main>
        <footer className="footer">
          <span>At your pace. One trial at a time.</span>
          <span>MLPT · Training workspace</span>
        </footer>
      </div>
    </div>
  );
}
