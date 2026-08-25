export const applicationIpcChannels = {
  altHeld: 'application:alt-held',
  openExternal: 'application:open-external',
  quit: 'application:quit',
  ready: 'application:ready',
  retryRenderer: 'application:retry-renderer',
} as const;

const EXTERNAL_LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);
const MAX_EXTERNAL_URL_CODE_UNITS = 16_384;

/**
 * URLs the shell may open: the user's browser for http(s), their mail client
 * for mailto. Anything else (file, javascript, data, custom schemes) is refused.
 */
export function parseExternalUrl(input: unknown): string | null {
  if (typeof input !== 'string' || input.length > MAX_EXTERNAL_URL_CODE_UNITS) {
    return null;
  }
  try {
    const url = new URL(input);
    return EXTERNAL_LINK_PROTOCOLS.has(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

export interface ApplicationApi {
  /**
   * True while Alt is held, including when Electron would otherwise spend that
   * key on the native menu. Used so Alt+click can follow a Journal link.
   */
  altHeld(): boolean;
  openExternal(url: string): Promise<boolean>;
  quit(): void;
  /**
   * Reports that the first screen has real data. The window stays hidden until
   * this arrives, so it is never shown mid-load.
   */
  ready(): void;
  /** Retries the main renderer after the stable crash recovery screen. */
  retryRenderer(): void;
}
