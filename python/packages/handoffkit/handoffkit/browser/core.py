"""I/O-free Browser Core contracts. Canonical wire JSON is snake_case."""

from __future__ import annotations

import re
from typing import Any
from urllib.parse import urlparse

CONTRACT_VERSION = "1.20.0-alpha.1"
CONTRACT_FORMAT = "handoffkit.browser.core"
HANDOFFKIT_BROWSER_CORE_VERSION = CONTRACT_VERSION

ERROR_CODES = (
    "",
    "invalid_request",
    "unauthorized",
    "replay_detected",
    "capability_denied",
    "policy_denied",
    "provider_unavailable",
    "provider_challenge",
    "timeout",
    "cancelled",
    "interrupted",
    "not_found",
    "index_corrupt",
    "index_unavailable",
    "public_bind_rejected",
    "profile_denied",
    "javascript_denied",
    "download_quarantined",
    "engine_crash",
    "engine_unsupported",
    "strict_provider_rejected",
    "user_browser_bridge_required",
    "default_browser_bridge_required",
    "query_required",
    "no_results",
    "robots_denied",
    "rate_limited",
    "unsupported_provider",
    "artifact_write_failed",
    "artifact_integrity_failed",
    "download_too_large",
)
PRODUCTS = ("core", "lite", "real")
SESSION_STATUSES = ("pending", "starting", "ready", "running", "paused", "interrupted", "closed")
CLAIM_STATUSES = ("supported", "derived", "not_found")
RESEARCH_STAGES = (
    "plan",
    "search",
    "select",
    "fetch",
    "extract",
    "ground",
    "recover",
    "complete",
    "failed",
    "cancelled",
)
COMMAND_NAMES = (
    "session.start",
    "session.close",
    "session.status",
    "session.pause",
    "session.resume",
    "session.retry",
    "navigate",
    "back",
    "forward",
    "reload",
    "wait",
    "snapshot.dom",
    "snapshot.ax",
    "locate",
    "click",
    "type",
    "select",
    "press",
    "hover",
    "focus",
    "check",
    "uncheck",
    "dblclick",
    "scroll",
    "upload",
    "markdown",
    "screenshot",
    "pdf",
    "download",
    "cancel",
    "evaluate",
)
EVENT_NAMES = (
    "session.started",
    "session.closed",
    "session.interrupted",
    "session.status",
    "session.paused",
    "session.resumed",
    "session.retry",
    "navigated",
    "wait.done",
    "snapshot",
    "located",
    "action.done",
    "network",
    "console",
    "page.error",
    "markdown",
    "screenshot",
    "pdf",
    "download",
    "cancelled",
    "error",
    "research.progress",
    "capability.updated",
)
PLATFORM_SEARCH_PROVIDERS = (
    "google_browser",
    "project_index",
    "google_http",
    "duckduckgo",
    "wikipedia",
)
PROVIDER_ALIASES = {
    "g": "google_http",
    "google": "google_http",
    "google_html": "google_http",
    "ddg": "duckduckgo",
    "wiki": "wikipedia",
    "user-browser": "user_browser",
    "default-browser": "default_browser",
    "system-browser": "default_browser",
}
_SHA256_RE = re.compile(r"^[a-f0-9]{64}$")
_RFC3339_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$")
_SENSITIVE_RE = re.compile(
    r"(?:cookie|authorization|token|password|secret|api[_-]?key|set-cookie|userinfo)", re.I
)


class BrowserCoreError(ValueError):
    def __init__(
        self, message: str, *, code: str = "invalid_request", details: dict[str, Any] | None = None
    ) -> None:
        super().__init__(message)
        self.code = code
        self.details = dict(details or {})


def _text(value: Any, fallback: str = "") -> str:
    return fallback if value is None else str(value)


def _bool(value: Any, fallback: bool = False) -> bool:
    return fallback if value is None else bool(value)


def _int(value: Any, fallback: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return fallback


def _obj(value: Any) -> dict[str, Any]:
    return dict(value) if isinstance(value, dict) else {}


def _str_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item) for item in value]


def require_error_code(code: Any) -> str:
    value = _text(code)
    if value not in ERROR_CODES:
        raise BrowserCoreError(
            f"Unknown browser error code: {value}",
            code="invalid_request",
            details={"field": "code"},
        )
    return value


def require_one_of(value: Any, allowed: tuple[str, ...] | list[str], field: str) -> str:
    text = _text(value)
    if text not in allowed:
        raise BrowserCoreError(
            f"Invalid {field}: {text}", code="invalid_request", details={"field": field}
        )
    return text


def normalize_provider_name(raw: Any) -> str:
    value = _text(raw).strip().lower()
    if not value:
        return ""
    return PROVIDER_ALIASES.get(value, value)


def is_sha256_hex(value: Any) -> bool:
    return bool(_SHA256_RE.match(_text(value)))


def require_rfc3339(value: Any, field: str) -> str:
    text = _text(value)
    if not text:
        return ""
    if not _RFC3339_RE.match(text):
        raise BrowserCoreError(
            f"{field} must be RFC 3339",
            code="invalid_request",
            details={"field": field, "value": text},
        )
    return text


def _redact_string(value: str) -> str:
    if re.match(r"^bearer\s+", value, re.I) or re.match(r"^set-cookie:", value, re.I):
        return "[redacted]"
    if re.match(r"^https?://[^/]*:[^/@]*@", value, re.I):
        return re.sub(r"//([^/@]+):([^/@]*)@", "//[redacted]:[redacted]@", value)
    if re.search(r"[?&](?:token|password|secret|api[_-]?key|access_token)=", value, re.I):
        return re.sub(
            r"([?&](?:token|password|secret|api[_-]?key|access_token)=)([^&]*)",
            r"\1[redacted]",
            value,
            flags=re.I,
        )
    if len(value) > 8192:
        return value[:256] + "…[truncated]"
    return value


