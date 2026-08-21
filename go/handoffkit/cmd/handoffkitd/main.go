package main

import (
	"context"
	"fmt"
	"net"
	"os"

	"github.com/DaosPath/handoffkit/go/internal/command"
	"github.com/DaosPath/handoffkit/go/transport"
)

func main() {
	address := os.Getenv("HANDOFFKIT_LISTEN")
	if address == "" {
		address = "127.0.0.1:7380"
	}
	listener, err := net.Listen("tcp", address)
	if err != nil {
		fmt.Fprintf(os.Stderr, "handoffkitd: %s\n", err)
		os.Exit(1)
	}
	defer listener.Close()
	for {
		connection, acceptErr := listener.Accept()
		if acceptErr != nil {
			fmt.Fprintf(os.Stderr, "handoffkitd: %s\n", acceptErr)
			return
		}
		go func() {
			wire, wrapErr := transport.NewLengthDelimited(connection, transport.DefaultConfig())
			if wrapErr == nil {
				wrapErr = command.RunWorker(context.Background(), wire, "go")
			}
			if wrapErr != nil {
				fmt.Fprintf(os.Stderr, "handoffkitd worker: %s\n", wrapErr)
			}
			_ = connection.Close()
		}()
	}
}
