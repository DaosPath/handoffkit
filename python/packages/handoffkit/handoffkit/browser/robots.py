"""robots.txt parser. Heuristic allow/deny only — never a crawl-budget or legal opinion."""

from __future__ import annotations

from urllib.parse import urlparse


def parse_robots_txt(text: str, user_agent: str = "*") -> list[dict[str, list[str]]]:
    groups: list[dict[str, list[str]]] = []
    current: dict[str, list[str]] = {"agents": [], "allow": [], "disallow": []}

    def flush() -> None:
        nonlocal current
        if current["agents"]:
            groups.append(current)
        current = {"agents": [], "allow": [], "disallow": []}

    for raw in (text or "").splitlines():
        line = raw.split("#", 1)[0].strip()
        if not line or ":" not in line:
            continue
        key, value = line.split(":", 1)
        key = key.strip().lower()
        value = value.strip()
        if key == "user-agent":
            if current["allow"] or current["disallow"]:
                flush()
            current["agents"].append(value.lower())
        elif key == "allow":
            current["allow"].append(value)
        elif key == "disallow":
            current["disallow"].append(value)
    flush()
    ua = (user_agent or "*").lower()
    matched = [
        group
        for group in groups
        if any(agent == "*" or ua in agent or agent in ua for agent in group["agents"])
    ]
    return matched or [group for group in groups if "*" in group["agents"]]


def is_robots_allowed(text: str, url: str, user_agent: str = "*") -> bool:
    path = urlparse(url).path or "/"
    groups = parse_robots_txt(text, user_agent)
    if not groups:
        return True
    decision = True
    best = -1
    for group in groups:
        for rule in group["disallow"]:
            if rule and path.startswith(rule) and len(rule) >= best:
                decision = False
                best = len(rule)
        for rule in group["allow"]:
            if rule and path.startswith(rule) and len(rule) >= best:
                decision = True
                best = len(rule)
    return decision
