export const applicationIpcChannels = {
  quit: 'application:quit',
  ready: 'application:ready',
} as const;

export interface ApplicationApi {
  quit(): void;
  /**
   * Reports that the first screen has real data. The window stays hidden until
   * this arrives, so it is never shown mid-load.
   */
  ready(): void;
}
