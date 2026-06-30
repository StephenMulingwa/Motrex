"use client";

import { useState, useEffect, useRef, type CSSProperties } from "react";
import Image from "next/image";
import {
  Radio,
  Warehouse,
  Route,
  BarChart3,
  Leaf,
  MapPin,
  Menu,
  LogOut,
} from "lucide-react";
import LiveMonitor from "./LiveMonitor";
import { YardsTab, TripsTab, TripsSummaryTab, UtilizationTab, EcoDrivingTab } from "./ReportTabs";
import MapTab from "./MapTab";
import type { LiveMonitorDataset } from "@/lib/data";
import { useLiveMonitor } from "@/lib/useLiveMonitor";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { LAYOUT_NARROW_QUERY } from "@/lib/breakpoints";

const TABS = [
  { id: "live", label: "Live Monitor", icon: Radio },
  { id: "yards", label: "Yards", icon: Warehouse },
  { id: "utilization", label: "Utilization", icon: BarChart3 },
  { id: "eco", label: "Eco Driving", icon: Leaf },
  { id: "reports", label: "Reports", icon: Route },
] as const;

type TabId = (typeof TABS)[number]["id"];

interface AppShellProps {
  onLogout: () => void;
  initialLiveData?: LiveMonitorDataset | null;
}

