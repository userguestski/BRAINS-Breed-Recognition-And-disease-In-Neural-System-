import os
import base64
import json
import logging
import uuid
from datetime import datetime
from dotenv import load_dotenv

load_dotenv()  # reads .env file

import cv2
import numpy as np
from flask import Flask, request, jsonify
from flask_cors import CORS
import google.generativeai as genai

# Read key from .env file
genai.configure(api_key=os.getenv("GOOGLE_API_KEY"))

logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)

model = genai.GenerativeModel(
    model_name="gemini-2.5-flash",
    generation_config=genai.GenerationConfig(
        temperature=0.15,
        top_p=0.9,
        max_output_tokens=8192,
        response_mime_type="application/json",
    ),
)

def preprocess_image(raw_bytes: bytes) -> tuple[bytes, dict]:
    meta = {"quality_score": 0.7, "warnings": [], "coat_type": "normal"}

    arr = np.frombuffer(raw_bytes, np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Could not read image. Please upload a valid JPEG or PNG.")

    h, w = img.shape[:2]
    scale = min(640 / w, 640 / h)
    nw, nh = int(w * scale), int(h * scale)
    resized = cv2.resize(img, (nw, nh), interpolation=cv2.INTER_LANCZOS4)
    canvas = np.full((640, 640, 3), 114, dtype=np.uint8)
    top, left = (640 - nh) // 2, (640 - nw) // 2
    canvas[top:top+nh, left:left+nw] = resized

    lab = cv2.cvtColor(canvas, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8))
    lab = cv2.merge([clahe.apply(l), a, b])
    canvas = cv2.cvtColor(lab, cv2.COLOR_LAB2BGR)

    canvas = cv2.fastNlMeansDenoisingColored(canvas, None, 7, 7, 7, 21)

    gray = cv2.cvtColor(canvas, cv2.COLOR_BGR2GRAY)
    blur_score = min(cv2.Laplacian(gray, cv2.CV_64F).var() / 500.0, 1.0)
    exposure_score = 1.0 - abs(gray.mean() - 127.5) / 127.5
    meta["quality_score"] = round((0.6 * blur_score + 0.4 * exposure_score), 3)

    if meta["quality_score"] < 0.35:
        meta["warnings"].append("Low image quality. Use natural lighting for best results.")

    _, buf = cv2.imencode(".jpg", canvas, [cv2.IMWRITE_JPEG_QUALITY, 95])
    return buf.tobytes(), meta


SYSTEM_PROMPT = """You are an expert veterinary diagnostic AI system.
Analyze the animal image and all provided clinical information, then return a structured diagnosis.

Respond ONLY with valid JSON — no extra text, no markdown fences.

Required JSON structure:
{
  "species": "scientific name",
  "common_name": "e.g. Dog",
  "breed_prediction": "e.g. Golden Retriever",
  "breed_confidence": 0.0 to 1.0,
  "estimated_age_band": "NEONATAL or PEDIATRIC or ADULT or GERIATRIC",
  "sex_estimate": "MALE or FEMALE or UNKNOWN",
  "visual_age_markers": ["observable features that indicate age"],
  "coat_condition": "e.g. healthy, dull, patchy, matted",
  "body_condition_score": 1 to 9,
  "observations": ["3 to 6 clinical findings from the image and symptoms"],
  "future_risks": ["2 to 4 potential future health risks based on breed and current condition"],
  "differentials": [
    {
      "condition": "disease name",
      "icd_vet_code": "code or null",
      "confidence": 0.0 to 1.0,
      "supporting_signs": ["signs supporting this diagnosis"],
      "ruling_out_signs": ["signs arguing against this"]
    }
  ],
  "actionable_care": ["Step 1 ...", "Step 2 ...", "Step 3 ..."],
  "home_care_tips": ["safe things owner can do at home right now"],
  "diet_recommendations": ["specific dietary advice based on condition and species"],
  "follow_up_timeline": "e.g. Recheck in 7-14 days",
  "emergency_flags": ["only truly life-threatening signs, else empty array"],
  "mentioned_medications": [
    { "drug_name": "name", "route": "oral/topical/injection" }
  ],
  "prognosis": "EXCELLENT or GOOD or GUARDED or POOR",
  "confidence_note": "brief note on overall diagnostic confidence"
}

Critical rules:
- Give 2 to 5 differentials, sorted highest confidence first
- Give minimum 3 actionable care steps
- future_risks must reflect breed-specific genetic risks + current presentation
- NEVER mention specific dosages
- body_condition_score: 1=emaciated, 5=ideal, 9=obese
- Respond ONLY with the JSON object"""


