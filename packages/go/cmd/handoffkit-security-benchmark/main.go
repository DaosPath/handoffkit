// Command handoffkit-security-benchmark measures selected real 1.19 security
// components. It emits an environmental JSON record and never claims a
// performance guarantee.
package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/json"
	"flag"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"

	"github.com/DaosPath/handoffkit/go/security"
	"github.com/DaosPath/handoffkit/go/studioevents"
)

const notice = "Environmental measurement — not a performance guarantee."

var operationsPerSample = map[string]int{
	"durable_replay_write":            1,
	"durable_replay_restart_recovery": 64,
	"durable_revocation_write":        1,
	"durable_revocation_reload":       64,
	"security_transcript_build":       512,
	"security_transcript_verify":      512,
	"artifact_ed25519_sign":           256,
	"artifact_ed25519_verify":         128,
	"studio_event_emit":               1,
	"studio_event_parse":              64,
}

type distribution struct {
	Count int     `json:"count"`
	Mean  float64 `json:"mean_ms"`
	P50   float64 `json:"p50_ms"`
	P95   float64 `json:"p95_ms"`
	P99   float64 `json:"p99_ms"`
	Min   float64 `json:"min_ms"`
	Max   float64 `json:"max_ms"`
}

func main() {
	iterations := flag.Int("iterations", 25, "measured samples per operation (minimum 3)")
	warmup := flag.Int("warmup", 3, "unrecorded samples per operation")
	flag.Parse()
	if *iterations < 3 || *warmup < 0 {
		fail("iterations must be >= 3 and warmup must not be negative")
	}
	root, err := os.MkdirTemp("", "handoffkit-security-benchmark-*")
	if err != nil {
		fail(err.Error())
	}
	defer os.RemoveAll(root)

	measurements, err := measureAll(root, *iterations, *warmup)
	if err != nil {
		fail(err.Error())
	}
	buildMode := os.Getenv("HANDOFFKIT_BUILD_MODE")
	if buildMode == "" {
		buildMode = "development"
	}
	result := map[string]any{
		"notice":       notice,
		"runtime":      "go",
		"generated_at": time.Now().UTC().Format(time.RFC3339Nano),
		"providers": map[string]string{
			"artifact_signature": "Go standard library crypto/ed25519",
			"durable_state":      "HandoffKit JSON with OS atomic replacement",
			"studio_events":      "HandoffKit NDJSON with OS atomic replacement",
			"tls":                "not measured by this command",
		},
		"environment": map[string]any{
			"os": runtime.GOOS, "architecture": runtime.GOARCH,
			"go": runtime.Version(), "logical_cpus": runtime.NumCPU(),
			"cpu_model": "unavailable via portable Go runtime", "build_mode": buildMode,
		},
		"parameters": map[string]any{
			"samples": *iterations, "warmup": *warmup, "payload_bytes": 64 * 1024,
			"concurrency": 1, "operations_per_sample": operationsPerSample,
		},
		"measurements": measurements,
	}
	encoded, err := json.MarshalIndent(result, "", "  ")
	if err != nil {
		fail(err.Error())
	}
	fmt.Println(string(encoded))
}

