"use strict";

const sess = window.__session;

// ── DOM refs ──────────────────────────────────────────────────────────────────
const userGreeting   = document.getElementById("userGreeting");
const logoutBtn      = document.getElementById("logoutBtn");
const statusDot      = document.getElementById("statusDot");
const statusLabel    = document.getElementById("statusLabel");

const uploadSection  = document.getElementById("uploadSection");
const dashDropzone   = document.getElementById("dashDropzone");
const dashFileInput  = document.getElementById("dashFileInput");
const dashBrowse     = document.getElementById("dashBrowse");
const dashFileInfo   = document.getElementById("dashFileInfo");
const dashJobTitle   = document.getElementById("dashJobTitle");
const dashUploadBtn  = document.getElementById("dashUploadBtn");
const uploadMsg      = document.getElementById("uploadMsg");

const statusSection  = document.getElementById("statusSection");
const appStatusCont  = document.getElementById("appStatusContent");
const examSection    = document.getElementById("examSection");
const examSectionTitle = document.getElementById("examSectionTitle");
const examSectionSub   = document.getElementById("examSectionSub");
const examContent    = document.getElementById("examContent");

// ── Exam modal refs ───────────────────────────────────────────────────────────
const dashExamModal   = document.getElementById("dashExamModal");
const dashExamCandidate = document.getElementById("dashExamCandidate");
const dashExamAnswered  = document.getElementById("dashExamAnswered");
const dashExamTotal     = document.getElementById("dashExamTotal");
const dashExamClose     = document.getElementById("dashExamClose");
const dashExamMarks     = document.getElementById("dashExamMarks");
const dashExamDeadline  = document.getElementById("dashExamDeadline");
const dashExamQuestions = document.getElementById("dashExamQuestions");
const dashExamProgress  = document.getElementById("dashExamProgress");
const dashExamSubmit    = document.getElementById("dashExamSubmit");
const dashExamWarning   = document.getElementById("dashExamWarning");
const dashWarningAnswered = document.getElementById("dashWarningAnswered");
const dashWarningTotal    = document.getElementById("dashWarningTotal");
const dashWarningCancel   = document.getElementById("dashWarningCancel");
const dashWarningConfirm  = document.getElementById("dashWarningConfirm");
const dashExamGrading     = document.getElementById("dashExamGrading");

// ── State ─────────────────────────────────────────────────────────────────────
let selectedFile = null;
let currentExam  = null;
let examAnswers  = {};

// ── Init ──────────────────────────────────────────────────────────────────────
userGreeting.textContent = `Hello, ${sess.name}`;
logoutBtn.addEventListener("click", logout);

checkHealth();
loadDashboard();

// ── Health check ─────────────────────────────────────────────────────────────
async function checkHealth() {
  try {
    const r = await fetch("/api/health");
    const d = await r.json();
    statusDot.style.background  = "#22c55e";
    statusLabel.textContent = "Sysnova";
  } catch {
    statusDot.style.background  = "#ef4444";
    statusLabel.textContent = "Offline";
  }
}

// ── Load applicant's existing data ───────────────────────────────────────────
async function loadDashboard() {
  try {
    // Load application status
    const appsRes  = await fetch("/api/applications/mine", { headers: authHeaders() });
    const apps = appsRes.ok ? await appsRes.json() : [];

    // Load exam
    const examRes  = await fetch("/api/exams/mine", { headers: authHeaders() });
    const examData = examRes.ok ? await examRes.json() : { exam: null };

    renderDashboard(apps, examData.exam);
  } catch (e) {
    console.error("Dashboard load error:", e);
  }
}

function renderDashboard(apps, exam) {
  if (apps.length > 0) {
    const latest = apps[0];
    statusSection.classList.remove("hidden");
    renderAppStatus(latest);

    // If already submitted a CV, show a re-upload option but hide main upload
    uploadSection.querySelector(".dash-card-title").textContent = "Upload Another CV";
    uploadSection.querySelector(".dash-card-sub").textContent   = "Replace your current submission";
  }

  if (exam) {
    examSection.classList.remove("hidden");
    renderExamSection(exam);
  }
}

