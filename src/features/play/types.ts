import type { ComponentType } from 'react';
import type { ApplicationApi } from '../../shared/application';
import type {
  HostStatus,
  NetworkApi,
  ServerSettingsView,
} from '../../shared/network';
import type { AssetApi } from '../../shared/assets';
import type { SceneApi } from '../../shared/scenes';

export type PlaySession =
  | {
      campaignId: string;
      campaignName: string;
      role: 'gm';
      source: 'local';
    }
  | {
      campaignId: string;
      campaignName: string;
      host: string;
      port: number;
      role: 'player';
      source: 'remote';
      userId: string;
      username: string;
    };

export type PlayToolId =
  | 'select'
  | 'measure'
  | 'paint'
  | 'shape'
  | 'text'
  | 'fog';

export type PlayLayerId = 'map' | 'token' | 'gm';

export type QuickActionId =
  | 'roll-dice'
  | 'initiative'
  | 'end-turn'
  | 'ping-map'
  | 'center-view'
  | 'notes';

export type SidebarTabId =
  | 'chat'
  | 'scenes'
  | 'journal'
  | 'music'
  | 'storage'
  | 'settings';

type PlayIcon = ComponentType<{
  'aria-hidden'?: boolean;
  size?: number | string;
  strokeWidth?: number | string;
}>;

export interface PlayControl<T extends string> {
  icon: PlayIcon;
  id: T;
  label: string;
}

export interface SidebarTab extends PlayControl<SidebarTabId> {
  panelId: string;
}

type ServerStatus = HostStatus;
type CampaignServerSettings = ServerSettingsView;

export interface PlayScreenProps {
  applicationApi?: ApplicationApi;
  assetApi?: AssetApi;
  networkApi?: NetworkApi;
  onExit: () => void;
  onLayerChange?: (id: PlayLayerId) => void;
  onLogout: () => void;
  onQuickAction?: (id: QuickActionId) => void;
  onCreateServerUser?: (username: string, password: string) => void;
  onDeleteServerUser?: (userId: string) => void;
  onServerPortChange?: (port: number) => void;
  onMaxChatMessageCharactersChange?: (maximum: number) => void;
  onTransformPreviewRateChange?: (rate: number) => void;
  onServerPasswordReset?: (userId: string, password: string) => void;
  onServerUsernameChange?: (userId: string, username: string) => void;
  onSidebarTabChange?: (id: SidebarTabId) => void;
  onToolChange?: (id: PlayToolId) => void;
  sceneApi?: SceneApi;
  serverSettings?: CampaignServerSettings;
  serverStatus?: ServerStatus;
  session: PlaySession;
}
