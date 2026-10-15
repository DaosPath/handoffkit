package artifactgate

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/DaosPath/handoffkit/go/contract"
	"github.com/DaosPath/handoffkit/go/security"
)

type SignatureRequirement string

const (
	SignatureOptional SignatureRequirement = "optional"
	SignatureRequired SignatureRequirement = "required"
)

type Policy struct {
	HashRequired         bool
	SignatureRequirement SignatureRequirement
	TrustedProducers     map[string]bool
	TrustedSigners       map[string]bool
	AllowedMediaTypes    map[string]bool
	MaxSizeBytes         int64
	AllowedRoots         []string
	SnapshotDirectory    string
	QuarantineDirectory  string
	SignaturePolicy      *security.ArtifactTrustPolicy
}

func (policy Policy) Validate() error {
	if !policy.HashRequired {
		return gateError("artifact_policy_invalid", "artifact ingestion cannot disable SHA-256 verification")
	}
	if policy.SignatureRequirement != SignatureOptional && policy.SignatureRequirement != SignatureRequired {
		return gateError("artifact_policy_invalid", "signature requirement must be optional or required")
	}
	if policy.MaxSizeBytes < 1 {
		return gateError("artifact_policy_invalid", "artifact size limit must be positive")
	}
	if len(policy.AllowedRoots) == 0 {
		return gateError("artifact_policy_invalid", "artifact policy requires an allowed root")
	}
	if strings.TrimSpace(policy.SnapshotDirectory) == "" {
		return gateError("artifact_policy_invalid", "artifact policy requires a snapshot directory")
	}
	if policy.SignatureRequirement == SignatureRequired && policy.SignaturePolicy == nil {
		return gateError("artifact_policy_invalid", "required signatures need a local trust policy")
	}
	if policy.SignatureRequirement == SignatureRequired &&
		(len(policy.TrustedProducers) == 0 || len(policy.TrustedSigners) == 0) {
		return gateError("artifact_policy_invalid", "required signatures need producer and signer allowlists")
	}
	return nil
}

type Gate struct {
	policy Policy
	mu     sync.Mutex
}

type VerifiedArtifact struct {
	Original     contract.ArtifactRef
	Snapshot     contract.ArtifactRef
	SnapshotPath string
	once         sync.Once
}

func (artifact *VerifiedArtifact) Close() error {
	var err error
	artifact.once.Do(func() { err = os.Remove(artifact.SnapshotPath) })
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}

func New(policy Policy) (*Gate, error) {
	if err := policy.Validate(); err != nil {
		return nil, err
	}
	roots := make([]string, 0, len(policy.AllowedRoots))
	for _, root := range policy.AllowedRoots {
		canonical, err := filepath.EvalSymlinks(root)
		if err != nil {
			return nil, gateError("artifact_policy_invalid", "allowed artifact root cannot be resolved")
		}
		canonical, err = filepath.Abs(canonical)
		if err != nil {
			return nil, gateError("artifact_policy_invalid", "allowed artifact root is invalid")
		}
		roots = append(roots, filepath.Clean(canonical))
	}
	policy.AllowedRoots = roots
	var err error
	policy.SnapshotDirectory, err = filepath.Abs(policy.SnapshotDirectory)
	if err != nil {
		return nil, gateError("artifact_policy_invalid", "snapshot directory is invalid")
	}
	if policy.QuarantineDirectory != "" {
		policy.QuarantineDirectory, err = filepath.Abs(policy.QuarantineDirectory)
		if err != nil {
			return nil, gateError("artifact_policy_invalid", "quarantine directory is invalid")
		}
	}
	return &Gate{policy: policy}, nil
}

func (gate *Gate) Policy() Policy {
	gate.mu.Lock()
	defer gate.mu.Unlock()
	return gate.policy
}

