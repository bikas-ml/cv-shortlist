import { useState, useEffect, useRef } from 'react';
import {
  Chart, ArcElement, DoughnutController, BarElement, BarController,
  CategoryScale, LinearScale, Tooltip, Legend,
} from 'chart.js';
import { authHeaders, authHeadersFormData } from '../utils/auth';
import Header from '../components/Header';
import HRBgAnimation from '../components/HRBgAnimation';
import CandidateCard from '../components/CandidateCard';
import { useSimProgress, AIProgressBar } from '../utils/useSimProgress.jsx';

Chart.register(ArcElement, DoughnutController, BarElement, BarController, CategoryScale, LinearScale, Tooltip, Legend);

function fmtD(d) { if (!d) return '—'; return new Date(d).toLocaleString(); }
function scoreClass(s) { return s >= 70 ? 'high' : s >= 45 ? 'mid' : 'low'; }

export default function HR() {
  const [tab, setTab] = useState('overview');

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', flexDirection: 'column' }}>
      <Header showNav />

      <div style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, zIndex: 50 }}>
        <div style={{ maxWidth: 1400, margin: '0 auto', padding: '0 24px', display: 'flex', gap: 4 }}>
          {[
            ['overview',   '🏠 Overview'],
            ['batch',      '🔬 Batch Analysis'],
            ['applicants', '👥 Applicants'],
            ['pending',    '⏳ Exam Pending'],
            ['results',    '📊 Exam Results'],
          ].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              style={{
                padding: '14px 18px', border: 'none', background: 'none', cursor: 'pointer',
                fontWeight: 600, fontSize: 13,
                color: tab === key ? 'var(--bkash-pink)' : 'var(--text-secondary)',
                borderBottom: tab === key ? '3px solid var(--bkash-pink)' : '3px solid transparent',
                transition: 'all 0.15s',
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, maxWidth: 1400, width: '100%', margin: '0 auto', padding: '24px', boxSizing: 'border-box' }}>
        {tab === 'overview'   && <TabOverview onNav={setTab} />}
        {tab === 'batch'      && <TabBatch />}
        {tab === 'applicants' && <TabApplicants />}
        {tab === 'pending'    && <TabPending />}
        {tab === 'results'    && <TabResults />}
      </div>
    </div>
  );
}

