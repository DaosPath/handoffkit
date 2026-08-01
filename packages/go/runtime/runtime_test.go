package runtime

import (
	"context"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/DaosPath/handoffkit/go/contract"
)

func envelope(sessionID string, sequence uint64) contract.MessageEnvelope {
	key := "key-" + time.Unix(int64(sequence), 0).String()
	return contract.MessageEnvelope{
		ProtocolVersion: contract.ProtocolVersion, MessageID: key, SessionID: sessionID,
		Channel: "tasks", Kind: "data", Source: "test", Sequence: sequence,
		CreatedAt: "2026-01-01T00:00:00Z", IdempotencyKey: &key, Attempt: 1,
		PayloadType: "json", Payload: map[string]any{"sequence": sequence}, Metadata: map[string]any{},
	}
}

func TestChannelFIFOBackpressureAndClose(t *testing.T) {
	channel, err := NewChannel(contract.ChannelConfig{Name: "tasks", Capacity: 1, OverflowPolicy: contract.OverflowBlock, Metadata: map[string]any{}}, 4096)
	if err != nil {
		t.Fatal(err)
	}
	if err := channel.Send(context.Background(), envelope("session", 1)); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	if err := channel.Send(ctx, envelope("session", 2)); err == nil {
		t.Fatal("blocked send did not honor cancellation")
	}
	first, err := channel.Receive(context.Background())
	if err != nil || first.Sequence != 1 {
		t.Fatalf("FIFO failed: %#v %v", first, err)
	}
	channel.Close()
	channel.Close()
	if err := channel.Send(context.Background(), envelope("session", 3)); err == nil {
		t.Fatal("send after close succeeded")
	}
}

func TestSessionDedupACKAndRetryRelease(t *testing.T) {
	config := contract.NewSessionConfig("session")
	session, err := NewSession(context.Background(), config, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()
	message := envelope("session", 1)
	if err := session.Send(context.Background(), "tasks", message); err != nil {
		t.Fatal(err)
	}
	received, err := session.Receive(context.Background(), "tasks")
	if err != nil {
		t.Fatal(err)
	}
	ack := session.Ack(received, map[string]any{})
	if ack.MessageID != message.MessageID {
		t.Fatal("ACK confirmed another message")
	}
	if err := session.Send(context.Background(), "tasks", message); err != nil {
		t.Fatal(err)
	}
	unique := envelope("session", 2)
	if err := session.Send(context.Background(), "tasks", unique); err != nil {
		t.Fatal(err)
	}
	received, err = session.Receive(context.Background(), "tasks")
	if err != nil || received.MessageID != unique.MessageID {
		t.Fatal("duplicate was executed")
	}
	if _, err := session.Nack(received, "retry", "retry safely", true, map[string]any{}); err != nil {
		t.Fatal(err)
	}
	if err := session.Send(context.Background(), "tasks", unique); err != nil {
		t.Fatal(err)
	}
	if _, err := session.Receive(context.Background(), "tasks"); err != nil {
		t.Fatal(err)
	}
}

func TestFileDedupPersists(t *testing.T) {
	path := filepath.Join(t.TempDir(), "dedup.ndjson")
	first, err := NewFileDedupStore(path, 16, 1024*1024)
	if err != nil {
		t.Fatal(err)
	}
	if fresh, err := first.Claim("key"); err != nil || !fresh {
		t.Fatal("first claim failed", err)
	}
	second, err := NewFileDedupStore(path, 16, 1024*1024)
	if err != nil || !second.Contains("key") {
		t.Fatal("claim did not persist", err)
	}
	if released, err := second.Release("key"); err != nil || !released {
		t.Fatal("release failed", err)
	}
}

func TestConcurrentSmoke(t *testing.T) {
	config := contract.NewSessionConfig("stress")
	config.ChannelCapacity = 1
	session, err := NewSession(context.Background(), config, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()
	const messages = 512
	var producers sync.WaitGroup
	for sequence := 0; sequence < messages; sequence++ {
		producers.Add(1)
		go func(sequence int) {
			defer producers.Done()
			if err := session.Send(context.Background(), "tasks", envelope("stress", uint64(sequence+1))); err != nil {
				t.Error(err)
			}
		}(sequence)
	}
	seen := map[string]struct{}{}
	for len(seen) < messages {
		value, err := session.Receive(context.Background(), "tasks")
		if err != nil {
			t.Fatal(err)
		}
		seen[value.MessageID] = struct{}{}
		session.Ack(value, map[string]any{})
	}
	producers.Wait()
	if len(seen) != messages {
		t.Fatalf("lost messages: %d", len(seen))
	}
}

func TestConcurrentDuplicateClaimExecutesOnce(t *testing.T) {
	config := contract.NewSessionConfig("duplicate-stress")
	config.ChannelCapacity = 64
	session, err := NewSession(context.Background(), config, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()
	const duplicates = 32
	message := envelope("duplicate-stress", 1)
	for index := 0; index < duplicates; index++ {
		copy := message
		copy.MessageID = message.MessageID + "-" + time.Unix(int64(index), 0).String()
		if err := session.Send(context.Background(), "tasks", copy); err != nil {
			t.Fatal(err)
		}
	}
	unique := envelope("duplicate-stress", 2)
	if err := session.Send(context.Background(), "tasks", unique); err != nil {
		t.Fatal(err)
	}
	first, err := session.Receive(context.Background(), "tasks")
	if err != nil {
		t.Fatal(err)
	}
	second, err := session.Receive(context.Background(), "tasks")
	if err != nil {
		t.Fatal(err)
	}
	if first.MessageID != message.MessageID+"-"+time.Unix(0, 0).String() || second.MessageID != unique.MessageID {
		t.Fatalf("deduplication delivered unexpected messages: %s, %s", first.MessageID, second.MessageID)
	}
}

func TestConcurrentEnvelopeSequencesAreUnique(t *testing.T) {
	session, err := NewSession(context.Background(), contract.NewSessionConfig("sequences"), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()
	const count = 256
	values := make(chan uint64, count)
	var workers sync.WaitGroup
	for index := 0; index < count; index++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			values <- session.Envelope("tasks", "data", "test", "json", map[string]any{}).Sequence
		}()
	}
	workers.Wait()
	close(values)
	seen := map[uint64]struct{}{}
	for value := range values {
		seen[value] = struct{}{}
	}
	if len(seen) != count {
		t.Fatalf("sequence collision: got %d unique values", len(seen))
	}
}
