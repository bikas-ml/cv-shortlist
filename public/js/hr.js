"use strict";

// auth.js is loaded before this script in hr.html
const $ = (id) => document.getElementById(id);

const statusDot      = $("statusDot");
const statusLabel    = $("statusLabel");
const jdInput        = $("jdInput");
const dropzone       = $("dropzone");
const fileInput      = $("fileInput");
const browseLink     = $("browseLink");
const fileList       = $("fileList");
const fileCountBadge = $("fileCountBadge");
const fileCountText  = $("fileCountText");
const thresholdSlider = $("thresholdSlider");
const thresholdValue  = $("thresholdValue");
const thresholdDesc   = $("thresholdDesc");
const runBtn          = $("runBtn");
const emptyState      = $("emptyState");
const loadingState    = $("loadingState");
const loadingTitle    = $("loadingTitle");
const loadingDesc     = $("loadingDesc");
const progressBar     = $("progressBar");
const resultsContainer = $("resultsContainer");
// logoutBtn wired in hr.html inline script via auth.js

/* ── State ── */
let selectedFiles = [];
let apiOnline = false;
let lastBatchJd = "";

/* ── Health check ── */
async function checkHealth() {
  try {
    const res = await fetch("/api/health", { signal: AbortSignal.timeout(4000) });
    const { status } = await res.json();
    if (status === "ok") {
      statusDot.className = "status-dot online";
      statusLabel.textContent = "Sysnova";
      apiOnline = true;
    } else {
      setOffline();
    }
  } catch {
    setOffline();
  }
  updateRunBtn();
}
function setOffline() {
  statusDot.className = "status-dot offline";
  statusLabel.textContent = "API offline — restart: node server.js";
  apiOnline = false;
}
checkHealth();
setInterval(checkHealth, 10_000);

/* ── Threshold slider ── */
thresholdSlider.addEventListener("input", () => {
  const v = thresholdSlider.value;
  thresholdValue.textContent = v;
  thresholdDesc.textContent  = v;
});

/* ── Run button state ── */
function updateRunBtn() {
  runBtn.disabled = !(apiOnline && selectedFiles.length > 0 && jdInput.value.trim());
}
jdInput.addEventListener("input", updateRunBtn);

/* ── File management ── */
function renderFileList() {
  const count = selectedFiles.length;
  if (count === 0) {
    fileCountBadge.style.display = "none";
    fileList.innerHTML = "";
    return;
  }

  fileCountBadge.style.display = "inline-flex";
  fileCountText.textContent = `${count} / 10 CVs selected`;

  fileList.innerHTML = selectedFiles.map((f, i) => `
    <div class="hr-file-item">
      <span>📄</span>
      <span class="hr-file-name" title="${escHtml(f.name)}">${escHtml(f.name)}</span>
      <span class="hr-file-size">${(f.size / 1024).toFixed(0)} KB</span>
      <button class="hr-file-remove" data-idx="${i}" title="Remove">✕</button>
    </div>
  `).join("");

  fileList.querySelectorAll(".hr-file-remove").forEach(btn => {
    btn.addEventListener("click", (e) => {
      const idx = parseInt(e.currentTarget.dataset.idx);
      selectedFiles.splice(idx, 1);
      renderFileList();
      updateRunBtn();
    });
  });
}

function addFiles(files) {
  const pdfs = Array.from(files).filter(f => f.name.toLowerCase().endsWith(".pdf"));
  const remaining = 10 - selectedFiles.length;
  selectedFiles = [...selectedFiles, ...pdfs.slice(0, remaining)];
  renderFileList();
  updateRunBtn();
}

browseLink.addEventListener("click", (e) => { e.stopPropagation(); fileInput.click(); });
dropzone.addEventListener("click", () => fileInput.click());

fileInput.addEventListener("change", () => {
  addFiles(fileInput.files);
  fileInput.value = "";
});

dropzone.addEventListener("dragover",  (e) => { e.preventDefault(); dropzone.classList.add("drag-over"); });
dropzone.addEventListener("dragleave", ()  => dropzone.classList.remove("drag-over"));
dropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropzone.classList.remove("drag-over");
  addFiles(e.dataTransfer.files);
});

/* ── Run ── */
runBtn.addEventListener("click", runScreening);

async function runScreening() {
  if (!selectedFiles.length || !jdInput.value.trim()) return;

  const jd        = jdInput.value.trim();
  lastBatchJd     = jd;
  const threshold = parseInt(thresholdSlider.value);
  const total     = selectedFiles.length;

  emptyState.classList.add("hidden");
  resultsContainer.classList.add("hidden");
  loadingState.classList.remove("hidden");
  runBtn.disabled = true;
  progressBar.style.width = "5%";
  loadingTitle.textContent = `Processing ${total} CV${total > 1 ? "s" : ""}…`;
  loadingDesc.textContent  = "Running Sysnova AI on each candidate";

  const fd = new FormData();
  fd.append("jd_text",   jd);
  fd.append("threshold", threshold);
  selectedFiles.forEach(f => fd.append("cvs", f));

  try {
    /* Animate progress bar while waiting */
    let prog = 5;
    const tick = setInterval(() => {
      prog = Math.min(prog + (90 / total / 4), 90);
      progressBar.style.width = prog + "%";
    }, 800);

    const res  = await fetch("/api/hr-shortlist", { method: "POST", body: fd });
    clearInterval(tick);
    progressBar.style.width = "100%";

    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Screening failed.");

    setTimeout(() => {
      loadingState.classList.add("hidden");
      renderResults(data, threshold);
    }, 300);
  } catch (e) {
    loadingState.classList.add("hidden");
    emptyState.classList.remove("hidden");
    alert("Error: " + e.message);
  } finally {
    updateRunBtn();
  }
}

/* ── Render results ── */
function renderResults(data, threshold) {
  resultsContainer.classList.remove("hidden");

  const valid   = data.results.filter(r => !r.error);
  const errored = data.results.filter(r => r.error);
  const sl      = valid.filter(r => r.shortlisted);
  const rej     = valid.filter(r => !r.shortlisted);

  /* Stats */
  $("hrStats").innerHTML = `
    <div class="hr-stat"><div class="hr-stat-val total">${data.total}</div><div class="hr-stat-label">Total CVs</div></div>
    <div class="hr-stat"><div class="hr-stat-val shortlisted">${sl.length}</div><div class="hr-stat-label">Shortlisted</div></div>
    <div class="hr-stat"><div class="hr-stat-val rejected">${rej.length}</div><div class="hr-stat-label">Not Relevant</div></div>
    <div class="hr-stat"><div class="hr-stat-val threshold">${threshold}</div><div class="hr-stat-label">Threshold</div></div>
  `;

  $("resultsMeta").innerHTML = `
    <strong>${data.total}</strong> CV${data.total !== 1 ? "s" : ""} processed &nbsp;·&nbsp;
    threshold <strong>${threshold}</strong>
    ${errored.length ? ` &nbsp;·&nbsp; <span style="color:var(--accent-red)">${errored.length} error${errored.length > 1 ? "s" : ""}</span>` : ""}
  `;

  /* Panels */
  const allCards  = valid.map((r, i) => cardHtml(r, i + 1)).join("") + errored.map(e => errorCardHtml(e)).join("");
  const slCards   = sl.map((r, i) => cardHtml(r, i + 1)).join("") || tabEmpty("No shortlisted candidates.");
  const rejCards  = rej.map((r, i) => cardHtml(r, i + 1)).join("") || tabEmpty("No candidates below threshold.");

  $("panelAll").innerHTML        = allCards || tabEmpty("No results.");
  $("panelShortlisted").innerHTML = slCards;
  $("panelRejected").innerHTML    = rejCards;

  /* Tab labels */
  $("tabAll").textContent         = `All (${data.total})`;
  $("tabShortlisted").textContent = `✅ Shortlisted (${sl.length})`;
  $("tabRejected").textContent    = `Not Relevant (${rej.length})`;

  /* Tab switching */
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const tab = btn.dataset.tab;
      ["all","shortlisted","rejected"].forEach(t => {
        $("panel" + t.charAt(0).toUpperCase() + t.slice(1)).classList.toggle("hidden", t !== tab);
      });
    });
  });

  /* Expand / collapse */
  document.querySelectorAll(".hr-card-header").forEach(h => {
    h.addEventListener("click", (e) => {
      if (e.target.closest(".hr-exam-btn")) return;
      h.closest(".hr-card").classList.toggle("expanded");
    });
  });

  /* Give Exam buttons */
  document.querySelectorAll(".hr-exam-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      openBatchSendExam(btn.dataset.candidate, lastBatchJd);
    });
  });

  /* Skill match toggle in batch analysis */
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
}

