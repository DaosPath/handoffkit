package edgeprofile

import (
	"errors"
	"fmt"
	"time"

	"github.com/DaosPath/handoffkit/go/contract"
	"github.com/DaosPath/handoffkit/go/security"
	"github.com/DaosPath/handoffkit/go/transport"
)

const (
	EdgeSmall    = "edge-small"
	EdgeStandard = "edge-standard"
	Server       = "server"
)

type ReconnectPolicy struct {
	MaxAttempts int `json:"max_attempts"`
	BaseDelayMS int `json:"base_delay_ms"`
	MaxDelayMS  int `json:"max_delay_ms"`
}

type TimeoutPolicy struct {
	ConnectMS int `json:"connect_ms"`
	IOMS      int `json:"io_ms"`
	AckMS     int `json:"ack_ms"`
}

type LoggingPolicy struct {
	Level           string `json:"level"`
	IncludePayloads bool   `json:"include_payloads"`
	RedactPaths     bool   `json:"redact_paths"`
}

type Profile struct {
	Name                   string          `json:"name"`
	ChannelCapacity        int             `json:"channel_capacity"`
	MaxFrameBytes          int             `json:"max_frame_bytes"`
	PendingACKLimit        int             `json:"pending_ack_limit"`
	DedupCapacity          int             `json:"dedup_capacity"`
	DurableReplayCapacity  int             `json:"durable_replay_capacity"`
	ConnectionLimit        int             `json:"connection_limit"`
	HeartbeatSeconds       int             `json:"heartbeat_seconds"`
	Reconnect              ReconnectPolicy `json:"reconnect"`
	Timeout                TimeoutPolicy   `json:"timeout"`
	ArtifactLimitBytes     int64           `json:"artifact_limit_bytes"`
	MemoryBudgetBytes      int64           `json:"memory_budget_bytes"`
	DurableStateLimitBytes int64           `json:"durable_state_limit_bytes"`
	Logging                LoggingPolicy   `json:"logging"`
	SecurityProfile        string          `json:"security_profile"`
}

var presets = map[string]Profile{
	EdgeSmall: {
		Name: EdgeSmall, ChannelCapacity: 16, MaxFrameBytes: 1_048_576,
		PendingACKLimit: 32, DedupCapacity: 512, DurableReplayCapacity: 2_048,
		ConnectionLimit: 8, HeartbeatSeconds: 30,
		Reconnect:          ReconnectPolicy{MaxAttempts: 5, BaseDelayMS: 250, MaxDelayMS: 5_000},
		Timeout:            TimeoutPolicy{ConnectMS: 5_000, IOMS: 15_000, AckMS: 10_000},
		ArtifactLimitBytes: 16_777_216, MemoryBudgetBytes: 268_435_456,
		DurableStateLimitBytes: 8_388_608,
		Logging:                LoggingPolicy{Level: "warning", IncludePayloads: false, RedactPaths: true},
		SecurityProfile:        "standard",
	},
	EdgeStandard: {
		Name: EdgeStandard, ChannelCapacity: 64, MaxFrameBytes: 4_194_304,
		PendingACKLimit: 128, DedupCapacity: 2_048, DurableReplayCapacity: 10_000,
		ConnectionLimit: 32, HeartbeatSeconds: 15,
		Reconnect:          ReconnectPolicy{MaxAttempts: 5, BaseDelayMS: 100, MaxDelayMS: 3_000},
		Timeout:            TimeoutPolicy{ConnectMS: 5_000, IOMS: 30_000, AckMS: 30_000},
		ArtifactLimitBytes: 67_108_864, MemoryBudgetBytes: 1_073_741_824,
		DurableStateLimitBytes: 33_554_432,
		Logging:                LoggingPolicy{Level: "info", IncludePayloads: false, RedactPaths: true},
		SecurityProfile:        "standard",
	},
	Server: {
		Name: Server, ChannelCapacity: 256, MaxFrameBytes: 8_388_608,
		PendingACKLimit: 1_024, DedupCapacity: 16_384, DurableReplayCapacity: 100_000,
		ConnectionLimit: 256, HeartbeatSeconds: 10,
		Reconnect:          ReconnectPolicy{MaxAttempts: 8, BaseDelayMS: 50, MaxDelayMS: 2_000},
		Timeout:            TimeoutPolicy{ConnectMS: 5_000, IOMS: 60_000, AckMS: 60_000},
		ArtifactLimitBytes: 536_870_912, MemoryBudgetBytes: 4_294_967_296,
		DurableStateLimitBytes: 268_435_456,
		Logging:                LoggingPolicy{Level: "info", IncludePayloads: false, RedactPaths: true},
		SecurityProfile:        "standard",
	},
}

