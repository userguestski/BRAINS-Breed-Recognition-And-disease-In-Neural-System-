/**
 * BRAINS — database.js
 * Firebase Firestore integration for saving and loading diagnosis history.
 * All history is saved to the cloud — accessible from any device.
 *
 * HOW TO SET UP FIREBASE (free, 5 minutes):
 * 1. Go to firebase.google.com → Sign in with Google
 * 2. Click "Create a project" → give it any name
 * 3. Go to "Build" → "Firestore Database" → Create database → Start in test mode
 * 4. Go to Project Settings (gear icon) → "Your apps" → Web app (</>)
 * 5. Register app, copy the firebaseConfig object values below
 * 6. Replace the placeholder values with your actual config
 */

// ─────────────────────────────────────────────────────────────
// REPLACE THESE WITH YOUR ACTUAL FIREBASE CONFIG VALUES
// Get them from: Firebase Console → Project Settings → Your Apps
// ─────────────────────────────────────────────────────────────
const FIREBASE_CONFIG = {
  apiKey:            "YOUR_FIREBASE_API_KEY",
  authDomain:        "YOUR_PROJECT.firebaseapp.com",
  projectId:         "YOUR_PROJECT_ID",
  storageBucket:     "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId:             "YOUR_APP_ID"
};

// ─────────────────────────────────────────────────────────────
// Initialize Firebase
// This runs as soon as the page loads
// ─────────────────────────────────────────────────────────────
(function initFirebase() {
  // Check if the placeholder values are still there
  if (FIREBASE_CONFIG.apiKey === "YOUR_FIREBASE_API_KEY") {
    console.warn(
      "BRAINS: Firebase not configured. " +
      "History will use localStorage as fallback. " +
      "Update FIREBASE_CONFIG in database.js to enable cloud history."
    );
    window.__firebaseReady = false;
    return;
  }

  // Call the initializer defined in index.html (loads Firebase SDK from CDN)
  if (window.__initFirebase) {
    window.__initFirebase(FIREBASE_CONFIG);
  } else {
    // Retry after SDK loads
    setTimeout(() => {
      if (window.__initFirebase) window.__initFirebase(FIREBASE_CONFIG);
    }, 500);
  }
})();


// ─────────────────────────────────────────────────────────────
// DATABASE API
// These functions are called from script.js
// They try Firebase first, fall back to localStorage if Firebase
// is not configured — so the app always works even without Firebase
// ─────────────────────────────────────────────────────────────

/**
 * Save a diagnosis report to the database.
 * @param {object} report - The full report object from the backend
 * @param {string} imageDataUrl - Base64 image for thumbnail
 */
async function db_saveReport(report, imageDataUrl) {
  const record = {
    id:             report.record_id,
    breed:          report.breed_prediction    || "Unknown",
    species:        report.common_name         || "Unknown",
    topDiagnosis:   report.differentials?.[0]?.condition || "—",
    ageBand:        report.estimated_age_band  || "—",
    prognosis:      report.prognosis           || "—",
    emergency:      (report.emergency_flags?.length || 0) > 0,
    safeToProced:   report.safe_to_proceed     ?? true,
    imageThumb:     imageDataUrl               || null,
    timestamp:      report.timestamp           || new Date().toISOString(),
    fullReport:     report,
  };

  // Try Firebase
  if (window.__firebaseReady && window.__db) {
    try {
      const { collection, doc, setDoc } = await import(
        "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js"
      );
      await setDoc(doc(collection(window.__db, "diagnoses"), record.id), record);
      console.log("Saved to Firebase:", record.id);
      return { success: true, source: "firebase" };
    } catch (err) {
      console.warn("Firebase save failed, using localStorage:", err.message);
    }
  }

  // Fallback: localStorage
  db_local_save(record);
  return { success: true, source: "localStorage" };
}


/**
 * Load all diagnosis history records.
 * @returns {Array} Array of history records sorted newest first
 */
async function db_loadHistory() {
  // Try Firebase
  if (window.__firebaseReady && window.__db) {
    try {
      const { collection, getDocs, orderBy, query } = await import(
        "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js"
      );
      const q = query(
        collection(window.__db, "diagnoses"),
        orderBy("timestamp", "desc")
      );
      const snapshot = await getDocs(q);
      const records = [];
      snapshot.forEach(docSnap => records.push(docSnap.data()));
      return records;
    } catch (err) {
      console.warn("Firebase load failed, using localStorage:", err.message);
    }
  }

  // Fallback: localStorage
  return db_local_getAll();
}


/**
 * Delete a single diagnosis record by ID.
 * @param {string} id - The record ID (e.g. "BR-XXXXX")
 */
async function db_deleteRecord(id) {
  // Try Firebase
  if (window.__firebaseReady && window.__db) {
    try {
      const { doc, deleteDoc, collection } = await import(
        "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js"
      );
      await deleteDoc(doc(collection(window.__db, "diagnoses"), id));
      return { success: true, source: "firebase" };
    } catch (err) {
      console.warn("Firebase delete failed, using localStorage:", err.message);
    }
  }

  // Fallback: localStorage
  db_local_delete(id);
  return { success: true, source: "localStorage" };
}


/**
 * Delete ALL history records.
 */
async function db_clearAll() {
  // Try Firebase
  if (window.__firebaseReady && window.__db) {
    try {
      const { collection, getDocs, doc, deleteDoc } = await import(
        "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js"
      );
      const snapshot = await getDocs(collection(window.__db, "diagnoses"));
      const deletions = [];
      snapshot.forEach(d => deletions.push(deleteDoc(doc(window.__db, "diagnoses", d.id))));
      await Promise.all(deletions);
      return { success: true };
    } catch (err) {
      console.warn("Firebase clearAll failed:", err.message);
    }
  }
  localStorage.removeItem("brains_history");
  return { success: true };
}


// ─────────────────────────────────────────────────────────────
// LOCAL STORAGE FALLBACK HELPERS
// Used when Firebase is not configured
// ─────────────────────────────────────────────────────────────

function db_local_save(record) {
  const all = db_local_getAll();
  // Remove if exists (update)
  const filtered = all.filter(r => r.id !== record.id);
  // Add new at front
  filtered.unshift(record);
  // Keep max 50 records in localStorage
  const trimmed = filtered.slice(0, 50);
  localStorage.setItem("brains_history", JSON.stringify(trimmed));
}

function db_local_getAll() {
  try {
    return JSON.parse(localStorage.getItem("brains_history") || "[]");
  } catch {
    return [];
  }
}

function db_local_delete(id) {
  const all = db_local_getAll().filter(r => r.id !== id);
  localStorage.setItem("brains_history", JSON.stringify(all));
}


// ─────────────────────────────────────────────────────────────
// Check if Firebase is properly configured
// Returns: "firebase" | "localStorage"
// ─────────────────────────────────────────────────────────────
function db_getStorageType() {
  return (window.__firebaseReady && window.__db) ? "firebase" : "localStorage";
}
