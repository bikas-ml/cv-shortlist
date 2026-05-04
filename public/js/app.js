"use strict";

/* ── Auth Guard ─────────────────────────────────────────────────────────────── */
if (!sessionStorage.getItem("ats_token")) {
  window.location.replace("/login");
}

/* ── Groq API key (set at login, sent with every AI request) ─────────────── */
const GROQ_API_KEY = sessionStorage.getItem("groq_api_key") || "";

/* ── Logout ──────────────────────────────────────────────────────────────────── */
function logout() {
  sessionStorage.removeItem("ats_token");
  sessionStorage.removeItem("groq_api_key");
  window.location.replace("/login");
}

/* ── DOM refs ──────────────────────────────────────────────────────────────── */
const $  = (id) => document.getElementById(id);
const statusDot        = $("statusDot");
const statusLabel      = $("statusLabel");
const jdInput          = $("jdInput");
const dropzone         = $("dropzone");
const fileInput        = $("fileInput");
const browseLink       = $("browseLink");
const fileList         = $("fileList");
const thresholdSlider  = $("thresholdSlider");
const thresholdValue   = $("thresholdValue");
const thresholdDesc    = $("thresholdDesc");
const runBtn           = $("runBtn");
const emptyState       = $("emptyState");
const loadingState     = $("loadingState");
const loadingDesc      = $("loadingDesc");
const resultsContainer = $("resultsContainer");
const statsRow         = $("statsRow");
const resultsMeta      = $("resultsMeta");
const downloadBtn      = $("downloadBtn");
const panelAll         = $("panelAll");
const panelShortlisted = $("panelShortlisted");
const panelRejected    = $("panelRejected");
const logoutBtn        = $("logoutBtn");

/* ── Logout handler ─────────────────────────────────────────────────────────── */
if (logoutBtn) logoutBtn.addEventListener("click", logout);

/* ── State ─────────────────────────────────────────────────────────────────── */
let selectedFile   = null;
let lastResults    = null;

/* ═══════════════════════════════════════════════════════════════════════════ */
/* API Health Check                                                            */
/* ═══════════════════════════════════════════════════════════════════════════ */
async function checkHealth() {
  try {
    const res = await fetch("/api/health", { signal: AbortSignal.timeout(4000) });
    const { status } = await res.json();
    if (status === "ok") {
      statusDot.className   = "status-dot online";
      statusLabel.textContent = "Sysnova";
      runBtn.disabled = false;
    } else {
      setOffline();
    }
  } catch {
    setOffline();
  }
}
function setOffline() {
  statusDot.className     = "status-dot offline";
  statusLabel.textContent = "API offline — restart: node server.js";
  runBtn.disabled = true;
}
checkHealth();
setInterval(checkHealth, 10_000);

/* ═══════════════════════════════════════════════════════════════════════════ */
/* Threshold Slider                                                            */
/* ═══════════════════════════════════════════════════════════════════════════ */
thresholdSlider.addEventListener("input", () => {
  const v = thresholdSlider.value;
  thresholdValue.textContent = v;
  thresholdDesc.textContent  = v;
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/* File Handling                                                               */
/* ═══════════════════════════════════════════════════════════════════════════ */
browseLink.addEventListener("click", () => fileInput.click());
dropzone.addEventListener("click", () => fileInput.click());

fileInput.addEventListener("change", () => {
  const f = fileInput.files[0];
  if (f) setFile(f);
});

dropzone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropzone.classList.add("drag-over");
});
dropzone.addEventListener("dragleave", () => dropzone.classList.remove("drag-over"));
dropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropzone.classList.remove("drag-over");
  const f = Array.from(e.dataTransfer.files).find((x) => x.type === "application/pdf");
  if (f) setFile(f);
});

function setFile(f) {
  selectedFile = f;
  renderFileList();
}

function removeFile() {
  selectedFile = null;
  fileInput.value = "";
  renderFileList();
}