func measureAll(root string, iterations, warmup int) (map[string]distribution, error) {
	result := map[string]distribution{}
	context := &security.ReplayContext{
		PeerID: "benchmark-peer", SessionID: "benchmark-session",
		CredentialFingerprint: "sha256:" + strings.Repeat("a", 64), SecurityProfile: "standard",
	}
	replayPath := filepath.Join(root, "replay.json")
	replay, err := security.NewDurableReplayProtection(replayPath, security.DefaultDurableReplayOptions())
	if err != nil {
		return nil, err
	}
	sequence := uint64(0)
	result["durable_replay_write"] = sample(iterations, warmup, operationsPerSample["durable_replay_write"], func() error {
		sequence++
		return replay.CheckAndRecordContext(
			context.CredentialFingerprint+"|"+context.SessionID,
			sequence,
			fmt.Sprintf("benchmark-nonce-%d", sequence),
			time.Now().Unix(),
			context,
		)
	})
	result["durable_replay_restart_recovery"] = sample(iterations, warmup, operationsPerSample["durable_replay_restart_recovery"], func() error {
		_, loadErr := security.NewDurableReplayProtection(replayPath, security.DefaultDurableReplayOptions())
		return loadErr
	})

	revocationPath := filepath.Join(root, "revocations.json")
	revocations, err := security.NewDurableRevocationPolicy(revocationPath, security.DefaultDurableRevocationOptions())
	if err != nil {
		return nil, err
	}
	revocationIndex := 0
	result["durable_revocation_write"] = sample(iterations, warmup, operationsPerSample["durable_revocation_write"], func() error {
		revocationIndex++
		entry, entryErr := security.NewRevocationEntry(
			security.RevocationPeerID,
			fmt.Sprintf("benchmark-peer-%d", revocationIndex),
			"benchmark",
			time.Now().Unix(), 0, 0,
		)
		if entryErr != nil {
			return entryErr
		}
		return revocations.Revoke(entry)
	})
	result["durable_revocation_reload"] = sample(iterations, warmup, operationsPerSample["durable_revocation_reload"], func() error {
		_, loadErr := security.NewDurableRevocationPolicy(revocationPath, security.DefaultDurableRevocationOptions())
		return loadErr
	})

	sender := security.PeerIdentity{
		PeerID: "benchmark-sender", NodeID: "node-sender", TrustDomain: "handoffkit.internal",
		CredentialFingerprint: "sha256:" + strings.Repeat("b", 64), Capabilities: []string{"benchmark:run"},
	}
	receiver := security.PeerIdentity{
		PeerID: "benchmark-receiver", NodeID: "node-receiver", TrustDomain: "handoffkit.internal",
		CredentialFingerprint: "sha256:" + strings.Repeat("c", 64),
	}
	transcriptInput := security.SecurityTranscriptInput{
		ProtocolVersion: "1.0", RequestedProfile: security.SecurityProfileStandard,
		SelectedProfile: security.SecurityProfileStandard, Sender: &sender, Receiver: &receiver,
		TLSVersion: "TLSv1.3", SessionID: "benchmark-session", HandshakeNonce: "benchmark-nonce",
		Timestamp: "2026-08-02T00:00:00Z",
	}
	transcript, err := security.BuildSecurityTranscript(transcriptInput)
	if err != nil {
		return nil, err
	}
	result["security_transcript_build"] = sample(iterations, warmup, operationsPerSample["security_transcript_build"], func() error {
		_, buildErr := security.BuildSecurityTranscript(transcriptInput)
		return buildErr
	})
	result["security_transcript_verify"] = sample(iterations, warmup, operationsPerSample["security_transcript_verify"], func() error {
		_, verifyErr := security.VerifySecurityTranscript(transcript, transcriptInput)
		return verifyErr
	})

	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, err
	}
	identity := "spiffe://handoffkit.internal/producer/benchmark"
	signer := &security.ArtifactSigner{PrivateKey: privateKey, SignerIdentity: identity}
	trust := security.NewArtifactTrustPolicy([]security.ArtifactSigningCredential{{
		SignerIdentity: identity, PublicKey: publicKey, ValidFrom: 1, ValidUntil: 4_000_000_000,
	}})
	payload := make([]byte, 64*1024)
	if _, err := rand.Read(payload); err != nil {
		return nil, err
	}
	now := int64(2_000_000_000)
	artifact, err := signer.SignArtifact("benchmark-artifact", payload, now)
	if err != nil {
		return nil, err
	}
	result["artifact_ed25519_sign"] = sample(iterations, warmup, operationsPerSample["artifact_ed25519_sign"], func() error {
		_, signErr := signer.SignArtifact("benchmark-artifact", payload, now)
		return signErr
	})
	result["artifact_ed25519_verify"] = sample(iterations, warmup, operationsPerSample["artifact_ed25519_verify"], func() error {
		return security.VerifySignedArtifact(payload, artifact, trust, now)
	})

	sink, err := studioevents.NewFileSink(
		filepath.Join(root, "studio", "events.ndjson"), studioevents.DefaultFileOptions())
	if err != nil {
		return nil, err
	}
	eventIndex := 0
	result["studio_event_emit"] = sample(iterations, warmup, operationsPerSample["studio_event_emit"], func() error {
		eventIndex++
		event, eventErr := studioevents.New("go", "edge-small", studioevents.EventRuntimeStatus, studioevents.RuntimeStatus{
			Connections: eventIndex % 4, ConnectionLimit: 8,
			Queue:                 studioevents.Queue{Pending: eventIndex % 4, Capacity: 16},
			HybridPQProviderState: "unavailable",
		})
		if eventErr != nil {
			return eventErr
		}
		return sink.Emit(event)
	})
	result["studio_event_parse"] = sample(iterations, warmup, operationsPerSample["studio_event_parse"], func() error {
		data, readErr := os.ReadFile(filepath.Join(root, "studio", "events.ndjson"))
		if readErr != nil {
			return readErr
		}
		_, parseErr := studioevents.ParseNDJSON(data)
		return parseErr
	})
	return result, nil
}

func sample(iterations, warmup, batch int, operation func() error) distribution {
	if batch < 1 {
		fail("benchmark batch must be positive")
	}
	for index := 0; index < warmup; index++ {
		for operationIndex := 0; operationIndex < batch; operationIndex++ {
			if err := operation(); err != nil {
				fail(err.Error())
			}
		}
	}
	values := make([]float64, 0, iterations)
	for index := 0; index < iterations; index++ {
		started := time.Now()
		for operationIndex := 0; operationIndex < batch; operationIndex++ {
			if err := operation(); err != nil {
				fail(err.Error())
			}
		}
		values = append(values, float64(time.Since(started).Nanoseconds())/float64(batch)/1_000_000)
	}
	sort.Float64s(values)
	var total float64
	for _, value := range values {
		total += value
	}
	return distribution{
		Count: len(values), Mean: total / float64(len(values)),
		P50: percentile(values, 0.50), P95: percentile(values, 0.95), P99: percentile(values, 0.99),
		Min: values[0], Max: values[len(values)-1],
	}
}

func percentile(values []float64, quantile float64) float64 {
	index := int(math.Ceil(float64(len(values))*quantile)) - 1
	if index < 0 {
		index = 0
	}
	if index >= len(values) {
		index = len(values) - 1
	}
	return values[index]
}

func fail(message string) {
	fmt.Fprintln(os.Stderr, message)
	os.Exit(1)
}
