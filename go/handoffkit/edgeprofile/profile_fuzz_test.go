package edgeprofile

import (
	"bytes"
	"encoding/json"
	"testing"
)

func FuzzEdgeProfileJSON(f *testing.F) {
	profile, _ := Preset(EdgeSmall)
	seed, _ := json.Marshal(profile)
	f.Add(seed)
	f.Add([]byte(`{"name":"edge-small","security_profile":"local"}`))
	f.Fuzz(func(t *testing.T, data []byte) {
		if len(data) > 64*1024 {
			return
		}
		decoder := json.NewDecoder(bytes.NewReader(data))
		decoder.DisallowUnknownFields()
		var profile Profile
		if decoder.Decode(&profile) == nil {
			_ = profile.Validate()
		}
	})
}
