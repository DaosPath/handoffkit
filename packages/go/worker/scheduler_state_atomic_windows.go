//go:build windows

package worker

import (
	"fmt"
	"os"
	"path/filepath"
	"syscall"
	"unsafe"
)

var schedulerStateMoveFileExW = syscall.NewLazyDLL("kernel32.dll").NewProc("MoveFileExW")

const (
	schedulerStateMoveReplaceExisting = 0x1
	schedulerStateMoveWriteThrough    = 0x8
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
	source, err := syscall.UTF16PtrFromString(temporaryPath)
	if err != nil {
		return false, err
	}
	target, err := syscall.UTF16PtrFromString(path)
	if err != nil {
		return false, err
	}
	result, _, callError := schedulerStateMoveFileExW.Call(
		uintptr(unsafe.Pointer(source)),
		uintptr(unsafe.Pointer(target)),
		schedulerStateMoveReplaceExisting|schedulerStateMoveWriteThrough,
	)
	if result == 0 {
		return false, fmt.Errorf("MoveFileExW: %w", callError)
	}
	return true, nil
}
