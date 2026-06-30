import type { Metadata } from "next";
import InstallAppPage from "@/components/InstallAppPage";

export const metadata: Metadata = {
  title: "Install Motrex Fleet Insights",
  description:
    "Install the Motrex fleet operations app on your phone — live GPS, yard monitoring, and reports from your home screen.",
  openGraph: {
    title: "Install Motrex Fleet Insights",
    description: "Add Motrex Fleet Insights to your home screen in seconds — no app store required.",
    images: [{ url: "/motrex-logo.jpg", width: 512, height: 512, alt: "Motrex Fleet Insights" }],
  },
};

export default function InstallPage() {
  return <InstallAppPage />;
}
