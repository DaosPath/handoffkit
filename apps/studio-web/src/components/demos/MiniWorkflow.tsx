type MiniWorkflowProps = {
  kind: "panel" | "coding" | "rescue" | "support";
};

export function MiniWorkflow({ kind }: MiniWorkflowProps) {
  if (kind === "panel") {
    return (
      <div className="flex flex-col items-center gap-1.5 py-1">
        <div className="flex flex-wrap justify-center gap-1.5">
          {["Expert A", "Expert B", "Expert C"].map((l) => (
            <span key={l} className="workflow-node workflow-node-blue !min-w-0 !px-2 !py-1.5 !text-[0.62rem]">
              {l}
            </span>
          ))}
        </div>
        <div className="workflow-line !h-3" />
        <span className="workflow-node workflow-node-green !min-w-0 !px-2.5 !py-1.5 !text-[0.62rem]">
          Judge / Consensus
        </span>
      </div>
    );
  }

  if (kind === "coding") {
    return (
      <div className="relative flex flex-col items-center gap-1 py-1">
        <div className="flex flex-wrap items-center justify-center gap-1.5">
          <span className="workflow-node workflow-node-blue !min-w-0 !px-2 !py-1.5 !text-[0.62rem]">
            Coder
          </span>
          <span className="text-[0.6rem] text-[var(--blue)]">→</span>
          <span className="workflow-node workflow-node-purple !min-w-0 !px-2 !py-1.5 !text-[0.62rem]">
            Reviewer
          </span>
          <span className="text-[0.6rem] text-[var(--blue)]">→</span>
          <span className="workflow-node workflow-node-green !min-w-0 !px-2 !py-1.5 !text-[0.62rem]">
            Tester
          </span>
        </div>
        <span className="text-[0.6rem] font-semibold text-[#F97316]">↻ Rework</span>
      </div>
    );
  }

  if (kind === "rescue") {
    return (
      <div className="flex flex-wrap items-center justify-center gap-1 py-1">
        {["Failure Triage", "Judge", "Validator", "Report"].map((l, i) => (
          <span key={l} className="inline-flex items-center gap-1">
            <span
              className={`workflow-node !min-w-0 !px-2 !py-1.5 !text-[0.6rem] ${
                i === 3 ? "workflow-node-green" : "workflow-node-purple"
              }`}
            >
              {l}
            </span>
            {i < 3 && <span className="text-[0.6rem] text-[var(--blue)]">→</span>}
          </span>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-1.5 py-1">
      <span className="workflow-node workflow-node-orange !min-w-0 !px-2.5 !py-1.5 !text-[0.62rem]">
        Router
      </span>
      <div className="workflow-line !h-3" />
      <div className="flex flex-wrap justify-center gap-1.5">
        {["Support", "KB", "Escalation"].map((l) => (
          <span
            key={l}
            className="workflow-node workflow-node-blue !min-w-0 !px-2 !py-1.5 !text-[0.6rem]"
          >
            {l} Agent
          </span>
        ))}
      </div>
    </div>
  );
}
