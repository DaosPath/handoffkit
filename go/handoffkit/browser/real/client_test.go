package real

import "testing"

func TestClientRequiresDispatch(t *testing.T) {
	client := &Client{Dispatch: func(command map[string]any) (map[string]any, error) {
		return map[string]any{"name": "echo", "payload": command}, nil
	}}
	got, err := client.Send(map[string]any{"name": "navigate"})
	if err != nil {
		t.Fatal(err)
	}
	if got["name"] != "echo" {
		t.Fatalf("got %#v", got)
	}
}
