import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, stat } from 'node:fs/promises';
import { Readable } from 'node:stream';

const PRELOAD_INACTIVITY_MS = 30_000;
const PRELOAD_READ_BYTES = 512 * 1024;

export interface AssetPreviewGrantInput {
  assetId: string;
  cacheKey?: string;
  campaignId: string;
  filePath: string;
  mimeType: string;
}

interface PreviewGrant extends AssetPreviewGrantInput {
  cacheKey: string;
}

interface CachedPayload {
  bytes: Buffer;
  campaignId: string;
  assetId: string;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Expose-Headers':
    'Accept-Ranges, Content-Length, Content-Range',
};

function inactivity<T>(
  operation: Promise<T>,
  onLate?: (value: T) => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let active = true;
    const timer = setTimeout(
      () => {
        active = false;
        reject(new Error('Asset preload stopped making progress.'));
      },
      PRELOAD_INACTIVITY_MS,
    );
    void operation.then(
      (value) => {
        if (!active) {
          onLate?.(value);
          return;
        }
        active = false;
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        if (!active) return;
        active = false;
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Owns authorized preview grants and campaign-lifetime in-memory payloads.
 * Payloads are still served only through grants authorized by AssetManager.
 */
export class AssetPreviewRegistry {
  private readonly assetGenerations = new Map<string, number>();
  private readonly campaignGenerations = new Map<string, number>();
  private readonly grants = new Map<string, PreviewGrant>();
  private readonly payloads = new Map<string, CachedPayload>();
  private readonly preparing = new Map<
    string,
    { grant: AssetPreviewGrantInput; promise: Promise<CachedPayload> }
  >();
  private clearGeneration = 0;

  create(grant: AssetPreviewGrantInput): string {
    const token = randomUUID();
    this.grants.set(token, {
      ...grant,
      cacheKey: grant.cacheKey ?? grant.filePath,
    });
    return token;
  }

  async prepare(
    grant: AssetPreviewGrantInput,
    onProgress?: (completedBytes: number, totalBytes: number) => void,
  ): Promise<string> {
    const cacheKey = grant.cacheKey ?? grant.filePath;
    const assetGeneration = this.assetGeneration(grant.campaignId, grant.assetId);
    const campaignGeneration = this.campaignGenerations.get(grant.campaignId) ?? 0;
    const clearGeneration = this.clearGeneration;
    if (!this.payloads.has(cacheKey)) {
      let pending = this.preparing.get(cacheKey);
      if (!pending) {
        pending = {
          grant,
          promise: this.readPayload(grant, onProgress),
        };
        this.preparing.set(cacheKey, pending);
      }
      let payload: CachedPayload;
      try {
        payload = await pending.promise;
      } finally {
        if (this.preparing.get(cacheKey) === pending) {
          this.preparing.delete(cacheKey);
        }
      }
      if (
        clearGeneration !== this.clearGeneration ||
        campaignGeneration !==
          (this.campaignGenerations.get(grant.campaignId) ?? 0) ||
        assetGeneration !== this.assetGeneration(grant.campaignId, grant.assetId)
      ) {
        throw new Error('Asset preload was superseded.');
      }
      this.payloads.set(cacheKey, payload);
    } else {
      const cached = this.payloads.get(cacheKey)!;
      onProgress?.(cached.bytes.length, cached.bytes.length);
    }
    return this.create({ ...grant, cacheKey });
  }

  release(token: string): void {
    const grant = this.grants.get(token);
    this.grants.delete(token);
    if (
      grant &&
      ![...this.grants.values()].some(
        (candidate) => candidate.cacheKey === grant.cacheKey,
      )
    ) {
      this.payloads.delete(grant.cacheKey);
    }
  }

  reconcileCampaign(
    campaignId: string,
    assets: readonly { id: string; sha256: string }[],
  ): void {
    const allowed = new Map(
      assets.map((asset) => [
        asset.id,
        `${campaignId}:${asset.id}:${asset.sha256}`,
      ]),
    );
    const invalidAssetIds = new Set<string>();
    for (const grant of this.grants.values()) {
      if (
        grant.campaignId === campaignId &&
        allowed.get(grant.assetId) !== grant.cacheKey
      ) {
        invalidAssetIds.add(grant.assetId);
      }
    }
    for (const [cacheKey, payload] of this.payloads) {
      if (
        payload.campaignId === campaignId &&
        allowed.get(payload.assetId) !== cacheKey
      ) {
        invalidAssetIds.add(payload.assetId);
      }
    }
    for (const pending of this.preparing.values()) {
      const cacheKey = pending.grant.cacheKey ?? pending.grant.filePath;
      if (
        pending.grant.campaignId === campaignId &&
        allowed.get(pending.grant.assetId) !== cacheKey
      ) {
        invalidAssetIds.add(pending.grant.assetId);
      }
    }
    for (const assetId of invalidAssetIds) {
      this.releaseAsset(campaignId, assetId);
    }
  }

  releaseAsset(campaignId: string, assetId: string): void {
    const generationKey = this.assetGenerationKey(campaignId, assetId);
    this.assetGenerations.set(
      generationKey,
      (this.assetGenerations.get(generationKey) ?? 0) + 1,
    );
    for (const [key, pending] of this.preparing) {
      if (
        pending.grant.campaignId === campaignId &&
        pending.grant.assetId === assetId
      ) {
        this.preparing.delete(key);
      }
    }
    for (const [token, grant] of this.grants) {
      if (grant.campaignId === campaignId && grant.assetId === assetId) {
        this.grants.delete(token);
      }
    }
    for (const [key, payload] of this.payloads) {
      if (payload.campaignId === campaignId && payload.assetId === assetId) {
        this.payloads.delete(key);
      }
    }
  }

  releaseCampaign(campaignId: string): void {
    this.campaignGenerations.set(
      campaignId,
      (this.campaignGenerations.get(campaignId) ?? 0) + 1,
    );
    for (const [key, pending] of this.preparing) {
      if (pending.grant.campaignId === campaignId) this.preparing.delete(key);
    }
    for (const [token, grant] of this.grants) {
      if (grant.campaignId === campaignId) this.grants.delete(token);
    }
    for (const [key, payload] of this.payloads) {
      if (payload.campaignId === campaignId) this.payloads.delete(key);
    }
  }

  clear(): void {
    this.clearGeneration += 1;
    this.grants.clear();
    this.payloads.clear();
    this.preparing.clear();
  }

  private assetGeneration(campaignId: string, assetId: string): number {
    return this.assetGenerations.get(
      this.assetGenerationKey(campaignId, assetId),
    ) ?? 0;
  }

  private assetGenerationKey(campaignId: string, assetId: string): string {
    return `${campaignId}\u0000${assetId}`;
  }

  private async readPayload(
    grant: AssetPreviewGrantInput,
    onProgress?: (completedBytes: number, totalBytes: number) => void,
  ): Promise<CachedPayload> {
    const fileStat = await inactivity(stat(grant.filePath));
    const bytes = Buffer.allocUnsafe(fileStat.size);
    const file = await inactivity(open(grant.filePath, 'r'), (lateFile) => {
      void lateFile.close().catch(() => undefined);
    });
    let completed = 0;
    try {
      while (completed < bytes.length) {
        const length = Math.min(PRELOAD_READ_BYTES, bytes.length - completed);
        const read = await inactivity(
          file.read(bytes, completed, length, completed),
        );
        if (read.bytesRead === 0) {
          throw new Error('Asset preload ended before the file was complete.');
        }
        completed += read.bytesRead;
        onProgress?.(completed, bytes.length);
      }
    } finally {
      void file.close().catch(() => undefined);
    }
    return {
      assetId: grant.assetId,
      bytes,
      campaignId: grant.campaignId,
    };
  }

  async handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const token = url.hostname;
    const grant = this.grants.get(token);
    if (!grant || url.pathname !== `/${grant.assetId}`) {
      return new Response('Asset preview is unavailable.', {
        headers: corsHeaders,
        status: 404,
      });
    }

    try {
      const cached = this.payloads.get(grant.cacheKey);
      const size = cached?.bytes.length ?? (await stat(grant.filePath)).size;
      const range = request.headers.get('range');
      if (size === 0) {
        return range
          ? new Response(null, {
              headers: { ...corsHeaders, 'Content-Range': 'bytes */0' },
              status: 416,
            })
          : new Response(new Uint8Array(), {
              headers: {
                ...corsHeaders,
                'Accept-Ranges': 'bytes',
                'Cache-Control': 'no-store',
                'Content-Length': '0',
                'Content-Type': grant.mimeType,
              },
            });
      }
      let start = 0;
      let end = Math.max(0, size - 1);
      let status = 200;
      if (range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(range);
        if (!match) {
          return new Response(null, {
            headers: { ...corsHeaders, 'Content-Range': `bytes */${size}` },
            status: 416,
          });
        }
        if (!match[1] && match[2]) {
          const suffixLength = Number(match[2]);
          start = Math.max(0, size - suffixLength);
          end = size - 1;
        } else {
          start = match[1] ? Number(match[1]) : 0;
          end = match[2] ? Number(match[2]) : end;
        }
        if (
          !Number.isSafeInteger(start) ||
          !Number.isSafeInteger(end) ||
          start < 0 ||
          end < start ||
          start >= size
        ) {
          return new Response(null, {
            headers: { ...corsHeaders, 'Content-Range': `bytes */${size}` },
            status: 416,
          });
        }
        end = Math.min(end, size - 1);
        status = 206;
      }
      const headers = new Headers({
        ...corsHeaders,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-store',
        'Content-Length': String(end - start + 1),
        'Content-Type': grant.mimeType,
      });
      if (status === 206) {
        headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
      }
      if (request.method === 'HEAD') {
        return new Response(null, { headers, status });
      }
      if (cached) {
        return new Response(Uint8Array.from(cached.bytes.subarray(start, end + 1)), {
          headers,
          status,
        });
      }
      const stream = createReadStream(grant.filePath, { end, start });
      return new Response(
        Readable.toWeb(stream) as ReadableStream<Uint8Array>,
        { headers, status },
      );
    } catch {
      return new Response('Asset preview is unavailable.', {
        headers: corsHeaders,
        status: 404,
      });
    }
  }
}
