"use client";

import { FormEvent, KeyboardEvent, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  FlaskConical,
  Globe2,
  Keyboard,
  Loader2,
  ShieldAlert,
  Stethoscope,
} from "lucide-react";

type Locale = "en" | "es";
type Experience = "research" | "professional" | "public";

type WireRun = {
  run_id: string;
  experience: string;
  track: string;
  phase: string;
  status: string;
  blind_id: string;
  opening: string;
  replay: boolean;
  source?: string;
  fixture_id?: string;
  scoring_eligible: boolean;
  spent_units: number;
  budget_units: number;
  rounds: number;
  diagnosis: string;
  status_public: string;
  observations: Array<{
    observation_id: string;
    section: string;
    content: string;
    code: string;
    resource_units: number;
  }>;
  differential: Array<{
    label: string;
    percent: number;
    support: string;
    against: string;
  }>;
  score: {
    correct: boolean;
    quorum: number;
    complete: boolean;
    clinical_validity: null;
    heuristic_only?: boolean;
    scoring_mode?: string;
    exact_match?: boolean;
    alias_match?: boolean;
  } | null;
  error: { code: string; message: string } | null;
};

const COPY = {
  en: {
    kicker: "Experimental / research and education only / not clinically validated",
    title: "Clinical Sequential Reasoning Lab",
    research: "Research",
    professional: "Professional",
    public: "Public",
    researchLead:
      "Research stays unavailable until an immutable 897-case corpus pin exists. This tab never starts a professional sandbox.",
    professionalLead:
      "Sequential sandbox on predefined de-identified cases. Ask questions or request tests. Vague queries return evidence_not_available.",
    publicLead:
      "Educational explorer of simulated cases. Differentials are visible. No personal symptoms, no treatment, no scored diagnosis.",
    recorded: "Recorded fixture — immutable, not a live run",
    sandbox: "Live sandbox — generated dynamically, not a recorded execution",
    unavailable: "Unavailable",
    ask: "Ask a question",
    test: "Request a test",
    submit: "Submit diagnosis",
    start: "Start sandbox run",
    replay: "Load recorded fixture",
    closed: "Closed sequential",
    retrieval: "Retrieval-assisted (unavailable)",
    noPhi:
      "This is a predefined-case sandbox. Personal symptoms, identifiers, and free-text personal cases are rejected. Detection is heuristic, not perfect.",
    noRx: "No treatment or prescription is offered. This is not medical advice.",
    english: "Canonical scored text is English.",
    researchBlocked: "Official corpus status: unavailable. No fallback run is created.",
    retrievalBlocked: "Live retrieval is unavailable until Browser Real is connected.",
    heuristic:
      "Scores are heuristic_only regression metrics. exact_match/alias_match are not clinical accuracy. clinical_validity is null.",
  },
  es: {
    kicker: "Experimental / solo investigación y educación / no validado clínicamente",
    title: "Laboratorio de razonamiento clínico secuencial",
    research: "Investigación",
    professional: "Profesional",
    public: "Público",
    researchLead:
      "Investigación permanece no disponible hasta que exista un pin inmutable de 897 casos. Esta pestaña nunca inicia un sandbox profesional.",
    professionalLead:
      "Sandbox secuencial con casos desidentificados predefinidos. Pregunte o solicite pruebas. Las consultas vagas devuelven evidence_not_available.",
    publicLead:
      "Explorador educativo de casos simulados. El diferencial es visible. Sin síntomas personales, sin tratamiento y sin diagnóstico puntuado.",
    recorded: "Fixture grabado — inmutable, no es una corrida en vivo",
    sandbox: "Sandbox en vivo — generado dinámicamente, no es una ejecución grabada",
    unavailable: "No disponible",
    ask: "Hacer una pregunta",
    test: "Solicitar una prueba",
    submit: "Enviar diagnóstico",
    start: "Iniciar corrida sandbox",
    replay: "Cargar fixture grabado",
    closed: "Secuencial cerrado",
    retrieval: "Con recuperación (no disponible)",
    noPhi:
      "Este es un sandbox de casos predefinidos. Se rechazan síntomas personales, identificadores y texto clínico personal. La detección es heurística, no perfecta.",
    noRx: "No se ofrece tratamiento ni prescripción. Esto no es consejo médico.",
    english: "El texto canónico puntuado es inglés.",
    researchBlocked: "Estado del corpus oficial: no disponible. No se crea una corrida alternativa.",
    retrievalBlocked: "La recuperación en vivo no está disponible hasta conectar Browser Real.",
    heuristic:
      "Las puntuaciones son métricas de regresión heuristic_only. exact_match/alias_match no son exactitud clínica. clinical_validity es null.",
  },
} as const;

