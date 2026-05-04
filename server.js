"use strict";

const express  = require("express");
const path     = require("path");
const multer   = require("multer");
const pdfParse = require("pdf-parse");
const crypto   = require("crypto");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { createClient }       = require("@supabase/supabase-js");
const { Client: PgClient }   = require("pg");

const app    = express();
const PORT   = process.env.PORT || 8001;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const GEMINI_API_KEY   = "GEMINI_API_KEY_REDACTED";
const MODEL            = "gemma-3-27b-it";
const MAX_CV_CHARS     = 12000;
const HR_EMAIL         = "ai@sysnova.com";
const EXAM_EXPIRY_DAYS = 7;

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// ─────────────────────────────────────────────────────────────────────────────
// Supabase — REST client (all CRUD) + direct pg connection (migrations only)
// ─────────────────────────────────────────────────────────────────────────────
const SUPABASE_URL  = "https://mgziwxtlpnyjrgyyuvee.supabase.co";
const SUPABASE_KEY  = "SUPABASE_KEY_REDACTED";
const DB_CONN       = "DB_CONN_REDACTED";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Creates all tables + seeds HR user. Runs once via /api/setup (needs IPv6, works on Vercel).
async function initDb() {
  const pg = new PgClient({ connectionString: DB_CONN, ssl: { rejectUnauthorized: false } });
  await pg.connect();
  try {
    await pg.query(`
      CREATE TABLE IF NOT EXISTS users (
        id         UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
        email      TEXT        UNIQUE NOT NULL,
        name       TEXT        NOT NULL,
        role       TEXT        NOT NULL DEFAULT 'user',
        password   TEXT        NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS applications (
        id              UUID        PRIMARY KEY,
        candidate_email TEXT        NOT NULL,
        candidate_name  TEXT        NOT NULL,
        file_name       TEXT,
        job_title       TEXT        DEFAULT '',
        pdf_base64      TEXT,
        pdf_text        TEXT,
        uploaded_at     TIMESTAMPTZ DEFAULT NOW(),
        status          TEXT        DEFAULT 'uploaded',
        analysis_result JSONB,
        exam_id         UUID,
        jd_text         TEXT
      );

      CREATE TABLE IF NOT EXISTS exams (
        id              UUID        PRIMARY KEY,
        application_id  UUID,
        candidate_email TEXT        NOT NULL,
        candidate_name  TEXT        NOT NULL,
        questions       JSONB,
        evaluation_key  JSONB,
        answers         JSONB       DEFAULT '{}',
        submitted       BOOLEAN     DEFAULT FALSE,
        score           JSONB,
        jd_text         TEXT,
        sent_at         TIMESTAMPTZ DEFAULT NOW(),
        expires_at      TIMESTAMPTZ,
        completed_at    TIMESTAMPTZ,
        total_marks     INTEGER     DEFAULT 30,
        final_decision  TEXT
      );

      INSERT INTO users (email, name, role, password)
      VALUES ('ai@sysnova.com', 'HR Admin', 'hr', 'admin2025')
      ON CONFLICT (email) DO NOTHING;

      CREATE OR REPLACE FUNCTION truncate_all_data()
      RETURNS json AS $$
      BEGIN
        DELETE FROM exams;
        DELETE FROM applications;
        RETURN json_build_object('ok', true);
      END;
      $$ LANGUAGE plpgsql SECURITY DEFINER;
    `);
    return { ok: true };
  } finally {
    await pg.end();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Auth helpers — stateless HMAC tokens (work across Vercel serverless)
// ─────────────────────────────────────────────────────────────────────────────
const TOKEN_SECRET = "sysnova-ats-2025-secret";

function makeToken(user) {
  const payload = Buffer.from(JSON.stringify({ email: user.email, role: user.role, name: user.name })).toString("base64url");
  const sig     = crypto.createHmac("sha256", TOKEN_SECRET).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

function verifyToken(token) {
  const dot = token.lastIndexOf(".");
  if (dot === -1) return null;
  const payload = token.slice(0, dot);
  const sig     = token.slice(dot + 1);
  const expected = crypto.createHmac("sha256", TOKEN_SECRET).update(payload).digest("base64url");
  if (sig !== expected) return null;
  try { return JSON.parse(Buffer.from(payload, "base64url").toString()); } catch { return null; }
}

function authMW(req, res, next) {
  const header = req.headers.authorization || "";
  const token  = header.startsWith("Bearer ") ? header.slice(7) : "";
  const user   = verifyToken(token);
  if (!user) return res.status(401).json({ detail: "Unauthorized" });
  req.user = user;
  next();
}

function hrOnly(req, res, next) {
  if (req.user?.role !== "hr") return res.status(403).json({ detail: "HR access only." });
  next();
}

// ─────────────────────────────────────────────────────────────────────────────
// Middleware
// ─────────────────────────────────────────────────────────────────────────────
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));
app.use(express.static(path.join(__dirname, "public")));

// ─────────────────────────────────────────────────────────────────────────────
// Gemini API caller
// ─────────────────────────────────────────────────────────────────────────────
async function geminiChat({ systemPrompt, userPrompt, maxTokens = 1500, temperature = 0.0 }) {
  const combined = systemPrompt ? `${systemPrompt}\n\n${userPrompt}` : userPrompt;
  const model = genAI.getGenerativeModel(
    { model: MODEL, generationConfig: { temperature, maxOutputTokens: maxTokens } },
    { apiVersion: "v1beta" }
  );
  const result = await model.generateContent(combined);
  return result.response.text();
}

// ─────────────────────────────────────────────────────────────────────────────
// PDF Text Extraction
// ─────────────────────────────────────────────────────────────────────────────
async function extractTextFromPDF(buffer) {
  try {
    const result = await pdfParse(buffer);
    return result.text || "";
  } catch (e) {
    console.error("PDF parse error:", e.message);
    return "";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ATS Score Calculator
// ─────────────────────────────────────────────────────────────────────────────
function calculateATSScore(atsData) {
  const kwMatch   = parseInt(atsData.keyword_match_pct     || 0);
  const kwDensity = parseInt(atsData.keyword_density_score || 0);
  const fmtScore  = parseInt(atsData.format_score          || 0);
  return Math.max(0, Math.min(100, Math.round(kwMatch * 0.60 + kwDensity * 0.25 + fmtScore * 0.15)));
}

function calculateCombinedScore(aiScore, atsScore) {
  return Math.round(aiScore * 0.50 + atsScore * 0.50);
}

// ─────────────────────────────────────────────────────────────────────────────
// Prompts
// ─────────────────────────────────────────────────────────────────────────────
const CV_SYSTEM_PROMPT = `You are an expert HR recruiter, ATS specialist, and talent acquisition expert.
Evaluate a candidate's CV against a Job Description.
The CV is plain text — use its content to extract structured info.
Respond with ONLY valid JSON — no markdown fences, no preamble, no extra text.`;

function buildCVPrompt(jdText, cvText) {
  return `## Job Description
${jdText}

## Candidate CV
${cvText.slice(0, MAX_CV_CHARS)}

Analyze this candidate and return a JSON object with EXACTLY these fields:

{
  "candidate_name": "<full name from CV or 'Unknown'>",
  "overall_score": <integer 0-100, holistic AI assessment>,
  "skills_match": <integer 0-100>,
  "experience_match": <integer 0-100>,
  "education_match": <integer 0-100>,
  "years_of_experience": <integer or null>,
  "key_strengths": ["<strength 1>", "<strength 2>", "<strength 3>"],
  "gaps": ["<gap 1>", "<gap 2>"],
  "missing_requirements": [
    "<specific JD requirement clearly absent or insufficient in the CV — be precise>",
    "<e.g. 'Minimum 5 years Python required, CV shows only 2 years'>",
    "<e.g. 'Docker/Kubernetes not present in CV'>"
  ],
  "summary": "<2-3 sentence recruiter summary>",

  "ats": {
    "required_keywords": ["<all important keywords, skills, tools, titles from JD>"],
    "matched_keywords": ["<keywords from required_keywords that appear in the CV>"],
    "missing_keywords": ["<keywords from required_keywords NOT found in CV>"],
    "keyword_match_pct": <integer 0-100, percent of required_keywords found in CV>,
    "keyword_density_score": <integer 0-100, how prominently/frequently matched keywords appear>,
    "format_score": <integer 0-100, CV formatting quality for ATS parsing>,
    "format_notes": ["<note about CV format>"]
  }
}

missing_requirements Guidelines (MANDATORY):
- List SPECIFIC requirements from the JD clearly absent or insufficient in the CV
- Be precise: not just "Python" but "Python not present in CV"
- If the candidate meets all requirements, return an empty array []

ATS Scoring Guidelines:
- required_keywords: Extract 10-20 important terms from JD
- keyword_match_pct: (matched / required) * 100
- keyword_density_score: High (80-100) if matched keywords appear multiple times
- format_score: High (80-100) for clean sections, bullet points, standard headers`;
}

const QUESTION_SYSTEM_PROMPT = `You are a world-class AI educator, senior technical interviewer, and assessment architect.
Your questions are used by top-tier companies to rigorously evaluate candidates.
Every question must test genuine depth of understanding — not surface recall.
Base all questions strictly on the given Job Description.
Respond with ONLY valid JSON — no markdown fences, no preamble, no extra text.`;

function buildQuestionPrompt(jdText) {
  return `## Job Description
${jdText}

Generate exactly 15 MCQ questions that deeply test the skills, knowledge, and judgment required by this Job Description.

Difficulty   Count  Points  Options
Easy         5      1 pt    A-D (4)   Core concept recall
Medium       5      2 pts   A-E (5)   Applied knowledge, trade-offs
Hard         5      3 pts   A-E (5)   Complex scenarios, architectural decisions
Total = 30 pts

Rules:
- correct_answer is ALWAYS a single uppercase letter (e.g. "A", "B", "C", "D", "E") — MANDATORY on every question
- IDs must be sequential 1-15
- Never repeat the same concept

Return a JSON object with EXACTLY this structure:
{
  "easy": [
    {
      "id": 1, "difficulty": "easy", "type": "mcq",
      "question": "<question text>",
      "options": [{"label":"A","text":"<option>"},{"label":"B","text":"<option>"},{"label":"C","text":"<option>"},{"label":"D","text":"<option>"}],
      "points": 1, "correct_answer": "B"
    }
  ],
  "medium": [
    {
      "id": 6, "difficulty": "medium", "type": "mcq",
      "question": "<question text>",
      "options": [{"label":"A","text":"<option>"},{"label":"B","text":"<option>"},{"label":"C","text":"<option>"},{"label":"D","text":"<option>"},{"label":"E","text":"<option>"}],
      "points": 2, "correct_answer": "C"
    }
  ],
  "hard": [
    {
      "id": 11, "difficulty": "hard", "type": "mcq",
      "question": "<question text>",
      "options": [{"label":"A","text":"<option>"},{"label":"B","text":"<option>"},{"label":"C","text":"<option>"},{"label":"D","text":"<option>"},{"label":"E","text":"<option>"}],
      "points": 3, "correct_answer": "D"
    }
  ]
}

Produce all 5 easy (ids 1-5), all 5 medium (ids 6-10), and all 5 hard (ids 11-15) questions.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// JSON cleaner
// ─────────────────────────────────────────────────────────────────────────────
function cleanJSON(raw) {
  let s = raw.replace(/```(?:json)?\s*/gi, "").replace(/```/g, "").trim();
  const start = s.indexOf("{");
  const end   = s.lastIndexOf("}");
  if (start !== -1 && end > start) s = s.slice(start, end + 1);
  s = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
  let result = "", inString = false, i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === "\\" && inString) { result += ch + (s[i + 1] || ""); i += 2; continue; }
    if (ch === '"') { inString = !inString; result += ch; i++; continue; }
    if (inString && (ch === "\n" || ch === "\r")) { result += " "; i++; continue; }
    if (inString && ch === "\t") { result += " "; i++; continue; }
    result += ch; i++;
  }
  return result.trim();
}

// =============================================================================
// AUTH ENDPOINTS
// =============================================================================

// Legacy login (backward compat)
app.post("/api/login", (req, res) => {
  const { email, password } = req.body;
  if (email === HR_EMAIL && password === "admin2025") {
    return res.json({ token: "ats-auth-2025", message: "Login successful" });
  }
  return res.status(401).json({ detail: "Invalid email or password" });
});

// Role-based login — checks Supabase users table; auto-registers new users
app.post("/api/auth/login", async (req, res) => {
  const { email, password, name } = req.body;
  if (!email?.trim() || !password) return res.status(422).json({ detail: "Email and password are required." });
  const em = email.trim().toLowerCase();

  const { data: userRow, error: fetchErr } = await supabase
    .from("users")
    .select("*")
    .eq("email", em)
    .maybeSingle();

  if (fetchErr) return res.status(500).json({ detail: "Database error." });

  if (userRow) {
    if (password !== userRow.password) return res.status(401).json({ detail: "Invalid credentials." });
    const token = makeToken({ email: userRow.email, role: userRow.role, name: userRow.name });
    return res.json({ token, role: userRow.role, name: userRow.name, email: em });
  }

  // New user auto-register (not allowed for HR email)
  if (em === HR_EMAIL) return res.status(401).json({ detail: "Invalid credentials." });
  if (!name?.trim()) return res.status(422).json({ detail: "Name is required for first-time login." });

  const newUser = { email: em, name: name.trim(), role: "user", password };
  const { error: insertErr } = await supabase.from("users").insert(newUser);
  if (insertErr) return res.status(500).json({ detail: "Registration failed." });

  const token = makeToken(newUser);
  return res.json({ token, role: "user", name: newUser.name, email: em, registered: true });
});

app.get("/api/auth/me", authMW, (req, res) => res.json(req.user));

app.post("/api/auth/logout", authMW, (req, res) => res.json({ message: "Logged out." }));

// =============================================================================
// APPLICATION ENDPOINTS (applicant-submitted CVs)
// =============================================================================

// Applicant uploads their CV
app.post("/api/applications/upload", authMW, upload.single("cv"), async (req, res) => {
  if (req.user.role !== "user") return res.status(403).json({ detail: "Only applicants can upload CVs." });
  if (!req.file) return res.status(422).json({ detail: "No file uploaded." });
  const fname = req.file.originalname || "";
  if (!fname.toLowerCase().endsWith(".pdf")) return res.status(422).json({ detail: "Only PDF files are supported." });

  let cvText = "";
  try { cvText = await extractTextFromPDF(req.file.buffer); }
  catch (e) { return res.status(422).json({ detail: `PDF extraction failed: ${e.message}` }); }
  if (!cvText.trim()) return res.status(422).json({ detail: "Could not extract text from PDF." });

  const id = crypto.randomUUID();
  const { error } = await supabase.from("applications").insert({
    id,
    candidate_email: req.user.email,
    candidate_name:  req.user.name,
    file_name:       fname,
    job_title:       (req.body.jobTitle || "").trim().slice(0, 120),
    pdf_base64:      req.file.buffer.toString("base64"),
    pdf_text:        cvText,
    uploaded_at:     new Date().toISOString(),
    status:          "uploaded",
    analysis_result: null,
    exam_id:         null,
    jd_text:         null,
  });
  if (error) return res.status(500).json({ detail: "Failed to save application." });
  return res.json({ id, fileName: fname, message: "CV uploaded successfully." });
});

// Applicant sees their own submissions
app.get("/api/applications/mine", authMW, async (req, res) => {
  if (req.user.role !== "user") return res.status(403).json({ detail: "Applicants only." });

  const { data, error } = await supabase
    .from("applications")
    .select("id, file_name, job_title, uploaded_at, status, exam_id")
    .eq("candidate_email", req.user.email)
    .order("uploaded_at", { ascending: false });

  if (error) return res.status(500).json({ detail: "Database error." });
  return res.json((data || []).map(a => ({
    id:        a.id,
    fileName:  a.file_name,
    jobTitle:  a.job_title || "",
    uploadedAt: a.uploaded_at,
    status:    a.status,
    examId:    a.exam_id,
  })));
});

// HR: list all applications with optional filter
app.get("/api/applications", authMW, hrOnly, async (req, res) => {
  const { keyword, status } = req.query;

  let query = supabase.from("applications").select("*").order("uploaded_at", { ascending: false });
  if (status) query = query.eq("status", status);

  const { data: apps, error } = await query;
  if (error) return res.status(500).json({ detail: "Database error." });

  let filtered = apps || [];
  if (keyword) {
    const kw = keyword.toLowerCase();
    filtered = filtered.filter(a =>
      (a.candidate_name  || "").toLowerCase().includes(kw) ||
      (a.candidate_email || "").toLowerCase().includes(kw) ||
      (a.jd_text         || "").toLowerCase().includes(kw)
    );
  }

  // Bulk-fetch exams for apps that have an exam_id
  const examIds = filtered.filter(a => a.exam_id).map(a => a.exam_id);
  const examsMap = {};
  if (examIds.length) {
    const { data: exams } = await supabase.from("exams").select("*").in("id", examIds);
    for (const ex of (exams || [])) examsMap[ex.id] = ex;
  }

  // Drop apps whose exam is both submitted and expired
  filtered = filtered.filter(a => {
    if (!a.exam_id) return true;
    const ex = examsMap[a.exam_id];
    if (ex?.submitted && new Date(ex.expires_at) < new Date()) return false;
    return true;
  });

  return res.json(filtered.map(a => {
    const ex = a.exam_id ? examsMap[a.exam_id] : null;
    const ar = a.analysis_result;
    return {
      id:             a.id,
      candidateEmail: a.candidate_email,
      candidateName:  a.candidate_name,
      fileName:       a.file_name,
      jobTitle:       a.job_title || "",
      uploadedAt:     a.uploaded_at,
      status:         a.status,
      analysisResult: ar ? {
        aiScore:              ar.aiScore,
        atsScore:             ar.atsScore,
        combinedScore:        ar.combinedScore,
        shortlisted:          ar.shortlisted,
        missing_requirements: ar.missing_requirements || [],
        summary:              ar.summary || "",
        key_strengths:        ar.key_strengths || [],
        gaps:                 ar.gaps || [],
        skills_match:         ar.skills_match || 0,
        experience_match:     ar.experience_match || 0,
        education_match:      ar.education_match || 0,
        ats: {
          matched_keywords:  ar.ats?.matched_keywords  || [],
          missing_keywords:  ar.ats?.missing_keywords  || [],
          keyword_match_pct: ar.ats?.keyword_match_pct || 0,
        },
      } : null,
      examId:     a.exam_id,
      examStatus: ex ? (ex.submitted ? "completed" : "pending") : null,
      examScore:  ex?.submitted ? {
        totalEarned: ex.score.totalEarned,
        totalMax:    ex.score.totalMax,
        percentage:  ex.score.percentage,
        grade:       ex.score.grade,
      } : null,
    };
  }));
});

// HR: analyze selected applications with a JD
app.post("/api/applications/analyze", authMW, hrOnly, async (req, res) => {
  const { applicationIds, jdText, threshold = 70 } = req.body;
  if (!applicationIds?.length) return res.status(422).json({ detail: "No applications selected." });
  if (!jdText?.trim())         return res.status(422).json({ detail: "Job description is required." });

  const results = [];
  for (const id of applicationIds) {
    const { data: appRec, error: fetchErr } = await supabase
      .from("applications")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (fetchErr || !appRec) { results.push({ id, error: true, error_message: "Not found." }); continue; }

    try {
      const raw      = await geminiChat({ systemPrompt: CV_SYSTEM_PROMPT, userPrompt: buildCVPrompt(jdText, appRec.pdf_text), maxTokens: 1500 });
      const data     = JSON.parse(cleanJSON(raw));
      const atsData  = data.ats || {};
      const atsScore = calculateATSScore(atsData);
      const aiScore  = parseInt(data.overall_score || 0);
      const combined = calculateCombinedScore(aiScore, atsScore);
      const shortlisted = combined >= threshold;

      const ar = {
        aiScore,
        atsScore,
        combinedScore: combined,
        shortlisted,
        threshold,
        candidate_name:       data.candidate_name      || appRec.candidate_name,
        skills_match:         parseInt(data.skills_match     || 0),
        experience_match:     parseInt(data.experience_match || 0),
        education_match:      parseInt(data.education_match  || 0),
        years_of_experience:  data.years_of_experience  ?? null,
        key_strengths:        data.key_strengths         || [],
        gaps:                 data.gaps                  || [],
        missing_requirements: data.missing_requirements  || [],
        summary:              data.summary               || "",
        ats: {
          ats_score:             atsScore,
          matched_keywords:      atsData.matched_keywords      || [],
          missing_keywords:      atsData.missing_keywords      || [],
          keyword_match_pct:     parseInt(atsData.keyword_match_pct     || 0),
          required_keywords:     atsData.required_keywords     || [],
          keyword_density_score: parseInt(atsData.keyword_density_score || 0),
          format_score:          parseInt(atsData.format_score           || 0),
          format_notes:          atsData.format_notes || [],
        },
        analyzedAt: new Date().toISOString(),
      };

      await supabase.from("applications").update({
        analysis_result: ar,
        jd_text:         jdText,
        status:          shortlisted ? "shortlisted" : "rejected",
      }).eq("id", id);

      results.push({ id, error: false, ...ar, candidateName: appRec.candidate_name, candidateEmail: appRec.candidate_email });
    } catch (e) {
      results.push({ id, error: true, error_message: e.message });
    }
  }
  return res.json({ results });
});

// Download/view CV PDF
app.get("/api/applications/:id/pdf", authMW, async (req, res) => {
  const { data: appRec, error } = await supabase
    .from("applications")
    .select("pdf_base64, file_name, candidate_email")
    .eq("id", req.params.id)
    .maybeSingle();

  if (error || !appRec) return res.status(404).json({ detail: "Not found." });
  if (req.user.role === "user" && appRec.candidate_email !== req.user.email)
    return res.status(403).json({ detail: "Forbidden." });

  const buf = Buffer.from(appRec.pdf_base64, "base64");
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${appRec.file_name}"`);
  res.send(buf);
});

// =============================================================================
// EXAM ENDPOINTS
// =============================================================================

// HR: generate and send exam to a shortlisted candidate
app.post("/api/exams/send", authMW, hrOnly, async (req, res) => {
  const { applicationId, jdText, expiryDays = EXAM_EXPIRY_DAYS } = req.body;
  if (!applicationId) return res.status(422).json({ detail: "applicationId is required." });

  const { data: appRec, error: fetchErr } = await supabase
    .from("applications")
    .select("*")
    .eq("id", applicationId)
    .maybeSingle();
  if (fetchErr || !appRec) return res.status(404).json({ detail: "Application not found." });
  if (!appRec.analysis_result?.shortlisted) return res.status(422).json({ detail: "Candidate must be shortlisted first." });

  const examJd = (jdText || appRec.jd_text || "").trim();
  if (!examJd) return res.status(422).json({ detail: "Job description required for exam." });

  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const raw = await geminiChat({ systemPrompt: QUESTION_SYSTEM_PROMPT, userPrompt: buildQuestionPrompt(examJd), maxTokens: 8000, temperature: 0.7 });
      let data;
      try { data = JSON.parse(cleanJSON(raw)); } catch (e) { lastError = e; continue; }

      const easyRaw   = (data.easy   || []).slice(0, 5);
      const mediumRaw = (data.medium || []).slice(0, 5);
      const hardRaw   = (data.hard   || []).slice(0, 5);
      const all       = [...easyRaw, ...mediumRaw, ...hardRaw];
      if (!all.length)                      { lastError = new Error("No questions generated."); continue; }
      if (all.some(q => !q.correct_answer)) { lastError = new Error("Missing correct_answer in some questions."); continue; }

      const strip  = q => { const c = { ...q }; delete c.correct_answer; delete c.model_answer; return c; };
      const now    = new Date();
      const examId = crypto.randomUUID();

      const { error: insertErr } = await supabase.from("exams").insert({
        id:              examId,
        application_id:  applicationId,
        candidate_email: appRec.candidate_email,
        candidate_name:  appRec.candidate_name,
        questions:       all.map(strip),
        evaluation_key:  all,
        answers:         {},
        submitted:       false,
        score:           null,
        jd_text:         examJd,
        sent_at:         now.toISOString(),
        expires_at:      new Date(+now + expiryDays * 86400000).toISOString(),
        completed_at:    null,
        total_marks:     easyRaw.length * 1 + mediumRaw.length * 2 + hardRaw.length * 3,
        final_decision:  null,
      });
      if (insertErr) { lastError = insertErr; continue; }

      await supabase.from("applications").update({ exam_id: examId, status: "exam_sent" }).eq("id", applicationId);
      return res.json({ examId, sentAt: now.toISOString(), expiresAt: new Date(+now + expiryDays * 86400000).toISOString(), message: "Exam sent to candidate." });
    } catch (e) { lastError = e; }
  }
  return res.status(500).json({ detail: `Exam generation failed: ${lastError?.message}` });
});