function cardHtml(r, rank) {
  const score      = r.ats_match_score ?? 0;
  const scoreClass = score >= 75 ? "score-high" : score >= 50 ? "score-med" : "score-low";
  const rankClass  = rank === 1 ? "rank-1" : rank === 2 ? "rank-2" : rank === 3 ? "rank-3" : "";
  const badge      = r.shortlisted
    ? `<span class="hr-badge badge-shortlisted">✅ Shortlisted</span>`
    : `<span class="hr-badge badge-rejected">Not Relevant</span>`;

  const strengths = (r.key_strengths || []).slice(0, 4)
    .map(s => `<span class="tag tag-green">${escHtml(s)}</span>`).join("");
  const keywords  = (r.ats?.matched_keywords || []).slice(0, 6)
    .map(k => `<span class="tag tag-blue">${escHtml(k)}</span>`).join("");

  /* Missing requirements panel */
  const missingReqs = r.missing_requirements || [];
  const missingKws  = r.ats?.missing_keywords || [];
  const totalGaps   = missingReqs.length + missingKws.length;

  const missingPanel = totalGaps === 0
    ? `<div class="hr-missing-panel all-clear">
        <div class="hr-missing-title ok">✅ All key requirements met</div>
       </div>`
    : `<div class="hr-missing-panel">
        <div class="hr-missing-title">
          ⚠ What's Missing
          <span class="hr-missing-badge">${totalGaps}</span>
        </div>
        ${missingReqs.length ? `
        <div class="hr-missing-items">
          ${missingReqs.map(m => `<div class="hr-missing-item">${escHtml(m)}</div>`).join("")}
        </div>` : ""}
        ${missingKws.length ? `
        <div class="hr-missing-kws">
          ${missingKws.map(k => `<span class="hr-missing-kw">${escHtml(k)}</span>`).join("")}
        </div>` : ""}
       </div>`;

  /* Skills match panel for batch analysis */
  const matchedKws = r.ats?.matched_keywords || [];
  const allStrengths = r.key_strengths || [];
  const allGaps = r.gaps || [];
  const totalKws = matchedKws.length + missingKws.length;
  const matchPct = totalKws > 0 ? Math.round((matchedKws.length / totalKws) * 100) : 0;

  const batchSkillsPanel = `
    <div class="app-skills-toggle-row" style="margin-top:14px">
      <button class="app-skills-toggle-btn" data-target="skills-batch-${rank}">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
        Skill Match Breakdown
        <span class="app-skills-toggle-arrow">▾</span>
      </button>
      <span class="app-skills-coverage-pill ${matchPct >= 70 ? "good" : matchPct >= 40 ? "mid" : "low"}">${matchPct}% matched</span>
    </div>
    <div class="app-skills-panel hidden" id="skills-batch-${rank}">
      <div class="skills-coverage-bar-wrap">
        <div class="skills-coverage-bar-fill" style="width:${matchPct}%"></div>
        <span class="skills-coverage-label">${matchedKws.length} of ${totalKws} keywords present</span>
      </div>
      <div class="skills-cols">
        <div class="skills-col">
          <div class="skills-col-title matched-title">✓ Present (${matchedKws.length})</div>
          <div class="skills-tags">
            ${matchedKws.length ? matchedKws.map(k => `<span class="skill-tag skill-matched">${escHtml(k)}</span>`).join("") : `<span class="skills-none">None detected</span>`}
          </div>
          ${allStrengths.length ? `
          <div class="skills-col-title matched-title" style="margin-top:10px">★ Strengths</div>
          <div class="skills-tags">${allStrengths.map(s => `<span class="skill-tag skill-strength">${escHtml(s)}</span>`).join("")}</div>` : ""}
        </div>
        <div class="skills-col">
          <div class="skills-col-title missing-title">✗ Missing (${missingKws.length})</div>
          <div class="skills-tags">
            ${missingKws.length ? missingKws.map(k => `<span class="skill-tag skill-missing">${escHtml(k)}</span>`).join("") : `<span class="skills-none">No gaps found ✓</span>`}
          </div>
          ${allGaps.length ? `
          <div class="skills-col-title missing-title" style="margin-top:10px">Gaps</div>
          <div class="skills-tags">${allGaps.map(g => `<span class="skill-tag skill-gap">${escHtml(g)}</span>`).join("")}</div>` : ""}
        </div>
      </div>
    </div>`;

  return `
    <div class="hr-card ${r.shortlisted ? "card-shortlisted" : "card-rejected"}">
      <div class="hr-card-header">
        <div class="hr-rank ${rankClass}">#${rank}</div>
        <div class="hr-identity">
          <div class="hr-name">${escHtml(r.candidate_name || "Unknown")}</div>
          <div class="hr-filename">${escHtml(r.filename)}</div>
        </div>
        <div class="hr-score-block">
          <div class="hr-score ${scoreClass}">${score}</div>
          <div class="hr-score-label">Combined</div>
        </div>
        ${badge}
        ${r.shortlisted ? `<button class="hr-exam-btn" data-candidate="${escHtml(r.candidate_name || "Candidate")}">📝 Give Exam</button>` : ""}
        <span class="hr-chevron">▾</span>
      </div>
      <div class="hr-card-body">
        ${missingPanel}
        <div class="sub-scores">
          ${subBar("AI Score",    r.overall_score             || 0)}
          ${subBar("Skills",      r.skills_match              || 0)}
          ${subBar("Experience",  r.experience_match          || 0)}
          ${subBar("Keywords",    r.ats?.keyword_match_pct    || 0, "%")}
        </div>
        ${r.summary ? `<div class="hr-summary">${escHtml(r.summary)}</div>` : ""}
        ${strengths ? `<div class="hr-tags-row"><span class="tags-label">Strengths:</span>${strengths}</div>` : ""}
        ${batchSkillsPanel}
      </div>
    </div>
  `;
}

function subBar(label, value, suffix = "") {
  return `
    <div class="sub-score-row">
      <span class="sub-score-label">${label}</span>
      <div class="sub-score-bar"><div class="sub-score-fill" style="width:${value}%"></div></div>
      <span class="sub-score-val">${value}${suffix}</span>
    </div>
  `;
}

function errorCardHtml(r) {
  return `
    <div class="hr-card card-error">
      <div class="hr-card-header">
        <div class="hr-identity">
          <div class="hr-name">⚠ Processing Error</div>
          <div class="hr-filename">${escHtml(r.filename)}</div>
        </div>
        <span class="hr-badge badge-error">Error</span>
      </div>
      <div class="hr-card-body" style="display:block; padding-top:12px;">
        <div class="hr-summary error-msg">${escHtml(r.error_message || "Unknown error")}</div>
      </div>
    </div>
  `;
}

function tabEmpty(msg) {
  return `<div class="tab-empty">${msg}</div>`;
}

function escHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// =============================================================================
// ── BATCH: SEND EXAM TO APPLICANT USER ───────────────────────────────────────
// =============================================================================

async function openBatchSendExam(candidateName, jdText) {
  const info = $("batchSendCandidateInfo");
  if (info) info.innerHTML = `<strong>Candidate from batch:</strong> ${escH(candidateName)}`;
  const jdEl = $("batchSendJdInput");
  if (jdEl) jdEl.value = jdText || "";
  const errEl = $("batchSendError");
  if (errEl) errEl.classList.add("hidden");
  const slider = $("batchExamExpirySlider");
  const sliderVal = $("batchExamExpiryVal");
  if (slider) slider.value = "7";
  if (sliderVal) sliderVal.textContent = "7";
  const selInfo = $("batchSendSelectedInfo");
  if (selInfo) selInfo.style.display = "none";

  // Populate the applicant dropdown with shortlisted candidates from the database
  const sel = $("batchSendEmailSelect");
  if (sel) {
    sel.innerHTML = '<option value="">Loading shortlisted applicants…</option>';
    sel.disabled = true;
    try {
      // Fetch shortlisted AND selected applicants
      const [r1, r2] = await Promise.all([
        fetch("/api/applications?status=shortlisted", { headers: authHeaders() }),
        fetch("/api/applications?status=selected",    { headers: authHeaders() }),
      ]);
      const [a1, a2] = await Promise.all([r1.json(), r2.json()]);
      const apps = [...(Array.isArray(a1) ? a1 : []), ...(Array.isArray(a2) ? a2 : [])];

      if (!apps.length) {
        sel.innerHTML = '<option value="">No shortlisted applicants found</option>';
      } else {
        sel.innerHTML = '<option value="">— Select an applicant —</option>' +
          apps.map(a => {
            const pos   = a.jobTitle ? ` — ${a.jobTitle}` : "";
            const label = `${a.candidateName}${pos} (${a.candidateEmail})`;
            return `<option value="${escH(a.candidateEmail)}" data-name="${escH(a.candidateName)}" data-pos="${escH(a.jobTitle||'')}">${label}</option>`;
          }).join("");
      }
      sel.disabled = false;
    } catch {
      sel.innerHTML = '<option value="">Failed to load applicants</option>';
      sel.disabled = false;
    }
  }

  const modal = $("batchSendExamModal");
  if (modal) modal.classList.remove("hidden");
}

(function() {
  const modal = $("batchSendExamModal");
  if (!modal) return;

  const closeModal = () => modal.classList.add("hidden");
  $("batchSendExamClose")?.addEventListener("click", closeModal);
  $("batchSendExamCancel")?.addEventListener("click", closeModal);

  const slider = $("batchExamExpirySlider");
  const sliderVal = $("batchExamExpiryVal");
  if (slider && sliderVal) {
    slider.addEventListener("input", () => { sliderVal.textContent = slider.value; });
  }

  // Show a detail line when an applicant is chosen from the dropdown
  $("batchSendEmailSelect")?.addEventListener("change", function() {
    const opt    = this.options[this.selectedIndex];
    const selInfo = $("batchSendSelectedInfo");
    if (!selInfo) return;
    if (!this.value) { selInfo.style.display = "none"; return; }
    const pos = opt.dataset.pos;
    selInfo.style.display = "block";
    selInfo.innerHTML = `<strong>${escH(opt.dataset.name)}</strong>${pos ? ` &nbsp;·&nbsp; Position: <strong>${escH(pos)}</strong>` : ""} &nbsp;·&nbsp; ${escH(this.value)}`;
  });

  $("batchSendExamRunBtn")?.addEventListener("click", async () => {
    const email  = ($("batchSendEmailSelect")?.value || "").trim();
    const jdText = ($("batchSendJdInput")?.value     || "").trim();
    const expiry = parseInt($("batchExamExpirySlider")?.value || "7");
    const errEl  = $("batchSendError");

    if (!email)  { if (errEl) { errEl.textContent = "Please select an applicant."; errEl.classList.remove("hidden"); } return; }
    if (!jdText) { if (errEl) { errEl.textContent = "Job description is required."; errEl.classList.remove("hidden"); } return; }
    if (errEl) errEl.classList.add("hidden");

    modal.classList.add("hidden");
    const grading = $("batchSendGrading");
    if (grading) grading.classList.remove("hidden");

    try {
      const res  = await fetch("/api/exams/send-to-user", {
        method:  "POST",
        headers: authHeaders(),
        body:    JSON.stringify({ userEmail: email, jdText, expiryDays: expiry }),
      });
      const data = await res.json();
      if (grading) grading.classList.add("hidden");

      if (res.ok) {
        alert(`✅ Exam sent to ${email}!\nExpires: ${new Date(data.expiresAt).toLocaleDateString()}`);
        refreshAllCounts();
      } else {
        modal.classList.remove("hidden");
        if (errEl) { errEl.textContent = data.detail || "Failed to send exam."; errEl.classList.remove("hidden"); }
      }
    } catch {
      if (grading) grading.classList.add("hidden");
      modal.classList.remove("hidden");
      if (errEl) { errEl.textContent = "Network error. Please try again."; errEl.classList.remove("hidden"); }
    }
  });
})();

/* ═══════════════════════════════════════════════════════════════════════════ */
/* HR EXAM MODULE                                                               */
/* ═══════════════════════════════════════════════════════════════════════════ */

