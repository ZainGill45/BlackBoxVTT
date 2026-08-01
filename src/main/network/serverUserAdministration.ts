import type {
  ManagedUserView,
  NetworkResult,
} from '../../shared/network';
import type { CampaignHostServer } from './campaignHostServer';
import type { ServerConfigRepository } from './serverConfigRepository';

export interface ServerUserAdministrationOptions {
  /** Announces a membership change so the host status reflects it. */
  emitHostStatus: () => void;
  host: CampaignHostServer;
  repository: ServerConfigRepository;
}

/**
 * Account management for one hosted campaign. Campaign selection happens at
 * construction, so credential changes can only affect this host's sessions.
 */
export class ServerUserAdministration {
  private readonly emitHostStatus: () => void;
  private readonly host: CampaignHostServer;
  private readonly repository: ServerConfigRepository;

  constructor({
    emitHostStatus,
    host,
    repository,
  }: ServerUserAdministrationOptions) {
    this.emitHostStatus = emitHostStatus;
    this.host = host;
    this.repository = repository;
  }

  async createUser(
    username: string,
    password: string,
  ): Promise<NetworkResult<ManagedUserView>> {
    const result = await this.repository.createUser(username, password);
    this.emitHostStatus();
    return result.ok
      ? {
          ok: true,
          value: this.repository.toView(result.value, false),
        }
      : result;
  }

  async updateUsername(
    userId: string,
    username: string,
  ): Promise<NetworkResult<ManagedUserView>> {
    const result = await this.repository.updateUsername(userId, username);
    if (result.ok) {
      this.host.disconnectUser(
        userId,
        'Your campaign account was changed.',
      );
    }
    return result.ok
      ? {
          ok: true,
          value: this.repository.toView(result.value, false),
        }
      : result;
  }

  async resetPassword(
    userId: string,
    password: string,
  ): Promise<NetworkResult<null>> {
    const result = await this.repository.resetPassword(userId, password);
    if (result.ok) {
      this.host.disconnectUser(
        userId,
        'Your campaign password was reset.',
      );
    }
    return result;
  }

  async deleteUser(userId: string): Promise<NetworkResult<null>> {
    const result = await this.repository.deleteUser(userId);
    if (result.ok) {
      this.host.disconnectUser(
        userId,
        'Your campaign account was deleted.',
      );
    }
    return result;
  }
}