// Applicant: view their pending exam (or result)
app.get("/api/exams/mine", authMW, async (req, res) => {
  if (req.user.role !== "user") return res.status(403).json({ detail: "Applicants only." });

  const { data: myExams, error } = await supabase
    .from("exams")
    .select("*")
    .eq("candidate_email", req.user.email)
    .order("sent_at", { ascending: false });

  if (error) return res.status(500).json({ detail: "Database error." });
  if (!myExams?.length) return res.json({ exam: null });

  const e = myExams[0];
  if (e.submitted) {
    return res.json({ exam: { id: e.id, submitted: true, score: e.score, completedAt: e.completed_at, questions: e.questions, evaluationKey: e.evaluation_key } });
  }
  if (new Date(e.expires_at) < new Date()) {
    return res.json({ exam: { expired: true, expiresAt: e.expires_at } });
  }
  return res.json({ exam: { id: e.id, questions: e.questions, sentAt: e.sent_at, expiresAt: e.expires_at, totalMarks: e.total_marks, submitted: false } });
});

// Applicant: submit exam answers
app.post("/api/exams/submit", authMW, async (req, res) => {
  if (req.user.role !== "user") return res.status(403).json({ detail: "Applicants only." });
  const { examId, answers = [] } = req.body;

  const { data: exam, error: fetchErr } = await supabase
    .from("exams")
    .select("*")
    .eq("id", examId)
    .maybeSingle();

  if (fetchErr || !exam)                              return res.status(404).json({ detail: "Exam not found." });
  if (exam.candidate_email !== req.user.email)        return res.status(403).json({ detail: "Forbidden." });
  if (exam.submitted)                                 return res.status(400).json({ detail: "Exam already submitted." });
  if (new Date(exam.expires_at) < new Date())         return res.status(400).json({ detail: "Exam has expired." });

  const aMap = {};
  for (const a of answers) aMap[String(a.question_id)] = (a.answer || "").trim();

  const dPts = { easy: 1, medium: 2, hard: 3 };
  let totalEarned = 0, totalMax = 0;
  const questionResults = [];

  for (const q of exam.evaluation_key) {
    const qid    = String(q.id || "");
    const diff   = (q.difficulty || "easy").toLowerCase();
    const maxPts = parseInt(q.points || dPts[diff] || 1);
    totalMax    += maxPts;
    const given  = aMap[qid] || "";
    const correct= (q.correct_answer || "").trim().toUpperCase();
    const ok     = given.toUpperCase() === correct;
    const earned = ok ? maxPts : 0;
    totalEarned += earned;
    questionResults.push({
      question_id: parseInt(qid) || 0,
      difficulty: diff,
      question: q.question || "",
      options: q.options || null,
      points: maxPts,
      earned, correct_answer: correct, given_answer: given, is_correct: ok,
      feedback: ok ? "Correct!" : `Incorrect. Correct answer: ${correct}`,
    });
  }

  const pct   = totalMax ? Math.round((totalEarned / totalMax) * 1000) / 10 : 0;
  const grade = pct >= 80 ? "Excellent" : pct >= 60 ? "Good" : pct >= 40 ? "Average" : "Needs Improvement";
  const sections = ["easy", "medium", "hard"].map(d => {
    const s = questionResults.filter(r => r.difficulty === d);
    return s.length ? { difficulty: d, earned: s.reduce((t, r) => t + r.earned, 0), max: s.reduce((t, r) => t + r.points, 0), count: s.length } : null;
  }).filter(Boolean);

  const score = { totalEarned, totalMax, percentage: pct, grade, sections, results: questionResults };

  await supabase.from("exams").update({
    submitted:    true,
    answers:      aMap,
    completed_at: new Date().toISOString(),
    score,
  }).eq("id", examId);

  if (exam.application_id) {
    await supabase.from("applications").update({ status: "exam_completed" }).eq("id", exam.application_id);
  }
  return res.json({ message: "Submitted.", score: { totalEarned, totalMax, percentage: pct, grade } });
});