function renderFileList() {
  fileList.innerHTML = "";
  if (!selectedFile) return;
  const chip = document.createElement("div");
  chip.className = "file-chip";
  chip.innerHTML = `
    <span class="file-chip-name">📄 ${escHtml(selectedFile.name)}</span>
    <button class="file-chip-remove" title="Remove" onclick="removeFile()">✕</button>
  `;
  fileList.appendChild(chip);
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* Run Analysis                                                                */
/* ═══════════════════════════════════════════════════════════════════════════ */
runBtn.addEventListener("click", async () => {
  const jd = jdInput.value.trim();
  if (!jd)          return alert("Please paste a job description.");
  if (!selectedFile) return alert("Please upload a CV PDF.");

  showLoading(`Analysing ${selectedFile.name}…`);

  const form = new FormData();
  form.append("jd_text",   jd);
  form.append("threshold", thresholdSlider.value);
  form.append("cv", selectedFile, selectedFile.name);

  try {
    const res = await fetch("/api/shortlist", { method: "POST", body: form });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`API error ${res.status}: ${err}`);
    }
    const data = await res.json();
    lastResults = data;
    renderResults(data);
  } catch (err) {
    hideLoading();
    alert(`Error: ${err.message}`);
  }
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/* Show / Hide Loading                                                         */
/* ═══════════════════════════════════════════════════════════════════════════ */
function showLoading(msg) {
  emptyState.classList.add("hidden");
  resultsContainer.classList.add("hidden");
  loadingDesc.textContent = msg;
  loadingState.classList.remove("hidden");
}
function hideLoading() {
  loadingState.classList.add("hidden");
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* Render Results                                                              */
/* ═══════════════════════════════════════════════════════════════════════════ */
function renderResults(data) {
  hideLoading();
  emptyState.classList.add("hidden");
  resultsContainer.classList.remove("hidden");

  const { total, shortlisted, rejected, threshold, results } = data;
  const avgAts = results.length
    ? Math.round(results.reduce((s, r) => s + (r.ats_match_score || 0), 0) / results.length)
    : 0;

  /* Stats */
  statsRow.innerHTML = `
    <div class="stat-card">
      <div class="stat-value total">${total}</div>
      <div class="stat-label">Total CVs</div>
    </div>
    <div class="stat-card">
      <div class="stat-value shortlisted">${shortlisted}</div>
      <div class="stat-label">Shortlisted</div>
    </div>
    <div class="stat-card">
      <div class="stat-value rejected">${rejected}</div>
      <div class="stat-label">Rejected</div>
    </div>
    <div class="stat-card">
      <div class="stat-value avg">${avgAts}</div>
      <div class="stat-label">Avg ATS Score</div>
    </div>
  `;

  resultsMeta.innerHTML = `
    <strong>${total}</strong> candidate${total !== 1 ? "s" : ""} ranked &nbsp;·&nbsp;
    threshold <strong>${threshold}</strong>
  `;

  /* Build panels */
  const allHtml        = results.map((r, i) => cardHtml(r, i + 1)).join("");
  const shortHtml      = results.filter((r) => r.shortlisted).map((r, i) => cardHtml(r, i + 1)).join("");
  const rejectedHtml   = results.filter((r) => !r.shortlisted).map((r, i) => cardHtml(r, i + 1)).join("");

  panelAll.innerHTML        = allHtml        || emptyTabHtml("No candidates.");
  panelShortlisted.innerHTML= shortHtml      || emptyTabHtml("No shortlisted candidates.");
  panelRejected.innerHTML   = rejectedHtml   || emptyTabHtml("No rejected candidates.");

  /* Update tab labels */
  $("tabAll").textContent         = `All (${total})`;
  $("tabShortlisted").textContent = `✅ Shortlisted (${shortlisted})`;
  $("tabRejected").textContent    = `❌ Rejected (${rejected})`;

  /* Attach toggle listeners */
  document.querySelectorAll(".card-header").forEach((header) => {
    header.addEventListener("click", () => toggleCard(header));
  });

  /* Attach Take Exam button listeners */
  document.querySelectorAll(".take-exam-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      openExam(btn.dataset.examCandidate);
    });
  });

  /* Skill match toggle listeners */
  document.querySelectorAll(".app-skills-toggle-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const panel = document.getElementById(btn.dataset.target);
      if (!panel) return;
      const open = !panel.classList.contains("hidden");
      panel.classList.toggle("hidden", open);
      btn.querySelector(".app-skills-toggle-arrow").textContent = open ? "▾" : "▴";
      btn.classList.toggle("open", !open);
    });
  });

  /* Draw charts — bar & doughnut are in always-visible divs, render immediately */
  renderBarChart(results);
  renderDoughnutChart(results);
  /* Radar & histogram canvases live inside card bodies that just became visible.
     Defer one animation frame so the browser finishes layout and assigns real
     pixel dimensions to the canvases before Chart.js tries to draw them. */
  requestAnimationFrame(() => {
    results.forEach((r, i) => renderRadarChart(r, i));
    results.forEach((r, i) => renderHistogramChart(r, i));
  });
}

function emptyTabHtml(msg) {
  return `<div class="tab-empty">${msg}</div>`;
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* Chart.js Renderers                                                          */
/* ═══════════════════════════════════════════════════════════════════════════ */
let barChart      = null;
let doughnutChart = null;
const radarCharts = {};

const CHART_DEFAULTS = {
  color: "#a1a1aa",
  font: { family: "Inter, sans-serif", size: 11 },
};
Chart.defaults.color     = CHART_DEFAULTS.color;
Chart.defaults.font      = CHART_DEFAULTS.font;

function renderBarChart(results) {
  const ctx = document.getElementById("chartBar");
  if (!ctx) return;
  if (barChart) { barChart.destroy(); barChart = null; }

  const labels  = results.map((r) => r.candidate_name || r.filename);
  const aiData  = results.map((r) => r.overall_score   || 0);
  const atsData = results.map((r) => (r.ats?.ats_score) || 0);
  const cmbData = results.map((r) => r.ats_match_score  || 0);

  barChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        { label: "AI Score",       data: aiData,  backgroundColor: "rgba(139,92,246,0.7)",  borderRadius: 4 },
        { label: "ATS Score",      data: atsData, backgroundColor: "rgba(6,182,212,0.7)",   borderRadius: 4 },
        { label: "Combined Score", data: cmbData, backgroundColor: "rgba(34,197,94,0.7)",   borderRadius: 4 },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: "bottom", labels: { padding: 16, boxWidth: 12 } },
      },
      scales: {
        x: { grid: { display: false }, ticks: { maxRotation: 30 } },
        y: { beginAtZero: true, max: 100, grid: { display: false } },
      },
    },
  });
}

