import { jsPDF } from "jspdf";
import autoTable, { type CellHookData, type RowInput } from "jspdf-autotable";

export interface MotrexSummaryItem {
  label: string;
  value: string;
  accent?: string;
}

export interface MotrexReportSection {
  heading?: string;
  head: RowInput[];
  body: RowInput[];
  didParseCell?: (data: CellHookData) => void;
}

export interface ExportMotrexReportPdfOpts {
  title: string;
  subtitle?: string;
  summary?: MotrexSummaryItem[];
  sections: MotrexReportSection[];
  fileName: string;
  landscape?: boolean;
}

const NAVY: [number, number, number] = [26, 26, 46];
const RED: [number, number, number] = [196, 30, 58];
const GOLD: [number, number, number] = [255, 212, 81];
const MARGIN = 36;
const HEADER_H = 76;

function hexToRgb(hex: string): [number, number, number] | null {
  const match = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!match) return null;
  const value = parseInt(match[1], 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function lastAutoTableY(doc: jsPDF): number | undefined {
  return (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY;
}

export function exportMotrexReportPdf({
  title,
  subtitle,
  summary = [],
  sections,
  fileName,
  landscape = true,
}: ExportMotrexReportPdfOpts) {
  const doc = new jsPDF({ orientation: landscape ? "landscape" : "portrait", unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  doc.setFillColor(...NAVY);
  doc.rect(0, 0, pageWidth, HEADER_H, "F");
  doc.setFillColor(...RED);
  doc.rect(pageWidth * 0.46, 0, pageWidth * 0.54, HEADER_H, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(17);
  doc.setTextColor(255, 255, 255);
  doc.text(title, MARGIN, 34);
  if (subtitle) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...GOLD);
    doc.text(subtitle, MARGIN, 54);
  }
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(8);
  doc.text(`Generated ${new Date().toLocaleString("en-GB", { timeZone: "Africa/Nairobi" })} EAT`, pageWidth - MARGIN, 28, {
    align: "right",
  });
  doc.setTextColor(...GOLD);
  doc.text("Motrex Fleet Insights", pageWidth - MARGIN, 46, { align: "right" });

  let y = HEADER_H + 18;
  if (summary.length) {
    const gap = 10;
    const boxH = 54;
    const boxW = (pageWidth - MARGIN * 2 - gap * (summary.length - 1)) / summary.length;
    for (let i = 0; i < summary.length; i += 1) {
      const item = summary[i];
      const x = MARGIN + i * (boxW + gap);
      doc.setFillColor(248, 250, 255);
      doc.setDrawColor(220, 226, 240);
      doc.roundedRect(x, y, boxW, boxH, 6, 6, "FD");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7.2);
      doc.setTextColor(70, 90, 130);
      doc.text(item.label.toUpperCase(), x + 10, y + 17, { maxWidth: boxW - 20 });
      const accent = item.accent ? hexToRgb(item.accent) : null;
      doc.setTextColor(...(accent ?? ([20, 30, 60] as [number, number, number])));
      doc.setFontSize(12);
      doc.text(item.value, x + 10, y + 40, { maxWidth: boxW - 20 });
    }
    y += boxH + 14;
  }

  for (const section of sections) {
    if (section.heading) {
      if (y > pageHeight - 110) {
        doc.addPage();
        y = MARGIN;
      }
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.setTextColor(20, 36, 80);
      doc.text(section.heading, MARGIN, y + 4);
      y += 14;
    }
    autoTable(doc, {
      startY: y,
      head: section.head,
      body: section.body,
      styles: { fontSize: 7.4, cellPadding: 3, overflow: "linebreak", valign: "middle" },
      headStyles: { fillColor: RED, textColor: 255, fontStyle: "bold" },
      alternateRowStyles: { fillColor: [248, 250, 255] },
      margin: { left: MARGIN, right: MARGIN, bottom: 38 },
      showHead: "everyPage",
      didParseCell: section.didParseCell,
    });
    y = (lastAutoTableY(doc) ?? y) + 18;
  }

  const pageCount = doc.getNumberOfPages();
  for (let p = 1; p <= pageCount; p += 1) {
    doc.setPage(p);
    doc.setDrawColor(220, 226, 240);
    doc.line(MARGIN, pageHeight - 28, pageWidth - MARGIN, pageHeight - 28);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(110, 120, 140);
    doc.text("Powered by ControlTech · Motrex Fleet Insights", MARGIN, pageHeight - 14);
    doc.text(`Page ${p} of ${pageCount}`, pageWidth - MARGIN, pageHeight - 14, { align: "right" });
  }

  doc.save(fileName);
}
