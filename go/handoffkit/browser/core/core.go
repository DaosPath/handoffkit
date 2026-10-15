package core

import (
	"encoding/json"
	"net"
	"net/url"
	"strconv"
	"strings"
)

const (
	ContractVersion = "1.20.0-alpha.1"
	ContractFormat  = "handoffkit.browser.core"
)

type CoreError struct {
	Code    string
	Message string
}

func (e *CoreError) Error() string { return e.Code + ": " + e.Message }

func fail(code, message string) error {
	return &CoreError{Code: code, Message: message}
}

func asMap(value any) map[string]any {
	if m, ok := value.(map[string]any); ok {
		return m
	}
	return map[string]any{}
}

func text(m map[string]any, key, fallback string) string {
	if value, ok := m[key]; ok {
		if s, ok := value.(string); ok {
			return s
		}
	}
	return fallback
}

func asBool(m map[string]any, key string, fallback bool) bool {
	if value, ok := m[key]; ok {
		if b, ok := value.(bool); ok {
			return b
		}
	}
	return fallback
}

func asInt(m map[string]any, key string, fallback int) int {
	if value, ok := m[key]; ok {
		switch n := value.(type) {
		case float64:
			return int(n)
		case json.Number:
			i, _ := n.Int64()
			return int(i)
		case int:
			return n
		}
	}
	return fallback
}

func asArray(m map[string]any, key string) []any {
	if value, ok := m[key]; ok {
		if arr, ok := value.([]any); ok {
			return arr
		}
	}
	return []any{}
}

func asObj(m map[string]any, key string) map[string]any {
	if value, ok := m[key]; ok {
		return asMap(value)
	}
	return map[string]any{}
}

func requireCode(code string) error {
	allowed := map[string]bool{
		"": true, "invalid_request": true, "unauthorized": true, "replay_detected": true,
		"capability_denied": true, "policy_denied": true, "provider_unavailable": true,
		"provider_challenge": true, "timeout": true, "cancelled": true, "interrupted": true,
		"not_found": true, "index_corrupt": true, "index_unavailable": true, "public_bind_rejected": true,
		"profile_denied": true, "javascript_denied": true, "download_quarantined": true,
		"engine_crash": true, "engine_unsupported": true, "strict_provider_rejected": true,
		"user_browser_bridge_required": true, "default_browser_bridge_required": true,
		"query_required": true, "no_results": true, "robots_denied": true, "rate_limited": true,
		"unsupported_provider": true, "artifact_write_failed": true, "artifact_integrity_failed": true,
		"download_too_large": true,
	}
	if !allowed[code] {
		return fail("invalid_request", "Unknown browser error code: "+code)
	}
	return nil
}

func requireOne(value string, allowed []string, field string) error {
	for _, item := range allowed {
		if item == value {
			return nil
		}
	}
	return fail("invalid_request", "Invalid "+field+": "+value)
}

func requireRFC3339(value, field string) error {
	if value == "" {
		return nil
	}
	if len(value) < 20 || value[4] != '-' || value[7] != '-' || value[10] != 'T' {
		return fail("invalid_request", field+" must be RFC 3339")
	}
	return nil
}

func sha256OK(value string) bool {
	if len(value) != 64 {
		return false
	}
	for _, c := range value {
		if (c < '0' || c > '9') && (c < 'a' || c > 'f') {
			return false
		}
	}
	return true
}

func provenance(value any) map[string]any {
	source := asMap(value)
	return map[string]any{
		"provider":  text(source, "provider", ""),
		"method":    text(source, "method", ""),
		"redirects": asInt(source, "redirects", 0),
		"status":    asInt(source, "status", 0),
	}
}

func parseError(input any) (map[string]any, error) {
	data := asMap(input)
	code := text(data, "code", "")
	if err := requireCode(code); err != nil {
		return nil, err
	}
	details := asObj(data, "details")
	return map[string]any{
		"contract_version": text(data, "contract_version", ContractVersion),
		"code":             code,
		"message":          text(data, "message", ""),
		"retryable":        asBool(data, "retryable", false),
		"details":          details,
		"request_id":       text(data, "request_id", ""),
		"command_id":       text(data, "command_id", ""),
		"session_id":       text(data, "session_id", ""),
		"occurred_at":      text(data, "occurred_at", ""),
	}, nil
}