def redact_sensitive(value: Any, depth: int = 0) -> Any:
    if depth > 8 or value is None:
        return value
    if isinstance(value, str):
        return _redact_string(value)
    if isinstance(value, list):
        return [redact_sensitive(item, depth + 1) for item in value]
    if not isinstance(value, dict):
        return value
    out: dict[str, Any] = {}
    for key, item in value.items():
        out[str(key)] = (
            "[redacted]" if _SENSITIVE_RE.search(str(key)) else redact_sensitive(item, depth + 1)
        )
    return out


def _provenance(data: Any) -> dict[str, Any]:
    source = _obj(data)
    return {
        "provider": _text(source.get("provider")),
        "method": _text(source.get("method")),
        "redirects": _int(source.get("redirects"), 0),
        "status": _int(source.get("status"), 0),
    }


class BrowserError:
    def __init__(self, data: dict[str, Any] | None = None) -> None:
        data = _obj(data)
        self.contract_version = _text(data.get("contract_version"), CONTRACT_VERSION)
        self.code = require_error_code(data.get("code"))
        self.message = _text(data.get("message"))
        self.retryable = _bool(data.get("retryable"), False)
        self.details = dict(_obj(data.get("details")))
        self.request_id = _text(data.get("request_id"))
        self.command_id = _text(data.get("command_id"))
        self.session_id = _text(data.get("session_id"))
        self.occurred_at = _text(data.get("occurred_at"))

    def to_wire(self) -> dict[str, Any]:
        return {
            "contract_version": self.contract_version,
            "code": self.code,
            "message": self.message,
            "retryable": self.retryable,
            "details": dict(self.details),
            "request_id": self.request_id,
            "command_id": self.command_id,
            "session_id": self.session_id,
            "occurred_at": self.occurred_at,
        }

    to_dict = to_wire

    @classmethod
    def from_wire(cls, data: dict[str, Any] | None = None) -> BrowserError:
        return cls(data)

    from_dict = from_wire


class BrowserCapabilities:
    def __init__(self, data: dict[str, Any] | None = None) -> None:
        data = _obj(data)
        self.contract_version = _text(data.get("contract_version"), CONTRACT_VERSION)
        self.product = require_one_of(data.get("product") or "core", PRODUCTS, "product")
        self.engine = _text(data.get("engine"))
        self.engine_ready = _bool(data.get("engine_ready"), False)
        self.search_providers = _str_list(data.get("search_providers"))
        self.operations = _str_list(data.get("operations"))
        self.javascript = _bool(data.get("javascript"), False)
        self.screenshots = _bool(data.get("screenshots"), False)
        self.pdf = _bool(data.get("pdf"), False)
        self.downloads = _bool(data.get("downloads"), False)
        self.persistent_profile = _bool(data.get("persistent_profile"), False)
        self.local_index = _bool(data.get("local_index"), False)
        self.probed_at = _text(data.get("probed_at"))
        raw_probe = data.get("probe_results")
        self.probe_results = (
            [dict(item) for item in raw_probe] if isinstance(raw_probe, list) else []
        )
        if self.product != "real":
            self.javascript = False
            self.screenshots = False
            self.pdf = False
            self.downloads = False
            self.persistent_profile = False
            self.engine_ready = False
            self.engine = ""
            self.probed_at = ""
            self.probe_results = []
        if self.product == "core":
            self.local_index = False
        if self.engine_ready and not self.probed_at:
            raise BrowserCoreError(
                "engine_ready requires a completed probe timestamp",
                code="invalid_request",
                details={"field": "probed_at"},
            )

    def to_wire(self) -> dict[str, Any]:
        return {
            "contract_version": self.contract_version,
            "product": self.product,
            "engine": self.engine,
            "engine_ready": self.engine_ready,
            "search_providers": list(self.search_providers),
            "operations": list(self.operations),
            "javascript": self.javascript,
            "screenshots": self.screenshots,
            "pdf": self.pdf,
            "downloads": self.downloads,
            "persistent_profile": self.persistent_profile,
            "local_index": self.local_index,
            "probed_at": self.probed_at,
            "probe_results": [dict(item) for item in self.probe_results],
        }

    to_dict = to_wire

    @classmethod
    def from_wire(cls, data: dict[str, Any] | None = None) -> BrowserCapabilities:
        return cls(data)