func (gate *Gate) Ingest(reference contract.ArtifactRef, now int64) (_ *VerifiedArtifact, err error) {
	defer func() {
		if err != nil {
			gate.quarantine(reference, errorCode(err))
		}
	}()
	if err = reference.Validate(); err != nil {
		return nil, gateError("invalid_artifact_ref", "artifact reference is invalid")
	}
	if len(gate.policy.AllowedMediaTypes) > 0 && !gate.policy.AllowedMediaTypes[reference.MediaType] {
		return nil, gateError("artifact_media_type_denied", "artifact media type is not locally allowlisted")
	}

	path, err := localFilePath(reference.URI)
	if err != nil {
		return nil, err
	}
	canonical, err := filepath.EvalSymlinks(path)
	if err != nil {
		return nil, gateError("artifact_unavailable", "artifact path cannot be resolved")
	}
	canonical, err = filepath.Abs(canonical)
	if err != nil {
		return nil, gateError("artifact_unavailable", "artifact path cannot be resolved")
	}
	canonical = filepath.Clean(canonical)
	if !withinAnyRoot(canonical, gate.policy.AllowedRoots) {
		return nil, gateError("artifact_path_denied", "artifact path is outside every locally allowed root")
	}
	before, err := os.Stat(canonical)
	if err != nil || !before.Mode().IsRegular() {
		return nil, gateError("artifact_unavailable", "artifact is not a regular file")
	}
	file, err := os.Open(canonical)
	if err != nil {
		return nil, gateError("artifact_unavailable", "artifact cannot be opened")
	}
	defer file.Close()
	after, err := file.Stat()
	if err != nil || !after.Mode().IsRegular() || !os.SameFile(before, after) {
		return nil, gateError("artifact_changed", "artifact changed while it was being opened")
	}
	if after.Size() > gate.policy.MaxSizeBytes {
		return nil, gateError("artifact_too_large", "artifact exceeds the configured size limit")
	}
	if after.Size() < 0 || uint64(after.Size()) != reference.SizeBytes {
		return nil, gateError("artifact_size_mismatch", "artifact size does not match ArtifactRef")
	}
	data, err := io.ReadAll(io.LimitReader(file, gate.policy.MaxSizeBytes+1))
	if err != nil {
		return nil, gateError("artifact_unavailable", "artifact cannot be read")
	}
	if int64(len(data)) > gate.policy.MaxSizeBytes {
		return nil, gateError("artifact_too_large", "artifact grew beyond the configured size limit")
	}
	if int64(len(data)) != after.Size() {
		return nil, gateError("artifact_changed", "artifact changed while it was being ingested")
	}
	digest := sha256.Sum256(data)
	actualHash := hex.EncodeToString(digest[:])
	if !strings.EqualFold(actualHash, reference.SHA256) {
		return nil, gateError("artifact_integrity_mismatch", "artifact SHA-256 does not match ArtifactRef")
	}

	signed, present, err := signedMetadata(reference.Metadata)
	if err != nil {
		return nil, err
	}
	if !present && gate.policy.SignatureRequirement == SignatureRequired {
		return nil, gateError("artifact_signature_required", "artifact policy requires an Ed25519 signature")
	}
	if present {
		if signed.ArtifactID != reference.ArtifactID {
			return nil, gateError("artifact_signature_mismatch", "signed artifact ID does not match ArtifactRef")
		}
		if len(gate.policy.TrustedSigners) > 0 && !gate.policy.TrustedSigners[signed.SignerIdentity] {
			return nil, gateError("artifact_signer_denied", "artifact signer is not locally authorized")
		}
		if gate.policy.SignaturePolicy == nil {
			return nil, gateError("artifact_signature_policy_missing", "signed artifact metadata requires a trust policy")
		}
		if err := security.VerifySignedArtifact(data, signed, gate.policy.SignaturePolicy, now); err != nil {
			return nil, err
		}
	}
	declaredProducer, _ := reference.Metadata["producer_identity"].(string)
	if present && declaredProducer != "" && declaredProducer != signed.SignerIdentity {
		return nil, gateError("artifact_producer_mismatch", "declared producer does not match verified signer")
	}
	if len(gate.policy.TrustedProducers) > 0 && (!present || !gate.policy.TrustedProducers[signed.SignerIdentity]) {
		return nil, gateError("artifact_producer_denied", "artifact producer is not established by an authorized signature")
	}

	snapshotPath, err := writeSnapshot(gate.policy.SnapshotDirectory, data)
	if err != nil {
		return nil, err
	}
	metadata := cloneMetadata(reference.Metadata)
	metadata["ingestion_verified"] = true
	metadata["ingestion_snapshot"] = true
	snapshot := reference
	snapshot.URI = fileURI(snapshotPath)
	snapshot.SHA256 = actualHash
	snapshot.Metadata = metadata
	return &VerifiedArtifact{
		Original: reference, Snapshot: snapshot, SnapshotPath: snapshotPath,
	}, nil
}

func localFilePath(raw string) (string, error) {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme != "file" || (parsed.Host != "" && parsed.Host != "localhost") {
		return "", gateError("artifact_uri_unsupported", "artifact ingestion accepts only local file URIs")
	}
	path, err := url.PathUnescape(parsed.Path)
	if err != nil || path == "" {
		return "", gateError("artifact_uri_invalid", "artifact file URI has no valid path")
	}
	if runtime.GOOS == "windows" && len(path) >= 3 && path[0] == '/' && path[2] == ':' {
		path = path[1:]
	}
	return filepath.FromSlash(path), nil
}

func fileURI(path string) string {
	value := filepath.ToSlash(path)
	if runtime.GOOS == "windows" && !strings.HasPrefix(value, "/") {
		value = "/" + value
	}
	return (&url.URL{Scheme: "file", Path: value}).String()
}

