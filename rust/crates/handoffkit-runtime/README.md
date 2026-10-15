# handoffkit-runtime

Experimental Tokio runtime for HK-CSP 1.0. It provides bounded FIFO channels,
session lifecycle, cancellation, deadlines, ACK/NACK delivery, retries,
deduplication, local processes, and session-mode Agent/Team/Recipe execution.

This crate is independent from Python and does not include network transports.
