//go:build !windows

package security

import "os"

func atomicReplace(source, target string) error {
	return os.Rename(source, target)
}
