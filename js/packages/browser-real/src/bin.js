#!/usr/bin/env node
import { CONFIG_ENV, loadBrowserRealConfig } from "./config.js";
import { startBrowserRealService } from "./service.js";

let config;
try {
  config = loadBrowserRealConfig();
} catch (error) {
  console.error(error.message || error);
  process.exit(1);
}

const { SecurityConfig, CertificateIdentityPolicy, CapabilityPolicy } = await import("@handoffkit/csp");
const { NetworkConfig, DurableReplayProtection } = await import("@handoffkit/node");

const networkConfig = new NetworkConfig({
  securityConfig: new SecurityConfig({
    profile: "standard",
    requireMtls: true,
    trustDomain: config.trustDomain,
    caCertPath: config.caPath,
    certPath: config.certPath,
    keyPath: config.keyPath,
  }),
  identityPolicy: new CertificateIdentityPolicy({
    trustDomain: config.trustDomain,
    capabilitiesByFingerprint: Object.fromEntries(
      Object.entries(config.grants).map(([fingerprint, caps]) => [fingerprint, caps]),
    ),
  }),
  capabilityPolicy: new CapabilityPolicy({
    allowedOperations: ["browser:control"],
  }),
  replayProtection: new DurableReplayProtection(config.replayStore),
});

const service = await startBrowserRealService({
  config,
  host: config.host,
  port: config.port,
  networkConfig,
  grants: config.grants,
  replay: networkConfig.replayProtection,
});
console.log(JSON.stringify({
  listen: service.address,
  product: "real",
  engine_ready: service.capabilities.engineReady,
  config: CONFIG_ENV,
}));
