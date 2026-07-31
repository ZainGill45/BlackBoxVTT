import {
  DEFAULT_SERVER_PORT,
  DEFAULT_TRANSFORM_PREVIEW_RATE,
  type ServerSettingsView,
  type HostStatus,
} from '../../shared/network';

export const OFFLINE_SERVER_STATUS: HostStatus = {
  boundFamilies: [],
  certificateFingerprint: null,
  connectedPlayerCount: 0,
  effectivePort: DEFAULT_SERVER_PORT,
  localAddresses: [],
  publicAddresses: [],
  state: 'offline',
};

export function createDefaultServerSettings(): ServerSettingsView {
  return {
    port: DEFAULT_SERVER_PORT,
    transformPreviewRate: DEFAULT_TRANSFORM_PREVIEW_RATE,
    users: [],
  };
}