/* ─────────────────────────────── OVERVIEW ─────────────────────────────── */
function TabOverview({ onNav }) {
  const [stats, setStats] = useState({ total: 0, shortlisted: 0, examPending: 0, resultsReady: 0 });

  useEffect(() => {
    async function load() {
      try {
        const [appsRes, examsRes] = await Promise.all([
          fetch('/api/applications', { headers: authHeaders() }),
          fetch('/api/exams',        { headers: authHeaders() }),
        ]);
        const apps  = await appsRes.json();
        const exams = await examsRes.json();
        const arr = Array.isArray(apps)  ? apps  : [];
        const ex  = Array.isArray(exams) ? exams : [];
        setStats({
          total:        arr.length,
          shortlisted:  arr.filter(a => a.status === 'shortlisted').length,
          examPending:  ex.filter(e => !e.submitted).length,
          resultsReady: ex.filter(e => e.submitted).length,
        });
      } catch {}
    }
    load();
  }, []);

  return (
    <div style={{ position: 'relative' }}>
      <div style={{ position: 'absolute', inset: 0, borderRadius: 16, overflow: 'hidden', pointerEvents: 'none', zIndex: 0 }}>
        <HRBgAnimation />
      </div>
      <div style={{ position: 'relative', zIndex: 1 }}>
        <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 24 }}>HR Dashboard Overview</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16, marginBottom: 32 }}>
          {[
            ['📄 Total Applications', stats.total,        '#3B82F6'],
            ['✅ Shortlisted',        stats.shortlisted,  '#10B981'],
            ['⏳ Exam Pending',        stats.examPending,  '#F59E0B'],
            ['📊 Results Ready',      stats.resultsReady, '#8B5CF6'],
          ].map(([label, val, color]) => (
            <div key={label} style={{ background: 'var(--surface)', borderRadius: 12, padding: 20, border: '1px solid var(--border)', borderTop: `4px solid ${color}` }}>
              <div style={{ fontSize: 28, fontWeight: 700, color }}>{val}</div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>{label}</div>
            </div>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 16 }}>
          {[
            ['🔬 Batch Analysis', 'Analyse multiple CVs against a job description at once.', 'batch'],
            ['👥 Applicants',     'Review submitted applications and manage shortlisting.',   'applicants'],
            ['⏳ Exam Pending',    'Track candidates who have been sent but not completed exams.', 'pending'],
            ['📊 Exam Results',   'Review completed exam submissions and set final decisions.', 'results'],
          ].map(([title, desc, key]) => (
            <div
              key={key}
              onClick={() => onNav(key)}
              style={{ background: 'var(--surface)', borderRadius: 12, padding: 20, border: '1px solid var(--border)', cursor: 'pointer', transition: 'box-shadow 0.15s, transform 0.15s' }}
              onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 4px 20px rgba(226,19,110,0.15)'; e.currentTarget.style.transform = 'translateY(-2px)'; }}
              onMouseLeave={e => { e.currentTarget.style.boxShadow = ''; e.currentTarget.style.transform = ''; }}
            >
              <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>{title}</div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{desc}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── module-level cache: survives component unmount/remount (tab navigation) ── */
const _batchCache = { results: null, jd: '', loading: false, error: '' };

/* ─────────────────────────────── BATCH ANALYSIS ─────────────────────────────── */
function TabBatch() {
  const [jd, setJd]           = useState(_batchCache.jd);
  const [files, setFiles]     = useState([]);
  const [threshold, setThr]   = useState(70);
  const [loading, setLoading] = useState(_batchCache.loading);
  const [results, setResults] = useState(_batchCache.results);
  const [error, setError]     = useState(_batchCache.error);
  const [tab, setTab]         = useState('all');
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef();
  const batchProg = useSimProgress('batch');

  // Bulk exam modal state
  const [bulkModal, setBulkModal]       = useState(false);
  const [bulkUsers, setBulkUsers]       = useState([]);   // all eligible users from DB
  const [bulkSelected, setBulkSelected] = useState([]);  // emails checked by HR
  const [bulkDays, setBulkDays]         = useState(7);
  const [bulkSending, setBulkSending]   = useState(false);
  const [bulkResult, setBulkResult]     = useState(null);

  function removeFile(i) {
    setFiles(f => f.filter((_, idx) => idx !== i));
  }

  // Sync state changes to module cache so they survive tab navigation
  function setResultsCached(v) { _batchCache.results = v; setResults(v); }
  function setLoadingCached(v) { _batchCache.loading = v; setLoading(v); }
  function setErrorCached(v)   { _batchCache.error   = v; setError(v); }
  function setJdCached(v)      { _batchCache.jd      = v; setJd(v); }

  async function runBatch() {
    if (!jd.trim())    { setErrorCached('Please enter a job description.'); return; }
    if (!files.length) { setErrorCached('Please upload at least one CV.'); return; }
    setErrorCached(''); setLoadingCached(true); setResultsCached(null);
    batchProg.start();
    const fd = new FormData();
    files.forEach(f => fd.append('cvs', f));
    fd.append('jd_text', jd);
    fd.append('threshold', threshold);
    try {
      // keepalive ensures the request continues even if user navigates away
      const res  = await fetch('/api/hr-shortlist', { method: 'POST', headers: authHeadersFormData(), body: fd, keepalive: false });
      const data = await res.json();
      batchProg.finish();
      if (!res.ok) { setErrorCached(data.error || 'Batch failed.'); return; }
      setResultsCached(data); setTab('all');
    } catch { batchProg.reset(); setErrorCached('Network error.'); }
    finally { setLoadingCached(false); }
  }

  async function openBulkModal() {
    if (!jd.trim()) { alert('Please enter a job description in the sidebar first.'); return; }
    setBulkModal(true); setBulkResult(null);
    try {
      const res  = await fetch('/api/eligible-candidates', { headers: authHeaders() });
      const data = await res.json();
      setBulkUsers(Array.isArray(data) ? data : []);
      setBulkSelected((Array.isArray(data) ? data : []).map(u => u.email)); // pre-select all
    } catch { setBulkUsers([]); }
  }

  function toggleBulkUser(email) {
    setBulkSelected(s => s.includes(email) ? s.filter(e => e !== email) : [...s, email]);
  }

  async function sendBulkExam() {
    if (!bulkSelected.length) { alert('Select at least one candidate.'); return; }
    setBulkSending(true); setBulkResult(null);
    try {
      const targets = bulkUsers
        .filter(u => bulkSelected.includes(u.email))
        .map(u => ({ email: u.email, name: u.name }));
      const res  = await fetch('/api/exams/send-bulk', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ targets, jdText: jd, expiryDays: bulkDays }),
      });
      const data = await res.json();
      if (!res.ok) { alert(data.detail || data.error || 'Bulk send failed.'); return; }
      setBulkResult(data);
    } catch { alert('Network error.'); }
    finally { setBulkSending(false); }
  }

  const shortlistedCount = results ? results.results.filter(r => r.shortlisted).length : 0;

  const filtered = results ? results.results.filter(r => {
    if (tab === 'shortlisted') return r.shortlisted;
    if (tab === 'rejected')    return !r.shortlisted;
    return true;
  }) : [];

  return (
    <div className="app-layout" style={{ gap: 20 }}>
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-section">
          <label className="form-label">📋 Job Description</label>
          <textarea className="jd-textarea" rows={7} placeholder="Paste job description…" value={jd} onChange={e => setJdCached(e.target.value)} />
        </div>

        <div className="sidebar-section">
          <label className="form-label">📄 Upload CVs (max 10 PDFs)</label>
          <div
            className={`dropzone ${dragOver ? 'dragover' : ''}`}
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => {
              e.preventDefault(); setDragOver(false);
              setFiles(Array.from(e.dataTransfer.files).filter(f => f.type === 'application/pdf').slice(0, 10));
            }}
            onClick={() => fileRef.current.click()}
            style={{ minHeight: 80, fontSize: 13 }}
          >
            {files.length ? (
              files.map((f, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-secondary)', marginBottom: 2 }}>
                  <span>📄 {f.name} <span style={{ color: 'var(--text-muted)' }}>({(f.size / 1024).toFixed(0)} KB)</span></span>
                  <button onClick={e => { e.stopPropagation(); removeFile(i); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#EF4444', fontSize: 14 }}>✕</button>
                </div>
              ))
            ) : (
              <><div>☁️</div><div>Drag up to 10 PDFs or click</div></>
            )}
            <input ref={fileRef} type="file" accept=".pdf" multiple hidden onChange={e => setFiles(Array.from(e.target.files).slice(0, 10))} />
          </div>
        </div>

        <div className="sidebar-section">
          <label className="form-label">🎯 Shortlist Threshold: <strong>{threshold}%</strong></label>
          <input type="range" className="threshold-slider" min={0} max={100} value={threshold} onChange={e => setThr(Number(e.target.value))} />
        </div>

        {error && <div className="auth-error">{error}</div>}
        <button className="run-btn" onClick={runBatch} disabled={loading}>
          {loading ? <><span className="spinner-sm" /> Analysing…</> : '🚀 Run Batch Analysis'}
        </button>
      </aside>

      {/* Results */}
      <main className="results-area">
        {!results && !loading && (
          <div className="empty-state">
            <div style={{ fontSize: 64 }}>🔬</div>
            <h3>Batch Analysis</h3>
            <p>Upload up to 10 CVs and a job description, then run analysis.</p>
          </div>
        )}
        {loading && (
          <div style={{ padding: '48px 24px' }}>
            <div style={{ fontSize: 48, textAlign: 'center', marginBottom: 24 }}>🔬</div>
            <AIProgressBar progress={batchProg.progress} label={batchProg.label} />
            <p style={{ textAlign: 'center', fontSize: 13, color: 'var(--text-muted)', marginTop: 8 }}>
              Evaluating {files.length} CV{files.length !== 1 ? 's' : ''} with AI — this may take a moment…
            </p>
          </div>
        )}

        {results && (
          <>
            <div className="stats-row">
              {[['📄 Total', results.total], ['✅ Shortlisted', results.shortlisted], ['❌ Rejected', results.rejected], ['🎯 Threshold', results.threshold + '%']].map(([l, v]) => (
                <div key={l} className="stat-card"><div className="stat-val">{v}</div><div className="stat-label">{l}</div></div>
              ))}
            </div>
            {shortlistedCount > 0 && (
              <button
                className="run-btn"
                style={{ marginTop: 12, width: '100%' }}
                onClick={openBulkModal}
              >
                📧 Send Exam to All Shortlisted ({shortlistedCount})
              </button>
            )}
            <div className="tab-bar" style={{ marginTop: 12 }}>
              {['all', 'shortlisted', 'rejected'].map(t => (
                <button key={t} className={`tab-btn ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
            {filtered.map((r, i) => (
              <CandidateCard key={i} r={r} rank={i + 1} showExamBtn={false} />
            ))}
          </>
        )}
      </main>

      {/* Bulk Send Exam Modal */}
      {bulkModal && (
        <div className="exam-warning-overlay">
          <div style={{ background: 'var(--surface)', borderRadius: 16, padding: 28, maxWidth: 540, width: '95%', maxHeight: '85vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
              <h3 style={{ fontSize: 17, fontWeight: 700 }}>📧 Send Exam to Registered Candidates</h3>
              <button onClick={() => { setBulkModal(false); setBulkResult(null); }} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer' }}>✕</button>
            </div>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 14 }}>
              Questions will be generated from your job description and sent to the selected candidates. Each candidate gets the same set of questions.
            </p>

            {bulkResult ? (
              <div style={{ textAlign: 'center', padding: '20px 0' }}>
                <div style={{ fontSize: 42, marginBottom: 8 }}>✅</div>
                <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 6 }}>
                  Exam sent to {bulkResult.sent} candidate{bulkResult.sent !== 1 ? 's' : ''}!
                </div>
                {bulkResult.skipped > 0 && (
                  <div style={{ fontSize: 13, color: '#F59E0B', marginBottom: 4 }}>
                    ⚠ {bulkResult.skipped} skipped (already have an active exam)
                  </div>
                )}
                <button className="run-btn" style={{ marginTop: 16 }} onClick={() => { setBulkModal(false); setBulkResult(null); }}>
                  Close
                </button>
              </div>
            ) : (
              <>
                {bulkUsers.length === 0 ? (
                  <div style={{ padding: '20px 0', textAlign: 'center', color: '#EF4444', fontSize: 13 }}>
                    No eligible candidates found. Candidates must register an account first.
                  </div>
                ) : (
                  <div className="form-group">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <label className="form-label" style={{ margin: 0 }}>Select Candidates ({bulkSelected.length}/{bulkUsers.length})</label>
                      <button
                        style={{ fontSize: 12, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--bkash-pink)', fontWeight: 600 }}
                        onClick={() => setBulkSelected(bulkSelected.length === bulkUsers.length ? [] : bulkUsers.map(u => u.email))}
                      >
                        {bulkSelected.length === bulkUsers.length ? 'Deselect All' : 'Select All'}
                      </button>
                    </div>
                    <div style={{ border: '1px solid var(--border)', borderRadius: 8, maxHeight: 220, overflowY: 'auto' }}>
                      {bulkUsers.map(u => (
                        <label key={u.email} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}>
                          <input
                            type="checkbox"
                            checked={bulkSelected.includes(u.email)}
                            onChange={() => toggleBulkUser(u.email)}
                            style={{ accentColor: 'var(--bkash-pink)', width: 15, height: 15, flexShrink: 0 }}
                          />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 600, fontSize: 13 }}>{u.name}</div>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{u.email} · {u.position} · <span style={{ textTransform: 'capitalize' }}>{u.status?.replace(/_/g,' ')}</span></div>
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
                <div className="form-group">
                  <label className="form-label">Validity: <strong>{bulkDays} days</strong></label>
                  <input type="range" className="threshold-slider" min={1} max={30} value={bulkDays} onChange={e => setBulkDays(Number(e.target.value))} />
                </div>
                {bulkSending && <AIProgressBar progress={75} label="Generating questions & sending to candidates…" style={{ marginBottom: 12 }} />}
                <div style={{ display: 'flex', gap: 10 }}>
                  <button className="run-btn" onClick={sendBulkExam} disabled={bulkSending || !bulkSelected.length} style={{ flex: 1 }}>
                    {bulkSending ? <><span className="spinner-sm" /> Sending…</> : `📧 Send to ${bulkSelected.length} Candidate${bulkSelected.length !== 1 ? 's' : ''}`}
                  </button>
                  <button className="secondary-btn" onClick={() => { setBulkModal(false); setBulkResult(null); }}>Cancel</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────── APPLICANTS ─────────────────────────────── */
function TabApplicants() {
  const [apps, setApps]         = useState([]);
  const [loading, setLoading]   = useState(true);
  const [keyword, setKeyword]   = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selected, setSelected] = useState([]);

  const [analyzeModal, setAnalyzeModal] = useState(false);
  const [analyzeJd, setAnalyzeJd]       = useState('');
  const [analyzeThr, setAnalyzeThr]     = useState(70);
  const [analyzing, setAnalyzing]       = useState(false);
  const [analyzeError, setAnalyzeError] = useState('');
  const analyzeProg = useSimProgress('analyze');

  const [examModal, setExamModal]     = useState(null);  // single send
  const [examDays, setExamDays]       = useState(7);
  const [examJdText, setExamJdText]   = useState('');
  const [examSending, setExamSending] = useState(false);
  const [examSent, setExamSent]       = useState('');


  useEffect(() => { loadApps(); }, []);

  async function loadApps() {
    setLoading(true);
    try {
      const res  = await fetch('/api/applications', { headers: authHeaders() });
      const data = await res.json();
      setApps(Array.isArray(data) ? data : []);
    } catch {}
    finally { setLoading(false); }
  }

  async function updateStatus(id, status) {
    await fetch(`/api/applications/${id}/status`, { method: 'PATCH', headers: authHeaders(), body: JSON.stringify({ status }) });
    setApps(a => a.map(app => app.id === id ? { ...app, status } : app));
  }

  async function deleteApp(id) {
    if (!confirm('Delete this application?')) return;
    await fetch(`/api/applications/${id}`, { method: 'DELETE', headers: authHeaders() });
    setApps(a => a.filter(app => app.id !== id));
  }

  async function analyzeSelected() {
    if (!analyzeJd.trim()) { setAnalyzeError('Please enter a job description.'); return; }
    setAnalyzing(true); setAnalyzeError('');
    analyzeProg.start();
    try {
      const res = await fetch('/api/applications/analyze', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ applicationIds: selected, jdText: analyzeJd, threshold: analyzeThr }),
      });
      const data = await res.json();
      analyzeProg.finish();
      if (!res.ok) { setAnalyzeError(data.error || data.detail || 'Analysis failed.'); return; }
      setAnalyzeModal(false); setAnalyzeError(''); setSelected([]);
      await loadApps();
    } catch { analyzeProg.reset(); setAnalyzeError('Network error. Please try again.'); }
    finally { setAnalyzing(false); }
  }

  async function sendExam(app) {
    if (!examJdText.trim()) { setExamSent('❌ Please enter a job description to generate exam questions.'); return; }
    setExamSending(true); setExamSent('');
    try {
      const res = await fetch('/api/exams/send', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ applicationId: app.id, jdText: examJdText, expiryDays: examDays }),
      });
      const data = await res.json();
      if (!res.ok) { setExamSent('❌ ' + (data.detail || data.error || 'Failed to send exam.')); return; }
      setExamSent('✅ Exam sent successfully!');
      setTimeout(() => { setExamModal(null); setExamJdText(''); setExamSent(''); loadApps(); }, 1200);
    } catch { setExamSent('❌ Network error. Please try again.'); }
    finally { setExamSending(false); }
  }

  const filtered = apps.filter(a => {
    const kMatch = !keyword || a.candidateName?.toLowerCase().includes(keyword.toLowerCase()) || a.candidateEmail?.toLowerCase().includes(keyword.toLowerCase());
    const sMatch = statusFilter === 'all' || a.status === statusFilter;
    return kMatch && sMatch;
  });

  const allSelected = filtered.length > 0 && filtered.every(a => selected.includes(a.id));

  function toggleSelectAll() {
    setSelected(allSelected ? [] : filtered.map(a => a.id));
  }

  function toggleSelect(id) {
    setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);
  }

  return (
    <div>
      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16, alignItems: 'center' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer', color: 'var(--text-secondary)' }}>
          <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} style={{ accentColor: 'var(--bkash-pink)', width: 15, height: 15 }} />
          All
        </label>
        <input
          className="form-input"
          placeholder="🔍 Search name or email…"
          value={keyword}
          onChange={e => setKeyword(e.target.value)}
          style={{ flex: 1, minWidth: 200, margin: 0 }}
        />
        <select className="form-input" value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ width: 170, margin: 0 }}>
          {['all','uploaded','shortlisted','rejected','exam_sent','exam_completed','selected'].map(s => (
            <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g,' ')}</option>
          ))}
        </select>
        <button className="secondary-btn" onClick={loadApps}>↻ Refresh</button>
        {selected.length > 0 && (
          <button className="run-btn" style={{ fontSize: 13, padding: '8px 16px' }} onClick={() => setAnalyzeModal(true)}>
            🔬 Analyse {selected.length}
          </button>
        )}
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60 }}><div className="spinner" /></div>
      ) : filtered.length === 0 ? (
        <div className="empty-state"><div style={{ fontSize: 48 }}>📭</div><h3>No applications found</h3></div>
      ) : (
        filtered.map(app => (
          <AppCard
            key={app.id}
            app={app}
            selected={selected.includes(app.id)}
            onToggle={() => toggleSelect(app.id)}
            onStatus={updateStatus}
            onDelete={() => deleteApp(app.id)}
            onExam={() => setExamModal(app)}
          />
        ))
      )}

      {/* Analyze Modal */}
      {analyzeModal && (
        <div className="exam-warning-overlay">
          <div style={{ background: 'var(--surface)', borderRadius: 16, padding: 28, maxWidth: 520, width: '90%', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
              <h3 style={{ fontSize: 17, fontWeight: 700 }}>🔬 Analyse {selected.length} CV{selected.length !== 1 ? 's' : ''}</h3>
              <button onClick={() => setAnalyzeModal(false)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer' }}>✕</button>
            </div>
            <div className="form-group">
              <label className="form-label">Job Description</label>
              <textarea className="jd-textarea" rows={6} placeholder="Paste job description…" value={analyzeJd} onChange={e => setAnalyzeJd(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Shortlist Threshold: <strong>{analyzeThr}%</strong></label>
              <input type="range" className="threshold-slider" min={0} max={100} value={analyzeThr} onChange={e => setAnalyzeThr(Number(e.target.value))} />
            </div>
            {analyzing && <AIProgressBar progress={analyzeProg.progress} label={analyzeProg.label} style={{ marginBottom: 12 }} />}
            {analyzeError && (
              <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: '10px 14px', marginBottom: 10, color: '#991B1B', fontSize: 13 }}>
                ⚠ {analyzeError}
              </div>
            )}
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="run-btn" onClick={analyzeSelected} disabled={analyzing} style={{ flex: 1 }}>
                {analyzing ? <><span className="spinner-sm" /> Analysing…</> : '🚀 Run Analysis'}
              </button>
              <button className="secondary-btn" onClick={() => { setAnalyzeModal(false); setAnalyzeError(''); }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Send Exam Modal */}
      {examModal && (
        <div className="exam-warning-overlay">
          <div style={{ background: 'var(--surface)', borderRadius: 16, padding: 28, maxWidth: 520, width: '90%', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
              <h3 style={{ fontSize: 17, fontWeight: 700 }}>📧 Send Exam</h3>
              <button onClick={() => { setExamModal(null); setExamJdText(''); }} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer' }}>✕</button>
            </div>
            <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 16 }}>
              Send exam to <strong>{examModal.candidateName}</strong> ({examModal.candidateEmail})
            </p>
            <div className="form-group">
              <label className="form-label">Job Description <span style={{ color: '#EF4444' }}>*</span></label>
              <textarea
                className="jd-textarea"
                rows={5}
                placeholder="Paste the job description here — used to generate relevant exam questions…"
                value={examJdText}
                onChange={e => setExamJdText(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Validity: <strong>{examDays} days</strong></label>
              <input type="range" className="threshold-slider" min={1} max={30} value={examDays} onChange={e => setExamDays(Number(e.target.value))} />
            </div>
            {examSending && <AIProgressBar progress={80} label="Generating exam questions with AI…" style={{ marginBottom: 12 }} />}
            {examSent && (
              <div style={{ padding: '10px 14px', borderRadius: 8, marginBottom: 10, fontSize: 13, background: examSent.startsWith('✅') ? '#ECFDF5' : '#FEF2F2', color: examSent.startsWith('✅') ? '#065F46' : '#991B1B', border: `1px solid ${examSent.startsWith('✅') ? '#6EE7B7' : '#FECACA'}` }}>
                {examSent}
              </div>
            )}
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="run-btn" onClick={() => sendExam(examModal)} disabled={examSending} style={{ flex: 1 }}>
                {examSending ? <><span className="spinner-sm" /> Generating & Sending…</> : '📧 Generate & Send Exam'}
              </button>
              <button className="secondary-btn" onClick={() => { setExamModal(null); setExamJdText(''); setExamSent(''); }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

function AppCard({ app, selected, onToggle, onStatus, onDelete, onExam }) {
  const [open, setOpen] = useState(false);
  const r = app.analysisResult;
  const sc = { uploaded: '#3B82F6', analyzed: '#8B5CF6', shortlisted: '#10B981', rejected: '#EF4444', exam_sent: '#F59E0B', exam_completed: '#10B981', selected: '#10B981' };
  const color = sc[app.status] || '#6B7280';

  return (
    <div className="app-card" style={{ border: selected ? '2px solid var(--bkash-pink)' : '1px solid var(--border)', marginBottom: 12, borderRadius: 12, background: 'var(--surface)', overflow: 'hidden' }}>
      <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <input type="checkbox" checked={selected} onChange={onToggle} style={{ accentColor: 'var(--bkash-pink)', width: 16, height: 16, cursor: 'pointer' }} />
        <div style={{ fontSize: 28 }}>👤</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700 }}>{app.candidateName}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{app.candidateEmail} · {fmtD(app.uploadedAt)}</div>
          {app.jobTitle && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Role: {app.jobTitle}</div>}
        </div>
        <span style={{ background: color + '20', color, border: `1px solid ${color}40`, borderRadius: 20, padding: '3px 12px', fontSize: 12, fontWeight: 600, textTransform: 'capitalize' }}>
          {app.status?.replace(/_/g, ' ')}
        </span>

        {r && (
          <span className={`pill pill-ats ${scoreClass(r.ats?.combined_ats_score)}`}>ATS {r.ats?.combined_ats_score || 0}%</span>
        )}

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {app.status === 'shortlisted' && !app.examId && (
            <button className="run-btn" style={{ fontSize: 12, padding: '5px 10px' }} onClick={onExam}>📧 Send Exam</button>
          )}
          {app.status === 'exam_sent' && (
            <span style={{ fontSize: 12, padding: '5px 10px', borderRadius: 8, background: '#FFF7ED', color: '#C2410C', border: '1px solid #FED7AA', fontWeight: 600 }}>⏳ Exam Sent</span>
          )}
          {app.status === 'exam_completed' && (
            <span style={{ fontSize: 12, padding: '5px 10px', borderRadius: 8, background: '#EDE9FE', color: '#6D28D9', border: '1px solid #C4B5FD', fontWeight: 600 }}>🏆 Exam Done</span>
          )}
          {r ? (
            <button className="secondary-btn" style={{ fontSize: 12, padding: '5px 10px' }} onClick={() => setOpen(o => !o)}>
              {open ? '▲' : '▼'} Details
            </button>
          ) : (
            <span style={{ fontSize: 12, color: 'var(--text-muted)', padding: '5px 10px' }}>Not analysed</span>
          )}
          <button style={{ fontSize: 12, padding: '5px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-muted)', cursor: 'pointer' }} onClick={onDelete}>🗑</button>
        </div>
      </div>

      {/* Change-decision row — only for shortlisted/rejected before exam is sent */}
      {['shortlisted','rejected'].includes(app.status) && !app.examId && (
        <div style={{ padding: '8px 16px 10px', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', flex: 1 }}>
            {app.status === 'shortlisted' ? '✅ Auto-selected for next level' : '❌ Auto-rejected'} — change?
          </span>
          {app.status === 'rejected' && (
            <button className="secondary-btn" style={{ fontSize: 12, padding: '5px 12px' }} onClick={() => onStatus(app.id, 'shortlisted')}>↩ Move to Next Level</button>
          )}
          {app.status === 'shortlisted' && (
            <button style={{ fontSize: 12, padding: '5px 12px', borderRadius: 8, border: '1px solid #EF4444', background: '#FEF2F2', color: '#EF4444', cursor: 'pointer', fontWeight: 600 }} onClick={() => onStatus(app.id, 'rejected')}>↩ Reject</button>
          )}
        </div>
      )}

      {open && r && (
        <div style={{ padding: '0 16px 16px', borderTop: '1px solid var(--border)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginTop: 12, marginBottom: 12 }}>
            <ScoreBar label="Skills"     val={r.skills_match || 0} />
            <ScoreBar label="Experience" val={r.experience_match || 0} />
            <ScoreBar label="Education"  val={r.education_match || 0} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 10, marginBottom: 12 }}>
            <ScoreBar label="Keywords"   val={r.ats?.keyword_match || 0} />
            <ScoreBar label="Format"     val={r.ats?.format_score || 0} />
          </div>

          {r.ats?.matched_keywords?.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontWeight: 600, fontSize: 12, color: '#10B981', marginBottom: 4 }}>✓ Matched Keywords</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {r.ats.matched_keywords.map((k, i) => (
                  <span key={i} style={{ background: '#ECFDF5', color: '#065F46', borderRadius: 4, padding: '2px 8px', fontSize: 11 }}>{k}</span>
                ))}
              </div>
            </div>
          )}
          {r.ats?.missing_keywords?.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontWeight: 600, fontSize: 12, color: '#EF4444', marginBottom: 4 }}>✗ Missing Keywords</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {r.ats.missing_keywords.map((k, i) => (
                  <span key={i} style={{ background: '#FEF2F2', color: '#991B1B', borderRadius: 4, padding: '2px 8px', fontSize: 11 }}>{k}</span>
                ))}
              </div>
            </div>
          )}
          {r.key_strengths?.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 4, color: '#3B82F6' }}>★ Strengths</div>
              {r.key_strengths.map((s, i) => <div key={i} style={{ fontSize: 12, color: 'var(--text-secondary)' }}>• {s}</div>)}
            </div>
          )}
          {r.gaps?.length > 0 && (
            <div>
              <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 4, color: '#F59E0B' }}>⚠ Gaps</div>
              {r.gaps.map((g, i) => <div key={i} style={{ fontSize: 12, color: '#EF4444' }}>• {g}</div>)}
            </div>
          )}
          {r.summary && <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 10, lineHeight: 1.6 }}>{r.summary}</p>}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────── EXAM PENDING ─────────────────────────────── */
function TabPending() {
  const [exams, setExams]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState('');

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const res  = await fetch('/api/exams', { headers: authHeaders() });
      const data = await res.json();
      setExams((Array.isArray(data) ? data : []).filter(e => !e.submitted));
    } catch {}
    finally { setLoading(false); }
  }

  async function deleteExam(id) {
    if (!confirm('Delete this pending exam? The candidate will lose access to it.')) return;
    await fetch(`/api/exams/${id}`, { method: 'DELETE', headers: authHeaders() });
    setExams(ex => ex.filter(e => e.id !== id));
  }

  const filtered = exams.filter(e =>
    !keyword ||
    e.candidateName?.toLowerCase().includes(keyword.toLowerCase()) ||
    e.candidateEmail?.toLowerCase().includes(keyword.toLowerCase())
  );

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
        <input className="form-input" placeholder="🔍 Search…" value={keyword} onChange={e => setKeyword(e.target.value)} style={{ flex: 1, margin: 0 }} />
        <button className="secondary-btn" onClick={load}>↻ Refresh</button>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60 }}><div className="spinner" /></div>
      ) : filtered.length === 0 ? (
        <div className="empty-state"><div style={{ fontSize: 48 }}>⏳</div><h3>No pending exams</h3></div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', background: 'var(--surface)', borderRadius: 12, overflow: 'hidden' }}>
          <thead style={{ background: 'var(--bkash-pink)', color: '#fff' }}>
            <tr>
              {['Candidate', 'Email', 'Sent', 'Expires', 'Time Left', ''].map(h => (
                <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontSize: 13, fontWeight: 700 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map(e => {
              const left = Math.max(0, new Date(e.expiresAt) - Date.now());
              const days = Math.floor(left / 86400000);
              const hrs  = Math.floor((left % 86400000) / 3600000);
              return (
                <tr key={e.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '12px 16px', fontWeight: 600 }}>{e.candidateName}</td>
                  <td style={{ padding: '12px 16px', fontSize: 13, color: 'var(--text-muted)' }}>{e.candidateEmail}</td>
                  <td style={{ padding: '12px 16px', fontSize: 13 }}>{fmtD(e.sentAt)}</td>
                  <td style={{ padding: '12px 16px', fontSize: 13 }}>{fmtD(e.expiresAt)}</td>
                  <td style={{ padding: '12px 16px' }}>
                    <span style={{ color: days < 1 ? '#EF4444' : '#10B981', fontWeight: 600, fontSize: 13 }}>
                      {days}d {hrs}h
                    </span>
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <button
                      onClick={() => deleteExam(e.id)}
                      style={{ fontSize: 12, padding: '5px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-muted)', cursor: 'pointer' }}
                    >🗑</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

/* ─────────────────────────────── EXAM RESULTS ─────────────────────────────── */
function TabResults() {
  const [exams, setExams]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [detail, setDetail]     = useState(null);
  const [detailErr, setDetailErr] = useState('');

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const res  = await fetch('/api/exams', { headers: authHeaders() });
      const data = await res.json();
      setExams((Array.isArray(data) ? data : []).filter(e => e.submitted));
    } catch {}
    finally { setLoading(false); }
  }

  async function setDecision(examId, decision) {
    await fetch(`/api/exams/${examId}/decision`, { method: 'PATCH', headers: authHeaders(), body: JSON.stringify({ decision }) });
    setExams(ex => ex.map(e => e.id === examId ? { ...e, finalDecision: decision } : e));
  }

  async function deleteExam(id) {
    if (!confirm('Delete this exam result permanently?')) return;
    await fetch(`/api/exams/${id}`, { method: 'DELETE', headers: authHeaders() });
    setExams(ex => ex.filter(e => e.id !== id));
  }

  async function openDetail(exam) {
    setDetailErr('');
    try {
      const res  = await fetch(`/api/exams/${exam.id}`, { headers: authHeaders() });
      const data = await res.json();
      setDetail(data);
    } catch { setDetailErr('Failed to load exam details. Please try again.'); }
  }

  return (
    <div>
      {detailErr && (
        <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: '10px 14px', marginBottom: 12, color: '#991B1B', fontSize: 13 }}>
          ⚠ {detailErr}
          <button onClick={() => setDetailErr('')} style={{ float: 'right', background: 'none', border: 'none', cursor: 'pointer', color: '#991B1B', fontWeight: 700 }}>✕</button>
        </div>
      )}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 60 }}><div className="spinner" /></div>
      ) : exams.length === 0 ? (
        <div className="empty-state"><div style={{ fontSize: 48 }}>📊</div><h3>No completed exams yet</h3></div>
      ) : (
        exams.map(e => (
          <div key={e.id} style={{ background: 'var(--surface)', borderRadius: 12, border: '1px solid var(--border)', padding: '16px', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700 }}>{e.candidateName}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{e.candidateEmail} · Completed {fmtD(e.completedAt)}</div>
              </div>
              {e.score && (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontWeight: 700, color: 'var(--bkash-pink)', fontSize: 18 }}>{e.score.percentage?.toFixed(1)}%</span>
                  <span style={{
                    background: e.score.grade === 'Excellent' ? '#ECFDF5' : e.score.grade === 'Good' ? '#EFF6FF' : '#FEF3C7',
                    color:      e.score.grade === 'Excellent' ? '#10B981'  : e.score.grade === 'Good' ? '#3B82F6'  : '#F59E0B',
                    borderRadius: 20, padding: '2px 12px', fontSize: 12, fontWeight: 600,
                  }}>{e.score.grade}</span>
                </div>
              )}
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="secondary-btn" style={{ fontSize: 12, padding: '5px 10px' }} onClick={() => openDetail(e)}>📊 View Details</button>
                {e.finalDecision !== 'selected' && (
                  <button className="run-btn" style={{ fontSize: 12, padding: '5px 10px' }} onClick={() => setDecision(e.id, 'selected')}>✅ Select</button>
                )}
                {e.finalDecision !== 'rejected' && (
                  <button style={{ fontSize: 12, padding: '5px 10px', borderRadius: 8, border: '1px solid #EF4444', background: '#FEF2F2', color: '#EF4444', cursor: 'pointer', fontWeight: 600 }} onClick={() => setDecision(e.id, 'rejected')}>❌ Reject</button>
                )}
                <button
                  onClick={() => deleteExam(e.id)}
                  style={{ fontSize: 12, padding: '5px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-muted)', cursor: 'pointer' }}
                >🗑</button>
              </div>
              {e.finalDecision && (
                <span style={{
                  borderRadius: 20, padding: '3px 12px', fontSize: 12, fontWeight: 700,
                  background: e.finalDecision === 'selected' ? '#ECFDF5' : '#FEF2F2',
                  color:      e.finalDecision === 'selected' ? '#10B981'  : '#EF4444',
                }}>
                  {e.finalDecision === 'selected' ? '✅ Selected' : '❌ Rejected'}
                </span>
              )}
            </div>
          </div>
        ))
      )}

      {detail && <ExamDetailModal detail={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}

/* ─────────────────────────────── EXAM DETAIL MODAL (4 charts) ─────────────── */
function ExamDetailModal({ detail, onClose }) {
  const results = detail.score?.results || [];
  const correctCount = results.filter(q => q.earned > 0).length;
  const wrongCount   = results.length - correctCount;

  const sections = {
    easy:   { e: 0, m: 0, label: 'Easy (Q1–5)' },
    medium: { e: 0, m: 0, label: 'Medium (Q6–10)' },
    hard:   { e: 0, m: 0, label: 'Hard (Q11–15)' },
  };
  results.forEach((q, i) => {
    const s = i < 5 ? 'easy' : i < 10 ? 'medium' : 'hard';
    sections[s].e += q.earned;
    sections[s].m += q.max;
  });

  return (
    <div className="exam-modal" style={{ zIndex: 300 }}>
      <div style={{
        background: 'var(--surface)', borderRadius: 16, maxWidth: 820, width: '95%',
        margin: 'auto', padding: 24, overflowY: 'auto', maxHeight: '90vh',
        boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
          <h3 style={{ fontSize: 18, fontWeight: 700 }}>📊 {detail.candidateName} — Exam Detail</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer' }}>✕</button>
        </div>

        {detail.score && (
          <>
            {/* Score summary */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: 20 }}>
              {[
                ['Score',      `${detail.score.totalEarned}/${detail.score.totalMax}`],
                ['Percentage', `${detail.score.percentage?.toFixed(1)}%`],
                ['Grade',      detail.score.grade],
              ].map(([l, v]) => (
                <div key={l} style={{ background: 'var(--bkash-pink-pale)', borderRadius: 10, padding: 14, textAlign: 'center' }}>
                  <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--bkash-pink)' }}>{v}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{l}</div>
                </div>
              ))}
            </div>

            {/* 4 Charts */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 20 }}>
              <div style={{ background: 'var(--surface-2)', borderRadius: 10, padding: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8 }}>SCORE OVERVIEW</div>
                <DetailDoughnut
                  data={[detail.score.totalEarned, Math.max(0, detail.score.totalMax - detail.score.totalEarned)]}
                  colors={['#E2136E', '#3f3f46']}
                  labels={['Earned', 'Missed']}
                />
              </div>
              <div style={{ background: 'var(--surface-2)', borderRadius: 10, padding: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8 }}>ACCURACY</div>
                <DetailDoughnut
                  data={[correctCount, wrongCount]}
                  colors={['#10B981', '#EF4444']}
                  labels={['Correct', 'Wrong']}
                />
              </div>
              <div style={{ background: 'var(--surface-2)', borderRadius: 10, padding: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8 }}>SECTION BREAKDOWN</div>
                <SectionsBarChart sections={sections} />
              </div>
              <div style={{ background: 'var(--surface-2)', borderRadius: 10, padding: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8 }}>PER-QUESTION SCORES</div>
                <PerQBarChart results={results} />
              </div>
            </div>
          </>
        )}

        {/* Question breakdown */}
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>Question Review</div>
        {results.map((q, i) => {
          const section = i < 5 ? 'Easy' : i < 10 ? 'Medium' : 'Hard';
          const secColor = i < 5 ? { bg: '#ECFDF5', c: '#065F46' } : i < 10 ? { bg: '#EFF6FF', c: '#1E40AF' } : { bg: '#FEF3C7', c: '#92400E' };
          return (
            <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 12, marginBottom: 8, borderLeft: `4px solid ${q.earned > 0 ? '#10B981' : '#EF4444'}` }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 4 }}>
                <span style={{ fontWeight: 700, fontSize: 13 }}>Q{i + 1}.</span>
                <span style={{ background: secColor.bg, color: secColor.c, borderRadius: 4, padding: '1px 7px', fontSize: 11, fontWeight: 600, flexShrink: 0 }}>{section}</span>
                <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>{q.question}</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', paddingLeft: 2 }}>
                Given: <strong style={{ color: q.earned > 0 ? '#10B981' : '#EF4444' }}>{q.given || '—'}</strong>
                &nbsp;|&nbsp; Correct: <strong style={{ color: '#10B981' }}>{q.correct}</strong>
                &nbsp;|&nbsp; <span style={{ fontWeight: 700, color: q.earned > 0 ? '#10B981' : '#EF4444' }}>{q.earned}/{q.max} pts</span>
              </div>
              {q.feedback && (
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 5, fontStyle: 'italic', paddingLeft: 2 }}>{q.feedback}</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DetailDoughnut({ data, colors, labels }) {
  const ref = useRef();
  useEffect(() => {
    const chart = new Chart(ref.current, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{ data, backgroundColor: colors, borderWidth: 0 }],
      },
      options: {
        responsive: true, maintainAspectRatio: true,
        cutout: '68%',
        plugins: {
          legend: { position: 'bottom', labels: { font: { size: 11 }, color: '#8888AA', boxWidth: 12 } },
          tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${ctx.raw}` } },
        },
      },
    });
    return () => chart.destroy();
  }, []);
  return <canvas ref={ref} style={{ maxHeight: 150 }} />;
}

