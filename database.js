// BRAINS — database.js
// No API keys here — config is loaded from index.html

var _db    = null;
var _fns   = null;
var _ready = false;

async function db_init() {
  // FIREBASE_CONFIG is defined in index.html <script> block
  if (typeof FIREBASE_CONFIG === "undefined" || FIREBASE_CONFIG.apiKey === "YOUR_FIREBASE_API_KEY") {
    console.warn("BRAINS: Firebase not configured. Using localStorage.");
    return;
  }
  try {
    var fbApp   = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js");
    var fbStore = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
    var app = fbApp.initializeApp(FIREBASE_CONFIG);
    _db   = fbStore.getFirestore(app);
    _fns  = fbStore;
    _ready = true;
    console.log("Firebase connected ✅");
  } catch (err) {
    console.warn("Firebase failed:", err.message);
  }
}

db_init();

async function db_saveReport(report, imageDataUrl) {
  var record = {
    id:           report.record_id,
    breed:        report.breed_prediction   || "Unknown",
    species:      report.common_name        || "Unknown",
    topDiagnosis: report.differentials && report.differentials[0] ? report.differentials[0].condition : "—",
    ageBand:      report.estimated_age_band || "—",
    prognosis:    report.prognosis          || "—",
    emergency:    (report.emergency_flags   || []).length > 0,
    safeToProced: report.safe_to_proceed    !== false,
    imageThumb:   imageDataUrl              || null,
    timestamp:    report.timestamp          || new Date().toISOString(),
    fullReport:   report,
  };

  if (_ready && _db) {
    try {
      await _fns.setDoc(_fns.doc(_fns.collection(_db, "diagnoses"), record.id), record);
      console.log("Saved to Firebase:", record.id);
      return { success: true, source: "firebase" };
    } catch (err) {
      console.warn("Firebase save failed:", err.message);
    }
  }
  db_local_save(record);
  return { success: true, source: "localStorage" };
}

async function db_loadHistory() {
  if (_ready && _db) {
    try {
      var q        = _fns.query(_fns.collection(_db, "diagnoses"), _fns.orderBy("timestamp", "desc"));
      var snapshot = await _fns.getDocs(q);
      var records  = [];
      snapshot.forEach(function(d) { records.push(d.data()); });
      return records;
    } catch (err) {
      console.warn("Firebase load failed:", err.message);
    }
  }
  return db_local_getAll();
}

async function db_deleteRecord(id) {
  if (_ready && _db) {
    try {
      await _fns.deleteDoc(_fns.doc(_fns.collection(_db, "diagnoses"), id));
      return { success: true };
    } catch (err) {
      console.warn("Firebase delete failed:", err.message);
    }
  }
  db_local_delete(id);
  return { success: true };
}

async function db_clearAll() {
  if (_ready && _db) {
    try {
      var snapshot = await _fns.getDocs(_fns.collection(_db, "diagnoses"));
      var dels = [];
      snapshot.forEach(function(d) { dels.push(_fns.deleteDoc(_fns.doc(_db, "diagnoses", d.id))); });
      await Promise.all(dels);
      return { success: true };
    } catch (err) {
      console.warn("Firebase clearAll failed:", err.message);
    }
  }
  localStorage.removeItem("brains_history");
  return { success: true };
}

function db_local_save(record) {
  var all = db_local_getAll().filter(function(r) { return r.id !== record.id; });
  all.unshift(record);
  localStorage.setItem("brains_history", JSON.stringify(all.slice(0, 50)));
}

function db_local_getAll() {
  try { return JSON.parse(localStorage.getItem("brains_history") || "[]"); }
  catch(e) { return []; }
}

function db_local_delete(id) {
  var all = db_local_getAll().filter(function(r) { return r.id !== id; });
  localStorage.setItem("brains_history", JSON.stringify(all));
}

function db_getStorageType() {
  return (_ready && _db) ? "firebase" : "localStorage";
}