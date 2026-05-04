"use strict";

const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");

const outputDir = path.join(__dirname, "..", "reports");
const outputFile = path.join(outputDir, "project-report.pdf");

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

const doc = new PDFDocument({ size: "A4", margin: 50, bufferPages: true });
doc.pipe(fs.createWriteStream(outputFile));

const pageWidth = doc.page.width;
const contentWidth = pageWidth - doc.page.margins.left - doc.page.margins.right;
const brand = "#d61f5a";
const brandDark = "#a31642";
const ink = "#1e2430";
const muted = "#5b6577";
const line = "#dfe4ee";

function ensureSpace(height) {
  if (doc.y + height > doc.page.height - doc.page.margins.bottom) {
    doc.addPage();
  }
}

function measureText(text, width, options = {}) {
  return doc.heightOfString(text, {
    width,
    ...options,
  });
}

function addHeading(text, level = 1) {
  const fontSize = level === 1 ? 22 : 14;
  const height = measureText(text, contentWidth, { align: "left", font: "Helvetica-Bold", size: fontSize });
  ensureSpace(height + (level === 1 ? 16 : 14));
  doc.fillColor(level === 1 ? ink : brandDark)
    .font("Helvetica-Bold")
    .fontSize(fontSize)
    .text(text, { width: contentWidth, align: "left" });
  doc.moveDown(0.35);
  if (level > 1) {
    const y = doc.y;
    doc.save().strokeColor(brand).lineWidth(2).moveTo(doc.page.margins.left, y).lineTo(doc.page.margins.left + 18, y).stroke();
    doc.restore();
    doc.moveDown(0.25);
  }
}

function addParagraph(text) {
  const height = measureText(text, contentWidth, { align: "justify" });
  ensureSpace(height + 8);
  doc.fillColor(ink).font("Helvetica").fontSize(10.5).lineGap(2).text(text, {
    width: contentWidth,
    align: "justify",
  });
  doc.moveDown(0.4);
}

function addBullets(items) {
  items.forEach(item => {
    const width = contentWidth - 14;
    const height = measureText(item, width, { align: "justify" });
    ensureSpace(height + 4);
    const y = doc.y;
    doc.fillColor(brandDark).font("Helvetica-Bold").fontSize(11).text("•", doc.page.margins.left, y, { width: 10 });
    doc.fillColor(ink).font("Helvetica").fontSize(10.5).text(item, doc.page.margins.left + 14, y, {
      width,
      align: "justify",
    });
    doc.y = y + height + 2;
  });
  doc.moveDown(0.5);
}

function addNumberedSteps(steps) {
  steps.forEach((step, index) => {
    const marker = `Step ${index + 1} → ${step.title}`;
    const markerHeight = measureText(marker, contentWidth, { align: "left", font: "Helvetica-Bold", size: 11 });
    ensureSpace(markerHeight + 6);
    doc.fillColor(brandDark).font("Helvetica-Bold").fontSize(11).text(marker, { width: contentWidth, align: "left" });

    if (step.description) {
      const descWidth = contentWidth - 14;
      const descHeight = measureText(step.description, descWidth, { align: "justify" });
      ensureSpace(descHeight + 8);
      const y = doc.y;
      doc.fillColor(ink).font("Helvetica").fontSize(10.5).text(step.description, doc.page.margins.left + 14, y, {
        width: descWidth,
        align: "justify",
      });
      doc.y = y + descHeight;
    }

    doc.moveDown(0.4);
  });
  doc.moveDown(0.4);
}

function addTable(rows) {
  const col1 = 110;
  const col2 = contentWidth - col1;
  rows.forEach(([left, right]) => {
    const leftHeight = measureText(left, col1 - 16, { align: "left" });
    const rightHeight = measureText(right, col2 - 16, { align: "justify" });
    const rowHeight = Math.max(34, Math.ceil(Math.max(leftHeight, rightHeight) + 16));
    ensureSpace(rowHeight);
    const x = doc.page.margins.left;
    const y = doc.y;
    doc.save().fillColor("#ffffff").strokeColor(line).rect(x, y, contentWidth, rowHeight).fillAndStroke();
    doc.restore();

    doc.save().strokeColor(line).moveTo(x + col1, y).lineTo(x + col1, y + rowHeight).stroke();
    doc.restore();

    doc.fillColor(brandDark).font("Helvetica-Bold").fontSize(9.5).text(left, x + 8, y + 8, { width: col1 - 16 });
    doc.fillColor(ink).font("Helvetica").fontSize(9.5).text(right, x + col1 + 8, y + 8, { width: col2 - 16, align: "justify" });
    doc.y = y + rowHeight;
  });
  doc.moveDown(0.5);
}