func Preset(name string) (Profile, error) {
	profile, ok := presets[name]
	if !ok {
		return Profile{}, fmt.Errorf("unknown edge profile %q", name)
	}
	return profile, nil
}

func (profile Profile) Validate() error {
	if profile.Name != EdgeSmall && profile.Name != EdgeStandard && profile.Name != Server {
		return errors.New("edge profile name is invalid")
	}
	if profile.ChannelCapacity < 1 || profile.MaxFrameBytes < contract.MinMessageBytes || profile.MaxFrameBytes > contract.DefaultMaxMessageBytes ||
		profile.PendingACKLimit < 1 || profile.DedupCapacity < 1 || profile.DurableReplayCapacity < 1 || profile.ConnectionLimit < 1 || profile.HeartbeatSeconds < 1 ||
		profile.Reconnect.MaxAttempts < 1 || profile.Reconnect.MaxAttempts > contract.MaxRetryAttempts || profile.Reconnect.BaseDelayMS < 0 || profile.Reconnect.MaxDelayMS < profile.Reconnect.BaseDelayMS ||
		profile.Timeout.ConnectMS < 1 || profile.Timeout.IOMS < 1 || profile.Timeout.AckMS < 1 || profile.ArtifactLimitBytes < 1 || profile.MemoryBudgetBytes < 64*1024*1024 || profile.DurableStateLimitBytes < 1024 {
		return errors.New("edge profile bounds are invalid")
	}
	if profile.Logging.IncludePayloads || !profile.Logging.RedactPaths || (profile.Logging.Level != "warning" && profile.Logging.Level != "info") {
		return errors.New("edge logging policy is unsafe")
	}
	if profile.SecurityProfile != "standard" {
		return errors.New("edge profile cannot weaken or relabel the standard security profile")
	}
	return nil
}

func (profile Profile) SessionConfig(sessionID string) contract.SessionConfig {
	return contract.SessionConfig{
		SessionID: sessionID, RuntimeMode: contract.RuntimeSession,
		ChannelCapacity: profile.ChannelCapacity, MaxMessageBytes: profile.MaxFrameBytes,
		AckTimeoutMS: profile.Timeout.AckMS, DedupCapacity: profile.DedupCapacity,
		RetryPolicy: contract.RetryPolicy{
			MaxAttempts: profile.Reconnect.MaxAttempts,
			BaseDelayMS: profile.Reconnect.BaseDelayMS,
			MaxDelayMS:  profile.Reconnect.MaxDelayMS,
		},
		Metadata: map[string]any{"edge_profile": profile.Name},
	}
}

func (profile Profile) ApplyTransport(config transport.Config) (transport.Config, error) {
	if err := profile.Validate(); err != nil {
		return transport.Config{}, err
	}
	if config.SecurityConfig == nil || config.SecurityConfig.Profile != security.SecurityProfileStandard {
		return transport.Config{}, &security.SecurityError{
			Code:    "edge_security_profile_mismatch",
			Message: "edge profile requires the standard TLS profile and never downgrades or relabels another profile",
			Details: map[string]any{"edge_profile": profile.Name},
		}
	}
	config.MaxMessageBytes = profile.MaxFrameBytes
	config.ConnectTimeout = time.Duration(profile.Timeout.ConnectMS) * time.Millisecond
	config.IOTimeout = time.Duration(profile.Timeout.IOMS) * time.Millisecond
	config.RetryPolicy = contract.RetryPolicy{
		MaxAttempts: profile.Reconnect.MaxAttempts,
		BaseDelayMS: profile.Reconnect.BaseDelayMS,
		MaxDelayMS:  profile.Reconnect.MaxDelayMS,
	}
	return config, config.Validate()
}