function renderAppStatus(app) {
  const statusMap = {
    uploaded:       { icon: "⏳", label: "Received",        color: "#64748b", desc: "Your CV has been received and is awaiting review." },
    analyzed:       { icon: "🔍", label: "Under Review",    color: "#3b82f6", desc: "HR is reviewing your application." },
    shortlisted:    { icon: "✅", label: "Shortlisted",     color: "#22c55e", desc: "Congratulations! You have been shortlisted." },
    rejected:       { icon: "❌", label: "Not Selected",    color: "#ef4444", desc: "Thank you for applying. You were not selected for this position." },
    exam_sent:      { icon: "📝", label: "Exam Available",  color: "#f59e0b", desc: "An exam has been sent to you. Please complete it soon." },
    exam_completed: { icon: "🏆", label: "Exam Submitted",  color: "#8b5cf6", desc: "Your exam has been submitted. HR will review your result and update the status." },
    selected:       { icon: "🎉", label: "Selected!",       color: "#22c55e", desc: "Congratulations! You have been selected for this position. HR will be in touch with next steps." },
  };
  const s = statusMap[app.status] || { icon: "📋", label: app.status, color: "#64748b", desc: "" };

  appStatusCont.innerHTML = `
    <div class="app-status-row">
      <div class="app-status-badge" style="background:${s.color}15; color:${s.color}; border-color:${s.color}30">
        <span>${s.icon}</span> ${s.label}
      </div>
      <div class="app-status-meta">
        ${app.jobTitle ? `<span style="font-weight:600;color:var(--text-primary)">💼 ${escHtml(app.jobTitle)}</span>` : ""}
        <span>📄 ${escHtml(app.fileName)}</span>
        <span>Submitted ${fmtDate(app.uploadedAt)}</span>
      </div>
    </div>
    <div class="app-status-desc">${s.desc}</div>
  `;
}

function renderExamSection(exam) {
  if (exam.expired) {
    examSectionTitle.textContent = "Exam Expired";
    examSectionSub.textContent   = "This exam is no longer available";
    examContent.innerHTML = `<div class="dash-notice notice-warn">Your exam expired on ${fmtDate(exam.expiresAt)}. Please contact HR if you need assistance.</div>`;
    return;
  }

  if (exam.submitted) {
    examSectionTitle.textContent = "Exam Results";
    examSectionSub.textContent   = `Completed ${fmtDate(exam.completedAt)}`;
    const sc = exam.score;
    const gradeColor = sc.percentage >= 80 ? "#22c55e" : sc.percentage >= 60 ? "#3b82f6" : sc.percentage >= 40 ? "#f59e0b" : "#ef4444";
    examContent.innerHTML = `
      <div class="exam-result-summary">
        <div class="result-score-big" style="color:${gradeColor}">${sc.percentage}%</div>
        <div class="result-grade" style="color:${gradeColor}">${sc.grade}</div>
        <div class="result-pts">${sc.totalEarned} / ${sc.totalMax} pts</div>
        ${sc.sections ? `
        <div class="result-sections">
          ${sc.sections.map(s => `<div class="result-sec-row">
            <span class="exam-q-badge badge-${s.difficulty}">${s.difficulty}</span>
            <span>${s.earned}/${s.max} pts</span>
          </div>`).join("")}
        </div>` : ""}
      </div>
      <button class="run-btn" id="viewExamBtn" style="margin-top:16px; max-width:280px">View Detailed Results</button>
    `;
    currentExam = exam;
    document.getElementById("viewExamBtn").addEventListener("click", () => openResultsModal(exam));
    return;
  }

  // Pending exam
  examSectionTitle.textContent = "You Have an Exam";
  const expiry = new Date(exam.expiresAt);
  const timeLeft = getTimeLeft(expiry);
  examSectionSub.textContent = `Deadline: ${fmtDate(exam.expiresAt)}`;
  examContent.innerHTML = `
    <div class="dash-notice ${timeLeft.urgent ? "notice-warn" : "notice-info"}">
      <strong>⏰ ${timeLeft.label}</strong> remaining to complete this exam
    </div>
    <div class="exam-meta-row">
      <span>📋 ${exam.questions?.length || 15} questions</span>
      <span>🏆 ${exam.totalMarks || 30} total marks</span>
    </div>
    <button class="run-btn" id="startExamBtn" style="max-width:240px; margin-top:16px">
      <span class="run-btn-icon">📝</span> Start Exam <span class="run-btn-icon">📝</span>
    </button>
  `;
  currentExam = exam;
  document.getElementById("startExamBtn").addEventListener("click", () => openExamModal(exam));
}

// ── File upload ───────────────────────────────────────────────────────────────
dashBrowse.addEventListener("click", () => dashFileInput.click());
dashDropzone.addEventListener("click", () => dashFileInput.click());
dashFileInput.addEventListener("change", () => {
  if (dashFileInput.files[0]) setFile(dashFileInput.files[0]);
});

dashDropzone.addEventListener("dragover",  e => { e.preventDefault(); dashDropzone.classList.add("dragover"); });
dashDropzone.addEventListener("dragleave", () => dashDropzone.classList.remove("dragover"));
dashDropzone.addEventListener("drop", e => {
  e.preventDefault(); dashDropzone.classList.remove("dragover");
  if (e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]);
});

