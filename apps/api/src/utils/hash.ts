import { createHash, randomBytes } from 'node:crypto';
import { config } from '../config.js';

/**
 * Salted, one-way hash for device identifiers. We never store raw IPs or
 * browser fingerprints; this hash only powers rate limiting and de-duplication.
 */
export function hashDevice(parts: Array<string | undefined | null>): string {
  const material = parts.filter(Boolean).join('|');
  return createHash('sha256').update(`${config.DEVICE_HASH_SALT}|${material}`).digest('hex');
}

export function randomToken(bytes = 24): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