function drawWorkflowDiagram() {
  const x = doc.page.margins.left;
  const y = doc.y;
  const w = contentWidth;
  const h = 235;

  ensureSpace(h + 10);
  doc.save()
    .fillColor("#ffffff")
    .strokeColor(line)
    .lineWidth(1)
    .roundedRect(x, y, w, h, 16)
    .fillAndStroke();
  doc.restore();

  function box(bx, by, bw, bh, fill, stroke, title, subtitle) {
    doc.save().fillColor(fill).strokeColor(stroke).lineWidth(1.2).roundedRect(bx, by, bw, bh, 12).fillAndStroke();
    doc.restore();
    doc.fillColor(ink).font("Helvetica-Bold").fontSize(11.5).text(title, bx + 8, by + 10, { width: bw - 16, align: "center" });
    doc.fillColor(muted).font("Helvetica").fontSize(8.5).text(subtitle, bx + 8, by + 30, { width: bw - 16, align: "center" });
  }

  const topY = y + 22;
  const midY = y + 94;
  const bottomY = y + 170;

  box(x + 24, topY, 150, 52, "#fff2f6", brand, "Applicant", "Upload CV and take exam");
  box(x + w - 174, topY, 150, 52, "#eef3fb", muted, "HR", "Review and decide");
  box(x + 90, midY, w - 180, 58, "#fff7fa", brandDark, "Resume Analysis", "JD match, ATS keywords, skills, experience");
  box(x + 24, bottomY, 124, 52, "#ffffff", brand, "Shortlist", "or reject");
  box(x + (w / 2) - 58, bottomY, 116, 52, "#ffffff", line, "Exam", "15 MCQs");
  box(x + w - 148, bottomY, 124, 52, "#ffffff", muted, "Final Decision", "selected / rejected");

  doc.save().strokeColor(muted).lineWidth(1.5);
  doc.moveTo(x + 174, topY + 26).lineTo(x + w - 174, topY + 26).stroke();
  doc.moveTo(x + 100, topY + 52).lineTo(x + w - 100, midY).stroke();
  doc.moveTo(x + w - 100, topY + 52).lineTo(x + w - 100, midY).stroke();
  doc.moveTo(x + w / 2, midY + 58).lineTo(x + 86, bottomY).stroke();
  doc.moveTo(x + w / 2, midY + 58).lineTo(x + w / 2, bottomY).stroke();
  doc.moveTo(x + w / 2, midY + 58).lineTo(x + w - 86, bottomY).stroke();
  doc.restore();

  doc.fillColor(muted).font("Helvetica").fontSize(8.5).text("Figure 1: Applicant and HR workflow used by the project.", x, y + h + 8, { width: w, align: "center" });
  doc.y = y + h + 28;
}

// Cover page
doc.rect(0, 0, doc.page.width, doc.page.height).fill("#ffffff");
doc.fillColor(brand).font("Helvetica-Bold").fontSize(10).text("Project Report", { align: "left" });
doc.moveDown(0.6);
doc.fillColor(ink).font("Helvetica-Bold").fontSize(24).text("CV Shortlister", { width: contentWidth });
doc.moveDown(0.3);
addParagraph("This project is a recruitment support system that helps two roles work through one flow: the Applicant uploads a resume and completes an exam when invited, while HR reviews candidates, checks the scoring summary, and makes a shortlist or final decision. The system combines resume parsing, job-description comparison, ATS-style keyword analysis, and exam handling into a single hiring workflow.");

addTable([
  ["Purpose", "Reduce manual screening effort and make candidate evaluation consistent."],
  ["Roles", "Applicant and HR only."],
  ["Output", "CV analysis, shortlist decisions, and exam results."],
]);