let hrExamState = {
  candidateName: "",
  evaluationKey: [],
  questions:     [],
  answers:       {},
  submitted:     false,
};

const hrExamModal      = () => document.getElementById("hrExamModal");
const hrExamWarning    = () => document.getElementById("hrExamWarning");
const hrExamGrading    = () => document.getElementById("hrExamGrading");
const hrExamQContainer = () => document.getElementById("hrExamQuestions");

/* ── Open exam for a shortlisted candidate ─────────────────────────────── */
async function openHRExam(candidateName) {
  const jdText = jdInput?.value?.trim();
  if (!jdText) { alert("Please enter a Job Description first."); return; }

  hrExamState = { candidateName, evaluationKey: [], questions: [], answers: {}, submitted: false };

  document.getElementById("hrExamCandidate").textContent      = candidateName;
  document.getElementById("hrExamAnsweredCount").textContent  = "0";
  document.getElementById("hrExamSubmitBtn").textContent      = "Submit Exam";
  document.getElementById("hrExamSubmitBtn").disabled         = false;
  document.getElementById("hrExamSubmitBtn").classList.remove("submitted");
  document.getElementById("hrExamFooterProgress").textContent = "0 of 15 questions answered";

  hrExamQContainer().innerHTML = `
    <div style="text-align:center;padding:60px 0;color:var(--text-secondary)">
      <div class="exam-spinner" style="margin:0 auto 18px"></div>
      Generating exam questions from the Job Description…
    </div>`;
  hrExamModal().classList.remove("hidden");

  try {
    const fd = new FormData();
    fd.append("jd_text", jdText);
    const res  = await fetch("/api/generate-questions", { method: "POST", body: fd });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `HTTP ${res.status}`);
    }
    const data = await res.json();
    hrExamState.evaluationKey = data.evaluation_key;
    hrExamState.questions     = data.questions;
    renderHRExamQuestions(data.questions);
  } catch (e) {
    hrExamQContainer().innerHTML = `
      <div style="color:#ef4444;text-align:center;padding:40px">
        ❌ Failed to generate questions: ${escHtml(String(e.message))}
      </div>`;
  }
}

/* ── Render question cards ──────────────────────────────────────────────── */
function renderHRExamQuestions(questions) {
  if (!questions?.length) { hrExamQContainer().innerHTML = "<p>No questions generated.</p>"; return; }

  const secs = [
    { label: "Section A — Easy  (1 pt each)",    diff: "easy" },
    { label: "Section B — Medium  (2 pts each)", diff: "medium" },
    { label: "Section C — Hard  (3 pts each)",   diff: "hard" },
  ];

  let html = "";
  let num  = 0;
  for (const sec of secs) {
    const items = questions.filter(q => q.difficulty === sec.diff);
    if (!items.length) continue;
    html += `<div class="exam-section-heading">${escHtml(sec.label)}</div>`;
    for (const q of items) {
      num++;
      html += hrQuestionCardHtml(q, num);
    }
  }
  hrExamQContainer().innerHTML = html;
  hrExamQContainer().querySelectorAll(".exam-option").forEach(el =>
    el.addEventListener("click", () => handleHROptionClick(el))
  );
}

function hrQuestionCardHtml(q, displayNum) {
  const pts = q.points;
  const diffLabel = q.difficulty.charAt(0).toUpperCase() + q.difficulty.slice(1);
  const opts = (q.options || []).map(opt => `
    <div class="exam-option" data-qid="${q.id}" data-key="${escHtml(opt.key || opt.label)}">
      <span class="exam-option-key">${escHtml(opt.key || opt.label)}</span>
      <span>${escHtml(opt.text)}</span>
    </div>`).join("");

  return `
  <div class="exam-q-card" id="hrqcard_${q.id}">
    <div class="exam-q-header">
      <div class="exam-q-text">Q${displayNum}. ${escHtml(q.question)}</div>
      <div class="exam-q-meta">
        <span class="exam-q-badge badge-${q.difficulty}">${diffLabel}</span>
        <span class="exam-q-points">${pts} pt${pts > 1 ? "s" : ""}</span>
      </div>
    </div>
    <div class="exam-multi-hint">○ Select one answer</div>
    <div class="exam-options">${opts}</div>
  </div>`;
}

/* ── Option click ────────────────────────────────────────────────────────── */
function handleHROptionClick(el) {
  if (hrExamState.submitted) return;
  const qid      = el.dataset.qid;
  const key      = el.dataset.key;
  hrExamQContainer()
    .querySelectorAll(`.exam-option[data-qid="${qid}"]`)
    .forEach(s => s.classList.remove("selected"));
  el.classList.add("selected");
  hrExamState.answers[qid] = key;
  document.getElementById(`hrqcard_${qid}`)?.classList.add("answered");
  updateHRAnsweredCount();
}

function updateHRAnsweredCount() {
  const count = Object.keys(hrExamState.answers).length;
  document.getElementById("hrExamAnsweredCount").textContent  = count;
  document.getElementById("hrExamFooterProgress").textContent = `${count} of 15 questions answered`;
}

/* ── Submit ──────────────────────────────────────────────────────────────── */
document.getElementById("hrExamSubmitBtn").addEventListener("click", () => {
  if (hrExamState.submitted) return;
  document.getElementById("hrExamWarningAnswered").textContent = Object.keys(hrExamState.answers).length;
  hrExamWarning().classList.remove("hidden");
});

document.getElementById("hrExamWarningCancel").addEventListener("click",
  () => hrExamWarning().classList.add("hidden"));

document.getElementById("hrExamWarningConfirm").addEventListener("click", async () => {
  hrExamWarning().classList.add("hidden");
  hrExamState.submitted = true;
  document.getElementById("hrExamSubmitBtn").disabled = true;
  await gradeHRExam();
});

document.getElementById("hrExamCloseBtn").addEventListener("click", () => {
  if (!hrExamState.submitted) {
    if (!confirm("Leave exam? Your answers will be lost.")) return;
  }
  hrExamModal().classList.add("hidden");
});

/* ── Grade ───────────────────────────────────────────────────────────────── */
async function gradeHRExam() {
  hrExamGrading().classList.remove("hidden");
  const answers = Object.entries(hrExamState.answers).map(([qid, ans]) => ({
    question_id: Number(qid), answer: String(ans),
  }));

  try {
    const res = await fetch("/api/submit-exam", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        candidate_name: hrExamState.candidateName,
        evaluation_key: hrExamState.evaluationKey,
        answers,
      }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || `HTTP ${res.status}`);
    const data = await res.json();
    hrExamGrading().classList.add("hidden");
    renderHRExamResults(data);
  } catch (e) {
    hrExamGrading().classList.add("hidden");
    document.getElementById("hrExamSubmitBtn").textContent = "✅ Submitted";
    document.getElementById("hrExamSubmitBtn").classList.add("submitted");
    hrExamQContainer().innerHTML = `<div style="color:#ef4444;text-align:center;padding:40px">
      ❌ Grading error: ${escHtml(String(e.message))}</div>`;
  }
}

/* ── Results ─────────────────────────────────────────────────────────────── */
function renderHRExamResults(data) {
  const earned  = Number(data.total_earned) || 0;
  const max     = Number(data.total_max)    || 30;
  const pct     = data.percentage ?? Math.round((earned / max) * 100);
  const grade   = data.grade || "—";
  const earnedS = Number.isInteger(earned) ? String(earned) : earned.toFixed(1);

  let html = `
  <div class="exam-results-summary">
    <div style="text-align:center;min-width:120px">
      <div class="exam-results-score-big">${earnedS}<span class="exam-results-score-denom"> / ${max}</span></div>
      <div style="font-size:13px;opacity:.8;margin-top:4px">${pct}%</div>
    </div>
    <div class="exam-results-breakdown">
      <h2>${grade}</h2>
      <p style="margin-bottom:10px">${escHtml(data.candidate_name)} · ${(data.results||[]).length} questions</p>
      <div style="display:flex;gap:12px;flex-wrap:wrap">
        ${(data.sections||[]).map(s => `
          <div style="background:rgba(255,255,255,.18);border-radius:8px;padding:5px 12px;font-size:13px">
            <span style="text-transform:capitalize;font-weight:700">${s.difficulty}</span>
            &nbsp;<span style="opacity:.9">${s.earned} / ${s.max} pts</span>
          </div>`).join("")}
      </div>
    </div>
  </div>`;

  const secs = [
    { label: "Section A — Easy (1 pt each)",    diff: "easy" },
    { label: "Section B — Medium (2 pts each)", diff: "medium" },
    { label: "Section C — Hard (3 pts each)",   diff: "hard" },
  ];
  let num = 0;

  for (const sec of secs) {
    const secR = (data.results||[]).filter(r => (r.difficulty||"").toLowerCase() === sec.diff);
    if (!secR.length) continue;
    html += `<div class="exam-section-heading">${escHtml(sec.label)}</div>`;

    for (const r of secR) {
      num++;
      const earnedN   = Number(r.earned) || 0;
      const maxPtsN   = Number(r.points) || 1;
      const isCorrect = earnedN >= maxPtsN;
      const earnedStr = Number.isInteger(earnedN) ? String(earnedN) : earnedN.toFixed(1);
      const rawCorrect = r.correct_answer ||
        (r.feedback||"").match(/(?:Correct answer|correct answer)[:\s]+([A-E])/i)?.[1] || "";
      const correctSet  = rawCorrect.toUpperCase();
      const givenKey    = (r.given_answer||"").toUpperCase();
      const notAnswered = !r.given_answer?.trim();

      const opts = (r.options||[]).map(opt => {
        const optKey      = (opt.key||opt.label||"").toUpperCase();
        const wasSelected = givenKey === optKey;
        const isCorrectO  = correctSet === optKey;
        let cls = "exam-option disabled";
        if (wasSelected && isCorrectO) cls += " correct";
        else if (wasSelected)         cls += " wrong";
        else if (isCorrectO)          cls += " reveal-correct";
        return `<div class="${cls}">
          <span class="exam-option-key">${escHtml(opt.key||opt.label)}</span>
          <span>${escHtml(opt.text)}</span>
          ${isCorrectO ? `<span style="margin-left:auto;font-size:12px;color:#22c55e;font-weight:700;padding:2px 8px;background:rgba(34,197,94,0.18);border-radius:20px;white-space:nowrap">✓ Correct</span>` : ""}
        </div>`;
      }).join("");

      const correctOpt  = (r.options||[]).find(o => (o.key||o.label||"").toUpperCase() === correctSet);
      const correctText = correctOpt ? escHtml(correctOpt.text) : "";
      const border      = isCorrect ? "#22c55e" : earnedN === 0 ? "#ef4444" : "#f59e0b";

      const feedbackBar = isCorrect
        ? `<div class="exam-feedback-bar correct"><span class="exam-fb-icon">✅</span>
            <span><strong>Correct!</strong> Answer: <strong>${escHtml(correctSet)}</strong> — ${correctText}</span></div>`
        : notAnswered
          ? `<div class="exam-feedback-bar not-answered"><span class="exam-fb-icon">⏭</span>
              <span><strong>Not answered.</strong> Correct: <strong>${escHtml(correctSet)}</strong> — ${correctText}</span></div>`
          : `<div class="exam-feedback-bar wrong"><span class="exam-fb-icon">❌</span>
              <span>You answered <strong>${escHtml(givenKey)}</strong> — incorrect.
              Correct: <strong>${escHtml(correctSet)}</strong> — ${correctText}</span></div>`;

      html += `
      <div class="exam-q-card answered" style="border-left:4px solid ${border}">
        <div class="exam-q-header">
          <div class="exam-q-text">Q${num}. ${escHtml(r.question)}</div>
          <div class="exam-q-meta">
            <span class="exam-q-badge badge-${(r.difficulty||"easy").toLowerCase()}">${r.difficulty}</span>
            <span class="exam-q-points" style="color:${border}">${earnedStr} / ${maxPtsN} pts</span>
          </div>
        </div>
        <div class="exam-options">${opts}</div>
        ${feedbackBar}
      </div>`;
    }
  }

  hrExamQContainer().innerHTML = html;
  document.querySelector("#hrExamModal .exam-body").scrollTop = 0;

  document.getElementById("hrExamSubmitBtn").textContent = "✅ Submitted";
  document.getElementById("hrExamSubmitBtn").classList.add("submitted");
  document.getElementById("hrExamSubmitBtn").disabled = true;
  document.getElementById("hrExamAnsweredCount").textContent = `${earnedS}/${max}`;
  document.getElementById("hrExamFooterProgress").innerHTML =
    `<strong style="font-size:16px;color:var(--bkash-pink)">
       Final Score: ${earnedS} / ${max} pts &nbsp;·&nbsp; ${pct}% &nbsp;·&nbsp; ${grade}
     </strong>`;
}