function SectionsBarChart({ sections }) {
  const ref = useRef();
  useEffect(() => {
    const chart = new Chart(ref.current, {
      type: 'bar',
      data: {
        labels: ['Easy (5Q)', 'Medium (5Q)', 'Hard (5Q)'],
        datasets: [
          {
            label: 'Earned',
            data: [sections.easy.e, sections.medium.e, sections.hard.e],
            backgroundColor: '#10B981',
            borderRadius: 4,
          },
          {
            label: 'Missed',
            data: [
              Math.max(0, sections.easy.m   - sections.easy.e),
              Math.max(0, sections.medium.m - sections.medium.e),
              Math.max(0, sections.hard.m   - sections.hard.e),
            ],
            backgroundColor: '#3f3f46',
            borderRadius: 4,
          },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: true,
        scales: {
          x: { stacked: true, grid: { display: false }, ticks: { font: { size: 10 }, color: '#8888AA' } },
          y: { stacked: true, grid: { display: false }, ticks: { font: { size: 10 }, color: '#8888AA' } },
        },
        plugins: { legend: { labels: { font: { size: 10 }, color: '#8888AA', boxWidth: 10 } } },
      },
    });
    return () => chart.destroy();
  }, []);
  return <canvas ref={ref} style={{ maxHeight: 150 }} />;
}

function PerQBarChart({ results }) {
  const ref = useRef();
  useEffect(() => {
    const chart = new Chart(ref.current, {
      type: 'bar',
      data: {
        labels: results.map((_, i) => `Q${i + 1}`),
        datasets: [{
          label: 'Score',
          data: results.map(q => q.earned),
          backgroundColor: results.map(q => q.earned > 0 ? '#E2136E' : '#EF4444'),
          borderRadius: 4,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: true,
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 9 }, color: '#8888AA' } },
          y: { min: 0, grid: { display: false }, ticks: { stepSize: 1, font: { size: 10 }, color: '#8888AA' } },
        },
        plugins: { legend: { display: false } },
      },
    });
    return () => chart.destroy();
  }, []);
  return <canvas ref={ref} style={{ maxHeight: 150 }} />;
}

/* ─────────────────────────────── SHARED ─────────────────────────────── */
function ScoreBar({ label, val = 0 }) {
  const c = val >= 70 ? '#10B981' : val >= 45 ? '#F59E0B' : '#EF4444';
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
        <span style={{ color: 'var(--text-muted)' }}>{label}</span>
        <span style={{ fontWeight: 600, color: c }}>{val}%</span>
      </div>
      <div style={{ height: 6, background: 'var(--border)', borderRadius: 3 }}>
        <div style={{ height: '100%', width: `${val}%`, background: c, borderRadius: 3 }} />
      </div>
    </div>
  );
}
