"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

const FEATURE_TAGS = [
  "Live GPS",
  "Fleet health",
  "Driver scores",
  "Trip reports",
  "Works offline",
];

const BENEFITS = [
  {
    icon: "⚡",
    title: "Faster",
    body: "Opens instantly from your home screen like a native app.",
  },
  {
    icon: "📴",
    title: "Offline shell",
    body: "Keep the portal shell available when signal is weak.",
  },
  {
    icon: "🔔",
    title: "One-tap access",
    body: "Jump straight into fleet monitoring without typing the URL.",
  },
];

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function isIosDevice() {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function isStandaloneDisplay() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export default function InstallAppPage() {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installing, setInstalling] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "error">("idle");
  const [origin, setOrigin] = useState("");

  const isIos = isIosDevice();

  useEffect(() => {
    setOrigin(window.location.origin);
    setInstalled(isStandaloneDisplay());

    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };

    const onInstalled = () => {
      setInstalled(true);
      setInstallPrompt(null);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const installUrl = useMemo(() => (origin ? `${origin}/install` : "/install"), [origin]);

  const shareText = useMemo(
    () =>
      `Install Ena Fleet Insights on your phone — live fleet GPS, driver evaluation, and reports.\n${installUrl}`,
    [installUrl],
  );

  const qrSrc = useMemo(() => {
    if (!installUrl.startsWith("http")) return "";
    return `https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=12&data=${encodeURIComponent(installUrl)}`;
  }, [installUrl]);

  const handleInstall = useCallback(async () => {
    if (!installPrompt) return;
    setInstalling(true);
    try {
      await installPrompt.prompt();
      const { outcome } = await installPrompt.userChoice;
      if (outcome === "accepted") {
        setInstalled(true);
      }
    } finally {
      setInstallPrompt(null);
      setInstalling(false);
    }
  }, [installPrompt]);

  const handleCopyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(installUrl);
      setCopyStatus("copied");
      window.setTimeout(() => setCopyStatus("idle"), 2200);
    } catch {
      setCopyStatus("error");
      window.setTimeout(() => setCopyStatus("idle"), 2200);
    }
  }, [installUrl]);

  const handleShare = useCallback(async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: "Ena Fleet Insights",
          text: "Install the Ena Coach fleet operations app on your phone.",
          url: installUrl,
        });
      } catch {
        /* user cancelled */
      }
      return;
    }
    void handleCopyLink();
  }, [handleCopyLink, installUrl]);

  const canShowNativeInstall = Boolean(installPrompt) && !isIos && !installed;

  return (
    <div className="install-page">
      <header className="install-header">
        <Link href="/" className="install-brand" aria-label="Ena Fleet Insights home">
          <Image src="/motrex-logo.jpg" alt="" width={44} height={44} priority className="install-brand-logo" />
          <div>
            <strong>Ena Coach</strong>
            <span>Fleet Insights</span>
          </div>
        </Link>
        <Link href="/" className="install-header-link">
          Home
        </Link>
      </header>

      <main className="install-main">
        <section className="install-hero card-rise">
          <div className="install-app-icon-wrap" aria-hidden="true">
            <Image src="/motrex-logo.jpg" alt="" width={72} height={72} className="install-app-icon" />
          </div>

          <h1>Get the Ena Fleet Insights App</h1>
          <p className="install-lead">
            Install Ena Fleet Insights on your phone in seconds no Play Store needed. Monitor live
            bus positions, driver behaviour, and operations reports right from your home screen.
          </p>

          <div className="install-tags">
            {FEATURE_TAGS.map((tag) => (
              <span key={tag} className="install-tag">
                {tag}
              </span>
            ))}
          </div>

          <div className="install-actions">
            {installed ? (
              <p className="install-status install-status--success">
                App is installed. Open <strong>Ena Fleet</strong> from your home screen.
              </p>
            ) : isIos ? (
              <p className="install-status">
                On iPhone, use <strong>Add to Home Screen</strong> in Safari (steps below).
              </p>
            ) : canShowNativeInstall ? (
              <button
                type="button"
                className="install-btn install-btn--primary"
                onClick={() => void handleInstall()}
                disabled={installing}
              >
                {installing ? "Installing…" : "📲 Install Ena Fleet Insights"}
              </button>
            ) : (
              <button type="button" className="install-btn install-btn--primary" disabled>
                📲 Install Ena Fleet Insights
              </button>
            )}

            {!canShowNativeInstall && !installed && !isIos && (
              <p className="install-hint">
                Tip: Open this page in Chrome on Android, or use the browser menu →{" "}
                <strong>Install app</strong> / <strong>Add to Home screen</strong>.
              </p>
            )}

            <Link href="/" className="install-btn install-btn--ghost">
              Open the portal instead
            </Link>
          </div>
        </section>

        <section className="install-card card-rise">
          <h2>Or scan this QR with your phone</h2>
          <p className="install-muted">Point your camera at the code and tap the link to install.</p>
          {qrSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qrSrc} alt="QR code linking to the install page" className="install-qr" width={220} height={220} />
          ) : (
            <div className="install-qr install-qr--placeholder" aria-hidden="true" />
          )}
          <p className="install-url">{installUrl}</p>

          <div className="install-share-row">
            <a
              className="install-share-btn"
              href={`https://wa.me/?text=${encodeURIComponent(shareText)}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              💬 Share on WhatsApp
            </a>
            <button type="button" className="install-share-btn" onClick={() => void handleCopyLink()}>
              {copyStatus === "copied" ? "✓ Copied" : copyStatus === "error" ? "Copy failed" : "🔗 Copy link"}
            </button>
            <button type="button" className="install-share-btn" onClick={() => void handleShare()}>
              📤 Share…
            </button>
          </div>
        </section>

        <section className="install-card card-rise">
          <h2>How to install</h2>

          <article className="install-steps">
            <h3>
              <span className="install-step-badge">A</span> On Android (Chrome / Edge)
            </h3>
            <ol>
              <li>
                Tap <strong>Install Ena Fleet Insights</strong> above, or open the browser menu (⋮) and
                choose <strong>Install app</strong> / <strong>Add to Home screen</strong>.
              </li>
              <li>Confirm <strong>Install</strong>.</li>
              <li>
                Open <strong>Ena Fleet</strong> from your home screen.
              </li>
            </ol>
            <p className="install-tip">
              Tip: If the install button is greyed out, refresh the page and try again, or use the browser
              menu.
            </p>
          </article>

          <article className="install-steps install-steps--ios">
            <h3>
              <span className="install-step-badge install-step-badge--ios">i</span> On iPhone (Safari)
            </h3>
            <ol>
              <li>
                Open this page in <strong>Safari</strong>.
              </li>
              <li>
                Tap the <strong>Share</strong> icon (square with an arrow up).
              </li>
              <li>
                Choose <strong>Add to Home Screen</strong>, then tap <strong>Add</strong>.
              </li>
            </ol>
            <p className="install-tip">
              iPhone Safari does not show an install button Add to Home Screen creates the app icon.
            </p>
          </article>
        </section>

        <section className="install-card card-rise">
          <h2>Why install the app</h2>
          <ul className="install-benefits">
            {BENEFITS.map((item) => (
              <li key={item.title}>
                <span className="install-benefit-icon" aria-hidden="true">
                  {item.icon}
                </span>
                <div>
                  <h4>{item.title}</h4>
                  <p>{item.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <footer className="install-footer">
          <a
            href="https://www.controltech-ea.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="install-powered"
          >
            <Image src="/controltech_logo.png" alt="" width={18} height={18} />
            Powered by ControlTech
          </a>
        </footer>
      </main>
    </div>
  );
}