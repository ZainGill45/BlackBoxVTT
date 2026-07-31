import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type { RenderResult } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApplicationApi } from '../../../../../shared/application';
import type {
  ChatBootstrap,
  ChatEvent,
  ChatMessage,
} from '../../../../../shared/chat';
import { createMockNetworkApi } from '../../../../support/networkApi';
import type { NetworkApi } from '../../../../../shared/network';
import type { PlaySession } from '../../../../../features/play/types';
import { ChatPanel } from '../../../../../features/play/chat/ChatPanel';

const campaignId = '11111111-1111-4111-8111-111111111111';
const generation = '22222222-2222-4222-8222-222222222222';
const nextGeneration = '33333333-3333-4333-8333-333333333333';
const aliceId = '44444444-4444-4444-8444-444444444444';
const bobId = '55555555-5555-4555-8555-555555555555';

const playerSession: PlaySession = {
  campaignId,
  campaignName: 'Iron Meridian',
  host: 'vtt.local',
  port: 30_000,
  role: 'player',
  source: 'remote',
  userId: aliceId,
  username: 'Alice',
};

const gmSession: PlaySession = {
  campaignId,
  campaignName: 'Iron Meridian',
  role: 'gm',
  source: 'local',
};

let applicationApi: ApplicationApi;

beforeEach(() => {
  applicationApi = {
    openExternal: vi.fn(async () => true),
    quit: vi.fn(),
    ready: vi.fn(),
  };
});

function bootstrap(overrides: Partial<ChatBootstrap> = {}): ChatBootstrap {
  return {
    directory: [
      { displayName: 'Game Master', kind: 'gm' },
      { displayName: 'Alice', kind: 'player', userId: aliceId },
      { displayName: 'Bob', kind: 'player', userId: bobId },
    ],
    generation,
    hasNewer: false,
    hasOlder: false,
    maxMessageCharacters: 10_000,
    messages: [],
    newestSequence: null,
    oldestSequence: null,
    systemEvents: [],
    ...overrides,
  };
}

function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    acceptedAt: '2026-07-31T18:30:00.000Z',
    clientMessageId: '66666666-6666-4666-8666-666666666666',
    content: 'Hello',
    generation,
    id: '77777777-7777-4777-8777-777777777777',
    recipient: null,
    sender: { displayName: 'Game Master', kind: 'gm' },
    sequence: 1,
    ...overrides,
  };
}

/** Renders the panel and waits until the composer is ready to accept input. */
async function renderPanel(
  networkApi: NetworkApi,
  session: PlaySession = playerSession,
): Promise<{ composer: HTMLElement; view: RenderResult }> {
  const view = render(
    <ChatPanel
      applicationApi={applicationApi}
      networkApi={networkApi}
      session={session}
      visible
    />,
  );
  const composer = await screen.findByRole('textbox', { name: 'Message' });
  await waitFor(() => expect(composer).toBeEnabled());
  return { composer, view };
}

describe('ChatPanel startup', () => {
  it('subscribes to events before requesting the backlog', async () => {
    const calls: string[] = [];
    const networkApi = createMockNetworkApi({
      getChatBootstrap: vi.fn(async () => {
        calls.push('bootstrap');
        return { ok: true as const, value: bootstrap() };
      }),
      onChatEvent: vi.fn(() => {
        calls.push('subscribe');
        return () => undefined;
      }),
    });

    await renderPanel(networkApi);

    // The other order would drop any message that landed mid-request.
    expect(calls.slice(0, 2)).toEqual(['subscribe', 'bootstrap']);
  });
});