// HR: list all exams (results)
app.get("/api/exams", authMW, hrOnly, async (req, res) => {
  const { data: exams, error } = await supabase
    .from("exams")
    .select("id, application_id, candidate_name, candidate_email, sent_at, expires_at, submitted, completed_at, final_decision, score")
    .order("sent_at", { ascending: false });

  if (error) return res.status(500).json({ detail: "Database error." });
  return res.json((exams || []).map(e => ({
    id:             e.id,
    applicationId:  e.application_id,
    candidateName:  e.candidate_name,
    candidateEmail: e.candidate_email,
    sentAt:         e.sent_at,
    expiresAt:      e.expires_at,
    submitted:      e.submitted,
    completedAt:    e.completed_at,
    finalDecision:  e.final_decision || null,
    score: e.score ? { totalEarned: e.score.totalEarned, totalMax: e.score.totalMax, percentage: e.score.percentage, grade: e.score.grade } : null,
  })));
});

// HR: set final decision on an exam (selected / rejected)
app.patch("/api/exams/:id/decision", authMW, hrOnly, async (req, res) => {
  const { decision } = req.body;
  if (!["selected", "rejected"].includes(decision))
    return res.status(422).json({ detail: "Decision must be 'selected' or 'rejected'." });

  const { data: exam, error: fetchErr } = await supabase
    .from("exams")
    .select("id, application_id")
    .eq("id", req.params.id)
    .maybeSingle();
  if (fetchErr || !exam) return res.status(404).json({ detail: "Exam not found." });

  await supabase.from("exams").update({ final_decision: decision }).eq("id", req.params.id);
  if (exam.application_id) {
    await supabase.from("applications").update({ status: decision }).eq("id", exam.application_id);
  }
  return res.json({ ok: true, finalDecision: decision });
});

