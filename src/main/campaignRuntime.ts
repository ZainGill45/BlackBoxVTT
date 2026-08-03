import {
  createJoinedAssetRuntime,
  createLocalAssetRuntime,
  type CampaignAssetRuntime,
  type JoinedAssetTransport,
} from './campaignAssetRuntime';
import {
  createJoinedSceneRuntime,
  createLocalSceneRuntime,
  type CampaignSceneRuntime,
  type JoinedSceneTransport,
} from './campaignSceneRuntime';
import type {
  CampaignWorkspaceRegistry,
  LocalCampaignWorkspace,
} from './campaignWorkspace';
import type { CampaignSystemState } from '../shared/gameSystems';

export type {
  AssetRuntimeMutation,
  CampaignAssetRuntime,
  JoinedAssetTransport,
} from './campaignAssetRuntime';
export type {
  CampaignSceneRuntime,
  JoinedSceneTransport,
  SceneRuntimeMutation,
} from './campaignSceneRuntime';

export interface JoinedCampaignRuntime {
  readonly assets: CampaignAssetRuntime;
  readonly campaignId: string;
  readonly kind: 'joined';
  readonly scenes: CampaignSceneRuntime;
  readonly system: CampaignSystemState;
}

export interface LocalCampaignRuntime {
  readonly assets: CampaignAssetRuntime;
  readonly campaignId: string;
  readonly kind: 'local';
  readonly scenes: CampaignSceneRuntime;
  readonly system: CampaignSystemState;
  readonly workspace: LocalCampaignWorkspace;
}

export type CampaignRuntime = LocalCampaignRuntime | JoinedCampaignRuntime;

interface JoinedCampaignRegistration {
  readonly assets: JoinedAssetTransport;
  readonly campaignId: string;
  readonly kind: 'joined';
  readonly scenes: JoinedSceneTransport;
  readonly system: CampaignSystemState;
}

/** Resolves campaign data location once and owns stable capability adapters. */
export class CampaignRuntimeRegistry {
  private readonly joined = new Map<string, JoinedCampaignRuntime>();
  private readonly local = new Map<string, LocalCampaignRuntime>();
  private readonly workspaces: CampaignWorkspaceRegistry;

  constructor(workspaces: CampaignWorkspaceRegistry) {
    this.workspaces = workspaces;
  }

  registerJoined(runtime: JoinedCampaignRegistration): void {
    this.joined.clear();
    this.joined.set(runtime.campaignId, {
      assets: createJoinedAssetRuntime(runtime.assets),
      campaignId: runtime.campaignId,
      kind: 'joined',
      scenes: createJoinedSceneRuntime(runtime.scenes),
      system: structuredClone(runtime.system),
    });
  }

  unregisterJoined(campaignId: string): void {
    this.joined.delete(campaignId);
  }

  async resolve(campaignId: string): Promise<CampaignRuntime | null> {
    const joined = this.joined.get(campaignId);
    if (joined) {
      return joined;
    }
    const cached = this.local.get(campaignId);
    if (cached) {
      return cached;
    }
    const workspace = await this.workspaces.get(campaignId);
    if (!workspace) {
      return null;
    }
    const runtime: LocalCampaignRuntime = {
      assets: createLocalAssetRuntime(workspace),
      campaignId,
      kind: 'local',
      scenes: createLocalSceneRuntime(workspace),
      system: structuredClone(workspace.system),
      workspace,
    };
    this.local.set(campaignId, runtime);
    return runtime;
  }

  getLocalWorkspace(
    campaignId: string,
  ): Promise<LocalCampaignWorkspace | null> {
    return this.workspaces.get(campaignId);
  }

  closeLocal(campaignId: string): Promise<void> {
    this.local.delete(campaignId);
    return this.workspaces.close(campaignId);
  }

  closeAll(): Promise<void> {
    this.joined.clear();
    this.local.clear();
    return this.workspaces.closeAll();
  }
}
