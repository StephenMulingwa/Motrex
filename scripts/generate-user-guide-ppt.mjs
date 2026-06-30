/**
 * Generates docs/Ena-Fleet-Insights-User-Guide.pptx (5 slides)
 * Run: npm run guide:ppt
 *
 * LAYOUT_16x9 = 10" x 5.625" — all positions are calculated to stay inside that area.
 */
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import PptxGenJS from "pptxgenjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const outDir = path.join(root, "docs");
const outFile = path.join(outDir, "Ena-Fleet-Insights-User-Guide.pptx");
const logoPath = path.join(root, "public", "enalogo.png");

/** 16:9 slide size used by pptxgenjs LAYOUT_16x9 */
const SW = 10;
const SH = 5.625;
const MX = 0.4;
const CONTENT_W = SW - MX * 2;

const C = {
  navy: "0B2F85",
  navyLight: "1B4FC2",
  gold: "F5B300",
  goldLight: "FFD451",
  white: "FFFFFF",
  text: "11284D",
  muted: "4D6488",
  surface: "F2F7FF",
};

const HEADER_H = 0.82;
const HEADER_ACCENT = 0.04;
const BODY_TOP = HEADER_H + HEADER_ACCENT + 0.12;
const FOOTER_Y = SH - 0.22;

function addBrandHeader(slide, title, subtitle) {
  slide.addShape("rect", {
    x: 0,
    y: 0,
    w: SW,
    h: HEADER_H,
    fill: { color: C.navy },
    line: { color: C.navy },
  });
  slide.addShape("rect", {
    x: 0,
    y: HEADER_H,
    w: SW,
    h: HEADER_ACCENT,
    fill: { color: C.gold },
    line: { color: C.gold },
  });
  slide.addText(title, {
    x: MX,
    y: 0.14,
    w: CONTENT_W,
    h: 0.38,
    fontSize: 20,
    bold: true,
    color: C.white,
    fontFace: "Arial",
    shrinkText: true,
  });
  if (subtitle) {
    slide.addText(subtitle, {
      x: MX,
      y: 0.5,
      w: CONTENT_W,
      h: 0.24,
      fontSize: 9.5,
      color: C.goldLight,
      fontFace: "Arial",
      shrinkText: true,
    });
  }
}

function addBullets(slide, items, opts = {}) {
  const { x = MX, y = BODY_TOP, w = CONTENT_W, h = 3, fontSize = 11, lineSpacing = 18 } = opts;
  slide.addText(
    items.map((text) => ({ text, options: { bullet: true, breakLine: true } })),
    {
      x,
      y,
      w,
      h,
      fontSize,
      color: C.text,
      fontFace: "Arial",
      valign: "top",
      lineSpacing,
      paraSpaceAfter: 3,
      shrinkText: true,
    },
  );
}

function addTwoColumns(slide, leftTitle, leftItems, rightTitle, rightItems, opts = {}) {
  const { contentTop = BODY_TOP, contentH = 3.05, colGap = 0.25 } = opts;
  const colW = (CONTENT_W - colGap) / 2;
  const leftX = MX;
  const rightX = MX + colW + colGap;

  slide.addText(leftTitle, {
    x: leftX,
    y: contentTop,
    w: colW,
    h: 0.28,
    fontSize: 12,
    bold: true,
    color: C.navy,
    fontFace: "Arial",
  });
  addBullets(slide, leftItems, {
    x: leftX,
    y: contentTop + 0.32,
    w: colW,
    h: contentH,
    fontSize: 10,
    lineSpacing: 16,
  });

  slide.addText(rightTitle, {
    x: rightX,
    y: contentTop,
    w: colW,
    h: 0.28,
    fontSize: 12,
    bold: true,
    color: C.navy,
    fontFace: "Arial",
  });
  addBullets(slide, rightItems, {
    x: rightX,
    y: contentTop + 0.32,
    w: colW,
    h: contentH,
    fontSize: 10,
    lineSpacing: 16,
  });
}

function addFooter(slide, text) {
  slide.addText(text, {
    x: MX,
    y: FOOTER_Y,
    w: CONTENT_W,
    h: 0.18,
    fontSize: 8,
    color: C.muted,
    fontFace: "Arial",
  });
}

function addCallout(slide, text, y, h = 0.48, opts = {}) {
  const { fill = C.white, border = C.gold, fontSize = 9.5, bold = true } = opts;
  slide.addShape("roundRect", {
    x: MX,
    y,
    w: CONTENT_W,
    h,
    fill: { color: fill },
    line: { color: border, width: 1 },
    rectRadius: 0.06,
  });
  slide.addText(text, {
    x: MX + 0.12,
    y: y + 0.08,
    w: CONTENT_W - 0.24,
    h: h - 0.14,
    fontSize,
    bold,
    color: C.navy,
    fontFace: "Arial",
    valign: "middle",
    shrinkText: true,
  });
}

