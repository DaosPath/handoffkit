package command

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"time"

	"github.com/DaosPath/handoffkit/go/contract"
	"github.com/DaosPath/handoffkit/go/protocol"
	hkruntime "github.com/DaosPath/handoffkit/go/runtime"
	"github.com/DaosPath/handoffkit/go/transport"
)

func Run(args []string, output io.Writer) error {
	if len(args) < 2 || args[0] != "csp" {
		return errors.New("usage: handoffkit-go csp <doctor|inspect|run|worker|demo>")
	
	
	}
	switch args[1] {
	case "doctor":
		return json.NewEncoder(output).Encode(map[string]any{
			"success": true, "runtime": "go", "protocol_version": contract.ProtocolVersion,
			"transports": []string{"in_process", "stdio_ndjson", "tcp", "unix"},
		})
	case "inspect":
		if len(args) != 3 {
			return errors.New("csp inspect requires an envelope JSON file")
		
		
		}
		data, err := os.ReadFile(args[2])
		if err != nil {
			return err
		
		
		}
		envelope, err := contract.DecodeEnvelope(data)
		if err != nil {
			return err
		
		
		}
		return json.NewEncoder(output).Encode(envelope)
	case "worker":
		stdio, err := transport.NewNDJSON(os.Stdin, os.Stdout, nil, contract.DefaultMaxMessageBytes)
		if err != nil {
			return err
		
		
		}
		return RunWorker(context.Background(), stdio, "go")
	case "run":
		if len(args) < 3 {
			return errors.New("csp run requires a worker program")
		
		
		}
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		child, err := transport.Spawn(ctx, args[2:], contract.DefaultMaxMessageBytes)
		if err != nil {
			return err
		
		
		}
		defer child.Close()
		return runClient(ctx, child, output)
	case "demo":
		config := contract.NewSessionConfig("go-demo")
		session, err := hkruntime.NewSession(context.Background(), config, nil)
		if err != nil {
			return err
		
		
		}
		defer session.Close()
		envelope := session.Envelope("tasks", "data", "go-demo", "json", map[string]any{"task": "Architect -> Coder -> Reviewer -> Tester"})
		if err := session.Send(context.Background(), "tasks", envelope); err != nil {
			return err
		
		
		}
		received, err := session.Receive(context.Background(), "tasks")
		if err != nil {
			return err
		
		
		}
		session.Ack(received, map[string]any{})
		return json.NewEncoder(output).Encode(map[string]any{"success": true, "diagnostics": session.Diagnostics()})
	default:
		return fmt.Errorf("unknown CSP command %q", args[1])
	}
}

func RunWorker(ctx context.Context, wire protocol.EnvelopeTransport, runtimeName string) error {
	handshake, err := protocol.ServerHandshake(ctx, wire, runtimeName, []string{"echo", "request_response", "distributed_worker"})
	if err != nil {
		return err
	
	
	}
	for {
		envelope, err := wire.Receive(ctx)
		if err != nil {
			return err
		
		
		}
		if envelope.SessionID != handshake.SessionConfig.SessionID {
			if err := wire.Send(ctx, protocol.NackFor(envelope, runtimeName, "session_mismatch", "message belongs to another session", false)); err != nil {
				return err
			
			
			}
			continue
		}
		switch envelope.Kind {
		case "data", "request", "workflow_start", "workflow_step", "job_assign":
			payload := envelope.Payload
			if envelope.PayloadType == "handoff_state" {
				payload = map[string]any{"runtime": runtimeName, "handoff_state": envelope.Payload}
			}
			if err := wire.Send(ctx, protocol.ResponseFor(envelope, runtimeName, "result", envelope.PayloadType, payload)); err != nil {
				return err
			
			
			}
		case "heartbeat":
			if err := wire.Send(ctx, protocol.ResponseFor(envelope, runtimeName, "heartbeat_ack", "json", map[string]any{"success": true})); err != nil {
				return err
			}
		case "session_close":
			return wire.Send(ctx, protocol.ResponseFor(envelope, runtimeName, "session_closed", "json", map[string]any{"success": true}))
		case "cancel":
			return wire.Send(ctx, protocol.ResponseFor(envelope, runtimeName, "cancelled", "json", map[string]any{"success": true}))
		default:
			if err := wire.Send(ctx, protocol.NackFor(envelope, runtimeName, "unknown_message_kind", "worker does not support this message kind", false)); err != nil {
				return err
			
			
			}
		}
	}
}

func runClient(ctx context.Context, wire protocol.EnvelopeTransport, output io.Writer) error {
	config := contract.NewSessionConfig("go-cli-run")
	handshake, err := protocol.ClientHandshake(ctx, wire, config, "go-cli", []string{"request_response"})
	if err != nil {
		return err
	
	
	}
	key := "request-1"
	request := contract.MessageEnvelope{
		ProtocolVersion: contract.ProtocolVersion, MessageID: "request-1", SessionID: config.SessionID,
		Channel: "requests", Kind: "request", Source: "go-cli", Sequence: 1,
		CreatedAt: contract.UTCNow(), IdempotencyKey: &key, Attempt: 1,
		PayloadType: "json", Payload: map[string]any{"task": "HK-CSP worker smoke"}, Metadata: map[string]any{},
	}
	if err := wire.Send(ctx, request); err != nil {
		return err
	
	
	}
	response, err := wire.Receive(ctx)
	if err != nil {
		return err
	
	
	}
	if response.CorrelationID == nil || *response.CorrelationID != request.MessageID {
		return errors.New("worker response does not match request")
	
	
	}
	return json.NewEncoder(output).Encode(map[string]any{"handshake": handshake, "response": response})
}