func parsePolicy(input any) (map[string]any, error) {
	data := asMap(input)
	credentials := asObj(data, "credentials")
	if asBool(credentials, "reuse_user_profile", false) || asBool(credentials, "share_cookies", false) {
		return nil, fail("profile_denied", "Sharing cookies or reusing the operator browser profile is forbidden")
	}
	network := asObj(data, "network")
	filesystem := asObj(data, "filesystem")
	javascript := asObj(data, "javascript")
	index := asObj(data, "index")
	bind := asObj(data, "bind")
	allowHosts := asArray(network, "allow_hosts")
	denyHosts := asArray(network, "deny_hosts")
	return map[string]any{
		"contract_version": text(data, "contract_version", ContractVersion),
		"network": map[string]any{
			"allow_loopback":       asBool(network, "allow_loopback", false),
			"allow_private":        asBool(network, "allow_private", false),
			"allow_public":         asBool(network, "allow_public", true),
			"allow_hosts":          allowHosts,
			"deny_hosts":           denyHosts,
			"max_redirects":        asInt(network, "max_redirects", 5),
			"max_body_bytes":       asInt(network, "max_body_bytes", 2*1024*1024),
			"max_decompress_bytes": asInt(network, "max_decompress_bytes", 8*1024*1024),
			"timeout_ms":           asInt(network, "timeout_ms", 15000),
			"respect_robots":       asBool(network, "respect_robots", true),
		},
		"filesystem": map[string]any{
			"allow_read":           asBool(filesystem, "allow_read", false),
			"allow_write":          asBool(filesystem, "allow_write", false),
			"download_dir":         text(filesystem, "download_dir", ""),
			"quarantine_downloads": asBool(filesystem, "quarantine_downloads", true),
			"max_download_bytes":   asInt(filesystem, "max_download_bytes", 50*1024*1024),
		},
		"javascript": map[string]any{"allow_evaluate": asBool(javascript, "allow_evaluate", false)},
		"credentials": map[string]any{
			"share_cookies":      asBool(credentials, "share_cookies", false),
			"persistent_profile": asBool(credentials, "persistent_profile", false),
			"profile_dir":        text(credentials, "profile_dir", ""),
			"reuse_user_profile": false,
		},
		"index": map[string]any{
			"enabled":        asBool(index, "enabled", false),
			"max_documents":  asInt(index, "max_documents", 10000),
			"max_bytes":      asInt(index, "max_bytes", 256*1024*1024),
			"retention_days": asInt(index, "retention_days", 30),
			"max_hosts":      asInt(index, "max_hosts", 256),
		},
		"bind": map[string]any{
			"allow_public_bind": asBool(bind, "allow_public_bind", false),
			"require_tls":       asBool(bind, "require_tls", true),
			"require_mtls":      asBool(bind, "require_mtls", true),
		},
	}, nil
}

func parseHit(input any) map[string]any {
	data := asMap(input)
	return map[string]any{
		"title":    text(data, "title", ""),
		"url":      text(data, "url", ""),
		"snippet":  text(data, "snippet", ""),
		"score":    asInt(data, "score", 0),
		"provider": text(data, "provider", ""),
	}
}

func parseTrace(input any) (map[string]any, error) {
	data := asMap(input)
	errorCode := text(data, "error_code", "")
	if errorCode != "" {
		if err := requireCode(errorCode); err != nil {
			return nil, err
		}
	}
	used := asBool(data, "used", false)
	attempted := asBool(data, "attempted", false)
	fallback := text(data, "fallback_reason", "")
	if !used && attempted && fallback == "" && errorCode == "" {
		fallback = "unspecified_fallback"
	}
	return map[string]any{
		"provider":        text(data, "provider", ""),
		"attempted":       attempted,
		"used":            used,
		"result_count":    asInt(data, "result_count", 0),
		"error_code":      errorCode,
		"fallback_reason": fallback,
		"started_at":      text(data, "started_at", ""),
		"finished_at":     text(data, "finished_at", ""),
	}, nil
}