// HR/Applicant: full exam detail
app.get("/api/exams/:id", authMW, async (req, res) => {
  const { data: exam, error } = await supabase
    .from("exams")
    .select("*")
    .eq("id", req.params.id)
    .maybeSingle();

  if (error || !exam) return res.status(404).json({ detail: "Not found." });
  if (req.user.role === "user" && exam.candidate_email !== req.user.email)
    return res.status(403).json({ detail: "Forbidden." });

  return res.json({
    id:             exam.id,
    applicationId:  exam.application_id,
    candidateEmail: exam.candidate_email,
    candidateName:  exam.candidate_name,
    questions:      exam.questions,
    evaluationKey:  exam.evaluation_key,
    answers:        exam.answers,
    submitted:      exam.submitted,
    score:          exam.score,
    jdText:         exam.jd_text,
    sentAt:         exam.sent_at,
    expiresAt:      exam.expires_at,
    completedAt:    exam.completed_at,
    totalMarks:     exam.total_marks,
    finalDecision:  exam.final_decision,
  });
});

// HR: manually update application status
app.patch("/api/applications/:id/status", authMW, hrOnly, async (req, res) => {
  const { status } = req.body;
  if (!["shortlisted", "rejected", "next_level", "selected"].includes(status))
    return res.status(422).json({ detail: "Invalid status value." });

  const { error } = await supabase
    .from("applications")
    .update({ status })
    .eq("id", req.params.id);

  if (error) return res.status(404).json({ detail: "Application not found." });
  return res.json({ ok: true, status });
});

