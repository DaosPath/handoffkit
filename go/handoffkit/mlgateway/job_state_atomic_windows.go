//go:build windows

package mlgateway

import (
	"os"
	"path/filepath"
	"syscall"
	"unsafe"
)

var (
	jobStateKernel32     = syscall.NewLazyDLL("kernel32.dll")
	jobStateReplaceFileW = jobStateKernel32.NewProc("ReplaceFileW")
	jobStateMoveFileExW  = jobStateKernel32.NewProc("MoveFileExW")
)

const (
	jobStateReplaceWriteThrough = 0x00000001
	jobStateMoveReplaceExisting = 0x00000001
	jobStateMoveWriteThrough    = 0x00000008
)

func atomicWriteJobState(path string, data []byte, mode os.FileMode) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	file, err := os.CreateTemp(filepath.Dir(path), ".handoffkit-job-state-*.tmp")
	if err != nil {
		return err
	}
	temporary := file.Name()
	committed := false
	defer func() {
		_ = file.Close()
		if !committed {
			_ = os.Remove(temporary)
		}
	}()
	if err := file.Chmod(mode); err != nil {
		return err
	}
	if _, err := file.Write(data); err != nil {
		return err
	}
	if err := file.Sync(); err != nil {
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	temporaryUTF16, err := syscall.UTF16PtrFromString(temporary)
	if err != nil {
		return err
	}
	pathUTF16, err := syscall.UTF16PtrFromString(path)
	if err != nil {
		return err
	}
	if _, statErr := os.Stat(path); statErr == nil {
		result, _, callErr := jobStateReplaceFileW.Call(
			uintptr(unsafe.Pointer(pathUTF16)), uintptr(unsafe.Pointer(temporaryUTF16)), 0,
			jobStateReplaceWriteThrough, 0, 0,
		)
		if result == 0 {
			return callErr
		}
	} else if os.IsNotExist(statErr) {
		result, _, callErr := jobStateMoveFileExW.Call(
			uintptr(unsafe.Pointer(temporaryUTF16)), uintptr(unsafe.Pointer(pathUTF16)),
			jobStateMoveReplaceExisting|jobStateMoveWriteThrough,
		)
		if result == 0 {
			return callErr
		}
	} else {
		return statErr
	}
	committed = true
	return nil
}