func parseSnapshot(input any) (map[string]any, error) {
	data := asMap(input)
	digest := strings.ToLower(text(data, "sha256", ""))
	if digest != "" && !sha256OK(digest) {
		return nil, fail("invalid_request", "sha256 must be a 64-character hex digest")
	}
	return map[string]any{
		"contract_version": text(data, "contract_version", ContractVersion),
		"snapshot_id":      text(data, "snapshot_id", ""),
		"request_id":       text(data, "request_id", ""),
		"session_id":       text(data, "session_id", ""),
		"url":              text(data, "url", ""),
		"final_url":        text(data, "final_url", ""),
		"fetched_at":       text(data, "fetched_at", ""),
		"sha256":           digest,
		"content_type":     text(data, "content_type", ""),
		"title":            text(data, "title", ""),
		"markdown":         text(data, "markdown", ""),
		"provenance":       provenance(data["provenance"]),
		"applied_limits":   asObj(data, "applied_limits"),
	}, nil
}

func parseClaim(input any) (map[string]any, error) {
	data := asMap(input)
	status := text(data, "status", "not_found")
	if err := requireOne(status, []string{"supported", "derived", "not_found"}, "status"); err != nil {
		return nil, err
	}
	quote := text(data, "quote", "")
	sourceURL := text(data, "source_url", "")
	derived := asArray(data, "derived_from")
	if status == "supported" && (quote == "" || sourceURL == "") {
		return nil, fail("invalid_request", "supported claims require a verbatim quote and source URL")
	}
	if status == "derived" && len(derived) < 2 {
		return nil, fail("invalid_request", "derived claims require two or more compatible claim ids")
	}
	return map[string]any{
		"claim_id":           text(data, "claim_id", ""),
		"statement":          text(data, "statement", ""),
		"status":             status,
		"quote":              quote,
		"source_snapshot_id": text(data, "source_snapshot_id", ""),
		"source_url":         sourceURL,
		"derived_from":       derived,
	}, nil
}

