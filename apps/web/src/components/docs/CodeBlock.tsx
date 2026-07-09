"use client";

import { useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";

type CodeBlockProps = {
  code: string;
  filename?: string;
  language?: string;
};

export function CodeBlock({ code, filename, language = "python" }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const lines = code.replace(/\n$/, "").split("\n");

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="code-block my-5 w-full min-w-0">
      <div className="flex items-center gap-2 border-b border-white/5 px-3 py-2.5 sm:px-4">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-[#ff5f56]" />
        <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-[#ffbd2e]" />
        <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-[#27c93f]" />
        <span className="ml-2 truncate font-mono text-[0.7rem] text-slate-500">
          {filename || language}
        </span>
        <button
          type="button"
          onClick={onCopy}
          className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-[0.7rem] font-medium text-slate-300 transition hover:bg-white/10 hover:text-white"
          aria-label="Copy code"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre>
        <code className="block w-full min-w-0">
          {lines.map((line, i) => (
            <div key={i} className="code-line">
              <span className="code-ln">{i + 1}</span>
              <span>{highlightLine(line, language)}</span>
            </div>
          ))}
        </code>
      </pre>
    </div>
  );
}

function highlightLine(line: string, language: string) {
  if (!line) return "\u00A0";

  if (language === "bash" || language === "shell") {
    if (line.startsWith("#")) {
      return <span className="tok-cm">{line}</span>;
    }
    return line;
  }

  // Lightweight token highlighter for Python / JS samples
  const parts: ReactNode[] = [];
  const re =
    /(#.*$|\/\/.*$|"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b(?:from|import|class|def|return|async|await|const|let|var|new|function|export|true|false|None|null|True|False)\b|\b(?:Agent|Team|HandoffState|HandoffProtocol|RunTrace|ReplayRunner|Tool|Recipe|RecipeRunner|Orchestrator|State|step)\b)/g;

  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(line)) !== null) {
    if (m.index > last) {
      parts.push(<span key={key++}>{line.slice(last, m.index)}</span>);
    }
    const tok = m[0];
    let cls = "";
    if (tok.startsWith("#") || tok.startsWith("//")) cls = "tok-cm";
    else if (tok.startsWith('"') || tok.startsWith("'") || tok.startsWith('"""') || tok.startsWith("'''"))
      cls = "tok-str";
    else if (
      /^(from|import|class|def|return|async|await|const|let|var|new|function|export|true|false|None|null|True|False)$/.test(
        tok
      )
    )
      cls = "tok-kw";
    else cls = "tok-cls";
    parts.push(
      <span key={key++} className={cls}>
        {tok}
      </span>
    );
    last = m.index + tok.length;
  }
  if (last < line.length) parts.push(<span key={key++}>{line.slice(last)}</span>);
  return parts.length ? parts : line;
}