const PUBLIC_CASES = [
  { id: "sim-public-001", label: "Winter cough (simulated)" },
  { id: "sim-public-002", label: "Ankle injury (simulated)" },
  { id: "sim-public-003", label: "Headache (simulated)" },
];

const PRO_CASES = [
  { id: "pro-sandbox-001", label: "Sandbox respiratory" },
  { id: "pro-sandbox-002", label: "Sandbox metabolic" },
];

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/clinical/v1beta${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const payload = (await response.json()) as T & { code?: string; message?: string };
  if (!response.ok) {
    throw new Error(payload.message || payload.code || "clinical request failed");
  }
  return payload;
}

export function ClinicalLabClient() {
  const [locale, setLocale] = useState<Locale>("en");
  const [experience, setExperience] = useState<Experience>("professional");
  const [track, setTrack] = useState("closed_sequential");
  const [blindId, setBlindId] = useState("pro-sandbox-001");
  const [query, setQuery] = useState("history of present illness");
  const [run, setRun] = useState<WireRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const t = COPY[locale];
  const researchBlocked = experience === "research";
  const retrievalBlocked = track === "retrieval_assisted";
  const cases = experience === "public" ? PUBLIC_CASES : PRO_CASES;
  const panelId = `clinical-panel-${experience}`;

  const lead = useMemo(() => {
    if (experience === "research") return t.researchLead;
    if (experience === "public") return t.publicLead;
    return t.professionalLead;
  }, [experience, t]);

  async function start(replay = false) {
    if (researchBlocked && !replay) {
      setError(t.researchBlocked);
      setRun(null);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const created = await api<WireRun>("/runs", {
        method: "POST",
        body: JSON.stringify(
          replay
            ? { replay: true, fixture_id: "clinical-recorded-run-v1", locale }
            : { experience, track, blind_id: blindId, locale },
        ),
      });
      setRun(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed");
    } finally {
      setBusy(false);
    }
  }

  async function act(name: string, event?: FormEvent) {
    event?.preventDefault();
    if (!run || researchBlocked) return;
    setBusy(true);
    setError("");
    try {
      const updated = await api<WireRun>(`/runs/${run.run_id}/actions`, {
        method: "POST",
        body: JSON.stringify({ name, query }),
      });
      setRun(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed");
    } finally {
      setBusy(false);
    }
  }

  function onTabKey(event: KeyboardEvent<HTMLButtonElement>, id: Experience) {
    const order: Experience[] = ["research", "professional", "public"];
    const index = order.indexOf(id);
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      const next = order[(index + (event.key === "ArrowRight" ? 1 : order.length - 1)) % order.length];
      setExperience(next);
      setRun(null);
      setBlindId(next === "public" ? "sim-public-001" : "pro-sandbox-001");
      document.getElementById(`clinical-tab-${next}`)?.focus();
    }
  }

  return (
    <section className="clinical-lab" aria-labelledby="clinical-lab-title">
      <header className="clinical-lab-hero">
        <p className="clinical-lab-kicker">
          <ShieldAlert size={16} aria-hidden="true" />
          {t.kicker}
        </p>
        <div className="clinical-lab-hero-row">
          <h2 id="clinical-lab-title">{t.title}</h2>
          <div className="clinical-lab-locales" role="group" aria-label="Language">
            <button type="button" className={locale === "en" ? "is-active" : ""} onClick={() => setLocale("en")}>
              EN
            </button>
            <button type="button" className={locale === "es" ? "is-active" : ""} onClick={() => setLocale("es")}>
              ES
            </button>
          </div>
        </div>
        <p>{lead}</p>
        <p className="clinical-lab-fine">
          {t.noPhi} {t.noRx} {t.english}
        </p>
      </header>

      <div className="clinical-lab-tabs" role="tablist" aria-label="Experiences">
        {(
          [
            ["research", t.research, FlaskConical],
            ["professional", t.professional, Stethoscope],
            ["public", t.public, Globe2],
          ] as const
        ).map(([id, label, Icon]) => (
          <button
            key={id}
            id={`clinical-tab-${id}`}
            type="button"
            role="tab"
            aria-selected={experience === id}
            aria-controls={panelId}
            tabIndex={experience === id ? 0 : -1}
            className={experience === id ? "is-active" : ""}
            onKeyDown={(event) => onTabKey(event, id)}
            onClick={() => {
              setExperience(id);
              setRun(null);
              setError("");
              setBlindId(id === "public" ? "sim-public-001" : "pro-sandbox-001");
            }}
          >
            <Icon size={16} aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>

      <div id={panelId} role="tabpanel" aria-labelledby={`clinical-tab-${experience}`}>
        {experience === "research" && (
          <div className="clinical-lab-panel" data-state="unavailable">
            <p>
              Official progress: <strong>unavailable / 897</strong> closed sequential,{" "}
              <strong>unavailable / 897</strong> retrieval-assisted.
            </p>
            <p>{t.researchBlocked}</p>
            <button type="button" className="liquid-button !text-sm" disabled>
              Export official report
            </button>
          </div>
        )}

        <div className="clinical-lab-grid">
          <form className="clinical-lab-panel" onSubmit={(event) => void act("ask_question", event)}>
            <label htmlFor="clinical-case">Case</label>
            <select
              id="clinical-case"
              value={blindId}
              onChange={(event) => setBlindId(event.target.value)}
              disabled={researchBlocked || busy}
            >
              {cases.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
            {experience !== "public" && (
              <>
                <label htmlFor="clinical-track">Track</label>
                <select
                  id="clinical-track"
                  value={track}
                  onChange={(event) => setTrack(event.target.value)}
                  disabled={researchBlocked || busy}
                >
                  <option value="closed_sequential">{t.closed}</option>
                  <option value="retrieval_assisted">{t.retrieval}</option>
                </select>
              </>
            )}
            {retrievalBlocked && <p className="clinical-lab-fine">{t.retrievalBlocked}</p>}
            <div className="clinical-lab-actions">
              <button
                type="button"
                className="liquid-button !text-sm"
                onClick={() => void start(false)}
                disabled={busy || researchBlocked || retrievalBlocked}
              >
                {busy ? <Loader2 size={14} className="animate-spin" /> : null}
                {t.start}
              </button>
              <button
                type="button"
                className="liquid-button-secondary !text-sm"
                onClick={() => void start(true)}
                disabled={busy}
              >
                {t.replay}
              </button>
            </div>
            {experience !== "public" && !researchBlocked && run && run.phase !== "closed" && (
              <>
                <label htmlFor="clinical-query">Action</label>
                <textarea
                  id="clinical-query"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  rows={3}
                  disabled={busy}
                />
                <div className="clinical-lab-actions">
                  <button type="submit" className="liquid-button-secondary !text-sm" disabled={busy}>
                    {t.ask}
                  </button>
                  <button
                    type="button"
                    className="liquid-button-secondary !text-sm"
                    disabled={busy}
                    onClick={() => void act("request_test")}
                  >
                    {t.test}
                  </button>
                  <button
                    type="button"
                    className="liquid-button !text-sm"
                    disabled={busy}
                    onClick={() => void act("submit_diagnosis")}
                  >
                    {t.submit}
                  </button>
                </div>
              </>
            )}
            <p className="clinical-lab-fine">
              <Keyboard size={14} aria-hidden="true" /> Arrow keys move experience tabs. Tab order follows case, track, then actions.
            </p>
          </form>

          <div className="clinical-lab-panel" aria-live="polite">
            {run?.source === "recorded_fixture" && (
              <p className="clinical-lab-recorded">
                <AlertCircle size={16} aria-hidden="true" /> {t.recorded}
              </p>
            )}
            {run && run.source !== "recorded_fixture" && (
              <p className="clinical-lab-recorded">{t.sandbox}</p>
            )}
            {error && (
              <p className="clinical-lab-error" role="alert">
                {error}
              </p>
            )}
            {!run && !error && <p>No run yet.</p>}
            {run && (
              <>
                <p>
                  <strong>{run.blind_id}</strong> · {run.phase} · {run.spent_units}/{run.budget_units} resource units
                </p>
                <p>{run.opening}</p>
                {run.differential.length > 0 && (
                  <ul className="clinical-lab-diff">
                    {run.differential.map((item) => (
                      <li key={item.label}>
                        <span>
                          {item.label} <strong>{item.percent}%</strong>
                        </span>
                        <small>
                          {item.support} {item.against}
                        </small>
                      </li>
                    ))}
                  </ul>
                )}
                <ol className="clinical-lab-timeline">
                  {run.observations.map((item) => (
                    <li key={item.observation_id}>
                      <CheckCircle2 size={14} aria-hidden="true" />
                      <span>
                        {item.section}: {item.content}
                        {item.code ? ` (${item.code})` : ""}
                      </span>
                    </li>
                  ))}
                </ol>
                {run.phase === "closed" && (
                  <p>
                    Diagnosis: {run.diagnosis || "—"}. heuristic_only: {String(run.score?.heuristic_only)}.
                    exact_match: {String(run.score?.exact_match)}. correct: {String(run.score?.correct)}. Clinical
                    validity: none.
                  </p>
                )}
                <p className="clinical-lab-fine">{t.heuristic}</p>
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
