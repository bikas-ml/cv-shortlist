import { useState, useEffect, useRef } from 'react';
import {
  Chart, RadarController, RadialLinearScale, PointElement, LineElement,
  BarElement, CategoryScale, LinearScale, Tooltip, Legend, Filler,
} from 'chart.js';

Chart.register(
  RadarController, RadialLinearScale, PointElement, LineElement,
  BarElement, CategoryScale, LinearScale, Tooltip, Legend, Filler,
);

function scoreClass(s) {
  if (s >= 70) return 'high';
  if (s >= 45) return 'mid';
  return 'low';
}

function ScoreBar({ label, val = 0 }) {
  const c = val >= 70 ? '#10B981' : val >= 45 ? '#F59E0B' : '#EF4444';
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
        <span style={{ color: 'var(--text-muted)', width: 110, flexShrink: 0 }}>{label}</span>
        <div style={{ flex: 1, height: 6, background: 'var(--border)', borderRadius: 99, margin: '0 8px', alignSelf: 'center' }}>
          <div style={{ height: '100%', width: `${val}%`, background: 'var(--bkash-pink)', borderRadius: 99 }} />
        </div>
        <span style={{ fontWeight: 600, color: c, width: 34, textAlign: 'right' }}>{val}%</span>
      </div>
    </div>
  );
}

