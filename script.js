/**
 * BRAINS — script.js
 * Main frontend application logic.
 * Handles: theme, config, photo uploads, form, API calls, rendering, history.
 */

"use strict";

// ─────────────────────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────────────────────
const STATE = {
  backendUrl: "",          // Flask server URL (saved by user)
  photos: [null,null,null],// Up to 3 photos: [{file, base64, dataUrl}, ...]
  stageTimer: null,        // Loading stage animation timer
  lastReport: null,        // Last diagnosis report (for copy/print/export)
  allHistory: [],          // Full history array (for search filtering)
};


// ═══════════════════════════════════════════════════════════════
// 1. THEME — Dark / Light Mode
// ═══════════════════════════════════════════════════════════════

function toggleTheme() {
  const html = document.documentElement;
  const next = html.dataset.theme === "dark" ? "light" : "dark";
  html.dataset.theme = next;
  localStorage.setItem("brains_theme", next);
}

// Restore saved theme on page load
(function restoreTheme() {
  const saved = localStorage.getItem("brains_theme");
  if (saved) document.documentElement.dataset.theme = saved;
})();


// ═══════════════════════════════════════════════════════════════
// 2. NAVIGATION — Show/hide sections
// ═══════════════════════════════════════════════════════════════

function showSection(name) {
  document.querySelectorAll(".section").forEach(s => s.classList.remove("active"));
  document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
  document.getElementById("section-" + name).classList.add("active");

  if (name === "history") loadHistory();
}


// ═══════════════════════════════════════════════════════════════
// 3. CONFIG — Backend URL
// ═══════════════════════════════════════════════════════════════

(function restoreConfig() {
  const saved = localStorage.getItem("brains_backend_url");
  if (saved) {
    STATE.backendUrl = saved;
    document.getElementById("backendUrl").value = saved;
    pingBackend(saved);
  }
})();

async function saveConfig() {
  const url = document.getElementById("backendUrl").value.trim().replace(/\/$/, "");
  if (!url) { showHint("Enter a URL first.", "err"); return; }

  STATE.backendUrl = url;
  localStorage.setItem("brains_backend_url", url);
  await pingBackend(url);
}

