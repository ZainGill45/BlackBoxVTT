import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto';

export const PASSWORD_HASH_PARAMETERS = {
  cost: 32_768,
  keyLength: 32,
  maxmem: 64 * 1024 * 1024,
  parallelization: 1,
  saltLength: 16,
  blockSize: 8,
} as const;

export interface StoredPasswordHash {
  algorithm: 'scrypt';
  blockSize: number;
  cost: number;
  hash: string;
  keyLength: number;
  parallelization: number;
  salt: string;
}

function derivePassword(
  password: string,
  salt: Buffer,
  keyLength: number,
  options: { N: number; maxmem: number; p: number; r: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keyLength, options, (error, derived) => {
      if (error) {
        reject(error);
      } else {
        resolve(derived);
      }
    });
  });
}

export async function hashPassword(
  password: string,
): Promise<StoredPasswordHash> {
  if (password.length === 0) {
    throw new Error('Password must not be empty.');
  }

  const salt = randomBytes(PASSWORD_HASH_PARAMETERS.saltLength);
  const derived = await derivePassword(
    password,
    salt,
    PASSWORD_HASH_PARAMETERS.keyLength,
    {
      N: PASSWORD_HASH_PARAMETERS.cost,
      maxmem: PASSWORD_HASH_PARAMETERS.maxmem,
      p: PASSWORD_HASH_PARAMETERS.parallelization,
      r: PASSWORD_HASH_PARAMETERS.blockSize,
    },
  );

  return {
    algorithm: 'scrypt',
    blockSize: PASSWORD_HASH_PARAMETERS.blockSize,
    cost: PASSWORD_HASH_PARAMETERS.cost,
    hash: derived.toString('base64'),
    keyLength: PASSWORD_HASH_PARAMETERS.keyLength,
    parallelization: PASSWORD_HASH_PARAMETERS.parallelization,
    salt: salt.toString('base64'),
  };
}

export async function verifyPassword(
  password: string,
  stored: StoredPasswordHash,
): Promise<boolean> {
  try {
    const expected = Buffer.from(stored.hash, 'base64');
    const derived = await derivePassword(
      password,
      Buffer.from(stored.salt, 'base64'),
      stored.keyLength,
      {
        N: stored.cost,
        maxmem: PASSWORD_HASH_PARAMETERS.maxmem,
        p: stored.parallelization,
        r: stored.blockSize,
      },
    );

    return (
      expected.length === derived.length &&
      timingSafeEqual(expected, derived)
    );
  } catch {
    return false;
  }
}