func ParseCoreModel(name string, input any) (map[string]any, error) {
	data := asMap(input)
	switch name {
	case "BrowserError":
		return parseError(input)
	case "BrowserPolicy":
		return parsePolicy(input)
	case "ProviderTrace":
		return parseTrace(input)
	case "SearchHit":
		return parseHit(input), nil
	case "PageSnapshot":
		return parseSnapshot(input)
	case "ResearchClaim":
		return parseClaim(input)
	case "BrowserCapabilities":
		product := text(data, "product", "core")
		if err := requireOne(product, []string{"core", "lite", "real"}, "product"); err != nil {
			return nil, err
		}
		out := map[string]any{
			"contract_version":   text(data, "contract_version", ContractVersion),
			"product":            product,
			"engine":             text(data, "engine", ""),
			"engine_ready":       asBool(data, "engine_ready", false),
			"search_providers":   asArray(data, "search_providers"),
			"operations":         asArray(data, "operations"),
			"javascript":         asBool(data, "javascript", false),
			"screenshots":        asBool(data, "screenshots", false),
			"pdf":                asBool(data, "pdf", false),
			"downloads":          asBool(data, "downloads", false),
			"persistent_profile": asBool(data, "persistent_profile", false),
			"local_index":        asBool(data, "local_index", false),
			"probed_at":          text(data, "probed_at", ""),
			"probe_results":      asArray(data, "probe_results"),
		}
		if product != "real" {
			out["javascript"] = false
			out["screenshots"] = false
			out["pdf"] = false
			out["downloads"] = false
			out["persistent_profile"] = false
			out["engine_ready"] = false
			out["engine"] = ""
			out["probed_at"] = ""
			out["probe_results"] = []any{}
		}
		if product == "core" {
			out["local_index"] = false
		}
		if out["engine_ready"] == true && out["probed_at"] == "" {
			return nil, fail("invalid_request", "engine_ready requires a completed probe timestamp")
		}
		return out, nil
	case "SearchRequest":
		providers := asArray(data, "providers")
		if _, ok := data["providers"]; !ok {
			providers = []any{"google_browser", "project_index", "google_http", "duckduckgo", "wikipedia", "searxng"}
		}
		return map[string]any{
			"contract_version": text(data, "contract_version", ContractVersion),
			"request_id":       text(data, "request_id", ""),
			"session_id":       text(data, "session_id", ""),
			"query":            text(data, "query", ""),
			"max_results":      asInt(data, "max_results", 8),
			"timeout_ms":       asInt(data, "timeout_ms", 20000),
			"strict_provider":  asBool(data, "strict_provider", false),
			"providers":        providers,
			"allow_hosts":      asArray(data, "allow_hosts"),
			"deny_hosts":       asArray(data, "deny_hosts"),
			"issued_at":        text(data, "issued_at", ""),
		}, nil
	case "SearchResult":
		results := []any{}
		for _, item := range asArray(data, "results") {
			results = append(results, parseHit(item))
		}
		traces := []any{}
		for _, item := range asArray(data, "provider_trace") {
			parsed, err := parseTrace(item)
			if err != nil {
				return nil, err
			}
			traces = append(traces, parsed)
		}
		errorCode := text(data, "error_code", "")
		if errorCode != "" {
			if err := requireCode(errorCode); err != nil {
				return nil, err
			}
		}
		strict := asBool(data, "strict_provider", false)
		if strict {
			fallback := false
			for _, item := range traces {
				if text(asMap(item), "fallback_reason", "") != "" {
					fallback = true
				}
			}
			requested := asArray(data, "providers_requested")
			first := ""
			if len(requested) > 0 {
				first, _ = requested[0].(string)
			}
			usedOther := false
			for _, name := range asArray(data, "providers_used") {
				value, _ := name.(string)
				if value != "" && value != first {
					usedOther = true
				}
			}
			if fallback || usedOther {
				return nil, fail("strict_provider_rejected", "strict_provider forbids fallback")
			}
		}
		return map[string]any{
			"contract_version":    text(data, "contract_version", ContractVersion),
			"request_id":          text(data, "request_id", ""),
			"success":             asBool(data, "success", false),
			"query":               text(data, "query", ""),
			"keywords":            text(data, "keywords", ""),
			"results":             results,
			"count":               asInt(data, "count", len(results)),
			"strict_provider":     strict,
			"providers_requested": asArray(data, "providers_requested"),
			"providers_used":      asArray(data, "providers_used"),
			"provider_trace":      traces,
			"errors":              asArray(data, "errors"),
			"error_code":          errorCode,
			"error":               text(data, "error", ""),
		}, nil
	case "BrowserSessionRequest":
		product := text(data, "product", "lite")
		if err := requireOne(product, []string{"core", "lite", "real"}, "product"); err != nil {
			return nil, err
		}
		persistent := asBool(data, "persistent_profile", false)
		profileDir := text(data, "profile_dir", "")
		profileID := text(data, "profile_id", "")
		if persistent && profileDir == "" && profileID == "" {
			return nil, fail("profile_denied", "Persistent profiles require an explicit isolated profile_dir")
		}
		if err := requireRFC3339(text(data, "issued_at", ""), "issued_at"); err != nil {
			return nil, err
		}
		if err := requireRFC3339(text(data, "deadline_at", ""), "deadline_at"); err != nil {
			return nil, err
		}
		policy, err := parsePolicy(data["policy"])
		if err != nil {
			return nil, err
		}
		return map[string]any{
			"contract_version":   text(data, "contract_version", ContractVersion),
			"request_id":         text(data, "request_id", ""),
			"session_id":         text(data, "session_id", ""),
			"product":            product,
			"headless":           asBool(data, "headless", true),
			"persistent_profile": persistent,
			"profile_dir":        profileDir,
			"issued_at":          text(data, "issued_at", ""),
			"deadline_at":        text(data, "deadline_at", ""),
			"policy":             policy,
		}, nil
	case "BrowserSessionState":
		status := text(data, "status", "pending")
		if err := requireOne(status, []string{"pending", "starting", "ready", "running", "paused", "interrupted", "closed"}, "status"); err != nil {
			return nil, err
		}
		product := text(data, "product", "lite")
		if err := requireOne(product, []string{"core", "lite", "real"}, "product"); err != nil {
			return nil, err
		}
		parsedError, err := parseError(data["error"])
		if err != nil {
			return nil, err
		}
		return map[string]any{
			"contract_version":   text(data, "contract_version", ContractVersion),
			"session_id":         text(data, "session_id", ""),
			"request_id":         text(data, "request_id", ""),
			"status":             status,
			"product":            product,
			"engine":             text(data, "engine", ""),
			"headless":           asBool(data, "headless", true),
			"persistent_profile": asBool(data, "persistent_profile", false),
			"created_at":         text(data, "created_at", ""),
			"updated_at":         text(data, "updated_at", ""),
			"current_url":        text(data, "current_url", ""),
			"error":              parsedError,
		}, nil
	case "BrowserCommand":
		commandID := text(data, "command_id", "")
		if commandID == "" {
			return nil, fail("invalid_request", "command_id is required")
		}
		cmd := text(data, "name", "")
		if err := requireOne(cmd, []string{
			"session.start", "session.close", "session.status", "session.pause", "session.resume", "session.retry",
			"navigate", "back", "forward", "reload", "wait",
			"snapshot.dom", "snapshot.ax", "locate", "click", "type", "select", "press",
			"markdown", "screenshot", "pdf", "download", "cancel", "evaluate",
		}, "name"); err != nil {
			return nil, err
		}
		if err := requireRFC3339(text(data, "issued_at", ""), "issued_at"); err != nil {
			return nil, err
		}
		if err := requireRFC3339(text(data, "deadline_at", ""), "deadline_at"); err != nil {
			return nil, err
		}
		return map[string]any{
			"contract_version": text(data, "contract_version", ContractVersion),
			"command_id":       commandID,
			"request_id":       text(data, "request_id", ""),
			"session_id":       text(data, "session_id", ""),
			"name":             cmd,
			"issued_at":        text(data, "issued_at", ""),
			"deadline_at":      text(data, "deadline_at", ""),
			"idempotency_key":  text(data, "idempotency_key", ""),
			"payload":          asObj(data, "payload"),
		}, nil
	case "BrowserEvent":
		eventID := text(data, "event_id", "")
		if eventID == "" {
			return nil, fail("invalid_request", "event_id is required")
		}
		evt := text(data, "name", "")
		if err := requireOne(evt, []string{
			"session.started", "session.closed", "session.interrupted", "session.status", "session.paused",
			"session.resumed", "session.retry", "navigated", "wait.done",
			"snapshot", "located", "action.done", "network", "console", "page.error", "markdown",
			"screenshot", "pdf", "download", "cancelled", "error", "research.progress", "capability.updated",
		}, "name"); err != nil {
			return nil, err
		}
		return map[string]any{
			"contract_version": text(data, "contract_version", ContractVersion),
			"event_id":         eventID,
			"command_id":       text(data, "command_id", ""),
			"request_id":       text(data, "request_id", ""),
			"session_id":       text(data, "session_id", ""),
			"name":             evt,
			"occurred_at":      text(data, "occurred_at", ""),
			"payload":          asObj(data, "payload"),
		}, nil
	case "DocumentRecord":
		digest := strings.ToLower(text(data, "sha256", ""))
		if digest != "" && !sha256OK(digest) {
			return nil, fail("invalid_request", "sha256 must be a 64-character hex digest")
		}
		return map[string]any{
			"contract_version": text(data, "contract_version", ContractVersion),
			"document_id":      text(data, "document_id", ""),
			"sha256":           digest,
			"url":              text(data, "url", ""),
			"final_url":        text(data, "final_url", ""),
			"title":            text(data, "title", ""),
			"host":             text(data, "host", ""),
			"fetched_at":       text(data, "fetched_at", ""),
			"indexed_at":       text(data, "indexed_at", ""),
			"bytes":            asInt(data, "bytes", 0),
			"content_type":     text(data, "content_type", ""),
			"provenance":       provenance(data["provenance"]),
		}, nil
	case "ResearchJob":
		return map[string]any{
			"contract_version": text(data, "contract_version", ContractVersion),
			"job_id":           text(data, "job_id", ""),
			"request_id":       text(data, "request_id", ""),
			"session_id":       text(data, "session_id", ""),
			"query":            text(data, "query", ""),
			"status":           text(data, "status", "running"),
			"pack_version":     asInt(data, "pack_version", 2),
			"strict_provider":  asBool(data, "strict_provider", false),
			"created_at":       text(data, "created_at", ""),
			"updated_at":       text(data, "updated_at", ""),
			"checkpoint_id":    text(data, "checkpoint_id", ""),
			"idempotency_key":  text(data, "idempotency_key", ""),
		}, nil
	case "ResearchProgress":
		stage := text(data, "stage", "plan")
		if err := requireOne(stage, []string{"plan", "search", "select", "fetch", "extract", "ground", "recover", "complete", "failed", "cancelled"}, "stage"); err != nil {
			return nil, err
		}
		return map[string]any{
			"contract_version": text(data, "contract_version", ContractVersion),
			"job_id":           text(data, "job_id", ""),
			"request_id":       text(data, "request_id", ""),
			"stage":            stage,
			"message":          text(data, "message", ""),
			"pages_fetched":    asInt(data, "pages_fetched", 0),
			"pages_target":     asInt(data, "pages_target", 0),
			"occurred_at":      text(data, "occurred_at", ""),
		}, nil
	case "ResearchResult":
		candidates := []any{}
		for _, item := range asArray(data, "candidates") {
			candidates = append(candidates, parseHit(item))
		}
		snapshots := []any{}
		for _, item := range asArray(data, "snapshots") {
			parsed, err := parseSnapshot(item)
			if err != nil {
				return nil, err
			}
			snapshots = append(snapshots, parsed)
		}
		claims := []any{}
		for _, item := range asArray(data, "claims") {
			parsed, err := parseClaim(item)
			if err != nil {
				return nil, err
			}
			claims = append(claims, parsed)
		}
		allowed := map[string]bool{}
		for _, item := range asArray(data, "selected_urls") {
			if s, ok := item.(string); ok {
				allowed[s] = true
			}
		}
		for _, item := range snapshots {
			row := asMap(item)
			url := text(row, "final_url", "")
			if url == "" {
				url = text(row, "url", "")
			}
			if url != "" {
				allowed[url] = true
			}
		}
		citations := []any{}
		for _, item := range asArray(data, "citations") {
			row := asMap(item)
			url := text(row, "url", "")
			if url == "" {
				return nil, fail("invalid_request", "citations cannot be empty")
			}
			if !allowed[url] {
				return nil, fail("invalid_request", "citation URL was not fetched or selected")
			}
			citations = append(citations, map[string]any{"title": text(row, "title", ""), "url": url})
		}
		parsedError, err := parseError(data["error"])
		if err != nil {
			return nil, err
		}
		return map[string]any{
			"contract_version": text(data, "contract_version", ContractVersion),
			"job_id":           text(data, "job_id", ""),
			"request_id":       text(data, "request_id", ""),
			"pack_version":     asInt(data, "pack_version", 2),
			"success":          asBool(data, "success", false),
			"query":            text(data, "query", ""),
			"queries":          asArray(data, "queries"),
			"candidates":       candidates,
			"selected_urls":    asArray(data, "selected_urls"),
			"snapshots":        snapshots,
			"claims":           claims,
			"contradictions":   asArray(data, "contradictions"),
			"citations":        citations,
			"error":            parsedError,
		}, nil
	default:
		return nil, fail("invalid_request", "Unknown core model: "+name)
	}
}