// =============================================================================
// ── HR MODULE TABS ────────────────────────────────────────────────────────────
// =============================================================================

(function initHRTabs() {
  const tabs   = document.querySelectorAll(".hr-module-tab");
  const panels = {
    home:         $("panelHome"),
    batch:        $("panelBatch"),
    applications: $("panelApplications"),
    exampending:  $("panelExamPending"),
    examresults:  $("panelExamResults"),
  };

  function switchTab(name) {
    tabs.forEach(t => t.classList.toggle("hr-module-tab-active", t.dataset.panel === name));
    Object.entries(panels).forEach(([k, el]) => el && el.classList.toggle("hidden", k !== name));
    if (name === "home")         loadHomeDashboard();
    if (name === "applications") loadApplications();
    if (name === "exampending")  loadExamPending();
    if (name === "examresults")  loadExamResults();
  }

  window.switchToPanel = switchTab;
  tabs.forEach(t => t.addEventListener("click", () => switchTab(t.dataset.panel)));
  refreshAllCounts();
  loadHomeDashboard();
})();

// =============================================================================
// ── APPLICATIONS MANAGEMENT ──────────────────────────────────────────────────
// =============================================================================

let appsData     = [];
let allAppsData  = [];   // full unfiltered list; filtered client-side
let selectedAppIds = new Set();
let pendingSendAppId = null;

const appsEmpty       = $("appsEmpty");
const appsTableEl     = $("appsTable");
const appsSelectAll   = $("appsSelectAll");
const appsAnalyzeBtn  = $("appsAnalyzeBtn");
const appsKeyword     = $("appKeyword");
const appsStatusFilter= $("appStatusFilter");
const appsRefreshBtn  = $("appsRefreshBtn");
const hrAppCountBadge = $("hrAppCount");

// Analyze modal refs
const analyzeModal       = $("analyzeModal");
const analyzeModalClose  = $("analyzeModalClose");
const analyzeModalCancel = $("analyzeModalCancel");
const analyzeJdInput     = $("analyzeJdInput");
const analyzeThreshold   = $("analyzeThreshold");
const analyzeThresholdVal= $("analyzeThresholdVal");
const analyzeRunBtn      = $("analyzeRunBtn");
const analyzeProgress    = $("analyzeProgress");
const analyzeProgressText= $("analyzeProgressText");
const analyzeProgressBar = $("analyzeProgressBar");
const analyzeError       = $("analyzeError");

// Send exam modal refs
const sendExamModal       = $("sendExamModal");
const sendExamModalClose  = $("sendExamModalClose");
const sendExamModalCancel = $("sendExamModalCancel");
const sendExamJdInput     = $("sendExamJdInput");
const sendExamRunBtn      = $("sendExamRunBtn");
const sendExamGrading     = $("sendExamGrading");
const sendExamError       = $("sendExamError");
const examExpirySlider    = $("examExpirySlider");
const examExpiryVal       = $("examExpiryVal");

// Exam detail modal refs
const examDetailModal = $("examDetailModal");
const examDetailClose = $("examDetailClose");
const examDetailTitle = $("examDetailTitle");
const examDetailBody  = $("examDetailBody");

// ── Threshold slider
if (analyzeThreshold) {
  analyzeThreshold.addEventListener("input", () => { analyzeThresholdVal.textContent = analyzeThreshold.value; });
}
if (examExpirySlider) {
  examExpirySlider.addEventListener("input", () => { examExpiryVal.textContent = examExpirySlider.value; });
}

async function loadApplicationCount() {
  try {
    const res  = await fetch("/api/applications", { headers: authHeaders() });
    const data = res.ok ? await res.json() : [];
    if (hrAppCountBadge) {
      hrAppCountBadge.textContent = data.length;
      hrAppCountBadge.style.display = data.length ? "inline-flex" : "none";
    }
  } catch {}
}

async function loadApplications() {
  try {
    const res = await fetch("/api/applications", { headers: authHeaders() });
    const all = res.ok ? await res.json() : [];
    allAppsData = all.filter(a => !["exam_sent", "exam_completed"].includes(a.status));
    applyAppsFilter();
  } catch (e) {
    console.error("loadApplications error:", e);
  }
}

function applyAppsFilter() {
  const keyword = appsKeyword ? appsKeyword.value.trim().toLowerCase() : "";
  const status  = appsStatusFilter ? appsStatusFilter.value : "";

  appsData = allAppsData.filter(a => {
    if (status && a.status !== status) return false;
    if (keyword) {
      return (a.candidateName  || "").toLowerCase().includes(keyword) ||
             (a.candidateEmail || "").toLowerCase().includes(keyword);
    }
    return true;
  });

  renderAppsCards(appsData);
  selectedAppIds.clear();
  if (appsSelectAll) appsSelectAll.checked = false;
  updateAnalyzeBtn();
  if (hrAppCountBadge) {
    hrAppCountBadge.textContent = allAppsData.length;
    hrAppCountBadge.style.display = allAppsData.length ? "inline-flex" : "none";
  }
}

