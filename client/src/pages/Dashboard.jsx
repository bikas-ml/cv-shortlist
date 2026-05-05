import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { authHeaders, authHeadersFormData } from '../utils/auth';
import NeuralNetworkBg from '../components/NeuralNetworkBg';
import Header from '../components/Header';
import { useSimProgress, AIProgressBar } from '../utils/useSimProgress.jsx';

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function getTimeLeft(expiresAt) {
  const diff = new Date(expiresAt) - Date.now();
  if (diff <= 0) return { label: 'Expired', urgent: true };
  const days = Math.floor(diff / 86400000);
  const hrs  = Math.floor((diff % 86400000) / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  const label = days > 0 ? `${days}d ${hrs}h remaining` : `${hrs}h ${mins}m remaining`;
  return { label, urgent: days === 0 && hrs < 4 };
}

const STATUS_MAP = {
  uploaded:       { icon: '⏳', label: 'Received',         color: '#64748b', desc: 'Your CV has been received and is awaiting HR review.' },
  analyzed:       { icon: '🔍', label: 'Under Review',     color: '#3b82f6', desc: 'HR is reviewing your application.' },
  shortlisted:    { icon: '✅', label: 'Shortlisted',      color: '#22c55e', desc: "You've been shortlisted! You may receive an exam soon." },
  rejected:       { icon: '❌', label: 'Not Selected',     color: '#ef4444', desc: 'Thank you for applying. You were not selected for this role.' },
  exam_sent:      { icon: '📝', label: 'Exam Available',   color: '#f59e0b', desc: 'You have an exam waiting. Please complete it before the deadline.' },
  exam_completed: { icon: '🏆', label: 'Exam Submitted',   color: '#8b5cf6', desc: 'Your exam has been submitted. HR is reviewing your result.' },
  selected:       { icon: '🎉', label: 'Selected!',        color: '#22c55e', desc: 'Congratulations! You have been selected for this role.' },
};

/* ─── Question card ─── */
function QuestionCard({ q, num, answer, onAnswer, disabled = false }) {
  return (
    <div className="exam-q-card">
      <div className="exam-q-header">
        <span className="exam-q-num">Q{num}</span>
        <span className="exam-q-diff" data-diff={q.difficulty}>{q.difficulty}</span>
        <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 'auto' }}>{q.points} pt{q.points !== 1 ? 's' : ''}</span>
      </div>
      <p className="exam-q-text">{q.question}</p>
      <div className="exam-options">
        {(Array.isArray(q.options) ? q.options.map(o => [o.label, o.text]) : Object.entries(q.options || {})).map(([k, v]) => (
          <button
            key={k}
            className={`exam-option ${answer === k ? 'selected' : ''}`}
            onClick={() => !disabled && onAnswer && onAnswer(k)}
            disabled={disabled}
            style={disabled ? { cursor: 'default', opacity: 0.85 } : {}}
          >
            <span className="option-label">{k}</span>
            <span className="option-text">{v}</span>
          </button>
        ))}
      </div>
      {!disabled && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>○ Select one answer</div>}
    </div>
  );
}

