/**
 * Demo case presets for MAI-style expert panel.
 * Research-only educational vignettes — not for care.
 */

export type CasePresetId = "benchmark" | "simple" | "blank";

export type CasePreset = {
  id: CasePresetId;
  label: string;
  blurb: string;
  tag: string;
  meta: string;
  task: string;
};

export const CASE_PRESETS: CasePreset[] = [
  {
    id: "benchmark",
    label: "Benchmark case",
    blurb: "Dense timeline, negatives, vaccines & SpO2 for calibrated top-3 weights.",
    tag: "Recommended",
    meta: "41y · winter · post-flight",
    task: `RESEARCH-ONLY PANEL CASE (not a diagnosis, not medical advice, not for patient care).

## Demographics & context
- Adult, 41 years old, works hybrid office + weekly regional flights
- Season: mid-winter, community influenza activity reported "elevated" in region (no personal lab confirmation)
- No pregnancy; BMI ~27; never-smoker
- Past history: allergic rhinitis; childhood asthma (inactive >10 years); no COPD, no heart failure, no immunosuppression
- Meds: loratadine PRN; no ACE inhibitor; no immunosuppressants
- Vaccines: seasonal influenza vaccine 3 months ago; COVID primary series + 1 booster >1 year ago; status otherwise incomplete/unknown

## Timeline (day 0 = symptom onset)
- Day −2: 3.5h flight + crowded terminal; seatmate coughing; cabin air felt dry
- Day 0 (evening): sore throat, mild headache, fatigue; temp not measured
- Day 1: myalgias, chills, temp 38.4°C oral at home; dry cough starts; appetite reduced
- Day 2: fever 37.9–38.2°C; dry cough worse at night; no vomiting/diarrhea; still working from home
- Day 3: fever max 38.0°C; cough still mostly dry, occasional clear sputum; resting SpO2 97–98% on phone pulse oximeter (consumer device); can climb one flight of stairs with mild breathlessness that resolves in <1 min
- Day 4 (today, morning): temp 37.6°C; fatigue lingering; sore throat improved; no chest pain; no hemoptysis; no confusion; oral intake OK; urine normal color

## Explicit negatives / exam-like notes (self-reported)
- No resting dyspnea now; no orthopnea; no leg swelling
- No known COVID+/flu+ household contact with a test result
- No recent antibiotics; no known drug allergy crisis
- No wheeze heard by patient; no measured peak flow available
- Blood pressure / HR not measured professionally; HR feels "a bit fast" with fever only

## Labs / imaging
- None obtained yet (no PCR/antigen, no CBC, no chest imaging)

## Panel task (strict)
1) Rank the 3 most plausible research-level explanations for THIS presentation.
2) Use comparable hypothesis types (same level of abstraction — e.g. three etiology/syndrome candidates, not mixing "virus" with a vague mechanism as if they were alternatives unless justified).
3) Give integer percentages that sum to 100, with a one-line defense of each weight.
4) Surface expert disagreement risks, residual uncertainty, and the single highest-value missing data point for ranking stability.
5) List 3 non-action research questions (no clinical orders, no "go to ER", no prescriptions).

Stay research-only. Calibrate language; do not diagnose.`,
  },
  {
    id: "simple",
    label: "Simple case",
    blurb: "Short vignette for a fast smoke test of the live multi-model panel.",
    tag: "Quick",
    meta: "34y · 4-day cough",
    task: `Research-only case (not a diagnosis, not medical advice). Analyze this vignette and return panel consensus with top 3 possibilities + percentages.

Case:
Adult, 34 years old. 4 days of dry cough, mild fever (38.1°C), sore throat, body aches, and fatigue. No shortness of breath at rest. No chest pain. Symptoms started after crowded indoor travel. Vaccination status unknown. No chronic lung disease reported.

Panel question:
What are the 3 most plausible research-level explanations for this presentation, with approximate percentages, supporting vs weakening evidence, contradictions to watch for, and non-clinical research questions that would reduce uncertainty?`,
  },
  {
    id: "blank",
    label: "Your case",
    blurb: "Empty template — paste any domain case and run the same panel flow.",
    tag: "Custom",
    meta: "Paste freeform",
    task: `Research-only case (not a diagnosis, not medical advice, not for patient care).

## Case
[Paste demographics, timeline, findings, negatives, and missing data here.]

## Panel question
Rank the 3 most plausible research-level explanations with integer percentages summing to 100. Note contradictions, residual uncertainty, and non-action research questions.`,
  },
];

export const DEFAULT_CASE_PRESET_ID: CasePresetId = "benchmark";

export function getCasePreset(id: CasePresetId): CasePreset {
  return (
    CASE_PRESETS.find((p) => p.id === id) ||
    CASE_PRESETS.find((p) => p.id === "benchmark")!
  );
}