function renderAppsCards(data) {
  if (!data.length) {
    appsEmpty   && appsEmpty.classList.remove("hidden");
    appsTableEl && appsTableEl.classList.add("hidden");
    return;
  }
  appsEmpty   && appsEmpty.classList.add("hidden");
  appsTableEl && appsTableEl.classList.remove("hidden");

  const statusColors = {
    uploaded:    "#64748b",
    analyzed:    "#3b82f6",
    shortlisted: "#22c55e",
    next_level:  "#8b5cf6",
    rejected:    "#ef4444",
    exam_sent:   "#f59e0b",
    exam_completed: "#0ea5e9",
  };
  const statusLabels = {
    uploaded:    "Uploaded",
    analyzed:    "Analyzed",
    shortlisted: "Shortlisted",
    next_level:  "Next Level",
    rejected:    "Not Selected",
    exam_sent:   "Exam Sent",
    exam_completed: "Exam Done",
  };

  const selectBarHtml = `
    <div class="apps-select-bar">
      <label style="display:flex;align-items:center;gap:6px;cursor:pointer;user-select:none">
        <input type="checkbox" id="appsSelectAllCards" ${selectedAppIds.size === data.length && data.length ? "checked" : ""} />
        Select all (${data.length})
      </label>
      <button class="app-card-action-btn btn-primary" id="appsAnalyzeBtnCards" ${selectedAppIds.size === 0 ? "disabled" : ""}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
        Analyze Selected (${selectedAppIds.size})
      </button>
    </div>`;

  const cardsHtml = data.map(a => {
    const sc    = a.analysisResult;
    const color = statusColors[a.status] || "#888";
    const label = statusLabels[a.status] || a.status;
    const canSendExam = a.status === "shortlisted" && !a.examId;

    const scoresHtml = sc ? `
      <div class="app-card-scores">
        <span class="app-mini-score"><span>AI</span> <strong>${sc.aiScore}%</strong></span>
        <span class="app-mini-score"><span>ATS</span> <strong>${sc.atsScore}%</strong></span>
        <span class="app-mini-score app-mini-combined"><span>Combined</span> <strong>${sc.combinedScore}%</strong></span>
        ${sc.shortlisted
          ? `<span class="app-ai-verdict shortlisted">✅ AI: Shortlisted</span>`
          : `<span class="app-ai-verdict rejected">✗ AI: Not Selected</span>`}
      </div>` : "";

    const summaryHtml = sc && sc.summary ? `
      <div class="app-card-summary">${escH(sc.summary)}</div>` : "";

    /* Skills Match Panel */
    const skillsHtml = sc ? (() => {
      const matched = (sc.ats?.matched_keywords) || [];
      const missing = (sc.ats?.missing_keywords)  || [];
      const strengths = sc.key_strengths || [];
      const gaps = sc.gaps || [];
      const missingReqs = sc.missing_requirements || [];
      const total = matched.length + missing.length;
      const pct = total > 0 ? Math.round((matched.length / total) * 100) : 0;
      return `
      <div class="app-skills-toggle-row">
        <button class="app-skills-toggle-btn" data-target="skills-app-${a.id}">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
          Skill Match Breakdown
          <span class="app-skills-toggle-arrow">▾</span>
        </button>
        <span class="app-skills-coverage-pill ${pct >= 70 ? "good" : pct >= 40 ? "mid" : "low"}">${pct}% matched</span>
      </div>
      <div class="app-skills-panel hidden" id="skills-app-${a.id}">
        <div class="skills-coverage-bar-wrap">
          <div class="skills-coverage-bar-fill" style="width:${pct}%"></div>
          <span class="skills-coverage-label">${matched.length} of ${total} keywords present</span>
        </div>
        <div class="skills-cols">
          <div class="skills-col">
            <div class="skills-col-title matched-title">✓ Present (${matched.length})</div>
            <div class="skills-tags">
              ${matched.length ? matched.map(k => `<span class="skill-tag skill-matched">${escH(k)}</span>`).join("") : `<span class="skills-none">None detected</span>`}
            </div>
            ${strengths.length ? `
            <div class="skills-col-title matched-title" style="margin-top:10px">★ Strengths</div>
            <div class="skills-tags">${strengths.map(s => `<span class="skill-tag skill-strength">${escH(s)}</span>`).join("")}</div>` : ""}
          </div>
          <div class="skills-col">
            <div class="skills-col-title missing-title">✗ Missing (${missing.length})</div>
            <div class="skills-tags">
              ${missing.length ? missing.map(k => `<span class="skill-tag skill-missing">${escH(k)}</span>`).join("") : `<span class="skills-none">No gaps found ✓</span>`}
            </div>
            ${missingReqs.length ? `
            <div class="skills-col-title missing-title" style="margin-top:10px">⚠ Unmet Requirements</div>
            <div class="skills-tags">${missingReqs.map(m => `<span class="skill-tag skill-gap">${escH(m)}</span>`).join("")}</div>` : ""}
            ${gaps.length ? `
            <div class="skills-col-title missing-title" style="margin-top:10px">Gaps</div>
            <div class="skills-tags">${gaps.map(g => `<span class="skill-tag skill-gap">${escH(g)}</span>`).join("")}</div>` : ""}
          </div>
        </div>
      </div>`;
    })() : "";

    /* HR Decision buttons */
    const isNextLevel = a.status === "next_level";
    const isRejected  = a.status === "rejected";
    const hrDecisionHtml = sc ? `
      <div class="hr-decision-row">
        <span class="hr-decision-label">HR Decision:</span>
        <button class="hr-decision-btn btn-next-level ${isNextLevel ? "is-active" : ""}" data-id="${a.id}" data-status="next_level">
          ${isNextLevel ? "✓ Next Level" : "→ Next Level"}
        </button>
        <button class="hr-decision-btn btn-hr-reject ${isRejected ? "is-active" : ""}" data-id="${a.id}" data-status="rejected">
          ${isRejected ? "✓ Rejected" : "✗ Reject"}
        </button>
      </div>` : "";

    return `
      <div class="app-card" data-id="${a.id}">
        <div class="app-card-header">
          <div class="app-card-left">
            <input type="checkbox" class="app-card-check app-row-check" data-id="${a.id}" ${selectedAppIds.has(a.id) ? "checked" : ""} />
            <div style="min-width:0">
              <div class="app-cand-name">${escH(a.candidateName)}</div>
              <div class="app-cand-email">${escH(a.candidateEmail)}</div>
            </div>
          </div>
          <span class="app-status-chip" data-id="${a.id}" style="background:${color}18;color:${color};border:1px solid ${color}35;flex-shrink:0">${label}</span>
        </div>
        <div class="app-card-meta">
          <span style="display:flex;align-items:center;gap:7px;flex-wrap:wrap">
            <a href="/api/applications/${a.id}/pdf" target="_blank" class="app-pdf-link">📄 ${escH(a.fileName)}</a>
            ${a.jobTitle ? `<span style="font-size:11px;font-weight:600;background:var(--bkash-pink-light,#fff0f7);color:var(--bkash-pink,#e2136e);padding:2px 9px;border-radius:99px;white-space:nowrap;border:1px solid rgba(226,19,110,0.18)">💼 ${escH(a.jobTitle)}</span>` : ""}
          </span>
          <span>🗓 ${fmtD(a.uploadedAt)}</span>
        </div>
        ${scoresHtml}
        ${summaryHtml}
        ${skillsHtml}
        ${hrDecisionHtml}
        <div class="app-card-actions">
          ${canSendExam ? `<button class="app-card-action-btn btn-primary btn-send-exam" data-id="${a.id}" data-jd="${escAttr(a.jdText || '')}">📤 Send Exam</button>` : ""}
          <div class="app-card-action-spacer"></div>
          <button class="app-card-action-btn btn-delete-app" data-id="${a.id}" data-name="${escAttr(a.candidateName)}" title="Delete application">🗑 Delete</button>
        </div>
      </div>`;
  }).join("");

  appsTableEl.innerHTML = `<div class="apps-cards-wrap">${selectBarHtml}${cardsHtml}</div>`;

  // Select all (card version)
  const selectAllCards = appsTableEl.querySelector("#appsSelectAllCards");
  const analyzeBtnCards = appsTableEl.querySelector("#appsAnalyzeBtnCards");
  if (selectAllCards) {
    selectAllCards.addEventListener("change", () => {
      selectedAppIds.clear();
      if (selectAllCards.checked) data.forEach(a => selectedAppIds.add(a.id));
      appsTableEl.querySelectorAll(".app-row-check").forEach(cb => { cb.checked = selectAllCards.checked; });
      updateAnalyzeBtnCards(analyzeBtnCards, data);
    });
  }

  // Row checkboxes
  appsTableEl.querySelectorAll(".app-row-check").forEach(cb => {
    cb.addEventListener("change", () => {
      if (cb.checked) selectedAppIds.add(cb.dataset.id);
      else            selectedAppIds.delete(cb.dataset.id);
      updateAnalyzeBtnCards(analyzeBtnCards, data);
      if (selectAllCards) selectAllCards.checked = selectedAppIds.size === data.length;
    });
  });

  // Analyze button (card version)
  if (analyzeBtnCards) {
    analyzeBtnCards.addEventListener("click", () => {
      if (selectedAppIds.size === 0) return;
      analyzeError  && analyzeError.classList.add("hidden");
      analyzeProgress && analyzeProgress.classList.add("hidden");
      analyzeModal  && analyzeModal.classList.remove("hidden");
    });
  }

  // PDF links (need auth header)
  appsTableEl.querySelectorAll(".app-pdf-link").forEach(link => {
    link.addEventListener("click", async (e) => {
      e.preventDefault();
      const res  = await fetch(link.href, { headers: authHeaders() });
      const blob = await res.blob();
      window.open(URL.createObjectURL(blob), "_blank");
    });
  });

  // Send exam buttons
  appsTableEl.querySelectorAll(".btn-send-exam").forEach(btn => {
    btn.addEventListener("click", () => openSendExamModal(btn.dataset.id, btn.dataset.jd));
  });

  // Delete application buttons
  appsTableEl.querySelectorAll(".btn-delete-app").forEach(btn => {
    btn.addEventListener("click", () => deleteApplication(btn.dataset.id, btn.dataset.name));
  });

  // Skills match toggle buttons
  appsTableEl.querySelectorAll(".app-skills-toggle-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const panel = document.getElementById(btn.dataset.target);
      if (!panel) return;
      const open = !panel.classList.contains("hidden");
      panel.classList.toggle("hidden", open);
      btn.querySelector(".app-skills-toggle-arrow").textContent = open ? "▾" : "▴";
      btn.classList.toggle("open", !open);
    });
  });

  // HR Decision buttons
  appsTableEl.querySelectorAll(".hr-decision-btn").forEach(btn => {
    btn.addEventListener("click", () => updateAppStatus(btn.dataset.id, btn.dataset.status, btn));
  });
}

async function updateAppStatus(id, status, clickedBtn) {
  if (!id || id === "null" || id === "undefined") {
    alert("Cannot update status: this exam has no linked application record.");
    return;
  }
  const statusColors = { shortlisted: "#22c55e", next_level: "#8b5cf6", rejected: "#ef4444", selected: "#22c55e" };
  const statusLabels = { shortlisted: "Shortlisted", next_level: "Next Level", rejected: "Not Selected", selected: "Selected" };

  try {
    const res = await fetch(`/api/applications/${id}/status`, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({ status }),
    });
    if (!res.ok) {
      let detail = `Server error (${res.status})`;
      try { detail = (await res.json()).detail || detail; } catch {}
      throw new Error(detail);
    }

    /* Update status chip */
    const chip = document.querySelector(`.app-status-chip[data-id="${id}"]`);
    if (chip) {
      const color = statusColors[status] || "#888";
      chip.style.background = `${color}18`;
      chip.style.color = color;
      chip.style.borderColor = `${color}35`;
      chip.textContent = statusLabels[status] || status;
    }

    /* Update sibling decision buttons */
    const row = clickedBtn.closest(".hr-decision-row");
    if (row) {
      row.querySelectorAll(".hr-decision-btn").forEach(b => {
        const isThis = b.dataset.status === status;
        b.classList.toggle("is-active", isThis);
        if (b.dataset.status === "next_level") b.textContent = isThis ? "✓ Next Level" : "→ Next Level";
        if (b.dataset.status === "rejected")   b.textContent = isThis ? "✓ Rejected"   : "✗ Reject";
        if (b.dataset.status === "selected")   b.textContent = isThis ? "✓ Selected"   : "✓ Select";
      });
    }
  } catch (e) {
    alert(`Could not update status: ${e.message}`);
  }
}

function updateAnalyzeBtnCards(btn, data) {
  if (!btn) return;
  btn.disabled = selectedAppIds.size === 0;
  btn.textContent = `🔍 Analyze Selected (${selectedAppIds.size})`;
}

function updateAnalyzeBtn() {
  if (appsAnalyzeBtn) appsAnalyzeBtn.disabled = selectedAppIds.size === 0;
}

// Filter — client-side instant, Refresh fetches fresh data from server
if (appsKeyword)      appsKeyword.addEventListener("input",  () => applyAppsFilter());
if (appsStatusFilter) appsStatusFilter.addEventListener("change", () => applyAppsFilter());
if (appsRefreshBtn)   appsRefreshBtn.addEventListener("click", loadApplications);

