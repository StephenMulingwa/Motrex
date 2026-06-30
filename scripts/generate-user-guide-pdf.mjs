/**
 * Generates docs/Ena-Fleet-Insights-User-Guide.pdf
 * Run: node scripts/generate-user-guide-pdf.mjs
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { jsPDF } from "jspdf";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const outDir = path.join(root, "docs");
const outFile = path.join(outDir, "Ena-Fleet-Insights-User-Guide.pdf");

const MARGIN = 18;
const PAGE_W = 210;
const PAGE_H = 297;
const CONTENT_W = PAGE_W - MARGIN * 2;
const LINE_H = 5.2;
const FOOTER_Y = PAGE_H - 12;

const BRAND = { navy: [11, 47, 133], gold: [245, 179, 0], text: [17, 40, 77], muted: [77, 100, 136] };

const sections = [
  {
    title: "1. Welcome",
    blocks: [
      "Ena Fleet Insights is the Ena Coach operations portal. It helps you see how your buses are performing on the road: distances travelled, fuel use, driving behaviour, and safety events.",
      "This guide explains how to sign in, move around the app, read the numbers, and download reports — written in plain language for everyday users.",
    ],
  },
  {
    title: "2. Before you start",
    blocks: [
      "You need a username and password provided by your administrator (for example Ena-Coach or your work email address).",
      "Use a modern web browser such as Chrome, Edge, or Safari. On a phone you can also install the app to your home screen (see section 3).",
      "The app shows fleet data for a date range you choose. Make sure you have a stable internet connection when you press Run to load fresh data.",
    ],
  },
  {
    title: "3. Installing the app on your phone",
    blocks: [
      "On the sign-in screen, tap Install app on your phone, or open your organisation’s install link (usually ending with /install).",
      "Android (Chrome): Tap Install Ena Fleet Insights, then confirm Install. The app icon will appear on your home screen.",
      "iPhone (Safari): Tap the Share button, then Add to Home Screen, then Add. Safari does not show the same install button as Android.",
      "You can share the install link by WhatsApp, copy link, or scan the QR code on the install page.",
      "Opening the app from your home screen works like any other app. Live fleet data still needs internet when you refresh reports.",
    ],
  },
  {
    title: "4. Signing in and signing out",
    blocks: [
      "Open the portal in your browser or from the home-screen icon.",
      "Enter your username or email and password, then tap Sign in. If details are wrong you will see Invalid username or password.",
      "After sign-in the app loads fleet data for the default period. Wait until loading finishes before changing tabs.",
      "To leave the app, tap Sign Out in the blue bar at the top. Always sign out on shared devices.",
    ],
  },
  {
    title: "5. The top bar (every screen)",
    blocks: [
      "Menu (☰) — On a phone, opens the list of sections: Dashboard, Driver Evaluation, Vehicle Performance, Violations, Diagnostics, and Reports.",
      "Logo and title — Confirms you are in Ena Fleet Insights.",
      "EAT clock — Shows current East Africa Time so you know reports align with Kenyan operations.",
      "Live — Green badge means the portal is connected and working.",
      "Sign Out — Ends your session.",
    ],
  },
  {
    title: "6. Choosing dates (From, To, Run)",
    blocks: [
      "Most screens have a date filter at the top right (or below the title on a phone).",
      "From — Start of the period you want to analyse.",
      "To — End of the period.",
      "Run — Loads data for that range. Always tap Run after changing dates.",
      "While data is loading, buttons may be busy and tables may be empty until loading completes.",
    ],
  },
  {
    title: "7. Dashboard — your fleet at a glance",
    blocks: [
      "The Dashboard is the first screen after sign-in. Use it for a quick summary.",
      "Summary cards show: Total Violations, Active Vehicles, Total Distance (km), Average Fuel Consumption (km per litre), Consumption in litres, Total Fillings, and Total Drains.",
      "Violations by Type — Bar chart of harsh cornering, over speeding, harsh braking, free wheeling, and over revving.",
      "Driver Violations — Table listing each driver and how many events they had by type.",
      "Live vehicle list — Shows buses with driver name, location, speed, and last update where available.",
      "Scroll sideways on a phone if a table or chart is wider than the screen.",
    ],
  },
  {
    title: "8. Driver Evaluation",
    blocks: [
      "This section scores how drivers behaved during the selected period.",
      "Each driver gets a Score out of 100 and a grade: Good, Average, or Poor. Higher scores mean safer, smoother driving.",
      "The score considers green-band (efficient) driving time and violation rates.",
      "Tables show distance, speeds, fuel use, violation counts, and green-band percentage.",
      "Tap column headings to sort (for example by score or total violations).",
      "Use pagination at the bottom if there are many drivers.",
      "Download PDF or Download XLSX — Saves the driver score table to your device for printing or sharing.",
    ],
  },
  {
    title: "9. Vehicle Performance",
    blocks: [
      "Focuses on buses rather than individual driver scores.",
      "See distance, fuel consumption, and efficiency (km/L) per vehicle.",
      "Expand a vehicle row (arrow) to see drivers who used that bus in the period.",
      "Download PDF or Download XLSX — Exports the vehicle performance table.",
    ],
  },
  {
    title: "10. Violations",
    blocks: [
      "Detailed view of safety and behaviour events.",
      "Tabs across the top: Harsh Cornering, Over Speeding, Harsh Braking, Free Wheeling, Over Revving. Tap a tab to see only that type.",
      "Filter by driver or vehicle using the drop-down lists.",
      "The table shows when and where each event started and ended, speeds, duration, and distance.",
      "Use column headers to sort. Move between pages with Previous / Next if shown.",
      "Export options let you download PDF or Excel workbooks for records or meetings.",
    ],
  },
  {
    title: "11. Diagnostics",
    blocks: [
      "Shows technical driving patterns that affect fuel and engine health, for example:",
      "• Accelerator use below 40%",
      "• Green Band Driving (efficient range)",
      "• Heavy accelerator (above 70%)",
      "• Engine stress",
      "• High engine temperature (above 105°)",
      "Filter by vehicle if you only need one bus.",
      "Download PDF — Full diagnostic report for the period.",
      "Download All Types (XLSX) — Excel file with a sheet per diagnostic type.",
    ],
  },
  {
    title: "12. Reports",
    blocks: [
      "Open Reports from the menu for formal printable reports. Pick a card, then set dates and Run inside that report.",
      "Fuel — Fuel fillings and drains over the period. Export to PDF or Excel.",
      "Speed Monitoring — Speed bands and trip records by vehicle. Useful for speed compliance reviews.",
      "Summary — Trip summary statistics grouped by vehicle.",
      "Use the back arrow to return to the list of report types.",
    ],
  },
  {
    title: "13. Tips for everyday use",
    blocks: [
      "Start on the Dashboard, then drill into Driver Evaluation or Violations for detail.",
      "Use the same date range when comparing drivers or vehicles.",
      "If numbers look empty, check dates and tap Run again.",
      "On mobile, use landscape for wide tables if your phone allows rotation.",
      "Keep your password private. Ask your IT contact if you forget it or need access.",
    ],
  },
  {
    title: "14. When something goes wrong",
    blocks: [
      "Cannot sign in — Check username and password. Caps lock matters. Contact your administrator for a reset.",
      "No data after Run — Check internet, wait a moment, and try Run again. Very long ranges may take longer.",
      "Install button greyed out — On Android, refresh the page or use the browser menu → Install app. On iPhone use Add to Home Screen in Safari.",
      "App looks cut off at the top on a phone — Close and reopen from the home screen icon after an update.",
      "Export did not download — Allow downloads in your browser and check your Downloads folder.",
    ],
  },
  {
    title: "15. Support",
    blocks: [
      "Ena Fleet Insights is powered by ControlTech East Africa for Ena Coach fleet operations.",
      "For access, passwords, or training, contact your Ena Coach or ControlTech administrator.",
      "Website: www.controltech-ea.com",
    ],
  },
];

function wrapText(doc, text, maxWidth) {
  return doc.splitTextToSize(text, maxWidth);
}

function addFooter(doc, pageNum, totalPages) {
  doc.setFontSize(8);
  doc.setTextColor(...BRAND.muted);
  doc.text("Ena Fleet Insights — User Guide", MARGIN, FOOTER_Y);
  doc.text(`Page ${pageNum} of ${totalPages}`, PAGE_W - MARGIN, FOOTER_Y, { align: "right" });
}

function estimateSectionHeight(doc, section) {
  let h = 14;
  for (const block of section.blocks) {
    const lines = wrapText(doc, block, CONTENT_W);
    h += lines.length * LINE_H + 4;
  }
  return h + 8;
}

function drawSection(doc, section, y) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(...BRAND.navy);
  doc.text(section.title, MARGIN, y);
  y += 8;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10.5);
  doc.setTextColor(...BRAND.text);

  for (const block of section.blocks) {
    const lines = wrapText(doc, block, CONTENT_W);
    for (const line of lines) {
      if (y > PAGE_H - 28) {
        doc.addPage();
        y = MARGIN + 8;
      }
      doc.text(line, MARGIN, y);
      y += LINE_H;
    }
    y += 3;
  }
  return y + 4;
}

async function tryAddLogo(doc) {
  try {
    const logoPath = path.join(root, "public", "enalogo.png");
    const buf = await readFile(logoPath);
    const b64 = buf.toString("base64");
    const dataUrl = `data:image/png;base64,${b64}`;
    doc.addImage(dataUrl, "PNG", MARGIN, 16, 28, 28);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const doc = new jsPDF({ unit: "mm", format: "a4" });

  // Cover
  doc.setFillColor(...BRAND.navy);
  doc.rect(0, 0, PAGE_W, 52, "F");
  await tryAddLogo(doc);
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.text("Ena Fleet Insights", MARGIN + 34, 28);
  doc.setFontSize(11);
  doc.setFont("helvetica", "normal");
  doc.text("User Guide for Fleet Operations Staff", MARGIN + 34, 38);

  doc.setTextColor(...BRAND.text);
  doc.setFontSize(12);
  doc.text("A simple guide to signing in, viewing fleet data,", MARGIN, 68);
  doc.text("and downloading reports — no technical knowledge required.", MARGIN, 76);

  doc.setFontSize(10);
  doc.setTextColor(...BRAND.muted);
  const year = new Date().getFullYear();
  doc.text(`Ena Coach Ltd.  ·  ${year}`, MARGIN, 92);
  doc.text("Prepared for drivers, supervisors, and operations teams", MARGIN, 99);

  doc.setDrawColor(...BRAND.gold);
  doc.setLineWidth(1.2);
  doc.line(MARGIN, 108, PAGE_W - MARGIN, 108);

  // Table of contents
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(...BRAND.navy);
  doc.text("Contents", MARGIN, 120);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10.5);
  let tocY = 128;
  for (const s of sections) {
    doc.text(s.title, MARGIN, tocY);
    tocY += 6;
  }

  doc.addPage();

  // Body — pre-count pages roughly by simulating layout
  let y = MARGIN + 4;
  const bodyStartPage = doc.getNumberOfPages();

  for (const section of sections) {
    if (y + estimateSectionHeight(doc, section) > PAGE_H - 24) {
      doc.addPage();
      y = MARGIN + 4;
    }
    y = drawSection(doc, section, y);
  }

  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p += 1) {
    doc.setPage(p);
    if (p === 1) continue;
    addFooter(doc, p, totalPages);
  }

  await mkdir(outDir, { recursive: true });
  const buf = Buffer.from(doc.output("arraybuffer"));
  await writeFile(outFile, buf);
  console.log(`Wrote ${outFile} (${totalPages} pages)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