// HR: delete an application (also removes linked exam)
app.delete("/api/applications/:id", authMW, hrOnly, async (req, res) => {
  const { data: appRec, error: fetchErr } = await supabase
    .from("applications")
    .select("exam_id")
    .eq("id", req.params.id)
    .maybeSingle();

  if (fetchErr || !appRec) return res.status(404).json({ detail: "Application not found." });
  if (appRec.exam_id) {
    await supabase.from("exams").delete().eq("id", appRec.exam_id);
  }
  await supabase.from("applications").delete().eq("id", req.params.id);
  return res.json({ ok: true });
});

// HR: clear ALL applications and exams
app.delete("/api/data/clear-all", authMW, hrOnly, async (req, res) => {
  const { error: e1 } = await supabase.from("exams").delete().not("id", "is", null);
  const { error: e2 } = await supabase.from("applications").delete().not("id", "is", null);
  if (e1 || e2) return res.status(500).json({ detail: "Clear failed: " + (e1?.message || e2?.message) });
  return res.json({ ok: true });
});

// HR: delete an exam record (resets linked application to shortlisted)
app.delete("/api/exams/:id", authMW, hrOnly, async (req, res) => {
  const { data: exam, error: fetchErr } = await supabase
    .from("exams")
    .select("id, application_id")
    .eq("id", req.params.id)
    .maybeSingle();

  if (fetchErr || !exam) return res.status(404).json({ detail: "Exam not found." });
  if (exam.application_id) {
    await supabase.from("applications").update({ exam_id: null, status: "shortlisted" }).eq("id", exam.application_id);
  }
  await supabase.from("exams").delete().eq("id", req.params.id);
  return res.json({ ok: true });
});

