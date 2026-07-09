"use client";

import { useState, useEffect, useRef } from 'react';

function evaluateTraceClient(trace) {
  if (!trace) return null;
  const checks = [];
  
  checks.push({
    name: "trace_success",
    passed: trace.success !== false,
    message: trace.success !== false ? "trace succeeded" : "trace indicates failure",
    severity: "error"
  });
  
  const steps = trace.steps || [];
  checks.push({
    name: "trace_steps",
    passed: steps.length > 0,
    message: steps.length > 0 ? `trace recorded ${steps.length} steps` : "trace recorded no steps",
    severity: "error"
  });
  
  const finalOutput = trace.finalOutput || trace.final_output || "";
  checks.push({
    name: "trace_final_output",
    passed: finalOutput.trim().length > 0,
    message: finalOutput.trim().length > 0 ? "trace has final output" : "trace final output is empty",
    severity: "error"
  });
  
  const handoffs = trace.handoffs || [];
  if (handoffs.length === 0) {
    checks.push({
      name: "handoffs_present",
      passed: false,
      message: "no handoff states were recorded",
      severity: "warning"
    });
  } else {
    checks.push({
      name: "handoffs_present",
      passed: true,
      message: `${handoffs.length} handoff state(s) recorded`,
      severity: "info"
    });
    
    handoffs.forEach((h, idx) => {
      const missingFields = [];
      if (!h.task) missingFields.push("task");
      if (!h.fromAgent && !h.from_agent) missingFields.push("fromAgent");
      if (!h.toAgent && !h.to_agent) missingFields.push("toAgent");
      if (!h.summary) missingFields.push("summary");
      
      const passed = missingFields.length === 0;
      checks.push({
        name: `handoff_${idx + 1}_contract`,
        passed,
        message: passed ? "contract validation passed" : `missing fields: ${missingFields.join(", ")}`,
        severity: "error"
      });
    });
  }
  
  let toolResultCount = 0;
  steps.forEach(step => {
    const toolResults = step.toolResults || step.tool_results || [];
    toolResults.forEach((tr) => {
      toolResultCount++;
      const passed = tr.success !== false;
      checks.push({
        name: `tool_result_${toolResultCount}`,
        passed,
        message: passed ? `tool ${tr.name || tr.tool_name || "unknown"} succeeded` : `tool ${tr.name || tr.tool_name || "unknown"} failed: ${tr.error || "unknown"}`,
        severity: "error"
      });
    });
  });
  
  const blocking = checks.filter(c => c.severity === "error");
  const passedCount = blocking.filter(c => c.passed).length;
  const score = blocking.length > 0 ? passedCount / blocking.length : 1.0;
  
  let grade = "F";
  if (score >= 0.9) grade = "A";
  else if (score >= 0.75) grade = "B";
  else if (score >= 0.6) grade = "C";
  else if (score >= 0.4) grade = "D";
  
  const recommendations = [];
  checks.forEach(c => {
    if (c.passed || c.severity !== "error") return;
    if (c.name.includes("handoff")) recommendations.push("Improve handoff contracts and quality before release.");
    else if (c.name.includes("trace")) recommendations.push("Record complete run traces with steps and final output.");
    else if (c.name.includes("tool")) recommendations.push("Resolve failed tool calls or tool execution reports.");
  });
  if (recommendations.length === 0) {
    recommendations.push("Workflow artifacts passed offline evaluation.");
  }
  
  return {
    success: score >= 0.75 && blocking.every(c => c.passed),
    score,
    grade,
    checks,
    recommendations
  };
}

// Static Inspector Data (Landing Page)
const inspectorStates = {
    architect: {
        task: "Build a pure calculator CLI using argparse",
        decisions: [
            "Use argparse for terminal interface",
            "Keep math operations in pure module"
        ],
        files: [],
        errors: [],
        next_steps: [
            "Implement core operations",
            "Add argparse interface"
        ],
        quality_score: 0.0,
        metadata: {
            sender: "Architect",
            receiver: "Coder",
            status: "planned"
        }
    },
    coder: {
        task: "Build a pure calculator CLI using argparse",
        decisions: [
            "Use argparse for terminal interface",
            "Keep math operations in pure module",
            "Created calculator.py with core operations",
            "Created main.py handling CLI arguments"
        ],
        files: [
            "calculator.py",
            "main.py"
        ],
        errors: [],
        next_steps: [
            "Write unit tests",
            "Verify CLI arg handling"
        ],
        quality_score: 0.0,
        metadata: {
            sender: "Coder",
            receiver: "Tester",
            status: "implemented"
        }
    },
    tester: {
        task: "Build a pure calculator CLI using argparse",
        decisions: [
            "Use argparse for terminal interface",
            "Keep math operations in pure module",
            "Created calculator.py with core operations",
            "Created main.py handling CLI arguments",
            "Wrote test_calculator.py covering operations",
            "Verified CLI output via automated test execution"
        ],
        files: [
            "calculator.py",
            "main.py",
            "test_calculator.py"
        ],
        errors: [],
        next_steps: [],
        quality_score: 1.0,
        metadata: {
            sender: "Tester",
            receiver: "Pipeline",
            status: "verified"
        }
    }
};

// Demos Workspace Datasets (Offline Fallbacks)
const demoWorkspaces = {
    coding: {
        name: "coding-review",
        sidebarTitle: "coding-review",
        sidebarSubtitle: "Software Engineering Agent Team",
        themeClass: "code-theme",
        icon: "code",
        badge: "SOFTWARE PIPELINE",
        badgeClass: "badge-coding",
        description: "Simulates a software development workflow where an Architect outlines tasks, a Coder changes files, and a Tester verifies the modifications.",
        prompt: "handoffkit showcase coding-review",
        defaultTask: "Build a pure calculator CLI using argparse",
        placeholder: "E.g. Build a pure calculator CLI using argparse",
        steps: ["Architect", "Coder", "Tester"],
        logs: [
            "Preparing local execution directories...",
            "[+] Running Step 1: Architect Planning...",
            "    → Evaluating coding guidelines...",
            "    → Defined structured contracts: decisions & tasks outline.",
            "[+] Running Step 2: Coder Execution...",
            "    → Modifying: calculator.py",
            "    → Modifying: main.py",
            "    → State updated: files attached & implementation decisions logged.",
            "[+] Running Step 3: Tester Verification...",
            "    → Executing pytest test_calculator.py...",
            "    → Output: 3 passed, 0 failed.",
            "    → Trace report compiled.",
            "[SUCCESS] coding-review showcase finished. Outputs saved to runs/latest/"
        ],
        report: {
            score: "1.00 (PASSED)",
            scoreClass: "status-verified",
            decisions: [
                "Use argparse for CLI input validations",
                "Deploy operations in pure arithmetic module",
                "Ensure floating point rounding is handled in division"
            ],
            files: ["calculator.py", "main.py", "test_calculator.py"],
            next_steps: ["None - Pipeline finished successfully"]
        }
    },
    doctor: {
        name: "doctor-orchestrator",
        sidebarTitle: "doctor-orchestrator",
        sidebarSubtitle: "Research-only Diagnostic Panel",
        themeClass: "doctor-theme",
        icon: "pulse",
        badge: "CLINICAL WORKFLOW",
        badgeClass: "badge-doctor",
        description: "Clinical virtual physician-panel workflow. Models structured state transitions through Intake, Hypothesis, Challenger, Test Steward, Checklist, and Final Reviewer.",
        prompt: "handoffkit showcase doctor-orchestrator",
        defaultTask: "Patient presents with persistent cough, mild fever, and joint stiffness.",
        placeholder: "E.g. Patient presents with joint stiffness and fever...",
        steps: ["Intake", "Hypothesis", "Challenger", "Steward", "Checklist", "Reviewer"],
        logs: [
            "Acquiring clinical PMC case report records...",
            "[+] Running Step 1: Intake Steward...",
            "    → Summarizing chief complaint and medical history...",
            "[+] Running Step 2: Diagnostic Hypothesis...",
            "    → Modeling uncertainty parameters and primary differentials...",
            "[+] Running Step 3: Challenger Peer...",
            "    → Challenging base diagnosis, identifying diagnostic biases...",
            "[+] Running Step 4: Test Steward...",
            "    → Suggesting cost-aware laboratory and imaging tests...",
            "[+] Running Step 5: Safety Checklist...",
            "    → Validating contraindications and red-flag alerts...",
            "[+] Running Step 6: Final Reviewer Panel...",
            "    → Consolidating panel results and evidence trails...",
            "[SUCCESS] doctor-orchestrator finished. Clinical logs stored in runs/latest/"
        ],
        report: {
            score: "0.94 (COMPLETED)",
            scoreClass: "status-implemented",
            decisions: [
                "Recommend thoracic CT scan over chest X-ray due to minor nodules",
                "Flag allergy alerts for penicillin compounds",
                "Verify Intake chief complaints match Challenger assumptions"
            ],
            files: ["patient_intake.json", "differential_hypotheses.txt", "imaging_referrals.json"],
            next_steps: ["Escalate to virtual cardiology specialist panel"]
        }
    },
    support: {
        name: "support-escalation",
        sidebarTitle: "support-escalation",
        sidebarSubtitle: "Customer Triage & SLA Router",
        themeClass: "support-theme",
        icon: "chat",
        badge: "CUSTOMER SUCCESS",
        badgeClass: "badge-support",
        description: "Customer service escalation chain. Performs initial ticket triage, triggers expert analysis, checks SLA guidelines, and dispatches customer responses.",
        prompt: "handoffkit showcase support-escalation",
        defaultTask: "Critical error: database connection pool exhausted on payment gateway.",
        placeholder: "E.g. Database connection pool exhausted on payment gateway...",
        steps: ["Triage", "Analyst", "SLAMonitor", "Communicator"],
        logs: [
            "Awaiting inbound client ticket dispatch...",
            "[+] Running Step 1: Inbound Triage...",
            "    → Parsing customer severity and system category...",
            "[+] Running Step 2: Expert Analyst Debug...",
            "    → Running mock replica tests to isolate system fault...",
            "    → Identified minor memory leak in DB connect loops...",
            "[+] Running Step 3: SLA Monitor Verification...",
            "    → Ticket within 4-hour critical window contract...",
            "[+] Running Step 4: Client Communicator...",
            "    → Drafting patch notes and escalation resolutions...",
            "[SUCCESS] support-escalation finished. Ticket outputs saved to runs/latest/"
        ],
        report: {
            score: "1.00 (RESOLVED)",
            scoreClass: "status-verified",
            decisions: [
                "Escalate DB memory leaks directly to dev engineering queue",
                "Verify SLA timer logs remain under 120 minutes threshold",
                "Draft clear customer response addressing incident resolution"
            ],
            files: ["triage_metadata.json", "analyst_diagnosis.log", "customer_response.md"],
            next_steps: ["Close ticket in external CRM queue", "Publish internal hotfix documentation"]
        }
    },
    research: {
        name: "research-workflow",
        sidebarTitle: "research-workflow",
        sidebarSubtitle: "Sources, Claims & Writer Trace",
        themeClass: "research-theme",
        icon: "search",
        badge: "RESEARCH PIPELINE",
        badgeClass: "badge-research",
        description: "Research workflow where source gathering, extraction, fact checking, and writing each pass structured evidence and uncertainty to the next agent.",
        prompt: "handoffkit showcase research-workflow",
        defaultTask: "Summarize reliable evidence about retrieval-augmented generation evaluation.",
        placeholder: "E.g. Summarize reliable evidence about agent evaluation...",
        steps: ["Researcher", "Extractor", "FactChecker", "Writer"],
        logs: [
            "Preparing research workspace and citation ledger...",
            "[+] Running Step 1: Researcher Source Discovery...",
            "    -> Collecting source candidates and evidence IDs...",
            "[+] Running Step 2: Extractor Claim Table...",
            "    -> Extracting claims, quotes, and uncertainty markers...",
            "[+] Running Step 3: FactChecker Verification...",
            "    -> Comparing extracted claims against source notes...",
            "[+] Running Step 4: Writer Brief...",
            "    -> Producing final brief with citations and caveats...",
            "[SUCCESS] research-workflow finished. Evidence report saved to runs/latest/"
        ],
        report: {
            score: "0.96 (TRACEABLE)",
            scoreClass: "status-verified",
            decisions: [
                "Separate claims from interpretations before writing",
                "Attach source IDs to every claim carried forward",
                "Flag unsupported claims instead of silently polishing them"
            ],
            files: ["sources.json", "claim_table.md", "fact_check_report.md", "brief.md"],
            next_steps: ["Publish final brief after human review"]
        }
    },
    fusion: {
        name: "fusion-style",
        sidebarTitle: "fusion-style",
        sidebarSubtitle: "Multi-model Deliberation",
        themeClass: "fusion-theme",
        icon: "nodes",
        badge: "MODEL FUSION",
        badgeClass: "badge-fusion",
        description: "Fusion-style deliberation demo with a router, candidate model panel, evidence-aware judge, and replayable report output.",
        prompt: "handoffkit demo-fusion",
        defaultTask: "Compare candidate answers and choose the safest final response with evidence.",
        placeholder: "E.g. Compare candidate answers and choose the safest final response...",
        steps: ["Router", "Panel", "Judge", "Reporter"],
        logs: [
            "Loading offline fusion candidates...",
            "[+] Running Step 1: Router Planning...",
            "    -> Assigning model roles and conflict checks...",
            "[+] Running Step 2: Panel Deliberation...",
            "    -> Comparing candidate answers and confidence notes...",
            "[+] Running Step 3: Judge Selection...",
            "    -> Voting with evidence and disagreement tracking...",
            "[+] Running Step 4: Reporter Summary...",
            "    -> Writing audit report and replay summary...",
            "[SUCCESS] fusion-style demo finished. Decision matrix saved to runs/latest/"
        ],
        report: {
            score: "0.92 (CONSENSUS)",
            scoreClass: "status-implemented",
            decisions: [
                "Prefer evidence-backed answer over longest answer",
                "Track dissenting model notes before final judgment",
                "Preserve vote rationale for replay"
            ],
            files: ["candidate_votes.json", "judge_report.md", "fusion_trace.json"],
            next_steps: ["Run real provider probes only with explicit API keys"]
        }
    },
    media: {
        name: "media-dubbing",
        sidebarTitle: "media-dubbing",
        sidebarSubtitle: "Video Translation Workflow",
        themeClass: "media-theme",
        icon: "media",
        badge: "MEDIA LOCALIZATION",
        badgeClass: "badge-media",
        description: "Offline media localization plan that transcribes, translates, casts voices, and packages a dubbing run without calling external services by default.",
        prompt: "handoffkit demo-media",
        defaultTask: "Translate a short Mandarin video into Spanish with speaker-aware dubbing notes.",
        placeholder: "E.g. Translate a short Mandarin video into Spanish...",
        steps: ["Transcriber", "Translator", "VoiceCast", "Publisher"],
        logs: [
            "Preparing media localization workspace...",
            "[+] Running Step 1: Transcriber Pass...",
            "    -> Segmenting source speech and speaker turns...",
            "[+] Running Step 2: Translator Adaptation...",
            "    -> Translating dialogue while preserving timing notes...",
            "[+] Running Step 3: VoiceCast Planning...",
            "    -> Matching voices and emotion tags by speaker...",
            "[+] Running Step 4: Publisher Package...",
            "    -> Preparing final asset manifest and delivery notes...",
            "[SUCCESS] media-dubbing demo finished. Localization manifest saved to runs/latest/"
        ],
        report: {
            score: "0.90 (READY)",
            scoreClass: "status-implemented",
            decisions: [
                "Keep transcript segments aligned before voice generation",
                "Use separate voice profiles per speaker",
                "Require human review before publishing dubbed media"
            ],
            files: ["transcript_segments.json", "spanish_script.srt", "voice_cast.md", "delivery_manifest.json"],
            next_steps: ["Attach generated audio to video in the media toolchain"]
        }
    }
};

