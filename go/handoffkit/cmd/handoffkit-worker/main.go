package main

import (
	"context"
	"fmt"
	"os"

	"github.com/DaosPath/handoffkit/go/contract"
	"github.com/DaosPath/handoffkit/go/internal/command"
	"github.com/DaosPath/handoffkit/go/transport"
)

func main() {
	wire, err := transport.NewNDJSON(os.Stdin, os.Stdout, nil, contract.DefaultMaxMessageBytes)
	if err == nil {
		err = command.RunWorker(context.Background(), wire, "go")
	}
	if err != nil {
		fmt.Fprintf(os.Stderr, "handoffkit-worker: %s\n", err)
		os.Exit(1)
	}
}
