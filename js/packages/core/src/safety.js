export class UnsafeToolCallError extends Error {
  constructor(message) {
    super(message);
    this.name = "UnsafeToolCallError";
  }
}

export class DangerousCommandError extends Error {
  constructor(message) {
    super(message);
    this.name = "DangerousCommandError";
  }
}

export const DANGEROUS_COMMAND_PATTERNS = [
  /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-rf|-fr)\b/i,
  /\bdel\s+\/s\b/i,
  /\bformat\b/i,
  /\bshutdown\b/i,
  /\breboot\b/i,
  /\bmkfs(\.[a-z0-9]+)?\b/i,
  /\bdiskpart\b/i,
];

export const APPROVAL_REQUIRED_TOOLS = new Set(["run_command", "write_file"]);

export function isDangerousCommand(command) {
  if (typeof command !== "string") return false;
  const normalized = command.trim().replace(/\s+/g, " ");
  return DANGEROUS_COMMAND_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function requiresApproval(toolName) {
  return APPROVAL_REQUIRED_TOOLS.has(toolName);
}

// ==========================================
// Memory Systems
// ==========================================