export default function Home() {
    const [activeScreen, setActiveScreen] = useState('home');
    const [activeInspector, setActiveInspector] = useState('architect');
    const [activeDemoKey, setActiveDemoKey] = useState('coding');
    const [workbenchTab, setWorkbenchTab] = useState('flow');
    const [isDemoRunning, setIsDemoRunning] = useState(false);
    const [nvidiaKey, setNvidiaKey] = useState('');
    const [perAgentModels, setPerAgentModels] = useState({});
    const [openDropdowns, setOpenDropdowns] = useState({});

    const [uploadedTrace, setUploadedTrace] = useState(null);
    const [evaluationReport, setEvaluationReport] = useState(null);
    const [selectedStepIdx, setSelectedStepIdx] = useState(0);

    const handleTraceUpload = (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const json = JSON.parse(event.target.result);
                setUploadedTrace(json);
                const report = evaluateTraceClient(json);
                setEvaluationReport(report);
                setSelectedStepIdx(0);
                triggerToast("Trace loaded and evaluated successfully!");
            } catch (err) {
                triggerToast("Failed to parse JSON file.");
            }
        };
        reader.readAsText(file);
    };

    const nvidiaModelsList = [
        { id: 'meta/llama-3.1-8b-instruct', name: 'Llama-3.1 8B', desc: 'Fast, Free' },
        { id: 'meta/llama-3.1-70b-instruct', name: 'Llama-3.1 70B', desc: 'Powerful, Free' },
        { id: 'mistralai/mixtral-8x22b-instruct-v0.1', name: 'Mixtral 8x22B', desc: 'High Quality' },
        { id: 'google/gemma-2-9b-it', name: 'Gemma-2 9B', desc: 'Efficient' }
    ];
    const [customPrompt, setCustomPrompt] = useState('');
    const [terminalLogs, setTerminalLogs] = useState([]);
    const [activeFlowStepIdx, setActiveFlowStepIdx] = useState(-1);
    const [liveState, setLiveState] = useState(null);
    const [chatMessages, setChatMessages] = useState([]);
    const [viewCodeFilename, setViewCodeFilename] = useState('');
    const [viewCodeContent, setViewCodeContent] = useState('');
    const [toastMessage, setToastMessage] = useState('');
    const [activeDocSection, setActiveDocSection] = useState('docs-install');

    const terminalLogsEndRef = useRef(null);
    const chatEndRef = useRef(null);

    // Toast triggers
    const triggerToast = (msg) => {
        setToastMessage(msg);
        setTimeout(() => setToastMessage(''), 3000);
    };

    // persistent screen switch helper
    const switchActiveScreen = (screen) => {
        setActiveScreen(screen);
        if (typeof window !== 'undefined') {
            window.location.hash = screen;
            localStorage.setItem('ACTIVE_SCREEN', screen);
        }
    };

    // Load credentials on mount
    useEffect(() => {
        let initialScreen = 'home';
        if (typeof window !== 'undefined') {
            const hash = window.location.hash.replace('#', '');
            if (['home', 'demos', 'docs'].includes(hash)) {
                initialScreen = hash;
            } else {
                const savedScreen = localStorage.getItem('ACTIVE_SCREEN');
                if (['home', 'demos', 'docs'].includes(savedScreen)) {
                    initialScreen = savedScreen;
                }
            }
        }
        setActiveScreen(initialScreen);

        const savedKey = localStorage.getItem('NVIDIA_API_KEY');
        if (savedKey) {
            setNvidiaKey(savedKey);
        } else {
            const defaultKey = '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';
            localStorage.setItem('NVIDIA_API_KEY', defaultKey);
            setNvidiaKey(defaultKey);
        }

    }, []);

    // Initialize per-agent models when demo changes
    useEffect(() => {
        const initialModels = {};
        demoWorkspaces[activeDemoKey].steps.forEach(step => {
            initialModels[step] = 'meta/llama-3.1-8b-instruct';
        });
        setPerAgentModels(initialModels);
        setOpenDropdowns({});
    }, [activeDemoKey]);

    // Auto-scroll chat body
    useEffect(() => {
        if (chatEndRef.current) {
            chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [chatMessages]);

    // Save key to local storage
    const handleKeyChange = (val) => {
        setNvidiaKey(val);
        localStorage.setItem('NVIDIA_API_KEY', val);
        triggerToast('NVIDIA API Key saved locally!');
    };

    // Save model to local storage
    const handleModelChange = (val) => {
        setNvidiaModel(val);
        localStorage.setItem('NVIDIA_MODEL', val);
    };

    // Auto rotate landing page steps
    useEffect(() => {
        const steps = ['architect', 'coder', 'tester'];
        const interval = setInterval(() => {
            setActiveInspector(prev => {
                const nextIdx = (steps.indexOf(prev) + 1) % steps.length;
                return steps[nextIdx];
            });
        }, 5000);
        return () => clearInterval(interval);
    }, []);

    // Scroll spy for docs screen
    useEffect(() => {
        const handleScroll = () => {
            if (activeScreen !== 'docs') return;
            const sections = ['docs-install', 'docs-cli', 'docs-api', 'docs-providers', 'docs-tools', 'docs-integrations'];
            let currentActive = 'docs-install';
            sections.forEach(s => {
                const el = document.getElementById(s);
                if (el) {
                    const rect = el.getBoundingClientRect();
                    if (rect.top <= 160) {
                        currentActive = s;
                    }
                }
            });
            setActiveDocSection(currentActive);
        };
        window.addEventListener('scroll', handleScroll);
        return () => window.removeEventListener('scroll', handleScroll);
    }, [activeScreen]);

    // Scroll console to bottom
    useEffect(() => {
        if (terminalLogsEndRef.current) {
            terminalLogsEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [terminalLogs]);

    // JSON syntax highlighter React helper
    const highlightJSON = (jsonObj) => {
        const str = JSON.stringify(jsonObj, null, 2);
        return str.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g, function (match) {
            let cls = 'syntax-number';
            if (/^"/.test(match)) {
                if (/:$/.test(match)) {
                    cls = 'syntax-key';
                } else {
                    cls = 'syntax-string';
                }
            } else if (/true|false/.test(match)) {
                cls = 'syntax-boolean';
            } else if (/null/.test(match)) {
                cls = 'syntax-null';
            }
            return `<span class="${cls}">${match}</span>`;
        });
    };

    // Copy to clipboard helper
    const handleCopy = (text, msg) => {
        navigator.clipboard.writeText(text).then(() => {
            triggerToast(msg);
        });
    };

    // Agent initials visual symbol
    const getAgentInitials = (stepName) => {
        if (!stepName) return '??';
        const name = stepName.toUpperCase();
        if (name === 'CHECKLIST') return 'CK';
        if (name === 'SLAMONITOR') return 'SL';
        if (name === 'COMMUNICATOR') return 'CM';
        return name.substring(0, 2);
    };

    const renderDemoIcon = (icon) => {
        const common = {
            width: "16",
            height: "16",
            viewBox: "0 0 24 24",
            fill: "none",
            stroke: "currentColor",
            strokeWidth: "2.5",
            strokeLinecap: "round",
            strokeLinejoin: "round"
        };

        if (icon === 'pulse') {
            return <svg {...common}><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></svg>;
        }
        if (icon === 'chat') {
            return <svg {...common}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>;
        }
        if (icon === 'search') {
            return <svg {...common}><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>;
        }
        if (icon === 'nodes') {
            return <svg {...common}><circle cx="6" cy="6" r="3" /><circle cx="18" cy="6" r="3" /><circle cx="12" cy="18" r="3" /><path d="M8.6 8.3 11 15" /><path d="m15.4 8.3-2.4 6.7" /></svg>;
        }
        if (icon === 'media') {
            return <svg {...common}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m10 9 5 3-5 3V9z" /></svg>;
        }
        return <svg {...common}><polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" /></svg>;
    };

    // Chat Sync Logger Helper
    const updateChatForLine = (line, demoKey, steps) => {
        const lowerLine = line.toLowerCase();
        let stepIdx = -1;
        steps.forEach((step, sIdx) => {
            const term = step.substring(0, 5).toLowerCase();
            if (lowerLine.includes(term) && (lowerLine.includes('starting') || lowerLine.includes('running') || lowerLine.includes('run step'))) {
                stepIdx = sIdx;
            }
        });

        if (stepIdx !== -1) {
            const stepName = steps[stepIdx];
            setChatMessages(prev => {
                const updated = prev.map(msg => ({ ...msg, status: 'done' }));
                let initialText = '';
                if (demoKey === 'coding') {
                    if (stepName === 'Architect') initialText = "Analyzing the task contract. Drafting the architectural specifications and CLI arguments parsing logic...";
                    else if (stepName === 'Coder') initialText = "Architect blueprint received. Initializing codebase files and implementing calculator class operations...";
                    else if (stepName === 'Tester') initialText = "Coder implementation received. Scanning code syntax and running automated verification suites...";
                } else if (demoKey === 'doctor') {
                    if (stepName === 'Intake') initialText = "Reviewing patient case record, chief complaints, and past medical history summaries...";
                    else if (stepName === 'Hypothesis') initialText = "Intake checklist compiled. Generating differential diagnoses and modeling primary clinical hypotheses...";
                    else if (stepName === 'Challenger') initialText = "Reviewing primary hypotheses. Isolating potential diagnostic biases and proposing alternative clinical paths...";
                    else if (stepName === 'Steward') initialText = "Differentials validated. Outlining cost-aware laboratory imaging recommendations...";
                    else if (stepName === 'Checklist') initialText = "Scanning clinical outline. Verifying allergy contraindications and red-flag checklist indicators...";
                    else if (stepName === 'Reviewer') initialText = "Consolidating clinical panel reports, evidence trails, and final referral summaries...";
                } else if (demoKey === 'support') {
                    if (stepName === 'Triage') initialText = "Analyzing customer ticket category, priority details, and system crash metadata...";
                    else if (stepName === 'Analyst') initialText = "Ticket triaged. Running local mock replica checks to isolate payment gateway database leak...";
                    else if (stepName === 'SLAMonitor') initialText = "Isolating database fault. Checking critical SLA contract guidelines and elapsed ticket windows...";
                    else if (stepName === 'Communicator') initialText = "SLA cleared. Drafting customer patch notifications and incident response templates...";
                }

                return [...updated, {
                    sender: stepName,
                    avatarClass: `avatar-${stepName.toLowerCase()}`,
                    text: initialText,
                    status: 'working',
                    details: []
                }];
            });
        }

        if (lowerLine.includes('completed') || lowerLine.includes('finished') || lowerLine.includes('success') || lowerLine.includes('done')) {
            setChatMessages(prev => {
                if (prev.length === 0) return prev;
                const updated = [...prev];
                const last = { ...updated[updated.length - 1] };
                last.status = 'done';

                if (demoKey === 'coding') {
                    if (last.sender === 'Architect') {
                        last.text = "I have drafted the implementation plans. Forwarding decisions and requirements contract to the Coder.";
                        last.details = ["Decision: Use argparse CLI", "Decision: Keep math operations in pure module"];
                    } else if (last.sender === 'Coder') {
                        last.text = "I have implemented the core arithmetic operations. Code files are attached and forwarded to the Tester.";
                        last.details = ["File: calculator.py", "File: main.py"];
                    } else if (last.sender === 'Tester') {
                        last.text = "All automated checks executed successfully. Pytest coverage is 100%. Pipeline output compiled.";
                        last.details = ["Quality Score: 1.00", "Status: PASSED", "File: test_calculator.py"];
                    }
                } else if (demoKey === 'doctor') {
                    if (last.sender === 'Intake') {
                        last.text = "Patient chief complaint summarized. Transferring intake file to Hypothesis Steward.";
                        last.details = ["File: patient_intake.json", "Complaint: Cough & Fever"];
                    } else if (last.sender === 'Hypothesis') {
                        last.text = "Primary differential diagnoses compiled. Forwarding to Challenger panel.";
                        last.details = ["Hypothesis: Thoracic nodules", "File: differential_hypotheses.txt"];
                    } else if (last.sender === 'Challenger') {
                        last.text = "Alternative diagnosis paths challenged. Verifying safety thresholds.";
                        last.details = ["Challenge: Flag penicillin allergy"];
                    } else if (last.sender === 'Steward') {
                        last.text = "Laboratory imaging recommendations compiled.";
                        last.details = ["Rec: Thoracic CT Scan", "File: imaging_referrals.json"];
                    } else if (last.sender === 'Checklist') {
                        last.text = "Safety checklists validated. Contraindications checked.";
                        last.details = ["Status: Validated", "Red-flags: None"];
                    } else if (last.sender === 'Reviewer') {
                        last.text = "Clinical panel review finalized. Compiling diagnostic trace.";
                        last.details = ["Quality Score: 0.94", "Next Step: Cardiology referral"];
                    }
                } else if (demoKey === 'support') {
                    if (last.sender === 'Triage') {
                        last.text = "Ticket priority triaged as CRITICAL. Transferring to Expert Analyst.";
                        last.details = ["Category: Payment gateway leak", "File: triage_metadata.json"];
                    } else if (last.sender === 'Analyst') {
                        last.text = "Memory leak isolated in DB connect pool. Transferring SLA parameters.";
                        last.details = ["File: analyst_diagnosis.log", "Fault: DB connect loop leak"];
                    } else if (last.sender === 'SLAMonitor') {
                        last.text = "SLA limits verified within contract safety window.";
                        last.details = ["Elapsed: 120 minutes", "Threshold: 240 minutes"];
                    } else if (last.sender === 'Communicator') {
                        last.text = "Client incident response draft completed. Ticket ready for queue dispatch.";
                        last.details = ["Quality Score: 1.00", "File: customer_response.md"];
                    }
                }

                updated[updated.length - 1] = last;
                return updated;
            });
        }
    };

    // 1. Mock Workspace Simulation
    const runMockSimulation = () => {
        setIsDemoRunning(true);
        setWorkbenchTab('logs');
        setTerminalLogs([]);
        setChatMessages([]);
        setLiveState(null);
        setViewCodeFilename('');
        setViewCodeContent('');

        const data = demoWorkspaces[activeDemoKey];
        let idx = 0;

        setTerminalLogs(prev => [...prev, { text: `[+] NVIDIA_API_KEY not detected. Running offline mock simulation...`, type: 'text-muted' }]);

        const interval = setInterval(() => {
            if (idx < data.logs.length) {
                const line = data.logs[idx];
                const isHeader = line.startsWith('[+]') || line.startsWith('[SUCC');
                const color = line.startsWith('[SUCCESS]') ? 'success-text' : (isHeader ? 'text-success' : 'text-muted');

                setTerminalLogs(prev => [...prev, { text: line, type: color }]);
                updateChatForLine(line, activeDemoKey, data.steps);

                // Flowchart highlighters
                data.steps.forEach((step, sIdx) => {
                    const term = step.substring(0, 5).toLowerCase();
                    if (line.toLowerCase().includes(term) && (line.includes('[+]') || line.includes('Running'))) {
                        setActiveFlowStepIdx(sIdx);
                    }
                });

                idx++;
            } else {
                clearInterval(interval);
                setIsDemoRunning(false);
                setLiveState({ isMock: true, ...data.report });
                triggerToast('Showcase completed! Trace report generated.');
                setActiveFlowStepIdx(-1);
            }
        }, 650);
    };

    // 2. Live Agent execution
    const runLiveSimulation = async (key) => {
        setIsDemoRunning(true);
        setWorkbenchTab('logs');
        setTerminalLogs([]);
        setChatMessages([]);
        setLiveState(null);
        setViewCodeFilename('');
        setViewCodeContent('');

        const data = demoWorkspaces[activeDemoKey];
        let userTask = customPrompt.trim();
        if (!userTask) {
            userTask = data.defaultTask;
        }

        setTerminalLogs([
            { text: `[+] Initializing workspace...`, type: 'text-muted' },
            { text: `[+] Connecting to NVIDIA NIM for pipeline execution...`, type: 'text-success' },
            { text: `[+] Initialized live workspace task: "${userTask}"`, type: 'text-success' }
        ]);

        let currentState = {
            task: userTask,
            decisions: [],
            files: [],
            errors: [],
            next_steps: [],
            quality_score: 0.0,
            metadata: {}
        };

        try {
            for (let i = 0; i < data.steps.length; i++) {
                const stepName = data.steps[i];
                setTerminalLogs(prev => [...prev, { text: `[+] Starting Step ${i+1}: ${stepName} Agent...`, type: 'text-success' }]);
                setActiveFlowStepIdx(i);

                setChatMessages(prev => {
                    const updated = prev.map(msg => ({ ...msg, status: 'done' }));
                    return [...updated, {
                        sender: stepName,
                        avatarClass: `avatar-${stepName.toLowerCase()}`,
                        text: `Querying ${perAgentModels[stepName] || 'meta/llama-3.1-8b-instruct'} to process ${stepName} contract...`,
                        status: 'working',
                        details: []
                    }];
                });

                const stepModel = perAgentModels[stepName] || 'meta/llama-3.1-8b-instruct';
                setTerminalLogs(prev => [...prev, {
                    text: `Querying ${stepModel} to process ${stepName} contract...`,
                    type: 'text-muted'
                }]);

                const sysPrompt = buildSystemInstructions(activeDemoKey, stepName);
                const userPrompt = `Current HandoffState contract: ${JSON.stringify(currentState, null, 2)}`;

                setTerminalLogs(prev => [...prev, { text: `    → Dispatching request to NVIDIA NIM...`, type: 'text-muted' }]);

                const completion = await queryNvidiaRoute(sysPrompt, userPrompt, key, stepModel);
                currentState = completion;

                setChatMessages(prev => {
                    if (prev.length === 0) return prev;
                    const updated = [...prev];
                    const last = { ...updated[updated.length - 1] };
                    last.status = 'done';

                    if (activeDemoKey === 'coding') {
                        if (stepName === 'Architect') {
                            last.text = "I have drafted the architectural specifications and CLI arguments parsing logic.";
                            last.details = completion.decisions ? completion.decisions.slice(0, 3).map(d => `Decision: ${d}`) : [];
                        } else if (stepName === 'Coder') {
                            last.text = `I have successfully implemented the requested python scripts: ${completion.files ? completion.files.join(', ') : 'none'}.`;
                            last.details = completion.files ? completion.files.map(f => `File: ${f}`) : [];
                        } else if (stepName === 'Tester') {
                            last.text = `I have completed the testing validations. Quality score: ${completion.quality_score !== undefined ? completion.quality_score.toFixed(2) : "1.00"}.`;
                            last.details = [
                                `Score: ${completion.quality_score}`,
                                `Errors: ${completion.errors && completion.errors.length > 0 ? completion.errors.join(', ') : 'none'}`
                            ];
                        }
                    } else {
                        last.text = `Completed ${stepName} operations. State successfully serialized.`;
                        last.details = completion.decisions ? completion.decisions.slice(0, 2).map(d => `Decision: ${d}`) : [];
                    }

                    updated[updated.length - 1] = last;
                    return updated;
                });

                setTerminalLogs(prev => [
                    ...prev,
                    { text: `    → ${stepName} completed. Decisions logged: ${completion.decisions ? completion.decisions.length : 0}`, type: 'text-muted' }
                ]);
                if (completion.files && completion.files.length > 0) {
                    setTerminalLogs(prev => [...prev, { text: `    → Attached files: ${completion.files.join(', ')}`, type: 'text-muted' }]);
                }
            }

            setTerminalLogs(prev => [...prev, { text: `[SUCCESS] Live multi-agent chain completed. Saved runs/latest/`, type: 'success-text' }]);
            setIsDemoRunning(false);
            setLiveState({ isMock: false, ...currentState });
            triggerToast('Showcase completed! Trace report generated.');

        } catch (err) {
            setTerminalLogs(prev => [...prev, { text: `[ERROR] Live execution failed: ${err.message}`, type: 'success-text' }]); // print red
            triggerToast('Live run failed. Please check key or connection.');
            setIsDemoRunning(false);
        } finally {
            setActiveFlowStepIdx(-1);
        }
    };

    const queryNvidiaRoute = async (systemPrompt, userPrompt, key, model) => {
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${key}`
            },
            body: JSON.stringify({
                model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ],
                temperature: 0.2,
                max_tokens: 1024
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            if (response.status === 410) {
                throw new Error(`NVIDIA API Error (410 Gone): This model may be deprecated, or your NVIDIA account lacks 'Public API Endpoints' permission for this tier. Try selecting a different model from the dropdown or verify your NVIDIA NIM account credits.`);
            } else if (response.status === 401) {
                throw new Error(`NVIDIA API Error (401 Unauthorized): Invalid API Key. Please check the NVIDIA_API_KEY in the config panel.`);
            }
            throw new Error(`NVIDIA Gateway error: ${response.status} - ${errText}`);
        }

        const data = await response.json();
        const content = data.choices[0].message.content;

        let cleanContent = content.trim();
        if (cleanContent.startsWith('```json')) {
            cleanContent = cleanContent.substring(7);
        } else if (cleanContent.startsWith('```')) {
            cleanContent = cleanContent.substring(3);
        }
        if (cleanContent.endsWith('```')) {
            cleanContent = cleanContent.substring(0, cleanContent.length - 3);
        }

        return JSON.parse(cleanContent.trim());
    };

    const buildSystemInstructions = (demoKey, stepName) => {
        let prompt = `You are the ${stepName} Agent in HandoffKit. Perform your instructions based on the HandoffState JSON contract and return an updated HandoffState JSON.
JSON keys to return:
- task: Keep original task prompt.
- decisions: Append your findings or technical decisions (array of strings).
- files: Append any file names you create or modify (array of strings).
- next_steps: Specific instructions for the next agent (or empty [] if last agent).
- errors: Append warnings or errors encountered (or empty []).
- quality_score: Set as float (0.0 to 1.0) based on quality.
- metadata: Keep previous, add code_contents if writing files.
Return ONLY valid JSON. Do not include explanation markdown blocks.`;

        if (demoKey === 'coding') {
            if (stepName === 'Architect') {
                prompt += ` Plan the calculator CLI: decide arguments parsing logic. Set next_steps for Coder.`;
            } else if (stepName === 'Coder') {
                prompt += ` Implement the Python calculator scripts. Add files (e.g. ['calculator.py', 'main.py']) and write actual code mappings inside 'metadata.code_contents' like {"main.py": "code content here"}.`;
            } else if (stepName === 'Tester') {
                prompt += ` Verify the coder's files. Set quality_score to 1.0 if correct, empty next_steps.`;
            }
        } else if (demoKey === 'doctor') {
            prompt += ` This is a clinical orchestrator. Log chief complaints, differential diagnosis hypotheses, or laboratory recommendations based on your role.`;
        } else if (demoKey === 'support') {
            prompt += ` This is a customer support escalation. Track ticket severity, SLA constraints, incident evidence, and customer response next steps.`;
        } else if (demoKey === 'research') {
            prompt += ` This is a research workflow. Track source IDs, extracted claims, fact-check status, uncertainty, and final writing notes.`;
        } else if (demoKey === 'fusion') {
            prompt += ` This is a model-fusion workflow. Track candidate answers, disagreements, evidence, judge rationale, and replayable decision metadata.`;
        } else if (demoKey === 'media') {
            prompt += ` This is a media localization workflow. Track transcript segments, translations, speaker or voice notes, timing risks, and publishing next steps.`;
        }
        return prompt;
    };

    const handleRunClick = () => {
        if (nvidiaKey && nvidiaKey.trim() !== '') {
            runLiveSimulation(nvidiaKey.trim());
        } else {
            runMockSimulation();
        }
    };

    return (
        <>
            <div className="grid-overlay"></div>

            {/* Header */}
            <header className="header">
                <div className="container header-container">
                    <a href="#" className="logo" onClick={(e) => { e.preventDefault(); switchActiveScreen('home'); }} style={{ display: 'flex', alignItems: 'center' }}>
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '6px' }}>
                            <circle cx="6" cy="6" r="3" fill="var(--color-accent-light)" />
                            <circle cx="18" cy="18" r="3" fill="var(--color-accent-light)" />
                            <path d="M9 6h5a4 4 0 0 1 4 4v5" strokeDasharray="3 3" />
                            <polygon points="18 15 16 12 20 12" fill="var(--color-accent)" stroke="none" />
                        </svg>
                        <span className="logo-text">Handoff</span>
                        <span className="logo-bold">Kit</span>
                    </a>
                    <nav className="nav">
                        <span className={`nav-link ${activeScreen === 'home' ? 'active' : ''}`} onClick={() => switchActiveScreen('home')}>Home</span>
                        <span className={`nav-link ${activeScreen === 'demos' ? 'active' : ''}`} onClick={() => switchActiveScreen('demos')}>Demos Workspace</span>
                        <span className={`nav-link ${activeScreen === 'visualizer' ? 'active' : ''}`} onClick={() => switchActiveScreen('visualizer')}>Trace Visualizer</span>
                        <span className={`nav-link ${activeScreen === 'docs' ? 'active' : ''}`} onClick={() => switchActiveScreen('docs')}>CLI & Docs</span>
                    </nav>
                    <div className="header-actions">
                        <a href="https://github.com/DaosPath/handoffkit" target="_blank" className="btn-github">
                            <svg height="16" width="16" viewBox="0 0 16 16" fill="currentColor">
                                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
                            </svg>
                            <span>GitHub</span>
                        </a>
                    </div>
                </div>
            </header>

            {/* SCREEN 1: LANDING PAGE */}
            {activeScreen === 'home' && (
                <div id="screen-home" className="screen active">
                    <section className="hero-section">
                        <div className="container hero-container-grid">
                            <div className="hero-content">
                                <span className="badge">VERSION 1.5.0</span>
                                <h1 className="hero-title">
                                    Structured agent handoffs. <span className="gradient-text">No context soup.</span>
                                </h1>
                                <p className="hero-subtitle">
                                    HandoffKit defines explicit task, decision, and file contracts between language agents. Validate, trace, and replay pipeline operations.
                                </p>
                                <div className="hero-buttons">
                                    <span className="btn btn-primary" onClick={() => switchActiveScreen('demos')}>Try Workbench Demos</span>
                                    <span className="btn btn-secondary" onClick={() => switchActiveScreen('docs')}>Read CLI & API Docs</span>
                                </div>
                            </div>

                            <div className="hero-visual">
                                <div className="visual-card">
                                    <div className="visual-card-header">
                                        <div className="window-controls">
                                            <span className="win-dot red"></span>
                                            <span className="win-dot yellow"></span>
                                            <span className="win-dot green"></span>
                                        </div>
                                        <span className="card-title">handoff_state.json</span>
                                    </div>
                                    <div className="visual-card-body">
                                        <div className="flow-layout">
                                            <svg className="flow-connector-svg" viewBox="0 0 40 220" fill="none">
                                                <path d="M12,15 L12,205" stroke="var(--color-border)" strokeWidth="2" strokeLinecap="round" />
                                                <path className="animated-pulse-path" d="M12,15 L12,205" stroke="var(--color-accent)" strokeWidth="2" strokeDasharray="12 40" strokeLinecap="round" />
                                            </svg>

                                            <div className={`flow-step ${activeInspector === 'architect' ? 'active' : ''}`} onClick={() => setActiveInspector('architect')} style={{ cursor: 'pointer' }}>
                                                <div className="step-badge">1</div>
                                                <div className="step-details">
                                                    <h4>Architect Agent</h4>
                                                    <p>Defines code specifications</p>
                                                </div>
                                            </div>

                                            <div className={`flow-step ${activeInspector === 'coder' ? 'active' : ''}`} onClick={() => setActiveInspector('coder')} style={{ cursor: 'pointer' }}>
                                                <div className="step-badge" style={{ background: '#d97706' }}>2</div>
                                                <div className="step-details">
                                                    <h4>Coder Agent</h4>
                                                    <p>Applies code implementations</p>
                                                </div>
                                            </div>

                                            <div className={`flow-step ${activeInspector === 'tester' ? 'active' : ''}`} onClick={() => setActiveInspector('tester')} style={{ cursor: 'pointer' }}>
                                                <div className="step-badge" style={{ background: '#059669' }}>3</div>
                                                <div className="step-details">
                                                    <h4>Tester Agent</h4>
                                                    <p>Executes validation suites</p>
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="simulator-code-viewer">
                                        <div className="viewer-header">
                                            <span className="viewer-title">inspector state: {activeInspector.toUpperCase()}</span>
                                            <button className="btn-copy" id="copy-sim-btn" onClick={() => handleCopy(JSON.stringify(inspectorStates[activeInspector], null, 2), 'JSON state contract copied!')}>
                                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                                                </svg>
                                                <span className="btn-copy-text">Copy</span>
                                            </button>
                                        </div>
                                        <div className="viewer-body">
                                            <pre><code dangerouslySetInnerHTML={{ __html: highlightJSON(inspectorStates[activeInspector]) }}></code></pre>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </section>

                    {/* Bento Features Section */}
                    <section className="features-section">
                        <div className="container">
                            <div className="section-header">
                                <span className="section-badge">CORE CAPABILITIES</span>
                                <h2 className="section-title">Built for Auditability & Reliability</h2>
                                <p className="section-subtitle">A minimal contract system that fits cleanly next to any agent orchestration framework.</p>
                            </div>
                            <div className="features-grid">
                                <div className="feature-card">
                                    <div className="feature-icon">
                                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                                            <polyline points="14 2 14 8 20 8" />
                                            <line x1="16" y1="13" x2="8" y2="13" />
                                            <line x1="16" y1="17" x2="8" y2="17" />
                                            <polyline points="10 9 9 9 8 9" />
                                        </svg>
                                    </div>
                                    <h3>Structured Contracts</h3>
                                    <p>Ensure agents explicitly hand off files, technical choices, warning indicators, and next steps in transparent JSON contracts.</p>
                                    <span className="card-metric">State transfer</span>
                                </div>

                                <div className="feature-card">
                                    <div className="feature-icon">
                                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <circle cx="12" cy="12" r="10" />
                                            <polyline points="12 6 12 12 16 14" />
                                        </svg>
                                    </div>
                                    <h3>Offline Replays</h3>
                                    <p>Store full execution histories in the file trace store and replay runs locally without executing LLMs or shell commands.</p>
                                    <span className="card-metric">ReplayRunner</span>
                                </div>

                                <div className="feature-card">
                                    <div className="feature-icon">
                                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                                            <polyline points="22 4 12 14.01 9 11.01" />
                                        </svg>
                                    </div>
                                    <h3>Quality Verification</h3>
                                    <p>Run automated scoring validations over handoff objects to measure and report pipelines accuracy results.</p>
                                    <span className="card-metric">ValidationReport</span>
                                </div>
                            </div>
                        </div>
                    </section>
                </div>
            )}

            {/* SCREEN 2: INTERACTIVE DEMOS WORKSPACE */}
            {activeScreen === 'demos' && (
                <div id="screen-demos" className="screen active">
                    <div className="container dashboard-container">
                        {/* Sidebar */}
                        <aside className="dashboard-sidebar">
                            <div className="sidebar-header">
                                <h3>Select Showcase</h3>
                            </div>
                            <div className="sidebar-menu">
                                {Object.entries(demoWorkspaces).map(([demoKey, demo]) => (
                                    <button key={demoKey} className={`sidebar-item ${activeDemoKey === demoKey ? 'active' : ''}`} onClick={() => { if (!isDemoRunning) selectDemoWorkspace(demoKey); }}>
                                        <div className={`demo-icon ${demo.themeClass}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                            {renderDemoIcon(demo.icon)}
                                        </div>
                                        <div className="demo-item-details">
                                            <h4>{demo.sidebarTitle}</h4>
                                            <p>{demo.sidebarSubtitle}</p>
                                        </div>
                                    </button>
                                ))}
                            </div>

                            <div className="settings-card">
                                <div className="settings-header" style={{ display: 'flex', alignItems: 'center' }}>
                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '6px' }}>
                                        <circle cx="12" cy="12" r="3" />
                                        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                                    </svg>
                                    <span>NVIDIA NIM Config</span>
                                </div>
                                <div className="settings-body">
                                    <label htmlFor="nvidia-api-key">NVIDIA_API_KEY</label>
                                    <input type="password" id="nvidia-api-key" placeholder="Enter API key..." value={nvidiaKey} onChange={(e) => handleKeyChange(e.target.value)} />

                                    <div style={{ marginTop: '14px', marginBottom: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <label style={{ fontSize: '0.72rem', fontWeight: 800, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>AGENT MODELS</label>
                                    </div>
                                    <div style={{ maxHeight: '250px', overflowY: 'auto', paddingRight: '4px' }} className="agent-models-scroll terminal-body">
                                        {demoWorkspaces[activeDemoKey].steps.map((step, idx) => {
                                            const currentModelId = perAgentModels[step] || 'meta/llama-3.1-8b-instruct';
                                            const isOpen = !!openDropdowns[step];
                                            return (
                                                <div key={idx} style={{ marginBottom: '10px' }}>
                                                    <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--color-text-primary)', marginBottom: '4px' }}>{step} Agent</div>
                                                    <div className="custom-dropdown" onClick={() => setOpenDropdowns(prev => ({ ...prev, [step]: !isOpen }))} style={{ marginTop: 0 }}>
                                                        <div className="dropdown-selected" style={{ padding: '6px 10px' }}>
                                                            <div className="dropdown-selected-left">
                                                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--color-accent)', marginRight: '6px' }}>
                                                                    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line>
                                                                </svg>
                                                                <span style={{ fontWeight: 600, fontSize: '0.75rem' }}>{nvidiaModelsList.find(m => m.id === currentModelId)?.name || currentModelId}</span>
                                                            </div>
                                                            <svg className={`chevron ${isOpen ? 'open' : ''}`} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                                                        </div>
                                                        {isOpen && (
                                                            <div className="dropdown-menu">
                                                                {nvidiaModelsList.map(mod => (
                                                                    <div key={mod.id} className={`dropdown-item ${currentModelId === mod.id ? 'active' : ''}`} onClick={(e) => { e.stopPropagation(); setPerAgentModels(prev => ({ ...prev, [step]: mod.id })); setOpenDropdowns(prev => ({ ...prev, [step]: false })); }}>
                                                                        <div className="item-name">{mod.name}</div>
                                                                        <div className="item-desc">{mod.desc}</div>
                                                                        {currentModelId === mod.id && (
                                                                            <svg className="check-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                                                                <polyline points="20 6 9 17 4 12"></polyline>
                                                                            </svg>
                                                                        )}
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>

                                    <span className="settings-help">Opt-in to run live agent iterations in the browser using NVIDIA NIM. Leaves offline mock enabled if empty.</span>
                                </div>
                            </div>
                        </aside>

                        {/* Main Workbench Area */}
                        <div className="dashboard-workbench">
                            <div className="workbench-header">
                                <div className="workbench-header-left">
                                    <div className="showcase-title-row">
                                        <span className={`badge ${demoWorkspaces[activeDemoKey].badgeClass}`}>{demoWorkspaces[activeDemoKey].badge}</span>
                                        <span className="showcase-mode-pill">offline by default</span>
                                    </div>
                                    <h2>{demoWorkspaces[activeDemoKey].name} showcase</h2>
                                    <p>{demoWorkspaces[activeDemoKey].description}</p>

                                    <div className="showcase-summary-grid">
                                        <div className="showcase-summary-card">
                                            <span>Agents</span>
                                            <strong>{demoWorkspaces[activeDemoKey].steps.length}</strong>
                                        </div>
                                        <div className="showcase-summary-card">
                                            <span>Decisions</span>
                                            <strong>{demoWorkspaces[activeDemoKey].report.decisions.length}</strong>
                                        </div>
                                        <div className="showcase-summary-card">
                                            <span>Artifacts</span>
                                            <strong>{demoWorkspaces[activeDemoKey].report.files.length}</strong>
                                        </div>
                                        <div className="showcase-summary-card">
                                            <span>Output</span>
                                            <strong>report</strong>
                                        </div>
                                    </div>

                                    <div className="showcase-command-preview">
                                        <span className="term-prompt">$</span>
                                        <span>{demoWorkspaces[activeDemoKey].prompt}</span>
                                    </div>

                                    <div className="prompt-input-container">
                                        <label htmlFor="custom-task-prompt" style={{ fontWeight: '700', fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--color-text-secondary)', display: 'block', marginBottom: '6px', letterSpacing: '0.05em' }}>Custom Task Prompt:</label>
                                        <textarea id="custom-task-prompt" placeholder={demoWorkspaces[activeDemoKey].placeholder} value={customPrompt} onChange={(e) => setCustomPrompt(e.target.value)} disabled={isDemoRunning} style={{ minHeight: '80px' }}></textarea>
                                    </div>
                                </div>
                                <div className="workbench-header-right">
                                    <div className="workbench-action-panel">
                                        <div className={`action-panel-icon ${demoWorkspaces[activeDemoKey].themeClass}`}>
                                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
                                                <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
                                                <line x1="6" y1="6" x2="6.01" y2="6" />
                                                <line x1="6" y1="18" x2="6.01" y2="18" />
                                            </svg>
                                        </div>
                                        <span className="action-panel-label">Simulation Gateway</span>

                                        <button className="btn btn-primary btn-run-large" id="btn-run-workspace" onClick={handleRunClick} disabled={isDemoRunning}>
                                            {isDemoRunning ? (
                                                <>
                                                    <div className="spinner-micro"></div>
                                                    <span>Running...</span>
                                                </>
                                            ) : (
                                                <>
                                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                                                        <polygon points="5 3 19 12 5 21 5 3" />
                                                    </svg>
                                                    <span>Run Agent Demo</span>
                                                </>
                                            )}
                                        </button>

                                        <div className="action-panel-stats">
                                            <div>
                                                <strong>{demoWorkspaces[activeDemoKey].report.score.split(' ')[0]}</strong>
                                                <span>quality</span>
                                            </div>
                                            <div>
                                                <strong>{demoWorkspaces[activeDemoKey].steps.length - 1}</strong>
                                                <span>handoffs</span>
                                            </div>
                                        </div>

                                        <div className={`status-row ${isDemoRunning ? 'running' : (liveState ? 'done' : 'idle')}`}>
                                            <span className="status-label">STATUS</span>
                                            <div className="status-val">
                                                <span className="status-dot"></span>
                                                <span>{isDemoRunning ? 'RUNNING' : (liveState ? 'DONE' : 'IDLE')}</span>
                                            </div>
                                        </div>
                                        <p className="action-panel-note">Runs locally unless you provide a NVIDIA key.</p>
                                    </div>
                                </div>
                            </div>

                            {/* Tabs */}
                            <div className="workbench-tabs">
                                <button className={`tab-btn ${workbenchTab === 'flow' ? 'active' : ''}`} onClick={() => setWorkbenchTab('flow')}>
                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="5" r="3"/><line x1="12" y1="8" x2="12" y2="16"/><circle cx="12" cy="19" r="3"/></svg>
                                    <span>Flowchart</span>
                                </button>
                                <button className={`tab-btn ${workbenchTab === 'logs' ? 'active' : ''}`} onClick={() => setWorkbenchTab('logs')}>
                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
                                    <span>Console</span>
                                </button>
                                <button className={`tab-btn ${workbenchTab === 'report' ? 'active' : ''}`} onClick={() => setWorkbenchTab('report')}>
                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                                    <span>Report</span>
                                </button>
                            </div>

                            <div className="workbench-content">
                                {/* Tab 1: Flowchart */}
                                {workbenchTab === 'flow' && (
                                    <div className="tab-pane active" id="pane-flow">
                                        <div className="diagram-canvas flow-canvas">
                                            <div className="flow-canvas-inner">
                                                {/* Pipeline label */}
                                                <div className="flow-section-label">
                                                    <div></div>
                                                    <span>Agent Pipeline Flow</span>
                                                    <div></div>
                                                </div>
                                                {/* Horizontal agent chain */}
                                                <div className="flow-chain">
                                                    {demoWorkspaces[activeDemoKey].steps.map((step, idx) => (
                                                        <div key={idx} style={{ display: 'flex', alignItems: 'center' }}>
                                                            <div className={`flow-step demo-flow-step ${activeFlowStepIdx === idx ? 'active' : ''}`}>
                                                                <div className={`chat-avatar avatar-${step.toLowerCase()}`} style={{ width: '32px', height: '32px', fontSize: '0.7rem', fontWeight: '800', letterSpacing: '0.05em' }}>
                                                                    {getAgentInitials(step)}
                                                                </div>
                                                                <div className="step-details">
                                                                    <h4>{step}</h4>
                                                                    <p style={{ fontSize: '0.68rem', color: 'var(--color-text-muted)', marginTop: '1px' }}>{idx === 0 ? 'Planning' : idx === demoWorkspaces[activeDemoKey].steps.length - 1 ? 'Verification' : 'Execution'}</p>
                                                                </div>
                                                            </div>
                                                            {idx < demoWorkspaces[activeDemoKey].steps.length - 1 && (
                                                                <div className="flow-connector">
                                                                    <div className="flow-connector-line"></div>
                                                                    <div className="flow-connector-dot"></div>
                                                                    <svg width="10" height="10" viewBox="0 0 24 24" fill="var(--color-text-muted)" stroke="none" style={{ flexShrink: 0, marginLeft: '-1px' }}>
                                                                        <polygon points="6 4 20 12 6 20" />
                                                                    </svg>
                                                                </div>
                                                            )}
                                                        </div>
                                                    ))}
                                                </div>
                                                {/* Handoff state label */}
                                                <div className="flow-contract-strip">
                                                    <span className="contract-dot" style={{ background: activeFlowStepIdx >= 0 ? '#10b981' : '#94a3b8' }}></span>
                                                    <span>{activeFlowStepIdx >= 0 ? `Active handoff: Step ${activeFlowStepIdx + 1} of ${demoWorkspaces[activeDemoKey].steps.length}` : 'Awaiting pipeline start'}</span>
                                                    <strong>HandoffState</strong>
                                                    <span>decisions / files / errors / next_steps</span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* Tab 2: Logs */}
                                {workbenchTab === 'logs' && (
                                    <div className="tab-pane active" id="pane-logs">
                                        <div className="logs-split-container">
                                            {/* Left: Terminal */}
                                            <div className="cli-terminal">
                                                <div className="terminal-bar">
                                                    <div className="window-controls">
                                                        <span className="win-dot red"></span>
                                                        <span className="win-dot yellow"></span>
                                                        <span className="win-dot green"></span>
                                                    </div>
                                                    <span className="terminal-bar-title">logs // {demoWorkspaces[activeDemoKey].name}</span>
                                                </div>
                                                <div className="terminal-body" id="logs-terminal-body" style={{ maxHeight: '350px', overflowY: 'auto' }}>
                                                    <div className="terminal-line">
                                                        <span className="term-prompt">$</span>
                                                        <span className="term-cmd">{demoWorkspaces[activeDemoKey].prompt}</span>
                                                    </div>
                                                    {terminalLogs.length === 0 ? (
                                                        <div style={{ padding: '24px 0 16px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
                                                            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#475569" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.4 }}>
                                                                <polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>
                                                            </svg>
                                                            <span style={{ color: '#64748b', fontSize: '0.8rem' }}>Waiting for pipeline execution…</span>
                                                            <span style={{ color: '#475569', fontSize: '0.68rem', fontFamily: 'var(--font-mono)', opacity: 0.6 }}>Press ▶ Run Agent Demo to begin</span>
                                                        </div>
                                                    ) : (
                                                        terminalLogs.map((log, lIdx) => (
                                                            <div key={lIdx} className={`log-line ${log.type}`} style={{ marginBottom: '6px' }}>{log.text}</div>
                                                        ))
                                                    )}
                                                    <div ref={terminalLogsEndRef} />
                                                </div>
                                            </div>

                                            {/* Right: Agent Chat discussion */}
                                            <div className="agent-chat-container">
                                                <div className="chat-header">
                                                    <span className="chat-header-title">Agent Discussion Timeline</span>
                                                    <span className="badge" style={{ margin: 0, padding: '2px 8px', fontSize: '0.65rem' }}>Multi-Model</span>
                                                </div>
                                                <div className="chat-body">
                                                    {chatMessages.length === 0 ? (
                                                        <div style={{ padding: '36px 20px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
                                                            <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--color-border)' }}>
                                                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                                                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                                                                </svg>
                                                            </div>
                                                            <span style={{ color: 'var(--color-text-secondary)', fontSize: '0.82rem', fontWeight: '600' }}>No agent messages yet</span>
                                                            <span style={{ color: 'var(--color-text-muted)', fontSize: '0.72rem', maxWidth: '240px', lineHeight: '1.4' }}>Agent discussions will appear here as each step in the pipeline completes.</span>
                                                        </div>
                                                    ) : (
                                                        chatMessages.map((msg, mIdx) => (
                                                            <div key={mIdx} className="chat-bubble-wrapper">
                                                                <div className={`chat-avatar ${msg.avatarClass}`}>
                                                                    {msg.sender[0]}
                                                                </div>
                                                                <div className={`chat-bubble ${msg.status}`}>
                                                                    <div className="chat-bubble-name">{msg.sender} Agent</div>
                                                                    <div className="chat-bubble-text">{msg.text}</div>
                                                                    {msg.status === 'working' && (
                                                                        <div className="typing-pulse">
                                                                            <span className="typing-dot"></span>
                                                                            <span className="typing-dot"></span>
                                                                            <span className="typing-dot"></span>
                                                                        </div>
                                                                    )}
                                                                    {msg.details && msg.details.length > 0 && (
                                                                        <div className="chat-bubble-details">
                                                                            {msg.details.map((detail, dIdx) => (
                                                                                <div key={dIdx} className="chat-detail-item">{detail}</div>
                                                                            ))}
                                                                        </div>
                                                                    )}
                                                                    <div className="chat-bubble-status">{msg.status}</div>
                                                                </div>
                                                            </div>
                                                        ))
                                                    )}
                                                    <div ref={chatEndRef} />
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* Tab 3: Report Preview */}
                                {workbenchTab === 'report' && (
                                    <div className="tab-pane active" id="pane-report">
                                        <div className="report-browser-mock">
                                            <div className="browser-bar">
                                                <div className="browser-bar-dots">
                                                    <span className="br-dot red"></span>
                                                    <span className="br-dot yellow"></span>
                                                    <span className="br-dot green"></span>
                                                </div>
                                                <div className="browser-address">http://localhost:8000/runs/latest/report.html</div>
                                            </div>
                                            <div className="browser-viewport">
                                                {!liveState ? (
                                                        <div className="mock-report-lock">
                                                            <div className="lock-icon-ring">
                                                                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                                                                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                                                                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                                                                </svg>
                                                            </div>
                                                            <h3 style={{ fontSize: '1rem', marginTop: '16px' }}>Report Not Yet Generated</h3>
                                                            <p style={{ maxWidth: '280px' }}>Execute the agent pipeline from the <strong>Console</strong> tab. The HTML trace report will render here when complete.</p>
                                                            <button className="btn btn-secondary" onClick={() => setWorkbenchTab('logs')} style={{ marginTop: '16px', fontSize: '0.78rem', padding: '8px 16px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
                                                                Go to Console
                                                            </button>
                                                        </div>
                                                ) : (
                                                    <div className="mock-report-grid">
                                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                                                            <div className="report-panel" style={{ borderRadius: '10px', overflow: 'hidden' }}>
                                                                <div className="report-section-title">Decisions & Architectural Logs</div>
                                                                <div className="report-decisions-body" style={{ padding: '10px 0' }}>
                                                                    {liveState.decisions && liveState.decisions.length > 0 ? (
                                                                        liveState.decisions.map((d, dIdx) => (
                                                                            <div key={dIdx} className="report-item" style={{ display: 'flex', gap: '8px', alignItems: 'start', padding: '8px 16px', borderBottom: '1px solid var(--color-bg-body)' }}>
                                                                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="3" style={{ marginTop: '2px', flexShrink: 0 }}>
                                                                                    <polyline points="20 6 9 17 4 12" />
                                                                                </svg>
                                                                                <span style={{ fontSize: '0.88rem', color: '#1e293b', fontWeight: '500' }}>{d}</span>
                                                                            </div>
                                                                        ))
                                                                    ) : <div className="report-item" style={{ padding: '8px 16px', color: 'var(--color-text-muted)', fontSize: '0.82rem' }}>No decisions logged.</div>}
                                                                </div>
                                                            </div>
                                                            <div className="report-panel" style={{ borderRadius: '10px', overflow: 'hidden' }}>
                                                                <div className="report-section-title">Handoff Instructions & Next Steps</div>
                                                                <div className="report-steps-body" style={{ padding: '10px 0' }}>
                                                                    {liveState.next_steps && liveState.next_steps.length > 0 ? (
                                                                        liveState.next_steps.map((s, sIdx) => (
                                                                            <div key={sIdx} className="report-item" style={{ display: 'flex', gap: '8px', alignItems: 'start', padding: '8px 16px', borderBottom: '1px solid var(--color-bg-body)' }}>
                                                                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginTop: '2px', flexShrink: 0 }}>
                                                                                    <line x1="5" y1="12" x2="19" y2="12" />
                                                                                    <polyline points="12 5 19 12 12 19" />
                                                                                </svg>
                                                                                <span style={{ fontSize: '0.88rem', color: '#1e293b', fontWeight: '500', fontFamily: 'var(--font-mono)' }}>{s}</span>
                                                                            </div>
                                                                        ))
                                                                    ) : <div className="report-item" style={{ padding: '8px 16px', color: 'var(--color-text-muted)', fontSize: '0.82rem' }}>None - Pipeline finished successfully.</div>}
                                                                </div>
                                                            </div>
                                                        </div>

                                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                                                            <div className="report-panel" style={{ borderRadius: '10px', overflow: 'hidden' }}>
                                                                <div className="report-section-title">Attached Workspace Files</div>
                                                                <div className="report-files-body" style={{ padding: '12px' }}>
                                                                    {liveState.files && liveState.files.length > 0 ? (
                                                                        liveState.files.map((f, fIdx) => {
                                                                            const hasCode = liveState.metadata && liveState.metadata.code_contents && liveState.metadata.code_contents[f];
                                                                            return (
                                                                                <div key={fIdx} className="report-item" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: 'var(--color-bg-body)', border: '1px solid var(--color-border)', borderRadius: '6px', marginBottom: '8px' }}>
                                                                                    <div style={{ display: 'flex', alignItems: 'center' }}>
                                                                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '8px' }}>
                                                                                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                                                                                            <polyline points="14 2 14 8 20 8" />
                                                                                        </svg>
                                                                                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem', color: 'var(--color-text-primary)' }}>{f}</span>
                                                                                    </div>
                                                                                    {hasCode && (
                                                                                        <button className="btn btn-secondary" onClick={() => { setViewCodeFilename(f); setViewCodeContent(liveState.metadata.code_contents[f]); }} style={{ fontSize: '0.68rem', padding: '4px 8px', margin: 0, height: 'auto', border: '1px solid var(--color-border)' }}>
                                                                                            Inspect File
                                                                                        </button>
                                                                                    )}
                                                                                </div>
                                                                            );
                                                                        })
                                                                    ) : <div className="report-item" style={{ color: 'var(--color-text-muted)', fontSize: '0.82rem' }}>No files created.</div>}
                                                                </div>
                                                            </div>

                                                            <div className="report-panel" style={{ borderRadius: '10px', overflow: 'hidden' }}>
                                                                <div className="report-section-title">Pipeline Quality verification</div>
                                                                <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                                                    {/* Radial Score Gauge */}
                                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px', paddingBottom: '8px', borderBottom: '1px solid var(--color-border)' }}>
                                                                        <div style={{ position: 'relative', width: '56px', height: '56px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                                            <svg width="56" height="56" viewBox="0 0 36 36" style={{ transform: 'rotate(-90deg)' }}>
                                                                                <circle cx="18" cy="18" r="16" fill="none" stroke="#f1f5f9" strokeWidth="3" />
                                                                                <circle cx="18" cy="18" r="16" fill="none"
                                                                                        stroke={liveState.quality_score >= 0.8 ? '#10b981' : '#f59e0b'}
                                                                                        strokeWidth="3"
                                                                                        strokeDasharray={`${((liveState.quality_score !== undefined ? liveState.quality_score : 1.0) * 100).toFixed(0)} 100`}
                                                                                />
                                                                            </svg>
                                                                            <div style={{ position: 'absolute', fontSize: '0.8rem', fontWeight: '800', fontFamily: 'var(--font-mono)', color: 'var(--color-text-primary)' }}>
                                                                                {((liveState.quality_score !== undefined ? liveState.quality_score : 1.0) * 100).toFixed(0)}%
                                                                            </div>
                                                                        </div>
                                                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                                                            <span style={{ fontSize: '0.82rem', fontWeight: '800', color: 'var(--color-text-primary)' }}>
                                                                                Quality Score: {liveState.quality_score !== undefined ? liveState.quality_score.toFixed(2) : "1.00"}
                                                                            </span>
                                                                            <span style={{ fontSize: '0.68rem', color: liveState.quality_score >= 0.8 ? '#059669' : '#d97706', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                                                                VERIFICATION: {liveState.quality_score >= 0.8 ? 'PASSED SUCCESS' : 'COMPLETED'}
                                                                            </span>
                                                                        </div>
                                                                    </div>

                                                                    {/* Other Metadata Rows */}
                                                                    <div className="meta-row" style={{ marginBottom: '4px', fontSize: '0.8rem', display: 'flex', justifyContent: 'space-between' }}>
                                                                        <span className="meta-label" style={{ color: 'var(--color-text-muted)' }}>Execution Environment:</span>
                                                                        <span className="meta-val" style={{ fontFamily: 'var(--font-mono)', color: '#1e293b', fontWeight: '700' }}>{liveState.isMock ? 'Local CLI Mock' : 'NVIDIA NIM Proxy'}</span>
                                                                    </div>
                                                                    <div className="meta-row" style={{ fontSize: '0.8rem', display: 'flex', justifyContent: 'space-between' }}>
                                                                        <span className="meta-label" style={{ color: 'var(--color-text-muted)' }}>Report Build Date:</span>
                                                                        <span className="meta-val" style={{ color: '#1e293b', fontWeight: '700' }}>2026-07-07</span>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                )}

                                                {viewCodeFilename && (
                                                    <div className="report-panel" style={{ marginTop: '10px' }}>
                                                        <div className="report-section-title">Source Code File: {viewCodeFilename}</div>
                                                        <pre style={{ background: '#0f172a', padding: '16px', borderRadius: '6px', overflowX: 'auto', color: '#34d399', fontFamily: 'var(--font-mono)', fontSize: '0.8rem', lineHeight: 1.4 }}>
                                                            <code>{viewCodeContent}</code>
                                                        </pre>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* SCREEN 2.5: TRACE VISUALIZER */}
            {activeScreen === 'visualizer' && (
                <div id="screen-visualizer" className="screen active" style={{ padding: '40px 0', minHeight: 'calc(100vh - 120px)' }}>
                    <div className="container" style={{ maxWidth: '1200px' }}>
                        <div style={{ marginBottom: '32px', textAlign: 'center' }}>
                            <span className="badge">TRACE PIPELINE VISUALIZER</span>
                            <h2 style={{ fontSize: '2.5rem', fontWeight: '800', marginTop: '12px' }}>
                                Interactive <span className="gradient-text">RunTrace</span> Analyzer
                            </h2>
                            <p style={{ color: 'var(--color-text-muted)', marginTop: '8px', maxWidth: '600px', marginInline: 'auto' }}>
                                Upload any generated trace JSON file to grade your handoffs, examine step transitions, and audit tool execution paths.
                            </p>
                        </div>

                        {/* File Upload Zone */}
                        <div style={{
                            background: 'var(--color-bg-card)',
                            border: '2px dashed var(--color-border)',
                            borderRadius: '16px',
                            padding: '40px',
                            textAlign: 'center',
                            marginBottom: '40px',
                            transition: 'all 0.3s ease',
                            cursor: 'pointer'
                        }}
                        onClick={() => document.getElementById('trace-file-input').click()}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => {
                            e.preventDefault();
                            const file = e.dataTransfer.files?.[0];
                            if (file) {
                                const reader = new FileReader();
                                reader.onload = (event) => {
                                    try {
                                        const json = JSON.parse(event.target.result);
                                        setUploadedTrace(json);
                                        const report = evaluateTraceClient(json);
                                        setEvaluationReport(report);
                                        setSelectedStepIdx(0);
                                        triggerToast("Trace loaded and evaluated successfully!");
                                    } catch (err) {
                                        triggerToast("Failed to parse JSON file.");
                                    }
                                };
                                reader.readAsText(file);
                            }
                        }}
                        >
                            <input 
                                id="trace-file-input" 
                                type="file" 
                                accept=".json" 
                                onChange={handleTraceUpload} 
                                style={{ display: 'none' }} 
                            />
                            <div style={{ fontSize: '2.5rem', marginBottom: '12px' }}>📁</div>
                            <h3 style={{ fontSize: '1.25rem', fontWeight: '600', marginBottom: '8px' }}>
                                Drag & drop your trace JSON file here
                            </h3>
                            <p style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>
                                Or click to browse files from your computer (e.g. <code>trace.json</code> or <code>report.json</code>)
                            </p>
                        </div>

                        {uploadedTrace ? (
                            <div style={{ display: 'grid', gridTemplateColumns: '3fr 1.5fr', gap: '32px' }}>
                                {/* Left: Trace & Steps */}
                                <div>
                                    {/* Timeline Header */}
                                    <div className="card" style={{ marginBottom: '32px', padding: '24px' }}>
                                        <h3 style={{ fontSize: '1.15rem', fontWeight: '700', marginBottom: '24px' }}>
                                            Timeline Progress
                                        </h3>
                                        
                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'relative', padding: '0 20px' }}>
                                            <div style={{ position: 'absolute', top: '18px', left: '20px', right: '20px', height: '3px', background: 'var(--color-border)', zIndex: '0' }}></div>
                                            {(uploadedTrace.steps || []).map((step, idx) => (
                                                <div 
                                                    key={idx} 
                                                    onClick={() => setSelectedStepIdx(idx)}
                                                    style={{ 
                                                        zIndex: '1', 
                                                        textAlign: 'center', 
                                                        cursor: 'pointer',
                                                        display: 'flex',
                                                        flexDirection: 'column',
                                                        alignItems: 'center'
                                                    }}
                                                >
                                                    <div style={{
                                                        width: '36px',
                                                        height: '36px',
                                                        borderRadius: '50%',
                                                        background: selectedStepIdx === idx ? 'var(--color-accent)' : 'var(--color-bg-card)',
                                                        border: `3px solid ${selectedStepIdx === idx ? 'var(--color-accent)' : 'var(--color-border)'}`,
                                                        color: selectedStepIdx === idx ? '#fff' : 'var(--color-text-muted)',
                                                        fontWeight: '700',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                        marginBottom: '8px',
                                                        transition: 'all 0.2s'
                                                    }}>
                                                        {idx + 1}
                                                    </div>
                                                    <span style={{ fontSize: '0.8rem', fontWeight: '600', color: selectedStepIdx === idx ? 'var(--color-text)' : 'var(--color-text-muted)' }}>
                                                        {step.agent || step.name || "Agent"}
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Active Step Details */}
                                    {uploadedTrace.steps && uploadedTrace.steps[selectedStepIdx] && (
                                        <div className="card" style={{ padding: '32px' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', borderBottom: '1px solid var(--color-border)', paddingBottom: '16px' }}>
                                                <div>
                                                    <span className="badge" style={{ background: 'rgba(99, 102, 241, 0.1)', color: 'var(--color-accent)' }}>
                                                        STEP {selectedStepIdx + 1}
                                                    </span>
                                                    <h3 style={{ fontSize: '1.5rem', fontWeight: '800', marginTop: '6px' }}>
                                                        {uploadedTrace.steps[selectedStepIdx].agent || uploadedTrace.steps[selectedStepIdx].name}
                                                    </h3>
                                                </div>
                                                <div style={{ textAlign: 'right' }}>
                                                    <span className={`status-badge ${uploadedTrace.steps[selectedStepIdx].success !== false ? 'status-verified' : 'status-failed'}`}>
                                                        {uploadedTrace.steps[selectedStepIdx].success !== false ? 'Success' : 'Failed'}
                                                    </span>
                                                    <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', marginTop: '4px' }}>
                                                        Task: {uploadedTrace.steps[selectedStepIdx].task || "Offline Execution"}
                                                    </p>
                                                </div>
                                            </div>

                                            {/* Output block */}
                                            <div style={{ marginBottom: '24px' }}>
                                                <h4 style={{ fontSize: '1rem', fontWeight: '600', marginBottom: '8px', color: 'var(--color-text)' }}>
                                                    Agent Output
                                                </h4>
                                                <div style={{
                                                    background: 'rgba(0,0,0,0.2)',
                                                    padding: '16px',
                                                    borderRadius: '8px',
                                                    fontFamily: 'monospace',
                                                    fontSize: '0.9rem',
                                                    whiteSpace: 'pre-wrap',
                                                    color: 'var(--color-text-muted)'
                                                }}>
                                                    {uploadedTrace.steps[selectedStepIdx].output || "No output generated."}
                                                </div>
                                            </div>

                                            {/* Associated Handoff State */}
                                            {uploadedTrace.handoffs && uploadedTrace.handoffs[selectedStepIdx] && (
                                                <div style={{ marginTop: '32px', borderTop: '1px solid var(--color-border)', paddingTop: '24px' }}>
                                                    <h4 style={{ fontSize: '1.1rem', fontWeight: '700', marginBottom: '16px', color: 'var(--color-accent)' }}>
                                                        👉 Transferred Handoff Contract
                                                    </h4>
                                                    
                                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
                                                        <div style={{ background: 'rgba(255,255,255,0.02)', padding: '12px', borderRadius: '8px' }}>
                                                            <strong style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>FROM AGENT</strong>
                                                            <p style={{ fontWeight: '600', marginTop: '4px' }}>
                                                                {uploadedTrace.handoffs[selectedStepIdx].fromAgent || uploadedTrace.handoffs[selectedStepIdx].from_agent || "Unknown"}
                                                            </p>
                                                        </div>
                                                        <div style={{ background: 'rgba(255,255,255,0.02)', padding: '12px', borderRadius: '8px' }}>
                                                            <strong style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>TO AGENT</strong>
                                                            <p style={{ fontWeight: '600', marginTop: '4px' }}>
                                                                {uploadedTrace.handoffs[selectedStepIdx].toAgent || uploadedTrace.handoffs[selectedStepIdx].to_agent || "Unknown"}
                                                            </p>
                                                        </div>
                                                    </div>

                                                    <div style={{ marginBottom: '16px' }}>
                                                        <strong style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>SUMMARY</strong>
                                                        <p style={{ marginTop: '4px', fontSize: '0.95rem' }}>
                                                            {uploadedTrace.handoffs[selectedStepIdx].summary || "No summary provided."}
                                                        </p>
                                                    </div>

                                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                                                        <div>
                                                            <strong style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>DECISIONS MADE</strong>
                                                            <ul style={{ paddingLeft: '20px', marginTop: '6px', fontSize: '0.9rem' }}>
                                                                {(uploadedTrace.handoffs[selectedStepIdx].decisions || []).map((d, i) => (
                                                                    <li key={i} style={{ marginBottom: '4px' }}>{d}</li>
                                                                ))}
                                                                {(!uploadedTrace.handoffs[selectedStepIdx].decisions || uploadedTrace.handoffs[selectedStepIdx].decisions.length === 0) && (
                                                                    <span style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>None</span>
                                                                )}
                                                            </ul>
                                                        </div>
                                                        <div>
                                                            <strong style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>NEXT STEPS</strong>
                                                            <ul style={{ paddingLeft: '20px', marginTop: '6px', fontSize: '0.9rem' }}>
                                                                {(uploadedTrace.handoffs[selectedStepIdx].nextSteps || uploadedTrace.handoffs[selectedStepIdx].next_steps || []).map((s, i) => (
                                                                    <li key={i} style={{ marginBottom: '4px' }}>{s}</li>
                                                                ))}
                                                                {(!uploadedTrace.handoffs[selectedStepIdx].nextSteps && !uploadedTrace.handoffs[selectedStepIdx].next_steps) && (
                                                                    <span style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>None</span>
                                                                )}
                                                            </ul>
                                                        </div>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>

                                {/* Right: Offline Evaluation Report */}
                                <div>
                                    {evaluationReport && (
                                        <div className="card" style={{ padding: '24px', textAlign: 'center' }}>
                                            <h3 style={{ fontSize: '1.1rem', fontWeight: '700', marginBottom: '20px' }}>
                                                Evaluation Summary
                                            </h3>
                                            
                                            {/* Circular Progress Ring */}
                                            <div style={{ position: 'relative', width: '120px', height: '120px', margin: '0 auto 20px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                <svg width="120" height="120">
                                                    <circle cx="60" cy="60" r="50" fill="none" stroke="var(--color-border)" strokeWidth="8" />
                                                    <circle 
                                                        cx="60" 
                                                        cy="60" 
                                                        r="50" 
                                                        fill="none" 
                                                        stroke={evaluationReport.score >= 0.75 ? 'var(--color-accent)' : '#ef4444'} 
                                                        strokeWidth="8" 
                                                        strokeDasharray="314"
                                                        strokeDashoffset={314 - (314 * evaluationReport.score)}
                                                        strokeLinecap="round"
                                                        transform="rotate(-90 60 60)"
                                                    />
                                                </svg>
                                                <div style={{ position: 'absolute', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                                                    <span style={{ fontSize: '2rem', fontWeight: '800' }}>
                                                        {evaluationReport.grade}
                                                    </span>
                                                    <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                                                        {(evaluationReport.score * 100).toFixed(0)}% Score
                                                    </span>
                                                </div>
                                            </div>

                                            <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: '16px', marginTop: '16px', textAlign: 'left' }}>
                                                <h4 style={{ fontSize: '0.9rem', fontWeight: '700', marginBottom: '12px' }}>
                                                    Offline Quality Checks
                                                </h4>
                                                
                                                {evaluationReport.checks.map((c, i) => (
                                                    <div key={i} style={{ display: 'flex', alignItems: 'start', gap: '8px', marginBottom: '8px', fontSize: '0.85rem' }}>
                                                        <span style={{ color: c.passed ? '#10b981' : (c.severity === 'warning' ? '#f59e0b' : '#ef4444') }}>
                                                            {c.passed ? '✓' : '✗'}
                                                        </span>
                                                        <div>
                                                            <strong style={{ color: 'var(--color-text)' }}>{c.name}</strong>
                                                            <p style={{ color: 'var(--color-text-muted)' }}>{c.message}</p>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>

                                            <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: '16px', marginTop: '16px', textAlign: 'left' }}>
                                                <h4 style={{ fontSize: '0.9rem', fontWeight: '700', marginBottom: '8px', color: '#f59e0b' }}>
                                                    Actionable Advice
                                                </h4>
                                                <ul style={{ paddingLeft: '16px', fontSize: '0.8rem', color: 'var(--color-text-muted)', margin: '0' }}>
                                                    {evaluationReport.recommendations.map((r, i) => (
                                                        <li key={i} style={{ marginBottom: '6px' }}>{r}</li>
                                                    ))}
                                                </ul>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        ) : (
                            <div style={{
                                textAlign: 'center',
                                padding: '80px 20px',
                                background: 'rgba(255,255,255,0.01)',
                                border: '1px solid var(--color-border)',
                                borderRadius: '16px',
                                color: 'var(--color-text-muted)'
                            }}>
                                <p style={{ fontSize: '1.1rem' }}>No trace loaded yet. Drag & drop or browse a run trace file to start analyzing.</p>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* SCREEN 3: CLI AND DOCS REFERENCE */}
            {activeScreen === 'docs' && (
                <div id="screen-docs" className="screen active">
                    <div className="container docs-container">
                        <aside className="docs-sidebar">
                            <nav className="docs-nav-menu">
                                <a href="#docs-install" className={`docs-nav-item ${activeDocSection === 'docs-install' ? 'active' : ''}`} onClick={() => setActiveDocSection('docs-install')} style={{ display: 'flex', alignItems: 'center' }}>
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '8px' }}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                                    <span>Installation</span>
                                </a>
                                <a href="#docs-cli" className={`docs-nav-item ${activeDocSection === 'docs-cli' ? 'active' : ''}`} onClick={() => setActiveDocSection('docs-cli')} style={{ display: 'flex', alignItems: 'center' }}>
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '8px' }}><polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" /></svg>
                                    <span>CLI Commands</span>
                                </a>
                                <a href="#docs-api" className={`docs-nav-item ${activeDocSection === 'docs-api' ? 'active' : ''}`} onClick={() => setActiveDocSection('docs-api')} style={{ display: 'flex', alignItems: 'center' }}>
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '8px' }}><polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" /></svg>
                                    <span>Core API Surface</span>
                                </a>
                                <a href="#docs-providers" className={`docs-nav-item ${activeDocSection === 'docs-providers' ? 'active' : ''}`} onClick={() => setActiveDocSection('docs-providers')} style={{ display: 'flex', alignItems: 'center' }}>
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '8px' }}><ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" /><path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3" /></svg>
                                    <span>Provider Registry</span>
                                </a>
                                <a href="#docs-tools" className={`docs-nav-item ${activeDocSection === 'docs-tools' ? 'active' : ''}`} onClick={() => setActiveDocSection('docs-tools')} style={{ display: 'flex', alignItems: 'center' }}>
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '8px' }}><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" /></svg>
                                    <span>Tool Creation</span>
                                </a>
                                <a href="#docs-integrations" className={`docs-nav-item ${activeDocSection === 'docs-integrations' ? 'active' : ''}`} onClick={() => setActiveDocSection('docs-integrations')} style={{ display: 'flex', alignItems: 'center' }}>
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '8px' }}><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>
                                    <span>Integrations</span>
                                </a>
                            </nav>
                        </aside>

                        <main className="docs-content">
                            {/* Installation */}
                            <section id="docs-install" className="docs-section">
                                <h2>Installation Guide</h2>
                                <p>HandoffKit is a lightweight Python framework designed to run offline-first. It requires Python 3.10, 3.11, 3.12, 3.13, or 3.14. Install it using standard packaging managers:</p>
                                <div className="code-card">
                                    <div className="code-card-header">
                                        <div className="window-controls">
                                            <span className="win-dot red"></span>
                                            <span className="win-dot yellow"></span>
                                            <span className="win-dot green"></span>
                                        </div>
                                        <span className="code-title">Terminal</span>
                                    </div>
                                    <div className="code-card-body">
                                        <pre style={{ padding: '20px', color: '#e2e8f0' }}><code>pip install handoffkit</code></pre>
                                    </div>
                                </div>
                            </section>

                            {/* CLI Reference */}
                            <section id="docs-cli" className="docs-section">
                                <h2>CLI Commands Reference</h2>
                                <p>Manage sandbox recipes, test provider endpoints offline, and generate HTML galleries.</p>

                                <div className="docs-cmd-detail">
                                    <h4><code>handoffkit showcase &lt;recipe_name&gt;</code></h4>
                                    <p>Discover and execute a built-in sandbox showcase recipe (e.g. <code>coding-review</code>, <code>support-escalation</code>, <code>research-workflow</code>, <code>doctor-orchestrator</code>).</p>
                                </div>

                                <div className="docs-cmd-detail">
                                    <h4><code>handoffkit report &lt;run_directory&gt;</code></h4>
                                    <p>Compile a Past Run directory (containing partial states, JSON structures, and stdout traces) into a self-contained HTML gallery report.</p>
                                </div>

                                <div className="docs-cmd-detail">
                                    <h4><code>handoffkit init &lt;recipe_name&gt;</code></h4>
                                    <p>Scaffold a new editable Python workspace containing a specific showcase template to quickly customize your agent pipeline.</p>
                                </div>

                                <div className="docs-cmd-detail">
                                    <h4><code>handoffkit demo-fusion</code></h4>
                                    <p>Launch the multi-model deliberation panel simulator, generating agreement reports and coverage gap summaries.</p>
                                </div>

                                <div className="docs-cmd-detail">
                                    <h4><code>handoffkit demo-media</code></h4>
                                    <p>Run the offline media localization showcase for transcript, translation, voice-cast, and publishing handoffs.</p>
                                </div>

                                <div className="docs-cmd-detail">
                                    <h4><code>handoffkit benchmark-doctor [--cases N]</code></h4>
                                    <p>Run validation sweeps over cases from the public MedCaseReasoning test split to measure agent quality metrics.</p>
                                </div>

                                <div className="docs-cmd-detail">
                                    <h4><code>handoffkit providers list</code></h4>
                                    <p>List all available model provider gateways registered under the framework.</p>
                                </div>
                            </section>

                            {/* Core API Surface */}
                            <section id="docs-api" className="docs-section">
                                <h2>Core API Surface</h2>
                                <p>HandoffKit organizes multi-agent states under structured contract transfer protocols, eliminating context soups.</p>

                                <div className="code-card">
                                    <div className="code-card-header">
                                        <div className="window-controls">
                                            <span className="win-dot red"></span>
                                            <span className="win-dot yellow"></span>
                                            <span className="win-dot green"></span>
                                        </div>
                                        <span className="code-title">Python // transfer_flow.py</span>
                                    </div>
                                    <div className="code-card-body" style={{ padding: '20px', color: '#e2e8f0', fontFamily: 'var(--font-mono)' }}>
                                        <pre><code>{`from handoffkit import Agent, HandoffProtocol

# Define agents
architect = Agent("Architect", "Outlines code plans")
coder = Agent("Coder", "Applies changes")

# Transfer structured state contract
protocol = HandoffProtocol(mode="hybrid_state")
state = protocol.transfer(
    from_agent=architect,
    to_agent=coder,
    task="Build argparse CLI",
    decisions=["Keep CLI separate"],
    next_steps=["Write CLI logic"]
)

state.validate()
print(state.to_json())`}</code></pre>
                                    </div>
                                </div>
                            </section>

                            {/* Provider Registry */}
                            <section id="docs-providers" className="docs-section">
                                <h2>Provider Registry Reference</h2>
                                <p>Route model queries cleanly using environment variables without adding massive external library dependencies. The registries list:</p>

                                <div className="code-card" style={{ marginBottom: '24px' }}>
                                    <div className="code-card-header">
                                        <div className="window-controls">
                                            <span className="win-dot red"></span>
                                            <span className="win-dot yellow"></span>
                                            <span className="win-dot green"></span>
                                        </div>
                                        <span className="code-title">Supported Gateways Table</span>
                                    </div>
                                    <div className="code-card-body" style={{ padding: '20px', overflowX: 'auto' }}>
                                        <table className="docs-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', textAlign: 'left' }}>
                                            <thead>
                                                <tr style={{ borderBottom: '2px solid var(--color-border)', color: '#ffffff' }}>
                                                    <th style={{ padding: '8px' }}>Provider ID</th>
                                                    <th style={{ padding: '8px' }}>Environment API Key</th>
                                                    <th style={{ padding: '8px' }}>Default Router Model</th>
                                                </tr>
                                            </thead>
                                            <tbody style={{ color: '#94a3b8' }}>
                                                <tr style={{ borderBottom: '1px solid #1e293b' }}>
                                                    <td style={{ padding: '8px', color: '#f8fafc', fontWeight: 'bold' }}>nvidia</td>
                                                    <td style={{ padding: '8px', fontFamily: 'var(--font-mono)' }}>NVIDIA_API_KEY</td>
                                                    <td style={{ padding: '8px', fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}>meta/llama-3.1-8b-instruct</td>
                                                </tr>
                                                <tr style={{ borderBottom: '1px solid #1e293b' }}>
                                                    <td style={{ padding: '8px', color: '#f8fafc', fontWeight: 'bold' }}>openrouter</td>
                                                    <td style={{ padding: '8px', fontFamily: 'var(--font-mono)' }}>OPENROUTER_API_KEY</td>
                                                    <td style={{ padding: '8px', fontFamily: 'var(--font-mono)' }}>openrouter/auto</td>
                                                </tr>
                                                <tr style={{ borderBottom: '1px solid #1e293b' }}>
                                                    <td style={{ padding: '8px', color: '#f8fafc', fontWeight: 'bold' }}>groq</td>
                                                    <td style={{ padding: '8px', fontFamily: 'var(--font-mono)' }}>GROQ_API_KEY</td>
                                                    <td style={{ padding: '8px', fontFamily: 'var(--font-mono)' }}>llama-3.3-70b-versatile</td>
                                                </tr>
                                                <tr style={{ borderBottom: '1px solid #1e293b' }}>
                                                    <td style={{ padding: '8px', color: '#f8fafc', fontWeight: 'bold' }}>grok</td>
                                                    <td style={{ padding: '8px', fontFamily: 'var(--font-mono)' }}>XAI_API_KEY</td>
                                                    <td style={{ padding: '8px', fontFamily: 'var(--font-mono)' }}>grok-4.3</td>
                                                </tr>
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            </section>

                            {/* Tool Specs */}
                            <section id="docs-tools" className="docs-section">
                                <h2>Tool Creation & Specs</h2>
                                <p>HandoffKit facilitates tool specifications, allowing agents to export tool capabilities to LLM schemas.</p>
                                <div className="code-card">
                                    <div className="code-card-header">
                                        <div className="window-controls">
                                            <span className="win-dot red"></span>
                                            <span className="win-dot yellow"></span>
                                            <span className="win-dot green"></span>
                                        </div>
                                        <span className="code-title">Python // custom_tools.py</span>
                                    </div>
                                    <div className="code-card-body" style={{ padding: '20px', color: '#e2e8f0', fontFamily: 'var(--font-mono)' }}>
                                        <pre><code>{`from handoffkit import ToolFactory

factory = ToolFactory()

# Generate a declarative schema tool from a function
tool = factory.from_function(
    name="extract_files_summary",
    description="Summarize code files passed in HandoffState.",
    func=lambda path: f"Compact summary review for {path}"
)

print(tool.to_schema()) # Outputs provider-ready JSON schema`}</code></pre>
                                    </div>
                                </div>
                            </section>

                            {/* Integrations */}
                            <section id="docs-integrations" className="docs-section">
                                <h2>Third-Party Integrations</h2>
                                <p>Integrate structured state contracts cleanly into your favorite framework node logic:</p>

                                <div className="docs-cmd-detail">
                                    <h4>LangGraph Integration</h4>
                                    <p>Graph nodes pass <code>HandoffState</code> structures back and forth instead of unstructured strings, keeping audit logs intact.</p>
                                </div>

                                <div className="docs-cmd-detail">
                                    <h4>Pydantic AI Integration</h4>
                                    <p>Format structured model outputs into predefined HandoffState fields for validation verification loops.</p>
                                </div>

                                <div className="docs-cmd-detail">
                                    <h4>OpenAI Agents SDK</h4>
                                    <p>Track multi-agent transfers, errors, and task checklist variables with offline replay verification.</p>
                                </div>
                            </section>
                        </main>
                    </div>
                </div>
            )}

            {/* Footer */}
            <footer className="footer" style={{ borderTop: '1px solid var(--color-border)', padding: '30px 0', marginTop: '60px', background: '#ffffff', zIndex: 10 }}>
                <div className="container">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '15px' }}>
                        <p style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)' }}>&copy; 2026 DaosPath / HandoffKit. Released under the MIT License.</p>
                        <div style={{ display: 'flex', gap: '20px' }}>
                            <a href="https://github.com/DaosPath/handoffkit" target="_blank" style={{ textDecoration: 'none', color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>GitHub</a>
                            <a href="https://pypi.org/project/handoffkit/" target="_blank" style={{ textDecoration: 'none', color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>PyPI</a>
                        </div>
                    </div>
                </div>
            </footer>

            {/* Toast System */}
            {toastMessage && (
                <div className="toast show" style={{ position: 'fixed', bottom: '20px', right: '20px', background: '#1e293b', color: '#ffffff', padding: '12px 24px', borderRadius: '6px', fontSize: '0.85rem', boxShadow: 'var(--shadow-lg)', zIndex: 1000, display: 'flex', alignItems: 'center', gap: '10px', animation: 'slide-in 0.2s ease' }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#34d399" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                    <span>{toastMessage}</span>
                </div>
            )}
        </>
    );

    // Sidebar selectors state update helper
    function selectDemoWorkspace(demoKey) {
        setActiveDemoKey(demoKey);
        setTerminalLogs([]);
        setLiveState(null);
        setViewCodeFilename('');
        setViewCodeContent('');
        setWorkbenchTab('flow');
    }
}