function renderDoughnutChart(results) {
  const ctx = document.getElementById("chartDoughnut");
  if (!ctx) return;
  if (doughnutChart) { doughnutChart.destroy(); doughnutChart = null; }

  const r   = results[0];
  const ats = r?.ats || {};
  const matched = (ats.matched_keywords || []).length;
  const missing = (ats.missing_keywords || []).length;
  const total   = matched + missing || 1;

  doughnutChart = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: ["Matched", "Missing"],
      datasets: [{
        data: [matched, missing],
        backgroundColor: ["rgba(34,197,94,0.8)", "rgba(239,68,68,0.7)"],
        borderColor:     ["rgba(34,197,94,1)",   "rgba(239,68,68,1)"],
        borderWidth: 1.5,
        hoverOffset: 6,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "68%",
      plugins: { legend: { display: false } },
    },
  });

  const legend = document.getElementById("doughnutLegend");
  if (legend) {
    legend.innerHTML = `
      <div class="doughnut-legend-item">
        <span class="doughnut-legend-dot" style="background:#22c55e"></span>
        Matched &nbsp;<strong style="color:#4ade80">${matched}</strong>
      </div>
      <div class="doughnut-legend-item">
        <span class="doughnut-legend-dot" style="background:#ef4444"></span>
        Missing &nbsp;<strong style="color:#f87171">${missing}</strong>
      </div>
      <div class="doughnut-legend-item">
        <span class="doughnut-legend-dot" style="background:#3b82f6"></span>
        Coverage &nbsp;<strong style="color:#60a5fa">${Math.round((matched/total)*100)}%</strong>
      </div>`;
  }
}

