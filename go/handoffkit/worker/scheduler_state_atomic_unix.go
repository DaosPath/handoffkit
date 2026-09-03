//go:build !windows

package worker

import (
	"os"
	"path/filepath"
)

func atomicWriteSchedulerState(path string, data []byte, mode os.FileMode) (bool, error) {
	parent := filepath.Dir(path)
	temporary, err := os.CreateTemp(parent, ".scheduler-state-*")
	if err != nil {
		return false, err
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(mode); err != nil {
		temporary.Close()
		return false, err
	}
	if _, err := temporary.Write(data); err != nil {
		temporary.Close()
		return false, err
	}
	if err := temporary.Sync(); err != nil {
		temporary.Close()
		return false, err
	}
	if err := temporary.Close(); err != nil {
		return false, err
	}
	if err := os.Rename(temporaryPath, path); err != nil {
		return false, err
	}
	directory, err := os.Open(parent)
	if err != nil {
		return true, err
	}
	defer directory.Close()
	if err := directory.Sync(); err != nil {
		return true, err
	}
	return true, nil
}
