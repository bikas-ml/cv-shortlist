import { useState, useRef, useEffect } from 'react';

const STEPS = {
  cv: [
    [0,  'Reading CV content…'],
    [22, 'Running AI evaluation…'],
    [50, 'Calculating ATS scores…'],
    [75, 'Finalising results…'],
  ],
  questions: [
    [0,  'Analysing job description…'],
    [20, 'Generating easy questions…'],
    [45, 'Generating medium questions…'],
    [68, 'Generating hard questions…'],
  ],
  batch: [
    [0,  'Reading CV files…'],
    [15, 'Running AI evaluation…'],
    [48, 'Scoring candidates…'],
    [72, 'Ranking results…'],
  ],
  analyze: [
    [0,  'Loading CV data…'],
    [20, 'Running AI analysis…'],
    [55, 'Calculating scores…'],
    [80, 'Updating records…'],
  ],
};

function getLabel(progress, type) {
  const steps = STEPS[type] || STEPS.cv;
  let label = steps[0][1];
  for (const [threshold, msg] of steps) {
    if (progress >= threshold) label = msg;
  }
  return label;
}

export function useSimProgress(type = 'cv') {
  const [progress, setProgress] = useState(0);
  const timerRef = useRef(null);

  function start() {
    setProgress(2);
    let cur = 2;
    timerRef.current = setInterval(() => {
      const inc = Math.random() * 7 * Math.pow(1 - cur / 92, 1.8);
      cur = Math.min(cur + inc, 88);
      setProgress(Math.round(cur));
    }, 650);
  }

  function finish() {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    setProgress(100);
    setTimeout(() => setProgress(0), 700);
  }

  function reset() {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    setProgress(0);
  }

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);

  const label = getLabel(progress, type);
  const active = progress > 0;
  return { progress, label, active, start, finish, reset };
}

export function AIProgressBar({ progress, label, style = {} }) {
  if (!progress) return null;
  const done = progress === 100;
  return (
    <div style={{ marginBottom: 18, ...style }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 7 }}>
        <span style={{ fontSize: 13, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 7 }}>
          {!done && (
            <span style={{
              display: 'inline-block', width: 12, height: 12, borderRadius: '50%',
              border: '2px solid #E2136E', borderTopColor: 'transparent',
              animation: 'spin 0.7s linear infinite',
            }} />
          )}
          {done ? '✅ Done!' : label}
        </span>
        <span style={{ fontSize: 13, fontWeight: 700, color: done ? '#10B981' : 'var(--bkash-pink)' }}>
          {progress}%
        </span>
      </div>
      <div style={{ height: 8, background: 'var(--border)', borderRadius: 99, overflow: 'hidden' }}>
        <div style={{
          height: '100%',
          width: `${progress}%`,
          background: done
            ? '#10B981'
            : 'linear-gradient(90deg, #E2136E 0%, #f43f5e 60%, #fb7185 100%)',
          borderRadius: 99,
          transition: 'width 0.45s cubic-bezier(0.4, 0, 0.2, 1)',
          boxShadow: done ? 'none' : '0 0 8px rgba(226,19,110,0.4)',
        }} />
      </div>
    </div>
  );
}
