// BRAINS — auth.js
// Firebase Authentication — Email/Password + Google Sign-In

var _auth     = null;
var _authFns  = null;
var _authReady = false;
var _currentUser = null;

async function auth_init() {
  if (typeof FIREBASE_CONFIG === "undefined") {
    console.warn("BRAINS Auth: Firebase config not found.");
    return;
  }
  try {
    var fbAuth = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js");

    // Use the already-initialized app from database.js
    // Wait for db_init to complete first
    await new Promise(function(resolve) {
      var tries = 0;
      var check = setInterval(function() {
        tries++;
        if (window._firebaseApp || tries > 20) {
          clearInterval(check);
          resolve();
        }
      }, 100);
    });

    _auth    = fbAuth.getAuth(window._firebaseApp);
    _authFns = fbAuth;
    _authReady = true;

    // Listen for login/logout changes
    fbAuth.onAuthStateChanged(_auth, function(user) {
      _currentUser = user;
      if (user) {
        // User is logged in
        showApp(user);
      } else {
        // User is logged out
        showAuthScreen();
      }
    });

    console.log("Firebase Auth ready ✅");
  } catch (err) {
    console.warn("Auth init failed:", err.message);
    // If auth fails, just show the app anyway
    showApp(null);
  }
}

// ── Sign Up with Email ────────────────────────────────────────
async function auth_signUp() {
  var email    = document.getElementById("authEmail").value.trim();
  var password = document.getElementById("authPassword").value;

  if (!email || !password) { authError("Please enter email and password."); return; }
  if (password.length < 6) { authError("Password must be at least 6 characters."); return; }

  setAuthLoading(true);
  try {
    var cred = await _authFns.createUserWithEmailAndPassword(_auth, email, password);
    console.log("Signed up:", cred.user.email);
  } catch (err) {
    authError(friendlyAuthError(err.code));
    setAuthLoading(false);
  }
}

// ── Login with Email ──────────────────────────────────────────
async function auth_login() {
  var email    = document.getElementById("authEmail").value.trim();
  var password = document.getElementById("authPassword").value;

  if (!email || !password) { authError("Please enter email and password."); return; }

  setAuthLoading(true);
  try {
    var cred = await _authFns.signInWithEmailAndPassword(_auth, email, password);
    console.log("Logged in:", cred.user.email);
  } catch (err) {
    authError(friendlyAuthError(err.code));
    setAuthLoading(false);
  }
}

// ── Login with Google ─────────────────────────────────────────
async function auth_google() {
  setAuthLoading(true);
  try {
    var provider = new _authFns.GoogleAuthProvider();
    var cred     = await _authFns.signInWithPopup(_auth, provider);
    console.log("Google sign-in:", cred.user.email);
  } catch (err) {
    authError(friendlyAuthError(err.code));
    setAuthLoading(false);
  }
}

// ── Logout ────────────────────────────────────────────────────
async function auth_logout() {
  if (!_authFns || !_auth) return;
  await _authFns.signOut(_auth);
  _currentUser = null;
}

// ── Get current user ID (for database isolation) ──────────────
function auth_userId() {
  return _currentUser ? _currentUser.uid : "anonymous";
}

function auth_userEmail() {
  return _currentUser ? (_currentUser.displayName || _currentUser.email) : "Guest";
}

// ── UI Helpers ────────────────────────────────────────────────
function showAuthScreen() {
  document.getElementById("authScreen").style.display = "flex";
  document.getElementById("appWrapper").style.display = "none";
}

function showApp(user) {
  document.getElementById("authScreen").style.display = "none";
  document.getElementById("appWrapper").style.display = "block";

  if (user) {
    var name = user.displayName || user.email;
    document.getElementById("userLabel").textContent = name;
    document.getElementById("userAvatar").textContent = name.charAt(0).toUpperCase();
  }
}

function authError(msg) {
  var el = document.getElementById("authError");
  el.textContent = msg;
  el.style.display = "block";
}

function setAuthLoading(on) {
  var btn = document.getElementById("authLoginBtn");
  var su  = document.getElementById("authSignupBtn");
  var gg  = document.getElementById("authGoogleBtn");
  if (btn) btn.disabled = on;
  if (su)  su.disabled  = on;
  if (gg)  gg.disabled  = on;
}

function friendlyAuthError(code) {
  var map = {
    "auth/user-not-found":       "No account found with this email.",
    "auth/wrong-password":       "Incorrect password. Try again.",
    "auth/email-already-in-use": "This email is already registered. Try logging in.",
    "auth/invalid-email":        "Please enter a valid email address.",
    "auth/weak-password":        "Password must be at least 6 characters.",
    "auth/popup-closed-by-user": "Google sign-in was cancelled.",
    "auth/network-request-failed": "Network error. Check your connection.",
    "auth/too-many-requests":    "Too many attempts. Please wait and try again.",
    "auth/invalid-credential":   "Incorrect email or password.",
  };
  return map[code] || "Something went wrong. Please try again.";
}

function toggleAuthMode() {
  var loginBtns  = document.getElementById("loginBtns");
  var signupBtns = document.getElementById("signupBtns");
  var title      = document.getElementById("authTitle");
  var toggle     = document.getElementById("authToggle");
  var err        = document.getElementById("authError");
  err.style.display = "none";

  if (loginBtns.style.display === "none") {
    loginBtns.style.display  = "flex";
    signupBtns.style.display = "none";
    title.textContent  = "Welcome back";
    toggle.textContent = "Don't have an account? Sign up";
  } else {
    loginBtns.style.display  = "none";
    signupBtns.style.display = "flex";
    title.textContent  = "Create account";
    toggle.textContent = "Already have an account? Log in";
  }
}

// Start auth
auth_init();