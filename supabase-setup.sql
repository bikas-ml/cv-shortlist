-- ============================================================
-- Sysnova ATS — Supabase Database Setup
-- Run this ONCE in your Supabase SQL Editor:
--   https://supabase.com/dashboard/project/mgziwxtlpnyjrgyyuvee/sql/new
-- ============================================================

-- Users table (sign up / sign in)
CREATE TABLE IF NOT EXISTS users (
  id         UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  email      TEXT        UNIQUE NOT NULL,
  name       TEXT        NOT NULL,
  role       TEXT        NOT NULL DEFAULT 'user',
  password   TEXT        NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Applications table (CV uploads + AI analysis results)
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

-- Exams table (generated questions + candidate answers + scores)
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

-- Seed default HR admin user (runs only if email doesn't already exist)
INSERT INTO users (email, name, role, password)
VALUES ('ai@sysnova.com', 'HR Admin', 'hr', 'admin2025')
ON CONFLICT (email) DO NOTHING;

-- Helper RPC function called by the "Clear All Data" button in HR dashboard
CREATE OR REPLACE FUNCTION truncate_all_data()
RETURNS json AS $$
BEGIN
  DELETE FROM exams;
  DELETE FROM applications;
  RETURN json_build_object('ok', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
