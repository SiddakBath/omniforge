import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';
import { hostname, userInfo } from 'os';

const ALGO = 'aes-256-gcm';

function deriveKey(): Buffer {
  const salt = Buffer.from('omniforge-local-salt-v1', 'utf8');
  const identity = `${userInfo().username}@${hostname()}`;
  return scryptSync(identity, salt, 32);
}

export function encryptAtRest(plainText: string): string {
  const key = deriveKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

export function decryptAtRest(payload: string): string {
  const key = deriveKey();
  const bytes = Buffer.from(payload, 'base64');
  const iv = bytes.subarray(0, 12);
  const tag = bytes.subarray(12, 28);
  const data = bytes.subarray(28);

  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return decrypted.toString('utf8');
}
