import assert from "node:assert/strict";
import test from "node:test";

import {
  CapabilityPolicy,
  CertificateIdentityPolicy,
  EdgeRuntimeProfile,
  SecurityConfig,
  SecurityProfile,
} from "@handoffkit/csp";

import { NetworkConfig } from "../src/index.js";

function policies() {
  return {
    identityPolicy: new CertificateIdentityPolicy({
      trustDomain: "edge.example",
      requireAuthorizedFingerprint: false,
    }),
    capabilityPolicy: new CapabilityPolicy({ allowedOperations: ["job:training"] }),
  };
}

test("edge profile drives the real Node network transport limits", () => {
  const edge = EdgeRuntimeProfile.forProfile("edge-small");
  const config = NetworkConfig.forProfile(edge, {
    securityConfig: new SecurityConfig({
      profile: SecurityProfile.STANDARD,
      requireMtls: true,
      trustDomain: "edge.example",
    }),
    ...policies(),
  });

  assert.equal(config.maxMessageBytes, edge.maxFrameBytes);
  assert.equal(config.connectTimeoutMs, edge.connectTimeoutMs);
  assert.equal(config.ioTimeoutMs, edge.ioTimeoutMs);
  assert.equal(config.maxAttempts, edge.reconnect.maxAttempts);
});

test("Node edge transport rejects local-profile downgrade", () => {
  assert.throws(
    () => NetworkConfig.forProfile("edge-small", {
      securityConfig: new SecurityConfig({
        profile: SecurityProfile.LOCAL,
        allowInsecureLoopback: true,
        trustDomain: "edge.example",
      }),
      ...policies(),
    }),
    (error) => error.code === "edge_security_profile_mismatch",
  );
});