function updateSubmitBtn() {
  dashUploadBtn.disabled = !(selectedFile && dashJobTitle.value.trim());
}

function setFile(f) {
  if (!f.name.toLowerCase().endsWith(".pdf")) {
    showUploadMsg("Only PDF files are supported.", "error"); return;
  }
  selectedFile = f;
  dashFileInfo.textContent = `📄 ${f.name} (${(f.size / 1024).toFixed(0)} KB)`;
  dashFileInfo.classList.remove("hidden");
  updateSubmitBtn();
}

dashJobTitle.addEventListener("input", updateSubmitBtn);

dashUploadBtn.addEventListener("click", async () => {
  if (!selectedFile) return;
  dashUploadBtn.disabled = true;
  dashUploadBtn.textContent = "Uploading…";
  showUploadMsg("", "");

  const fd = new FormData();
  fd.append("cv", selectedFile);
  fd.append("jobTitle", dashJobTitle.value.trim());

  try {
    const res  = await fetch("/api/applications/upload", {
      method: "POST",
      headers: { "Authorization": `Bearer ${sess.token}` },
      body: fd,
    });
    const data = await res.json();
    if (res.ok) {
      showUploadMsg("✅ CV submitted successfully! HR will review it soon.", "success");
      selectedFile = null;
      dashFileInfo.classList.add("hidden");
      dashJobTitle.value = "";
      updateSubmitBtn();
      setTimeout(loadDashboard, 1200);
    } else {
      showUploadMsg(data.detail || "Upload failed.", "error");
    }
  } catch {
    showUploadMsg("Network error. Please try again.", "error");
  } finally {
    dashUploadBtn.disabled = false;
    dashUploadBtn.innerHTML = `<span class="run-btn-icon">📤</span> Submit CV <span class="run-btn-icon">📤</span>`;
  }
});

function showUploadMsg(msg, type) {
  uploadMsg.textContent = msg;
  uploadMsg.className   = `dash-msg ${type}`;
  uploadMsg.classList.toggle("hidden", !msg);
}

// ── Exam Modal ────────────────────────────────────────────────────────────────
function openExamModal(exam) {
  examAnswers = {};
  dashExamCandidate.textContent = sess.name;
  dashExamMarks.textContent     = exam.totalMarks || 30;
  dashExamDeadline.textContent  = fmtDate(exam.expiresAt);
  dashExamTotal.textContent     = exam.questions.length;
  dashExamAnswered.textContent  = "0";
  dashExamProgress.textContent  = `0 of ${exam.questions.length} questions answered`;

  renderExamQuestions(exam.questions);
  dashExamModal.classList.remove("hidden");
}

function renderExamQuestions(questions) {
  dashExamQuestions.innerHTML = questions.map((q, i) => examCardHtml(q, i + 1)).join("");
  dashExamQuestions.querySelectorAll(".exam-option").forEach(btn => {
    btn.addEventListener("click", () => onOptionClick(btn));
  });
}

function examCardHtml(q, num) {
  const opts = (q.options || []).map(o => `
    <button class="exam-option" data-qid="${q.id}" data-label="${o.label}">
      <span class="opt-label">${o.label}</span>
      <span class="opt-text">${escHtml(o.text)}</span>
    </button>`).join("");
  const badge = q.difficulty === "hard" ? "badge-hard" : q.difficulty === "medium" ? "badge-medium" : "badge-easy";
  return `
    <div class="exam-q-card" id="dashQ${q.id}">
      <div class="exam-q-header">
        <div class="exam-q-text">Q${num}. ${escHtml(q.question)}</div>
        <div class="exam-q-meta">
          <span class="exam-q-badge ${badge}">${q.difficulty}</span>
          <span class="exam-q-points">${q.points} pt${q.points > 1 ? "s" : ""}</span>
        </div>
      </div>
      <div class="exam-options">${opts}</div>
    </div>`;
}

function onOptionClick(btn) {
  const qid   = btn.dataset.qid;
  const label = btn.dataset.label;
  const card  = document.getElementById(`dashQ${qid}`);
  card.querySelectorAll(".exam-option").forEach(b => b.classList.remove("selected"));
  btn.classList.add("selected");
  examAnswers[qid] = label;
  updateAnsweredCount(currentExam.questions.length);
}

function updateAnsweredCount(total) {
  const n = Object.keys(examAnswers).length;
  dashExamAnswered.textContent = n;
  dashExamProgress.textContent = `${n} of ${total} questions answered`;
}

dashExamClose.addEventListener("click", () => dashExamModal.classList.add("hidden"));

