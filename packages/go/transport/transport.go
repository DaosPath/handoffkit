package transport

import (
	"bufio"
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"net"
	"os/exec"
	"sync"
	"sync/atomic"
	"time"

	"github.com/DaosPath/handoffkit/go/contract"
)

type Config struct {
	MaxMessageBytes int
	ConnectTimeout  time.Duration
	IOTimeout       time.Duration
	RetryPolicy     contract.RetryPolicy
}

func DefaultConfig() Config {
	return Config{
		MaxMessageBytes: contract.DefaultMaxMessageBytes,
		ConnectTimeout: 5 * time.Second,
		IOTimeout: 30 * time.Second,
		RetryPolicy: contract.DefaultRetryPolicy(),
	}
}

func (c Config) Validate() error {
	if c.MaxMessageBytes < contract.MinMessageBytes || c.MaxMessageBytes > contract.DefaultMaxMessageBytes {
		return errors.New("max message bytes is outside protocol limits")
	}
	if c.ConnectTimeout <= 0 || c.IOTimeout <= 0 {
		return errors.New("network timeouts must be positive")
	}
	return c.RetryPolicy.Validate()
}

type NDJSON struct {
	reader *bufio.Reader
	writer io.Writer
	closer io.Closer
	max    int
	sendMu sync.Mutex
	recvMu sync.Mutex
	closed atomic.Bool
}

func NewNDJSON(reader io.Reader, writer io.Writer, closer io.Closer, maxMessageBytes int) (*NDJSON, error) {
	if maxMessageBytes < contract.MinMessageBytes || maxMessageBytes > contract.DefaultMaxMessageBytes {
		return nil, errors.New("max message bytes is outside protocol limits")
	}
	return &NDJSON{reader: bufio.NewReaderSize(reader, 64*1024), writer: writer, closer: closer, max: maxMessageBytes}, nil
}

func (t *NDJSON) Send(ctx context.Context, envelope contract.MessageEnvelope) error {
	if t.closed.Load() {
		return errors.New("transport is closed")
	}
	data, err := envelope.Encode()
	if err != nil {
		return err
	}
	data = append(data, '\n')
	if len(data) > t.max {
		return fmt.Errorf("NDJSON frame exceeds %d bytes", t.max)
	}
	t.sendMu.Lock()
	defer t.sendMu.Unlock()
	select {
	case <-ctx.Done():
		return ctx.Err()
	default:
	}
	for len(data) > 0 {
		written, writeErr := t.writer.Write(data)
		if writeErr != nil {
			return writeErr
		}
		if written == 0 {
			return io.ErrShortWrite
		}
		data = data[written:]
	}
	return nil
}

func (t *NDJSON) Receive(ctx context.Context) (contract.MessageEnvelope, error) {
	if t.closed.Load() {
		return contract.MessageEnvelope{}, errors.New("transport is closed")
	}
	t.recvMu.Lock()
	defer t.recvMu.Unlock()
	select {
	case <-ctx.Done():
		return contract.MessageEnvelope{}, ctx.Err()
	default:
	}
	data, err := readLineBounded(t.reader, t.max)
	if err != nil {
		return contract.MessageEnvelope{}, err
	}
	return contract.DecodeEnvelope(data)
}

func (t *NDJSON) Close() error {
	if !t.closed.CompareAndSwap(false, true) || t.closer == nil {
		return nil
	}
	return t.closer.Close()
}

type LengthDelimited struct {
	connection net.Conn
	config     Config
	sendMu     sync.Mutex
	recvMu     sync.Mutex
	closed     atomic.Bool
}

func NewLengthDelimited(connection net.Conn, config Config) (*LengthDelimited, error) {
	if err := config.Validate(); err != nil {
		return nil, err
	}
	return &LengthDelimited{connection: connection, config: config}, nil
}

func (t *LengthDelimited) Send(ctx context.Context, envelope contract.MessageEnvelope) error {
	if t.closed.Load() {
		return errors.New("transport is closed")
	}
	payload, err := envelope.Encode()
	if err != nil {
		return err
	}
	if len(payload) > t.config.MaxMessageBytes {
		return fmt.Errorf("network frame exceeds %d bytes", t.config.MaxMessageBytes)
	}
	frame := make([]byte, 4+len(payload))
	binary.BigEndian.PutUint32(frame[:4], uint32(len(payload)))
	copy(frame[4:], payload)
	t.sendMu.Lock()
	defer t.sendMu.Unlock()
	return t.writeContext(ctx, frame)
}

func (t *LengthDelimited) Receive(ctx context.Context) (contract.MessageEnvelope, error) {
	if t.closed.Load() {
		return contract.MessageEnvelope{}, errors.New("transport is closed")
	}
	t.recvMu.Lock()
	defer t.recvMu.Unlock()
	header := make([]byte, 4)
	if err := t.readContext(ctx, header); err != nil {
		return contract.MessageEnvelope{}, err
	}
	size := int(binary.BigEndian.Uint32(header))
	if size > t.config.MaxMessageBytes {
		return contract.MessageEnvelope{}, fmt.Errorf("network frame exceeds %d bytes", t.config.MaxMessageBytes)
	}
	payload := make([]byte, size)
	if err := t.readContext(ctx, payload); err != nil {
		return contract.MessageEnvelope{}, err
	}
	return contract.DecodeEnvelope(payload)
}

