import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  DiagnosticEvent,
  DiagnosticEventInput,
  DiagnosticSnapshot,
  DiagnosticsApi,
} from '../../../../shared/diagnostics';
import { DiagnosticConsole } from '../../../../features/diagnostics/DiagnosticConsole';

function createApi() {
  let listener: ((event: DiagnosticEvent) => void) | null = null;
  let nextId = 1;
  const record = vi.fn((input: DiagnosticEventInput) => {
    listener?.({
      category: input.category,
      id: nextId++,
      kind: input.kind ?? 'log',
      level: input.level,
      message: input.message,
      occurredAt: '2026-08-24T20:00:00.000Z',
      source: 'renderer',
    });
  });
  const api: DiagnosticsApi = {
    clear: vi.fn(async () => undefined),
    inspect: vi.fn(async (input) => ({
      provider: input.provider,
      value: { state: 'ready' },
    })),
    onChanged: vi.fn((next) => {
      listener = next;
      return () => {
        listener = null;
      };
    }),
    onOpenRequested: vi.fn(() => () => undefined),
    record,
    snapshot: vi.fn(async () => ({
      capabilities: {
        development: true,
        providers: ['instance', 'renderer'] as DiagnosticSnapshot['capabilities']['providers'],
      },
      context: { screen: 'connection' as const },
      events: [],
      instance: {
        appVersion: '1.0.0',
        electronVersion: '43.2.0',
        environment: 'development' as const,
        id: 'instance',
        label: 'default',
        platform: 'win32',
        processId: 42,
        profileKind: 'persistent' as const,
        startedAt: '2026-08-24T20:00:00.000Z',
      },
      stats: {
        bytes: 0,
        discarded: { debug: 0, error: 0, info: 0, warn: 0 },
        events: 0,
        truncated: 0,
      },
    })),
    updateContext: vi.fn(),
  };
  return api;
}

beforeEach(() => sessionStorage.clear());

describe('DiagnosticConsole', () => {
  it('opens on Backquote outside editable content and makes the app inert', async () => {
    const api = createApi();
    render(
      <DiagnosticConsole api={api}>
        <button type="button">Application action</button>
      </DiagnosticConsole>,
    );
    await waitFor(() => expect(api.snapshot).toHaveBeenCalled());

    fireEvent.keyDown(window, { code: 'Backquote', key: '`' });

    expect(screen.getByRole('dialog', { name: 'Developer console' })).toBeVisible();
    expect(screen.getByText('Application action').parentElement)
      .toHaveAttribute('inert');
    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: 'Console command' })).toHaveFocus();
    });
  });

  it('does not steal Backquote from editable application content', async () => {
    const api = createApi();
    render(
      <DiagnosticConsole api={api}>
        <input aria-label="Journal title" />
      </DiagnosticConsole>,
    );
    const editor = screen.getByRole('textbox', { name: 'Journal title' });
    editor.focus();

    fireEvent.keyDown(editor, { code: 'Backquote', key: '`' });

    expect(screen.queryByRole('dialog', { name: 'Developer console' })).toBeNull();
  });

  it('runs commands in one output stream and supports history', async () => {
    const user = userEvent.setup();
    const api = createApi();
    render(
      <DiagnosticConsole api={api}>
        <div>Application</div>
      </DiagnosticConsole>,
    );
    fireEvent.keyDown(window, { code: 'Backquote', key: '`' });
    const input = screen.getByRole('textbox', { name: 'Console command' });

    await user.type(input, 'inspect instance{Enter}');

    await waitFor(() => expect(api.inspect).toHaveBeenCalledWith({
      check: false,
      content: false,
      provider: 'instance',
    }));
    expect(screen.getByRole('log', { name: 'Console output' })).toHaveTextContent(
      '> inspect instance',
    );
    expect(screen.getByRole('log', { name: 'Console output' })).toHaveTextContent(
      'state: ready',
    );
    await user.type(input, '{ArrowUp}');
    expect(input).toHaveValue('inspect instance');
  });

  it('closes with Escape and restores application interactivity', () => {
    const api = createApi();
    render(
      <DiagnosticConsole api={api}>
        <button type="button">Application action</button>
      </DiagnosticConsole>,
    );
    fireEvent.keyDown(window, { code: 'Backquote', key: '`' });

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(screen.queryByRole('dialog', { name: 'Developer console' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Application action' }).parentElement)
      .not.toHaveAttribute('inert');
  });
});
