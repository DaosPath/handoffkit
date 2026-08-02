package edgeprofile

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"testing"

	"github.com/DaosPath/handoffkit/go/security"
	"github.com/DaosPath/handoffkit/go/transport"
)

func TestProfilesMatchSharedFixtureAndApplyRealLimits(t *testing.T) {
	_, source, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("cannot locate shared profile fixture")
	}
	path := filepath.Join(filepath.Dir(source), "..", "..", "contracts", "test-fixtures", "security", "edge-runtime-profiles-v1.json")
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Format        string    `json:"format"`
		FormatVersion int       `json:"format_version"`
		Profiles      []Profile `json:"profiles"`
	}
	if err := json.Unmarshal(data, &fixture); err != nil {
		t.Fatal(err)
	}
	if fixture.Format != "handoffkit.edge-profiles" || fixture.FormatVersion != 1 || len(fixture.Profiles) != 3 {
		t.Fatalf("invalid shared fixture: %#v", fixture)
	}
	for _, expected := range fixture.Profiles {
		actual, err := Preset(expected.Name)
		if err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(actual, expected) {
			t.Fatalf("profile mismatch for %s:\nactual=%#v\nexpected=%#v", expected.Name, actual, expected)
		}
		if err := actual.Validate(); err != nil {
			t.Fatal(err)
		}
		session := actual.SessionConfig("edge-session")
		if session.MaxMessageBytes != actual.MaxFrameBytes || session.ChannelCapacity != actual.ChannelCapacity || session.DedupCapacity != actual.DedupCapacity {
			t.Fatalf("session did not apply %s", actual.Name)
		}
	}
}

func TestProfileAppliesTransportWithoutTLSDowngrade(t *testing.T) {
	profile, _ := Preset(EdgeSmall)
	config := transport.DefaultConfig()
	config.SecurityConfig = &security.SecurityConfig{
		Profile: security.SecurityProfileStandard, TrustDomain: "handoffkit.internal",
		ReplayWindowSeconds: 30, MaxClockSkewSeconds: 3,
	}
	config.IdentityPolicy = security.NewCertificateIdentityPolicy("handoffkit.internal", map[string][]string{})
	config.CapabilityPolicy = security.NewCapabilityPolicy(nil, nil)
	config.ReplayProtection = security.NewReplayProtection(30, 3, 100)
	applied, err := profile.ApplyTransport(config)
	if err != nil {
		t.Fatal(err)
	}
	if applied.MaxMessageBytes != profile.MaxFrameBytes || applied.RetryPolicy.MaxAttempts != profile.Reconnect.MaxAttempts {
		t.Fatalf("profile limits were not connected: %#v", applied)
	}
	config.SecurityConfig.Profile = security.SecurityProfileLocal
	_, err = profile.ApplyTransport(config)
	var structured *security.SecurityError
	if !errors.As(err, &structured) || structured.Code != "edge_security_profile_mismatch" {
		t.Fatalf("profile silently weakened transport: %#v", err)
	}
}