function renderRadarChart(r, idx) {
  const ctx = document.getElementById(`radar_${idx}`);
  if (!ctx) return;
  if (radarCharts[idx]) { radarCharts[idx].destroy(); }

  const ats = r.ats || {};
  radarCharts[idx] = new Chart(ctx, {
    type: "radar",
    data: {
      labels: ["Skills", "Experience", "Education", "Keywords", "Density", "Format"],
      datasets: [{
        label: r.candidate_name || r.filename,
        data: [
          r.skills_match         || 0,
          r.experience_match     || 0,
          r.education_match      || 0,
          ats.keyword_match_pct  || 0,
          ats.keyword_density_score || 0,
          ats.format_score       || 0,
        ],
        backgroundColor: "rgba(99,102,241,0.18)",
        borderColor:     "rgba(99,102,241,0.9)",
        pointBackgroundColor: "#818cf8",
        borderWidth: 2,
        pointRadius: 4,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        r: {
          min: 0, max: 100,
          ticks: { stepSize: 25, font: { size: 9 }, backdropColor: "transparent" },
          grid:        { color: "#3f3f46" },
          angleLines:  { color: "#3f3f46" },
          pointLabels: { font: { size: 10 }, color: "#a1a1aa" },
        },
      },
    },
  });
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* Card HTML Builder                                                           */
/* ═══════════════════════════════════════════════════════════════════════════ */
function cardHtml(r, rank) {
  const ats          = r.ats || {};
  const aiScore      = r.overall_score    || 0;
  const atsScore     = ats.ats_score      || 0;
  const combined     = r.ats_match_score  || 0;
  const yoe          = r.years_of_experience != null ? `${r.years_of_experience} yr${r.years_of_experience !== 1 ? "s" : ""}` : null;
  const statusCls    = r.shortlisted ? "shortlisted" : "rejected";
  const statusIcon   = r.shortlisted ? "✅" : "❌";
  const atsCls       = pillClass(atsScore);
  const combinedCls  = pillClass(combined);

  const matchedKw = (ats.matched_keywords || []).map((k) => `<span class="kw matched">✓ ${escHtml(k)}</span>`).join("");
  const missingKw = (ats.missing_keywords || []).map((k) => `<span class="kw missing">✗ ${escHtml(k)}</span>`).join("");
  const formatNotes = (ats.format_notes || []).map((n) => `<span class="kw note">⚡ ${escHtml(n)}</span>`).join("");
  const strengths = (r.key_strengths || []).map((s) => `<span class="tag strength">${escHtml(s)}</span>`).join("");
  const gaps      = (r.gaps          || []).map((g) => `<span class="tag gap">${escHtml(g)}</span>`).join("");

  return `
  <div class="candidate-card ${statusCls}">
    <div class="card-header">
      <div class="card-meta">
        <div class="card-name">#${rank} &nbsp;${statusIcon}&nbsp; ${escHtml(r.candidate_name)}</div>
        <div class="card-file">${escHtml(r.filename)}${yoe ? ` &nbsp;·&nbsp; ${yoe} exp.` : ""}</div>
      </div>
      <div class="card-pills">
        <div class="pill ai">
          <div class="pill-num">${aiScore}</div>
          <div class="pill-label">AI Score</div>
        </div>
        <div class="pill ats ${atsCls}">
          <div class="pill-num">${atsScore}</div>
          <div class="pill-label">ATS Score</div>
        </div>
        <div class="pill combined ${combinedCls}">
          <div class="pill-num">${combined}</div>
          <div class="pill-label">Combined</div>
        </div>
        <span class="status-badge ${statusCls}">${statusIcon} ${r.shortlisted ? "Shortlisted" : "Rejected"}</span>
      </div>
      ${r.shortlisted ? `<button class="take-exam-btn" data-exam-candidate="${escHtml(r.candidate_name)}">📝 Take Exam</button>` : ""}
      <span class="card-chevron open">▾</span>
    </div>

    <div class="card-body">

      <!-- ⚠ MISSING REQUIREMENTS — always shown first, mandatory for every CV -->
      ${(() => {
        const missingReqs = r.missing_requirements || [];
        const missingKws  = ats.missing_keywords   || [];
        const totalMissing = missingReqs.length + missingKws.length;
        if (totalMissing === 0) {
          return `<div class="missing-panel-top all-clear">✅ All key requirements met — this candidate is a strong match!</div>`;
        }
        return `
        <div class="missing-panel-top">
          <div class="missing-panel-header">
            <div class="missing-panel-title">
              ⚠ What's Missing from this CV
              <span class="missing-count-badge">${totalMissing} gap${totalMissing !== 1 ? "s" : ""}</span>
            </div>
          </div>
          <div class="missing-panel-body">
            ${missingReqs.length ? `
            <div>
              <div class="missing-sub-title">Unmet Requirements</div>
              <div class="missing-req-list">
                ${missingReqs.map(m => `<div class="missing-req-item">${escHtml(m)}</div>`).join("")}
              </div>
            </div>` : ""}
            ${missingKws.length ? `
            <div>
              <div class="missing-sub-title">Missing Keywords / Skills</div>
              <div class="missing-kw-row">
                ${missingKws.map(k => `<span class="missing-kw-chip">${escHtml(k)}</span>`).join("")}
              </div>
            </div>` : ""}
          </div>
        </div>`;
      })()}

      <!-- Radar chart + score bars side by side -->
      <div class="card-grid" style="margin-top:4px">
        <div>
          <div class="card-section-title">AI Assessment</div>
          ${barHtml("Skills Match",     r.skills_match     || 0, "ai")}
          ${barHtml("Experience Match", r.experience_match || 0, "ai")}
          ${barHtml("Education Match",  r.education_match  || 0, "ai")}
          <div class="card-section-title" style="margin-top:14px">ATS Analysis</div>
          ${barHtml(`Keyword Match (${ats.keyword_match_pct || 0}%)`, ats.keyword_match_pct   || 0, "ats")}
          ${barHtml("Keyword Density",                                 ats.keyword_density_score || 0, "ats")}
          ${barHtml("CV Format Score",                                 ats.format_score        || 0, "format")}
        </div>
        <div style="display:flex;flex-direction:column;align-items:center;">
          <div class="card-section-title">Score Radar</div>
          <div class="radar-wrap"><canvas id="radar_${rank - 1}"></canvas></div>
        </div>
      </div>

      <!-- Score Histogram -->
      <div style="margin-top:18px">
        <div class="card-section-title">Score Histogram</div>
        <div class="histogram-wrap"><canvas id="hist_${rank - 1}"></canvas></div>
      </div>

      ${formatNotes ? `
      <div style="margin-top:14px">
        <div class="card-section-title">Format Notes</div>
        <div class="kw-list">${formatNotes}</div>
      </div>` : ""}

      ${r.summary ? `<div class="card-summary">${escHtml(r.summary)}</div>` : ""}

      <!-- Skills Match Breakdown Toggle -->
      ${(() => {
        const matched = ats.matched_keywords || [];
        const missing = ats.missing_keywords || [];
        const kStrengths = r.key_strengths || [];
        const kGaps = r.gaps || [];
        const total = matched.length + missing.length;
        const pct = total > 0 ? Math.round((matched.length / total) * 100) : 0;
        return `
      <div class="app-skills-toggle-row" style="margin-top:18px">
        <button class="app-skills-toggle-btn" data-target="skills-ats-${rank}">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
          Skill Match Breakdown
          <span class="app-skills-toggle-arrow">▾</span>
        </button>
        <span class="app-skills-coverage-pill ${pct >= 70 ? "good" : pct >= 40 ? "mid" : "low"}">${pct}% matched</span>
      </div>
      <div class="app-skills-panel hidden" id="skills-ats-${rank}">
        <div class="skills-coverage-bar-wrap">
          <div class="skills-coverage-bar-fill" style="width:${pct}%"></div>
          <span class="skills-coverage-label">${matched.length} of ${total} keywords present</span>
        </div>
        <div class="skills-cols">
          <div class="skills-col">
            <div class="skills-col-title matched-title">✓ Present (${matched.length})</div>
            <div class="skills-tags">
              ${matched.length ? matched.map(k => `<span class="skill-tag skill-matched">${escHtml(k)}</span>`).join("") : `<span class="skills-none">None detected</span>`}
            </div>
            ${kStrengths.length ? `
            <div class="skills-col-title matched-title" style="margin-top:10px">★ Strengths</div>
            <div class="skills-tags">${kStrengths.map(s => `<span class="skill-tag skill-strength">${escHtml(s)}</span>`).join("")}</div>` : ""}
          </div>
          <div class="skills-col">
            <div class="skills-col-title missing-title">✗ Missing (${missing.length})</div>
            <div class="skills-tags">
              ${missing.length ? missing.map(k => `<span class="skill-tag skill-missing">${escHtml(k)}</span>`).join("") : `<span class="skills-none">No gaps found ✓</span>`}
            </div>
            ${kGaps.length ? `
            <div class="skills-col-title missing-title" style="margin-top:10px">Gaps</div>
            <div class="skills-tags">${kGaps.map(g => `<span class="skill-tag skill-gap">${escHtml(g)}</span>`).join("")}</div>` : ""}
          </div>
        </div>
      </div>`;
      })()}

    </div>
  </div>`;
}

function barHtml(label, value, type) {
  return `
    <div class="bar-row">
      <div class="bar-label">${escHtml(label)}</div>
      <div class="bar-track"><div class="bar-fill ${type}" style="width:${value}%"></div></div>
      <div class="bar-pct">${value}%</div>
    </div>`;
}

function pillClass(score) {
  if (score >= 70) return "high";
  if (score >= 45) return "mid";
  return "low";
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* Per-Card Histogram Chart                                                    */
/* ═══════════════════════════════════════════════════════════════════════════ */
const histogramCharts = {};

function renderHistogramChart(r, idx) {
  const ctx = document.getElementById(`hist_${idx}`);
  if (!ctx) return;
  if (histogramCharts[idx]) { histogramCharts[idx].destroy(); }

  const ats = r.ats || {};
  const labels = ["Skills Match", "Experience Match", "Education Match", "Keyword Match", "Keyword Density", "CV Format"];
  const values = [
    r.skills_match            || 0,
    r.experience_match        || 0,
    r.education_match         || 0,
    ats.keyword_match_pct     || 0,
    ats.keyword_density_score || 0,
    ats.format_score          || 0,
  ];
  const colors = [
    "rgba(226,19,110,0.75)",
    "rgba(236,72,153,0.75)",
    "rgba(251,113,133,0.75)",
    "rgba(6,182,212,0.75)",
    "rgba(20,184,166,0.75)",
    "rgba(245,158,11,0.75)",
  ];
  const borderColors = colors.map(c => c.replace("0.75", "1"));

  histogramCharts[idx] = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: "Score (%)",
        data: values,
        backgroundColor: colors,
        borderColor: borderColors,
        borderWidth: 1.5,
        borderRadius: 6,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => ` ${ctx.parsed.y}%`,
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { font: { size: 11 }, color: "#a1a1aa" },
        },
        y: {
          beginAtZero: true,
          max: 100,
          grid: { display: false },
          ticks: {
            stepSize: 25,
            font: { size: 10 },
            color: "#a1a1aa",
            callback: (v) => v + "%",
          },
        },
      },
    },
  });
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* Card Expand / Collapse                                                      */
/* ═══════════════════════════════════════════════════════════════════════════ */
function toggleCard(header) {
  const body    = header.nextElementSibling;
  const chevron = header.querySelector(".card-chevron");
  const isOpen  = !body.classList.contains("hidden");
  body.classList.toggle("hidden", isOpen);
  chevron.classList.toggle("open", !isOpen);
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* Tab Switching                                                               */
/* ═══════════════════════════════════════════════════════════════════════════ */
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const tab = btn.dataset.tab;
    panelAll.classList.toggle("hidden",        tab !== "all");
    panelShortlisted.classList.toggle("hidden",tab !== "shortlisted");
    panelRejected.classList.toggle("hidden",   tab !== "rejected");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/* CSV Export                                                                  */
/* ═══════════════════════════════════════════════════════════════════════════ */
downloadBtn.addEventListener("click", () => {
  if (!lastResults) return;
  const rows = lastResults.results.map((r, i) => {
    const a = r.ats || {};
    return [
      i + 1,
      csvCell(r.filename),
      csvCell(r.candidate_name),
      r.ats_match_score,
      r.overall_score,
      a.ats_score || 0,
      r.shortlisted ? "Yes" : "No",
      r.skills_match,
      r.experience_match,
      r.education_match,
      r.years_of_experience ?? "",
      a.keyword_match_pct || 0,
      a.keyword_density_score || 0,
      a.format_score || 0,
      csvCell((a.matched_keywords || []).join(" | ")),
      csvCell((a.missing_keywords || []).join(" | ")),
      csvCell((a.format_notes    || []).join(" | ")),
      csvCell((r.key_strengths   || []).join(" | ")),
      csvCell((r.gaps            || []).join(" | ")),
      csvCell(r.summary || ""),
    ].join(",");
  });
  const header = [
    "Rank","Filename","Candidate Name","Combined Score","AI Score","ATS Score",
    "Shortlisted","Skills Match","Experience Match","Education Match","Years Exp",
    "Keyword Match %","Keyword Density","Format Score",
    "Matched Keywords","Missing Keywords","Format Notes",
    "Key Strengths","Gaps","Summary",
  ].join(",");
  const csv  = [header, ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = "ats_result.csv";
  a.click();
  URL.revokeObjectURL(url);
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/* Utility                                                                     */
/* ═══════════════════════════════════════════════════════════════════════════ */
window.removeFile = removeFile;

function escHtml(str) {
  if (typeof str !== "string") return str ?? "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
function csvCell(v) {
  if (v == null) return "";
  const s = String(v).replace(/"/g, '""');
  return /[,"\n]/.test(s) ? `"${s}"` : s;
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* EXAM MODULE                                                                 */
/* ═══════════════════════════════════════════════════════════════════════════ */

// State
let examState = {
  candidateName:  "",
  evaluationKey:  [],   // full questions with correct_answer / model_answer
  questions:      [],   // candidate view (no answers)
  answers:        {},   // { questionId: "A" | "A, D" }
  submitted:      false,
};

// DOM refs (cached lazily)
const examModal       = () => document.getElementById("examModal");
const examWarning     = () => document.getElementById("examWarning");
const examGrading     = () => document.getElementById("examGrading");
const examQContainer  = () => document.getElementById("examQuestions");

/* ── Open exam for a shortlisted candidate ─────────────────────────────── */
window.openExam = async function openExam(candidateName) {
  const jdText = document.getElementById("jdInput")?.value?.trim();
  if (!jdText) {
    alert("No Job Description found. Please enter a JD in the sidebar first.");
    return;
  }

  // Reset state
  examState = { candidateName, evaluationKey: [], questions: [], answers: {}, submitted: false };

  // Show modal with a loading state
  document.getElementById("examCandidate").textContent = candidateName;
  document.getElementById("examAnsweredCount").textContent = "0";
  document.getElementById("examSubmitBtn").textContent   = "Submit Exam";
  document.getElementById("examSubmitBtn").disabled      = false;
  document.getElementById("examSubmitBtn").classList.remove("submitted");
  document.getElementById("examFooterProgress").textContent = "0 of 15 questions answered";
  examQContainer().innerHTML =
    `<div style="text-align:center;padding:60px 0;color:var(--text-secondary)">
       <div class="exam-spinner" style="margin:0 auto 18px"></div>
       Generating exam questions from the Job Description…
     </div>`;
  examModal().classList.remove("hidden");

  try {
    const fd = new FormData();
    fd.append("jd_text", jdText);
    const res  = await fetch("/api/generate-questions", { method: "POST", body: fd });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `HTTP ${res.status}`);
    }
    const data = await res.json();
    examState.evaluationKey = data.evaluation_key;
    examState.questions     = data.questions;
    renderExamQuestions(data.questions);
  } catch (e) {
    examQContainer().innerHTML =
      `<div style="color:#ef4444;text-align:center;padding:40px">
         ❌ Failed to generate questions: ${escHtml(String(e.message))}
       </div>`;
  }
};

/* ── Render question cards ──────────────────────────────────────────────── */
function renderExamQuestions(questions) {
  if (!questions || questions.length === 0) {
    examQContainer().innerHTML = "<p>No questions generated.</p>";
    return;
  }

  // Separate by difficulty
  const easy   = questions.filter((q) => q.difficulty === "easy");
  const medium = questions.filter((q) => q.difficulty === "medium");
  const hard   = questions.filter((q) => q.difficulty === "hard");

  let html = "";
  let globalIdx = 0;

  const sections = [
    { label: "Section A — Easy  (1 pt each)", items: easy },
    { label: "Section B — Medium  (2 pts each)", items: medium },
    { label: "Section C — Hard  (3 pts each)", items: hard },
  ];

  for (const sec of sections) {
    if (!sec.items.length) continue;
    html += `<div class="exam-section-heading">${escHtml(sec.label)}</div>`;
    for (const q of sec.items) {
      globalIdx++;
      html += questionCardHtml(q, globalIdx);
    }
  }

  examQContainer().innerHTML = html;

  // Wire up option clicks
  examQContainer().querySelectorAll(".exam-option").forEach((el) => {
    el.addEventListener("click", () => handleOptionClick(el));
  });
}

function questionCardHtml(q, displayNum) {
  const diffLabel = q.difficulty.charAt(0).toUpperCase() + q.difficulty.slice(1);
  const pts       = q.points;

  const bodyHtml = `<div class="exam-multi-hint">○ Select one answer</div><div class="exam-options">` +
    (q.options || []).map((opt) => `
      <div class="exam-option" data-qid="${q.id}" data-key="${escHtml(opt.key || opt.label)}">
        <span class="exam-option-key">${escHtml(opt.key || opt.label)}</span>
        <span>${escHtml(opt.text)}</span>
      </div>`).join("") +
    `</div>`;

  return `
  <div class="exam-q-card" id="qcard_${q.id}">
    <div class="exam-q-header">
      <div class="exam-q-text">Q${displayNum}. ${escHtml(q.question)}</div>
      <div class="exam-q-meta">
        <span class="exam-q-badge badge-${q.difficulty}">${diffLabel}</span>
        <span class="exam-q-points">${pts} pt${pts > 1 ? "s" : ""}</span>
      </div>
    </div>
    ${bodyHtml}
  </div>`;
}

/* ── Option click handler ────────────────────────────────────────────────── */
function handleOptionClick(el) {
  if (examState.submitted) return;
  const qid      = el.dataset.qid;
  const key      = el.dataset.key;
  const siblings = examQContainer().querySelectorAll(`.exam-option[data-qid="${qid}"]`);

  // Single select for all MCQ types
  siblings.forEach((s) => s.classList.remove("selected"));
  el.classList.add("selected");
  examState.answers[qid] = key;

  document.getElementById(`qcard_${qid}`)?.classList.add("answered");
  updateAnsweredCount();
}

/* ── Progress counter ────────────────────────────────────────────────────── */
function updateAnsweredCount() {
  const count = Object.keys(examState.answers).length;
  document.getElementById("examAnsweredCount").textContent  = count;
  document.getElementById("examFooterProgress").textContent = `${count} of 15 questions answered`;
}

/* ── Submit button ────────────────────────────────────────────────────────── */
document.getElementById("examSubmitBtn").addEventListener("click", () => {
  if (examState.submitted) return;
  const count = Object.keys(examState.answers).length;
  document.getElementById("examWarningAnswered").textContent = count;
  examWarning().classList.remove("hidden");
});

document.getElementById("examWarningCancel").addEventListener("click", () => {
  examWarning().classList.add("hidden");
});

document.getElementById("examWarningConfirm").addEventListener("click", async () => {
  examWarning().classList.add("hidden");
  examState.submitted = true;
  document.getElementById("examSubmitBtn").disabled = true;
  await gradeAndShowResults();
});

/* ── Close exam ───────────────────────────────────────────────────────────── */
document.getElementById("examCloseBtn").addEventListener("click", () => {
  if (!examState.submitted) {
    if (!confirm("Are you sure you want to leave? Your answers will be lost.")) return;
  }
  examModal().classList.add("hidden");
});

/* ── Grading logic ────────────────────────────────────────────────────────── */
async function gradeAndShowResults() {
  examGrading().classList.remove("hidden");

  // Build the answer list expected by /submit-exam
  const answers = Object.entries(examState.answers).map(([qid, ans]) => ({
    question_id: Number(qid),
    answer:      String(ans),
  }));

  try {
    const res = await fetch("/api/submit-exam", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        candidate_name:  examState.candidateName,
        evaluation_key:  examState.evaluationKey,
        answers,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `HTTP ${res.status}`);
    }
    const data = await res.json();
    examGrading().classList.add("hidden");
    renderExamResults(data);
  } catch (fatalErr) {
    console.error("Grading failed:", fatalErr);
    examGrading().classList.add("hidden");
    document.getElementById("examSubmitBtn").textContent = "✅ Submitted";
    document.getElementById("examSubmitBtn").classList.add("submitted");
    document.getElementById("examSubmitBtn").disabled = true;
    examQContainer().innerHTML = `<div style="color:#ef4444;text-align:center;padding:40px">
      ❌ Grading error: ${escHtml(String(fatalErr.message))}<br>
      <small>Check the browser console for details.</small>
    </div>`;
  }
}

/* ── Results renderer — consumes /submit-exam response shape ─────────────── */
function renderExamResults(data) {
  const totalEarned   = Number(data.total_earned) || 0;
  const totalMax      = Number(data.total_max)    || 30;
  const earnedDisplay = Number.isInteger(totalEarned) ? String(totalEarned) : totalEarned.toFixed(1);
  const pct         = data.percentage           ?? Math.round((totalEarned / totalMax) * 100);
  const grade       = data.grade                || "—";
  const sections    = data.sections             || [];
  const results     = data.results              || [];

  let html = `
  <div class="exam-results-summary">
    <div style="text-align:center;min-width:120px">
      <div class="exam-results-score-big">${earnedDisplay}<span class="exam-results-score-denom"> / ${totalMax}</span></div>
      <div style="font-size:13px;opacity:.8;margin-top:4px">${pct}%</div>
    </div>
    <div class="exam-results-breakdown">
      <h2>${grade}</h2>
      <p style="margin-bottom:10px">${escHtml(data.candidate_name)} · ${results.length} questions evaluated</p>
      <div style="display:flex;gap:14px;flex-wrap:wrap">
        ${sections.map(s => `
          <div style="background:rgba(255,255,255,.18);border-radius:8px;padding:6px 12px;font-size:13px">
            <span style="text-transform:capitalize;font-weight:700">${s.difficulty}</span>
            &nbsp;<span style="opacity:.9">${s.earned} / ${s.max} pts</span>
          </div>`).join("")}
      </div>
    </div>
  </div>`;

  let displayNum = 0;
  const secs = [
    { label: "Section A — Easy (1 pt each)",    diff: "easy" },
    { label: "Section B — Medium (2 pts each)", diff: "medium" },
    { label: "Section C — Hard (3 pts each)",   diff: "hard" },
  ];

  for (const sec of secs) {
    const secResults = results.filter((r) => (r.difficulty || "").toLowerCase() === sec.diff);
    if (!secResults.length) continue;
    html += `<div class="exam-section-heading">${escHtml(sec.label)}</div>`;

    for (const r of secResults) {
      displayNum++;
      const earnedN   = Number(r.earned)  || 0;
      const maxPtsN   = Number(r.points)  || 1;
      const isCorrect = earnedN >= maxPtsN;
      const isPartial = earnedN > 0 && earnedN < maxPtsN;
      const isZero    = earnedN === 0;
      const earnedStr = Number.isInteger(earnedN) ? String(earnedN) : earnedN.toFixed(1);
      // Use correct_answer from result; fall back to parsing it from feedback text
      const rawCorrect = r.correct_answer ||
        (r.feedback || "").match(/(?:Correct answer|correct answer)[:\s]+([A-E])/i)?.[1] || "";
      const correctSet  = rawCorrect.toUpperCase();
      const givenKey    = (r.given_answer   || "").toUpperCase();
      const bodyHtml = `<div class="exam-options">` +
        (r.options || []).map((opt) => {
          const optKey       = (opt.key || opt.label || "").toUpperCase();
          const wasSelected  = givenKey  === optKey;
          const isCorrectOpt = correctSet === optKey;
          let cls = "exam-option disabled";
          if (wasSelected && isCorrectOpt)  cls += " correct";
          else if (wasSelected)             cls += " wrong";
          else if (isCorrectOpt)            cls += " reveal-correct";
          return `<div class="${cls}">
            <span class="exam-option-key">${escHtml(opt.key || opt.label)}</span>
            <span>${escHtml(opt.text)}</span>
            ${isCorrectOpt ? `<span style="margin-left:auto;font-size:12px;color:#22c55e;font-weight:700;padding:2px 8px;background:rgba(34,197,94,0.18);border-radius:20px;white-space:nowrap">✓ Correct Answer</span>` : ""}
          </div>`;
        }).join("") +
        `</div>`;

      const cardBorder = isCorrect ? "#22c55e" : isZero ? "#ef4444" : "#f59e0b";

      // Build the correct option's full text for the answer reveal bar
      const correctOpt     = (r.options || []).find((o) => (o.key || o.label || "").toUpperCase() === correctSet);
      const correctOptText = correctOpt ? escHtml(correctOpt.text) : "";
      const notAnswered    = !r.given_answer || r.given_answer.trim() === "";

      const feedbackBar = isCorrect
        ? `<div class="exam-feedback-bar correct">
             <span class="exam-fb-icon">✅</span>
             <span><strong>Correct!</strong> You answered <strong>${escHtml(correctSet)}</strong> — ${correctOptText}</span>
           </div>`
        : notAnswered
          ? `<div class="exam-feedback-bar not-answered">
               <span class="exam-fb-icon">⏭</span>
               <span><strong>Not answered.</strong> The correct answer was
                 <strong>${escHtml(correctSet)}</strong> — ${correctOptText}</span>
             </div>`
          : `<div class="exam-feedback-bar wrong">
               <span class="exam-fb-icon">❌</span>
               <span>You answered <strong>${escHtml(givenKey)}</strong> — incorrect.
                 Correct answer: <strong>${escHtml(correctSet)}</strong> — ${correctOptText}</span>
             </div>`;

      html += `
      <div class="exam-q-card answered" style="border-left:4px solid ${cardBorder}">
        <div class="exam-q-header">
          <div class="exam-q-text">Q${displayNum}. ${escHtml(r.question)}</div>
          <div class="exam-q-meta">
            <span class="exam-q-badge badge-${(r.difficulty||"easy").toLowerCase()}">${r.difficulty}</span>
            <span class="exam-q-points" style="font-size:13px;color:${isCorrect?"#22c55e":isZero?"#ef4444":"#f59e0b"}">${earnedStr} / ${maxPtsN} pts</span>
          </div>
        </div>
        ${bodyHtml}
        ${feedbackBar}
      </div>`;
    }
  }

  examQContainer().innerHTML = html;

  // Scroll to top so results summary is the first thing visible
  const examBodyEl = document.querySelector(".exam-body");
  if (examBodyEl) examBodyEl.scrollTop = 0;

  // Footer — show final score
  document.getElementById("examSubmitBtn").textContent = "✅ Submitted";
  document.getElementById("examSubmitBtn").classList.add("submitted");
  document.getElementById("examSubmitBtn").disabled = true;

  document.getElementById("examAnsweredCount").textContent = `${earnedDisplay}/${totalMax}`;
  document.getElementById("examFooterProgress").innerHTML =
    `<strong style="font-size:16px;color:var(--bkash-pink)">
       Final Score: ${earnedDisplay} / ${totalMax} pts &nbsp;·&nbsp; ${pct}% &nbsp;·&nbsp; ${grade}
     </strong>`;
}

// Make openExam available globally (already done via window.openExam above)
