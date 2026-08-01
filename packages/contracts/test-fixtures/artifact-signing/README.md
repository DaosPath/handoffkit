# Public artifact-signing test vector

`vector.json` contains one fixed signature and its public key so every runtime
can verify the same canonical payload. No private key is stored.

`generate.py` creates a fresh ephemeral key in memory, writes only public
verification material, and exits. Runtime sign/verify tests generate separate
ephemeral keys during each test process.