addHeading("What The Project Does", 2);
addNumberedSteps([
  {
    title: "Applicant uploads a PDF resume and system extracts the content",
    description: "The applicant uploads a resume in PDF format. The system extracts and normalizes the text, identifies sections (contact, education, work experience, skills), and prepares a structured representation for analysis.",
  },
  {
    title: "Strict comparison against the job description",
    description: "The extracted resume is compared to the job description using conservative rules. The system computes an overall AI score and component signals: skills match, experience match, education match, ATS keyword match, strengths, gaps, and explicit missing requirements.",
  },
  {
    title: "Shortlist decision and exam workflow",
    description: "If the candidate is shortlisted by HR, the system can send an exam. The applicant receives the exam, submits answers, and the system grades and records the results linked to the candidate profile.",
  },
  {
    title: "HR review, filtering, and final decision",
    description: "HR users can view all applications, filter by scores and signals, inspect analysis details, shortlist or reject candidates, manage exam distribution, review completed exams, and record a final hiring decision. All actions remain auditable and traceable.",
  },
]);
addParagraph("The project uses conservative scoring: missing evidence is not assumed or filled in automatically. Decisions are therefore based only on explicit information present in the resume or supplied by the candidate.");

addHeading("Applicant Flow", 2);
addBullets([
  "Create an account or log in.",
  "Upload a resume in PDF format.",
  "Wait for the resume to be analyzed against the job description.",
  "Receive an exam if shortlisted.",
  "Submit exam answers and view the result.",
]);

addHeading("HR Flow", 2);
addBullets([
  "Review all candidate submissions.",
  "Check AI score, ATS score, skills, and experience fit.",
  "Shortlist or reject candidates.",
  "Send exam questions to shortlisted applicants.",
  "Inspect exam outcomes and set the final decision.",
]);

doc.addPage();
addHeading("Workflow Image", 1);
drawWorkflowDiagram();

addHeading("Key Evaluation Signals", 2);
addTable([
  ["AI Score", "Strict overall match between resume and job description."],
  ["Skills Match", "Skills explicitly shown in the resume and required in the job description."],
  ["Experience Match", "Years, roles, and responsibilities that can be verified from the resume."],
  ["ATS Score", "Keyword match, keyword density, and formatting quality."],
]);

addParagraph("The project uses conservative scoring so missing evidence is not assumed or filled in automatically.");

doc.addPage();
addHeading("System Description", 1);
addParagraph("The system is built around a single recruitment path. Applicant actions start with authentication and CV upload, then move into analysis and exam submission when required. HR actions start with viewing the candidate pool and move into scoring, exam distribution, and final status updates. This split keeps the product simple, practical, and easy to explain in a hiring context.");

addHeading("Why The Project Is Useful", 2);
addParagraph("Manual screening usually takes too much time and can vary from one reviewer to another. This project standardizes the first review stage by using the same comparison logic for every candidate. It also helps HR explain decisions with evidence-based scores instead of vague judgments.");
addParagraph("For applicants, the process is straightforward: upload, wait for analysis, and respond to an exam if invited. For HR, the process is centralized: review, shortlist, send exams, and finalize decisions. That makes the system suitable for a structured screening workflow.");

addHeading("Conclusion", 2);
addParagraph("CV Shortlister is a recruitment support tool that combines resume analysis, ATS-style matching, and exam-based assessment for a two-role hiring workflow. The result is a cleaner candidate review process that helps applicants submit their credentials easily and helps HR make faster, more consistent decisions.");

const currentPage = doc.page;
const range = doc.bufferedPageRange();
for (let i = range.start; i < range.start + range.count; i++) {
  doc.switchToPage(i);
  doc.font("Helvetica").fontSize(8).fillColor(muted)
    .text(`CV Shortlister Project Report`, 50, doc.page.height - 38, { width: doc.page.width - 100, align: "left" })
    .text(`Page ${i + 1}`, 50, doc.page.height - 38, { width: doc.page.width - 100, align: "right" });
}

doc.flushPages();
doc.end();

doc.on("finish", () => {
  process.stdout.write(`${outputFile}\n`);
});