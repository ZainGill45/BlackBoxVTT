import { vi } from 'vitest';
import { OFFLINE_SERVER_STATUS } from '../features/play/serverSettings';
import type {
  AuthenticationChallenge,
  ConnectStep,
  ManagedUserView,
  NetworkApi,
  NetworkErrorCode,
  NetworkResult,
  RemotePlaySession,
  SetServerPortInput,
  UpdateManagedUsernameInput,
} from '../shared/network';

function failure<T>(
  code: NetworkErrorCode,
  message: string,
): NetworkResult<T> {
  return { error: { code, message }, ok: false };
}

function success<T>(value: T): NetworkResult<T> {
  return { ok: true, value };
}

export function createMockNetworkApi(
  overrides: Partial<NetworkApi> = {},
): NetworkApi {
  return {
    acceptTrust: vi.fn(async () =>
      failure<AuthenticationChallenge>('connection_failed', 'Not connected.'),
    ),
    authenticate: vi.fn(async () =>
      failure<RemotePlaySession>(
        'authentication_failed',
        'Not authenticated.',
      ),
    ),
    cancelConnection: vi.fn(async () => undefined),
    connect: vi.fn(async () =>
      failure<ConnectStep>('connection_failed', 'Not connected.'),
    ),
    createUser: vi.fn(async () =>
      failure<ManagedUserView>('server_unavailable', 'Not hosting.'),
    ),
    deleteHistory: vi.fn(async () => success(null)),
    deleteUser: vi.fn(async () =>
      failure<null>('server_unavailable', 'Not hosting.'),
    ),
    disconnect: vi.fn(async () => undefined),
    getHostStatus: vi.fn(async () => OFFLINE_SERVER_STATUS),
    getServerSettings: vi.fn(async () =>
      success({ port: 30_000, users: [] }),
    ),
    listHistory: vi.fn(async () => success([])),
    onClientStateChanged: vi.fn(() => () => undefined),
    onHostStatusChanged: vi.fn(() => () => undefined),
    onMapPing: vi.fn(() => () => undefined),
    onMeasurementUpdate: vi.fn(() => () => undefined),
    onSessionClosed: vi.fn(() => () => undefined),
    openHost: vi.fn(async () => success(OFFLINE_SERVER_STATUS)),
    resetPassword: vi.fn(async () => success(null)),
    setPort: vi.fn(async (input: SetServerPortInput) => success(input.port)),
    sendMapPing: vi.fn(async () => undefined),
    sendMeasurementUpdate: vi.fn(async () => undefined),
    stopHost: vi.fn(async () => undefined),
    updateUsername: vi.fn(async (input: UpdateManagedUsernameInput) =>
      success({
        connected: false,
        hasPassword: true,
        id: input.userId,
        username: input.username,
      }),
    ),
    ...overrides,
  };
}