func RejectPublicBind(policy any, host string) error {
	parsed, err := parsePolicy(policy)
	if err != nil {
		return err
	}
	value := strings.ToLower(strings.TrimSpace(host))
	loopback := value == "127.0.0.1" || value == "localhost" || value == "::1"
	bind := asMap(parsed["bind"])
	if !loopback && !asBool(bind, "allow_public_bind", false) {
		return fail("public_bind_rejected", "Public bind rejected for "+host)
	}
	if !loopback && asBool(bind, "allow_public_bind", false) && (!asBool(bind, "require_tls", true) || !asBool(bind, "require_mtls", true)) {
		return fail("public_bind_rejected", "Public bind requires TLS 1.3 and mTLS")
	}
	return nil
}

func ClassifyNetworkTarget(raw string) map[string]string {
	value := strings.TrimSpace(raw)
	if value == "" {
		return map[string]string{"kind": "invalid", "scheme": "", "host": ""}
	}
	parsed, err := url.Parse(value)
	if err != nil {
		return map[string]string{"kind": "invalid", "scheme": "", "host": ""}
	}
	scheme := strings.ToLower(parsed.Scheme)
	if scheme == "file" {
		return map[string]string{"kind": "filesystem", "scheme": scheme, "host": ""}
	}
	if scheme == "data" || scheme == "about" || scheme == "blob" {
		return map[string]string{"kind": "local", "scheme": scheme, "host": ""}
	}
	if scheme != "http" && scheme != "https" {
		return map[string]string{"kind": "invalid", "scheme": scheme, "host": ""}
	}
	host := strings.ToLower(strings.Trim(parsed.Hostname(), "[]"))
	return map[string]string{"kind": classifyHostKind(host), "scheme": scheme, "host": host}
}

