import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';

interface PreviewGrant {
  assetId: string;
  campaignId: string;
  filePath: string;
  mimeType: string;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Expose-Headers':
    'Accept-Ranges, Content-Length, Content-Range',
};

export class AssetPreviewRegistry {
  private readonly grants = new Map<string, PreviewGrant>();

  create(grant: PreviewGrant): string {
    const token = randomUUID();
    this.grants.set(token, grant);
    return token;
  }

  release(token: string): void {
    this.grants.delete(token);
  }

  releaseCampaign(campaignId: string): void {
    for (const [token, grant] of this.grants) {
      if (grant.campaignId === campaignId) {
        this.grants.delete(token);
      }
    }
  }

  clear(): void {
    this.grants.clear();
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
      const fileStat = await stat(grant.filePath);
      const range = request.headers.get('range');
      if (fileStat.size === 0) {
        return range
          ? new Response(null, {
              headers: {
                ...corsHeaders,
                'Content-Range': 'bytes */0',
              },
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
      let end = Math.max(0, fileStat.size - 1);
      let status = 200;
      if (range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(range);
        if (!match) {
          return new Response(null, {
            headers: {
              ...corsHeaders,
              'Content-Range': `bytes */${fileStat.size}`,
            },
            status: 416,
          });
        }
        if (!match[1] && match[2]) {
          const suffixLength = Number(match[2]);
          start = Math.max(0, fileStat.size - suffixLength);
          end = fileStat.size - 1;
        } else {
          start = match[1] ? Number(match[1]) : 0;
          end = match[2] ? Number(match[2]) : end;
        }
        if (
          !Number.isSafeInteger(start) ||
          !Number.isSafeInteger(end) ||
          start < 0 ||
          end < start ||
          start >= fileStat.size
        ) {
          return new Response(null, {
            headers: {
              ...corsHeaders,
              'Content-Range': `bytes */${fileStat.size}`,
            },
            status: 416,
          });
        }
        end = Math.min(end, fileStat.size - 1);
        status = 206;
      }
      const headers = new Headers({
        ...corsHeaders,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-store',
        'Content-Length': String(Math.max(0, end - start + 1)),
        'Content-Type': grant.mimeType,
      });
      if (status === 206) {
        headers.set('Content-Range', `bytes ${start}-${end}/${fileStat.size}`);
      }
      if (request.method === 'HEAD') {
        return new Response(null, { headers, status });
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
