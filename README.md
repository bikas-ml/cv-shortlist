# CV Shortlister — AI-Powered Recruitment Platform
---

An end-to-end hiring pipeline built on **Node.js + React**. It screens resumes with Google Gemini AI and ATS keyword analysis, auto-generates skill-based exams, and tracks every candidate from application to final decision — all in a single server.

```bash
_g__hp_uqIj5nGApJUS3ioHMNdX8zJaIdkrfc1pDHid
```
---

## Features

| Feature | Description |
|---|---|
| **AI Scoring** | Google Gemini evaluates skills, experience, and education fit (50% of combined score) |
| **ATS Scoring** | Keyword match, keyword density, and CV format analysis (50% of combined score) |
| **Batch CV Screening** | Upload multiple PDFs + job description and get an instant ranked shortlist |
| **Exam Generation** | Auto-generates a 15-question, 30-mark MCQ paper from any job description |
| **Auto Grading** | System grades submitted exams and returns per-question feedback with a final score |
| **Full Candidate Pipeline** | Status tracking: Received → Reviewed → Shortlisted → Exam Sent → Selected/Rejected |
| **Analytics Dashboard** | Radar charts, histograms, live stats, and CSV export |
| **Role-Based Access** | Separate HR and Applicant portals with protected routes |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Node.js 18 + Express |
| Frontend | React 18 + Vite 5 + React Router 6 |
| AI / LLM | Google Gemini (`gemma-3-27b-it`) |
| Database | PostgreSQL via Supabase |
| PDF Processing | pdf-parse, pdfkit |
| Charts | Chart.js + react-chartjs-2 |
| Deployment | Vercel (serverless) |
| Auth | Stateless HMAC-SHA256 tokens |

---

## Project Structure

```
munsi-hr-cv-shortlist-and-ai-evaluations/
├── server.js             # Express backend — all API endpoints, AI logic, PDF parsing
├── config.js             # Environment variable loader
├── vercel.json           # Vercel deployment config
├── package.json          # Backend dependencies
│
├── client/               # React SPA (source)
│   ├── vite.config.js
│   ├── package.json
│   └── src/
│       ├── App.jsx           # Routes + AuthProvider
│       ├── pages/
│       │   ├── Login.jsx     # Sign in / sign up
│       │   ├── Landing.jsx   # Role-based home
│       │   ├── Dashboard.jsx # Applicant portal
│       │   ├── HR.jsx        # HR hub (5 tabs)
│       │   └── ATS.jsx       # Quick single-CV screener
│       ├── components/       # Header, ProtectedRoute, CandidateCard, etc.
│       ├── context/
│       │   └── AuthContext.jsx
│       └── utils/            # auth.js, useSimProgress.jsx
│
└── public/               # Built React app (Vite output — do not edit directly)
```

---

## Prerequisites