func classifyHostKind(host string) string {
	if host == "" {
		return "invalid"
	}
	if host == "localhost" || host == "::1" || host == "0.0.0.0" || host == "::" {
		return "loopback"
	}
	if strings.HasPrefix(host, "127.") {
		return "loopback"
	}
	if ip := net.ParseIP(host); ip != nil {
		if ip.IsLoopback() {
			return "loopback"
		}
		if ip4 := ip.To4(); ip4 != nil {
			if ip4[0] == 100 && ip4[1] >= 64 && ip4[1] <= 127 {
				return "private"
			}
			if ip4[0] >= 224 {
				return "private"
			}
			if ip4[0] == 10 || (ip4[0] == 192 && ip4[1] == 168) || (ip4[0] == 172 && ip4[1] >= 16 && ip4[1] <= 31) || (ip4[0] == 169 && ip4[1] == 254) {
				return "private"
			}
			if ip4[0] == 0 {
				return "loopback"
			}
		}
		if ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsMulticast() || ip.IsUnspecified() {
			return "private"
		}
		return "public"
	}
	parts := strings.Split(host, ".")
	if len(parts) == 4 {
		ok := true
		nums := make([]int, 4)
		for i, p := range parts {
			n, err := strconv.Atoi(p)
			if err != nil || n < 0 || n > 255 {
				ok = false
				break
			}
			nums[i] = n
		}
		if ok {
			a, b := nums[0], nums[1]
			if a == 10 {
				return "private"
			}
			if a == 192 && b == 168 {
				return "private"
			}
			if a == 172 && b >= 16 && b <= 31 {
				return "private"
			}
			if a == 169 && b == 254 {
				return "private"
			}
			if a == 100 && b >= 64 && b <= 127 {
				return "private"
			}
			if a >= 224 {
				return "private"
			}
			if a == 0 {
				return "loopback"
			}
			return "public"
		}
	}
	if strings.Contains(host, ":") {
		mapped := strings.TrimPrefix(host, "::ffff:")
		if mapped != host && strings.Count(mapped, ".") == 3 {
			return classifyHostKind(mapped)
		}
		if strings.HasPrefix(host, "fc") || strings.HasPrefix(host, "fd") || strings.HasPrefix(host, "fe80:") || strings.HasPrefix(host, "ff") {
			return "private"
		}
		return "public"
	}
	return "public"
}

