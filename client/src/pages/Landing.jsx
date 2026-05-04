import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { authHeaders } from '../utils/auth';
import NeuralNetworkBg from '../components/NeuralNetworkBg';
import Header from '../components/Header';

export default function Landing() {
  const { session, logout } = useAuth();
  const navigate = useNavigate();

  if (session?.role === 'hr')   navigate('/hr',        { replace: true });
  if (session?.role === 'user') navigate('/dashboard', { replace: true });

  async function handleLogout() {
    try { await fetch('/api/auth/logout', { method: 'POST', headers: authHeaders() }); } catch {}
    logout();
    navigate('/login');
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      <NeuralNetworkBg />
      <div style={{ position: 'relative', zIndex: 1 }}>
        <Header />
        <main className="page" style={{ padding: '40px 24px', maxWidth: 900, margin: '0 auto' }}>
          <div className="hero" style={{ textAlign: 'center', marginBottom: 40 }}>
            <div className="hero-badge">AI-Powered Recruitment</div>
            <h1 className="hero-title">Smart Hiring Platform</h1>
            <p className="hero-desc">
              Upload CVs, get instant AI analysis against job descriptions, and manage your entire hiring pipeline — all in one place.
            </p>
          </div>
          <div className="cards" style={{ display: 'flex', justifyContent: 'center', gap: 24 }}>
            <div className="module-card" onClick={() => navigate('/hr')} style={{ cursor: 'pointer' }}>
              <div className="module-card-icon">🏢</div>
              <div className="module-card-title">HR Module</div>
              <div className="module-card-desc">
                Batch CV analysis, candidate shortlisting, exam management and final hiring decisions.
              </div>
              <button className="module-card-btn">Enter HR Module →</button>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