class BrowserPolicy:
    def __init__(self, data: dict[str, Any] | None = None) -> None:
        data = _obj(data)
        self.contract_version = _text(data.get("contract_version"), CONTRACT_VERSION)
        network = _obj(data.get("network"))
        self.network = {
            "allow_loopback": _bool(network.get("allow_loopback"), False),
            "allow_private": _bool(network.get("allow_private"), False),
            "allow_public": _bool(network.get("allow_public"), True),
            "allow_hosts": _str_list(network.get("allow_hosts")),
            "deny_hosts": _str_list(network.get("deny_hosts")),
            "max_redirects": _int(network.get("max_redirects"), 5),
            "max_body_bytes": _int(network.get("max_body_bytes"), 2 * 1024 * 1024),
            "max_decompress_bytes": _int(network.get("max_decompress_bytes"), 8 * 1024 * 1024),
            "timeout_ms": _int(network.get("timeout_ms"), 15000),
            "respect_robots": _bool(network.get("respect_robots"), True),
        }
        filesystem = _obj(data.get("filesystem"))
        self.filesystem = {
            "allow_read": _bool(filesystem.get("allow_read"), False),
            "allow_write": _bool(filesystem.get("allow_write"), False),
            "download_dir": _text(filesystem.get("download_dir")),
            "quarantine_downloads": _bool(filesystem.get("quarantine_downloads"), True),
            "max_download_bytes": _int(filesystem.get("max_download_bytes"), 50 * 1024 * 1024),
        }
        javascript = _obj(data.get("javascript"))
        self.javascript = {"allow_evaluate": _bool(javascript.get("allow_evaluate"), False)}
        credentials = _obj(data.get("credentials"))
        self.credentials = {
            "share_cookies": _bool(credentials.get("share_cookies"), False),
            "persistent_profile": _bool(credentials.get("persistent_profile"), False),
            "profile_dir": _text(credentials.get("profile_dir")),
            "reuse_user_profile": _bool(credentials.get("reuse_user_profile"), False),
        }
        if self.credentials["reuse_user_profile"] or self.credentials["share_cookies"]:
            field = (
                "credentials.reuse_user_profile"
                if self.credentials["reuse_user_profile"]
                else "credentials.share_cookies"
            )
            raise BrowserCoreError(
                "Sharing cookies or reusing the operator browser profile is forbidden",
                code="profile_denied",
                details={"field": field},
            )
        index = _obj(data.get("index"))
        self.index = {
            "enabled": _bool(index.get("enabled"), False),
            "max_documents": _int(index.get("max_documents"), 10000),
            "max_bytes": _int(index.get("max_bytes"), 256 * 1024 * 1024),
            "retention_days": _int(index.get("retention_days"), 30),
            "max_hosts": _int(index.get("max_hosts"), 256),
        }
        bind = _obj(data.get("bind"))
        self.bind = {
            "allow_public_bind": _bool(bind.get("allow_public_bind"), False),
            "require_tls": _bool(bind.get("require_tls"), True),
            "require_mtls": _bool(bind.get("require_mtls"), True),
        }

    def to_wire(self) -> dict[str, Any]:
        return {
            "contract_version": self.contract_version,
            "network": {
                **self.network,
                "allow_hosts": list(self.network["allow_hosts"]),
                "deny_hosts": list(self.network["deny_hosts"]),
            },
            "filesystem": dict(self.filesystem),
            "javascript": dict(self.javascript),
            "credentials": dict(self.credentials),
            "index": dict(self.index),
            "bind": dict(self.bind),
        }

    to_dict = to_wire

    @classmethod
    def from_wire(cls, data: dict[str, Any] | None = None) -> BrowserPolicy:
        return cls(data)

    def reject_public_bind(self, host: str) -> bool:
        value = _text(host).strip().lower()
        loopback = value in {"127.0.0.1", "localhost", "::1"}
        if not loopback and not self.bind["allow_public_bind"]:
            raise BrowserCoreError(
                f"Public bind rejected for {host}",
                code="public_bind_rejected",
                details={"host": value},
            )
        if (
            not loopback
            and self.bind["allow_public_bind"]
            and (not self.bind["require_tls"] or not self.bind["require_mtls"])
        ):
            raise BrowserCoreError(
                "Public bind requires TLS 1.3 and mTLS",
                code="public_bind_rejected",
                details={"host": value},
            )
        return True

    def assert_network_url(self, url: str) -> bool:
        target = classify_network_target(url)
        if target["kind"] == "invalid":
            raise BrowserCoreError(
                "URL is invalid",
                code="invalid_request",
                details={"url": _text(url)},
            )
        if target["kind"] == "filesystem":
            self.assert_filesystem("read")
            return True
        if target["kind"] == "local":
            return True
        host = target["host"]
        if _host_listed(host, self.network["deny_hosts"]):
            raise BrowserCoreError(
                f"Host denied: {host}",
                code="policy_denied",
                details={"host": host, "class": target["kind"]},
            )
        allow = self.network["allow_hosts"]
        if allow and not _host_listed(host, allow):
            raise BrowserCoreError(
                f"Host not allowlisted: {host}",
                code="policy_denied",
                details={"host": host, "class": target["kind"]},
            )
        if target["kind"] == "loopback" and not self.network["allow_loopback"]:
            raise BrowserCoreError(
                "Loopback navigation is denied",
                code="policy_denied",
                details={"host": host, "class": "loopback"},
            )
        if target["kind"] == "private" and not self.network["allow_private"]:
            raise BrowserCoreError(
                "Private-network navigation is denied",
                code="policy_denied",
                details={"host": host, "class": "private"},
            )
        if target["kind"] == "public" and not self.network["allow_public"]:
            raise BrowserCoreError(
                "Public-network navigation is denied",
                code="policy_denied",
                details={"host": host, "class": "public"},
            )
        return True

    def assert_filesystem(self, operation: str) -> bool:
        op = _text(operation)
        if op == "download":
            if self.filesystem["quarantine_downloads"]:
                return True
            if not self.filesystem["allow_write"]:
                raise BrowserCoreError(
                    "Downloads require write permission when quarantine is disabled",
                    code="policy_denied",
                    details={"operation": op, "class": "filesystem"},
                )
            return True
        if op == "read" and not self.filesystem["allow_read"]:
            raise BrowserCoreError(
                "Filesystem read is denied",
                code="policy_denied",
                details={"operation": op, "class": "filesystem"},
            )
        if op == "write" and not self.filesystem["allow_write"]:
            raise BrowserCoreError(
                "Filesystem write is denied",
                code="policy_denied",
                details={"operation": op, "class": "filesystem"},
            )
        if op not in {"read", "write", "download"}:
            raise BrowserCoreError(
                "Unknown filesystem operation",
                code="invalid_request",
                details={"operation": op},
            )
        return True

    def restrict_with(self, peer_policy: Any = None) -> BrowserPolicy:
        peer = (
            peer_policy
            if isinstance(peer_policy, BrowserPolicy)
            else BrowserPolicy.from_wire(_obj(peer_policy))
        )
        local = self.to_wire()
        remote = peer.to_wire()
        local["network"]["allow_loopback"] = (
            local["network"]["allow_loopback"] and remote["network"]["allow_loopback"]
        )
        local["network"]["allow_private"] = (
            local["network"]["allow_private"] and remote["network"]["allow_private"]
        )
        local["network"]["allow_public"] = (
            local["network"]["allow_public"] and remote["network"]["allow_public"]
        )
        local["network"]["max_redirects"] = min(
            local["network"]["max_redirects"], remote["network"]["max_redirects"]
        )
        local["network"]["timeout_ms"] = min(
            local["network"]["timeout_ms"], remote["network"]["timeout_ms"]
        )
        local["network"]["deny_hosts"] = list(
            dict.fromkeys([*local["network"]["deny_hosts"], *remote["network"]["deny_hosts"]])
        )
        if local["network"]["allow_hosts"] and remote["network"]["allow_hosts"]:
            local["network"]["allow_hosts"] = [
                host
                for host in local["network"]["allow_hosts"]
                if host in remote["network"]["allow_hosts"]
            ]
        elif not local["network"]["allow_hosts"] and remote["network"]["allow_hosts"]:
            local["network"]["allow_hosts"] = list(remote["network"]["allow_hosts"])
        local["javascript"]["allow_evaluate"] = (
            local["javascript"]["allow_evaluate"] and remote["javascript"]["allow_evaluate"]
        )
        local["filesystem"]["allow_read"] = (
            local["filesystem"]["allow_read"] and remote["filesystem"]["allow_read"]
        )
        local["filesystem"]["allow_write"] = (
            local["filesystem"]["allow_write"] and remote["filesystem"]["allow_write"]
        )
        local["filesystem"]["max_download_bytes"] = min(
            local["filesystem"]["max_download_bytes"], remote["filesystem"]["max_download_bytes"]
        )
        return BrowserPolicy.from_wire(local)


