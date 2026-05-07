"use strict";

const express  = require("express");
const path     = require("path");
const multer   = require("multer");
const pdfParse = require("pdf-parse");
const crypto   = require("crypto");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { createClient }       = require("@supabase/supabase-js");
const { Client: PgClient }   = require("pg");
const {
  GEMINI_API_KEY,
  SUPABASE_URL,
  SUPABASE_KEY,
  DB_CONN,
  TOKEN_SECRET,
} = require("./config");

const app    = express();
const PORT   = process.env.PORT || 8001;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const MODEL            = "gemma-3-12b-it";
const MAX_CV_CHARS     = 12000;
const HR_EMAIL         = "ai@sysnova.com";
const EXAM_EXPIRY_DAYS = 7;

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// ─────────────────────────────────────────────────────────────────────────────
// Supabase — REST client (all CRUD) + direct pg connection (migrations only)
// ─────────────────────────────────────────────────────────────────────────────
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Detect whether user_id columns exist (added by migration).
// Starts false; flips to true once confirmed so inserts are safe.
let _schemaHasUserId = false;
(async () => {
  try {
    const { error } = await supabase.from("applications").select("user_id").limit(1);
    _schemaHasUserId = !error;
    if (_schemaHasUserId) console.log("[schema] user_id columns detected.");
    else console.log("[schema] user_id columns not yet added — run /api/setup to migrate.");
  } catch { /* non-fatal */ }
})();

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
        user_id         UUID,
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
        user_id         UUID,
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

      ALTER TABLE applications ADD COLUMN IF NOT EXISTS user_id UUID;
      ALTER TABLE exams        ADD COLUMN IF NOT EXISTS user_id UUID;

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
function makeToken(user) {
  const payload = Buffer.from(JSON.stringify({ id: user.id, email: user.email, role: user.role, name: user.name })).toString("base64url");
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
// Serve React build (Vite outputs to /public when built)
app.use(express.static(path.join(__dirname, "public"), { index: false }));

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
// ATS Score Calculator (Industry-Standard Formula)
// Based on recognized recruiting standards used by major ATS systems
// ─────────────────────────────────────────────────────────────────────────────
function enrichATSData(raw) {
  const matched = (raw.matched_keywords || []).length;
  const missing = (raw.missing_keywords || []).length;
  const total   = matched + missing;
  const kwPct   = total > 0
    ? Math.round((matched / total) * 100)
    : parseInt(raw.keyword_match_pct || 0);
  return { ...raw, keyword_match_pct: kwPct };
}

/**
 * Industry-Standard ATS Scoring Formula
 * Based on research from major ATS providers (Taleo, Greenhouse, Lever, iCIMS)
 * 
 * Components:
 * 1. Keyword Match (50%) - Critical for initial screening
 *    - Hard skills, technical terms, certifications
 *    - Uses tiered scoring: 90-100% = excellent, 70-89% = good, 50-69% = fair, <50% = poor
 * 
 * 2. Keyword Density (30%) - Measures depth of experience
 *    - How frequently and prominently keywords appear
 *    - Indicates genuine expertise vs. keyword stuffing
 * 
 * 3. Format & Parseability (20%) - Technical compatibility
 *    - Clean structure, standard sections, ATS-friendly formatting
 *    - Ensures accurate data extraction
 * 
 * Scoring Tiers (Industry Standard):
 * - 80-100: Excellent match, strong candidate
 * - 60-79:  Good match, worth reviewing
 * - 40-59:  Fair match, conditional consideration
 * - 0-39:   Poor match, likely rejection
 */
function calculateATSScore(atsData) {
  const kwMatch   = parseInt(atsData.keyword_match_pct     || 0);
  const kwDensity = parseInt(atsData.keyword_density_score || 0);
  const fmtScore  = parseInt(atsData.format_score          || 0);
  
  // Industry-standard weighted formula: 50% keywords, 30% density, 20% format
  const rawScore = (kwMatch * 0.50) + (kwDensity * 0.30) + (fmtScore * 0.20);
  
  // Apply non-linear scaling for better differentiation
  // This rewards high performers and penalizes weak matches more clearly
  let finalScore = rawScore;
  
  // Bonus for excellent keyword match (90%+)
  if (kwMatch >= 90) {
    finalScore += 5;
  }
  // Penalty for poor keyword match (<50%)
  else if (kwMatch < 50) {
    finalScore -= 10;
  }
  
  // Bonus for high density + high match (indicates genuine expertise)
  if (kwMatch >= 70 && kwDensity >= 70) {
    finalScore += 3;
  }
  
  // Penalty for poor format (reduces parseability)
  if (fmtScore < 60) {
    finalScore -= 5;
  }
  
  return Math.max(0, Math.min(100, Math.round(finalScore)));
}

/**
 * Combined Score Calculation
 * Balances AI semantic understanding with ATS keyword matching
 * 50/50 split is industry standard for hybrid AI+ATS systems
 */
function calculateCombinedScore(aiScore, atsScore) {
  return Math.round(aiScore * 0.50 + atsScore * 0.50);
}

// ─────────────────────────────────────────────────────────────────────────────
// Prompts
// ─────────────────────────────────────────────────────────────────────────────
const CV_SYSTEM_PROMPT = `You are an expert HR recruiter, ATS specialist, and talent acquisition expert.
Evaluate a candidate's CV against a Job Description.
The CV is plain text — use its content to extract structured info.
Evaluate strictly and only on evidence present in the job description and resume.
Pay close attention to overall_score, skills_match, and experience_match; do not infer missing details.
Respond with ONLY valid JSON — no markdown fences, no preamble, no extra text.`;

function buildCVPrompt(jdText, cvText) {
  return `## Job Description
${jdText}

## Candidate CV
${cvText.slice(0, MAX_CV_CHARS)}

Analyze this candidate and return a JSON object with EXACTLY these fields:

Strict evaluation rules:
- Compare the job description and resume directly and penalize missing evidence
- overall_score should reflect strict alignment between JD and CV
- skills_match should reflect only explicitly demonstrated skills
- experience_match should reflect only clearly stated years, roles, and responsibilities
- If evidence is weak or absent, score conservatively

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

ATS Scoring Guidelines (Industry-Standard):

1. required_keywords (Extract 15-25 critical terms):
   - Hard skills (programming languages, tools, frameworks)
   - Certifications (AWS, PMP, CPA, etc.)
   - Technical competencies (Agile, DevOps, Machine Learning)
   - Domain expertise (Healthcare, Finance, E-commerce)
   - Job-specific terms (Senior, Lead, Manager, Architect)
   
2. keyword_match_pct (Exact matching):
   - Count exact matches (case-insensitive)
   - Partial matches count as 0.5 (e.g., "JavaScript" matches "JS")
   - Formula: (matched_count / required_count) * 100
   - Scoring: 90-100% = Excellent, 70-89% = Good, 50-69% = Fair, <50% = Poor

3. keyword_density_score (Frequency & prominence):
   - 90-100: Keywords appear 3+ times, in multiple sections (summary, experience, skills)
   - 70-89:  Keywords appear 2+ times, in at least 2 sections
   - 50-69:  Keywords appear once, scattered placement
   - 30-49:  Keywords barely present, weak context
   - 0-29:   Keywords mentioned but not demonstrated with evidence

4. format_score (ATS parseability):
   - 90-100: Clean structure, standard sections (Summary, Experience, Education, Skills), bullet points, no tables/graphics, consistent formatting
   - 70-89:  Good structure, minor formatting issues, mostly parseable
   - 50-69:  Acceptable but has tables, columns, or unusual layouts
   - 30-49:  Poor structure, difficult to parse, missing key sections
   - 0-29:   Unparseable, heavy graphics, no clear sections

5. format_notes: Provide specific feedback
   - "Clean ATS-friendly format with standard sections"
   - "Contains tables which may cause parsing issues"
   - "Missing clear skills section"
   - "Excellent use of bullet points and action verbs"
   - "Non-standard section headers may confuse ATS"`;
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

// Convert options from array [{label:'A',text:'...'}] to object {A:'...'} format
function normalizeOpts(q) {
  if (!Array.isArray(q.options)) return q;
  const opts = {};
  for (const o of q.options) opts[o.label] = o.text;
  return { ...q, options: opts };
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
    const token = makeToken({ id: userRow.id, email: userRow.email, role: userRow.role, name: userRow.name });
    return res.json({ token, role: userRow.role, name: userRow.name, email: em, userId: userRow.id });
  }

  // New user auto-register (not allowed for HR email)
  if (em === HR_EMAIL) return res.status(401).json({ detail: "Invalid credentials." });
  if (!name?.trim()) return res.status(422).json({ detail: "Name is required for first-time login." });

  const { data: inserted, error: insertErr } = await supabase.from("users").insert({ email: em, name: name.trim(), role: "user", password }).select("id").maybeSingle();
  if (insertErr) return res.status(500).json({ detail: "Registration failed." });

  const newUser = { id: inserted?.id, email: em, name: name.trim(), role: "user" };
  const token = makeToken(newUser);
  return res.json({ token, role: "user", name: newUser.name, email: em, userId: newUser.id, registered: true });
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
    ...(_schemaHasUserId && req.user.id ? { user_id: req.user.id } : {}),
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
        overall_score:        ar.aiScore || 0,
        ai_score:             ar.aiScore || 0,
        combined_score:       ar.combinedScore || 0,
        shortlisted:          ar.shortlisted,
        missing_requirements: ar.missing_requirements || [],
        summary:              ar.summary || "",
        key_strengths:        ar.key_strengths || [],
        gaps:                 ar.gaps || [],
        skills_match:         ar.skills_match || 0,
        experience_match:     ar.experience_match || 0,
        education_match:      ar.education_match || 0,
        ats: {
          matched_keywords:      ar.ats?.matched_keywords  || [],
          missing_keywords:      ar.ats?.missing_keywords  || [],
          keyword_match_pct:     ar.ats?.keyword_match_pct || 0,
          keyword_match:         ar.ats?.keyword_match_pct || 0,
          keyword_density_score: ar.ats?.keyword_density_score || 0,
          format_score:          ar.ats?.format_score || 0,
          ats_score:             ar.ats?.ats_score || 0,
          combined_ats_score:    ar.ats?.ats_score || 0,
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
      const atsData  = enrichATSData(data.ats || {});
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
          combined_ats_score:    atsScore,
          matched_keywords:      atsData.matched_keywords      || [],
          missing_keywords:      atsData.missing_keywords      || [],
          keyword_match_pct:     parseInt(atsData.keyword_match_pct     || 0),
          keyword_match:         parseInt(atsData.keyword_match_pct     || 0),
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

  const examJd = (jdText || appRec.jd_text || "").trim();
  if (!examJd) return res.status(422).json({ detail: "jd_required" });

  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const raw = await geminiChat({ systemPrompt: QUESTION_SYSTEM_PROMPT, userPrompt: buildQuestionPrompt(examJd), maxTokens: 8000, temperature: 0.7 });
      let data;
      try { data = JSON.parse(cleanJSON(raw)); } catch (e) { lastError = e; continue; }

      const easyRaw   = (data.easy   || []).slice(0, 5);
      const mediumRaw = (data.medium || []).slice(0, 5);
      const hardRaw   = (data.hard   || []).slice(0, 5);
      const all       = [...easyRaw, ...mediumRaw, ...hardRaw].map(normalizeOpts);
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

// Applicant: view exam status only (no questions exposed until /start is called)
app.get("/api/exams/mine", authMW, async (req, res) => {
  if (req.user.role !== "user") return res.status(403).json({ detail: "Applicants only." });

  const { data: myExams, error } = await supabase
    .from("exams")
    .select("id, candidate_email, submitted, score, completed_at, sent_at, expires_at, total_marks, questions, final_decision")
    .eq("candidate_email", req.user.email)
    .order("sent_at", { ascending: false });

  if (error) return res.status(500).json({ detail: "Database error." });
  if (!myExams?.length) return res.json({ exam: null });

  const e = myExams[0];
  if (e.submitted) {
    // Return score + stripped questions (no correct_answer) for review — never return evaluation_key
    return res.json({ exam: {
      id: e.id, submitted: true,
      score: e.score,
      completedAt: e.completed_at,
      questions: (e.questions || []),  // already stripped at save time
    }});
  }
  if (new Date(e.expires_at) < new Date()) {
    return res.json({ exam: { expired: true, expiresAt: e.expires_at } });
  }
  // Pending: return ONLY metadata — questions are fetched via POST /api/exams/start
  return res.json({ exam: {
    id: e.id, submitted: false,
    questionCount: (e.questions || []).length,
    totalMarks: e.total_marks,
    sentAt: e.sent_at,
    expiresAt: e.expires_at,
  }});
});

// Applicant: fetch questions when they actively start the exam
app.post("/api/exams/start", authMW, async (req, res) => {
  if (req.user.role !== "user") return res.status(403).json({ detail: "Applicants only." });
  const { examId } = req.body;
  if (!examId) return res.status(422).json({ detail: "examId required." });

  const { data: exam, error } = await supabase
    .from("exams")
    .select("id, candidate_email, questions, expires_at, submitted, total_marks")
    .eq("id", examId)
    .maybeSingle();

  if (error || !exam) return res.status(404).json({ detail: "Exam not found." });

  if (exam.candidate_email !== req.user.email) return res.status(403).json({ detail: "This exam does not belong to your account." });

  if (exam.submitted) return res.status(400).json({ detail: "Exam already submitted." });
  if (new Date(exam.expires_at) < new Date()) return res.status(400).json({ detail: "Exam has expired." });
  if (!exam.questions?.length) return res.status(500).json({ detail: "No questions found for this exam. Please contact HR." });

  return res.json({ questions: exam.questions, totalMarks: exam.total_marks });
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

// HR: list all registered applicants eligible to receive an exam
app.get("/api/eligible-candidates", authMW, hrOnly, async (req, res) => {
  // Get all registered users with role=user
  const { data: users, error: uErr } = await supabase
    .from("users")
    .select("email, name")
    .eq("role", "user");
  if (uErr) return res.status(500).json({ detail: "Database error." });

  // Get emails that already have an active (non-expired, non-submitted) exam
  const now = new Date().toISOString();
  const { data: activeExams } = await supabase
    .from("exams")
    .select("candidate_email")
    .eq("submitted", false)
    .gt("expires_at", now);

  const busyEmails = new Set((activeExams || []).map(e => e.candidate_email));

  // Also get their latest application for position/status info
  const { data: apps } = await supabase
    .from("applications")
    .select("candidate_email, job_title, status")
    .order("uploaded_at", { ascending: false });

  const latestApp = {};
  for (const a of (apps || [])) {
    if (!latestApp[a.candidate_email]) latestApp[a.candidate_email] = a;
  }

  const eligible = (users || [])
    .filter(u => !busyEmails.has(u.email))
    .map(u => ({
      email:    u.email,
      name:     u.name,
      position: latestApp[u.email]?.job_title || 'No position',
      status:   latestApp[u.email]?.status    || 'registered',
    }));

  return res.json(eligible);
});

// HR: bulk send same exam to multiple candidates at once
app.post("/api/exams/send-bulk", authMW, hrOnly, async (req, res) => {
  // targets: [{email, applicationId?}]
  const { targets, jdText, expiryDays = EXAM_EXPIRY_DAYS } = req.body;
  if (!targets?.length) return res.status(422).json({ detail: "targets required." });
  const examJd = (jdText || "").trim();
  if (!examJd) return res.status(422).json({ detail: "Job description is required to generate questions." });

  // Generate questions ONCE for all candidates
  let questions, easyRaw, mediumRaw, hardRaw, totalMarks;
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const raw = await geminiChat({ systemPrompt: QUESTION_SYSTEM_PROMPT, userPrompt: buildQuestionPrompt(examJd), maxTokens: 8000, temperature: 0.7 });
      let data;
      try { data = JSON.parse(cleanJSON(raw)); } catch (e) { lastError = e; continue; }
      easyRaw   = (data.easy   || []).slice(0, 5);
      mediumRaw = (data.medium || []).slice(0, 5);
      hardRaw   = (data.hard   || []).slice(0, 5);
      questions = [...easyRaw, ...mediumRaw, ...hardRaw].map(normalizeOpts);
      if (!questions.length)                      { lastError = new Error("No questions generated."); continue; }
      if (questions.some(q => !q.correct_answer)) { lastError = new Error("Missing correct_answer."); continue; }
      totalMarks = easyRaw.length * 1 + mediumRaw.length * 2 + hardRaw.length * 3;
      break;
    } catch (e) { lastError = e; }
  }
  if (!questions) return res.status(500).json({ detail: `Question generation failed: ${lastError?.message}` });

  const strip = q => { const c = { ...q }; delete c.correct_answer; delete c.model_answer; return c; };
  const stripped = questions.map(strip);

  // Skip targets that already have an active exam
  const now = new Date();
  const { data: activeExams } = await supabase
    .from("exams").select("candidate_email")
    .eq("submitted", false).gt("expires_at", now.toISOString());
  const busyEmails = new Set((activeExams || []).map(e => e.candidate_email));

  // Bulk-fetch user_ids for all targets
  const emails = targets.map(t => (t.email || "").trim().toLowerCase()).filter(Boolean);
  const { data: userRows } = await supabase.from("users").select("id, email").in("email", emails);
  const userIdMap = Object.fromEntries((userRows || []).map(u => [u.email, u.id]));

  const sent = [], skipped = [];
  for (const target of targets) {
    const em = (target.email || "").trim().toLowerCase();
    if (!em) continue;
    if (busyEmails.has(em)) { skipped.push(em); continue; }

    const userId  = userIdMap[em] || target.userId || null;
    const examId = crypto.randomUUID();
    const { error: insertErr } = await supabase.from("exams").insert({
      id:              examId,
      ...(_schemaHasUserId && userId ? { user_id: userId } : {}),
      application_id:  target.applicationId || null,
      candidate_email: em,
      candidate_name:  target.name || em,
      questions:       stripped,
      evaluation_key:  questions,
      answers:         {},
      submitted:       false,
      score:           null,
      jd_text:         examJd,
      sent_at:         now.toISOString(),
      expires_at:      new Date(+now + expiryDays * 86400000).toISOString(),
      completed_at:    null,
      total_marks:     totalMarks,
      final_decision:  null,
    });
    if (insertErr) { skipped.push(em); continue; }

    // Update the application if applicationId provided, else find latest app by email
    if (target.applicationId) {
      await supabase.from("applications").update({ exam_id: examId, status: "exam_sent" }).eq("id", target.applicationId);
    } else {
      const { data: appRec } = await supabase.from("applications").select("id")
        .eq("candidate_email", em).order("uploaded_at", { ascending: false }).limit(1).maybeSingle();
      if (appRec?.id) await supabase.from("applications").update({ exam_id: examId, status: "exam_sent" }).eq("id", appRec.id);
    }
    sent.push(em);
    busyEmails.add(em); // prevent duplicate within this batch
  }

  return res.json({ sent: sent.length, skipped: skipped.length, sentEmails: sent, skippedEmails: skipped });
});

// HR: send exam directly to a registered user (batch analysis flow)
app.post("/api/exams/send-to-user", authMW, hrOnly, async (req, res) => {
  const { userEmail, jdText, expiryDays = EXAM_EXPIRY_DAYS } = req.body;
  if (!userEmail?.trim()) return res.status(422).json({ detail: "userEmail is required." });
  const em = userEmail.trim().toLowerCase();

  const { data: user, error: userErr } = await supabase
    .from("users")
    .select("id, email, name, role")
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
      const all       = [...easyRaw, ...mediumRaw, ...hardRaw].map(normalizeOpts);
      if (!all.length)                      { lastError = new Error("No questions generated."); continue; }
      if (all.some(q => !q.correct_answer)) { lastError = new Error("Missing correct_answer in some questions."); continue; }

      const strip  = q => { const c = { ...q }; delete c.correct_answer; delete c.model_answer; return c; };
      const now    = new Date();
      const examId = crypto.randomUUID();

      const { error: insertErr } = await supabase.from("exams").insert({
        id:              examId,
        ...(_schemaHasUserId && user.id ? { user_id: user.id } : {}),
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

      // Also update the most recent application for this candidate if one exists
      const { data: appRec } = await supabase
        .from("applications")
        .select("id")
        .eq("candidate_email", em)
        .order("uploaded_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (appRec?.id) {
        await supabase.from("applications").update({ exam_id: examId, status: "exam_sent" }).eq("id", appRec.id);
      }

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

// Lightweight migration that works via Supabase REST (no direct pg needed)
app.post("/api/migrate", authMW, hrOnly, async (_req, res) => {
  const steps = [];
  try {
    // Check if user_id column exists on applications by querying it
    const { error: colCheck } = await supabase.from("applications").select("user_id").limit(1);
    if (colCheck) {
      steps.push({ step: "user_id columns", status: "need_pg_migration", note: "Run GET /api/setup from Vercel deployment to add user_id columns via direct Postgres." });
    } else {
      steps.push({ step: "user_id columns", status: "already_exist" });
    }
    return res.json({ ok: true, steps });
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
    const atsData  = enrichATSData(data.ats || {});
    const atsScore = calculateATSScore(atsData);
    const aiScore  = parseInt(data.overall_score || 0);
    const combined = calculateCombinedScore(aiScore, atsScore);
    const result = {
      filename:             fname,
      candidate_name:       data.candidate_name       || "Unknown",
      overall_score:        aiScore,
      ai_score:             aiScore,
      ats_match_score:      combined,
      combined_score:       combined,
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
        combined_ats_score:    atsScore,
        matched_keywords:      atsData.matched_keywords      || [],
        missing_keywords:      atsData.missing_keywords      || [],
        keyword_match_pct:     parseInt(atsData.keyword_match_pct     || 0),
        keyword_match:         parseInt(atsData.keyword_match_pct     || 0),
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
      const atsData  = enrichATSData(data.ats || {});
      const atsScore = calculateATSScore(atsData);
      const aiScore  = parseInt(data.overall_score || 0);
      const combined = calculateCombinedScore(aiScore, atsScore);
      results.push({
        filename: fname, candidate_name: data.candidate_name || "Unknown",
        overall_score: aiScore, ai_score: aiScore, ats_match_score: combined, combined_score: combined, shortlisted: combined >= threshold,
        skills_match: parseInt(data.skills_match || 0), experience_match: parseInt(data.experience_match || 0),
        education_match: parseInt(data.education_match || 0), years_of_experience: data.years_of_experience ?? null,
        key_strengths: data.key_strengths || [], gaps: data.gaps || [],
        missing_requirements: data.missing_requirements || [], summary: data.summary || "",
        ats: {
          ats_score: atsScore, combined_ats_score: atsScore,
          matched_keywords: atsData.matched_keywords || [], missing_keywords: atsData.missing_keywords || [],
          keyword_match_pct: parseInt(atsData.keyword_match_pct || 0), keyword_match: parseInt(atsData.keyword_match_pct || 0),
          keyword_density_score: parseInt(atsData.keyword_density_score || 0),
          format_score: parseInt(atsData.format_score || 0), format_notes: atsData.format_notes || [],
        },
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
      const all = [...easyRaw, ...mediumRaw, ...hardRaw].map(normalizeOpts);
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
// All non-API routes serve the React SPA (React Router handles client-side routing)
app.get("*", (req, res) => {
  if (req.path.startsWith("/api")) return res.status(404).json({ error: "Not found" });
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

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
