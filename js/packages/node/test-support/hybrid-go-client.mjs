import { resolve } from "node:path";
import tls from "node:tls";

import { SecurityConfig, SecurityProfile } from "../../csp/src/index.js";
import { buildTlsOptions, detectHybridPqSupport } from "../src/security.js";

const [address, fixtureDirectory] = process.argv.slice(2);
if (!address || !fixtureDirectory) {
  throw new Error("usage: hybrid-go-client.mjs host:port fixture-directory");
}
if (!detectHybridPqSupport()) {
  throw new Error("active Node provider does not expose X25519MLKEM768");
}

const separator = address.lastIndexOf(":");
const host = address.slice(0, separator);
const port = Number(address.slice(separator + 1));
const fixture = (name) => resolve(fixtureDirectory, name);
const config = new SecurityConfig({
  profile: SecurityProfile.HYBRID_PQ,
  requireMtls: true,
  trustDomain: "handoffkit.internal",
  caCertPath: fixture("ca_cert.pem"),
  certPath: fixture("client_cert.pem"),
  keyPath: fixture("client_key.pem"),
});

const socket = tls.connect({
  ...buildTlsOptions(config, false, { servername: "localhost" }),
  host,
  port,
  servername: "localhost",
});
socket.setTimeout(5_000);

socket.once("secureConnect", () => {
  process.stdout.write(`${JSON.stringify({
    authorized: socket.authorized,
    protocol: socket.getProtocol(),
    provider: `OpenSSL ${process.versions.openssl}`,
  })}\n`);
  socket.end();
});
socket.once("timeout", () => socket.destroy(new Error("TLS handshake timed out")));
socket.once("error", (error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