async function pingBackend(url) {
  const hint   = document.getElementById("configHint");
  const status = document.querySelector(".status-pill");
  const dot    = document.querySelector(".status-dot");

  try {
    const res = await fetch(url + "/health", { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      hint.textContent  = "✓ Connected";
      hint.className    = "setup-hint ok";
      status.classList.add("connected");
      document.getElementById("apiStatus").textContent = "Connected";
    } else {
      throw new Error("Status " + res.status);
    }
  } catch {
    hint.textContent  = "⚠ Cannot reach server — check URL and make sure Flask is running";
    hint.className    = "setup-hint err";
    status.classList.remove("connected");
    document.getElementById("apiStatus").textContent = "Offline";
  }
}

function showHint(msg, type) {
  const hint = document.getElementById("configHint");
  hint.textContent = msg;
  hint.className = "setup-hint " + (type || "");
}


// ═══════════════════════════════════════════════════════════════
// 4. PHOTO UPLOAD — Up to 3 slots
// ═══════════════════════════════════════════════════════════════

function triggerUpload(index) {
  document.getElementById("fileInput" + index).click();
}

function handleFile(event, index) {
  const file = event.target.files[0];
  if (!file) return;
  if (!file.type.startsWith("image/")) { toast("Only image files are allowed.", "err"); return; }
  if (file.size > 20 * 1024 * 1024)    { toast("Image too large. Max 20MB.",    "err"); return; }

  const reader = new FileReader();
  reader.onload = (e) => {
    const dataUrl = e.target.result;
    const base64  = dataUrl.split(",")[1];

    STATE.photos[index] = { file, base64, dataUrl, type: file.type };

    // Show preview
    document.getElementById("previewImg" + index).src = dataUrl;
    document.getElementById("preview" + index).style.display = "block";
    document.getElementById("slot" + index).querySelector(".slot-empty").style.display = "none";
    document.getElementById("slot" + index).classList.add("has-photo");

    // Show quality indicator for main photo
    if (index === 0) {
      document.getElementById("qualityIndicator").style.display = "flex";
      document.getElementById("qualityFill").style.width = "70%"; // initial estimate
      document.getElementById("qualityScore").textContent = "Estimating…";
    }
  };
  reader.readAsDataURL(file);
}

function removePhoto(event, index) {
  event.stopPropagation();
  STATE.photos[index] = null;
  document.getElementById("fileInput" + index).value = "";
  document.getElementById("preview" + index).style.display = "none";
  document.getElementById("slot" + index).querySelector(".slot-empty").style.display = "flex";
  document.getElementById("slot" + index).classList.remove("has-photo");
  if (index === 0) document.getElementById("qualityIndicator").style.display = "none";
}

// Character counter for symptoms textarea
document.getElementById("symptoms").addEventListener("input", function() {
  document.getElementById("charCount").textContent = this.value.length + " characters";
});


// ═══════════════════════════════════════════════════════════════
// 5. LOADING STAGES ANIMATION
// ═══════════════════════════════════════════════════════════════

function startStages() {
  let i = 1;
  for (let k = 1; k <= 6; k++) document.getElementById("s" + k).className = "stage";

  function tick() {
    if (i > 1) document.getElementById("s" + (i-1)).className = "stage done";
    if (i <= 6) { document.getElementById("s" + i).className = "stage active"; i++; }
  }
  tick();
  STATE.stageTimer = setInterval(tick, 1000);
}

function stopStages() {
  clearInterval(STATE.stageTimer);
  for (let k = 1; k <= 6; k++) document.getElementById("s" + k).className = "stage done";
}


// ═══════════════════════════════════════════════════════════════
// 6. MAIN DIAGNOSIS FUNCTION — The core of the app
// ═══════════════════════════════════════════════════════════════

async function runDiagnosis() {

  // ── Validate ──────────────────────────────────────────────
  if (!STATE.backendUrl) {
    toast("Please enter and save your Backend URL first.", "err");
    document.getElementById("backendUrl").focus();
    return;
  }
  if (!STATE.photos[0]) {
    toast("Please upload at least one photo (main photo).", "err");
    return;
  }
  const symptoms = document.getElementById("symptoms").value.trim();
  if (!symptoms) {
    toast("Please describe the symptoms before running diagnosis.", "err");
    document.getElementById("symptoms").focus();
    return;
  }

  // ── UI → Loading ──────────────────────────────────────────
  const btn = document.getElementById("diagnoseBtn");
  btn.disabled = true;
  btn.classList.add("loading");
  document.getElementById("resultsPanel").classList.remove("on");
  document.getElementById("loadingPanel").classList.add("on");
  startStages();
  window.scrollTo({ top: document.getElementById("loadingPanel").offsetTop - 80, behavior: "smooth" });

  // ── Build FormData ─────────────────────────────────────────
  // FormData is like a package we prepare to send to Flask
  // It contains the image file + all the form fields
  const form = new FormData();

  // Primary image (required)
  form.append("image", STATE.photos[0].file);

  // Additional images (optional — backend can use them for more context)
  if (STATE.photos[1]) form.append("image2", STATE.photos[1].file);
  if (STATE.photos[2]) form.append("image3", STATE.photos[2].file);

  // All clinical fields
  const fields = {
    symptoms:          document.getElementById("symptoms").value.trim(),
    species:           document.getElementById("species").value,
    sex:               document.getElementById("sex").value,
    known_age:         document.getElementById("knownAge").value.trim(),
    weight_kg:         document.getElementById("weightKg").value,
    region:            document.getElementById("region").value.trim(),
    symptom_duration:  document.getElementById("symptomDuration").value,
    severity:          document.getElementById("severity").value,
    vaccination_status:document.getElementById("vaccinationStatus").value,
    repro_status:      document.getElementById("reproStatus").value,
    diet_type:         document.getElementById("dietType").value,
    environment:       document.getElementById("environment").value,
    animal_contact:    document.getElementById("animalContact").value,
    recent_meds:       document.getElementById("recentMeds").value.trim(),
    recent_changes:    document.getElementById("recentChanges").value.trim(),
    medical_history:   document.getElementById("medicalHistory").value.trim(),
  };

  for (const [key, val] of Object.entries(fields)) {
    if (val) form.append(key, val);
  }

  // ── Call Flask Backend ─────────────────────────────────────
  // fetch() sends an HTTP POST request to our Flask server
  // The server processes the image, calls the AI, and sends back JSON
  try {
    const response = await fetch(STATE.backendUrl + "/api/diagnose", {
      method: "POST",
      body:   form,
    });

    const result = await response.json();

    stopStages();
    document.getElementById("loadingPanel").classList.remove("on");
    btn.disabled = false;
    btn.classList.remove("loading");

    if (!result.success) {
      toast("Diagnosis failed: " + (result.error || "Unknown error"), "err");
      return;
    }

    const report = result.report;
    STATE.lastReport = report;

    // Update image quality display
    if (report.image_quality !== undefined) {
      const q = Math.round(report.image_quality * 100);
      document.getElementById("qualityFill").style.width = q + "%";
      document.getElementById("qualityScore").textContent = q + "%";
      document.getElementById("qualityIndicator").style.display = "flex";
    }

    // ── Save to database ──────────────────────────────────────
    db_saveReport(report, STATE.photos[0].dataUrl)
      .then(res => {
        const src = res.source === "firebase" ? "☁️ Saved to Firebase" : "💾 Saved locally";
        toast(src, "ok");
      })
      .catch(err => console.warn("Save to DB failed:", err));

    // ── Render the report ─────────────────────────────────────
    renderReport(report);

  } catch (err) {
    stopStages();
    document.getElementById("loadingPanel").classList.remove("on");
    btn.disabled = false;
    btn.classList.remove("loading");
    toast("Could not reach the server. Is Flask running at " + STATE.backendUrl + "?", "err");
    console.error("Diagnosis request failed:", err);
  }
}


// ═══════════════════════════════════════════════════════════════
// 7. RENDER REPORT — Build and display all result cards
// ═══════════════════════════════════════════════════════════════

function renderReport(r) {
  // Record bar
  document.getElementById("recordId").textContent = r.record_id || "—";
  document.getElementById("recordTs").textContent = formatDate(r.timestamp);

  const q = Math.round((r.image_quality || 0.7) * 100);
  document.getElementById("qBarScore").textContent = q + "%";
  setTimeout(() => { document.getElementById("qBarFill").style.width = q + "%"; }, 150);

  let html = "";
  const bc = Math.round((r.breed_confidence || 0) * 100);

  // ── Card 1: Breed ──────────────────────────────────────────
  html += `
    <div class="breed-card">
      <div class="blbl">Breed Identified</div>
      <div class="bnm">${esc(r.breed_prediction || "Unknown")}</div>
      <div class="bsp">${esc(r.species || "—")} · ${esc(r.common_name || "")}</div>
      <div class="c-row"><span class="c-lbl">Confidence</span><span class="c-pct">${bc}%</span></div>
      <div class="c-bar"><div class="c-fill" id="breedFill"></div></div>
      ${r.coat_condition ? `<div style="margin-top:.6rem;font-size:.72rem;color:var(--text-dim)">Coat: <span style="color:var(--text-muted)">${esc(r.coat_condition)}</span></div>` : ""}
    </div>`;

  // ── Card 2: Patient Info ───────────────────────────────────
  const bcsColor = r.body_condition_score <= 3 ? "#e07070" : r.body_condition_score >= 7 ? "var(--accent-warm)" : "var(--accent)";
  html += `
    <div class="info-card">
      <div class="sh" style="font-size:.8rem;margin-bottom:.5rem">🗂️ Patient</div>
      <div class="i-row"><span class="i-key">Age Band</span><span class="age-badge">${r.estimated_age_band || "—"}</span></div>
      <div class="i-row"><span class="i-key">Sex</span><span class="i-val">${r.sex_estimate || "—"}</span></div>
      <div class="i-row"><span class="i-key">Prognosis</span><span class="prog-badge prog-${r.prognosis || "GOOD"}">${r.prognosis || "—"}</span></div>
      <div class="i-row"><span class="i-key">Safe to proceed</span><span class="i-val" style="color:${r.safe_to_proceed ? "var(--accent)" : "var(--accent-red)"}">${r.safe_to_proceed ? "✓ Yes" : "✕ Escalate"}</span></div>
      ${r.body_condition_score ? `
      <div class="bcs-row">
        <span class="bcs-label">Body Condition</span>
        <div class="bcs-track"><div class="bcs-fill" id="bcsFill" style="background:${bcsColor}"></div></div>
        <span class="bcs-val" style="color:${bcsColor}">${r.body_condition_score}/9</span>
      </div>` : ""}
    </div>`;

  // ── Card 3: Emergency or Clear ─────────────────────────────
  if (r.emergency_flags?.length > 0) {
    html += `
      <div class="em-card">
        <div class="em-title">🚨 Emergency Flags</div>
        ${r.emergency_flags.map(f => `<div class="em-flag"><span class="em-dot">●</span>${esc(f)}</div>`).join("")}
      </div>`;
  } else {
    html += `
      <div class="ok-card">
        <div class="ok-title">✅ No Emergency Flags</div>
        <div class="ok-desc">No immediate life-threatening conditions detected. Standard veterinary follow-up recommended.</div>
        ${r.follow_up_timeline ? `<div style="margin-top:.5rem;font-family:var(--font-mono);font-size:.62rem;color:var(--accent)">Follow-up: ${esc(r.follow_up_timeline)}</div>` : ""}
      </div>`;
  }

  // ── Full: Observations ─────────────────────────────────────
  html += `
    <div class="info-card r-full" style="padding:1.2rem 1.35rem">
      <div class="sh">🔬 Clinical Observations</div>
      <div class="o-list">
        ${(r.observations || []).map((o, i) =>
          `<div class="o-item" style="animation-delay:${i * .08}s">
            <span class="o-step">#${i+1}</span>${esc(o)}
          </div>`).join("")}
      </div>
    </div>`;

  // ── Full: Differentials ────────────────────────────────────
  const dxSorted = [...(r.differentials || [])].sort((a, b) => b.confidence - a.confidence);
  html += `
    <div class="info-card r-full" style="padding:1.2rem 1.35rem">
      <div class="sh">🩺 Differential Diagnosis</div>
      <div class="d-list">
        ${dxSorted.map((d, i) => {
          const pct = Math.round((d.confidence || 0) * 100);
          return `
            <div class="d-item" style="animation-delay:${i * .1}s">
              <div class="d-rank ${i === 0 ? "top" : ""}">#${i+1}</div>
              <div>
                <div class="d-name">${esc(d.condition)}</div>
                <div class="d-code">${d.icd_vet_code ? "CODE: " + d.icd_vet_code : "—"}</div>
                <div class="d-tags">
                  ${(d.supporting_signs || []).slice(0,3).map(s => `<span class="d-tag s">${esc(s)}</span>`).join("")}
                  ${(d.ruling_out_signs || []).slice(0,2).map(s => `<span class="d-tag a">${esc(s)}</span>`).join("")}
                </div>
              </div>
              <div class="d-conf">
                <div class="d-pct">${pct}%</div>
                <div class="d-cbar"><div class="d-cfil" style="--t:${pct}%"></div></div>
              </div>
            </div>`;
        }).join("")}
      </div>
    </div>`;

  // ── Full: Care Plan ────────────────────────────────────────
  html += `
    <div class="info-card r-full" style="padding:1.2rem 1.35rem">
      <div class="sh">💊 Actionable Care Plan</div>
      <div class="o-list">
        ${(r.actionable_care || []).map((s, i) =>
          `<div class="o-item" style="animation-delay:${i * .07}s">
            <span class="o-step">STEP ${i+1}</span>${esc(s)}
          </div>`).join("")}
      </div>
    </div>`;

  // ── Full: Home Care Tips ───────────────────────────────────
  if (r.home_care_tips?.length > 0) {
    html += `
      <div class="info-card r-full" style="padding:1.2rem 1.35rem">
        <div class="sh">🏠 Home Care Tips</div>
        <div class="o-list">
          ${r.home_care_tips.map((t, i) =>
            `<div class="o-item" style="animation-delay:${i * .06}s">
              <span class="o-step">TIP ${i+1}</span>${esc(t)}
            </div>`).join("")}
        </div>
      </div>`;
  }

  // ── Full: Future Risks ─────────────────────────────────────
  if (r.future_risks?.length > 0) {
    html += `
      <div class="info-card r-full" style="padding:1.2rem 1.35rem">
        <div class="sh">📈 Future Health Risks</div>
        <div class="o-list">
          ${r.future_risks.map((risk, i) =>
            `<div class="o-item risk" style="animation-delay:${i * .07}s">
              <span class="o-step">RISK ${i+1}</span>${esc(risk)}
            </div>`).join("")}
        </div>
      </div>`;
  }

  // ── Full: Diet Recommendations ─────────────────────────────
  if (r.diet_recommendations?.length > 0) {
    html += `
      <div class="info-card r-full" style="padding:1.2rem 1.35rem">
        <div class="sh">🥗 Diet Recommendations</div>
        <div class="o-list">
          ${r.diet_recommendations.map((d, i) =>
            `<div class="o-item" style="animation-delay:${i * .06}s">
              <span class="o-step">•</span>${esc(d)}
            </div>`).join("")}
        </div>
      </div>`;
  }

  // ── Full: Medication Safety ────────────────────────────────
  if (r.medication_risks?.length > 0) {
    const rows = r.medication_risks.map(m => `
      <tr>
        <td class="m-drug">${esc(m.drug_name)}</td>
        <td style="color:var(--text-dim);font-size:.72rem">${esc(m.drug_class)}</td>
        <td><span class="r-badge r${m.risk_level}">${m.risk_level}</span></td>
        <td><span class="d-badge d${m.dose_classification}">${m.dose_classification}</span></td>
        <td style="font-size:.7rem;color:var(--text-dim)">${esc(m.clinical_action)}</td>
      </tr>`).join("");

    html += `
      <div class="info-card r-full" style="padding:1.2rem 1.35rem">
        <div class="sh">💉 Medication Safety
          <span style="font-family:var(--font-mono);font-size:.58rem;color:var(--text-dim);font-weight:400;margin-left:5px">
            Age band: ${r.estimated_age_band || "—"}
          </span>
        </div>
        <div style="overflow-x:auto">
          <table class="m-tbl">
            <thead><tr><th>Drug</th><th>Class</th><th>Risk</th><th>Protocol</th><th>Action</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>`;
  }

  // ── Confidence note ────────────────────────────────────────
  if (r.confidence_note) {
    html += `
      <div class="r-full" style="font-family:var(--font-mono);font-size:.64rem;color:var(--text-dim);padding:.5rem .2rem;line-height:1.6">
        ℹ️ ${esc(r.confidence_note)}
      </div>`;
  }

  document.getElementById("resultsGrid").innerHTML = html;
  document.getElementById("resultsPanel").classList.add("on");

  // Animate bars
  setTimeout(() => {
    const bf = document.getElementById("breedFill");
    if (bf) bf.style.width = bc + "%";
    const bcs = document.getElementById("bcsFill");
    if (bcs && r.body_condition_score) bcs.style.width = ((r.body_condition_score / 9) * 100) + "%";
    document.querySelectorAll(".d-cfil").forEach(el => {
      el.style.width = el.style.getPropertyValue("--t") || "0%";
    });
  }, 150);

  // Safe/unsafe banner
  const sb = document.getElementById("safeBanner");
  if (r.safe_to_proceed) {
    sb.className = "safe-banner on safe";
    sb.textContent = "✅ No emergency conditions detected. Report is suitable for veterinary review before treatment.";
  } else {
    sb.className = "safe-banner on warn";
    sb.textContent = "🚨 HIGH-RISK findings present. Immediate veterinary consultation is mandatory before any treatment.";
  }

  // Scroll to results
  document.getElementById("resultsPanel").scrollIntoView({ behavior: "smooth", block: "start" });
}


// ═══════════════════════════════════════════════════════════════
// 8. EXPORT / PRINT / COPY
// ═══════════════════════════════════════════════════════════════

function printReport() {
  window.print();
}

async function copyReport() {
  if (!STATE.lastReport) return;
  const r = STATE.lastReport;
  const text = [
    `BRAINS Diagnostic Report`,
    `Record: ${r.record_id}  |  ${formatDate(r.timestamp)}`,
    ``,
    `Breed: ${r.breed_prediction} (${Math.round((r.breed_confidence||0)*100)}%)`,
    `Species: ${r.species} | Age Band: ${r.estimated_age_band} | Sex: ${r.sex_estimate}`,
    `Prognosis: ${r.prognosis}`,
    ``,
    `OBSERVATIONS:`,
    ...(r.observations||[]).map((o,i) => `${i+1}. ${o}`),
    ``,
    `DIFFERENTIALS:`,
    ...(r.differentials||[]).sort((a,b)=>b.confidence-a.confidence)
      .map((d,i) => `#${i+1} ${d.condition} (${Math.round((d.confidence||0)*100)}%)`),
    ``,
    `CARE PLAN:`,
    ...(r.actionable_care||[]).map((s,i) => `Step ${i+1}: ${s}`),
    ``,
    `EMERGENCY FLAGS: ${r.emergency_flags?.length > 0 ? r.emergency_flags.join("; ") : "None"}`,
    ``,
    `⚠️ AI-assisted pre-screening only. Review by licensed veterinarian required.`,
  ].join("\n");

  try {
    await navigator.clipboard.writeText(text);
    document.getElementById("copyBtn").textContent = "✓";
    setTimeout(() => { document.getElementById("copyBtn").textContent = "📋"; }, 2000);
    toast("Report copied to clipboard", "ok");
  } catch {
    toast("Could not copy — try printing instead", "warn");
  }
}

function exportPDF() {
  // Uses browser's built-in "Save as PDF" print feature
  const origTitle = document.title;
  document.title = "BRAINS-Report-" + (STATE.lastReport?.record_id || "export");
  window.print();
  document.title = origTitle;
  toast("Use 'Save as PDF' in the print dialog", "warn");
}


// ═══════════════════════════════════════════════════════════════
// 9. HISTORY
// ═══════════════════════════════════════════════════════════════

async function loadHistory() {
  const container = document.getElementById("historyList");
  const empty     = document.getElementById("historyEmpty");

  container.innerHTML = `<div style="text-align:center;padding:2rem;color:var(--text-dim);font-size:.82rem">Loading history…</div>`;

  try {
    const records = await db_loadHistory();
    STATE.allHistory = records;
    renderHistory(records);
  } catch (err) {
    container.innerHTML = `<div style="color:var(--accent-red);font-size:.8rem;padding:1rem">Failed to load history: ${err.message}</div>`;
  }
}

function renderHistory(records) {
  const container = document.getElementById("historyList");
  const empty     = document.getElementById("historyEmpty");

  if (!records || records.length === 0) {
    container.innerHTML = "";
    container.appendChild(empty);
    empty.style.display = "block";
    return;
  }

  empty.style.display = "none";
  container.innerHTML = records.map(r => `
    <div class="hist-card" onclick="openHistoryDetail('${r.id}')">
      <div class="hist-thumb">
        ${r.imageThumb
          ? `<img src="${r.imageThumb}" alt="thumb">`
          : "🐾"}
      </div>
      <div class="hist-body">
        <div class="hist-breed">${esc(r.breed || "Unknown")}</div>
        <div class="hist-meta">
          <span class="hist-badge">${esc(r.species || "—")}</span>
          <span class="hist-badge">${esc(r.ageBand || "—")}</span>
          <span class="hist-badge ${r.emergency ? "" : "green"}">${r.emergency ? "⚠️ Emergency" : "✓ Clear"}</span>
          <span class="hist-badge">${esc(r.prognosis || "—")}</span>
        </div>
        <div class="hist-dx">Top: ${esc(r.topDiagnosis || "—")}</div>
      </div>
      <div class="hist-right">
        <div class="hist-ts">${formatDate(r.timestamp)}</div>
        <button class="hist-del" onclick="deleteHistoryItem(event,'${r.id}')">Delete</button>
      </div>
    </div>`).join("");
}

function filterHistory() {
  const q = document.getElementById("historySearch").value.toLowerCase().trim();
  if (!q) { renderHistory(STATE.allHistory); return; }
  const filtered = STATE.allHistory.filter(r =>
    (r.breed       || "").toLowerCase().includes(q) ||
    (r.topDiagnosis|| "").toLowerCase().includes(q) ||
    (r.species     || "").toLowerCase().includes(q) ||
    (r.timestamp   || "").toLowerCase().includes(q)
  );
  renderHistory(filtered);
}

async function deleteHistoryItem(event, id) {
  event.stopPropagation();
  if (!confirm("Delete this diagnosis record?")) return;
  await db_deleteRecord(id);
  STATE.allHistory = STATE.allHistory.filter(r => r.id !== id);
  renderHistory(STATE.allHistory);
  toast("Record deleted", "ok");
}

async function clearAllHistory() {
  if (!confirm("Delete ALL history records? This cannot be undone.")) return;
  await db_clearAll();
  STATE.allHistory = [];
  renderHistory([]);
  toast("All history cleared", "ok");
}

function openHistoryDetail(id) {
  const record = STATE.allHistory.find(r => r.id === id);
  if (!record || !record.fullReport) return;

  const r = record.fullReport;
  const content = document.getElementById("modalContent");

  content.innerHTML = `
    <h3 style="font-family:var(--font-display);font-size:1.1rem;margin-bottom:.4rem">${esc(r.breed_prediction || "Unknown")}</h3>
    <p style="font-family:var(--font-mono);font-size:.62rem;color:var(--text-dim);margin-bottom:1.2rem">${r.record_id} · ${formatDate(r.timestamp)}</p>
    <div class="o-list" style="margin-bottom:1rem">
      ${(r.observations||[]).map((o,i)=>`<div class="o-item"><span class="o-step">#${i+1}</span>${esc(o)}</div>`).join("")}
    </div>
    <div class="sh">🩺 Top Diagnoses</div>
    <div class="d-list" style="margin-bottom:1rem">
      ${[...(r.differentials||[])].sort((a,b)=>b.confidence-a.confidence).slice(0,3).map((d,i)=>`
        <div class="d-item">
          <div class="d-rank ${i===0?"top":""}">#${i+1}</div>
          <div><div class="d-name">${esc(d.condition)}</div></div>
          <div class="d-conf"><div class="d-pct">${Math.round((d.confidence||0)*100)}%</div></div>
        </div>`).join("")}
    </div>
    ${r.actionable_care?.length > 0 ? `
    <div class="sh">💊 Care Plan</div>
    <div class="o-list">
      ${r.actionable_care.map((s,i)=>`<div class="o-item"><span class="o-step">STEP ${i+1}</span>${esc(s)}</div>`).join("")}
    </div>` : ""}`;

  document.getElementById("modalOverlay").classList.add("on");
}

function closeModal() {
  document.getElementById("modalOverlay").classList.remove("on");
}


// ═══════════════════════════════════════════════════════════════
// 10. UTILITIES
// ═══════════════════════════════════════════════════════════════

function toast(msg, type = "") {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.className = "toast on " + type;
  setTimeout(() => { t.className = "toast"; }, 4500);
}

function esc(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatDate(isoStr) {
  if (!isoStr) return "—";
  try {
    return new Date(isoStr).toLocaleString("en-IN", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit"
    });
  } catch { return isoStr; }
}