export default function AppShell({ onLogout, initialLiveData = null }: AppShellProps) {
  const [activeTab, setActiveTab] = useState<TabId>("live");
  const [reportsView, setReportsView] = useState<"home" | "trips" | "summary" | "map">("home");
  const [clock, setClock] = useState("");
  const [sidebarHover, setSidebarHover] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const headerRef = useRef<HTMLElement | null>(null);
  const { data, loading, error, refresh } = useLiveMonitor(initialLiveData);
  const isMobileNav = useMediaQuery(LAYOUT_NARROW_QUERY);

  useEffect(() => {
    if (activeTab !== "live") return;
    const iv = setInterval(refresh, 5 * 60 * 1000);
    return () => clearInterval(iv);
  }, [activeTab, refresh]);

  useEffect(() => {
    const el = headerRef.current;
    if (!el || typeof document === "undefined") return;
    const setVar = () => {
      const h = Math.ceil(el.getBoundingClientRect().height);
      document.documentElement.style.setProperty("--app-shell-header-h", `${h}px`);
    };
    setVar();
    const ro = new ResizeObserver(setVar);
    ro.observe(el);
    window.addEventListener("resize", setVar);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", setVar);
      document.documentElement.style.removeProperty("--app-shell-header-h");
    };
  }, []);

  useEffect(() => {
    if (!isMobileNav || !mobileNavOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileNavOpen(false);
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [isMobileNav, mobileNavOpen]);

  useEffect(() => {
    const tick = () => {
      setClock(
        new Date().toLocaleString("en-GB", {
          timeZone: "Africa/Nairobi",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
      );
    };
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, []);

  const goTab = (id: TabId) => {
    setActiveTab(id);
    setMobileNavOpen(false);
    setReportsView("home");
  };

  const panelStyle = (id: TabId): CSSProperties => ({
    display: activeTab === id ? "block" : "none",
  });

  const headerPadStyle: CSSProperties = isMobileNav
    ? {
        paddingTop: "calc(12px + env(safe-area-inset-top, 0px))",
        paddingBottom: 10,
        paddingLeft: "max(10px, env(safe-area-inset-left, 0px))",
        paddingRight: "max(10px, env(safe-area-inset-right, 0px))",
      }
    : {
        paddingTop: "calc(9px + env(safe-area-inset-top, 0px))",
        paddingBottom: 9,
        paddingLeft: "max(24px, env(safe-area-inset-left, 0px))",
        paddingRight: "max(24px, env(safe-area-inset-right, 0px))",
      };

  const mainPadStyle: CSSProperties = isMobileNav
    ? {
        paddingTop: 14,
        paddingLeft: 12,
        paddingRight: 12,
        paddingBottom: "max(20px, env(safe-area-inset-bottom, 0px))",
      }
    : {
        paddingTop: 24,
        paddingLeft: 28,
        paddingRight: 28,
        paddingBottom: "max(24px, env(safe-area-inset-bottom, 0px))",
      };

  const tabButtonStyle = (isActive: boolean, fullLabel: boolean): CSSProperties => ({
    width: fullLabel ? "100%" : "calc(100% - 16px)",
    display: "flex",
    alignItems: "center",
    gap: "12px",
    padding: "12px 14px",
    borderRadius: "var(--radius-sm)",
    cursor: "pointer",
    border: isActive ? "1px solid rgba(255,212,81,0.9)" : "1px solid transparent",
    background: isActive ? "rgba(255,255,255,0.2)" : "transparent",
    whiteSpace: "nowrap",
    textAlign: "left",
    justifyContent: "flex-start",
  });

  const sidebarFooter = (expanded: boolean) => (
    <div
      style={{
        marginTop: "auto",
        width: expanded ? "100%" : "calc(100% - 16px)",
        borderTop: "1px solid rgba(255,255,255,0.26)",
        paddingTop: "12px",
        display: "flex",
        alignItems: "center",
        gap: "10px",
        overflow: "hidden",
        paddingLeft: expanded ? 10 : 0,
        paddingRight: expanded ? 10 : 0,
      }}
    >
      <a
        href="https://www.controltech-ea.com/"
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: "flex",
          alignItems: "center",
          gap: "10px",
          textDecoration: "none",
          color: "rgba(255,255,255,0.95)",
          fontSize: ".72rem",
          fontWeight: 700,
          whiteSpace: "nowrap",
          overflow: "hidden",
        }}
      >
        <span
          style={{
            opacity: expanded ? 1 : 0,
            width: expanded ? "auto" : 0,
            transition: "opacity .2s ease .08s",
          }}
        >
          Powered by ControlTech
        </span>
        <Image
          src="/controltech_logo.png"
          alt="ControlTech"
          width={expanded ? 24 : 18}
          height={expanded ? 24 : 18}
          style={{ borderRadius: 4, flexShrink: 0, transition: "width .2s ease, height .2s ease" }}
        />
      </a>
    </div>
  );

  const renderTabButtons = (expanded: boolean) =>
    TABS.map((tab) => {
      const isActive = activeTab === tab.id;
      const Icon = tab.icon;
      return (
        <button
          key={tab.id}
          type="button"
          onClick={() => goTab(tab.id)}
          style={tabButtonStyle(isActive, expanded)}
        >
          <span
            style={{
              width: "22px",
              minWidth: "22px",
              textAlign: "center",
              color: isActive ? "#ffd451" : "rgba(255,255,255,0.95)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Icon size={18} />
          </span>
          <span
            style={{
              fontSize: expanded ? ".82rem" : ".82rem",
              fontWeight: 700,
              color: isActive ? "#ffd451" : "rgba(255,255,255,0.95)",
              opacity: expanded ? 1 : 0,
              transform: expanded ? "none" : "translateX(-6px)",
              transition: "opacity .2s ease .08s, transform .2s ease .08s",
            }}
          >
            {tab.label}
          </span>
        </button>
      );
    });

  const reportCards = [
    {
      id: "trips" as const,
      title: "Athi River / Tororo Trips",
      description: "Outbound and inbound trip details by vehicle",
      icon: Route,
      background: "linear-gradient(135deg, rgba(219,234,254,0.95), rgba(239,246,255,0.92))",
      color: "#2563eb",
    },
    {
      id: "summary" as const,
      title: "Summary",
      description: "Trip summary statistics aggregated per vehicle",
      icon: BarChart3,
      background: "linear-gradient(135deg, rgba(255,228,230,0.95), rgba(255,241,242,0.92))",
      color: "#be123c",
    },
    {
      id: "map" as const,
      title: "Map",
      description: "Live positions of all fleet vehicles on an interactive map",
      icon: MapPin,
      background: "linear-gradient(135deg, rgba(219,234,254,0.92), rgba(248,250,252,0.95))",
      color: "#1d4ed8",
    },
  ];

  const backButtonStyle: CSSProperties = {
    marginBottom: 14,
    padding: "8px 14px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--surface)",
    color: "var(--text)",
    cursor: "pointer",
    fontWeight: 700,
  };

  const renderReports = () => {
    return (
      <div>
        <div style={{ display: reportsView === "home" ? "block" : "none" }}>
          <div style={{ marginBottom: 18 }}>
          <h1 style={{ margin: 0, fontSize: "1.45rem", color: "var(--text)" }}>Reports</h1>
          <p style={{ margin: "8px 0 0", color: "var(--text2)", fontSize: ".86rem", maxWidth: 760 }}>
            Pick a report below to open its dedicated view. You can choose a time window, filter by vehicles, and review data from Neon.
          </p>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
              gap: 16,
            }}
          >
            {reportCards.map((card) => {
              const Icon = card.icon;
              return (
                <button
                  key={card.id}
                  type="button"
                  onClick={() => setReportsView(card.id)}
                  style={{
                    minHeight: 156,
                    border: "1px solid rgba(148,163,184,0.35)",
                    borderRadius: 14,
                    padding: 18,
                    background: card.background,
                    boxShadow: "0 16px 34px rgba(15,23,42,0.08)",
                    textAlign: "left",
                    cursor: "pointer",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-between",
                    color: "var(--text)",
                  }}
                >
                  <span
                    style={{
                      width: 42,
                      height: 42,
                      borderRadius: 12,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      background: "rgba(255,255,255,0.58)",
                      color: card.color,
                    }}
                  >
                  <Icon size={21} />
                  </span>
                  <span>
                    <strong style={{ display: "block", fontSize: "1rem", marginBottom: 6 }}>{card.title}</strong>
                    <span style={{ display: "block", color: "var(--text2)", fontSize: ".8rem", lineHeight: 1.4 }}>
                      {card.description}
                    </span>
                  </span>
                  <span style={{ color: "#b91c1c", fontSize: ".8rem", fontWeight: 800 }}>Open report {"->"}</span>
                </button>
              );
            })}
          </div>
        </div>
        <div style={{ display: reportsView === "trips" ? "block" : "none" }}>
          <button type="button" onClick={() => setReportsView("home")} style={backButtonStyle}>
            Back to Reports
          </button>
          <TripsTab />
        </div>
        <div style={{ display: reportsView === "summary" ? "block" : "none" }}>
          <button type="button" onClick={() => setReportsView("home")} style={backButtonStyle}>
            Back to Reports
          </button>
          <TripsSummaryTab />
        </div>
        {reportsView === "map" && (
          <div>
            <button type="button" onClick={() => setReportsView("home")} style={backButtonStyle}>
              Back to Reports
            </button>
            <MapTab data={data} loading={loading} error={error} onRefresh={refresh} />
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
      <header
        ref={headerRef}
        className="app-shell-header"
        style={{
          ...headerPadStyle,
          position: "sticky",
          top: 0,
          zIndex: 300,
          background: "linear-gradient(90deg, #1a1a2e 0%, #c41e3a 55%, #8b0000 100%)",
          borderBottom: "1px solid rgba(255,255,255,0.2)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
          {isMobileNav && (
            <button
              type="button"
              aria-label="Open menu"
              onClick={() => setMobileNavOpen(true)}
              style={{
                width: 44,
                height: 44,
                borderRadius: 8,
                border: "1px solid rgba(255,255,255,0.3)",
                background: "rgba(255,255,255,0.1)",
                color: "#fff",
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Menu size={22} />
            </button>
          )}
          <Image
            src="/motrex-logo.jpg"
            alt="Motrex"
            width={44}
            height={44}
            style={{ borderRadius: 8, objectFit: "contain" }}
          />
          <span style={{ fontFamily: "var(--font-head)", fontWeight: 700, color: "#fff", fontSize: "1rem" }}>
            Motrex <span style={{ color: "#ffd451" }}>Fleet Insights</span>
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: ".72rem", color: "rgba(255,255,255,0.85)", fontFamily: "var(--font-mono)" }}>
            {clock} EAT
          </span>
          <button
            type="button"
            onClick={onLogout}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "8px 14px",
              borderRadius: 8,
              border: "1px solid rgba(255,255,255,0.35)",
              background: "rgba(255,255,255,0.1)",
              color: "#fff",
              cursor: "pointer",
              fontSize: ".78rem",
            }}
          >
            <LogOut size={16} /> Sign out
          </button>
        </div>
      </header>

      {isMobileNav && mobileNavOpen && (
        <div
          style={{
            position: "fixed",
            left: 0,
            right: 0,
            top: "var(--app-shell-header-h, 64px)",
            bottom: 0,
            zIndex: 260,
            pointerEvents: "auto",
          }}
        >
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setMobileNavOpen(false)}
            style={{
              position: "absolute",
              inset: 0,
              border: "none",
              padding: 0,
              margin: 0,
              background: "rgba(15, 40, 90, 0.45)",
              cursor: "pointer",
            }}
          />
          <nav
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              bottom: 0,
              width: "min(300px, 88vw)",
              minHeight: 0,
              background: "linear-gradient(180deg, #1a1a2e 0%, #2d2d44 100%)",
              borderRight: "1px solid rgba(255,255,255,0.22)",
              boxShadow: "12px 0 40px rgba(9, 40, 112, 0.35)",
              display: "flex",
              flexDirection: "column",
              padding: "12px 10px 18px",
              animation: "fadeUp .22s ease",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                flexGrow: 1,
                flexShrink: 1,
                flexBasis: 0,
                minHeight: 0,
                overflowY: "auto",
                display: "flex",
                flexDirection: "column",
                gap: 4,
                WebkitOverflowScrolling: "touch",
              }}
            >
              {renderTabButtons(true)}
            </div>
            {sidebarFooter(true)}
          </nav>
        </div>
      )}

      <div style={{ display: "flex", flex: 1, position: "relative", zIndex: 1, alignItems: "stretch" }}>
        <nav
          aria-hidden={isMobileNav}
          onMouseEnter={() => !isMobileNav && setSidebarHover(true)}
          onMouseLeave={() => !isMobileNav && setSidebarHover(false)}
          style={{
            display: isMobileNav ? "none" : "flex",
            width: sidebarHover ? "220px" : "76px",
            background: "linear-gradient(180deg, #1a1a2e 0%, #2d2d44 100%)",
            borderRight: "1px solid rgba(255,255,255,0.24)",
            flexDirection: "column",
            alignItems: "center",
            padding: "18px 0",
            gap: "6px",
            position: "sticky",
            top: "var(--app-shell-header-h, 64px)",
            height: "calc(100vh - var(--app-shell-header-h, 64px))",
            overflow: "hidden",
            transition: "width .28s cubic-bezier(.4,0,.2,1)",
            flexShrink: 0,
          }}
        >
          {renderTabButtons(sidebarHover)}
          {sidebarFooter(sidebarHover)}
        </nav>

        <main style={{ flex: 1, minWidth: 0, ...mainPadStyle }}>
          <div style={panelStyle("live")}>
            <LiveMonitor data={data} loading={loading} error={error} onRefresh={refresh} />
          </div>
          <div style={panelStyle("yards")}>
            <YardsTab />
          </div>
          <div style={panelStyle("reports")}>
            {renderReports()}
          </div>
          <div style={panelStyle("utilization")}>
            <UtilizationTab />
          </div>
          <div style={panelStyle("eco")}>
            <EcoDrivingTab />
          </div>
        </main>
      </div>
    </div>
  );
}