// HR: send exam directly to a registered user (batch analysis flow)
app.post("/api/exams/send-to-user", authMW, hrOnly, async (req, res) => {
  const { userEmail, jdText, expiryDays = EXAM_EXPIRY_DAYS } = req.body;
  if (!userEmail?.trim()) return res.status(422).json({ detail: "userEmail is required." });
  const em = userEmail.trim().toLowerCase();

  const { data: user, error: userErr } = await supabase
    .from("users")
    .select("email, name, role")
    .eq("email", em)
    .maybeSingle();
  if (userErr || !user || user.role !== "user")
    return res.status(404).json({ detail: `No applicant account found with email: ${em}` });

  const examJd = (jdText || "").trim();
  if (!examJd) return res.status(422).json({ detail: "Job description required for exam." });

  const { data: pendingExams } = await supabase
    .from("exams")
    .select("id, expires_at")
    .eq("candidate_email", em)
    .eq("submitted", false);

  const existing = (pendingExams || []).find(e => new Date(e.expires_at) > new Date());
  if (existing) return res.status(400).json({ detail: "This user already has an active pending exam." });

  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const raw = await geminiChat({ systemPrompt: QUESTION_SYSTEM_PROMPT, userPrompt: buildQuestionPrompt(examJd), maxTokens: 8000, temperature: 0.7 });
      let data;
      try { data = JSON.parse(cleanJSON(raw)); } catch (e) { lastError = e; continue; }

      const easyRaw   = (data.easy   || []).slice(0, 5);
      const mediumRaw = (data.medium || []).slice(0, 5);
      const hardRaw   = (data.hard   || []).slice(0, 5);
      const all       = [...easyRaw, ...mediumRaw, ...hardRaw];
      if (!all.length)                      { lastError = new Error("No questions generated."); continue; }
      if (all.some(q => !q.correct_answer)) { lastError = new Error("Missing correct_answer in some questions."); continue; }

      const strip  = q => { const c = { ...q }; delete c.correct_answer; delete c.model_answer; return c; };
      const now    = new Date();
      const examId = crypto.randomUUID();

      const { error: insertErr } = await supabase.from("exams").insert({
        id:              examId,
        application_id:  null,
        candidate_email: em,
        candidate_name:  user.name,
        questions:       all.map(strip),
        evaluation_key:  all,
        answers:         {},
        submitted:       false,
        score:           null,
        jd_text:         examJd,
        sent_at:         now.toISOString(),
        expires_at:      new Date(+now + expiryDays * 86400000).toISOString(),
        completed_at:    null,
        total_marks:     easyRaw.length * 1 + mediumRaw.length * 2 + hardRaw.length * 3,
        final_decision:  null,
      });
      if (insertErr) { lastError = insertErr; continue; }

      return res.json({ examId, sentAt: now.toISOString(), expiresAt: new Date(+now + expiryDays * 86400000).toISOString(), message: "Exam sent to candidate." });
    } catch (e) { lastError = e; }
  }
  return res.status(500).json({ detail: `Exam generation failed: ${lastError?.message}` });
});

