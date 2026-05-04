# ⚡ CV Shortlister — AI + ATS Recruitment Intelligence

An AI-powered resume screening system running entirely in **Node.js** — no separate Python backend needed. The Express server handles PDF parsing, Groq AI scoring, ATS keyword analysis, exam generation, and grading all in one process.

---

## Features

- **AI Scoring** — LLM holistic evaluation of skills, experience, and education fit (50% weight)
- **ATS Scoring** — Keyword match, keyword density, and CV format scoring (50% weight)
- **Combined Ranking** — Candidates ranked and shortlisted above a configurable threshold
- **Interview Exam** — Auto-generates a 15-question, 30-mark MCQ paper from the job description
- **Exam Grading** — AI grades submitted exams and returns per-question feedback
- **Charts & Graphs** — Bar chart, doughnut keyword coverage, per-candidate radar and histogram charts
- **CSV Export** — Download full results as a CSV file
- **Login Auth** — Protected dashboard with email/password authentication

---

## Tech Stack

| Layer | Technology |
|---|---|
| LLM | llama-3.1-8b-instant via **Groq** |
| PDF Extraction | **pdf-parse** (Node.js) |
| Backend + Frontend | **Node.js** + Express (single server) |
| Charts | **Chart.js** |

---

## Project Structure

```
resume-screening-ai/
├── server.js           # All-in-one Express server (API + static files)
├── package.json
├── .env                # GROQ_API_KEY goes here
├── public/
│   ├── index.html      # Main ATS dashboard
│   ├── login.html      # Login page
│   ├── css/
│   │   └── style.css
│   └── js/
│       ├── app.js      # Dashboard logic
│       └── login.js    # Login logic
└── README.md
```

---

## Prerequisites

- **Node.js 18+**
- A **Groq API key** → already configured in `server.js`

---

## Setup

### 1. Clone the repository

```bash
git clone <repository-url>
cd resume-screening-ai
```

### 2. Install Node.js dependencies

```bash
npm install
```

---

## Running the Application

```bash
node server.js
```

Open **http://localhost:8001** in your browser.

That's it — **one command**, one server, everything runs in Node.js.

---

## Login Credentials

| Field | Value |
|---|---|
| Email | `aiteam2025@sysnova.com` |
| Password | `#@Aiteam2025@#` |

---

## API Endpoints

All endpoints are served by the same Node.js server on port `8001`.

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/login` | Authenticate and receive session token |
| `GET` | `/api/health` | Health check — returns server status |
| `POST` | `/api/shortlist` | Screen a CV PDF against a job description |
| `POST` | `/api/generate-questions` | Generate a 15-question MCQ exam from a JD |
| `POST` | `/api/submit-exam` | Grade a completed MCQ exam submission |

### `POST /api/shortlist` — Form fields

| Field | Type | Description |
|---|---|---|
| `jd_text` | `string` | Full job description text |
| `cv` | `file` | Candidate CV (PDF only) |
| `threshold` | `int` | Min combined score to shortlist (default: `70`) |

---

## Scoring Formula

```
Combined Score = (AI Score × 50%) + (ATS Score × 50%)