async function loadLogoData() {
  try {
    const buf = await readFile(logoPath);
    return `image/png;base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const logoData = await loadLogoData();
  const year = new Date().getFullYear();

  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_16x9";
  pptx.author = "ControlTech East Africa";
  pptx.company = "Ena Coach Ltd.";
  pptx.subject = "Ena Fleet Insights user guide";
  pptx.title = "Ena Fleet Insights — User Guide";

  // Slide 1 — Title
  const s1 = pptx.addSlide();
  s1.background = { color: C.navy };
  s1.addShape("rect", {
    x: 0,
    y: SH - 0.55,
    w: SW,
    h: 0.55,
    fill: { color: "071228" },
    line: { color: "071228" },
  });
  if (logoData) {
    s1.addImage({ data: logoData, x: MX, y: 0.85, w: 0.95, h: 0.95 });
  }
  const titleX = logoData ? 1.55 : MX;
  s1.addText("Ena Fleet Insights", {
    x: titleX,
    y: 0.95,
    w: SW - titleX - MX,
    h: 0.55,
    fontSize: 30,
    bold: true,
    color: C.white,
    fontFace: "Arial",
  });
  s1.addText("User Guide", {
    x: titleX,
    y: 1.48,
    w: SW - titleX - MX,
    h: 0.4,
    fontSize: 22,
    color: C.gold,
    fontFace: "Arial",
  });
  s1.addText("Live fleet positions · Driver behaviour · Fuel & safety reports", {
    x: titleX,
    y: 1.95,
    w: SW - titleX - MX,
    h: 0.35,
    fontSize: 12,
    color: C.goldLight,
    fontFace: "Arial",
    shrinkText: true,
  });
  s1.addText(`Ena Coach Ltd. · ${year}`, {
    x: MX,
    y: SH - 0.38,
    w: 4.5,
    h: 0.22,
    fontSize: 10,
    color: C.white,
    fontFace: "Arial",
  });
  s1.addText("Powered by ControlTech East Africa", {
    x: 5.2,
    y: SH - 0.38,
    w: SW - 5.2 - MX,
    h: 0.22,
    fontSize: 10,
    color: C.goldLight,
    align: "right",
    fontFace: "Arial",
  });

  // Slide 2 — Getting started
  const s2 = pptx.addSlide();
  s2.background = { color: C.surface };
  addBrandHeader(s2, "Getting Started", "Sign in, install on your phone, and load data");
  addTwoColumns(
    s2,
    "Sign in",
    [
      "Open the portal in Chrome, Edge, or Safari",
      "Enter username or email and password",
      "Tap Sign in to load fleet data",
      "Tap Sign out when finished",
    ],
    "Install on your phone",
    [
      "Login screen: Install app on your phone",
      "Or open your /install link",
      "Android: tap Install Ena Fleet Insights",
      "iPhone: Safari → Share → Add to Home Screen",
    ],
    { contentTop: BODY_TOP, contentH: 2.55 },
  );
  addCallout(
    s2,
    "Top bar: Menu · EAT clock · Live · Sign Out   |   Dates: set From & To, then tap Run",
    FOOTER_Y - 0.52,
    0.44,
    { fontSize: 9 },
  );
  addFooter(s2, "Ena Fleet Insights — slide 2 of 5");

  // Slide 3 — Sections (3×2 grid, sized to fit)
  const s3 = pptx.addSlide();
  s3.background = { color: C.surface };
  addBrandHeader(s3, "What Each Section Does", "Use the menu on mobile or the sidebar on desktop");

  const cards = [
    { title: "Dashboard", desc: "Violations, distance, fuel, live buses", color: C.navy },
    { title: "Driver Evaluation", desc: "Scores: Good, Average, Poor", color: "2F6FED" },
    { title: "Vehicle Performance", desc: "Fuel and km per bus", color: "0EA46F" },
    { title: "Violations", desc: "Speeding, braking, cornering events", color: "E64949" },
    { title: "Diagnostics", desc: "Engine stress and green-band driving", color: "7C3AED" },
    { title: "Reports", desc: "Fuel, Speed, and Summary reports", color: "F97316" },
  ];

  const gridTop = BODY_TOP;
  const gridBottom = FOOTER_Y - 0.08;
  const gridH = gridBottom - gridTop;
  const colGap = 0.18;
  const rowGap = 0.16;
  const cardW = (CONTENT_W - colGap * 2) / 3;
  const cardH = (gridH - rowGap) / 2;

  cards.forEach((card, i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const x = MX + col * (cardW + colGap);
    const y = gridTop + row * (cardH + rowGap);

    s3.addShape("roundRect", {
      x,
      y,
      w: cardW,
      h: cardH,
      fill: { color: C.white },
      line: { color: card.color, width: 1 },
      rectRadius: 0.06,
    });
    s3.addShape("rect", {
      x,
      y,
      w: cardW,
      h: 0.08,
      fill: { color: card.color },
      line: { color: card.color },
    });
    s3.addText(card.title, {
      x: x + 0.1,
      y: y + 0.14,
      w: cardW - 0.2,
      h: 0.32,
      fontSize: 11,
      bold: true,
      color: C.text,
      fontFace: "Arial",
      shrinkText: true,
    });
    s3.addText(card.desc, {
      x: x + 0.1,
      y: y + 0.46,
      w: cardW - 0.2,
      h: cardH - 0.54,
      fontSize: 9.5,
      color: C.muted,
      fontFace: "Arial",
      valign: "top",
      shrinkText: true,
    });
  });
  addFooter(s3, "Ena Fleet Insights — slide 3 of 5");

  // Slide 4 — Daily workflow
  const s4 = pptx.addSlide();
  s4.background = { color: C.surface };
  addBrandHeader(s4, "Your Daily Workflow", "A simple routine for supervisors and operations staff");

  const steps = [
    { n: "1", title: "Set dates & Run", body: "Pick From / To, then tap Run" },
    { n: "2", title: "Check Dashboard", body: "Review totals, charts, and live buses" },
    { n: "3", title: "Review drivers", body: "Open Driver Evaluation for scores" },
    { n: "4", title: "Investigate events", body: "Use Violations — filter by driver or vehicle" },
    { n: "5", title: "Export & share", body: "Download PDF or Excel from any section" },
  ];

  const stepH = 0.58;
  const stepStart = BODY_TOP;
  steps.forEach((step, i) => {
    const y = stepStart + i * stepH;
    s4.addShape("ellipse", {
      x: MX,
      y: y + 0.06,
      w: 0.38,
      h: 0.38,
      fill: { color: C.gold },
      line: { color: C.gold },
    });
    s4.addText(step.n, {
      x: MX,
      y: y + 0.1,
      w: 0.38,
      h: 0.3,
      fontSize: 12,
      bold: true,
      color: C.navy,
      align: "center",
      fontFace: "Arial",
    });
    s4.addText(step.title, {
      x: MX + 0.5,
      y: y + 0.04,
      w: 2.8,
      h: 0.28,
      fontSize: 12,
      bold: true,
      color: C.navy,
      fontFace: "Arial",
    });
    s4.addText(step.body, {
      x: MX + 0.5,
      y: y + 0.3,
      w: CONTENT_W - 0.5,
      h: 0.24,
      fontSize: 10,
      color: C.muted,
      fontFace: "Arial",
      shrinkText: true,
    });
  });

  const infoY = FOOTER_Y - 0.72;
  s4.addShape("roundRect", {
    x: MX,
    y: infoY,
    w: CONTENT_W,
    h: 0.58,
    fill: { color: "E8F0FF" },
    line: { color: C.navyLight, width: 1 },
    rectRadius: 0.06,
  });
  s4.addText("Grades: Good (60+) · Average (45–59) · Poor (below 45)", {
    x: MX + 0.12,
    y: infoY + 0.1,
    w: CONTENT_W - 0.24,
    h: 0.2,
    fontSize: 10,
    bold: true,
    color: C.navy,
    fontFace: "Arial",
  });
  s4.addText("Violations: Harsh Cornering · Over Speeding · Harsh Braking · Free Wheeling · Over Revving", {
    x: MX + 0.12,
    y: infoY + 0.3,
    w: CONTENT_W - 0.24,
    h: 0.2,
    fontSize: 9,
    color: C.muted,
    fontFace: "Arial",
    shrinkText: true,
  });
  addFooter(s4, "Ena Fleet Insights — slide 4 of 5");

  // Slide 5 — Tips & support
  const s5 = pptx.addSlide();
  s5.background = { color: C.surface };
  addBrandHeader(s5, "Tips & Support", "Quick answers for common questions");
  addTwoColumns(
    s5,
    "Helpful tips",
    [
      "Use the same date range when comparing drivers",
      "Scroll sideways on a phone for wide tables",
      "Tap column headers to sort tables",
      "Tap Run after changing dates",
    ],
    "If something goes wrong",
    [
      "Sign-in fails → check username and password",
      "Empty data → check dates, tap Run, check internet",
      "Install greyed out → refresh or use browser menu",
      "Need access → contact your administrator",
    ],
    { contentTop: BODY_TOP, contentH: 2.45 },
  );
  s5.addShape("roundRect", {
    x: MX,
    y: FOOTER_Y - 0.48,
    w: CONTENT_W,
    h: 0.4,
    fill: { color: C.navy },
    line: { color: C.navy },
    rectRadius: 0.06,
  });
  s5.addText("ControlTech East Africa · www.controltech-ea.com · Ena Coach fleet portal", {
    x: MX + 0.12,
    y: FOOTER_Y - 0.4,
    w: CONTENT_W - 0.24,
    h: 0.24,
    fontSize: 9.5,
    bold: true,
    color: C.gold,
    align: "center",
    fontFace: "Arial",
    shrinkText: true,
  });
  addFooter(s5, "Ena Fleet Insights — slide 5 of 5 · Thank you");

  await pptx.writeFile({ fileName: outFile });
  console.log(`Wrote ${outFile}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