describe('ChatPanel sending', () => {
  const authoritative = message({
    content: 'hello\nworld',
    sender: { displayName: 'Alice', kind: 'player', userId: aliceId },
  });

  function sendingApi() {
    return createMockNetworkApi({
      getChatBootstrap: vi.fn(async () => ({
        ok: true as const,
        value: bootstrap(),
      })),
      sendChatMessage: vi.fn(async () => ({
        ok: true as const,
        value: authoritative,
      })),
    });
  }

  async function typeAndSend(composer: HTMLElement) {
    await userEvent.type(composer, '  hello{shift>}{enter}{/shift}world  ');
    fireEvent.keyDown(composer, { key: 'Enter' });
  }

  it('trims the draft and keeps a shift-entered newline', async () => {
    const networkApi = sendingApi();
    const { composer } = await renderPanel(networkApi);

    await typeAndSend(composer);

    await waitFor(() =>
      expect(networkApi.sendChatMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          campaignId,
          content: 'hello\nworld',
          recipient: null,
        }),
      ),
    );
  });

  it('renders the accepted message in the timeline', async () => {
    const networkApi = sendingApi();
    const { composer } = await renderPanel(networkApi);

    await typeAndSend(composer);

    await waitFor(() =>
      expect(screen.getByRole('log')).toHaveTextContent('hello world'),
    );
  });

  it('leaves a public message unlabelled', async () => {
    const networkApi = sendingApi();
    const { composer } = await renderPanel(networkApi);

    await typeAndSend(composer);
    await waitFor(() =>
      expect(screen.getByRole('log')).toHaveTextContent('hello world'),
    );

    expect(screen.queryByRole('separator')).not.toBeInTheDocument();
    expect(screen.queryByText('Public')).not.toBeInTheDocument();
  });

  it('shows the accepted time in the local format', async () => {
    const networkApi = sendingApi();
    const { composer } = await renderPanel(networkApi);

    await typeAndSend(composer);
    await waitFor(() =>
      expect(screen.getByRole('log')).toHaveTextContent('hello world'),
    );

    expect(
      screen
        .getByRole('log')
        .querySelector(`time[datetime="${authoritative.acceptedAt}"]`),
    ).toHaveTextContent(
      new Intl.DateTimeFormat(undefined, {
        dateStyle: 'short',
        timeStyle: 'short',
      }).format(new Date(authoritative.acceptedAt)),
    );
  });

  it('empties the composer and keeps it focused for the next message', async () => {
    const networkApi = sendingApi();
    const { composer } = await renderPanel(networkApi);

    await typeAndSend(composer);
    await waitFor(() => expect(composer).toHaveValue(''));

    expect(composer).toHaveFocus();
  });
});

describe('ChatPanel commands', () => {
  function whisperApi() {
    return createMockNetworkApi({
      getChatBootstrap: vi.fn(async () => ({
        ok: true as const,
        value: bootstrap(),
      })),
      sendChatMessage: vi.fn(async (input) => ({
        ok: true as const,
        value: message({
          clientMessageId: input.clientMessageId,
          content: input.content,
          recipient: { displayName: 'Bob', kind: 'player', userId: bobId },
          sender: { displayName: 'Alice', kind: 'player', userId: aliceId },
        }),
      })),
    });
  }

  it('answers /help locally without sending anything', async () => {
    const networkApi = whisperApi();
    const { composer } = await renderPanel(networkApi);

    await userEvent.type(composer, '/help{enter}');

    expect(screen.getByText('Chat help')).toBeInTheDocument();
    expect(networkApi.sendChatMessage).not.toHaveBeenCalled();
  });

  it('sends only the body of a quoted whisper, not the command', async () => {
    const networkApi = whisperApi();
    const { composer } = await renderPanel(networkApi);

    await userEvent.type(composer, '/w "Bob" secret words{enter}');

    await waitFor(() =>
      expect(networkApi.sendChatMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          content: 'secret words',
          recipient: { kind: 'player', userId: bobId },
        }),
      ),
    );
    expect(screen.queryByText('To Bob')).not.toBeInTheDocument();
  });

  it('keeps an unsent draft when the panel is hidden', async () => {
    const networkApi = whisperApi();
    const { composer, view } = await renderPanel(networkApi);

    await userEvent.type(composer, 'unfinished draft');
    view.rerender(
      <ChatPanel
        applicationApi={applicationApi}
        networkApi={networkApi}
        session={playerSession}
        visible={false}
      />,
    );

    expect(composer).toHaveValue('unfinished draft');
  });
});