DRUG_SAFETY = {
    "meloxicam":     {"cls": "NSAID",               "avoid": ["NEONATAL"],                                     "caution": ["PEDIATRIC", "GERIATRIC"]},
    "carprofen":     {"cls": "NSAID",               "avoid": ["NEONATAL"],                                     "caution": ["PEDIATRIC", "GERIATRIC"]},
    "aspirin":       {"cls": "NSAID",               "avoid": ["NEONATAL", "PEDIATRIC"],                        "caution": ["GERIATRIC"]},
    "ibuprofen":     {"cls": "NSAID — TOXIC",        "avoid": ["NEONATAL", "PEDIATRIC", "ADULT", "GERIATRIC"],  "caution": []},
    "enrofloxacin":  {"cls": "Fluoroquinolone",     "avoid": ["NEONATAL", "PEDIATRIC"],                        "caution": ["GERIATRIC"]},
    "doxycycline":   {"cls": "Tetracycline",        "avoid": ["NEONATAL"],                                     "caution": ["PEDIATRIC"]},
    "metronidazole": {"cls": "Nitroimidazole",      "avoid": ["NEONATAL"],                                     "caution": ["PEDIATRIC", "GERIATRIC"]},
    "ivermectin":    {"cls": "Macrocyclic lactone", "avoid": ["NEONATAL"],                                     "caution": ["PEDIATRIC", "GERIATRIC"]},
    "prednisolone":  {"cls": "Corticosteroid",      "avoid": [],                                               "caution": ["NEONATAL", "PEDIATRIC", "GERIATRIC"]},
    "dexamethasone": {"cls": "Corticosteroid",      "avoid": ["NEONATAL"],                                     "caution": ["PEDIATRIC", "GERIATRIC"]},
    "ketoconazole":  {"cls": "Azole antifungal",    "avoid": ["NEONATAL"],                                     "caution": ["PEDIATRIC", "GERIATRIC"]},
}

def check_medications(meds: list, age_band: str) -> list:
    results = []
    dose_map = {"NEONATAL": "PEDIATRIC", "PEDIATRIC": "PEDIATRIC", "ADULT": "STANDARD", "GERIATRIC": "GERIATRIC"}
    for m in meds:
        key  = m.get("drug_name", "").lower().strip()
        info = DRUG_SAFETY.get(key)
        if not info:
            results.append({"drug_name": m.get("drug_name", "Unknown"), "drug_class": "Unknown",
                             "risk_level": "UNKNOWN", "dose_classification": dose_map.get(age_band, "STANDARD"),
                             "clinical_action": "Verify in formulary before use."})
        elif age_band in info["avoid"]:
            results.append({"drug_name": m.get("drug_name"), "drug_class": info["cls"], "risk_level": "HIGH",
                             "dose_classification": "CONTRAINDICATED",
                             "clinical_action": f"DO NOT USE in {age_band}. Escalate to licensed vet immediately."})
        elif age_band in info["caution"]:
            dc = dose_map.get(age_band, "STANDARD")
            results.append({"drug_name": m.get("drug_name"), "drug_class": info["cls"], "risk_level": "MEDIUM",
                             "dose_classification": dc,
                             "clinical_action": f"{dc} dosing protocol required. Adjust with vet."})
        else:
            results.append({"drug_name": m.get("drug_name"), "drug_class": info["cls"], "risk_level": "LOW",
                             "dose_classification": "STANDARD", "clinical_action": "Standard dosing per weight."})
    return results


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "service": "BRAINS API"})


