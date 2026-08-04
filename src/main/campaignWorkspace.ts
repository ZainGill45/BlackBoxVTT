import type { CampaignManifest } from '../shared/campaigns';
import type { CampaignSystemState } from '../shared/gameSystems';
import { AssetRepository } from './assetRepository';
import type { CampaignRepository } from './campaignRepository';
import { ChatRepository } from './chatRepository';
import { CampaignIdentityRepository } from './network/campaignIdentity';
import { JournalRepository } from './journalRepository';
import { ServerConfigRepository } from './network/serverConfigRepository';
import { SceneRepository } from './sceneRepository';
import { CampaignDatabase } from './storage/campaignDatabase';

export interface LocalCampaignWorkspace {
  readonly assetRepository: AssetRepository;
  readonly chatRepository: ChatRepository;
  readonly configRepository: ServerConfigRepository;
  readonly database: CampaignDatabase;
  readonly directory: string;
  readonly identityRepository: CampaignIdentityRepository;
  readonly journalRepository: JournalRepository;
  readonly manifest: CampaignManifest;
  readonly sceneRepository: SceneRepository;
  readonly system: CampaignSystemState;
}

interface CampaignWorkspaceRegistryOptions {
  campaignRepository: CampaignRepository;
  trashItem: (targetPath: string) => Promise<void>;
  warn?: (message: string, error?: unknown) => void;
}

/**
 * Owns every storage handle associated with a local campaign. Callers borrow a
 * workspace; they never construct a second repository over the same campaign.
 * The promise cache also prevents concurrent first access from minting two
 * independent write serializers.
 */
export class CampaignWorkspaceRegistry {
  private readonly campaignRepository: CampaignRepository;
  private readonly trashItem: (targetPath: string) => Promise<void>;
  private readonly warn: (message: string, error?: unknown) => void;
  private readonly workspaces = new Map<
    string,
    Promise<LocalCampaignWorkspace | null>
  >();

  constructor({
    campaignRepository,
    trashItem,
    warn = console.warn,
  }: CampaignWorkspaceRegistryOptions) {
    this.campaignRepository = campaignRepository;
    this.trashItem = trashItem;
    this.warn = warn;
  }

  get(campaignId: string): Promise<LocalCampaignWorkspace | null> {
    const current = this.workspaces.get(campaignId);
    if (current) {
      return current;
    }
    const opening = this.open(campaignId);
    this.workspaces.set(campaignId, opening);
    void opening.then((workspace) => {
      if (!workspace && this.workspaces.get(campaignId) === opening) {
        this.workspaces.delete(campaignId);
      }
    });
    return opening;
  }

  async close(campaignId: string): Promise<void> {
    const opening = this.workspaces.get(campaignId);
    this.workspaces.delete(campaignId);
    const workspace = await opening;
    await workspace?.chatRepository.close();
    workspace?.database.close();
  }

  async closeAll(): Promise<void> {
    const opening = [...this.workspaces.values()];
    this.workspaces.clear();
    const workspaces = await Promise.all(opening);
    await Promise.all(workspaces.map(async (workspace) => {
      await workspace?.chatRepository.close();
      workspace?.database.close();
    }));
  }

  private async open(
    campaignId: string,
  ): Promise<LocalCampaignWorkspace | null> {
    const container = await this.campaignRepository.getContainer(campaignId);
    if (!container) {
      return null;
    }
    const database = CampaignDatabase.open(container.directory);
    const touchCampaign = async () => {
      database.touch(new Date().toISOString());
    };
    const assetRepository = new AssetRepository({
      database,
      touchCampaign,
      trashItem: this.trashItem,
    });
    const sceneRepository = new SceneRepository({
      database,
      touchCampaign,
      warn: this.warn,
    });
    return {
      assetRepository,
      chatRepository: new ChatRepository({
        database,
        touchCampaign,
        warn: this.warn,
      }),
      configRepository: new ServerConfigRepository(database),
      database,
      directory: container.directory,
      identityRepository: new CampaignIdentityRepository(
        container.directory,
        container.manifest.id,
        container.manifest.name,
      ),
      journalRepository: new JournalRepository({
        assets: assetRepository,
        database,
        scenes: sceneRepository,
        touchCampaign,
      }),
      manifest: container.manifest,
      sceneRepository,
      system: container.manifest.system,
    };
  }
}
