package studioevents

import (
	"bytes"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sync"
	"time"
)

type Sink interface {
	Emit(Event) error
}

type FileOptions struct {
	MaxEvents    int
	MaxFileBytes int64
}

func DefaultFileOptions() FileOptions {
	return FileOptions{MaxEvents: 10_000, MaxFileBytes: 4 * 1024 * 1024}
}

type FileSink struct {
	mu      sync.Mutex
	path    string
	options FileOptions
}

func NewFileSink(path string, options FileOptions) (*FileSink, error) {
	if path == "" || options.MaxEvents < 1 || options.MaxFileBytes < 1024 {
		return nil, errors.New("studio event file options are invalid")
	}
	return &FileSink{path: filepath.Clean(path), options: options}, nil
}

func (sink *FileSink) Emit(event Event) error {
	if err := event.Validate(); err != nil {
		return err
	}

	sink.mu.Lock()
	defer sink.mu.Unlock()
	if err := os.MkdirAll(filepath.Dir(sink.path), 0o700); err != nil {
		return err
	}
	if metadata, err := os.Lstat(sink.path); err == nil {
		if !metadata.Mode().IsRegular() || metadata.Mode()&os.ModeSymlink != 0 {
			return errors.New("studio event target must be a regular file")
		}
		if runtime.GOOS != "windows" && metadata.Mode().Perm()&0o022 != 0 {
			return errors.New("studio event target permissions are unsafe")
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}

	current, err := os.ReadFile(sink.path)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	events, err := ParseNDJSON(current)
	if err != nil {
		return fmt.Errorf("existing studio event state is invalid: %w", err)
	}
	observedAt := time.Now().UTC()
	if len(events) > 0 {
		previous, _ := time.Parse(time.RFC3339Nano, events[len(events)-1].ObservedAt)
		if !observedAt.After(previous) {
			observedAt = previous.Add(time.Nanosecond)
		}
	}
	event.ObservedAt = observedAt.Format(time.RFC3339Nano)
	encoded, err := jsonLine(event)
	if err != nil {
		return err
	}
	if int64(len(encoded)) > sink.options.MaxFileBytes {
		return errors.New("studio event exceeds the complete file limit")
	}
	events = append(events, event)
	for len(events) > sink.options.MaxEvents {
		events = events[1:]
	}
	payload, err := encodeEvents(events)
	if err != nil {
		return err
	}
	for int64(len(payload)) > sink.options.MaxFileBytes && len(events) > 1 {
		events = events[1:]
		payload, err = encodeEvents(events)
		if err != nil {
			return err
		}
	}
	if int64(len(payload)) > sink.options.MaxFileBytes {
		return errors.New("studio event state exceeds its file limit")
	}
	return writeAtomicPrivate(sink.path, payload)
}

func jsonLine(event Event) ([]byte, error) {
	line, err := jsonMarshal(event)
	if err != nil {
		return nil, err
	}
	if len(line) > MaxLineBytes {
		return nil, errors.New("studio event line exceeds its limit")
	}
	return append(line, '\n'), nil
}

func encodeEvents(events []Event) ([]byte, error) {
	var payload bytes.Buffer
	for _, event := range events {
		line, err := jsonLine(event)
		if err != nil {
			return nil, err
		}
		payload.Write(line)
	}
	return payload.Bytes(), nil
}

func writeAtomicPrivate(path string, payload []byte) error {
	temporary, err := os.CreateTemp(filepath.Dir(path), ".studio-events-*.tmp")
	if err != nil {
		return err
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0o600); err != nil {
		temporary.Close()
		return err
	}
	if _, err := temporary.Write(payload); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Sync(); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	return atomicReplace(temporaryPath, path)
}