def classify_network_target(url: str) -> dict[str, str]:
    raw = _text(url).strip()
    if not raw:
        return {"kind": "invalid", "scheme": "", "host": ""}
    parsed = urlparse(raw)
    scheme = (parsed.scheme or "").lower()
    if scheme == "file":
        return {"kind": "filesystem", "scheme": scheme, "host": ""}
    if scheme in {"data", "about", "blob"}:
        return {"kind": "local", "scheme": scheme, "host": ""}
    if scheme not in {"http", "https"}:
        return {"kind": "invalid", "scheme": scheme, "host": ""}
    host = (parsed.hostname or "").lower().strip("[]")
    return {"kind": _classify_host_kind(host), "scheme": scheme, "host": host}


def _classify_host_kind(host: str) -> str:
    if not host:
        return "invalid"
    if host in {"localhost", "::1", "0.0.0.0", "::"}:
        return "loopback"
    if host.startswith("127."):
        return "loopback"
    parts = host.split(".")
    if len(parts) == 4 and all(p.isdigit() and int(p) <= 255 for p in parts):
        a, b = int(parts[0]), int(parts[1])
        if a == 10:
            return "private"
        if a == 192 and b == 168:
            return "private"
        if a == 172 and 16 <= b <= 31:
            return "private"
        if a == 169 and b == 254:
            return "private"
        if a == 100 and 64 <= b <= 127:
            return "private"
        if a >= 224:
            return "private"
        if a == 0:
            return "loopback"
        return "public"
    if ":" in host:
        mapped = host.replace("::ffff:", "", 1)
        if mapped.startswith("ffff:"):
            mapped = mapped[5:]
        if mapped.startswith(":ffff:"):
            mapped = mapped[6:]
        if re.fullmatch(r"\d{1,3}(?:\.\d{1,3}){3}", mapped) and mapped != host:
            return _classify_host_kind(mapped)
        hex_mapped = re.fullmatch(
            r"(?:::ffff:|:ffff:|ffff:)([0-9a-f]{1,4}):([0-9a-f]{1,4})",
            host,
            flags=re.IGNORECASE,
        )
        if hex_mapped:
            hi = int(hex_mapped.group(1), 16)
            lo = int(hex_mapped.group(2), 16)
            return _classify_host_kind(f"{(hi >> 8) & 255}.{hi & 255}.{(lo >> 8) & 255}.{lo & 255}")
        if host in {":", "::", "0:0:0:0:0:0:0:0"} or host.startswith("::ffff:0."):
            return "loopback"
        if host.startswith(("fc", "fd", "fe80:", "ff")):
            return "private"
        return "public"
    return "public"


def _host_listed(host: str, patterns: list[str]) -> bool:
    value = _text(host).lower()
    for pattern in patterns:
        needle = _text(pattern).lower().removeprefix("*.")
        if not needle:
            continue
        if value == needle or value.endswith("." + needle):
            return True
    return False


class BrowserSessionRequest:
    def __init__(self, data: dict[str, Any] | None = None) -> None:
        data = _obj(data)
        self.contract_version = _text(data.get("contract_version"), CONTRACT_VERSION)
        self.request_id = _text(data.get("request_id"))
        self.session_id = _text(data.get("session_id"))
        self.product = require_one_of(data.get("product") or "lite", PRODUCTS, "product")
        self.headless = _bool(data.get("headless"), True)
        self.persistent_profile = _bool(data.get("persistent_profile"), False)
        self.profile_dir = _text(data.get("profile_dir"))
        self.profile_id = _text(data.get("profile_id"))
        self.issued_at = require_rfc3339(data.get("issued_at"), "issued_at")
        self.deadline_at = require_rfc3339(data.get("deadline_at"), "deadline_at")
        policy = data.get("policy")
        self.policy = (
            policy if isinstance(policy, BrowserPolicy) else BrowserPolicy.from_wire(_obj(policy))
        )
        if self.persistent_profile and not self.profile_dir and not self.profile_id:
            raise BrowserCoreError(
                "Persistent profiles require an explicit isolated profile_dir",
                code="profile_denied",
                details={"field": "profile_dir"},
            )

    def to_wire(self) -> dict[str, Any]:
        payload = {
            "contract_version": self.contract_version,
            "request_id": self.request_id,
            "session_id": self.session_id,
            "product": self.product,
            "headless": self.headless,
            "persistent_profile": self.persistent_profile,
            "profile_dir": self.profile_dir,
            "issued_at": self.issued_at,
            "deadline_at": self.deadline_at,
            "policy": self.policy.to_wire(),
        }
        if self.profile_id:
            payload["profile_id"] = self.profile_id
        return payload

    to_dict = to_wire

    @classmethod
    def from_wire(cls, data: dict[str, Any] | None = None) -> BrowserSessionRequest:
        return cls(data)


