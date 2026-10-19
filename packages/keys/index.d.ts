// Types for @typographics-art/keys — the verified Typographics Art issuer key registry.

export interface KeyStatement {
  spec?: string;
  issuer: string;
  kid: string;
  /** "Ed25519" (signing) or "X25519" (sealing). Absent is treated as Ed25519. */
  alg?: "Ed25519" | "X25519";
  /** base64url Ed25519 public key, or an "age1…" recipient for X25519. */
  publicKey: string;
  created?: string;
  expires?: string | null;
  predecessor?: string | null;
  revokes?: string[];
  sig?: { by: string; signature: string };
  anchors?: unknown[];
}

export interface Issuer {
  issuer: string;
  /** ISO date the key was confirmed served at the issuer's domain, or null. */
  verifiedAt: string | null;
  /** Where domain control was checked (normally https://<issuer>/.well-known/tgart-keys.json). */
  verifiedVia: string;
  keys: KeyStatement[];
}

export interface Registry {
  spec: "tgart-registry-v1";
  updated: string;
  note: string;
  issuers: Issuer[];
}

export const registry: Registry;
/** The issuer hostnames in the registry. */
export function issuers(): string[];
/** The registry entry for one issuer, or null. */
export function getIssuer(domain: string): Issuer | null;

declare const _default: Registry;
export default _default;