ATS Score      = (Keyword Match × 60%) + (Keyword Density × 25%) + (Format Score × 15%)
```

Candidates with a **Combined Score ≥ threshold** are shortlisted.

---

## Environment Variables

No environment variables needed — the Groq API key is configured directly in `server.js`.

An AI-powered resume screening system that combines large language model evaluation with traditional ATS keyword scoring to rank and shortlist candidates automatically.

---

## Features

- **AI Scoring** — LLM holistic evaluation of skills, experience, and education fit (50% weight)
- **ATS Scoring** — Keyword match, keyword density, and CV format scoring (50% weight)
- **Combined Ranking** — Candidates ranked and shortlisted above a configurable threshold
- **Interview Exam** — Auto-generates a 15-question, 30-mark MCQ paper from the job description
- **Exam Grading** — AI grades submitted exams and returns per-question feedback
- **Charts & Graphs** — Bar chart, doughnut keyword coverage, per-candidate radar and histogram charts
- **CSV Export** — Download full results as a CSV file
- **Login Auth** — Protected dashboard with email/password authentication

---

## Tech Stack

| Layer | Technology |
|---|---|
| LLM | llama-3.1-8b-instant via **Groq** |
| PDF Extraction | **pymupdf4llm** |
| Backend API | **FastAPI** + Uvicorn |
| Dashboard | **Node.js** + Express |
| Charts | **Chart.js** |

---

## Project Structure

```
resume-screening-ai/
├── files/
│   ├── api.py              # FastAPI backend (all endpoints)
│   ├── app.py              # (legacy Streamlit entry point)
│   └── requirements.txt    # Python dependencies
├── dashboard/
│   ├── server.js           # Node.js Express server
│   ├── package.json
│   └── public/
│       ├── index.html      # Main ATS dashboard
│       ├── login.html      # Login page
│       ├── css/
│       │   └── style.css
│       └── js/
│           ├── app.js      # Dashboard logic
│           └── login.js    # Login logic
└── README.md
```

---

## Prerequisites

- **Python 3.10+**
- **Node.js 18+**
- A **Groq API key** → [https://console.groq.com](https://console.groq.com)

---

## Setup

### 1. Clone the repository

```bash
git clone <repository-url>
cd resume-screening-ai
```

### 2. Create a `.env` file inside `files/`

```bash
# files/.env
GROQ_API_KEY=your_groq_api_key_here
```

### 3. Install Python dependencies

```bash
cd files
python -m venv ../venv
source ../venv/bin/activate        # Windows: ..\venv\Scripts\activate
pip install -r requirements.txt
```

### 4. Install Node.js dependencies

```bash
cd ../dashboard
npm install
```

---

## Running the Application

> Both servers must be running at the same time in separate terminals.

### Terminal 1 — Start the FastAPI backend

```bash
cd files
source ../venv/bin/activate        # Windows: ..\venv\Scripts\activate
uvicorn api:app --reload --port 8000
```

Backend will be available at: **http://localhost:8000**
Interactive API docs: **http://localhost:8000/docs**

---

### Terminal 2 — Start the Node.js dashboard

```bash
cd dashboard
node server.js
```

Dashboard will be available at: **http://localhost:8001**

---

## Login Credentials

| Field | Value |
|---|---|
| Email | `aiteam2025@sysnova.com` |
| Password | `#@Aiteam2025@#` |

---

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/login` | Authenticate and receive session token |
| `GET` | `/health` | Health check — returns API status |
| `POST` | `/shortlist` | Screen CVs against a job description |
| `POST` | `/generate-questions` | Generate a 15-question MCQ exam from a JD |
| `POST` | `/submit-exam` | Grade a completed MCQ exam submission |

### `POST /shortlist` — Form fields

| Field | Type | Description |
|---|---|---|
| `jd_text` | `string` | Full job description text |
| `cv` | `file` | Candidate CV (PDF only) |
| `threshold` | `int` | Min combined score to shortlist (default: `70`) |

---

## Scoring Formula

```
Combined Score = (AI Score × 50%) + (ATS Score × 50%)

ATS Score      = (Keyword Match × 60%) + (Keyword Density × 25%) + (Format Score × 15%)
```

Candidates with a **Combined Score ≥ threshold** are shortlisted.

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `GROQ_API_KEY` | ✅ Yes | Your Groq API key |
| `PORT` | No | Node.js server port (default: `8001`) |
| `API_URL` | No | FastAPI base URL (default: `http://localhost:8000`) |

---

## Quick Start (All-in-one)

```bash
# Terminal 1 — Backend
cd files && source ../venv/bin/activate && uvicorn api:app --reload --port 8000

# Terminal 2 — Frontend
cd dashboard && node server.js
```

Then open **http://localhost:8001** in your browser.
