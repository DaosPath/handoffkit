package main

import (
	"fmt"
	"os"

	"github.com/DaosPath/handoffkit/go/internal/command"
)

func main() {
	if err := command.Run(os.Args[1:], os.Stdout); err != nil {
		fmt.Fprintf(os.Stderr, "handoffkit-go: %s\n", err)
		os.Exit(1)
	}
}
