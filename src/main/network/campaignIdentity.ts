import 'reflect-metadata';
import {
  createHash,
  randomBytes,
  webcrypto,
  X509Certificate as NodeX509Certificate,
} from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { writeFileAtomic } from '../storage/atomicWrite';
import {
  BasicConstraintsExtension,
  ExtendedKeyUsageExtension,
  KeyUsageFlags,
  KeyUsagesExtension,
  SubjectKeyIdentifierExtension,
  X509CertificateGenerator,
} from '@peculiar/x509';

const SERVER_AUTH_OID = '1.3.6.1.5.5.7.3.1';

export interface CampaignIdentity {
  certificateFingerprint: string;
  certificatePem: string;
  privateKeyPem: string;
}

function toPem(label: string, bytes: ArrayBuffer): string {
  const base64 = Buffer.from(bytes).toString('base64');
  const lines = base64.match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----\n`;
}

function fingerprint(certificatePem: string): string {
  return new NodeX509Certificate(certificatePem).fingerprint256;
}

function writeAtomic(
  targetPath: string,
  value: string,
  mode: number,
): Promise<void> {
  return writeFileAtomic(targetPath, value, {
    temporaryPath: `${targetPath}.${randomBytes(8).toString('hex')}.tmp`,
    writeOptions: { encoding: 'utf8', flag: 'wx', mode },
  });
}

export class CampaignIdentityRepository {
  private readonly certificatePath: string;
  private readonly identityDirectory: string;
  private readonly privateKeyPath: string;
  private creation: Promise<CampaignIdentity> | null = null;

  constructor(
    campaignDirectory: string,
    private readonly campaignId: string,
    private readonly campaignName: string,
  ) {
    this.identityDirectory = path.join(
      path.resolve(campaignDirectory),
      'content',
      'network',
    );
    this.certificatePath = path.join(
      this.identityDirectory,
      'identity.cert.pem',
    );
    this.privateKeyPath = path.join(
      this.identityDirectory,
      'identity.key.pem',
    );
  }

  loadOrCreate(): Promise<CampaignIdentity> {
    this.creation ??= this.loadOrCreateInternal().finally(() => {
      this.creation = null;
    });
    return this.creation;
  }

  private async loadOrCreateInternal(): Promise<CampaignIdentity> {
    try {
      const [certificatePem, privateKeyPem] = await Promise.all([
        readFile(this.certificatePath, 'utf8'),
        readFile(this.privateKeyPath, 'utf8'),
      ]);

      return {
        certificateFingerprint: fingerprint(certificatePem),
        certificatePem,
        privateKeyPem,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }

    await mkdir(this.identityDirectory, { recursive: true });
    const algorithm = {
      hash: 'SHA-256',
      name: 'ECDSA',
      namedCurve: 'P-256',
    } as const;
    const keys = await webcrypto.subtle.generateKey(
      {
        name: algorithm.name,
        namedCurve: algorithm.namedCurve,
      },
      true,
      ['sign', 'verify'],
    );
    const now = new Date();
    const notBefore = new Date(now.getTime() - 60_000);
    const notAfter = new Date(now);
    notAfter.setUTCFullYear(notAfter.getUTCFullYear() + 10);
    notAfter.setUTCMilliseconds(0);
    const commonName = createHash('sha256')
      .update(`${this.campaignId}:${this.campaignName}`)
      .digest('hex')
      .slice(0, 32);
    const certificate = await X509CertificateGenerator.createSelfSigned(
      {
        extensions: [
          new BasicConstraintsExtension(false, undefined, true),
          new ExtendedKeyUsageExtension([SERVER_AUTH_OID], true),
          new KeyUsagesExtension(KeyUsageFlags.digitalSignature, true),
          await SubjectKeyIdentifierExtension.create(
            keys.publicKey as unknown as CryptoKey,
          ),
        ],
        keys: keys as unknown as CryptoKeyPair,
        name: `CN=BlackBoxVTT-${commonName}`,
        notAfter,
        notBefore,
        serialNumber: randomBytes(16).toString('hex'),
        signingAlgorithm: algorithm,
      },
      webcrypto as unknown as Crypto,
    );
    const certificatePem = certificate.toString('pem');
    const privateKeyPem = toPem(
      'PRIVATE KEY',
      await webcrypto.subtle.exportKey('pkcs8', keys.privateKey),
    );

    await Promise.all([
      writeAtomic(this.certificatePath, certificatePem, 0o644),
      writeAtomic(this.privateKeyPath, privateKeyPem, 0o600),
    ]);

    return {
      certificateFingerprint: fingerprint(certificatePem),
      certificatePem,
      privateKeyPem,
    };
  }
}