class BrowserSessionState:
    def __init__(self, data: dict[str, Any] | None = None) -> None:
        data = _obj(data)
        self.contract_version = _text(data.get("contract_version"), CONTRACT_VERSION)
        self.session_id = _text(data.get("session_id"))
        self.request_id = _text(data.get("request_id"))
        self.status = require_one_of(data.get("status") or "pending", SESSION_STATUSES, "status")
        self.product = require_one_of(data.get("product") or "lite", PRODUCTS, "product")
        self.engine = _text(data.get("engine"))
        self.headless = _bool(data.get("headless"), True)
        self.persistent_profile = _bool(data.get("persistent_profile"), False)
        self.created_at = _text(data.get("created_at"))
        self.updated_at = _text(data.get("updated_at"))
        self.current_url = _text(data.get("current_url"))
        self.profile_id = _text(data.get("profile_id"))
        self.page_id = _text(data.get("page_id"))
        error = data.get("error")
        self.error = (
            error if isinstance(error, BrowserError) else BrowserError.from_wire(_obj(error))
        )

    def to_wire(self) -> dict[str, Any]:
        payload = {
            "contract_version": self.contract_version,
            "session_id": self.session_id,
            "request_id": self.request_id,
            "status": self.status,
            "product": self.product,
            "engine": self.engine,
            "headless": self.headless,
            "persistent_profile": self.persistent_profile,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "current_url": self.current_url,
            "error": self.error.to_wire(),
        }
        if self.profile_id:
            payload["profile_id"] = self.profile_id
        if self.page_id:
            payload["page_id"] = self.page_id
        return payload

    to_dict = to_wire

    @classmethod
    def from_wire(cls, data: dict[str, Any] | None = None) -> BrowserSessionState:
        return cls(data)


class BrowserCommand:
    def __init__(self, data: dict[str, Any] | None = None) -> None:
        data = _obj(data)
        self.contract_version = _text(data.get("contract_version"), CONTRACT_VERSION)
        self.command_id = _text(data.get("command_id"))
        self.request_id = _text(data.get("request_id"))
        self.session_id = _text(data.get("session_id"))
        self.name = require_one_of(data.get("name"), COMMAND_NAMES, "name")
        self.issued_at = require_rfc3339(data.get("issued_at"), "issued_at")
        self.deadline_at = require_rfc3339(data.get("deadline_at"), "deadline_at")
        self.idempotency_key = _text(data.get("idempotency_key"))
        self.profile_id = _text(data.get("profile_id"))
        self.page_id = _text(data.get("page_id"))
        self.payload = dict(_obj(data.get("payload")))
        frame_name = _text(self.payload.get("frame_name"))
        frame_url = _text(self.payload.get("frame_url"))
        if frame_name and frame_url:
            raise BrowserCoreError(
                "frame_name and frame_url are mutually exclusive",
                code="invalid_request",
                details={"field": "payload.frame_name"},
            )
        if self.name == "cancel":
            target = _text(
                self.payload.get("target_command_id") or self.payload.get("targetCommandId")
            )
            if target:
                self.payload["target_command_id"] = target
        if not self.command_id:
            raise BrowserCoreError(
                "command_id is required", code="invalid_request", details={"field": "command_id"}
            )

    def to_wire(self) -> dict[str, Any]:
        payload = {
            "contract_version": self.contract_version,
            "command_id": self.command_id,
            "request_id": self.request_id,
            "session_id": self.session_id,
            "name": self.name,
            "issued_at": self.issued_at,
            "deadline_at": self.deadline_at,
            "idempotency_key": self.idempotency_key,
            "payload": dict(self.payload),
        }
        if self.profile_id:
            payload["profile_id"] = self.profile_id
        if self.page_id:
            payload["page_id"] = self.page_id
        return payload

    to_dict = to_wire

    @classmethod
    def from_wire(cls, data: dict[str, Any] | None = None) -> BrowserCommand:
        return cls(data)


class BrowserEvent:
    def __init__(self, data: dict[str, Any] | None = None) -> None:
        data = _obj(data)
        self.contract_version = _text(data.get("contract_version"), CONTRACT_VERSION)
        self.event_id = _text(data.get("event_id"))
        self.command_id = _text(data.get("command_id"))
        self.request_id = _text(data.get("request_id"))
        self.session_id = _text(data.get("session_id"))
        self.name = require_one_of(data.get("name"), EVENT_NAMES, "name")
        self.occurred_at = require_rfc3339(data.get("occurred_at"), "occurred_at")
        self.profile_id = _text(data.get("profile_id"))
        self.page_id = _text(data.get("page_id"))
        self.payload = dict(_obj(data.get("payload")))
        if not self.event_id:
            raise BrowserCoreError(
                "event_id is required", code="invalid_request", details={"field": "event_id"}
            )

    def to_wire(self) -> dict[str, Any]:
        payload = {
            "contract_version": self.contract_version,
            "event_id": self.event_id,
            "command_id": self.command_id,
            "request_id": self.request_id,
            "session_id": self.session_id,
            "name": self.name,
            "occurred_at": self.occurred_at,
            "payload": dict(self.payload),
        }
        if self.profile_id:
            payload["profile_id"] = self.profile_id
        if self.page_id:
            payload["page_id"] = self.page_id
        return payload

    to_dict = to_wire

    @classmethod
    def from_wire(cls, data: dict[str, Any] | None = None) -> BrowserEvent:
        return cls(data)


