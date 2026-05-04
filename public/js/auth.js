"use strict";

const AUTH_KEY = "ats_session";

function getSession() {
  try { return JSON.parse(sessionStorage.getItem(AUTH_KEY) || "null"); }
  catch { return null; }
}

function saveSession(data) {
  sessionStorage.setItem(AUTH_KEY, JSON.stringify(data));
}

function clearSession() {
  sessionStorage.removeItem(AUTH_KEY);
  sessionStorage.removeItem("ats_token"); // legacy cleanup
}

function requireAuth(requiredRole) {
  const s = getSession();
  if (!s) { window.location.replace("/login"); return null; }
  if (requiredRole && s.role !== requiredRole) {
    window.location.replace(s.role === "hr" ? "/" : "/dashboard");
    return null;
  }
  return s;
}

function authHeaders(extra) {
  const s = getSession();
  return { "Authorization": `Bearer ${s ? s.token : ""}`, "Content-Type": "application/json", ...(extra || {}) };
}

async function logout() {
  try {
    await fetch("/api/auth/logout", { method: "POST", headers: authHeaders() });
  } catch {}
  clearSession();
  window.location.replace("/login");
}

function redirectAfterLogin(role) {
  window.location.replace(role === "hr" ? "/" : "/dashboard");
}
