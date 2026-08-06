import crypto from 'node:crypto';

const VERSION = 'v1';

function encryptionKey() {
  const configured = process.env.ENCRYPTION_KEY?.trim();
  if (!configured) {
    throw new Error('ENCRYPTION_KEY ist für verschlüsselte Zugangsdaten erforderlich.');
  }

  const key = /^[0-9a-f]{64}$/i.test(configured)
    ? Buffer.from(configured, 'hex')
    : Buffer.from(configured, 'base64');
  if (key.length !== 32) {
    throw new Error('ENCRYPTION_KEY muss genau 32 Byte (64 Hex-Zeichen oder Base64) lang sein.');
  }
  return key;
}

export function isEncryptionConfigured() {
  try {
    encryptionKey();
    return true;
  } catch {
    return false;
  }
}

export function encryptSecret(value) {
  if (value === null || value === undefined || value === '') return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64url'), authTag.toString('base64url'), ciphertext.toString('base64url')].join(':');
}

export function decryptSecret(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || !value.startsWith(`${VERSION}:`)) {
    // Transitional compatibility for an old database during migration. New
    // writes never use this path and migration 025 removes the legacy column.
    return value;
  }

  const [, ivEncoded, tagEncoded, ciphertextEncoded] = value.split(':');
  if (!ivEncoded || !tagEncoded || !ciphertextEncoded) {
    throw new Error('Ungültiger verschlüsselter Zugangsdatenwert.');
  }
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    encryptionKey(),
    Buffer.from(ivEncoded, 'base64url')
  );
  decipher.setAuthTag(Buffer.from(tagEncoded, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextEncoded, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