describe('ChatPanel rejected sends', () => {
  function rejectingApi() {
    const sendChatMessage = vi.fn().mockResolvedValueOnce({
      error: { code: 'storage_error', message: 'Message could not be stored.' },
      ok: false,
    });
    return {
      networkApi: createMockNetworkApi({
        getChatBootstrap: vi.fn(async () => ({
          ok: true as const,
          value: bootstrap(),
        })),
        sendChatMessage,
      }),
      sendChatMessage,
    };
  }

  it('surfaces the rejection against the failed message', async () => {
    const { networkApi } = rejectingApi();
    const { composer } = await renderPanel(networkApi);

    await userEvent.type(composer, 'retry me{enter}');

    expect(
      await screen.findByText('Message could not be stored.'),
    ).toBeInTheDocument();
  });

  it('retries with the identical idempotency key', async () => {
    const { networkApi, sendChatMessage } = rejectingApi();
    const { composer } = await renderPanel(networkApi);
    await userEvent.type(composer, 'retry me{enter}');
    await screen.findByText('Message could not be stored.');

    const firstInput = sendChatMessage.mock.calls[0][0];
    sendChatMessage.mockResolvedValueOnce({
      ok: true,
      value: message({
        clientMessageId: firstInput.clientMessageId,
        content: 'retry me',
      }),
    });
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => expect(sendChatMessage).toHaveBeenCalledTimes(2));
    // A fresh key would let the host store the message twice.
    expect(sendChatMessage.mock.calls[1][0]).toEqual(firstInput);
  });

  it('drops the failure once the retry succeeds', async () => {
    const { networkApi, sendChatMessage } = rejectingApi();
    const { composer } = await renderPanel(networkApi);
    await userEvent.type(composer, 'retry me{enter}');
    await screen.findByText('Message could not be stored.');

    const firstInput = sendChatMessage.mock.calls[0][0];
    sendChatMessage.mockResolvedValueOnce({
      ok: true,
      value: message({
        clientMessageId: firstInput.clientMessageId,
        content: 'retry me',
      }),
    });
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() =>
      expect(
        screen.queryByText('Message could not be stored.'),
      ).not.toBeInTheDocument(),
    );
  });
});

describe('ChatPanel links', () => {
  const linkedMessage = message({
    content: 'Visit https://example.com/path). and example.com',
  });

  function linkedApi() {
    return createMockNetworkApi({
      getChatBootstrap: vi.fn(async () => ({
        ok: true as const,
        value: bootstrap({ messages: [linkedMessage] }),
      })),
    });
  }

  it('opens an http link through the application shell', async () => {
    const networkApi = linkedApi();
    await renderPanel(networkApi, gmSession);

    await userEvent.click(
      screen.getByRole('button', { name: 'https://example.com/path' }),
    );

    // The trailing ")." is punctuation around the link, not part of it.
    expect(applicationApi.openExternal).toHaveBeenCalledWith(
      'https://example.com/path',
    );
  });

  it('leaves a bare domain as plain text', async () => {
    const networkApi = linkedApi();
    await renderPanel(networkApi, gmSession);

    expect(screen.getByText(/example\.com$/u)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'example.com' }),
    ).not.toBeInTheDocument();
  });
});