// =============================================================================
// EXISTING ATS / HR-SHORTLIST / EXAM-GENERATE ENDPOINTS (unchanged, no DB)
// =============================================================================

app.get("/api/health", (_req, res) => res.json({ status: "ok", model: MODEL, version: "5.0.0" }));

// One-time database migration — call this once after deploying to Vercel:
//   GET https://<your-vercel-domain>/api/setup
// Requires HR credentials in the Authorization header (Bearer token from login).
app.get("/api/setup", authMW, hrOnly, async (_req, res) => {
  try {
    await initDb();
    return res.json({ ok: true, message: "Database tables created and HR user seeded." });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// Single CV — ATS Dashboard
app.post("/api/shortlist", upload.single("cv"), async (req, res) => {
  const { jd_text, threshold: thresholdRaw } = req.body;
  const threshold = parseInt(thresholdRaw ?? 70);
  if (!jd_text?.trim())                   return res.status(422).json({ detail: "Job description cannot be empty." });
  if (!req.file)                          return res.status(422).json({ detail: "No CV file uploaded." });
  if (threshold < 0 || threshold > 100)  return res.status(422).json({ detail: "Threshold must be 0-100." });
  const fname = req.file.originalname || "unknown.pdf";
  if (!fname.toLowerCase().endsWith(".pdf")) return res.status(422).json({ detail: "Only PDF files are supported." });

  let cvText;
  try { cvText = await extractTextFromPDF(req.file.buffer); }
  catch (e) { return res.status(422).json({ detail: `PDF extraction failed: ${e.message}` }); }
  if (!cvText.trim()) return res.status(422).json({ detail: "Could not extract text — PDF may be scanned or image-based." });

  try {
    const raw      = await geminiChat({ systemPrompt: CV_SYSTEM_PROMPT, userPrompt: buildCVPrompt(jd_text, cvText), maxTokens: 1500 });
    const data     = JSON.parse(cleanJSON(raw));
    const atsData  = data.ats || {};
    const atsScore = calculateATSScore(atsData);
    const aiScore  = parseInt(data.overall_score || 0);
    const combined = calculateCombinedScore(aiScore, atsScore);
    const result = {
      filename:             fname,
      candidate_name:       data.candidate_name       || "Unknown",
      overall_score:        aiScore,
      ats_match_score:      combined,
      shortlisted:          combined >= threshold,
      skills_match:         parseInt(data.skills_match     || 0),
      experience_match:     parseInt(data.experience_match || 0),
      education_match:      parseInt(data.education_match  || 0),
      years_of_experience:  data.years_of_experience ?? null,
      key_strengths:        data.key_strengths        || [],
      gaps:                 data.gaps                 || [],
      missing_requirements: data.missing_requirements || [],
      summary:              data.summary              || "",
      ats: {
        ats_score:             atsScore,
        matched_keywords:      atsData.matched_keywords      || [],
        missing_keywords:      atsData.missing_keywords      || [],
        keyword_match_pct:     parseInt(atsData.keyword_match_pct     || 0),
        required_keywords:     atsData.required_keywords     || [],
        keyword_density_score: parseInt(atsData.keyword_density_score || 0),
        format_score:          parseInt(atsData.format_score          || 0),
        format_notes:          atsData.format_notes || [],
      },
      error: false,
    };
    return res.json({ total: 1, shortlisted: result.shortlisted ? 1 : 0, rejected: result.shortlisted ? 0 : 1, threshold, results: [result] });
  } catch (e) {
    return res.status(500).json({ detail: `Scoring failed: ${e.message}` });
  }
});

// Bulk CVs — legacy HR Batch Module
const uploadMany = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
app.post("/api/hr-shortlist", uploadMany.array("cvs", 10), async (req, res) => {
  const { jd_text, threshold: thresholdRaw } = req.body;
  const threshold = parseInt(thresholdRaw ?? 70);
  if (!jd_text?.trim())   return res.status(422).json({ detail: "Job description cannot be empty." });
  if (!req.files?.length) return res.status(422).json({ detail: "No CV files uploaded." });

  const results = [];
  for (const file of req.files) {
    const fname = file.originalname || "unknown.pdf";
    if (!fname.toLowerCase().endsWith(".pdf")) { results.push({ filename: fname, error: true, error_message: "Only PDF files supported." }); continue; }
    try {
      const cvText = await extractTextFromPDF(file.buffer);
      if (!cvText.trim()) { results.push({ filename: fname, error: true, error_message: "Could not extract text from PDF." }); continue; }
      const raw      = await geminiChat({ systemPrompt: CV_SYSTEM_PROMPT, userPrompt: buildCVPrompt(jd_text, cvText), maxTokens: 1500, temperature: 0 });
      const data     = JSON.parse(cleanJSON(raw));
      const atsData  = data.ats || {};
      const atsScore = calculateATSScore(atsData);
      const aiScore  = parseInt(data.overall_score || 0);
      const combined = calculateCombinedScore(aiScore, atsScore);
      results.push({
        filename: fname, candidate_name: data.candidate_name || "Unknown",
        overall_score: aiScore, ats_match_score: combined, shortlisted: combined >= threshold,
        skills_match: parseInt(data.skills_match || 0), experience_match: parseInt(data.experience_match || 0),
        education_match: parseInt(data.education_match || 0), years_of_experience: data.years_of_experience ?? null,
        key_strengths: data.key_strengths || [], gaps: data.gaps || [],
        missing_requirements: data.missing_requirements || [], summary: data.summary || "",
        ats: { ats_score: atsScore, matched_keywords: atsData.matched_keywords || [], missing_keywords: atsData.missing_keywords || [], keyword_match_pct: parseInt(atsData.keyword_match_pct || 0) },
        error: false,
      });
    } catch (e) { results.push({ filename: fname, error: true, error_message: e.message }); }
  }
  const valid   = results.filter(r => !r.error).sort((a, b) => b.ats_match_score - a.ats_match_score);
  const errored = results.filter(r => r.error);
  return res.json({ total: req.files.length, shortlisted: valid.filter(r => r.shortlisted).length, rejected: valid.filter(r => !r.shortlisted).length, errors: errored.length, threshold, results: [...valid, ...errored] });
});

// Generate questions (legacy — used by ATS Dashboard)
app.post("/api/generate-questions", upload.none(), async (req, res) => {
  const jd_text = req.body.jd_text || "";
  if (!jd_text.trim()) return res.status(422).json({ detail: "Job description cannot be empty." });
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const raw = await geminiChat({ systemPrompt: QUESTION_SYSTEM_PROMPT, userPrompt: buildQuestionPrompt(jd_text), maxTokens: 8000, temperature: 0.7 });
      let data;
      try { data = JSON.parse(cleanJSON(raw)); } catch (e) { lastError = new Error(`JSON parse: ${e.message}`); continue; }
      const easyRaw   = (data.easy   || []).slice(0, 5);
      const mediumRaw = (data.medium || []).slice(0, 5);
      const hardRaw   = (data.hard   || []).slice(0, 5);
      const all = [...easyRaw, ...mediumRaw, ...hardRaw];
      if (!all.length)                   { lastError = new Error("No questions returned."); continue; }
      if (all.some(q => !q.correct_answer)) { lastError = new Error(`Missing correct_answer on some questions.`); continue; }
      const strip = q => { const c = { ...q }; delete c.correct_answer; delete c.model_answer; return c; };
      return res.json({ questions: all.map(strip), evaluation_key: all, total_questions: all.length, total_marks: easyRaw.length * 1 + mediumRaw.length * 2 + hardRaw.length * 3, scoring: { easy: { count: easyRaw.length, points_each: 1 }, medium: { count: mediumRaw.length, points_each: 2 }, hard: { count: hardRaw.length, points_each: 3 } } });
    } catch (e) { lastError = e; }
  }
  return res.status(500).json({ detail: `Question generation failed: ${lastError?.message}` });
});

// Submit exam (legacy — used by ATS Dashboard)
app.post("/api/submit-exam", async (req, res) => {
  const { candidate_name, evaluation_key, answers } = req.body;
  if (!evaluation_key || !answers) return res.status(422).json({ detail: "evaluation_key and answers are required." });
  const aMap = {};
  for (const a of answers) aMap[String(a.question_id)] = (a.answer || "").trim();
  const dPts = { easy: 1, medium: 2, hard: 3 };
  let totalEarned = 0, totalMax = 0;
  const questionResults = [];
  for (const q of evaluation_key) {
    const qid = String(q.id || "");
    const diff = (q.difficulty || "easy").toLowerCase();
    const maxPts = parseInt(q.points || dPts[diff] || 1);
    totalMax += maxPts;
    const given = aMap[qid] || "";
    const correct = (q.correct_answer || "").trim().toUpperCase();
    const ok = given.toUpperCase() === correct;
    const earned = ok ? maxPts : 0;
    totalEarned += earned;
    questionResults.push({ question_id: parseInt(qid) || 0, difficulty: diff, type: "mcq", question: q.question || "", options: q.options || null, points: maxPts, earned, correct_answer: correct, given_answer: given, is_correct: ok, feedback: ok ? "Correct!" : `Incorrect. Correct answer: ${correct}`, key_points_hit: [], key_points_missed: [] });
  }
  const sections = ["easy","medium","hard"].map(d => { const s = questionResults.filter(r => r.difficulty === d); return s.length ? { difficulty: d, earned: s.reduce((t, r) => t + r.earned, 0), max: s.reduce((t, r) => t + r.points, 0), count: s.length } : null; }).filter(Boolean);
  const pct = totalMax ? Math.round((totalEarned / totalMax) * 1000) / 10 : 0;
  const grade = pct >= 80 ? "Excellent" : pct >= 60 ? "Good" : pct >= 40 ? "Average" : "Needs Improvement";
  return res.json({ candidate_name: candidate_name || "Candidate", total_earned: totalEarned, total_max: totalMax, percentage: pct, grade, sections, results: questionResults });
});

// =============================================================================
// PAGE ROUTES
// =============================================================================
app.get("/login",     (_req, res) => res.sendFile(path.join(__dirname, "public", "login.html")));
app.get("/hr",        (_req, res) => res.sendFile(path.join(__dirname, "public", "hr.html")));
app.get("/ats",       (_req, res) => res.sendFile(path.join(__dirname, "public", "ats.html")));
app.get("/dashboard", (_req, res) => res.sendFile(path.join(__dirname, "public", "dashboard.html")));
app.get("*",          (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

// =============================================================================
// START (local) / EXPORT (Vercel)
// =============================================================================
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n  ┌──────────────────────────────────────────────────┐`);
    console.log(`  │   CV Shortlister v5  (Supabase + Gemma 3 27B)    │`);
    console.log(`  │   http://localhost:${PORT}                            │`);
    console.log(`  └──────────────────────────────────────────────────┘\n`);
  });
}
module.exports = app;