const clearAllDataBtn = $("clearAllDataBtn");
if (clearAllDataBtn) {
  clearAllDataBtn.addEventListener("click", async () => {
    if (!confirm("Delete ALL applications and exam data? This cannot be undone.")) return;
    try {
      const res = await fetch("/api/data/clear-all", { method: "DELETE", headers: authHeaders() });
      if (!res.ok) throw new Error("Failed");
      allAppsData = [];
      appsData    = [];
      renderAppsCards([]);
      refreshAllCounts();
    } catch { alert("Could not clear data. Please try again."); }
  });
}

// Exam Pending filters
const pendingKeywordEl    = $("pendingKeyword");
const pendingRefreshEl    = $("pendingRefreshBtn");
const hrPendingCountBadge = $("hrPendingCount");
if (pendingKeywordEl)  pendingKeywordEl.addEventListener("input", debounce(loadExamPending, 400));
if (pendingRefreshEl)  pendingRefreshEl.addEventListener("click", loadExamPending);

// Exam Results filters
const resultsKeywordEl = $("resultsKeyword");
const resultsRefreshEl = $("resultsRefreshBtn");
if (resultsKeywordEl)  resultsKeywordEl.addEventListener("input", debounce(loadExamResults, 400));
if (resultsRefreshEl)  resultsRefreshEl.addEventListener("click", loadExamResults);

// Analyze button wired inside renderAppsCards() per render
// (appsAnalyzeBtn in HTML is unused — card layout injects inline button)

if (analyzeModalClose)  analyzeModalClose.addEventListener("click",  () => analyzeModal.classList.add("hidden"));
if (analyzeModalCancel) analyzeModalCancel.addEventListener("click", () => analyzeModal.classList.add("hidden"));

