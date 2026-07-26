"use client";

import {
  AudioLines,
  Check,
  ChevronRight,
  CirclePlay,
  Clock3,
  FileAudio,
  FileText,
  Film,
  Languages,
  Link2,
  Mic2,
  PackageCheck,
  Settings2,
  ShieldCheck,
  Sparkles,
  Subtitles,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

const stages = [
  { name: "Ingest", detail: "Inspect source", icon: Link2 },
  { name: "Transcribe", detail: "Speech and timing", icon: Mic2 },
  { name: "Translate", detail: "Adapt dialogue", icon: Languages },
  { name: "Voice cast", detail: "Match speakers", icon: Users },
  { name: "Synchronize", detail: "Mix and package", icon: AudioLines },
];

const artifacts = [
  ["source_video.mp4", "Source", Film],
  ["spanish_subtitles.srt", "Subtitles", Subtitles],
  ["speaker_01.wav", "Voice track", FileAudio],
  ["speaker_02.wav", "Voice track", FileAudio],
  ["translated_video_synced.mp4", "Delivery", CirclePlay],
] as const;

export default function MediaStudioPage() {
  const [sourceUrl, setSourceUrl] = useState("https://www.youtube.com/watch?v=demo");
  const [sourceLanguage, setSourceLanguage] = useState("Auto detect");
  const [targetLanguage, setTargetLanguage] = useState("Spanish");
  const [speakerAware, setSpeakerAware] = useState(true);
  const [activeStage, setActiveStage] = useState(-1);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      setActiveStage((current) => {
        if (current >= stages.length - 1) {
          window.clearInterval(timer);
          setRunning(false);
          return current;
        }
        return current + 1;
      });
    }, 700);
    return () => window.clearInterval(timer);
  }, [running]);

  const complete = activeStage === stages.length - 1 && !running;
  const progress = useMemo(
    () => (activeStage < 0 ? 0 : Math.round(((activeStage + 1) / stages.length) * 100)),
    [activeStage],
  );

  function startDemo() {
    if (!sourceUrl.trim() || running) return;
    setActiveStage(-1);
    setRunning(true);
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#workspace" aria-label="HandoffKit Media Studio home">
          <span className="brand-mark"><Film size={19} /></span>
          <span>HandoffKit</span>
          <strong>Media Studio</strong>
        </a>
        <div className="topbar-meta">
          <span className="status-dot" />
          Offline simulation
        </div>
      </header>

      <section className="workspace" id="workspace">
        <aside className="rail">
          <div className="rail-heading">
            <span>New localization</span>
            <Settings2 size={16} />
          </div>

          <label className="field field-wide">
            <span>Video URL</span>
            <span className="input-wrap">
              <Link2 size={16} />
              <input value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} />
            </span>
          </label>

          <div className="field-row">
            <label className="field">
              <span>Source language</span>
              <select value={sourceLanguage} onChange={(event) => setSourceLanguage(event.target.value)}>
                <option>Auto detect</option>
                <option>Mandarin Chinese</option>
                <option>English</option>
                <option>Japanese</option>
              </select>
            </label>
            <label className="field">
              <span>Translate to</span>
              <select value={targetLanguage} onChange={(event) => setTargetLanguage(event.target.value)}>
                <option>Spanish</option>
                <option>English</option>
                <option>Portuguese</option>
                <option>French</option>
              </select>
            </label>
          </div>

          <button
            className="toggle-row"
            type="button"
            aria-pressed={speakerAware}
            onClick={() => setSpeakerAware((value) => !value)}
          >
            <span><Users size={17} /> Speaker-aware voices</span>
            <span className={`toggle ${speakerAware ? "toggle-on" : ""}`}><i /></span>
          </button>

          <div className="voice-note">
            <Sparkles size={17} />
            <p><strong>Voice plan</strong><br />Detect speakers before synthesis and preserve each turn as structured state.</p>
          </div>

          <button className="run-button" type="button" onClick={startDemo} disabled={running || !sourceUrl.trim()}>
            {running ? <Clock3 size={17} /> : <CirclePlay size={17} />}
            {running ? "Running pipeline" : complete ? "Run again" : "Start translation"}
          </button>
          <p className="privacy-note"><ShieldCheck size={14} /> Demo mode makes no provider or download request.</p>
        </aside>

        <div className="canvas">
          <div className="canvas-heading">
            <div>
              <p className="context-label">Media translation workflow</p>
              <h1>Keep every voice, decision, and timestamp attached.</h1>
              <p>From source speech to synchronized delivery, each agent hands structured evidence to the next.</p>
            </div>
            <div className="quality-chip"><ShieldCheck size={16} /> Quality gate: 85%</div>
          </div>

          <div className="pipeline" aria-label="Translation pipeline progress">
            {stages.map((stage, index) => {
              const Icon = stage.icon;
              const done = index <= activeStage;
              const current = running && index === activeStage;
              return (
                <div className="pipeline-fragment" key={stage.name}>
                  <div className={`stage ${done ? "stage-done" : ""} ${current ? "stage-current" : ""}`}>
                    <span className="stage-icon">{done && !current ? <Check size={17} /> : <Icon size={18} />}</span>
                    <span><strong>{stage.name}</strong><small>{stage.detail}</small></span>
                  </div>
                  {index < stages.length - 1 && <ChevronRight className="connector" size={18} />}
                </div>
              );
            })}
          </div>

          <div className="progress-track" aria-label={`${progress}% complete`}>
            <span style={{ width: `${progress}%` }} />
          </div>

          <div className="result-layout">
            <section className="evidence-panel">
              <div className="section-title"><FileText size={17} /><h2>Handoff evidence</h2></div>
              <div className="decision-list">
                <article><span>01</span><p><strong>Speaker separation</strong>Two speaker identities remain stable across transcript and voice tracks.</p></article>
                <article><span>02</span><p><strong>Timing constraint</strong>Dialogue is adapted for duration before synthesized audio is rendered.</p></article>
                <article><span>03</span><p><strong>Delivery safeguard</strong>Human review remains required before publishing the translated video.</p></article>
              </div>
            </section>

            <section className="artifact-panel">
              <div className="section-title"><PackageCheck size={17} /><h2>Delivery package</h2></div>
              <div className="artifact-list">
                {artifacts.map(([name, kind, Icon]) => (
                  <div className="artifact" key={name}>
                    <span className="artifact-icon"><Icon size={17} /></span>
                    <span><strong>{name}</strong><small>{kind}</small></span>
                    <Check size={15} className="artifact-check" />
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>
      </section>
    </main>
  );
}
