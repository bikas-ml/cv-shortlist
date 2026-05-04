import { useState, useRef, useEffect } from 'react';
import {
  Chart, BarElement, CategoryScale, LinearScale,
  ArcElement, Tooltip, Legend,
} from 'chart.js';
import { Bar, Doughnut } from 'react-chartjs-2';
import { authHeadersFormData } from '../utils/auth';
import Header from '../components/Header';
import NeuralNetworkBg from '../components/NeuralNetworkBg';
import CandidateCard from '../components/CandidateCard';
import { useSimProgress, AIProgressBar } from '../utils/useSimProgress.jsx';

Chart.register(BarElement, CategoryScale, LinearScale, ArcElement, Tooltip, Legend);

/* ─── helpers ─── */
function fmtD(d) { return d ? new Date(d).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' }) : '—'; }

/* ─── CSV Export ─── */
function exportCSV(results) {
  const headers = [
    'Rank','Filename','Candidate Name','Combined Score','AI Score','ATS Score',
    'Shortlisted','Skills Match %','Experience Match %','Education Match %',
    'Years Experience','Keyword Match %','CV Format Score %',
    'Matched Keywords','Missing Keywords','Format Notes','Key Strengths','Gaps','Summary',
  ];
  const rows = results.map((r, i) => [
    i + 1,
    r.filename || '',
    r.candidate_name || '',
    r.combined_score || 0,
    r.ai_score || r.overall_score || 0,
    r.ats?.combined_ats_score || r.ats?.ats_score || 0,
    r.shortlisted ? 'Yes' : 'No',
    r.skills_match || 0,
    r.experience_match || 0,
    r.education_match || 0,
    r.years_of_experience || '',
    r.ats?.keyword_match || 0,
    r.ats?.format_score || 0,
    (r.ats?.matched_keywords || []).join(' | '),
    (r.ats?.missing_keywords  || []).join(' | '),
    (r.ats?.format_notes      || []).join(' | '),
    (r.key_strengths          || []).join(' | '),
    (r.gaps                   || []).join(' | '),
    (r.summary || '').replace(/\n/g, ' '),
  ]);
  const csv = [headers, ...rows].map(row =>
    row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')
  ).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const a = document.createElement('a'); a.href = url; a.download = 'cv_analysis.csv';
  a.click(); URL.revokeObjectURL(url);
}

/* ─── Exam modal (takes exam inline, no DB) ─── */
function ExamModal({ jd, candidateName, onClose }) {
  const [loading, setLoading]   = useState(true);
  const [questions, setQ]       = useState([]);
  const [evalKey, setEvalKey]   = useState([]);
  const [answers, setAnswers]   = useState({});
  const [result, setResult]     = useState(null);
  const [submitting, setSub]    = useState(false);
  const [showWarn, setShowWarn] = useState(false);
  const qProg = useSimProgress('questions');

  useEffect(() => {
    (async () => {
      qProg.start();
      const fd = new FormData(); fd.append('jd_text', jd);
      try {
        const res  = await fetch('/api/generate-questions', { method: 'POST', body: fd });
        const data = await res.json();
        qProg.finish();
        setQ(data.questions || []); setEvalKey(data.evaluation_key || []);
      } catch { qProg.reset(); alert('Failed to generate questions.'); onClose(); }
      finally { setLoading(false); }
    })();
  }, []);

  async function submitExam() {
    setShowWarn(false); setSub(true);
    const ansArr = Object.entries(answers).map(([qid, ans]) => ({ question_id: Number(qid), answer: ans }));
    try {
      const res  = await fetch('/api/submit-exam', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidate_name: candidateName, evaluation_key: evalKey, answers: ansArr }),
      });
      setResult(await res.json());
    } catch { alert('Submission failed.'); }
    finally { setSub(false); }
  }

  const bySection = (qs) => {
    const easy = qs.filter(q => q.difficulty === 'easy');
    const med  = qs.filter(q => q.difficulty === 'medium');
    const hard = qs.filter(q => q.difficulty === 'hard');
    return [['Section A — Easy (1 pt each)', easy], ['Section B — Medium (2 pts each)', med], ['Section C — Hard (3 pts each)', hard]];
  };

  const answered = Object.keys(answers).length;

  return (
    <div className="exam-modal" style={{ zIndex: 300 }}>
      <div className="exam-modal-inner" style={{ maxWidth: 760, margin: 'auto', padding: 24, overflowY: 'auto', maxHeight: '90vh' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div>
            <h2 style={{ fontSize: 19, fontWeight: 700 }}>{result ? '📊 Exam Results' : '📝 Examination'}</h2>
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Candidate: {candidateName}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {!result && !loading && <span style={{ fontSize: 13, color: 'var(--bkash-pink)', fontWeight: 600 }}>{answered} of {questions.length} answered</span>}
            <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer' }}>✕</button>
          </div>
        </div>

        {loading && (
          <div style={{ padding: '40px 0' }}>
            <div style={{ fontSize: 40, textAlign: 'center', marginBottom: 20 }}>🤖</div>
            <AIProgressBar progress={qProg.progress} label={qProg.label} />
            <p style={{ textAlign: 'center', fontSize: 13, color: 'var(--text-muted)', marginTop: 10 }}>
              Generating 15 exam questions — easy, medium &amp; hard…
            </p>
          </div>
        )}

        {!loading && result && <ExamResults result={result} />}

        {!loading && !result && (
          <>
            {bySection(questions).map(([title, qs]) => qs.length === 0 ? null : (
              <div key={title} style={{ marginBottom: 24 }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--bkash-pink)', marginBottom: 12, padding: '6px 12px', background: 'var(--bkash-pink-pale)', borderRadius: 8 }}>{title}</div>
                {qs.map((q, i) => (
                  <QuestionCard key={q.id} q={q} num={questions.indexOf(q) + 1} answer={answers[q.id]} onAnswer={ans => setAnswers(a => ({ ...a, [q.id]: ans }))} />
                ))}
              </div>
            ))}
            <button className="run-btn" style={{ width: '100%', marginTop: 8 }} onClick={() => setShowWarn(true)} disabled={submitting}>
              {submitting ? <><span className="spinner-sm" /> Grading…</> : '✅ Submit Exam'}
            </button>
          </>
        )}
      </div>

      {showWarn && (
        <div className="exam-warning-overlay" style={{ zIndex: 400 }}>
          <div style={{ background: '#fff', borderRadius: 16, padding: 32, maxWidth: 380, textAlign: 'center' }}>
            <div style={{ fontSize: 44, marginBottom: 10 }}>⚠️</div>
            <h3 style={{ marginBottom: 8 }}>Submit Exam?</h3>
            <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 20 }}>
              You have answered <strong>{answered}</strong> of <strong>{questions.length}</strong> questions. This cannot be undone.
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              <button className="run-btn" onClick={submitExam}>Yes, Submit</button>
              <button className="secondary-btn" onClick={() => setShowWarn(false)}>Go Back</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function QuestionCard({ q, num, answer, onAnswer }) {
  return (
    <div className="exam-q-card">
      <div className="exam-q-header">
        <span className="exam-q-num">Q{num}</span>
        <span className="exam-q-diff" data-diff={q.difficulty}>{q.difficulty}</span>
        <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 'auto' }}>{q.points} pt{q.points !== 1 ? 's' : ''}</span>
      </div>
      <p className="exam-q-text">{q.question}</p>
      <div className="exam-options">
        {Object.entries(q.options || {}).map(([k, v]) => (
          <button key={k} className={`exam-option ${answer === k ? 'selected' : ''}`} onClick={() => onAnswer(k)}>
            <span className="option-label">{k}</span>
            <span className="option-text">{v}</span>
          </button>
        ))}
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>○ Select one answer</div>
    </div>
  );
}

function ExamResults({ result }) {
  const sections = result.sections || [];
  const byDiff = {};
  (result.results || []).forEach(q => { (byDiff[q.difficulty] = byDiff[q.difficulty] || []).push(q); });

  return (
    <div>
      {/* Summary */}
      <div style={{ textAlign: 'center', background: 'var(--bkash-pink-pale)', borderRadius: 14, padding: '20px 24px', marginBottom: 24 }}>
        <div style={{ fontSize: 40, fontWeight: 800, color: 'var(--bkash-pink)' }}>
          {result.total_earned} / {result.total_max}
        </div>
        <div style={{ fontSize: 28, fontWeight: 700, color: result.percentage >= 80 ? '#10B981' : result.percentage >= 60 ? '#3B82F6' : result.percentage >= 40 ? '#F59E0B' : '#EF4444' }}>
          {result.percentage?.toFixed(1)}%
        </div>
        <div style={{ fontSize: 18, fontWeight: 600, marginTop: 4 }}>{result.grade}</div>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginTop: 12, flexWrap: 'wrap' }}>
          {sections.map(s => (
            <span key={s.difficulty} style={{ background: 'white', borderRadius: 20, padding: '4px 14px', fontSize: 13, fontWeight: 600 }}>
              {s.difficulty}: {s.earned}/{s.max} pts
            </span>
          ))}
        </div>
      </div>

      {/* Per-section questions */}
      {[['Section A — Easy', 'easy'], ['Section B — Medium', 'medium'], ['Section C — Hard', 'hard']].map(([title, diff]) =>
        (byDiff[diff] || []).length === 0 ? null : (
          <div key={diff} style={{ marginBottom: 20 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--bkash-pink)', marginBottom: 10, padding: '6px 12px', background: 'var(--bkash-pink-pale)', borderRadius: 8 }}>{title}</div>
            {(byDiff[diff] || []).map((q, i) => {
              const correct = q.earned > 0;
              const skipped = !q.given_answer;
              const borderColor = correct ? '#10B981' : skipped ? '#94a3b8' : '#EF4444';
              const feedbackBg  = correct ? '#ECFDF5' : skipped ? '#F1F5F9' : '#FEF2F2';
              const feedbackColor = correct ? '#065F46' : skipped ? '#475569' : '#991B1B';
              const feedback = correct
                ? `✅ Correct! You answered ${q.given_answer}`
                : skipped
                  ? `⏭ Not answered. Correct answer was ${q.correct_answer}`
                  : `❌ You answered ${q.given_answer} — incorrect. Correct: ${q.correct_answer}`;
              return (
                <div key={i} style={{ border: `1px solid var(--border)`, borderLeft: `4px solid ${borderColor}`, borderRadius: 10, padding: 14, marginBottom: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <span className="exam-q-diff" data-diff={q.difficulty}>{q.difficulty}</span>
                    <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>{q.question}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: correct ? '#10B981' : '#EF4444', flexShrink: 0 }}>{q.earned}/{q.points} pts</span>
                  </div>
                  {Object.entries(q.options || {}).map(([k, v]) => {
                    const isCorrect = k === q.correct_answer;
                    const isGiven   = k === q.given_answer;
                    let bg = '#fff'; let border = 'var(--border)'; let color = 'var(--text-primary)';
                    if (isCorrect)           { bg = '#ECFDF5'; border = '#10B981'; color = '#065F46'; }
                    else if (isGiven && !correct) { bg = '#FEF2F2'; border = '#EF4444'; color = '#991B1B'; }
                    return (
                      <div key={k} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '7px 12px', borderRadius: 8, border: `1.5px solid ${border}`, background: bg, marginBottom: 4, fontSize: 13 }}>
                        <span style={{ background: isCorrect ? '#10B981' : isGiven && !correct ? '#EF4444' : 'var(--border)', color: (isCorrect || (isGiven && !correct)) ? '#fff' : 'var(--text-muted)', borderRadius: 4, padding: '1px 7px', fontWeight: 700, fontSize: 11 }}>{k}</span>
                        <span style={{ color }}>{v}</span>
                        {isCorrect && <span style={{ marginLeft: 'auto', fontSize: 11, color: '#10B981', fontWeight: 600 }}>✓ Correct</span>}
                      </div>
                    );
                  })}
                  <div style={{ marginTop: 8, padding: '8px 12px', borderRadius: 8, background: feedbackBg, color: feedbackColor, fontSize: 13 }}>{feedback}</div>
                </div>
              );
            })}
          </div>
        )
      )}
      <div style={{ textAlign: 'center', padding: '12px 0', fontWeight: 700, color: 'var(--text-secondary)', fontSize: 14, borderTop: '1px solid var(--border)' }}>
        Final Score: {result.total_earned} / {result.total_max} pts · {result.percentage?.toFixed(1)}% · {result.grade}
      </div>
    </div>
  );
}

