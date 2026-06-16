// Crypto utilities for PBKDF2 password hashing using Web Crypto API

const ITERATIONS = 100_000;
const KEY_LENGTH = 256;
const HASH_ALGORITHM = 'SHA-256';

const encoder = new TextEncoder();

export async function hashPassword(password: string, salt?: string): Promise<{ hash: string; salt: string }> {
  const saltBytes = salt ? encoder.encode(salt) : crypto.getRandomValues(new Uint8Array(16));
  const saltStr = Array.from(saltBytes).map(b => b.toString(16).padStart(2, '0')).join('');

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations: ITERATIONS,
      hash: HASH_ALGORITHM,
    },
    keyMaterial,
    KEY_LENGTH
  );

  const hash = Array.from(new Uint8Array(derivedBits))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  return { hash, salt: saltStr };
}

export async function verifyPassword(password: string, hash: string, salt: string): Promise<boolean> {
  const { hash: computedHash } = await hashPassword(password, salt);
  return computedHash === hash;
}

export function generateSalt(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}