import type {
  CreateManagedUserInput,
  DeleteManagedUserInput,
  ManagedUserView,
  NetworkResult,
  ResetManagedPasswordInput,
  UpdateManagedUsernameInput,
} from '../../shared/network';
import { fail } from '../../shared/result';
import type { CampaignHostServer } from './campaignHostServer';
import type { ServerConfigRepository } from './serverConfigRepository';

function failure<T>(): NetworkResult<T> {
  return fail({
    code: 'campaign_not_found',
    message: 'Campaign could not be found.',
  });
}

export interface ServerUserAdministrationOptions {
  /** Announces a membership change so the host status reflects it. */
  emitHostStatus: () => void;
  getConfigRepository: (
    campaignId: string,
  ) => Promise<ServerConfigRepository | null>;
  getHost: () => CampaignHostServer | null;
}

/**
 * The GM's per-campaign account management. Every operation writes through the
 * campaign's config repository, then drops any session belonging to the
 * affected account: a credential that just changed must not keep a connection
 * alive.
 */
export class ServerUserAdministration {
  private readonly emitHostStatus: () => void;
  private readonly getConfigRepository: ServerUserAdministrationOptions['getConfigRepository'];
  private readonly getHost: () => CampaignHostServer | null;

  constructor({
    emitHostStatus,
    getConfigRepository,
    getHost,
  }: ServerUserAdministrationOptions) {
    this.emitHostStatus = emitHostStatus;
    this.getConfigRepository = getConfigRepository;
    this.getHost = getHost;
  }

  async createUser(
    input: CreateManagedUserInput,
  ): Promise<NetworkResult<ManagedUserView>> {
    const repository = await this.getConfigRepository(input.campaignId);
    if (!repository) {
      return failure();
    }
    const result = await repository.createUser(input.username, input.password);
    this.emitHostStatus();
    return result.ok
      ? {
          ok: true,
          value: repository.toView(result.value, false),
        }
      : result;
  }

  async updateUsername(
    input: UpdateManagedUsernameInput,
  ): Promise<NetworkResult<ManagedUserView>> {
    const repository = await this.getConfigRepository(input.campaignId);
    if (!repository) {
      return failure();
    }
    const result = await repository.updateUsername(
      input.userId,
      input.username,
    );
    if (result.ok) {
      this.disconnect(
        input.campaignId,
        input.userId,
        'Your campaign account was changed.',
      );
    }
    return result.ok
      ? {
          ok: true,
          value: repository.toView(result.value, false),
        }
      : result;
  }

  async resetPassword(
    input: ResetManagedPasswordInput,
  ): Promise<NetworkResult<null>> {
    const repository = await this.getConfigRepository(input.campaignId);
    if (!repository) {
      return failure();
    }
    const result = await repository.resetPassword(
      input.userId,
      input.password,
    );
    if (result.ok) {
      this.disconnect(
        input.campaignId,
        input.userId,
        'Your campaign password was reset.',
      );
    }
    return result;
  }

  async deleteUser(
    input: DeleteManagedUserInput,
  ): Promise<NetworkResult<null>> {
    const repository = await this.getConfigRepository(input.campaignId);
    if (!repository) {
      return failure();
    }
    const result = await repository.deleteUser(input.userId);
    if (result.ok) {
      this.disconnect(
        input.campaignId,
        input.userId,
        'Your campaign account was deleted.',
      );
    }
    return result;
  }

  /** Only the campaign actually being hosted can have a session to drop. */
  private disconnect(
    campaignId: string,
    userId: string,
    message: string,
  ): void {
    const host = this.getHost();
    if (host?.campaignId === campaignId) {
      host.disconnectUser(userId, message);
    }
  }
}
