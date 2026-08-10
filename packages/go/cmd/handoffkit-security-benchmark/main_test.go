package main

import "testing"

func TestFinalizationBenchmarkMeasuresRealComponents(t *testing.T) {
	measurements, err := measureAll(t.TempDir(), 3, 0)
	if err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{
		"durable_replay_write",
		"durable_replay_restart_recovery",
		"durable_revocation_write",
		"durable_revocation_reload",
		"security_transcript_build",
		"security_transcript_verify",
		"artifact_ed25519_sign",
		"artifact_ed25519_verify",
		"studio_event_emit",
		"studio_event_parse",
	} {
		measurement, ok := measurements[name]
		if !ok || measurement.Count != 3 || measurement.Min < 0 || measurement.Max < measurement.Min {
			t.Fatalf("invalid measurement for %s: %#v", name, measurement)
		}
		if operationsPerSample[name] < 1 {
			t.Fatalf("missing operations-per-sample disclosure for %s", name)
		}
	}
}