dashExamSubmit.addEventListener("click", () => {
  const total = currentExam.questions.length;
  dashWarningAnswered.textContent = Object.keys(examAnswers).length;
  dashWarningTotal.textContent    = total;
  dashExamWarning.classList.remove("hidden");
});

dashWarningCancel.addEventListener("click",  () => dashExamWarning.classList.add("hidden"));
dashWarningConfirm.addEventListener("click", () => {
  dashExamWarning.classList.add("hidden");
  submitExam();
});

async function submitExam() {
  dashExamGrading.classList.remove("hidden");
  const answers = Object.entries(examAnswers).map(([question_id, answer]) => ({ question_id: parseInt(question_id), answer }));
  try {
    const res  = await fetch("/api/exams/submit", {
      method: "POST",
      headers: authHeaders(),
      body:   JSON.stringify({ examId: currentExam.id, answers }),
    });
    const data = await res.json();
    dashExamGrading.classList.add("hidden");
    dashExamModal.classList.add("hidden");

    if (res.ok) {
      loadDashboard();
    } else {
      alert(data.detail || "Submission failed. Please try again.");
    }
  } catch {
    dashExamGrading.classList.add("hidden");
    alert("Network error. Please try again.");
  }
}

// ── Results modal (read-only after submission) ────────────────────────────────
function openResultsModal(exam) {
  examAnswers = {};
  dashExamCandidate.textContent = sess.name;
  dashExamMarks.textContent     = exam.score.totalMax;
  dashExamDeadline.textContent  = fmtDate(exam.completedAt);
  dashExamTotal.textContent     = exam.questions.length;

  const sc = exam.score;
  dashExamAnswered.textContent  = `${sc.totalEarned}/${sc.totalMax}`;
  dashExamProgress.innerHTML    = `<strong style="color:var(--bkash-pink)">Score: ${sc.totalEarned}/${sc.totalMax} · ${sc.percentage}% · ${sc.grade}</strong>`;
  dashExamSubmit.style.display  = "none";

  // Render with results
  const key = exam.evaluationKey || [];
  const keyMap = {};
  key.forEach(q => { keyMap[q.id] = q.correct_answer; });

  const resultMap = {};
  (sc.results || []).forEach(r => { resultMap[r.question_id] = r; });

  const html = exam.questions.map((q, i) => {
    const r = resultMap[q.id] || {};
    const correctAns = keyMap[q.id] || "";
    const givenAns   = r.given_answer || "";
    const isOk       = r.is_correct;
    const border     = isOk ? "#22c55e" : (givenAns ? "#ef4444" : "#94a3b8");

    const opts = (q.options || []).map(o => {
      const isCorrect = o.label === correctAns;
      const isGiven   = o.label === givenAns;
      let cls = "exam-option answered";
      if (isCorrect) cls += " correct";
      if (isGiven && !isCorrect) cls += " wrong";
      return `<div class="${cls}"><span class="opt-label">${o.label}</span><span class="opt-text">${escHtml(o.text)}</span></div>`;
    }).join("");

    const badge = q.difficulty === "hard" ? "badge-hard" : q.difficulty === "medium" ? "badge-medium" : "badge-easy";
    const pts   = r.earned ?? 0;
    const max   = q.points || 1;
    return `
      <div class="exam-q-card answered" style="border-left:4px solid ${border}">
        <div class="exam-q-header">
          <div class="exam-q-text">Q${i+1}. ${escHtml(q.question)}</div>
          <div class="exam-q-meta">
            <span class="exam-q-badge ${badge}">${q.difficulty}</span>
            <span class="exam-q-points" style="color:${border}">${pts}/${max} pts</span>
          </div>
        </div>
        <div class="exam-options">${opts}</div>
        <div class="exam-feedback ${isOk ? "feedback-correct" : (givenAns ? "feedback-wrong" : "feedback-skip")}">
          ${r.feedback || (givenAns ? "" : "Not answered")}
        </div>
      </div>`;
  }).join("");

  dashExamQuestions.innerHTML = html;
  dashExamModal.classList.remove("hidden");
}

dashExamClose.addEventListener("click", () => {
  dashExamModal.classList.add("hidden");
  dashExamSubmit.style.display = "";
});

// ── Utilities ─────────────────────────────────────────────────────────────────
function escHtml(s) {
  return String(s || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function fmtDate(iso) {
  if (!iso) return "–";
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function getTimeLeft(date) {
  const diff = date - Date.now();
  if (diff <= 0) return { label: "0 hours", urgent: true };
  const h = Math.floor(diff / 3600000);
  const d = Math.floor(h / 24);
  if (d > 1)  return { label: `${d} days`, urgent: false };
  if (h > 4)  return { label: `${h} hours`, urgent: false };
  return { label: `${h} hours`, urgent: true };
}