describe('ChatPanel message limits', () => {
  function limitedApi() {
    let listener: ((event: ChatEvent) => void) | undefined;
    const networkApi = createMockNetworkApi({
      getChatBootstrap: vi.fn(async () => ({
        ok: true as const,
        value: bootstrap(),
      })),
      onChatEvent: vi.fn((nextListener) => {
        listener = nextListener;
        return () => undefined;
      }),
    });
    return { emit: (event: ChatEvent) => act(() => listener?.(event)), networkApi };
  }

  it('counts against a limit changed while the panel is open', async () => {
    const { emit, networkApi } = limitedApi();
    const { composer } = await renderPanel(networkApi, gmSession);

    emit({ campaignId, maxMessageCharacters: 100, type: 'limit_changed' });
    fireEvent.change(composer, { target: { value: 'x'.repeat(101) } });

    expect(screen.getByText('101 / 100 characters')).toBeInTheDocument();
  });

  it('withdraws the send control past the limit', async () => {
    const { emit, networkApi } = limitedApi();
    const { composer } = await renderPanel(networkApi, gmSession);

    emit({ campaignId, maxMessageCharacters: 100, type: 'limit_changed' });
    fireEvent.change(composer, { target: { value: 'x'.repeat(101) } });

    expect(
      screen.queryByRole('button', { name: 'Send message' }),
    ).not.toBeInTheDocument();
  });
});

describe('ChatPanel clearing history', () => {
  const linkedMessage = message({ content: 'Message from the old generation' });

  function clearingApi() {
    let listener: ((event: ChatEvent) => void) | undefined;
    const networkApi = createMockNetworkApi({
      clearChatHistory: vi.fn(async () => ({
        ok: true as const,
        value: { generation: nextGeneration },
      })),
      getChatBootstrap: vi.fn(async () => ({
        ok: true as const,
        value: bootstrap({ messages: [linkedMessage] }),
      })),
      onChatEvent: vi.fn((nextListener) => {
        listener = nextListener;
        return () => undefined;
      }),
    });
    return { emit: (event: ChatEvent) => act(() => listener?.(event)), networkApi };
  }

  async function clear(composer: HTMLElement) {
    fireEvent.change(composer, { target: { value: '/clear' } });
    fireEvent.keyDown(composer, { key: 'Enter' });
  }

  it('clears through the /clear command', async () => {
    const { networkApi } = clearingApi();
    const { composer } = await renderPanel(networkApi, gmSession);

    await clear(composer);

    await waitFor(() =>
      expect(networkApi.clearChatHistory).toHaveBeenCalledWith({ campaignId }),
    );
  });

  it('drops messages belonging to the previous generation', async () => {
    const { networkApi } = clearingApi();
    const { composer } = await renderPanel(networkApi, gmSession);

    await clear(composer);

    await waitFor(() =>
      expect(screen.queryByText(linkedMessage.content)).not.toBeInTheDocument(),
    );
  });

  it('says nothing on success', async () => {
    const { networkApi } = clearingApi();
    const { composer } = await renderPanel(networkApi, gmSession);

    await clear(composer);
    await waitFor(() =>
      expect(networkApi.clearChatHistory).toHaveBeenCalledWith({ campaignId }),
    );

    expect(screen.queryByText(/cleared successfully/iu)).not.toBeInTheDocument();
  });

  it('keeps a message accepted into the new generation', async () => {
    const { emit, networkApi } = clearingApi();
    const { composer } = await renderPanel(networkApi, gmSession);
    await clear(composer);
    await waitFor(() =>
      expect(networkApi.clearChatHistory).toHaveBeenCalledWith({ campaignId }),
    );

    // The clear event can arrive after a message that already belongs to the
    // generation it announces; that message must survive it.
    emit({
      campaignId,
      message: message({
        clientMessageId: '88888888-8888-4888-8888-888888888888',
        content: 'Accepted after clear',
        generation: nextGeneration,
        id: '99999999-9999-4999-8999-999999999999',
        sequence: 2,
      }),
      type: 'message',
    });
    emit({ campaignId, generation: nextGeneration, type: 'history_cleared' });

    expect(screen.getByText('Accepted after clear')).toBeInTheDocument();
  });
});
