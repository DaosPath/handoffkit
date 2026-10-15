import { CspError } from "./contracts.js";

// Internal: identifiers come from Web Crypto only; there is no Math.random fallback.
export function randomUuid() {
  const webCrypto = globalThis.crypto;
  if (typeof webCrypto?.randomUUID === "function") return webCrypto.randomUUID();
  if (typeof webCrypto?.getRandomValues !== "function") {
    throw new CspError("A Web Crypto implementation (globalThis.crypto) is required to generate identifiers.");
  }
  // RFC 4122 version 4 UUID from a CSPRNG (same shape as crypto.randomUUID()).
  const bytes = webCrypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function randomId(prefix) {
  return `${prefix}-${randomUuid()}`;
}
