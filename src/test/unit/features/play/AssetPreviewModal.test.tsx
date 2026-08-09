import { createRef } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssetCapability, AssetPreview, AssetView } from '../../../../shared/assets';
import { AssetPreviewModal } from '../../../../features/play/AssetPreviewModal';

const pdfMocks = vi.hoisted(() => ({
  destroy: vi.fn(async () => undefined),
  getDocument: vi.fn(),
  getPage: vi.fn(),
  render: vi.fn(),
}));

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument: pdfMocks.getDocument,
}));

const capabilities: AssetCapability = {
  delete: true,
  import: true,
  list: true,
  preview: true,
  read: true,
  rename: true,
  reorder: true,
};

function asset(format: AssetView['format'], kind: AssetView['kind']): AssetView {
  const isPdf = format === 'pdf';
  const isText = format === 'text';
  const displayName = isPdf ? 'Rules.pdf' : isText ? 'Notes.txt' : 'Theme.mp3';
  return {
    available: true,
    capabilities,
    chunkHashes: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    createdBy: 'gm',
    displayName,
    extension: format,
    fileModifiedAtMs: 1,
    format,
    id: '11111111-1111-4111-8111-111111111111',
    kind,
    lastModifiedAt: '2026-01-01T00:00:00.000Z',
    lastModifiedBy: 'gm',
    mimeType: isPdf ? 'application/pdf' : isText ? 'text/plain' : 'audio/mpeg',
    originalFilename: displayName,
    revision: 1,
    sha256: 'a'.repeat(64),
    sizeBytes: 128,
    syncState: 'ready',
  };
}

function preview(
  format: AssetPreview['format'],
  kind: AssetPreview['kind'],
): AssetPreview {
  const isPdf = format === 'pdf';
  const isText = format === 'text';
  return {
    assetId: '11111111-1111-4111-8111-111111111111',
    displayName: isPdf ? 'Rules.pdf' : isText ? 'Notes.txt' : 'Theme.mp3',
    format,
    kind,
    mimeType: isPdf ? 'application/pdf' : isText ? 'text/plain' : 'audio/mpeg',
    token: 'preview-token',
    url: 'blackbox-asset://preview-token/11111111-1111-4111-8111-111111111111',
  };
}

describe('AssetPreviewModal', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    pdfMocks.destroy.mockClear();
    pdfMocks.getDocument.mockReset();
    pdfMocks.getPage.mockReset();
    pdfMocks.render.mockReset();
  });

  it('fetches opaque PDF bytes before loading and renders a complete page', async () => {
    const pdfBytes = new Uint8Array([37, 80, 68, 70, 45]);
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(pdfBytes));
    pdfMocks.render.mockReturnValue({
      cancel: vi.fn(),
      promise: Promise.resolve(),
    });
    pdfMocks.getPage.mockResolvedValue({
      getViewport: ({ scale }: { scale: number }) => ({
        height: 800 * scale,
        width: 600 * scale,
      }),
      render: pdfMocks.render,
    });
    pdfMocks.getDocument.mockReturnValue({
      destroy: pdfMocks.destroy,
      promise: Promise.resolve({
        getPage: pdfMocks.getPage,
        numPages: 2,
      }),
    });
    // `never` satisfies every getContext overload, including the WebGPU one
    // that pixi.js pulls into the global scope.
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      {} as never,
    );

    render(
      <AssetPreviewModal
        asset={asset('pdf', 'document')}
        preview={preview('pdf', 'document')}
        returnFocusRef={createRef<HTMLElement>()}
        onDismiss={vi.fn()}
      />,
    );

    expect(await screen.findByLabelText('PDF page 1')).toBeVisible();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/^blackbox-asset:/),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(pdfMocks.getDocument).toHaveBeenCalledWith({
      data: expect.any(Uint8Array),
    });
    await waitFor(() => expect(pdfMocks.render).toHaveBeenCalled());
    expect(screen.getByText('1 / 2')).toBeVisible();
  });

  it('provides themed playback, a seekable waveform, and full-width volume control', async () => {
    const user = userEvent.setup();
    const { container, unmount } = render(
      <AssetPreviewModal
        asset={asset('mp3', 'audio')}
        preview={preview('mp3', 'audio')}
        returnFocusRef={createRef<HTMLElement>()}
        onDismiss={vi.fn()}
      />,
    );

    expect(screen.getByText('Theme.mp3')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Play audio' })).toBeVisible();
    const position = screen.getByRole('slider', { name: 'Audio position' });
    expect(position).toBeVisible();
    expect(position).toBeDisabled();
    const volumeControl = screen.getByRole('slider', {
      name: 'Audio volume',
    });
    expect(volumeControl).toBeVisible();
    expect(volumeControl).toHaveValue('0.5');
    expect(screen.queryByText('Audio preview')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Mute audio' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Ready')).not.toBeInTheDocument();

    const audio = container.querySelector('audio')!;
    expect(audio.volume).toBe(0.5);
    const play = vi
      .spyOn(HTMLMediaElement.prototype, 'play')
      .mockResolvedValue(undefined);
    const pause = vi
      .spyOn(HTMLMediaElement.prototype, 'pause')
      .mockImplementation(() => undefined);

    await user.click(screen.getByRole('button', { name: 'Play audio' }));
    expect(play).toHaveBeenCalledOnce();
    fireEvent.play(audio);
    expect(
      screen.getByRole('button', { name: 'Pause audio' }),
    ).toBeVisible();

    Object.defineProperty(audio, 'paused', {
      configurable: true,
      value: false,
    });
    await user.click(screen.getByRole('button', { name: 'Pause audio' }));
    expect(pause).toHaveBeenCalledOnce();
    fireEvent.pause(audio);

    Object.defineProperty(audio, 'duration', {
      configurable: true,
      value: 150,
    });
    fireEvent.durationChange(audio);
    expect(position).toBeEnabled();
    Object.defineProperty(audio, 'currentTime', {
      configurable: true,
      value: 65,
      writable: true,
    });
    fireEvent.timeUpdate(audio);
    expect(position).toHaveValue('65');

    fireEvent.change(position, { target: { value: '90' } });
    expect(audio.currentTime).toBe(90);
    expect(position).toHaveValue('90');

    fireEvent.change(volumeControl, { target: { value: '0.75' } });
    expect(audio.volume).toBe(0.75);
    unmount();
  });

  it('wraps text in a narrow vertically scrollable view without pagination', async () => {
    const text = Array.from(
      { length: 100 },
      (_, index) =>
        `${index + 1}. A long literal line that must wrap instead of creating horizontal overflow.`,
    ).join('\n\n');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(text));

    render(
      <AssetPreviewModal
        asset={asset('text', 'document')}
        preview={preview('text', 'document')}
        returnFocusRef={createRef<HTMLElement>()}
        onDismiss={vi.fn()}
      />,
    );

    const documentView = await screen.findByRole('document', {
      name: 'Text preview of Notes.txt',
    });
    const documentStyle = window.getComputedStyle(documentView);
    const pageStyle = window.getComputedStyle(
      documentView.querySelector('pre')!,
    );

    expect(documentStyle.overflowX).toBe('hidden');
    expect(documentStyle.overflowY).toBe('auto');
    expect(pageStyle.whiteSpace).toBe('pre-wrap');
    expect(
      screen.queryByRole('button', { name: 'Next text page' }),
    ).not.toBeInTheDocument();
  });
});
