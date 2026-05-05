import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
const HR_EMAIL = 'ai@sysnova.com';

export default function Login() {
  const [mode, setMode]       = useState('signin'); // 'signin' | 'signup'
  const [email, setEmail]     = useState('');
  const [password, setPass]   = useState('');
  const [name, setName]       = useState('');
  const [showPw, setShowPw]   = useState(false);
  const [error, setError]     = useState('');
  const [loading, setLoading] = useState(false);
  const [isHR, setIsHR]       = useState(false);

  const { login, session } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (session) navigate(session.role === 'hr' ? '/hr' : '/dashboard', { replace: true });
  }, [session]);

  function onEmailChange(e) {
    const val = e.target.value;
    setEmail(val);
    if (val.toLowerCase() === HR_EMAIL) {
      setIsHR(true);
      setMode('signin');
    } else {
      setIsHR(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!email || !password) { setError('Please fill in all fields.'); return; }
    if (mode === 'signup' && !name) { setError('Please enter your full name.'); return; }

    setLoading(true);
    try {
      const res  = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, name: mode === 'signup' ? name : undefined }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Login failed.'); return; }
      login(data);
      navigate(data.role === 'hr' ? '/hr' : '/dashboard', { replace: true });
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px 16px', boxSizing: 'border-box' }}>
      <div className="auth-card" style={{ position: 'relative', zIndex: 1 }}>
        <div className="auth-logo">⚡</div>
        <h2 className="auth-title">CV Shortlister</h2>
        <p className="auth-sub">AI-Powered Recruitment Platform</p>

        {!isHR && (
          <div className="auth-tabs">
            <button className={`auth-tab ${mode === 'signin' ? 'active' : ''}`} onClick={() => { setMode('signin'); setError(''); }}>
              Sign In
            </button>
            <button className={`auth-tab ${mode === 'signup' ? 'active' : ''}`} onClick={() => { setMode('signup'); setError(''); }}>
              Sign Up
            </button>
          </div>
        )}

        {isHR && (
          <div style={{ textAlign: 'center', marginBottom: 16 }}>
            <span className="hr-badge">👤 HR Administrator</span>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          {mode === 'signup' && !isHR && (
            <div className="form-group">
              <label className="form-label">Full Name</label>
              <input
                className="form-input"
                type="text"
                placeholder="Your full name"
                value={name}
                onChange={e => setName(e.target.value)}
              />
            </div>
          )}

          <div className="form-group">
            <label className="form-label">Email Address</label>
            <input
              className="form-input"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={onEmailChange}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Password</label>
            <div style={{ position: 'relative' }}>
              <input
                className="form-input"
                type={showPw ? 'text' : 'password'}
                placeholder="••••••••"
                value={password}
                onChange={e => setPass(e.target.value)}
                style={{ paddingRight: 44 }}
              />
              <button
                type="button"
                onClick={() => setShowPw(v => !v)}
                style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 16 }}
              >
                {showPw ? '🙈' : '👁'}
              </button>
            </div>
          </div>

          {error && <div className="auth-error">{error}</div>}

          <button className="auth-submit-btn" type="submit" disabled={loading}>
            {loading ? <span className="spinner-sm" /> : mode === 'signup' ? 'Create Account' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}