class SearchHit:
    def __init__(self, data: dict[str, Any] | None = None) -> None:
        data = _obj(data)
        self.title = _text(data.get("title"))
        self.url = _text(data.get("url"))
        self.snippet = _text(data.get("snippet"))
        self.score = _int(data.get("score"), 0)
        self.provider = _text(data.get("provider"))

    def to_wire(self) -> dict[str, Any]:
        return {
            "title": self.title,
            "url": self.url,
            "snippet": self.snippet,
            "score": self.score,
            "provider": self.provider,
        }

    to_dict = to_wire

    @classmethod
    def from_wire(cls, data: dict[str, Any] | None = None) -> SearchHit:
        return cls(data)


class ProviderTrace:
    def __init__(self, data: dict[str, Any] | None = None) -> None:
        data = _obj(data)
        self.provider = _text(data.get("provider"))
        self.attempted = _bool(data.get("attempted"), False)
        self.used = _bool(data.get("used"), False)
        self.result_count = _int(data.get("result_count"), 0)
        raw_code = data.get("error_code")
        self.error_code = require_error_code(raw_code) if raw_code else ""
        self.fallback_reason = _text(data.get("fallback_reason"))
        self.started_at = _text(data.get("started_at"))
        self.finished_at = _text(data.get("finished_at"))
        if not self.used and self.attempted and not self.fallback_reason and not self.error_code:
            self.fallback_reason = "unspecified_fallback"

    def to_wire(self) -> dict[str, Any]:
        return {
            "provider": self.provider,
            "attempted": self.attempted,
            "used": self.used,
            "result_count": self.result_count,
            "error_code": self.error_code,
            "fallback_reason": self.fallback_reason,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
        }

    to_dict = to_wire

    @classmethod
    def from_wire(cls, data: dict[str, Any] | None = None) -> ProviderTrace:
        return cls(data)


class SearchRequest:
    def __init__(self, data: dict[str, Any] | None = None) -> None:
        data = _obj(data)
        self.contract_version = _text(data.get("contract_version"), CONTRACT_VERSION)
        self.request_id = _text(data.get("request_id"))
        self.session_id = _text(data.get("session_id"))
        self.query = _text(data.get("query"))
        self.max_results = _int(data.get("max_results"), 8)
        self.timeout_ms = _int(data.get("timeout_ms"), 20000)
        self.strict_provider = _bool(data.get("strict_provider"), False)
        providers = data.get("providers", list(PLATFORM_SEARCH_PROVIDERS))
        self.providers = [
            name
            for name in (normalize_provider_name(item) for item in _str_list(providers))
            if name
        ]
        self.allow_hosts = _str_list(data.get("allow_hosts"))
        self.deny_hosts = _str_list(data.get("deny_hosts"))
        self.issued_at = _text(data.get("issued_at"))

    def to_wire(self) -> dict[str, Any]:
        return {
            "contract_version": self.contract_version,
            "request_id": self.request_id,
            "session_id": self.session_id,
            "query": self.query,
            "max_results": self.max_results,
            "timeout_ms": self.timeout_ms,
            "strict_provider": self.strict_provider,
            "providers": list(self.providers),
            "allow_hosts": list(self.allow_hosts),
            "deny_hosts": list(self.deny_hosts),
            "issued_at": self.issued_at,
        }

    to_dict = to_wire

    @classmethod
    def from_wire(cls, data: dict[str, Any] | None = None) -> SearchRequest:
        return cls(data)


class SearchResult:
    def __init__(self, data: dict[str, Any] | None = None) -> None:
        data = _obj(data)
        self.contract_version = _text(data.get("contract_version"), CONTRACT_VERSION)
        self.request_id = _text(data.get("request_id"))
        self.success = _bool(data.get("success"), False)
        self.query = _text(data.get("query"))
        self.keywords = _text(data.get("keywords"))
        self.results = [
            item if isinstance(item, SearchHit) else SearchHit.from_wire(_obj(item))
            for item in (data.get("results") or [])
        ]
        self.count = _int(data.get("count"), len(self.results))
        self.strict_provider = _bool(data.get("strict_provider"), False)
        self.providers_requested = _str_list(data.get("providers_requested"))
        self.providers_used = _str_list(data.get("providers_used"))
        self.provider_trace = [
            item if isinstance(item, ProviderTrace) else ProviderTrace.from_wire(_obj(item))
            for item in (data.get("provider_trace") or [])
        ]
        self.errors = _str_list(data.get("errors"))
        raw_code = data.get("error_code")
        self.error_code = require_error_code(raw_code) if raw_code else ""
        self.error = _text(data.get("error"))
        self._assert_no_silent_fallback()

    def _assert_no_silent_fallback(self) -> None:
        if not self.strict_provider:
            return
        fallback = any(item.fallback_reason for item in self.provider_trace)
        used = [
            name
            for name in self.providers_used
            if name and (not self.providers_requested or name != self.providers_requested[0])
        ]
        if fallback or used:
            raise BrowserCoreError(
                "strict_provider forbids fallback",
                code="strict_provider_rejected",
                details={"providers_used": list(self.providers_used)},
            )

    def to_wire(self) -> dict[str, Any]:
        return {
            "contract_version": self.contract_version,
            "request_id": self.request_id,
            "success": self.success,
            "query": self.query,
            "keywords": self.keywords,
            "results": [item.to_wire() for item in self.results],
            "count": self.count,
            "strict_provider": self.strict_provider,
            "providers_requested": list(self.providers_requested),
            "providers_used": list(self.providers_used),
            "provider_trace": [item.to_wire() for item in self.provider_trace],
            "errors": list(self.errors),
            "error_code": self.error_code,
            "error": self.error,
        }

    to_dict = to_wire

    @classmethod
    def from_wire(cls, data: dict[str, Any] | None = None) -> SearchResult:
        return cls(data)


