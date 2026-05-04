const SESSION_KEY = 'ats_session';

export function getSession() {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
  } catch {
    return null;
  }
}

export function saveSession(data) {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(data));
}

export function clearSession() {
  sessionStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem('ats_token');
}

export function authHeaders(extra = {}) {
  const session = getSession();
  return {
    Authorization: `Bearer ${session?.token || ''}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

export function authHeadersFormData() {
  const session = getSession();
  return { Authorization: `Bearer ${session?.token || ''}` };
}

export async function logout() {
  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      headers: authHeaders(),
    });
  } catch {
    // ignore
  }
  clearSession();
  window.location.href = '/login';
}
