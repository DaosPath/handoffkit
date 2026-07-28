# handoffkit-transport

Experimental HK-CSP 1.0 transports for Rust. Includes bounded NDJSON framing,
stdin/stdout peers, local subprocess workers, protocol negotiation, and safe
shutdown. Protocol data uses stdout exclusively; worker logs belong on stderr.

Unix sockets, TCP, and distributed routing are intentionally deferred to 1.18.