export { ExamResults, QuestionCard };

/* ─── Main ATS Page ─── */
export default function ATS() {
  const [jd, setJd]           = useState('');
  const [file, setFile]       = useState(null);
  const [threshold, setThr]   = useState(70);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError]     = useState('');
  const [tab, setTab]         = useState('all');
  const [dragOver, setDragOver] = useState(false);
  const [online, setOnline]   = useState(true);
  const fileRef = useRef();
  const cvProg = useSimProgress('cv');

  // Exam state
  const [examOpen, setExamOpen]   = useState(false);
  const [examCand, setExamCand]   = useState('');

  // Health check
  useEffect(() => {
    async function check() {
      try { const r = await fetch('/api/health'); setOnline(r.ok); } catch { setOnline(false); }
    }
    check();
    const t = setInterval(check, 10000);
    return () => clearInterval(t);
  }, []);

  async function runScreening() {
    if (!jd.trim()) { setError('Please enter a job description.'); return; }
    if (!file)      { setError('Please upload a CV.'); return; }
    setError(''); setLoading(true); setResults(null);
    cvProg.start();
    const fd = new FormData();
    fd.append('cv', file);
    fd.append('jd_text', jd);
    fd.append('threshold', threshold);
    try {
      const res  = await fetch('/api/shortlist', { method: 'POST', body: fd });
      const data = await res.json();
      cvProg.finish();
      if (!res.ok) { setError(data.error || 'Analysis failed.'); return; }
      setResults(data); setTab('all');
    } catch { cvProg.reset(); setError('Network error.'); }
    finally { setLoading(false); }
  }

  const filtered = results ? results.results.filter(r => {
    if (tab === 'shortlisted') return r.shortlisted;
    if (tab === 'rejected')    return !r.shortlisted;
    return true;
  }) : [];

  const avgAts = results
    ? Math.round((results.results || []).reduce((s, r) => s + (r.ats?.combined_ats_score || 0), 0) / (results.results.length || 1))
    : 0;

  // Bar chart
  const barData = results ? {
    labels: results.results.map((r, i) => r.candidate_name || `CV ${i + 1}`),
    datasets: [
      { label: 'AI Score',       data: results.results.map(r => r.ai_score || r.overall_score || 0), backgroundColor: '#8B5CF6' },
      { label: 'ATS Score',      data: results.results.map(r => r.ats?.combined_ats_score || 0),     backgroundColor: '#00B4D8' },
      { label: 'Combined Score', data: results.results.map(r => r.combined_score || 0),               backgroundColor: '#10B981' },
    ],
  } : null;

  // Doughnut chart — keyword coverage (first result)
  const firstResult = results?.results?.[0];
  const dMatched = firstResult?.ats?.matched_keywords?.length || 0;
  const dMissing = firstResult?.ats?.missing_keywords?.length  || 0;
  const dTotal   = dMatched + dMissing;
  const dCoverage = dTotal > 0 ? Math.round((dMatched / dTotal) * 100) : 0;
  const doughnutData = firstResult ? {
    labels: ['Matched Keywords', 'Missing Keywords'],
    datasets: [{ data: [dMatched, dMissing], backgroundColor: ['#10B981', '#EF4444'], borderWidth: 0 }],
  } : null;

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      <NeuralNetworkBg />
      <div style={{ position: 'relative', zIndex: 1 }}>
        <Header showNav />
        <div className="app-layout">

          {/* Sidebar */}
          <aside className="sidebar">
            {/* Status dot */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 16, fontSize: 13 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: online ? '#10B981' : '#EF4444', display: 'inline-block' }} />
              <span style={{ color: 'var(--text-muted)' }}>{online ? 'Sysnova AI · Online' : 'API Offline'}</span>
            </div>

            <div className="sidebar-section">
              <label className="form-label">📋 Job Description</label>
              <textarea className="jd-textarea" rows={8} placeholder="Paste the job description here…" value={jd} onChange={e => setJd(e.target.value)} />
            </div>

            <div className="sidebar-section">
              <label className="form-label">📄 Upload CV (PDF)</label>
              <div
                className={`dropzone ${dragOver ? 'dragover' : ''}`}
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f?.type === 'application/pdf') setFile(f); }}
                onClick={() => fileRef.current.click()}
                style={{ minHeight: 80, fontSize: 13 }}
              >
                {file
                  ? <><div style={{ fontSize: 28 }}>📄</div><div style={{ fontWeight: 600, wordBreak: 'break-all', fontSize: 12 }}>{file.name}</div><div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{Math.round(file.size / 1024)} KB</div></>
                  : <><div style={{ fontSize: 28 }}>☁️</div><div>Drag PDF or click to browse</div><div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>PDF only · max 20 MB</div></>
                }
                <input ref={fileRef} type="file" accept=".pdf" hidden onChange={e => { if (e.target.files[0]) setFile(e.target.files[0]); }} />
              </div>
              {file && <button onClick={() => { setFile(null); fileRef.current.value = ''; }} style={{ marginTop: 6, fontSize: 12, color: '#EF4444', background: 'none', border: 'none', cursor: 'pointer' }}>✕ Remove</button>}
            </div>

            <div className="sidebar-section">
              <label className="form-label">🎯 Shortlist Threshold: <strong style={{ color: 'var(--bkash-pink)' }}>{threshold}%</strong></label>
              <input type="range" className="threshold-slider" min={0} max={100} step={5} value={threshold} onChange={e => setThr(Number(e.target.value))} />
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Combined score ≥ {threshold}% = Shortlisted</div>
            </div>

            <div className="sidebar-section" style={{ background: 'var(--surface-2)', borderRadius: 8, padding: '10px 12px', fontSize: 12, color: 'var(--text-muted)' }}>
              <strong style={{ color: 'var(--text-secondary)' }}>Scoring Formula</strong><br />
              AI Score × 50% + ATS Score × 50%<br />
              ATS = Keywords(60%) + Density(25%) + Format(15%)
            </div>

            {error && <div className="auth-error">{error}</div>}
            <button className="run-btn" onClick={runScreening} disabled={loading || !online}>
              {loading ? <><span className="spinner-sm" /> Analysing…</> : '🚀 Run Screening'}
            </button>
          </aside>

          {/* Results area */}
          <main className="results-area">
            {!results && !loading && (
              <div className="empty-state">
                <div style={{ fontSize: 64 }}>🤖</div>
                <h3>ATS Dashboard</h3>
                <p>Upload a CV and job description, then click Run Screening to analyse.</p>
              </div>
            )}

            {loading && (
              <div style={{ padding: '48px 24px' }}>
                <div style={{ fontSize: 48, textAlign: 'center', marginBottom: 24 }}>🤖</div>
                <AIProgressBar progress={cvProg.progress} label={cvProg.label} />
                <p style={{ textAlign: 'center', fontSize: 13, color: 'var(--text-muted)', marginTop: 8 }}>
                  AI is evaluating the CV against your job description…
                </p>
              </div>
            )}

            {results && (
              <>
                {/* Stats */}
                <div className="stats-row">
                  {[
                    ['📄 Total CVs', results.total],
                    ['✅ Shortlisted', results.shortlisted],
                    ['❌ Rejected', results.rejected],
                    ['📊 Avg ATS Score', avgAts + '%'],
                  ].map(([l, v]) => (
                    <div key={l} className="stat-card"><div className="stat-val">{v}</div><div className="stat-label">{l}</div></div>
                  ))}
                </div>

                {/* Charts */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 16, marginBottom: 16 }}>
                  <div style={{ background: 'var(--surface)', borderRadius: 12, padding: 16 }}>
                    <h4 style={{ marginBottom: 12, fontSize: 13, color: 'var(--text-secondary)' }}>Score Comparison</h4>
                    <Bar data={barData} options={{
                      responsive: true,
                      plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 12 } } } },
                      scales: {
                        x: { grid: { display: false }, ticks: { maxRotation: 30 } },
                        y: { min: 0, max: 100, grid: { display: false } },
                      },
                    }} />
                  </div>
                  <div style={{ background: 'var(--surface)', borderRadius: 12, padding: 16 }}>
                    <h4 style={{ marginBottom: 12, fontSize: 13, color: 'var(--text-secondary)' }}>Keyword Coverage</h4>
                    <Doughnut data={doughnutData} options={{
                      responsive: true, cutout: '68%',
                      plugins: { legend: { display: false } },
                    }} />
                    {/* Custom legend */}
                    <div style={{ marginTop: 12, fontSize: 12 }}>
                      {[['#10B981', `✓ Matched: ${dMatched}`], ['#EF4444', `✗ Missing: ${dMissing}`]].map(([c, label]) => (
                        <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                          <span style={{ width: 10, height: 10, borderRadius: '50%', background: c, display: 'inline-block', flexShrink: 0 }} />
                          <span style={{ color: 'var(--text-muted)' }}>{label}</span>
                        </div>
                      ))}
                      <div style={{ marginTop: 6, fontWeight: 700, color: dCoverage >= 70 ? '#10B981' : dCoverage >= 45 ? '#F59E0B' : '#EF4444' }}>
                        Coverage: {dCoverage}%
                      </div>
                    </div>
                  </div>
                </div>

                {/* Export button */}
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
                  <button className="secondary-btn" onClick={() => exportCSV(results.results)}>📥 Export CSV</button>
                </div>

                {/* Tabs */}
                <div className="tab-bar">
                  {[
                    ['all',         `All (${results.total})`],
                    ['shortlisted', `✅ Shortlisted (${results.shortlisted})`],
                    ['rejected',    `❌ Rejected (${results.rejected})`],
                  ].map(([key, label]) => (
                    <button key={key} className={`tab-btn ${tab === key ? 'active' : ''}`} onClick={() => setTab(key)}>{label}</button>
                  ))}
                </div>

                {filtered.map((r, i) => (
                  <CandidateCard
                    key={i}
                    r={r}
                    rank={filtered.indexOf(r) + 1}
                    examLabel="🎓 Take Exam"
                    onExam={r.shortlisted ? () => { setExamCand(r.candidate_name || `Candidate ${i+1}`); setExamOpen(true); } : null}
                    showExamBtn
                  />
                ))}
              </>
            )}
          </main>
        </div>
      </div>

      {examOpen && (
        <ExamModal
          jd={jd}
          candidateName={examCand}
          onClose={() => setExamOpen(false)}
        />
      )}
    </div>
  );
}