// Run analysis
if (analyzeRunBtn) {
  analyzeRunBtn.addEventListener("click", async () => {
    const jdText    = analyzeJdInput ? analyzeJdInput.value.trim() : "";
    const threshold = analyzeThreshold ? parseInt(analyzeThreshold.value) : 70;
    if (!jdText) { analyzeError.textContent = "Please paste a job description."; analyzeError.classList.remove("hidden"); return; }
    if (selectedAppIds.size === 0) return;

    analyzeError.classList.add("hidden");
    analyzeRunBtn.disabled = true;
    analyzeProgress.classList.remove("hidden");

    const ids = [...selectedAppIds];
    let done  = 0;

    analyzeProgressText.textContent = `Analyzing 0 / ${ids.length}…`;
    analyzeProgressBar.style.width  = "0%";

    try {
      const res  = await fetch("/api/applications/analyze", {
        method:  "POST",
        headers: authHeaders(),
        body:    JSON.stringify({ applicationIds: ids, jdText, threshold }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Analysis failed.");

      // Update counts
      done = (data.results || []).filter(r => !r.error).length;
      analyzeProgressText.textContent = `Analyzed ${done} / ${ids.length}`;
      analyzeProgressBar.style.width  = "100%";

      setTimeout(() => {
        analyzeModal.classList.add("hidden");
        analyzeRunBtn.disabled = false;
        selectedAppIds.clear();
        loadApplications();
      }, 800);

    } catch (e) {
      analyzeError.textContent = e.message;
      analyzeError.classList.remove("hidden");
      analyzeRunBtn.disabled = false;
    }
  });
}

// ── Send Exam Modal ───────────────────────────────────────────────────────────
function openSendExamModal(appId, jdText) {
  pendingSendAppId = appId;
  if (sendExamJdInput)  sendExamJdInput.value = jdText || "";
  if (sendExamError)    sendExamError.classList.add("hidden");
  const appRec = appsData.find(a => a.id === appId);
  if (appRec) {
    const info = $("sendExamCandidateInfo");
    if (info) info.innerHTML = `<strong>Candidate:</strong> ${escH(appRec.candidateName)} &nbsp;·&nbsp; ${escH(appRec.candidateEmail)}`;
  }
  sendExamModal && sendExamModal.classList.remove("hidden");
}

if (sendExamModalClose)  sendExamModalClose.addEventListener("click",  () => sendExamModal.classList.add("hidden"));
if (sendExamModalCancel) sendExamModalCancel.addEventListener("click", () => sendExamModal.classList.add("hidden"));

if (sendExamRunBtn) {
  sendExamRunBtn.addEventListener("click", async () => {
    const jdText     = sendExamJdInput ? sendExamJdInput.value.trim() : "";
    const expiryDays = examExpirySlider ? parseInt(examExpirySlider.value) : 7;
    if (!jdText) { sendExamError.textContent = "Job description is required."; sendExamError.classList.remove("hidden"); return; }

    sendExamError.classList.add("hidden");
    sendExamRunBtn.disabled = true;
    sendExamModal.classList.add("hidden");
    sendExamGrading.classList.remove("hidden");

    try {
      const res  = await fetch("/api/exams/send", {
        method:  "POST",
        headers: authHeaders(),
        body:    JSON.stringify({ applicationId: pendingSendAppId, jdText, expiryDays }),
      });
      const data = await res.json();
      sendExamGrading.classList.add("hidden");
      if (res.ok) {
        alert(`✅ Exam sent! Expires: ${new Date(data.expiresAt).toLocaleDateString()}`);
        loadApplications();
      } else {
        alert(data.detail || "Failed to send exam.");
      }
    } catch {
      sendExamGrading.classList.add("hidden");
      alert("Network error. Please try again.");
    } finally {
      sendExamRunBtn.disabled = false;
    }
  });
}

// ── Exam Detail Modal ─────────────────────────────────────────────────────────
let _examCharts = [];

function destroyExamCharts() {
  _examCharts.forEach(c => { try { c.destroy(); } catch {} });
  _examCharts = [];
}

async function openExamDetail(examId) {
  destroyExamCharts();
  examDetailTitle.textContent = "Loading…";
  if (document.getElementById("examDetailMeta")) document.getElementById("examDetailMeta").textContent = "";
  examDetailBody.innerHTML = `<div style="padding:40px;text-align:center;color:#888">⏳ Loading…</div>`;
  examDetailModal.classList.remove("hidden");

  try {
    const res  = await fetch(`/api/exams/${examId}`, { headers: authHeaders() });
    const exam = await res.json();
    if (!res.ok) throw new Error(exam.detail || "Not found.");

    examDetailTitle.textContent = exam.candidateName;
    const metaEl = document.getElementById("examDetailMeta");
    if (metaEl) metaEl.textContent = exam.candidateEmail + (exam.completedAt ? `  ·  Completed ${fmtD(exam.completedAt)}` : "");

    if (!exam.submitted) {
      examDetailBody.innerHTML = `<div style="padding:24px"><div class="dash-notice notice-info">
        This candidate has not yet submitted the exam.<br>
        <strong>Expires:</strong> ${fmtD(exam.expiresAt)}
      </div></div>`;
      return;
    }

    const sc          = exam.score;
    const results     = sc.results || [];
    const sections    = sc.sections || [];
    const gradeColor  = sc.percentage >= 80 ? "#22c55e" : sc.percentage >= 60 ? "#3b82f6" : sc.percentage >= 40 ? "#f59e0b" : "#ef4444";
    const correctCnt  = results.filter(r => r.is_correct).length;
    const wrongCnt    = results.filter(r => !r.is_correct && r.given_answer).length;
    const skipCnt     = results.filter(r => !r.given_answer).length;

    // Build HTML structure
    examDetailBody.innerHTML = `
      <!-- ── Performance Overview ── -->
      <div class="perf-overview">

        <!-- Score Donut -->
        <div class="perf-block perf-score-block">
          <div class="perf-block-title">Overall Score</div>
          <div class="perf-donut-wrap">
            <canvas id="chartScoreDonut" width="180" height="180"></canvas>
            <div class="perf-donut-label">
              <div class="perf-donut-pct" style="color:${gradeColor}">${sc.percentage}%</div>
              <div class="perf-donut-grade" style="color:${gradeColor}">${sc.grade}</div>
              <div class="perf-donut-pts">${sc.totalEarned} / ${sc.totalMax} pts</div>
            </div>
          </div>
        </div>

        <!-- Accuracy Donut -->
        <div class="perf-block perf-accuracy-block">
          <div class="perf-block-title">Answer Breakdown</div>
          <div class="perf-donut-wrap">
            <canvas id="chartAccuracy" width="180" height="180"></canvas>
            <div class="perf-donut-label">
              <div class="perf-donut-pct" style="color:#22c55e">${correctCnt}</div>
              <div class="perf-donut-grade" style="color:#888;font-size:12px">correct</div>
            </div>
          </div>
          <div class="perf-legend">
            <span class="perf-legend-dot" style="background:#22c55e"></span> Correct (${correctCnt})
            <span class="perf-legend-dot" style="background:#ef4444;margin-left:10px"></span> Wrong (${wrongCnt})
            <span class="perf-legend-dot" style="background:#d1d5db;margin-left:10px"></span> Skipped (${skipCnt})
          </div>
        </div>

        <!-- Section Bars -->
        <div class="perf-block perf-section-block">
          <div class="perf-block-title">Section Performance</div>
          <canvas id="chartSections" height="160"></canvas>
        </div>

      </div>

      <!-- ── Per-Question Chart ── -->
      <div class="perf-qchart-wrap">
        <div class="perf-block-title" style="padding:0 24px 10px">Points per Question</div>
        <div style="padding:0 24px 20px; overflow-x:auto">
          <canvas id="chartPerQ" height="120"></canvas>
        </div>
      </div>

      <!-- ── Section KPI bars ── -->
      <div class="perf-kpi-row">
        ${sections.map(s => {
          const pct = s.max ? Math.round(s.earned / s.max * 100) : 0;
          const col = pct >= 80 ? "#22c55e" : pct >= 50 ? "#f59e0b" : "#ef4444";
          return `
            <div class="perf-kpi">
              <div class="perf-kpi-label">${s.difficulty.charAt(0).toUpperCase() + s.difficulty.slice(1)}</div>
              <div class="perf-kpi-bar-wrap">
                <div class="perf-kpi-bar-fill" style="width:${pct}%;background:${col}"></div>
              </div>
              <div class="perf-kpi-val" style="color:${col}">${s.earned}/${s.max} pts (${pct}%)</div>
            </div>`;
        }).join("")}
      </div>

      <!-- ── Per-question cards ── -->
      <div style="padding:0 24px 24px">
        <div class="perf-block-title" style="margin-bottom:14px">Question-by-Question Review</div>
        ${results.map((r, i) => {
          const border = r.is_correct ? "#22c55e" : (r.given_answer ? "#ef4444" : "#94a3b8");
          const badge  = r.difficulty === "hard" ? "badge-hard" : r.difficulty === "medium" ? "badge-medium" : "badge-easy";
          const opts   = (exam.evaluationKey?.find(q => q.id === r.question_id)?.options || []).map(o => {
            const isCorrect = o.label === r.correct_answer;
            const isGiven   = o.label === r.given_answer;
            let cls = "exam-option answered";
            if (isCorrect) cls += " correct";
            if (isGiven && !isCorrect) cls += " wrong";
            return `<div class="${cls}"><span class="opt-label">${o.label}</span><span class="opt-text">${escH(o.text)}</span></div>`;
          }).join("");
          return `
            <div class="exam-q-card answered" style="border-left:4px solid ${border};margin-bottom:10px">
              <div class="exam-q-header">
                <div class="exam-q-text">Q${i+1}. ${escH(r.question)}</div>
                <div class="exam-q-meta">
                  <span class="exam-q-badge ${badge}">${r.difficulty}</span>
                  <span class="exam-q-points" style="color:${border}">${r.earned}/${r.points} pts</span>
                </div>
              </div>
              <div class="exam-options">${opts}</div>
              <div class="exam-feedback ${r.is_correct ? "feedback-correct" : (r.given_answer ? "feedback-wrong" : "feedback-skip")}">
                ${escH(r.feedback || (r.given_answer ? "" : "Not answered"))}
              </div>
            </div>`;
        }).join("")}
      </div>
    `;

    // ── Chart 1: Score donut ──────────────────────────────────────────────────
    _examCharts.push(new Chart(document.getElementById("chartScoreDonut"), {
      type: "doughnut",
      data: {
        datasets: [{
          data: [sc.totalEarned, sc.totalMax - sc.totalEarned],
          backgroundColor: [gradeColor, "#F3F4F6"],
          borderWidth: 0,
          hoverOffset: 0,
        }],
      },
      options: {
        cutout: "75%",
        animation: { animateRotate: true, duration: 700 },
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
      },
    }));

    // ── Chart 2: Accuracy donut ───────────────────────────────────────────────
    _examCharts.push(new Chart(document.getElementById("chartAccuracy"), {
      type: "doughnut",
      data: {
        labels: ["Correct", "Wrong", "Skipped"],
        datasets: [{
          data: [correctCnt, wrongCnt, skipCnt],
          backgroundColor: ["#22c55e", "#ef4444", "#d1d5db"],
          borderWidth: 0,
          hoverOffset: 4,
        }],
      },
      options: {
        cutout: "72%",
        animation: { duration: 700 },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${ctx.parsed}` } },
        },
      },
    }));

    // ── Chart 3: Section horizontal bars ─────────────────────────────────────
    const secLabels = sections.map(s => s.difficulty.charAt(0).toUpperCase() + s.difficulty.slice(1));
    const secEarned = sections.map(s => s.earned);
    const secMax    = sections.map(s => s.max - s.earned);
    const secColors = sections.map(s => {
      const p = s.max ? s.earned / s.max * 100 : 0;
      return p >= 80 ? "#22c55e" : p >= 50 ? "#f59e0b" : "#ef4444";
    });

    _examCharts.push(new Chart(document.getElementById("chartSections"), {
      type: "bar",
      data: {
        labels: secLabels,
        datasets: [
          { label: "Earned", data: secEarned, backgroundColor: secColors, borderRadius: 6, barThickness: 28 },
          { label: "Remaining", data: secMax, backgroundColor: "#F3F4F6", borderRadius: 6, barThickness: 28 },
        ],
      },
      options: {
        indexAxis: "y",
        responsive: true,
        scales: {
          x: { stacked: true, grid: { display: false }, ticks: { font: { size: 11 } } },
          y: { stacked: true, grid: { display: false }, ticks: { font: { size: 12, weight: "600" } } },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: ctx => ctx.datasetIndex === 0
                ? ` Earned: ${ctx.parsed.x} pts`
                : ` Remaining: ${ctx.parsed.x} pts`,
            },
          },
        },
        animation: { duration: 600 },
      },
    }));

    // ── Chart 4: Per-question bar ─────────────────────────────────────────────
    const qLabels   = results.map((_, i) => `Q${i + 1}`);
    const qEarned   = results.map(r => r.earned);
    const qMax      = results.map(r => r.points - r.earned);
    const qColors   = results.map(r => r.is_correct ? "#22c55e" : (r.given_answer ? "#ef4444" : "#d1d5db"));

    _examCharts.push(new Chart(document.getElementById("chartPerQ"), {
      type: "bar",
      data: {
        labels: qLabels,
        datasets: [
          { label: "Earned", data: qEarned, backgroundColor: qColors, borderRadius: 4, barThickness: 18 },
          { label: "Missed", data: qMax,    backgroundColor: "#F3F4F6", borderRadius: 4, barThickness: 18 },
        ],
      },
      options: {
        responsive: true,
        scales: {
          x: { stacked: true, grid: { display: false }, ticks: { font: { size: 10 } } },
          y: { stacked: true, beginAtZero: true, max: 3, grid: { color: "#F3F4F6" }, ticks: { stepSize: 1, font: { size: 10 } } },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: ctx => {
                const r = results[ctx[0].dataIndex];
                return `Q${ctx[0].dataIndex + 1} (${r.difficulty})`;
              },
              label: ctx => ctx.datasetIndex === 0 ? ` Earned: ${ctx.parsed.y} pts` : ` Missed: ${ctx.parsed.y} pts`,
            },
          },
        },
        animation: { duration: 500 },
      },
    }));

  } catch (e) {
    examDetailBody.innerHTML = `<div style="padding:24px"><div class="dash-msg error">${escH(e.message)}</div></div>`;
  }
}

if (examDetailClose) examDetailClose.addEventListener("click", () => {
  destroyExamCharts();
  examDetailModal.classList.add("hidden");
});

// =============================================================================
// ── EXAM PENDING TAB ──────────────────────────────────────────────────────────
// =============================================================================

const pendingEmpty = $("pendingEmpty");
const pendingTable = $("pendingTable");

async function loadExamPending() {
  const keyword = pendingKeywordEl ? pendingKeywordEl.value.trim().toLowerCase() : "";
  try {
    const res  = await fetch("/api/exams", { headers: authHeaders() });
    let data   = res.ok ? await res.json() : [];
    data = data.filter(e => !e.submitted);
    if (keyword) data = data.filter(e =>
      (e.candidateName || "").toLowerCase().includes(keyword) ||
      (e.candidateEmail || "").toLowerCase().includes(keyword)
    );

    if (hrPendingCountBadge) {
      hrPendingCountBadge.textContent = data.length;
      hrPendingCountBadge.style.display = data.length ? "inline-flex" : "none";
    }

    if (!data.length) {
      pendingEmpty && pendingEmpty.classList.remove("hidden");
      pendingTable && pendingTable.classList.add("hidden");
      return;
    }
    pendingEmpty && pendingEmpty.classList.add("hidden");
    pendingTable && pendingTable.classList.remove("hidden");

    const now = Date.now();
    pendingTable.innerHTML = `<div class="apps-cards-wrap" id="pendingCardsWrap">${data.map(e => {
      const expired  = e.expiresAt && new Date(e.expiresAt).getTime() < now;
      const timeLeft = e.expiresAt ? getTimeLeft(e.expiresAt) : "—";
      const statusColor = expired ? "#ef4444" : "#f59e0b";
      const statusLabel = expired ? "Expired" : "⏳ Awaiting";

      return `
        <div class="app-card">
          <div class="app-card-header">
            <div style="min-width:0">
              <div class="app-cand-name">${escH(e.candidateName)}</div>
              <div class="app-cand-email">${escH(e.candidateEmail)}</div>
            </div>
            <span class="app-status-chip" style="background:${statusColor}18;color:${statusColor};border:1px solid ${statusColor}35;flex-shrink:0">${statusLabel}</span>
          </div>
          <div class="app-pending-info">
            <span>📤 Sent: <strong>${fmtD(e.sentAt)}</strong></span>
            <span>${expired ? "⏰ Expired:" : "⏰ Expires:"} <strong>${fmtD(e.expiresAt)}</strong></span>
            ${!expired ? `<span>⌛ Time left: <strong>${timeLeft}</strong></span>` : ""}
          </div>
          <div class="app-card-actions">
            <div class="app-card-action-spacer"></div>
            <button class="app-card-action-btn btn-delete-exam" data-examid="${e.id}" data-name="${escH(e.candidateName)}" title="Delete exam">🗑 Delete</button>
          </div>
        </div>`;
    }).join("")}</div>`;

    pendingTable.querySelectorAll(".btn-delete-exam").forEach(btn => {
      btn.addEventListener("click", () => deleteExam(btn.dataset.examid, btn.dataset.name, loadExamPending));
    });

  } catch (e) { console.error("loadExamPending error:", e); }
}

function getTimeLeft(isoDate) {
  const diff = new Date(isoDate).getTime() - Date.now();
  if (diff <= 0) return "Expired";
  const days  = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  if (days > 0) return `${days}d ${hours}h`;
  const mins = Math.floor((diff % 3600000) / 60000);
  return `${hours}h ${mins}m`;
}

// =============================================================================
// ── EXAM RESULTS TAB ──────────────────────────────────────────────────────────
// =============================================================================

const examResultsEmpty = $("examResultsEmpty");
const examResultsTable = $("examResultsTable");
const hrExamCountBadge = $("hrExamCount");

async function loadExamResults() {
  const keyword = resultsKeywordEl ? resultsKeywordEl.value.trim().toLowerCase() : "";
  try {
    const [examsRes, appsRes] = await Promise.all([
      fetch("/api/exams",        { headers: authHeaders() }),
      fetch("/api/applications", { headers: authHeaders() }),
    ]);
    let allData  = examsRes.ok ? await examsRes.json() : [];
    const allApps = appsRes.ok ? await appsRes.json()  : [];

    const appStatusMap = {};
    allApps.forEach(a => { appStatusMap[a.id] = a.status; });

    const submitted = allData.filter(e => e.submitted);

    if (hrExamCountBadge) {
      hrExamCountBadge.textContent = submitted.length;
      hrExamCountBadge.style.display = submitted.length ? "inline-flex" : "none";
    }

    let data = submitted;
    if (keyword) data = data.filter(e =>
      (e.candidateName || "").toLowerCase().includes(keyword) ||
      (e.candidateEmail || "").toLowerCase().includes(keyword)
    );

    if (!data.length) {
      examResultsEmpty && examResultsEmpty.classList.remove("hidden");
      examResultsTable && examResultsTable.classList.add("hidden");
      return;
    }

    examResultsEmpty && examResultsEmpty.classList.add("hidden");
    examResultsTable && examResultsTable.classList.remove("hidden");

    const gradeColor = pct => pct >= 80 ? "#22c55e" : pct >= 60 ? "#3b82f6" : pct >= 40 ? "#f59e0b" : "#ef4444";

    examResultsTable.innerHTML = `<div class="apps-cards-wrap">${data.map(e => {
      const sc         = e.score;
      const color      = sc ? gradeColor(sc.percentage) : "#888";
      const isSelected = e.finalDecision === "selected";
      const isRejected = e.finalDecision === "rejected";
      const decColor   = isSelected ? "#22c55e" : isRejected ? "#ef4444" : "#94a3b8";
      const decLabel   = isSelected ? "✓ Selected" : isRejected ? "✗ Rejected" : "⏳ Pending Decision";

      const decisionRow = `
        <div class="hr-decision-row" style="border-top:1px solid var(--border);padding-top:10px;margin-top:8px">
          <span class="hr-decision-label">Final Decision:</span>
          <button class="hr-decision-btn btn-next-level ${isSelected ? "is-active" : ""}" data-examid="${e.id}" data-decision="selected">
            ${isSelected ? "✓ Selected" : "✓ Select"}
          </button>
          <button class="hr-decision-btn btn-hr-reject ${isRejected ? "is-active" : ""}" data-examid="${e.id}" data-decision="rejected">
            ${isRejected ? "✓ Rejected" : "✗ Reject"}
          </button>
        </div>`;

      return `
        <div class="app-card">
          <div class="app-card-header">
            <div style="min-width:0">
              <div class="app-cand-name">${escH(e.candidateName)}</div>
              <div class="app-cand-email">${escH(e.candidateEmail)}</div>
            </div>
            <div style="display:flex;flex-direction:column;align-items:flex-end;gap:5px;flex-shrink:0">
              ${sc ? `<span class="app-status-chip" style="background:${color}18;color:${color};border:1px solid ${color}35;font-size:14px;font-weight:700">${sc.percentage}% · ${sc.grade}</span>` : ""}
              <span class="app-status-chip exam-decision-chip-${e.id}" style="background:${decColor}18;color:${decColor};border:1px solid ${decColor}35;font-size:11px;font-weight:600">${decLabel}</span>
            </div>
          </div>
          <div class="app-pending-info">
            <span>📤 Sent: <strong>${fmtD(e.sentAt)}</strong></span>
            <span>✅ Completed: <strong>${fmtD(e.completedAt)}</strong></span>
            ${sc ? `<span>📊 Score: <strong>${sc.totalEarned} / ${sc.totalMax} pts</strong></span>` : ""}
          </div>
          ${decisionRow}
          <div class="app-card-actions">
            <button class="app-card-action-btn btn-primary btn-view-exam" data-examid="${e.id}">🏆 View Full Result</button>
            <div class="app-card-action-spacer"></div>
            <button class="app-card-action-btn btn-delete-exam" data-examid="${e.id}" data-name="${escH(e.candidateName)}" title="Delete result">🗑 Delete</button>
          </div>
        </div>`;
    }).join("")}</div>`;

    examResultsTable.querySelectorAll(".btn-view-exam").forEach(btn => {
      btn.addEventListener("click", () => openExamDetail(btn.dataset.examid));
    });

    examResultsTable.querySelectorAll(".btn-delete-exam").forEach(btn => {
      btn.addEventListener("click", () => deleteExam(btn.dataset.examid, btn.dataset.name, loadExamResults));
    });

    examResultsTable.querySelectorAll(".hr-decision-btn").forEach(btn => {
      btn.addEventListener("click", () => setExamDecision(btn.dataset.examid, btn.dataset.decision, btn));
    });

  } catch (e) { console.error("loadExamResults error:", e); }
}

async function setExamDecision(examId, decision, clickedBtn) {
  try {
    const res = await fetch(`/api/exams/${examId}/decision`, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({ decision }),
    });
    if (!res.ok) throw new Error(`Server error (${res.status})`);

    const isSelected = decision === "selected";
    const isRejected = decision === "rejected";
    const decColor   = isSelected ? "#22c55e" : "#ef4444";
    const decLabel   = isSelected ? "✓ Selected" : "✗ Rejected";

    const row = clickedBtn.closest(".hr-decision-row");
    if (row) {
      row.querySelectorAll(".hr-decision-btn").forEach(b => {
        const isThis = b.dataset.decision === decision;
        b.classList.toggle("is-active", isThis);
        if (b.dataset.decision === "selected") b.textContent = isThis ? "✓ Selected" : "✓ Select";
        if (b.dataset.decision === "rejected") b.textContent = isThis ? "✓ Rejected" : "✗ Reject";
      });
    }

    const chip = clickedBtn.closest(".app-card")?.querySelector(`[class*="exam-decision-chip"]`);
    if (chip) {
      chip.style.background = `${decColor}18`;
      chip.style.color = decColor;
      chip.style.borderColor = `${decColor}35`;
      chip.textContent = decLabel;
    }
  } catch (e) {
    alert(`Could not update decision: ${e.message}`);
  }
}

// =============================================================================
// ── DELETE HELPERS ────────────────────────────────────────────────────────────
// =============================================================================

async function deleteApplication(id, name) {
  if (!confirm(`Delete application from ${name}? This cannot be undone.`)) return;
  try {
    const res = await fetch(`/api/applications/${id}`, { method: "DELETE", headers: authHeaders() });
    if (!res.ok) {
      let detail = `Error ${res.status}`;
      try { detail = (await res.json()).detail || detail; } catch {}
      throw new Error(detail);
    }
    loadApplications();
    refreshAllCounts();
  } catch (e) {
    alert(`Could not delete: ${e.message}`);
  }
}

async function deleteExam(examId, name, reloadFn) {
  if (!confirm(`Delete exam result for ${name}? This cannot be undone.`)) return;
  try {
    const res = await fetch(`/api/exams/${examId}`, { method: "DELETE", headers: authHeaders() });
    if (!res.ok) {
      let detail = `Error ${res.status}`;
      try { detail = (await res.json()).detail || detail; } catch {}
      throw new Error(detail);
    }
    if (reloadFn) reloadFn();
    refreshAllCounts();
  } catch (e) {
    alert(`Could not delete: ${e.message}`);
  }
}

// =============================================================================
// ── SHARED UTILS ──────────────────────────────────────────────────────────────
// =============================================================================

async function loadHomeDashboard() {
  // Greeting
  const s    = getSession();
  const first = s ? s.name.split(" ")[0] : "Admin";
  const h     = new Date().getHours();
  const greet = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  const dateStr = new Date().toLocaleDateString("en-US", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const greetEl = $("homeGreeting");
  const dateEl  = $("homeDate");
  if (greetEl) greetEl.textContent = `${greet}, ${first} 👋`;
  if (dateEl)  dateEl.textContent  = dateStr;

  try {
    const [appsRes, examsRes] = await Promise.all([
      fetch("/api/applications", { headers: authHeaders() }),
      fetch("/api/exams",        { headers: authHeaders() }),
    ]);
    const apps  = appsRes.ok  ? await appsRes.json()  : [];
    const exams = examsRes.ok ? await examsRes.json() : [];

    const totalApps   = apps.length;
    const shortlisted = apps.filter(a => a.status === "shortlisted").length;
    const pending     = exams.filter(e => !e.submitted).length;
    const results     = exams.filter(e =>  e.submitted).length;
    const reviewable  = apps.filter(a => !["exam_sent","exam_completed"].includes(a.status)).length;

    if ($("homeStatApps"))        $("homeStatApps").textContent        = totalApps;
    if ($("homeStatShortlisted")) $("homeStatShortlisted").textContent  = shortlisted;
    if ($("homeStatPending"))     $("homeStatPending").textContent      = pending;
    if ($("homeStatResults"))     $("homeStatResults").textContent      = results;

    const badgeApps    = $("homeBadgeApps");
    const badgePending = $("homeBadgePending");
    const badgeResults = $("homeBadgeResults");
    if (badgeApps)    { badgeApps.textContent    = reviewable; badgeApps.style.display    = reviewable ? "" : "none"; }
    if (badgePending) { badgePending.textContent = pending;    badgePending.style.display = pending    ? "" : "none"; }
    if (badgeResults) { badgeResults.textContent = results;    badgeResults.style.display = results    ? "" : "none"; }
  } catch { /* stats stay at — */ }
}

async function refreshAllCounts() {
  try {
    const [appsRes, examsRes] = await Promise.all([
      fetch("/api/applications", { headers: authHeaders() }),
      fetch("/api/exams",        { headers: authHeaders() }),
    ]);
    const apps  = appsRes.ok  ? await appsRes.json()  : [];
    const exams = examsRes.ok ? await examsRes.json() : [];

    const appCount     = apps.filter(a => !["exam_sent","exam_completed"].includes(a.status)).length;
    const pendingCount = exams.filter(e => !e.submitted).length;
    const doneCount    = exams.filter(e =>  e.submitted).length;

    if (hrAppCountBadge) {
      hrAppCountBadge.textContent   = appCount;
      hrAppCountBadge.style.display = appCount ? "inline-flex" : "none";
    }
    if (hrPendingCountBadge) {
      hrPendingCountBadge.textContent   = pendingCount;
      hrPendingCountBadge.style.display = pendingCount ? "inline-flex" : "none";
    }
    if (hrExamCountBadge) {
      hrExamCountBadge.textContent   = doneCount;
      hrExamCountBadge.style.display = doneCount ? "inline-flex" : "none";
    }
  } catch { /* silently ignore — counts are cosmetic */ }
}

function escH(s) {
  return String(s || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}
function escAttr(s) { return escH(s); }
function fmtD(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}
function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
