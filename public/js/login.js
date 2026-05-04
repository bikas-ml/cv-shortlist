"use strict";

/* ── Skip if already authenticated ─────────────────────────────────────── */
(function () {
  try {
    const s = JSON.parse(sessionStorage.getItem("ats_session") || "null");
    if (s?.token) window.location.replace(s.role === "hr" ? "/hr" : "/dashboard");
  } catch {}
})();

/* ── DOM refs ─────────────────────────────────────────────────────────── */
const loginForm     = document.getElementById("loginForm");
const emailInput    = document.getElementById("emailInput");
const nameWrap      = document.getElementById("nameWrap");
const nameInput     = document.getElementById("nameInput");
const passwordInput = document.getElementById("passwordInput");
const loginBtn      = document.getElementById("loginBtn");
const loginLabel    = document.getElementById("loginLabel");
const errorMsg      = document.getElementById("errorMsg");
const errorText     = document.getElementById("errorText");
const pwToggle      = document.getElementById("pwToggle");
const tabSignin     = document.getElementById("tabSignin");
const tabSignup     = document.getElementById("tabSignup");
const modeTabs      = document.getElementById("modeTabs");
const formHeading   = document.getElementById("formHeading");
const formSubheading= document.getElementById("formSubheading");
const hrBadge       = document.getElementById("hrBadge");
const switchMode    = document.getElementById("switchMode");
const switchBtn     = document.getElementById("switchBtn");

const HR_EMAIL = "ai@sysnova.com";

/* ── Mode state ─────────────────────────────────────────────────────────── */
let mode = "signin"; // "signin" | "signup"

function setMode(m) {
  mode = m;
  hideError();

  const isSignup = m === "signup";

  /* Tab highlight */
  tabSignin.classList.toggle("active", !isSignup);
  tabSignup.classList.toggle("active",  isSignup);

  /* Name field visibility */
  nameWrap.classList.toggle("hidden-field", !isSignup);
  if (!isSignup) nameInput.value = "";

  /* Heading & subheading */
  formHeading.textContent    = isSignup ? "Create your account"   : "Welcome back";
  formSubheading.textContent = isSignup
    ? "Fill in the details below to get started"
    : "Sign in to continue to your account";

  /* Button label */
  loginLabel.textContent = isSignup ? "Create Account" : "Sign In";

  /* Password autocomplete hint */
  passwordInput.setAttribute(
    "autocomplete",
    isSignup ? "new-password" : "current-password"
  );
  passwordInput.placeholder = isSignup ? "Choose a password" : "Enter your password";

  /* Switch mode link */
  switchMode.innerHTML = isSignup
    ? `Already have an account? <button type="button" class="switch-link" id="switchBtn">Sign In</button>`
    : `Don't have an account? <button type="button" class="switch-link" id="switchBtn">Create one</button>`;
  document.getElementById("switchBtn").addEventListener("click", toggleMode);
}

function toggleMode() {
  setMode(mode === "signin" ? "signup" : "signin");
}

/* ── HR email detection ─────────────────────────────────────────────────── */
emailInput.addEventListener("input", () => {
  hideError();
  const isHR = emailInput.value.trim().toLowerCase() === HR_EMAIL;

  if (isHR) {
    /* Force sign-in, hide tabs and sign-up option */
    mode = "signin";
    modeTabs.classList.add("hidden-field");
    switchMode.classList.add("hidden-field");
    nameWrap.classList.add("hidden-field");
    hrBadge.classList.add("visible");
    formHeading.textContent    = "HR Administrator";
    formSubheading.textContent = "Sign in with your admin credentials";
    loginLabel.textContent     = "Sign In";
    tabSignin.classList.add("active");
    tabSignup.classList.remove("active");
  } else {
    modeTabs.classList.remove("hidden-field");
    switchMode.classList.remove("hidden-field");
    hrBadge.classList.remove("visible");
    /* Restore heading based on current mode */
    setMode(mode);
  }
});

/* ── Tab click handlers ─────────────────────────────────────────────────── */
tabSignin.addEventListener("click", () => setMode("signin"));
tabSignup.addEventListener("click", () => setMode("signup"));
switchBtn.addEventListener("click", toggleMode);

/* ── Password show/hide ─────────────────────────────────────────────────── */
pwToggle.addEventListener("click", () => {
  const show = passwordInput.type === "password";
  passwordInput.type  = show ? "text" : "password";
  pwToggle.textContent = show ? "🙈" : "👁";
});

/* ── Error helpers ──────────────────────────────────────────────────────── */
function showError(msg) { errorText.textContent = msg; errorMsg.classList.add("visible"); }
function hideError()    { errorMsg.classList.remove("visible"); }

emailInput.addEventListener("input",    hideError);
passwordInput.addEventListener("input", hideError);

/* ── Form submit ─────────────────────────────────────────────────────────── */
loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  hideError();

  const email    = emailInput.value.trim();
  const password = passwordInput.value;
  const name     = nameInput.value.trim();
  const isHR     = email.toLowerCase() === HR_EMAIL;
  const isSignup = mode === "signup" && !isHR;

  /* Validation */
  if (!email) { showError("Please enter your email address."); emailInput.focus(); return; }
  if (!password) { showError("Please enter your password."); passwordInput.focus(); return; }
  if (isSignup && !name) { showError("Please enter your full name."); nameInput.focus(); return; }

  loginBtn.classList.add("loading");
  loginBtn.disabled = true;

  try {
    const res  = await fetch("/api/auth/login", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({
        email,
        password,
        name: isSignup ? name : undefined,
      }),
    });
    const data = await res.json();

    if (res.ok && data.token) {
      sessionStorage.setItem("ats_session", JSON.stringify({
        token: data.token,
        role:  data.role,
        name:  data.name,
        email: data.email,
      }));
      window.location.replace(data.role === "hr" ? "/hr" : "/dashboard");
    } else {
      showError(data.detail || "Invalid email or password.");
    }
  } catch {
    showError("Could not reach the server. Please try again.");
  } finally {
    loginBtn.classList.remove("loading");
    loginBtn.disabled = false;
  }
});
