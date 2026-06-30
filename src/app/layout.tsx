import type { Metadata, Viewport } from "next";
import ServiceWorkerRegister from "@/components/ServiceWorkerRegister";
import "./globals.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#c41e3a",
};

export const metadata: Metadata = {
  title: "Motrex Fleet Insights",
  description: "Motrex Limited fleet monitoring and reports dashboard",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [{ url: "/motrex-logo.jpg", type: "image/jpeg" }],
    apple: [{ url: "/motrex-logo.jpg", type: "image/jpeg" }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Motrex Fleet",
  },
  applicationName: "Motrex Fleet Insights",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">
        <ServiceWorkerRegister />
        {children}
      </body>
    </html>
  );
}