func (t *LengthDelimited) writeContext(ctx context.Context, payload []byte) error {
	deadline := time.Now().Add(t.config.IOTimeout)
	if contextDeadline, ok := ctx.Deadline(); ok && contextDeadline.Before(deadline) {
		deadline = contextDeadline
	}
	if err := t.connection.SetWriteDeadline(deadline); err != nil {
		return err
	}
	for len(payload) > 0 {
		written, err := t.connection.Write(payload)
		if err != nil {
			return err
		}
		payload = payload[written:]
	}
	return nil
}

func (t *LengthDelimited) readContext(ctx context.Context, payload []byte) error {
	deadline := time.Now().Add(t.config.IOTimeout)
	if contextDeadline, ok := ctx.Deadline(); ok && contextDeadline.Before(deadline) {
		deadline = contextDeadline
	}
	if err := t.connection.SetReadDeadline(deadline); err != nil {
		return err
	}
	_, err := io.ReadFull(t.connection, payload)
	return err
}

func (t *LengthDelimited) Close() error {
	if !t.closed.CompareAndSwap(false, true) {
		return nil
	}
	return t.connection.Close()
}

func DialTCP(ctx context.Context, address string, config Config) (*LengthDelimited, error) {
	return dial(ctx, "tcp", address, config)
}

func DialUnix(ctx context.Context, path string, config Config) (*LengthDelimited, error) {
	return dial(ctx, "unix", path, config)
}

func DialTCPWithRetry(ctx context.Context, address string, config Config) (*LengthDelimited, error) {
	if err := config.Validate(); err != nil {
		return nil, err
	}
	var last error
	for attempt := 1; attempt <= config.RetryPolicy.MaxAttempts; attempt++ {
		transport, err := DialTCP(ctx, address, config)
		if err == nil {
			return transport, nil
		}
		last = err
		if attempt == config.RetryPolicy.MaxAttempts {
			break
		}
		delay := config.RetryPolicy.BaseDelayMS << (attempt - 1)
		if delay > config.RetryPolicy.MaxDelayMS {
			delay = config.RetryPolicy.MaxDelayMS
		}
		timer := time.NewTimer(time.Duration(delay) * time.Millisecond)
		select {
		case <-ctx.Done():
			timer.Stop()
			return nil, ctx.Err()
		case <-timer.C:
		}
	}
	return nil, fmt.Errorf("TCP connection failed after retries: %s", contract.SanitizeError(last.Error()))
}

func dial(ctx context.Context, network, address string, config Config) (*LengthDelimited, error) {
	if err := config.Validate(); err != nil {
		return nil, err
	}
	dialer := net.Dialer{Timeout: config.ConnectTimeout}
	connection, err := dialer.DialContext(ctx, network, address)
	if err != nil {
		return nil, err
	}
	transport, err := NewLengthDelimited(connection, config)
	if err != nil {
		_ = connection.Close()
		return nil, err
	}
	return transport, nil
}

type Subprocess struct {
	*NDJSON
	command *exec.Cmd
	stdin   io.WriteCloser
}

func Spawn(ctx context.Context, argv []string, maxMessageBytes int) (*Subprocess, error) {
	if len(argv) == 0 {
		return nil, errors.New("argv must not be empty")
	}
	command := exec.CommandContext(ctx, argv[0], argv[1:]...)
	stdin, err := command.StdinPipe()
	if err != nil {
		return nil, err
	}
	stdout, err := command.StdoutPipe()
	if err != nil {
		return nil, err
	}
	command.Stderr = io.Discard
	if err := command.Start(); err != nil {
		return nil, err
	}
	ndjson, err := NewNDJSON(stdout, stdin, stdin, maxMessageBytes)
	if err != nil {
		_ = command.Process.Kill()
		return nil, err
	}
	return &Subprocess{NDJSON: ndjson, command: command, stdin: stdin}, nil
}

func (s *Subprocess) Close() error {
	_ = s.NDJSON.Close()
	done := make(chan error, 1)
	go func() { done <- s.command.Wait() }()
	select {
	case <-time.After(2 * time.Second):
		_ = s.command.Process.Kill()
		<-done
		return nil
	case err := <-done:
		return err
	}
}

func readLineBounded(reader *bufio.Reader, maximum int) ([]byte, error) {
	line := make([]byte, 0, min(maximum, 64*1024))
	for {
		chunk, err := reader.ReadSlice('\n')
		if len(line)+len(chunk) > maximum {
			return nil, fmt.Errorf("NDJSON frame exceeds %d bytes", maximum)
		}
		line = append(line, chunk...)
		if err == nil {
			line = line[:len(line)-1]
			if len(line) > 0 && line[len(line)-1] == '\r' {
				line = line[:len(line)-1]
			}
			if len(line) == 0 {
				continue
			}
			return line, nil
		}
		if errors.Is(err, bufio.ErrBufferFull) {
			continue
		}
		if errors.Is(err, io.EOF) {
			return nil, io.EOF
		}
		return nil, err
	}
}
