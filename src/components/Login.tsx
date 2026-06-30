"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";

interface LoginProps {
  onLogin: () => Promise<void>;
}

const HERO_TAGS = [
  "Live GPS",
  "Fleet Health",
  "Driver Behavior",
  "Trip Insights",
  "Route Analytics",
];

export default function Login({ onLogin }: LoginProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [progressStep, setProgressStep] = useState(-1);
  const [year, setYear] = useState<number | null>(null);

  useEffect(() => {
    setYear(new Date().getFullYear());
  }, []);

  useEffect(() => {
    if (!loading) {
      setProgressStep(-1);
      return;
    }
    const timers: ReturnType<typeof setTimeout>[] = [];
    timers.push(setTimeout(() => setProgressStep(0), 80));
    timers.push(setTimeout(() => setProgressStep(1), 900));
    timers.push(setTimeout(() => setProgressStep(2), 1900));
    return () => {
      timers.forEach((t) => clearTimeout(t));
    };
  }, [loading]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const authResponse = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        cache: "no-store",
        body: JSON.stringify({
          username,
          password,
        }),
      });

      if (!authResponse.ok) {
        let message = "Invalid username or password";
        try {
          const payload = (await authResponse.json()) as { error?: string };
          if (payload?.error) {
            message = payload.error;
          }
        } catch {
          message = authResponse.status === 401
            ? "Invalid username or password"
            : "Sign-in failed.";
        }
        throw new Error(message);
      }

      await onLogin();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load report data.";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="login-root login-grid"
      style={{
        background: "var(--bg)",
        color: "var(--text)",
      }}
    >
      {/* ─────────────── HERO PANEL (LEFT) ─────────────── */}
      <aside
        className="login-hero"
        style={{
          position: "relative",
          overflow: "hidden",
          minHeight: "100dvh",
        }}
      >
          {/* Motrex hero background */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/Motrex_Login.gif"
            alt="Motrex fleet operations"
            className="ena-hero-img"
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
            }}
          />

          {/* Dark navy gradient for readability */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              background:
                "linear-gradient(135deg, rgba(7,18,40,0.72) 0%, rgba(17,40,77,0.55) 45%, rgba(0,0,0,0.68) 100%)",
            }}
          />

          {/* Soft warm radial glow (matches Ena gold accent) */}
          <div
            className="ena-hero-overlay"
            style={{
              position: "absolute",
              inset: 0,
              background:
                "radial-gradient(circle at 28% 30%, rgba(245,179,0,0.28), transparent 55%)",
              pointerEvents: "none",
            }}
          />

          {/* Diagonal sheen sweep */}
          <div
            className="ena-hero-sheen"
            style={{
              position: "absolute",
              top: "-25%",
              bottom: "-25%",
              left: 0,
              width: "33%",
              background:
                "linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.28) 50%, rgba(255,255,255,0) 100%)",
              pointerEvents: "none",
              filter: "blur(6px)",
            }}
          />

          {/* Hero copy block */}
          <div
            style={{
              position: "relative",
              zIndex: 1,
              height: "100%",
              minHeight: "100dvh",
              display: "flex",
              flexDirection: "column",
              justifyContent: "flex-end",
              padding: "40px 44px 48px",
              color: "#f8fafc",
            }}
          >
            <div style={{ maxWidth: "560px", display: "flex", flexDirection: "column", gap: "14px" }}>
              {/* Live operations badge */}
              <span
                style={{
                  alignSelf: "flex-start",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "8px",
                  border: "1px solid rgba(255,255,255,0.22)",
                  background: "rgba(7,18,40,0.45)",
                  backdropFilter: "blur(10px)",
                  WebkitBackdropFilter: "blur(10px)",
                  padding: "6px 14px",
                  borderRadius: "999px",
                  fontFamily: "var(--font-head)",
                  fontSize: ".7rem",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: ".12em",
                  color: "#f8fafc",
                  textShadow: "0 1px 2px rgba(0,0,0,0.65)",
                }}
              >
                <span style={{ position: "relative", display: "inline-flex", height: "8px", width: "8px" }}>
                  <span
                    style={{
                      position: "absolute",
                      inset: 0,
                      borderRadius: "999px",
                      background: "var(--accent)",
                      opacity: 0.7,
                      animation: "pulse 1.6s cubic-bezier(0,0,0.2,1) infinite",
                    }}
                  />
                  <span
                    style={{
                      position: "relative",
                      display: "inline-flex",
                      height: "8px",
                      width: "8px",
                      borderRadius: "999px",
                      background: "var(--accent)",
                      boxShadow: "0 0 10px rgba(245,179,0,0.95)",
                    }}
                  />
                </span>
                Live operations
              </span>

              {/* Headline */}
              <h1
                style={{
                  fontFamily: "var(--font-head)",
                  fontSize: "clamp(1.85rem, 2.4vw, 2.6rem)",
                  fontWeight: 800,
                  lineHeight: 1.18,
                  letterSpacing: "-0.01em",
                  color: "#fafafa",
                  textShadow:
                    "0 1px 1px rgba(0,0,0,0.9), 0 2px 16px rgba(0,0,0,0.55), 0 6px 40px rgba(7,18,40,0.75)",
                }}
              >
                Monitor{" "}
                <span
                  style={{
                    color: "#ffd451",
                    fontWeight: 800,
                    textShadow:
                      "0 1px 2px rgba(0,0,0,0.85), 0 0 24px rgba(245,179,0,0.4), 0 4px 20px rgba(0,0,0,0.5)",
                  }}
                >
                  live fleet positions
                </span>{" "}
                and unlock{" "}
                <span
                  style={{
                    color: "#ffd451",
                    fontWeight: 800,
                    textShadow:
                      "0 1px 2px rgba(0,0,0,0.85), 0 0 24px rgba(245,179,0,0.4), 0 4px 20px rgba(0,0,0,0.5)",
                  }}
                >
                  real-time fleet insights.
                </span>
              </h1>

              {/* Body paragraph */}
              <p
                style={{
                  maxWidth: "520px",
                  fontSize: ".95rem",
                  lineHeight: 1.6,
                  fontWeight: 400,
                  color: "rgba(248,250,252,0.94)",
                  textShadow: "0 1px 3px rgba(0,0,0,0.75), 0 2px 14px rgba(0,0,0,0.35)",
                }}
              >
                Track every Motrex vehicle across Kenya with{" "}
                <span style={{ color: "#fde68a", fontWeight: 600 }}>second-by-second telemetry</span>,
                driver behavior scores, and trip-level analytics in one secure operations workspace.
              </p>

              {/* Feature tag pills */}
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginTop: "4px" }}>
                {HERO_TAGS.map((tag) => (
                  <span
                    key={tag}
                    style={{
                      fontFamily: "var(--font-head)",
                      fontSize: ".72rem",
                      fontWeight: 700,
                      color: "#f8fafc",
                      padding: "5px 12px",
                      borderRadius: "999px",
                      border: "1px solid rgba(255, 212, 81, 0.35)",
                      background: "rgba(7,18,40,0.45)",
                      backdropFilter: "blur(10px)",
                      WebkitBackdropFilter: "blur(10px)",
                      boxShadow:
                        "0 1px 3px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.08)",
                      textShadow: "0 1px 2px rgba(0,0,0,0.6)",
                      letterSpacing: ".04em",
                    }}
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </aside>

      {/* ─────────────── FORM PANEL (RIGHT) ─────────────── */}
      <section
        className="login-form-panel"
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          background: "var(--bg)",
          position: "relative",
          minHeight: "100dvh",
          overflowY: "auto",
        }}
      >
        {/* Soft accent glow behind the card */}
        <div
          style={{
            position: "absolute",
            top: "18%",
            left: "50%",
            transform: "translateX(-50%)",
            width: "440px",
            height: "440px",
            background:
              "radial-gradient(circle, rgba(245,179,0,0.10) 0%, transparent 70%)",
            pointerEvents: "none",
          }}
        />

        <div
          style={{
            width: "100%",
            maxWidth: "420px",
            margin: "0 auto",
            position: "relative",
            zIndex: 1,
          }}
        >
          {/* Floating logo card */}
          <div
            className="ena-hero-float"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "12px",
              width: "fit-content",
              maxWidth: "100%",
              margin: "0 auto 20px",
              padding: "10px 18px",
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: "16px",
              boxShadow: "var(--shadow)",
            }}
          >
            <Image
              src="/motrex-logo.jpg"
              alt="Motrex Limited"
              width={42}
              height={42}
              priority
              style={{
                width: "42px",
                height: "42px",
                borderRadius: "10px",
                flexShrink: 0,
                objectFit: "contain",
              }}
            />
            <div style={{ minWidth: 0 }}>
              <p
                style={{
                  fontFamily: "var(--font-head)",
                  fontSize: "1.05rem",
                  fontWeight: 800,
                  color: "var(--text)",
                  lineHeight: 1.1,
                }}
              >
                Motrex Limited
              </p>
              <p
                style={{
                  fontFamily: "var(--font-head)",
                  fontSize: ".66rem",
                  fontWeight: 700,
                  color: "var(--text2)",
                  textTransform: "uppercase",
                  letterSpacing: ".18em",
                  marginTop: "2px",
                }}
              >
                Fleet Insights
              </p>
            </div>
          </div>

          {/* Main card */}
          <div
            className="card-rise"
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: "20px",
              padding: "28px 28px 26px",
              boxShadow: "var(--shadow)",
            }}
          >
            {/* Secure sign-in badge */}
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                background: "var(--surface2)",
                border: "1px solid var(--border)",
                color: "var(--text)",
                padding: "5px 12px",
                borderRadius: "999px",
                fontFamily: "var(--font-head)",
                fontSize: ".68rem",
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: ".12em",
              }}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="var(--accent)"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ width: "13px", height: "13px" }}
                aria-hidden="true"
              >
                <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67 0C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.5 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
                <path d="m9 12 2 2 4-4" />
              </svg>
              Secure sign-in
            </span>

            <h2
              style={{
                fontFamily: "var(--font-head)",
                fontSize: "1.55rem",
                fontWeight: 800,
                color: "var(--text)",
                marginTop: "12px",
                letterSpacing: "-0.005em",
              }}
            >
              Welcome back
            </h2>
            <p
              style={{
                fontSize: ".88rem",
                color: "var(--text2)",
                marginTop: "4px",
                lineHeight: 1.5,
              }}
            >
              Sign in to access the Motrex <span style={{ color: "var(--accent)", fontWeight: 600 }}>Fleet Insights</span> portal.
            </p>

            {error && (
              <div
                style={{
                  marginTop: "16px",
                  background: "rgba(230,73,73,0.08)",
                  border: "1px solid rgba(230,73,73,0.28)",
                  borderRadius: "var(--radius-sm)",
                  padding: "10px 14px",
                  fontSize: ".82rem",
                  fontWeight: 600,
                  color: "var(--red)",
                }}
              >
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} style={{ marginTop: "18px" }}>
              <div style={{ marginBottom: "14px" }}>
                <label
                  style={{
                    display: "block",
                    fontFamily: "var(--font-head)",
                    fontSize: ".7rem",
                    fontWeight: 700,
                    color: "var(--text2)",
                    textTransform: "uppercase",
                    letterSpacing: ".09em",
                    marginBottom: "6px",
                  }}
                >
                  Username or email
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  autoComplete="username"
                  disabled={loading}
                  style={{
                    width: "100%",
                    padding: "12px 14px",
                    background: "var(--surface2)",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius-sm)",
                    color: "var(--text)",
                    fontSize: ".9rem",
                    fontFamily: "var(--font-body)",
                    fontWeight: 500,
                    outline: "none",
                    transition: "var(--transition)",
                  }}
                  onFocus={(e) => {
                    e.target.style.borderColor = "var(--accent)";
                    e.target.style.boxShadow = "0 0 0 3px var(--accent-glow)";
                  }}
                  onBlur={(e) => {
                    e.target.style.borderColor = "var(--border)";
                    e.target.style.boxShadow = "none";
                  }}
                  placeholder="e.g. motrex@controltech-ea.com"
                />
              </div>

              <div style={{ marginBottom: "20px" }}>
                <label
                  style={{
                    display: "block",
                    fontFamily: "var(--font-head)",
                    fontSize: ".7rem",
                    fontWeight: 700,
                    color: "var(--text2)",
                    textTransform: "uppercase",
                    letterSpacing: ".09em",
                    marginBottom: "6px",
                  }}
                >
                  Password
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  disabled={loading}
                  style={{
                    width: "100%",
                    padding: "12px 14px",
                    background: "var(--surface2)",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius-sm)",
                    color: "var(--text)",
                    fontSize: ".9rem",
                    fontFamily: "var(--font-body)",
                    fontWeight: 500,
                    outline: "none",
                    transition: "var(--transition)",
                  }}
                  onFocus={(e) => {
                    e.target.style.borderColor = "var(--accent)";
                    e.target.style.boxShadow = "0 0 0 3px var(--accent-glow)";
                  }}
                  onBlur={(e) => {
                    e.target.style.borderColor = "var(--border)";
                    e.target.style.boxShadow = "none";
                  }}
                  placeholder="Enter password"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                style={{
                  width: "100%",
                  padding: "13px",
                  background:
                    "linear-gradient(90deg, rgba(245,179,0,1) 0%, rgba(255,212,81,0.95) 100%)",
                  border: "1px solid rgba(245,179,0,0.45)",
                  borderRadius: "var(--radius)",
                  color: "#14110c",
                  fontSize: ".92rem",
                  fontWeight: 800,
                  fontFamily: "var(--font-head)",
                  cursor: loading ? "wait" : "pointer",
                  letterSpacing: ".03em",
                  transition: "var(--transition)",
                  boxShadow: "0 6px 24px rgba(245,179,0,0.32)",
                  opacity: loading ? 0.85 : 1,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "8px",
                }}
              >
                {loading && (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{
                      width: "16px",
                      height: "16px",
                      animation: "fleet-spin 0.9s linear infinite",
                    }}
                    aria-hidden="true"
                  >
                    <path d="M21 12a9 9 0 1 1-6.22-8.56" />
                  </svg>
                )}
                {loading ? "Signing in…" : "Sign in"}
              </button>

              {loading && (
                <ul
                  style={{
                    listStyle: "none",
                    margin: "14px 0 0",
                    padding: "12px 14px",
                    background: "var(--surface2)",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius-sm)",
                    display: "flex",
                    flexDirection: "column",
                    gap: "8px",
                    fontSize: ".78rem",
                    fontWeight: 600,
                    color: "var(--text2)",
                  }}
                >
                  {["Verifying credentials", "Loading live positions", "Loading fleet reports"].map(
                    (label, idx) => {
                      const done = progressStep > idx;
                      const active = progressStep === idx;
                      return (
                        <li
                          key={label}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "10px",
                            color: done ? "var(--green)" : active ? "var(--text)" : "var(--text3)",
                          }}
                        >
                          {done ? (
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2.4"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              style={{ width: "14px", height: "14px", flexShrink: 0 }}
                              aria-hidden="true"
                            >
                              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                              <path d="m9 11 3 3L22 4" />
                            </svg>
                          ) : (
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2.4"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              style={{
                                width: "14px",
                                height: "14px",
                                flexShrink: 0,
                                animation: active
                                  ? "fleet-spin 0.9s linear infinite"
                                  : undefined,
                                opacity: active ? 1 : 0.6,
                                color: active ? "var(--accent)" : "var(--text3)",
                              }}
                              aria-hidden="true"
                            >
                              <path d="M21 12a9 9 0 1 1-6.22-8.56" />
                            </svg>
                          )}
                          <span>{label}</span>
                        </li>
                      );
                    },
                  )}
                </ul>
              )}
            </form>
          </div>

          {/* ControlTech link */}
          <a
            href="https://www.controltech-ea.com/"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="ControlTech East Africa"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              width: "fit-content",
              maxWidth: "100%",
              margin: "16px auto 0",
              padding: "6px 14px",
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: "999px",
              boxShadow: "var(--shadow)",
              fontSize: ".74rem",
              fontWeight: 600,
              color: "var(--text2)",
              textDecoration: "none",
              transition: "var(--transition)",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = "var(--accent)";
              e.currentTarget.style.color = "var(--text)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = "var(--border)";
              e.currentTarget.style.color = "var(--text2)";
            }}
          >
            <Image
              src="/controltech_logo.png"
              alt="ControlTech"
              width={20}
              height={20}
              style={{
                width: "20px",
                height: "20px",
                borderRadius: "4px",
                objectFit: "contain",
              }}
            />
            <span>
              Powered by{" "}
              <span style={{ color: "var(--accent)", fontWeight: 800, fontFamily: "var(--font-head)" }}>
                ControlTech
              </span>
            </span>
          </a>

          <p
            style={{
              textAlign: "center",
              fontSize: ".74rem",
              color: "var(--text2)",
              marginTop: "10px",
              fontWeight: 600,
            }}
          >
            <Link
              href="/install"
              style={{
                color: "var(--blue)",
                textDecoration: "none",
              }}
            >
              Install app on your phone
            </Link>
          </p>

          <p
            style={{
              textAlign: "center",
              fontSize: ".7rem",
              color: "var(--text3)",
              marginTop: "6px",
              fontWeight: 500,
            }}
          >
            © {year ?? ""} Motrex Limited. All rights reserved.
          </p>
        </div>
      </section>
    </div>
  );
}
