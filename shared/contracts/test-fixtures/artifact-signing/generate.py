"""Regenerate the public Ed25519 interoperability vector with an ephemeral key."""

from __future__ import annotations

import base64
import hashlib
import json
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

ROOT = Path(__file__).resolve().parent
DATA = b"handoffkit signed artifact\n"
IDENTITY = "spiffe://handoffkit.internal/producer/build-1"
CREATED_AT = 1_800_000_000


def main() -> None:
    private_key = Ed25519PrivateKey.generate()
    public_key = private_key.public_key()
    public_key_pem = public_key.public_bytes(
        serialization.Encoding.PEM,
        serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode("ascii")
    fingerprint = (
        "sha256:"
        + hashlib.sha256(
            public_key.public_bytes(
                serialization.Encoding.Raw,
                serialization.PublicFormat.Raw,
            )
        ).hexdigest()
    )
    unsigned = {
        "algorithm": "ed25519",
        "artifact_id": "artifact-1",
        "content_hash": hashlib.sha256(DATA).hexdigest(),
        "created_at": CREATED_AT,
        "key_fingerprint": fingerprint,
        "signer_identity": IDENTITY,
    }
    canonical = json.dumps(
        unsigned,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    vector = {
        "data_base64": base64.b64encode(DATA).decode("ascii"),
        "public_key_pem": public_key_pem,
        "canonical_payload": canonical.decode("utf-8"),
        "signed_artifact": {
            "artifact_id": unsigned["artifact_id"],
            "content_hash": unsigned["content_hash"],
            "signature": base64.b64encode(private_key.sign(canonical)).decode("ascii"),
            "algorithm": unsigned["algorithm"],
            "signer_identity": unsigned["signer_identity"],
            "key_fingerprint": unsigned["key_fingerprint"],
            "created_at": unsigned["created_at"],
        },
    }
    (ROOT / "vector.json").write_text(
        json.dumps(vector, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
