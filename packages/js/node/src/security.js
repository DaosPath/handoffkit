import fs from "node:fs";
import tls from "node:tls";
import { SecurityProfile } from "@handoffkit/csp";

export class FileKeyStore {
  constructor(options = {}) {
    this.caCertPath = options.caCertPath || null;
    this.certPath = options.certPath || null;
    this.keyPath = options.keyPath || null;
  }

  getCaCertificate() {
    return this.caCertPath && fs.existsSync(this.caCertPath)
      ? fs.readFileSync(this.caCertPath, "utf8")
      : null;
  }

  getCertificate() {
    return this.certPath && fs.existsSync(this.certPath)
      ? fs.readFileSync(this.certPath, "utf8")
      : null;
  }

  getPrivateKey() {
    return this.keyPath && fs.existsSync(this.keyPath)
      ? fs.readFileSync(this.keyPath, "utf8")
      : null;
  }
}

export function buildTlsOptions(securityConfig, isServer = false) {
  if (!securityConfig || securityConfig.profile === SecurityProfile.LOCAL) {
    return null;
  }

  const options = {
    minVersion: "TLSv1.3",
  };

  const keyStore = new FileKeyStore({
    caCertPath: securityConfig.caCertPath,
    certPath: securityConfig.certPath,
    keyPath: securityConfig.keyPath,
  });

  const ca = keyStore.getCaCertificate();
  const cert = keyStore.getCertificate();
  const key = keyStore.getPrivateKey();

  if (ca) options.ca = [ca];
  if (cert) options.cert = cert;
  if (key) options.key = key;

  if (securityConfig.requireMtls) {
    if (isServer) {
      options.requestCert = true;
      options.rejectUnauthorized = true;
      if (!ca) {
        throw new Error("requireMtls=true on server requires caCertPath.");
      }
    } else {
      if (!cert || !key) {
        throw new Error("requireMtls=true on client requires certPath and keyPath.");
      }
    }
  }

  if (!isServer) {
    options.rejectUnauthorized = true;
  }

  return options;
}