function RadarChart({ r, id }) {
  const ref = useRef();
  useEffect(() => {
    const scores = [
      r.skills_match || 0,
      r.experience_match || 0,
      r.education_match || 0,
      r.ats?.keyword_match || 0,
      r.ats?.format_score || 0,
    ];
    const chart = new Chart(ref.current, {
      type: 'radar',
      data: {
        labels: ['Skills', 'Experience', 'Education', 'Keywords', 'Format'],
        datasets: [{
          data: scores,
          backgroundColor: 'rgba(226,19,110,0.15)',
          borderColor: '#E2136E',
          borderWidth: 2,
          pointBackgroundColor: '#E2136E',
          pointRadius: 4,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: true,
        scales: {
          r: {
            min: 0, max: 100,
            grid: { color: '#3f3f46' },
            ticks: { display: false },
            pointLabels: { font: { size: 10 }, color: '#8888AA' },
          },
        },
        plugins: { legend: { display: false } },
      },
    });
    return () => chart.destroy();
  }, []);
  return <canvas ref={ref} style={{ maxHeight: 200 }} />;
}

function HistogramChart({ r }) {
  const ref = useRef();
  useEffect(() => {
    const scores = [
      r.skills_match || 0,
      r.experience_match || 0,
      r.education_match || 0,
      r.ats?.keyword_match || 0,
      r.ats?.format_score || 0,
    ];
    const colors = ['#E2136E','#C0105C','#f43f5e','#00B4D8','#F59E0B'];
    const chart = new Chart(ref.current, {
      type: 'bar',
      data: {
        labels: ['Skills','Experience','Education','Keywords','Format'],
        datasets: [{
          data: scores,
          backgroundColor: colors,
          borderRadius: 6,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: true,
        scales: {
          y: { min: 0, max: 100, grid: { display: false }, ticks: { callback: v => v + '%', font: { size: 10 } } },
          x: { grid: { display: false }, ticks: { font: { size: 10 } } },
        },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ctx.parsed.y + '%' } } },
      },
    });
    return () => chart.destroy();
  }, []);
  return <canvas ref={ref} style={{ maxHeight: 160 }} />;
}

function SkillBreakdown({ r }) {
  const [open, setOpen] = useState(false);
  const matched = r.ats?.matched_keywords || [];
  const missing = r.ats?.missing_keywords || [];
  const strengths = r.key_strengths || [];
  const gaps = r.gaps || [];
  const total = matched.length + missing.length;
  const pct = total > 0 ? Math.round((matched.length / total) * 100) : 0;

  return (
    <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 13, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6, padding: 0 }}
      >
        🔍 Skill Match Breakdown <span style={{ fontSize: 11 }}>{open ? '▴' : '▾'}</span>
      </button>

      {open && (
        <div style={{ marginTop: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <div style={{ flex: 1, height: 8, background: 'var(--border)', borderRadius: 99 }}>
              <div style={{ height: '100%', width: `${pct}%`, background: pct >= 70 ? '#10B981' : pct >= 45 ? '#F59E0B' : '#EF4444', borderRadius: 99 }} />
            </div>
            <span style={{ fontSize: 12, fontWeight: 700, color: pct >= 70 ? '#10B981' : pct >= 45 ? '#F59E0B' : '#EF4444' }}>
              {matched.length} of {total} keywords ({pct}%)
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: 12 }}>
            <div>
              <div style={{ fontWeight: 700, color: '#10B981', marginBottom: 6 }}>✓ Present ({matched.length})</div>
              {matched.map((k, i) => (
                <div key={i} style={{ background: '#ECFDF5', color: '#065F46', borderRadius: 4, padding: '2px 8px', marginBottom: 3, display: 'inline-block', marginRight: 4 }}>{k}</div>
              ))}
              {strengths.length > 0 && (
                <>
                  <div style={{ fontWeight: 700, color: '#3B82F6', marginBottom: 4, marginTop: 8 }}>★ Strengths</div>
                  {strengths.map((s, i) => <div key={i} style={{ color: 'var(--text-secondary)', marginBottom: 2 }}>• {s}</div>)}
                </>
              )}
            </div>
            <div>
              <div style={{ fontWeight: 700, color: '#EF4444', marginBottom: 6 }}>✗ Missing ({missing.length})</div>
              {missing.map((k, i) => (
                <div key={i} style={{ background: '#FEF2F2', color: '#991B1B', borderRadius: 4, padding: '2px 8px', marginBottom: 3, display: 'inline-block', marginRight: 4 }}>{k}</div>
              ))}
              {gaps.length > 0 && (
                <>
                  <div style={{ fontWeight: 700, color: '#F59E0B', marginBottom: 4, marginTop: 8 }}>⚠ Gaps</div>
                  {gaps.map((g, i) => <div key={i} style={{ color: 'var(--text-secondary)', marginBottom: 2 }}>• {g}</div>)}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function CandidateCard({ r, rank, onExam, examLabel = '🎓 Take Exam', showExamBtn = true }) {
  const [open, setOpen] = useState(false);
  const ai   = r.ai_score || r.overall_score || 0;
  const ats  = r.ats?.combined_ats_score || r.ats?.ats_score || 0;
  const comb = r.combined_score || 0;

  return (
    <div className="candidate-card" style={{ marginBottom: 12 }}>
      <div className="card-header" onClick={() => setOpen(o => !o)} style={{ cursor: 'pointer' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}>
          <span className={`rank-badge rank-${rank <= 3 ? rank : 'other'}`}>#{rank}</span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {r.candidate_name || r.candidateName || 'Candidate'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {r.filename || r.fileName || ''}{r.years_of_experience ? ` · ${r.years_of_experience} yrs exp` : ''}
            </div>
          </div>
        </div>
        <div className="card-pills" style={{ flexShrink: 0 }}>
          <span className={`pill pill-ats ${scoreClass(ats)}`}>ATS {ats}%</span>
          <span className={`verdict-badge ${r.shortlisted ? 'shortlisted' : 'rejected'}`}>
            {r.shortlisted ? '✅ Shortlisted' : '❌ Not Relevant'}
          </span>
        </div>
        {showExamBtn && r.shortlisted && onExam && (
          <button
            className="hr-exam-btn"
            onClick={e => { e.stopPropagation(); onExam(r); }}
            style={{ flexShrink: 0 }}
          >
            {examLabel}
          </button>
        )}
        <span style={{ marginLeft: 8, color: 'var(--text-muted)', fontSize: 16, flexShrink: 0 }}>{open ? '▲' : '▼'}</span>
      </div>

      {open && (
        <div className="card-body">
          {/* Missing Requirements */}
          {(r.missing_requirements?.length > 0 || r.ats?.missing_keywords?.length > 0) ? (
            <div className="missing-panel" style={{ marginBottom: 14 }}>
              <div className="missing-panel-title">⚠ What's Missing</div>
              {r.missing_requirements?.map((m, i) => <div key={i} className="missing-item">• {m}</div>)}
              {r.ats?.missing_keywords?.length > 0 && (
                <div style={{ marginTop: 4, fontSize: 12, color: '#92400E' }}>
                  Missing keywords: {r.ats.missing_keywords.slice(0, 8).join(', ')}
                </div>
              )}
            </div>
          ) : (
            <div style={{ background: '#ECFDF5', border: '1px solid #6EE7B7', borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 13, color: '#065F46' }}>
              ✅ All key requirements met — this candidate is a strong match!
            </div>
          )}

          {/* Sub-score bars */}
          <div style={{ marginBottom: 14 }}>
            <ScoreBar label="AI Score"      val={ai} />
            <ScoreBar label="Skills Match"  val={r.skills_match || 0} />
            <ScoreBar label="Experience"    val={r.experience_match || 0} />
            <ScoreBar label="Education"     val={r.education_match || 0} />
            <ScoreBar label="Keyword Match" val={r.ats?.keyword_match || 0} />
          </div>

          {/* Charts row */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 14 }}>
            <div style={{ background: 'var(--surface)', borderRadius: 10, padding: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>RADAR ANALYSIS</div>
              <RadarChart r={r} id={rank} />
            </div>
            <div style={{ background: 'var(--surface)', borderRadius: 10, padding: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>SCORE BREAKDOWN</div>
              <HistogramChart r={r} />
            </div>
          </div>

          {/* Format notes */}
          {r.ats?.format_notes?.length > 0 && (
            <div style={{ background: 'var(--surface-2)', borderRadius: 8, padding: 10, marginBottom: 12, fontSize: 12, color: 'var(--text-secondary)' }}>
              <strong>Format Notes:</strong>
              {r.ats.format_notes.map((n, i) => <div key={i}>• {n}</div>)}
            </div>
          )}

          {/* Summary */}
          {r.summary && (
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12, lineHeight: 1.6 }}>{r.summary}</p>
          )}

          {/* Skill breakdown toggle */}
          <SkillBreakdown r={r} />
        </div>
      )}
    </div>
  );
}