class PageSnapshot:
    def __init__(self, data: dict[str, Any] | None = None) -> None:
        data = _obj(data)
        self.contract_version = _text(data.get("contract_version"), CONTRACT_VERSION)
        self.snapshot_id = _text(data.get("snapshot_id"))
        self.request_id = _text(data.get("request_id"))
        self.session_id = _text(data.get("session_id"))
        self.url = _text(data.get("url"))
        self.final_url = _text(data.get("final_url"))
        self.fetched_at = _text(data.get("fetched_at"))
        self.sha256 = _text(data.get("sha256")).lower()
        self.content_type = _text(data.get("content_type"))
        self.title = _text(data.get("title"))
        self.markdown = _text(data.get("markdown"))
        self.provenance = _provenance(data.get("provenance"))
        self.applied_limits = dict(_obj(data.get("applied_limits")))
        if self.sha256 and not is_sha256_hex(self.sha256):
            raise BrowserCoreError(
                "sha256 must be a 64-character hex digest",
                code="invalid_request",
                details={"field": "sha256"},
            )

    def to_wire(self) -> dict[str, Any]:
        return {
            "contract_version": self.contract_version,
            "snapshot_id": self.snapshot_id,
            "request_id": self.request_id,
            "session_id": self.session_id,
            "url": self.url,
            "final_url": self.final_url,
            "fetched_at": self.fetched_at,
            "sha256": self.sha256,
            "content_type": self.content_type,
            "title": self.title,
            "markdown": self.markdown,
            "provenance": dict(self.provenance),
            "applied_limits": dict(self.applied_limits),
        }

    to_dict = to_wire

    @classmethod
    def from_wire(cls, data: dict[str, Any] | None = None) -> PageSnapshot:
        return cls(data)


class DocumentRecord:
    def __init__(self, data: dict[str, Any] | None = None) -> None:
        data = _obj(data)
        self.contract_version = _text(data.get("contract_version"), CONTRACT_VERSION)
        self.document_id = _text(data.get("document_id"))
        self.sha256 = _text(data.get("sha256")).lower()
        self.url = _text(data.get("url"))
        self.final_url = _text(data.get("final_url"))
        self.title = _text(data.get("title"))
        self.host = _text(data.get("host"))
        self.fetched_at = _text(data.get("fetched_at"))
        self.indexed_at = _text(data.get("indexed_at"))
        self.bytes = _int(data.get("bytes"), 0)
        self.content_type = _text(data.get("content_type"))
        self.provenance = _provenance(data.get("provenance"))
        if self.sha256 and not is_sha256_hex(self.sha256):
            raise BrowserCoreError(
                "sha256 must be a 64-character hex digest",
                code="invalid_request",
                details={"field": "sha256"},
            )

    def to_wire(self) -> dict[str, Any]:
        return {
            "contract_version": self.contract_version,
            "document_id": self.document_id,
            "sha256": self.sha256,
            "url": self.url,
            "final_url": self.final_url,
            "title": self.title,
            "host": self.host,
            "fetched_at": self.fetched_at,
            "indexed_at": self.indexed_at,
            "bytes": self.bytes,
            "content_type": self.content_type,
            "provenance": dict(self.provenance),
        }

    to_dict = to_wire

    @classmethod
    def from_wire(cls, data: dict[str, Any] | None = None) -> DocumentRecord:
        return cls(data)


class ResearchClaim:
    def __init__(self, data: dict[str, Any] | None = None) -> None:
        data = _obj(data)
        self.claim_id = _text(data.get("claim_id"))
        self.statement = _text(data.get("statement"))
        self.status = require_one_of(data.get("status") or "not_found", CLAIM_STATUSES, "status")
        self.quote = _text(data.get("quote"))
        self.source_snapshot_id = _text(data.get("source_snapshot_id"))
        self.source_url = _text(data.get("source_url"))
        self.derived_from = _str_list(data.get("derived_from"))
        if self.status == "supported" and (not self.quote or not self.source_url):
            raise BrowserCoreError(
                "supported claims require a verbatim quote and source URL",
                code="invalid_request",
                details={"claim_id": self.claim_id},
            )
        if self.status == "derived" and len(self.derived_from) < 2:
            raise BrowserCoreError(
                "derived claims require two or more compatible claim ids",
                code="invalid_request",
                details={"claim_id": self.claim_id},
            )

    def to_wire(self) -> dict[str, Any]:
        return {
            "claim_id": self.claim_id,
            "statement": self.statement,
            "status": self.status,
            "quote": self.quote,
            "source_snapshot_id": self.source_snapshot_id,
            "source_url": self.source_url,
            "derived_from": list(self.derived_from),
        }

    to_dict = to_wire

    @classmethod
    def from_wire(cls, data: dict[str, Any] | None = None) -> ResearchClaim:
        return cls(data)


