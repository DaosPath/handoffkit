// Package testsupport provides private, test-only fixture orchestration.
package testsupport

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

// GenerateTLSFixtures creates fresh credentials outside the repository.
func GenerateTLSFixtures() (string, func(), error) {
	_, source, _, ok := runtime.Caller(0)
	if !ok {
		return "", nil, fmt.Errorf("cannot locate TLS fixture generator")
	}
	generator := filepath.Clean(filepath.Join(
		filepath.Dir(source), "..", "..", "..", "..", "shared", "contracts", "test-fixtures", "tls", "generate.py",
	))
	directory, err := os.MkdirTemp("", "handoffkit-go-tls-")
	if err != nil {
		return "", nil, err
	}
	cleanup := func() {
		if filepath.Dir(directory) == os.TempDir() && strings.HasPrefix(filepath.Base(directory), "handoffkit-go-tls-") {
			_ = os.RemoveAll(directory)
		}
	}
	candidates := []string{os.Getenv("HANDOFFKIT_PYTHON_BIN")}
	if runtime.GOOS == "windows" {
		candidates = append(candidates, "python")
	} else {
		candidates = append(candidates, "python3", "python")
	}
	var last error
	for _, candidate := range candidates {
		if candidate == "" {
			continue
		}
		path, lookupErr := exec.LookPath(candidate)
		if lookupErr != nil {
			last = lookupErr
			continue
		}
		command := exec.Command(path, generator, "--output", directory)
		if output, runErr := command.CombinedOutput(); runErr != nil {
			cleanup()
			return "", nil, fmt.Errorf("TLS fixture generation failed: %w: %s", runErr, output)
		}
		return directory, cleanup, nil
	}
	cleanup()
	return "", nil, fmt.Errorf("no Python interpreter could generate TLS fixtures: %w", last)
}
