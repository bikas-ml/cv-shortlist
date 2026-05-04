import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { authHeaders } from '../utils/auth';

export default function Header({ showNav = false }) {
  const { session, logout } = useAuth();
  const location = useLocation();

  async function handleLogout() {
    try {
      await fetch('/api/auth/logout', { method: 'POST', headers: authHeaders() });
    } catch { /* ignore */ }
    logout();
  }

  return (
    <header className="app-header">
      <div className="header-brand">
        <div className="header-logo">⚡</div>
        <div>
          <div className="header-title">CV Shortlister</div>
          <div className="header-sub">AI Recruitment Platform</div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        {showNav && session && (
          <nav className="module-nav">
            <Link to="/hr"  className={`mod-btn ${location.pathname === '/hr'  ? 'mod-active' : ''}`}>
              🏢 HR Module
            </Link>
            <Link to="/ats" className={`mod-btn ${location.pathname === '/ats' ? 'mod-active' : ''}`}>
              📊 ATS Dashboard
            </Link>
          </nav>
        )}

        {session && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ color: 'rgba(255,255,255,0.8)', fontSize: '13px' }}>
              {session.name}
            </span>
            <button className="logout-btn" onClick={handleLogout}>
              Logout
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
