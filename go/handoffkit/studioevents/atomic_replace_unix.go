//go:build !windows

package studioevents

import "os"

func atomicReplace(source, target string) error {
	return os.Rename(source, target)
}
