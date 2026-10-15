"""Generate ephemeral TLS credentials for cross-runtime integration tests."""

from __future__ import annotations

import argparse
import ipaddress
from datetime import datetime, timedelta, timezone
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID


def write_private_key(
    output: Path,
    name: str,
    key: ec.EllipticCurvePrivateKey,
) -> None:
    path = output / f"{name}_key.pem"
    path.write_bytes(
        key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        )
    )
    path.chmod(0o600)


def make_ca(
    output: Path,
    name: str,
    common_name: str,
    valid_from: datetime,
    valid_until: datetime,
) -> tuple[ec.EllipticCurvePrivateKey, x509.Certificate]:
    key = ec.generate_private_key(ec.SECP256R1())
    subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, common_name)])
    certificate = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(subject)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(valid_from)
        .not_valid_after(valid_until)
        .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
        .add_extension(
            x509.KeyUsage(
                digital_signature=True,
                content_commitment=False,
                key_encipherment=False,
                data_encipherment=False,
                key_agreement=False,
                key_cert_sign=True,
                crl_sign=True,
                encipher_only=None,
                decipher_only=None,
            ),
            critical=True,
        )
        .add_extension(
            x509.SubjectKeyIdentifier.from_public_key(key.public_key()), False
        )
        .sign(key, hashes.SHA256())
    )
    (output / f"{name}_cert.pem").write_bytes(
        certificate.public_bytes(serialization.Encoding.PEM)
    )
    return key, certificate


def make_leaf(
    output: Path,
    name: str,
    ca_key: ec.EllipticCurvePrivateKey,
    ca_certificate: x509.Certificate,
    *,
    identity_uri: str,
    server: bool = False,
    client: bool = False,
    dns_names: tuple[str, ...] = (),
    ip_addresses: tuple[str, ...] = (),
    valid_from: datetime,
    valid_until: datetime,
) -> None:
    key = ec.generate_private_key(ec.SECP256R1())
    subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, name)])
    san_values: list[x509.GeneralName] = [x509.UniformResourceIdentifier(identity_uri)]
    san_values.extend(x509.DNSName(value) for value in dns_names)
    san_values.extend(
        x509.IPAddress(ipaddress.ip_address(value)) for value in ip_addresses
    )
    usages = []
    if server:
        usages.append(ExtendedKeyUsageOID.SERVER_AUTH)
    if client:
        usages.append(ExtendedKeyUsageOID.CLIENT_AUTH)
    certificate = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(ca_certificate.subject)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(valid_from)
        .not_valid_after(valid_until)
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        .add_extension(
            x509.KeyUsage(
                digital_signature=True,
                content_commitment=False,
                key_encipherment=False,
                data_encipherment=False,
                key_agreement=True,
                key_cert_sign=False,
                crl_sign=False,
                encipher_only=False,
                decipher_only=False,
            ),
            critical=True,
        )
        .add_extension(x509.ExtendedKeyUsage(usages), critical=False)
        .add_extension(x509.SubjectAlternativeName(san_values), critical=False)
        .add_extension(
            x509.SubjectKeyIdentifier.from_public_key(key.public_key()), False
        )
        .add_extension(
            x509.AuthorityKeyIdentifier.from_issuer_public_key(ca_key.public_key()),
            False,
        )
        .sign(ca_key, hashes.SHA256())
    )
    write_private_key(output, name, key)
    (output / f"{name}_cert.pem").write_bytes(
        certificate.public_bytes(serialization.Encoding.PEM)
    )


def generate(output: Path) -> None:
    now = datetime.now(timezone.utc)
    valid_from = now - timedelta(days=1)
    valid_until = now + timedelta(days=30)
    expired_from = now - timedelta(days=30)
    expired_until = now - timedelta(days=1)

    ca_key, ca_certificate = make_ca(
        output,
        "ca",
        "HandoffKit Test CA",
        valid_from,
        valid_until,
    )
    rogue_key, rogue_certificate = make_ca(
        output,
        "rogue_ca",
        "HandoffKit Rogue Test CA",
        valid_from,
        valid_until,
    )
    next_ca_key, next_ca_certificate = make_ca(
        output,
        "next_ca",
        "HandoffKit Next Test CA",
        valid_from,
        valid_until,
    )

    server_identity = "spiffe://handoffkit.internal/peer/server-peer/node/server-node"
    client_identity = "spiffe://handoffkit.internal/peer/client-peer/node/client-node/worker/client-worker"
    leafs = [
        (
            "server",
            ca_key,
            ca_certificate,
            server_identity,
            True,
            False,
            ("localhost",),
            ("127.0.0.1", "::1"),
            valid_from,
            valid_until,
        ),
        (
            "wrong_host_server",
            ca_key,
            ca_certificate,
            server_identity,
            True,
            False,
            ("wrong.example",),
            (),
            valid_from,
            valid_until,
        ),
        (
            "expired_server",
            ca_key,
            ca_certificate,
            server_identity,
            True,
            False,
            ("localhost",),
            (),
            expired_from,
            expired_until,
        ),
        (
            "rogue_server",
            rogue_key,
            rogue_certificate,
            "spiffe://rogue.invalid/peer/rogue-peer/node/rogue-node",
            True,
            False,
            ("localhost",),
            ("127.0.0.1",),
            valid_from,
            valid_until,
        ),
        (
            "client",
            ca_key,
            ca_certificate,
            client_identity,
            False,
            True,
            (),
            (),
            valid_from,
            valid_until,
        ),
        (
            "client_rotated",
            ca_key,
            ca_certificate,
            client_identity,
            False,
            True,
            (),
            (),
            valid_from,
            valid_until,
        ),
        (
            "server_rotated",
            ca_key,
            ca_certificate,
            server_identity,
            True,
            False,
            ("localhost",),
            ("127.0.0.1", "::1"),
            valid_from,
            valid_until,
        ),
        (
            "next_client",
            next_ca_key,
            next_ca_certificate,
            client_identity,
            False,
            True,
            (),
            (),
            valid_from,
            valid_until,
        ),
        (
            "next_server",
            next_ca_key,
            next_ca_certificate,
            server_identity,
            True,
            False,
            ("localhost",),
            ("127.0.0.1", "::1"),
            valid_from,
            valid_until,
        ),
        (
            "revoked_client",
            ca_key,
            ca_certificate,
            "spiffe://handoffkit.internal/peer/revoked-peer/node/revoked-node/worker/revoked-worker",
            False,
            True,
            (),
            (),
            valid_from,
            valid_until,
        ),
    ]
    for (
        name,
        issuer_key,
        issuer_certificate,
        identity_uri,
        server,
        client,
        dns_names,
        ip_addresses,
        starts,
        ends,
    ) in leafs:
        make_leaf(
            output,
            name,
            issuer_key,
            issuer_certificate,
            identity_uri=identity_uri,
            server=server,
            client=client,
            dns_names=dns_names,
            ip_addresses=ip_addresses,
            valid_from=starts,
            valid_until=ends,
        )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    arguments = parser.parse_args()
    output = arguments.output.resolve()
    repository = Path(__file__).resolve().parents[4]
    if output == repository or repository in output.parents:
        parser.error("TLS credentials must be generated outside the repository")
    output.mkdir(parents=True, exist_ok=True)
    generate(output)


if __name__ == "__main__":
    main()