func withinAnyRoot(candidate string, roots []string) bool {
	for _, root := range roots {
		relative, err := filepath.Rel(root, candidate)
		if err == nil && relative != ".." && !strings.HasPrefix(relative, ".."+string(os.PathSeparator)) && !filepath.IsAbs(relative) {
			return true
		}
	}
	return false
}

func signedMetadata(metadata map[string]any) (security.SignedArtifact, bool, error) {
	value, ok := metadata["signed_artifact"]
	if !ok || value == nil {
		return security.SignedArtifact{}, false, nil
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		return security.SignedArtifact{}, false, gateError("invalid_signed_artifact", "signed artifact metadata is invalid")
	}
	decoder := json.NewDecoder(bytes.NewReader(encoded))
	decoder.DisallowUnknownFields()
	var signed security.SignedArtifact
	if err := decoder.Decode(&signed); err != nil {
		return security.SignedArtifact{}, false, gateError("invalid_signed_artifact", "signed artifact metadata is invalid")
	}
	if err := signed.Validate(); err != nil {
		return security.SignedArtifact{}, false, err
	}
	return signed, true, nil
}

func writeSnapshot(directory string, data []byte) (string, error) {
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return "", gateError("artifact_snapshot_failed", "artifact snapshot directory is unavailable")
	}
	if err := os.Chmod(directory, 0o700); err != nil && runtime.GOOS != "windows" {
		return "", gateError("artifact_snapshot_failed", "artifact snapshot directory permissions are unsafe")
	}
	file, err := os.CreateTemp(directory, ".handoffkit-*.tmp")
	if err != nil {
		return "", gateError("artifact_snapshot_failed", "artifact snapshot cannot be created")
	}
	temporary := file.Name()
	committed := false
	defer func() {
		_ = file.Close()
		if !committed {
			_ = os.Remove(temporary)
		}
	}()
	if err := file.Chmod(0o600); err != nil && runtime.GOOS != "windows" {
		return "", gateError("artifact_snapshot_failed", "artifact snapshot permissions are unsafe")
	}
	if _, err := file.Write(data); err != nil {
		return "", gateError("artifact_snapshot_failed", "artifact snapshot cannot be written")
	}
	if err := file.Sync(); err != nil {
		return "", gateError("artifact_snapshot_failed", "artifact snapshot cannot be synced")
	}
	if err := file.Close(); err != nil {
		return "", gateError("artifact_snapshot_failed", "artifact snapshot cannot be closed")
	}
	destination := strings.TrimSuffix(temporary, ".tmp") + ".artifact"
	if err := os.Rename(temporary, destination); err != nil {
		return "", gateError("artifact_snapshot_failed", "artifact snapshot cannot be committed")
	}
	committed = true
	return destination, nil
}

func cloneMetadata(value map[string]any) map[string]any {
	if value == nil {
		return map[string]any{}
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		return map[string]any{}
	}
	var result map[string]any
	if json.Unmarshal(encoded, &result) != nil || result == nil {
		return map[string]any{}
	}
	return result
}

func (gate *Gate) quarantine(reference contract.ArtifactRef, code string) {
	if gate.policy.QuarantineDirectory == "" {
		return
	}
	gate.mu.Lock()
	defer gate.mu.Unlock()
	if os.MkdirAll(gate.policy.QuarantineDirectory, 0o700) != nil {
		return
	}
	record := map[string]any{
		"artifact_id":    reference.ArtifactID,
		"code":           code,
		"quarantined_at": time.Now().Unix(),
	}
	data, err := json.Marshal(record)
	if err != nil {
		return
	}
	file, err := os.CreateTemp(gate.policy.QuarantineDirectory, ".quarantine-*.tmp")
	if err != nil {
		return
	}
	name := file.Name()
	if file.Chmod(0o600) != nil && runtime.GOOS != "windows" {
		_ = file.Close()
		_ = os.Remove(name)
		return
	}
	_, writeErr := file.Write(data)
	syncErr := file.Sync()
	closeErr := file.Close()
	if writeErr != nil || syncErr != nil || closeErr != nil {
		_ = os.Remove(name)
		return
	}
	_ = os.Rename(name, strings.TrimSuffix(name, ".tmp")+".json")
}

func gateError(code, message string) error {
	return &security.SecurityError{Code: code, Message: message, Details: map[string]any{}}
}

func errorCode(err error) string {
	var securityErr *security.SecurityError
	if errors.As(err, &securityErr) {
		return securityErr.Code
	}
	return "artifact_ingestion_failed"
}

func DebugDecision(err error) string {
	if err == nil {
		return "accepted"
	}
	return fmt.Sprintf("rejected:%s", errorCode(err))
}
