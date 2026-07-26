"""Browser explore types and URL policy helpers (snake_case wire)."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any
from urllib.parse import urljoin, urlparse, urlunparse


DEFAULT_UA = "HandoffKit-Browser/1.0 (+https://github.com/DaosPath/handoffkit)"


@dataclass
class ExplorePolicy:
    max_depth: int = 1
    max_pages: int = 8
    timeout_ms: int = 15000
    max_body_bytes: int = 2 * 1024 * 1024
    max_text_chars: int = 50000
    max_links_per_page: int = 100
    same_host_only: bool = True
    follow_redirects: bool = True
    max_redirects: int = 5
    user_agent: str = DEFAULT_UA
    allow_hosts: list[str] = field(default_factory=list)
    deny_hosts: list[str] = field(default_factory=list)
    extra_headers: dict[str, str] = field(default_factory=dict)
    extract_text: bool = True
    extract_links: bool = True
    extract_title: bool = True
    strip_scripts_styles: bool = True
    emit_markdown: bool = True
    max_markdown_chars: int = 60000

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None = None) -> ExplorePolicy:
        data = data or {}
        # accept camelCase aliases lightly
        mapped = dict(data)
        aliases = {
            "maxDepth": "max_depth",
            "maxPages": "max_pages",
            "timeoutMs": "timeout_ms",
            "sameHostOnly": "same_host_only",
            "allowHosts": "allow_hosts",
            "denyHosts": "deny_hosts",
            "userAgent": "user_agent",
            "emitMarkdown": "emit_markdown",
            "maxMarkdownChars": "max_markdown_chars",
        }
        for src, dst in aliases.items():
            if src in mapped and dst not in mapped:
                mapped[dst] = mapped[src]
        known = {f.name for f in cls.__dataclass_fields__.values()}  # type: ignore[attr-defined]
        return cls(**{k: v for k, v in mapped.items() if k in known})


@dataclass
class ExtractedLink:
    href: str = ""
    absolute: str = ""
    text: str = ""

    def to_dict(self) -> dict[str, str]:
        return {"href": self.href, "absolute": self.absolute, "text": self.text}


@dataclass
class ExploreStep:
    step_index: int = 0
    depth: int = 0
    url: str = ""
    final_url: str = ""
    status: int = 0
    success: bool = False
    error: str = ""
    title: str = ""
    text: str = ""
    markdown: str = ""
    links: list[ExtractedLink] = field(default_factory=list)
    raw_body_bytes: int = 0
    blocked_links: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "step_index": self.step_index,
            "depth": self.depth,
            "url": self.url,
            "final_url": self.final_url,
            "status": self.status,
            "success": self.success,
            "error": self.error,
            "title": self.title,
            "text": self.text,
            "markdown": self.markdown,
            "links": [l.to_dict() for l in self.links],
            "raw_body_bytes": self.raw_body_bytes,
            "blocked_links": list(self.blocked_links),
        }


@dataclass
class ExploreResult:
    success: bool = False
    start_url: str = ""
    final_url: str = ""
    pages_fetched: int = 0
    max_depth_reached: int = 0
    title: str = ""
    text: str = ""
    markdown: str = ""
    links: list[ExtractedLink] = field(default_factory=list)
    steps: list[ExploreStep] = field(default_factory=list)
    policy: ExplorePolicy = field(default_factory=ExplorePolicy)
    error: str = ""
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "success": self.success,
            "start_url": self.start_url,
            "final_url": self.final_url,
            "pages_fetched": self.pages_fetched,
            "max_depth_reached": self.max_depth_reached,
            "title": self.title,
            "text": self.text,
            "markdown": self.markdown,
            "links": [l.to_dict() for l in self.links],
            "steps": [s.to_dict() for s in self.steps],
            "policy": self.policy.to_dict(),
            "error": self.error,
            "metadata": dict(self.metadata),
        }


def normalize_host(host: str) -> str:
    h = (host or "").lower().rstrip(".")
    if "@" in h:
        h = h.split("@", 1)[1]
    if ":" in h:
        h = h.split(":", 1)[0]
    return h


def parse_url(url: str) -> dict[str, Any]:
    out: dict[str, Any] = {"scheme": "", "host": "", "path": "", "query": "", "valid": False}
    raw = url or ""
    if not raw:
        return out
    if raw.startswith("/"):
        out["path"] = raw
        out["valid"] = True
        return out
    parsed = urlparse(raw if "://" in raw else f"https://{raw}")
    out["scheme"] = (parsed.scheme or "https").lower()
    out["host"] = normalize_host(parsed.netloc)
    out["path"] = parsed.path or "/"
    out["query"] = parsed.query or ""
    out["valid"] = bool(out["host"]) or out["path"].startswith("/")
    return out


def resolve_url(base: str, href: str) -> str:
    raw = (href or "").strip()
    if not raw or raw.startswith("#") or raw.lower().startswith("javascript:"):
        return ""
    try:
        return urljoin(base or "", raw)
    except Exception:  # noqa: BLE001
        return ""


def host_matches(host: str, pattern: str) -> bool:
    h = normalize_host(host)
    p = normalize_host(pattern)
    if not p or not h:
        return False
    if h == p:
        return True
    return h.endswith(f".{p}")


def host_allowed(host: str, policy: ExplorePolicy) -> bool:
    h = normalize_host(host)
    for deny in policy.deny_hosts:
        if host_matches(h, deny):
            return False
    if not policy.allow_hosts:
        return True
    return any(host_matches(h, allow) for allow in policy.allow_hosts)


def url_allowed(url: str, policy: ExplorePolicy, origin_host: str = "") -> bool:
    parts = parse_url(url)
    if not parts["valid"] or not parts["host"]:
        return False
    if not host_allowed(parts["host"], policy):
        return False
    if policy.same_host_only and origin_host:
        if normalize_host(parts["host"]) != normalize_host(origin_host):
            return False
    return parts["scheme"] in {"http", "https"}


def policy_from_args(args: dict[str, Any] | None = None) -> ExplorePolicy:
    args = args or {}
    if isinstance(args.get("policy"), dict):
        merged = {**args, **args["policy"]}
        return ExplorePolicy.from_dict(merged)
    return ExplorePolicy.from_dict(args)


def canonical_url(url: str) -> str:
    parts = parse_url(url)
    if not parts["valid"]:
        return url or ""
    query = parts["query"]
    if query:
        kept: list[str] = []
        for piece in query.split("&"):
            low = piece.lower()
            if low.startswith(("utm_", "fbclid=", "gclid=")):
                continue
            kept.append(piece)
        query = "&".join(kept)
    path = parts["path"] or "/"
    out = urlunparse((parts["scheme"] or "https", parts["host"], path, "", query, ""))
    if out.endswith("/") and path != "/":
        out = out.rstrip("/")
    return out
