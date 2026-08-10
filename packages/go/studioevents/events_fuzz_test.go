package studioevents

import "testing"

func FuzzStudioEventParser(f *testing.F) {
	f.Add(sharedFixture(f))
	f.Add([]byte("{truncated\n"))
	f.Fuzz(func(t *testing.T, data []byte) {
		if len(data) > 256*1024 {
			return
		}
		_, _ = ParseNDJSON(data)
	})
}
