package runtime

import (
	"fmt"

	"github.com/DaosPath/handoffkit/go/contract"
)

type Error struct {
	Code      string
	Message   string
	Retryable bool
}

func (e *Error) Error() string { return fmt.Sprintf("%s: %s", e.Code, e.Message) }

func runtimeError(code, message string, retryable bool) *Error {
	return &Error{Code: code, Message: contract.SanitizeError(message), Retryable: retryable}
}