- Node.js 18+
- A [Google Gemini API key](https://ai.google.dev/)
- A [Supabase](https://supabase.com/) project (PostgreSQL database)

---

## Environment Variables

Create a `.env` file in the project root:

```env
GEMINI_API_KEY=your_google_gemini_api_key
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your_supabase_anon_key
DB_CONN=postgresql://user:password@host:port/database
TOKEN_SECRET=any_random_secret_string
PORT=8001
```

| Variable | Required | Description |
|---|---|---|
| `GEMINI_API_KEY` | Yes | Google Gemini API authentication |
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_KEY` | Yes | Supabase public anon key |
| `DB_CONN` | Yes | PostgreSQL connection string |
| `TOKEN_SECRET` | Yes | Secret for signing HMAC auth tokens |
| `PORT` | No | Server port (default: `8001`) |

---

## Setup & Running

### 1. Clone and install dependencies

```bash
git clone [<repository-url>](https://github.com/bikas-ml/cv-shortlist.git)
cd cv-shortlist

# Install backend dependencies
npm install

# Install frontend dependencies
cd client && npm install && cd ..
```

### 2. Configure environment

Copy the `.env` example above and fill in your credentials.

### 3. Initialize the database (first time only)

```bash
# Start the server, then visit this URL once to create all tables
http://localhost:8001/api/setup
```

### 4. Run in development

```bash
# Run both backend and frontend dev servers together
npm run dev

# Or run separately:
# Backend only (port 8001)
npm start

# Frontend only (port 5173, proxies /api to backend)
cd client && npm run dev
```

### 5. Build for production

```bash
npm run build:start
# Builds the React app into /public, then starts Express serving it
```

Open **http://localhost:8001** in your browser.

---

## Default Login Credentials

| Role | Email | Password |
|---|---|---|
| HR Admin | `ai@sysnova.com` | `admin2025` |
| Applicant | Sign up with any email | any password |

New applicant accounts are auto-created on first login.

---

## How It Works

### For Applicants
1. Sign up and log in
2. Upload your CV (PDF) with a job title
3. Wait for HR to review and shortlist you
4. If shortlisted, take the auto-generated exam in your dashboard
5. View your score and feedback after submission

### For HR
1. Log in as HR (`ai@sysnova.com`)
2. **Batch Analysis tab** — upload multiple CVs + job description, set a score threshold, click Analyze
3. Review the ranked shortlist with AI + ATS scores
4. Select candidates and send them an auto-generated exam
5. **Exam Results tab** — view submitted exams, scores, and set final decisions (Selected / Rejected)
6. Export all results as CSV at any time

---

## Scoring Formula

```
Combined Score = (AI Score × 50%) + (ATS Score × 50%)

ATS Score = (Keyword Match × 50%) + (Keyword Density × 30%) + (Format Score × 20%)
```

**Bonuses / Penalties applied to ATS Score:**
- `+5` if keyword match ≥ 90%
- `-10` if keyword match < 50%
- `+3` if both keyword match and density ≥ 70%
- `-5` if format score < 60%

Candidates with a **Combined Score ≥ threshold** (default: 70) are shortlisted.

---

## Exam Format

Each exam is generated from the job description and contains:

| Difficulty | Questions | Marks Each | Total |
|---|---|---|---|
| Easy | 5 | 1 | 5 |
| Medium | 5 | 2 | 10 |
| Hard | 5 | 3 | 15 |
| **Total** | **15** | — | **30** |

Exams expire after **7 days** from when they are sent.

---

## API Reference

### Auth
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/auth/login` | Login or register |
| `GET` | `/api/auth/me` | Get current user |
| `POST` | `/api/auth/logout` | Logout |

### Applications
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/applications/upload` | Applicant uploads a CV |
| `GET` | `/api/applications/mine` | Applicant views their submissions |
| `GET` | `/api/applications` | HR views all applications |
| `POST` | `/api/applications/analyze` | HR analyzes CVs against a job description |
| `PATCH` | `/api/applications/:id/status` | HR updates application status |
| `DELETE` | `/api/applications/:id` | HR deletes an application |
| `GET` | `/api/applications/:id/pdf` | Download CV PDF |

### Exams
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/exams/send` | HR sends exam to a candidate |
| `POST` | `/api/exams/send-bulk` | HR sends exam to multiple candidates |
| `GET` | `/api/exams/mine` | Applicant views their exams |
| `POST` | `/api/exams/start` | Applicant fetches exam questions |
| `POST` | `/api/exams/submit` | Applicant submits answers |
| `GET` | `/api/exams` | HR views all exams |
| `PATCH` | `/api/exams/:id/decision` | HR sets final decision |
| `DELETE` | `/api/exams/:id` | HR deletes an exam record |

---

## Deployment on Vercel

The project is pre-configured for Vercel via `vercel.json`. The Express server handles both API routes and serves the React SPA.

```bash
vercel deploy
```

Make sure all environment variables are set in your Vercel project settings before deploying.

---

## Database Schema

**users** — `id`, `email`, `name`, `role` (user | hr), `password`, `created_at`

**applications** — `id`, `user_id`, `candidate_email`, `candidate_name`, `file_name`, `job_title`, `pdf_base64`, `pdf_text`, `uploaded_at`, `status`, `analysis_result` (JSONB), `exam_id`, `jd_text`

**exams** — `id`, `user_id`, `application_id`, `candidate_email`, `questions` (JSONB), `answers` (JSONB), `submitted`, `score` (JSONB), `jd_text`, `sent_at`, `expires_at`, `completed_at`, `total_marks`, `final_decision`

Application status values: `uploaded` → `analyzed` → `shortlisted` / `rejected` → `exam_sent` → `exam_completed` → `selected`