class ResearchJob:
    def __init__(self, data: dict[str, Any] | None = None) -> None:
        data = _obj(data)
        self.contract_version = _text(data.get("contract_version"), CONTRACT_VERSION)
        self.job_id = _text(data.get("job_id"))
        self.request_id = _text(data.get("request_id"))
        self.session_id = _text(data.get("session_id"))
        self.query = _text(data.get("query"))
        self.status = _text(data.get("status"), "running")
        self.pack_version = _int(data.get("pack_version"), 2)
        self.strict_provider = _bool(data.get("strict_provider"), False)
        self.created_at = _text(data.get("created_at"))
        self.updated_at = _text(data.get("updated_at"))
        self.checkpoint_id = _text(data.get("checkpoint_id"))
        self.idempotency_key = _text(data.get("idempotency_key"))

    def to_wire(self) -> dict[str, Any]:
        return {
            "contract_version": self.contract_version,
            "job_id": self.job_id,
            "request_id": self.request_id,
            "session_id": self.session_id,
            "query": self.query,
            "status": self.status,
            "pack_version": self.pack_version,
            "strict_provider": self.strict_provider,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "checkpoint_id": self.checkpoint_id,
            "idempotency_key": self.idempotency_key,
        }

    to_dict = to_wire

    @classmethod
    def from_wire(cls, data: dict[str, Any] | None = None) -> ResearchJob:
        return cls(data)


class ResearchProgress:
    def __init__(self, data: dict[str, Any] | None = None) -> None:
        data = _obj(data)
        self.contract_version = _text(data.get("contract_version"), CONTRACT_VERSION)
        self.job_id = _text(data.get("job_id"))
        self.request_id = _text(data.get("request_id"))
        self.stage = require_one_of(data.get("stage") or "plan", RESEARCH_STAGES, "stage")
        self.message = _text(data.get("message"))
        self.pages_fetched = _int(data.get("pages_fetched"), 0)
        self.pages_target = _int(data.get("pages_target"), 0)
        self.occurred_at = _text(data.get("occurred_at"))

    def to_wire(self) -> dict[str, Any]:
        return {
            "contract_version": self.contract_version,
            "job_id": self.job_id,
            "request_id": self.request_id,
            "stage": self.stage,
            "message": self.message,
            "pages_fetched": self.pages_fetched,
            "pages_target": self.pages_target,
            "occurred_at": self.occurred_at,
        }

    to_dict = to_wire

    @classmethod
    def from_wire(cls, data: dict[str, Any] | None = None) -> ResearchProgress:
        return cls(data)


class ResearchResult:
    def __init__(self, data: dict[str, Any] | None = None) -> None:
        data = _obj(data)
        self.contract_version = _text(data.get("contract_version"), CONTRACT_VERSION)
        self.job_id = _text(data.get("job_id"))
        self.request_id = _text(data.get("request_id"))
        self.pack_version = _int(data.get("pack_version"), 2)
        self.success = _bool(data.get("success"), False)
        self.query = _text(data.get("query"))
        self.queries = _str_list(data.get("queries"))
        self.candidates = [
            item if isinstance(item, SearchHit) else SearchHit.from_wire(_obj(item))
            for item in (data.get("candidates") or [])
        ]
        self.selected_urls = _str_list(data.get("selected_urls"))
        self.snapshots = [
            item if isinstance(item, PageSnapshot) else PageSnapshot.from_wire(_obj(item))
            for item in (data.get("snapshots") or [])
        ]
        self.claims = [
            item if isinstance(item, ResearchClaim) else ResearchClaim.from_wire(_obj(item))
            for item in (data.get("claims") or [])
        ]
        raw_contradictions = data.get("contradictions") or []
        self.contradictions = [dict(item) for item in raw_contradictions if isinstance(item, dict)]
        self.citations = [
            {"title": _text(item.get("title")), "url": _text(item.get("url"))}
            for item in (data.get("citations") or [])
            if isinstance(item, dict)
        ]
        error = data.get("error")
        self.error = (
            error if isinstance(error, BrowserError) else BrowserError.from_wire(_obj(error))
        )
        snapshot_urls = {
            item.final_url or item.url for item in self.snapshots if item.final_url or item.url
        }
        selected = set(self.selected_urls)
        for citation in self.citations:
            if not citation["url"]:
                raise BrowserCoreError("citations cannot be empty", code="invalid_request")
            if citation["url"] not in snapshot_urls and citation["url"] not in selected:
                raise BrowserCoreError(
                    "citation URL was not fetched or selected",
                    code="invalid_request",
                    details={"url": citation["url"]},
                )

    def to_wire(self) -> dict[str, Any]:
        return {
            "contract_version": self.contract_version,
            "job_id": self.job_id,
            "request_id": self.request_id,
            "pack_version": self.pack_version,
            "success": self.success,
            "query": self.query,
            "queries": list(self.queries),
            "candidates": [item.to_wire() for item in self.candidates],
            "selected_urls": list(self.selected_urls),
            "snapshots": [item.to_wire() for item in self.snapshots],
            "claims": [item.to_wire() for item in self.claims],
            "contradictions": [dict(item) for item in self.contradictions],
            "citations": [dict(item) for item in self.citations],
            "error": self.error.to_wire(),
        }

    to_dict = to_wire

    @classmethod
    def from_wire(cls, data: dict[str, Any] | None = None) -> ResearchResult:
        return cls(data)


CORE_MODELS = {
    "BrowserError": BrowserError,
    "BrowserCapabilities": BrowserCapabilities,
    "BrowserPolicy": BrowserPolicy,
    "BrowserSessionRequest": BrowserSessionRequest,
    "BrowserSessionState": BrowserSessionState,
    "BrowserCommand": BrowserCommand,
    "BrowserEvent": BrowserEvent,
    "SearchRequest": SearchRequest,
    "SearchResult": SearchResult,
    "SearchHit": SearchHit,
    "ResearchJob": ResearchJob,
    "ResearchProgress": ResearchProgress,
    "ResearchResult": ResearchResult,
    "ResearchClaim": ResearchClaim,
    "PageSnapshot": PageSnapshot,
    "DocumentRecord": DocumentRecord,
    "ProviderTrace": ProviderTrace,
}


def parse_core_model(name: str, data: dict[str, Any] | None = None) -> Any:
    model = CORE_MODELS.get(name)
    if model is None:
        raise BrowserCoreError(f"Unknown core model: {name}", code="invalid_request")
    return model.from_wire(data)