@app.route("/api/diagnose", methods=["POST"])
def diagnose():
    try:
        if "image" not in request.files:
            return jsonify({"success": False, "error": "No image uploaded."}), 400

        img_file  = request.files["image"]
        raw_bytes = img_file.read()

        if len(raw_bytes) > 20 * 1024 * 1024:
            return jsonify({"success": False, "error": "Image too large. Max 20MB."}), 413

        symptoms = request.form.get("symptoms", "").strip()
        if not symptoms:
            return jsonify({"success": False, "error": "Symptoms are required."}), 400

        processed_bytes, img_meta = preprocess_image(raw_bytes)
        img_b64 = base64.b64encode(processed_bytes).decode("utf-8")

        fields = {
            "Species":               request.form.get("species"),
            "Sex":                   request.form.get("sex"),
            "Known age":             request.form.get("known_age"),
            "Weight (kg)":           request.form.get("weight_kg"),
            "Geographic region":     request.form.get("region"),
            "Symptom duration":      request.form.get("symptom_duration"),
            "Symptom severity":      request.form.get("severity"),
            "Vaccination status":    request.form.get("vaccination_status"),
            "Reproductive status":   request.form.get("repro_status"),
            "Diet type":             request.form.get("diet_type"),
            "Living environment":    request.form.get("environment"),
            "Recent animal contact": request.form.get("animal_contact"),
            "Medications last 30d":  request.form.get("recent_meds"),
            "Recent changes":        request.form.get("recent_changes"),
            "Medical history":       request.form.get("medical_history"),
        }
        context_parts = [
            f"{label}: {val.strip()}"
            for label, val in fields.items()
            if val and val.strip() and val.strip().lower() not in ("", "unknown", "none")
        ]
        context_str = "\n".join(context_parts) if context_parts else "Not provided"

        user_prompt = f"""ANIMAL CLINICAL INFORMATION:
{context_str}

IMAGE QUALITY SCORE: {img_meta['quality_score']} / 1.0
{f"IMAGE WARNINGS: {'; '.join(img_meta['warnings'])}" if img_meta['warnings'] else ""}

REPORTED SYMPTOMS AND SIGNS:
{symptoms}

Please analyze the attached image and return a complete diagnostic report in the specified JSON format."""

        response = model.generate_content([
            SYSTEM_PROMPT,
            {"mime_type": img_file.mimetype or "image/jpeg", "data": img_b64},
            user_prompt,
        ])

        raw_text   = response.text
        clean_text = raw_text.replace("```json", "").replace("```", "").strip()
        report     = json.loads(clean_text)

        meds     = report.get("mentioned_medications", [])
        age_band = report.get("estimated_age_band", "ADULT")
        report["medication_risks"] = check_medications(meds, age_band)
        report["safe_to_proceed"]  = (
            len(report.get("emergency_flags", [])) == 0
            and not any(m["risk_level"] == "HIGH" for m in report["medication_risks"])
        )

        record_id               = "BR-" + uuid.uuid4().hex[:10].upper()
        report["record_id"]     = record_id
        report["image_quality"] = img_meta["quality_score"]
        report["img_warnings"]  = img_meta["warnings"]
        report["timestamp"]     = datetime.utcnow().isoformat() + "Z"

        logger.info("Diagnosis complete | %s | breed=%s | differentials=%d",
                    record_id, report.get("breed_prediction"), len(report.get("differentials", [])))

        return jsonify({"success": True, "report": report})

    except json.JSONDecodeError:
        logger.error("AI returned malformed JSON")
        return jsonify({"success": False, "error": "AI returned an unexpected response. Try again."}), 502
    except Exception as e:
        logger.exception("Diagnosis error: %s", e)
        return jsonify({"success": False, "error": str(e)}), 500


if __name__ == "__main__":
    port = int(os.getenv("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False)