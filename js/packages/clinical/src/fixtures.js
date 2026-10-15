export const PUBLIC_CASES = [
  {
    blind_id: "sim-public-001",
    experience: "public",
    title_public: "Simulated winter cough vignette",
    opening:
      "Simulated adult, 34 years old. Four days of dry cough, sore throat, myalgias, and fever to 38.1 C after crowded indoor travel. No resting dyspnea, no chest pain, no known chronic lung disease. This is a simulated educational case, not a real person.",
    differential: [
      { label: "Viral upper respiratory infection", percent: 55, support: "Short course, travel exposure, dry cough.", against: "Fever can overlap with influenza." },
      { label: "Influenza-like illness", percent: 30, support: "Fever and myalgias after crowding.", against: "No test result in the vignette." },
      { label: "Bacterial sinusitis", percent: 15, support: "Less likely at day 4 without focal sinus signs.", against: "No facial pain or prolonged course." },
    ],
    explain_es: "Caso simulado educativo. No es una persona real ni un consejo médico.",
    explain_en: "Simulated educational case. Not a real person and not medical advice.",
  },
  {
    blind_id: "sim-public-002",
    experience: "public",
    title_public: "Simulated ankle injury vignette",
    opening:
      "Simulated adult twisted an ankle during a recreational game. Immediate swelling, can take four steps with pain, no numbness, no open wound. Simulated educational case only.",
    differential: [
      { label: "Lateral ankle sprain", percent: 70, support: "Twisting mechanism and swelling.", against: "Fracture not excluded by this vignette." },
      { label: "Malleolar fracture", percent: 20, support: "Inability to fully weight-bear raises concern.", against: "Can take four steps." },
      { label: "Soft-tissue contusion only", percent: 10, support: "Possible with low force.", against: "Immediate swelling is more than a bruise." },
    ],
    explain_es: "Explorador público: solo casos simulados, sin tratamiento.",
    explain_en: "Public explorer: simulated cases only, no treatment advice.",
  },
  {
    blind_id: "sim-public-003",
    experience: "public",
    title_public: "Simulated headache vignette",
    opening:
      "Simulated adult with recurrent one-sided throbbing headache, light sensitivity, and nausea, lasting hours, similar to prior episodes. No fever, no neck stiffness, no new neurological deficit in the vignette. Simulated educational case only.",
    differential: [
      { label: "Migraine-like primary headache", percent: 60, support: "Recurrent unilateral throbbing with photophobia.", against: "No clinician exam in this vignette." },
      { label: "Tension-type headache", percent: 25, support: "Common and sometimes overlapping.", against: "Nausea and photophobia are less typical." },
      { label: "Secondary headache not characterized here", percent: 15, support: "Always a residual category in education.", against: "No red-flag details are provided." },
    ],
    explain_es: "Los porcentajes son didácticos, no una predicción clínica.",
    explain_en: "Percentages are educational, not a clinical prediction.",
  },
];

export const PROFESSIONAL_CASES = [
  {
    blind_id: "pro-sandbox-001",
    experience: "professional",
    opening:
      "De-identified sandbox case. Adult, 41 years old, hybrid office work and weekly regional flights. Mid-winter. Day 0 sore throat and fatigue after a 3.5 hour flight; day 1 myalgias and fever 38.4 C; day 3 dry cough, consumer SpO2 97-98%; day 4 fever 37.6 C, no chest pain, no hemoptysis, no confusion. No PCR, antigen, CBC, or imaging yet.",
    sealed: {
      title: "sandbox-winter-respiratory",
      pmcid: "",
      article_link: "",
      final_diagnosis: "Influenza-like illness",
      diagnostic_reasoning: "Sandbox label only. Not a gold MedCaseReasoning diagnosis.",
      aliases: ["ILI", "influenza like illness", "viral respiratory illness"],
      sections: {
        history: "Post-flight winter onset over four days with fever then lingering dry cough. No known household test-positive contact.",
        physical_exam: "No clinician exam recorded. Patient reports no resting dyspnea now.",
        basic_labs: "",
        imaging: "",
        pathology: "",
        special_tests: "",
      },
    },
  },
  {
    blind_id: "pro-sandbox-002",
    experience: "professional",
    opening:
      "De-identified sandbox case. Adult with subacute polyuria and polydipsia, unintended weight loss, and blurred vision. No personal identifiers. No glucose value is in the opening note.",
    sealed: {
      title: "sandbox-endocrine-metabolic",
      pmcid: "",
      article_link: "",
      final_diagnosis: "New hyperglycemia syndrome",
      diagnostic_reasoning: "Sandbox label only.",
      aliases: ["diabetes", "hyperglycemia", "new onset diabetes"],
      sections: {
        history: "Weeks of polyuria, polydipsia, and weight loss.",
        physical_exam: "",
        basic_labs: "Sandbox lab card: random glucose markedly elevated. Automatically sourced, not clinically validated.",
        imaging: "",
        pathology: "",
        special_tests: "",
      },
    },
  },
];