func hostListed(host string, patterns []any) bool {
	value := strings.ToLower(host)
	for _, item := range patterns {
		needle, _ := item.(string)
		needle = strings.ToLower(strings.TrimPrefix(needle, "*."))
		if needle == "" {
			continue
		}
		if value == needle || strings.HasSuffix(value, "."+needle) {
			return true
		}
	}
	return false
}

func AssertFilesystem(policy any, operation string) error {
	parsed, err := parsePolicy(policy)
	if err != nil {
		return err
	}
	fs := asMap(parsed["filesystem"])
	if operation == "download" {
		if asBool(fs, "quarantine_downloads", true) {
			return nil
		}
		if !asBool(fs, "allow_write", false) {
			return fail("policy_denied", "Downloads require write permission when quarantine is disabled")
		}
		return nil
	}
	if operation == "read" && !asBool(fs, "allow_read", false) {
		return fail("policy_denied", "Filesystem read is denied")
	}
	if operation == "write" && !asBool(fs, "allow_write", false) {
		return fail("policy_denied", "Filesystem write is denied")
	}
	if operation != "read" && operation != "write" && operation != "download" {
		return fail("invalid_request", "Unknown filesystem operation")
	}
	return nil
}

func AssertNetworkURL(policy any, raw string) error {
	parsed, err := parsePolicy(policy)
	if err != nil {
		return err
	}
	target := ClassifyNetworkTarget(raw)
	kind := target["kind"]
	if kind == "invalid" {
		return fail("invalid_request", "URL is invalid")
	}
	if kind == "filesystem" {
		return AssertFilesystem(parsed, "read")
	}
	if kind == "local" {
		return nil
	}
	network := asMap(parsed["network"])
	host := target["host"]
	if hostListed(host, asArray(network, "deny_hosts")) {
		return fail("policy_denied", "Host denied: "+host)
	}
	allow := asArray(network, "allow_hosts")
	if len(allow) > 0 && !hostListed(host, allow) {
		return fail("policy_denied", "Host not allowlisted: "+host)
	}
	if kind == "loopback" && !asBool(network, "allow_loopback", false) {
		return fail("policy_denied", "Loopback navigation is denied")
	}
	if kind == "private" && !asBool(network, "allow_private", false) {
		return fail("policy_denied", "Private-network navigation is denied")
	}
	if kind == "public" && !asBool(network, "allow_public", true) {
		return fail("policy_denied", "Public-network navigation is denied")
	}
	return nil
}