/* ─── Exam results view ─── */
function ExamResultView({ exam }) {
  const score = exam.score || {};
  const evalKey = exam.evaluationKey || [];
  const byDiff = {};
  (score.results || []).forEach(q => { (byDiff[q.difficulty] = byDiff[q.difficulty] || []).push(q); });

  const pctColor = score.percentage >= 80 ? '#10B981' : score.percentage >= 60 ? '#3B82F6' : score.percentage >= 40 ? '#F59E0B' : '#EF4444';

  return (
    <div>
      {/* Summary */}
      <div style={{ textAlign: 'center', background: 'var(--bkash-pink-pale)', borderRadius: 14, padding: '20px 24px', marginBottom: 20 }}>
        <div style={{ fontSize: 36, fontWeight: 800, color: 'var(--bkash-pink)' }}>{score.totalEarned} / {score.totalMax}</div>
        <div style={{ fontSize: 26, fontWeight: 700, color: pctColor }}>{score.percentage?.toFixed(1)}%</div>
        <div style={{ fontSize: 17, fontWeight: 600, marginTop: 4 }}>{score.grade}</div>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
          {(score.sections || []).map(s => (
            <span key={s.difficulty} style={{ background: 'white', borderRadius: 20, padding: '3px 12px', fontSize: 12, fontWeight: 600 }}>
              {s.difficulty}: {s.earned}/{s.max} pts
            </span>
          ))}
        </div>
      </div>

      {/* Per section */}
      {[['Section A — Easy', 'easy'], ['Section B — Medium', 'medium'], ['Section C — Hard', 'hard']].map(([title, diff]) =>
        (byDiff[diff] || []).length === 0 ? null : (
          <div key={diff} style={{ marginBottom: 18 }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--bkash-pink)', marginBottom: 8, padding: '5px 10px', background: 'var(--bkash-pink-pale)', borderRadius: 7 }}>{title}</div>
            {(byDiff[diff] || []).map((q, i) => {
              const correct = q.earned > 0;
              const skipped = !q.given_answer;
              const borderColor = correct ? '#10B981' : skipped ? '#94a3b8' : '#EF4444';
              const feedbackBg = correct ? '#ECFDF5' : skipped ? '#F1F5F9' : '#FEF2F2';
              const feedbackColor = correct ? '#065F46' : skipped ? '#475569' : '#991B1B';
              const feedback = correct
                ? `✅ Correct! You answered ${q.given_answer}`
                : skipped
                  ? `⏭ Not answered. Correct answer was ${q.correct_answer}`
                  : `❌ You answered ${q.given_answer} — incorrect. Correct: ${q.correct_answer}`;
              return (
                <div key={i} style={{ border: '1px solid var(--border)', borderLeft: `4px solid ${borderColor}`, borderRadius: 10, padding: 12, marginBottom: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <span className="exam-q-diff" data-diff={q.difficulty}>{q.difficulty}</span>
                    <span style={{ fontWeight: 600, fontSize: 13, flex: 1 }}>{q.question}</span>
                    <span style={{ fontWeight: 700, color: correct ? '#10B981' : '#EF4444', fontSize: 13, flexShrink: 0 }}>{q.earned}/{q.points} pts</span>
                  </div>
                  {(Array.isArray(q.options) ? q.options.map(o => [o.label, o.text]) : Object.entries(q.options || {})).map(([k, v]) => {
                    const isCorrect = k === q.correct_answer;
                    const isGiven   = k === q.given_answer;
                    let bg = '#fff', border = 'var(--border)', color = 'var(--text-primary)';
                    if (isCorrect) { bg = '#ECFDF5'; border = '#10B981'; color = '#065F46'; }
                    else if (isGiven && !correct) { bg = '#FEF2F2'; border = '#EF4444'; color = '#991B1B'; }
                    return (
                      <div key={k} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 10px', borderRadius: 7, border: `1.5px solid ${border}`, background: bg, marginBottom: 3, fontSize: 13 }}>
                        <span style={{ background: isCorrect ? '#10B981' : isGiven && !correct ? '#EF4444' : 'var(--border)', color: (isCorrect || (isGiven && !correct)) ? '#fff' : 'var(--text-muted)', borderRadius: 4, padding: '1px 6px', fontWeight: 700, fontSize: 11 }}>{k}</span>
                        <span style={{ color }}>{v}</span>
                        {isCorrect && <span style={{ marginLeft: 'auto', fontSize: 11, color: '#10B981', fontWeight: 600 }}>✓</span>}
                      </div>
                    );
                  })}
                  <div style={{ marginTop: 6, padding: '7px 10px', borderRadius: 7, background: feedbackBg, color: feedbackColor, fontSize: 12 }}>{feedback}</div>
                </div>
              );
            })}
          </div>
        )
      )}
      <div style={{ textAlign: 'center', padding: '10px 0', fontWeight: 700, color: 'var(--text-secondary)', fontSize: 13, borderTop: '1px solid var(--border)' }}>
        Final Score: {score.totalEarned} / {score.totalMax} pts · {score.percentage?.toFixed(1)}% · {score.grade}
      </div>
    </div>
  );
}

/* ─── Main Dashboard ─── */
export default function Dashboard() {
  const { session } = useAuth();
  const [application, setApplication] = useState(null);
  const [exam, setExam]               = useState(null);
  const [loading, setLoading]         = useState(true);
  const [uploading, setUploading]     = useState(false);
  const [selectedFile, setFile]       = useState(null);
  const [jobTitle, setJobTitle]       = useState('');
  const [uploadError, setUploadError] = useState('');
  const [uploadSuccess, setUploadSuccess] = useState('');
  const [dragOver, setDragOver]       = useState(false);
  const fileRef = useRef();

  // Exam
  const [examOpen, setExamOpen]       = useState(false);
  const [examQuestions, setExamQuestions] = useState([]);
  const [loadingExam, setLoadingExam] = useState(false);
  const [examError, setExamError]     = useState('');
  const [submitError, setSubmitError] = useState('');
  const [answers, setAnswers]         = useState({});
  const [submitting, setSubmitting]   = useState(false);
  const [showWarning, setShowWarning] = useState(false);
  const [resultOpen, setResultOpen]   = useState(false);
  const startProg = useSimProgress('questions');

  useEffect(() => { loadDashboard(); }, []);

  async function loadDashboard() {
    setLoading(true);
    try {
      const [appsRes, examRes] = await Promise.all([
        fetch('/api/applications/mine', { headers: authHeaders() }),
        fetch('/api/exams/mine',        { headers: authHeaders() }),
      ]);
      const apps = await appsRes.json();
      const exd  = await examRes.json();
      setApplication(Array.isArray(apps) && apps.length > 0 ? apps[0] : null);
      setExam(exd.exam || null);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }

  function onFileDrop(e) {
    e.preventDefault(); setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (!f) return;
    if (f.type !== 'application/pdf') { setUploadError('Only PDF files are supported.'); return; }
    setFile(f); setUploadError('');
  }

  async function handleUpload() {
    if (!selectedFile) { setUploadError('Please select a PDF file.'); return; }
    setUploadError(''); setUploadSuccess(''); setUploading(true);
    const fd = new FormData();
    fd.append('cv', selectedFile);
    fd.append('jobTitle', jobTitle);
    try {
      const res = await fetch('/api/applications/upload', { method: 'POST', headers: authHeadersFormData(), body: fd });
      const data = await res.json();
      if (!res.ok) { setUploadError(data.error || 'Upload failed.'); return; }
      setUploadSuccess('✅ CV submitted successfully! HR will review it soon.');
      setFile(null); setJobTitle('');
      setTimeout(() => { setUploadSuccess(''); loadDashboard(); }, 1200);
    } catch { setUploadError('Network error. Please try again.'); }
    finally { setUploading(false); }
  }

  async function startExam() {
    setExamError(''); setLoadingExam(true);
    startProg.start();
    try {
      const res  = await fetch('/api/exams/start', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ examId: exam.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        startProg.reset();
        setExamError(data.detail || 'Failed to load exam questions. Please try again.');
        return;
      }
      const qs = data.questions || [];
      if (!qs.length) {
        startProg.reset();
        setExamError('No questions found for this exam. Please contact HR.');
        return;
      }
      startProg.finish();
      setExamQuestions(qs);
      setAnswers({});
      setTimeout(() => { setExamOpen(true); }, 400);
    } catch {
      startProg.reset();
      setExamError('Network error. Please check your connection and try again.');
    }
    finally { setLoadingExam(false); }
  }

  async function submitExam() {
    setShowWarning(false); setSubmitError(''); setSubmitting(true);
    const answerArr = Object.entries(answers).map(([qid, ans]) => ({ question_id: Number(qid), answer: ans }));
    try {
      const res = await fetch('/api/exams/submit', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ examId: exam.id, answers: answerArr }),
      });
      const data = await res.json();
      if (!res.ok) { setSubmitError(data.detail || data.error || 'Submission failed. Please try again.'); return; }
      setExamOpen(false);
      setUploadSuccess('✅ Exam submitted successfully!');
      setTimeout(() => { setUploadSuccess(''); loadDashboard(); }, 1500);
    } catch { setSubmitError('Network error. Please try again.'); }
    finally { setSubmitting(false); }
  }

  const statusInfo = STATUS_MAP[application?.status] || STATUS_MAP['uploaded'];
  const isExpired  = exam?.expired;
  const isPending  = exam && !exam.submitted && !exam.expired;
  const isDone     = exam && exam.submitted;
  const timeLeft   = isPending ? getTimeLeft(exam.expiresAt) : null;

  // Group questions by section
  const bySection = (qs) => [
    ['Section A — Easy (1 pt each)',     qs.filter(q => q.difficulty === 'easy')],
    ['Section B — Medium (2 pts each)',  qs.filter(q => q.difficulty === 'medium')],
    ['Section C — Hard (3 pts each)',    qs.filter(q => q.difficulty === 'hard')],
  ];

  const answered = Object.keys(answers).length;

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      <NeuralNetworkBg />
      <div style={{ position: 'relative', zIndex: 1 }}>
        <Header />
        <main style={{ maxWidth: 820, margin: '0 auto', padding: '32px 24px' }}>

          <div style={{ marginBottom: 24 }}>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 2 }}>
              Hello, {session?.name} 👋
            </h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>Applicant Dashboard · {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}</p>
          </div>

          {uploadSuccess && (
            <div style={{ background: '#ECFDF5', border: '1px solid #6EE7B7', borderRadius: 10, padding: '12px 16px', marginBottom: 16, color: '#065F46', fontWeight: 600 }}>
              {uploadSuccess}
            </div>
          )}

          {loading ? (
            <div style={{ textAlign: 'center', padding: 80 }}><div className="spinner" /></div>
          ) : (
            <>
              {/* ── Upload section ── */}
              {!application && (
                <div className="dash-card">
                  <h2 className="dash-card-title">📤 Submit Your CV</h2>
                  <div
                    className={`dropzone ${dragOver ? 'dragover' : ''}`}
                    onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={onFileDrop}
                    onClick={() => fileRef.current.click()}
                  >
                    {selectedFile
                      ? <>
                          <div style={{ fontSize: 32 }}>📄</div>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>{selectedFile.name}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{Math.round(selectedFile.size / 1024)} KB</div>
                        </>
                      : <>
                          <div style={{ fontSize: 36 }}>☁️</div>
                          <div style={{ fontWeight: 600 }}>Drag &amp; drop your CV or click to browse</div>
                          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>PDF only · max 20 MB</div>
                        </>
                    }
                    <input ref={fileRef} type="file" accept=".pdf" hidden onChange={e => {
                      const f = e.target.files[0];
                      if (!f) return;
                      if (f.type !== 'application/pdf') { setUploadError('Only PDF files are supported.'); return; }
                      setFile(f); setUploadError('');
                    }} />
                  </div>
                  {selectedFile && (
                    <button onClick={() => { setFile(null); fileRef.current.value = ''; }} style={{ marginTop: 6, fontSize: 12, color: '#EF4444', background: 'none', border: 'none', cursor: 'pointer' }}>✕ Remove file</button>
                  )}
                  <div className="form-group" style={{ marginTop: 16 }}>
                    <label className="form-label">Position / Job Title</label>
                    <input className="form-input" placeholder="e.g. Software Engineer" value={jobTitle} onChange={e => setJobTitle(e.target.value)} />
                  </div>
                  {uploadError && <div className="auth-error">{uploadError}</div>}
                  <button className="run-btn" style={{ width: '100%', marginTop: 8 }} onClick={handleUpload} disabled={uploading || !selectedFile}>
                    {uploading ? <><span className="spinner-sm" /> Uploading…</> : '🚀 Submit Application'}
                  </button>
                </div>
              )}

              {/* ── Application status card ── */}
              {application && (
                <div className="dash-card">
                  <h2 className="dash-card-title">📋 Application Status</h2>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                    <div style={{ fontSize: 40 }}>{statusInfo.icon}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                        <span style={{ fontWeight: 700, fontSize: 16 }}>{statusInfo.label}</span>
                        <span style={{ background: statusInfo.color + '20', color: statusInfo.color, border: `1px solid ${statusInfo.color}40`, borderRadius: 20, padding: '2px 12px', fontSize: 12, fontWeight: 600 }}>
                          {application.status?.replace(/_/g, ' ')}
                        </span>
                      </div>
                      <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>{statusInfo.desc}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        📄 {application.fileName}
                        {application.jobTitle && <> · 💼 {application.jobTitle}</>}
                        {' · '} 📅 {fmtDate(application.uploadedAt)}
                      </div>
                    </div>
                  </div>

                  {application.analysisResult && (() => {
                    const r = application.analysisResult;
                    return (
                      <div style={{ marginTop: 18, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 10 }}>
                        {[
                          ['🤖 AI Score', r.overall_score + '%'],
                          ['🎯 Skills',   r.skills_match + '%'],
                          ['💼 Experience', r.experience_match + '%'],
                          ['🎓 Education', r.education_match + '%'],
                          ['🔍 ATS Score', (r.ats?.combined_ats_score || 0) + '%'],
                        ].map(([label, val]) => (
                          <div key={label} style={{ background: 'var(--surface-2)', borderRadius: 10, padding: '12px 14px', textAlign: 'center' }}>
                            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--bkash-pink)' }}>{val}</div>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{label}</div>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* ── Exam section ── */}
              {exam && (
                <div className="dash-card" style={{ marginTop: 20 }}>
                  <h2 className="dash-card-title">📝 Examination</h2>

                  {isExpired && (
                    <div style={{ background: '#FEF3C7', border: '1px solid #F59E0B', borderRadius: 10, padding: 16, color: '#92400E' }}>
                      <div style={{ fontWeight: 700, marginBottom: 4 }}>⏰ Exam Expired</div>
                      <div style={{ fontSize: 13 }}>This exam expired on {fmtDate(exam.expiresAt)}. Please contact HR if you believe this is an error.</div>
                    </div>
                  )}

                  {isPending && (
                    <div>
                      <div style={{ background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 10, padding: '12px 16px', marginBottom: 16 }}>
                        <div style={{ fontWeight: 700, color: '#1D4ED8', marginBottom: 2 }}>📝 You Have an Exam</div>
                        <div style={{ fontSize: 13, color: '#1E40AF' }}>Please complete this exam before the deadline.</div>
                        {timeLeft && (
                          <div style={{ marginTop: 6, fontSize: 13, fontWeight: 600, color: timeLeft.urgent ? '#EF4444' : '#10B981' }}>
                            ⏱ {timeLeft.label}
                          </div>
                        )}
                        {timeLeft?.urgent && (
                          <div style={{ marginTop: 4, fontSize: 12, color: '#EF4444' }}>⚠ Deadline approaching! Start now.</div>
                        )}
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 16 }}>
                        {[
                          ['Questions', exam.questionCount || 15],
                          ['Total Marks', exam.totalMarks || 30],
                          ['Deadline', new Date(exam.expiresAt).toLocaleDateString('en-GB')],
                        ].map(([l, v]) => (
                          <div key={l} style={{ background: 'var(--surface-2)', borderRadius: 8, padding: '12px 14px', textAlign: 'center' }}>
                            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--bkash-pink)' }}>{v}</div>
                            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{l}</div>
                          </div>
                        ))}
                      </div>
                      {examError && (
                        <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: '10px 14px', marginBottom: 12, color: '#991B1B', fontSize: 13 }}>
                          ⚠ {examError}
                          <button onClick={() => setExamError('')} style={{ float: 'right', background: 'none', border: 'none', cursor: 'pointer', color: '#991B1B', fontWeight: 700 }}>✕</button>
                        </div>
                      )}
                      {loadingExam ? (
                        <AIProgressBar progress={startProg.progress} label={startProg.label} />
                      ) : (
                        <button className="run-btn" onClick={startExam}>
                          🎯 Start Exam
                        </button>
                      )}
                    </div>
                  )}

                  {isDone && exam.score && (
                    <div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 14 }}>
                        {[
                          ['Score', `${exam.score.totalEarned}/${exam.score.totalMax}`],
                          ['Percentage', exam.score.percentage?.toFixed(1) + '%'],
                          ['Grade', exam.score.grade],
                        ].map(([l, v]) => (
                          <div key={l} style={{ background: 'var(--bkash-pink-pale)', borderRadius: 8, padding: '12px 14px', textAlign: 'center' }}>
                            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--bkash-pink)' }}>{v}</div>
                            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{l}</div>
                          </div>
                        ))}
                      </div>
                      {/* Section breakdown */}
                      {(exam.score.sections || []).length > 0 && (
                        <div style={{ marginBottom: 14 }}>
                          {exam.score.sections.map(s => (
                            <div key={s.difficulty} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                              <span style={{ width: 70, fontSize: 12, color: 'var(--text-muted)', textTransform: 'capitalize' }}>{s.difficulty}</span>
                              <div style={{ flex: 1, height: 6, background: 'var(--border)', borderRadius: 99 }}>
                                <div style={{ height: '100%', width: `${s.max > 0 ? (s.earned / s.max) * 100 : 0}%`, background: 'var(--bkash-pink)', borderRadius: 99 }} />
                              </div>
                              <span style={{ fontSize: 12, fontWeight: 600, width: 50, textAlign: 'right' }}>{s.earned}/{s.max} pts</span>
                            </div>
                          ))}
                        </div>
                      )}
                      <button className="run-btn" onClick={() => setResultOpen(true)}>
                        📊 View Detailed Results
                      </button>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </main>
      </div>

      {/* ── Exam taking modal ── */}
      {examOpen && exam && (
        <div className="exam-modal" style={{ zIndex: 300 }}>
          <div className="exam-modal-inner" style={{ maxWidth: 740, margin: 'auto', padding: 24, overflowY: 'auto', maxHeight: '90vh' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div>
                <h2 style={{ fontSize: 19, fontWeight: 700 }}>📝 Examination</h2>
                <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Candidate: {session?.name}</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 13, color: 'var(--bkash-pink)', fontWeight: 600 }}>{answered} of {examQuestions.length} answered</span>
                <button onClick={() => setExamOpen(false)} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer' }}>✕</button>
              </div>
            </div>

            {bySection(examQuestions).map(([title, qs]) => qs.length === 0 ? null : (
              <div key={title} style={{ marginBottom: 24 }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--bkash-pink)', marginBottom: 10, padding: '5px 10px', background: 'var(--bkash-pink-pale)', borderRadius: 7 }}>{title}</div>
                {qs.map(q => (
                  <QuestionCard key={q.id} q={q} num={examQuestions.indexOf(q) + 1} answer={answers[q.id]} onAnswer={ans => setAnswers(a => ({ ...a, [q.id]: ans }))} />
                ))}
              </div>
            ))}

            {submitError && (
              <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: '10px 14px', marginTop: 12, color: '#991B1B', fontSize: 13 }}>
                ⚠ {submitError}
              </div>
            )}
            <div style={{ position: 'sticky', bottom: 0, background: 'var(--surface)', padding: '12px 0', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16 }}>
              <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{answered} of {examQuestions.length} questions answered</span>
              <button className="run-btn" onClick={() => setShowWarning(true)} disabled={submitting}>
                {submitting ? <><span className="spinner-sm" /> Submitting…</> : '✅ Submit Exam'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Submit warning ── */}
      {showWarning && (
        <div className="exam-warning-overlay" style={{ zIndex: 400 }}>
          <div style={{ background: '#fff', borderRadius: 16, padding: 32, maxWidth: 380, textAlign: 'center', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
            <div style={{ fontSize: 44, marginBottom: 10 }}>⚠️</div>
            <h3 style={{ marginBottom: 8 }}>Submit Exam?</h3>
            <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 20 }}>
              You have answered <strong>{answered}</strong> of <strong>{examQuestions.length}</strong> questions. This action cannot be undone.
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              <button className="run-btn" onClick={submitExam}>Yes, Submit</button>
              <button className="secondary-btn" onClick={() => setShowWarning(false)}>Go Back</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Results detail modal ── */}
      {resultOpen && exam && (
        <div className="exam-modal" style={{ zIndex: 300 }}>
          <div className="exam-modal-inner" style={{ maxWidth: 740, margin: 'auto', padding: 24, overflowY: 'auto', maxHeight: '90vh' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h2 style={{ fontSize: 19, fontWeight: 700 }}>📊 Detailed Results</h2>
              <button onClick={() => setResultOpen(false)} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer' }}>✕</button>
            </div>
            <ExamResultView exam={exam} />
          </div>
        </div>
      )}
    </div>
  );
}
