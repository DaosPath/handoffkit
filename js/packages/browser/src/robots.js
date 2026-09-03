/**
 * robots.txt parser. Heuristic allow/deny only — never a crawl-budget or legal opinion.
 */

export function parseRobotsTxt(text, userAgent = "*") {
  const groups = [];
  let current = { agents: [], allow: [], disallow: [] };
  const flush = () => {
    if (current.agents.length) groups.push(current);
    current = { agents: [], allow: [], disallow: [] };
  };
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx < 1) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (key === "user-agent") {
      if (current.allow.length || current.disallow.length) flush();
      current.agents.push(value.toLowerCase());
    } else if (key === "allow") current.allow.push(value);
    else if (key === "disallow") current.disallow.push(value);
  }
  flush();
  const ua = String(userAgent || "*").toLowerCase();
  const matched = groups.filter((group) =>
    group.agents.some((agent) => agent === "*" || ua.includes(agent) || agent.includes(ua)),
  );
  return matched.length ? matched : groups.filter((group) => group.agents.includes("*"));
}

export function isRobotsAllowed(text, url, userAgent = "*") {
  let path = "/";
  try {
    path = new URL(url).pathname || "/";
  } catch {
    path = String(url || "/");
  }
  const groups = parseRobotsTxt(text, userAgent);
  if (!groups.length) return true;
  let decision = true;
  let best = -1;
  for (const group of groups) {
    for (const rule of group.disallow) {
      if (rule === "") continue;
      if (path.startsWith(rule) && rule.length >= best) {
        decision = false;
        best = rule.length;
      }
    }
    for (const rule of group.allow) {
      if (rule && path.startsWith(rule) && rule.length >= best) {
        decision = true;
        best = rule.length;
      }
    }
  }
  return decision;
}
