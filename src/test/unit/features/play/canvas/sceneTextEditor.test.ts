import { afterEach, describe, expect, it, vi } from 'vitest';
import { SceneTextEditorController } from '../../../../../features/play/canvas/sceneTextEditor';

function createEditor(onCommit: () => Promise<string | null>) {
  const container = document.createElement('section');
  document.body.appendChild(container);
  const onClose = vi.fn();
  const editor: SceneTextEditorController = new SceneTextEditorController({
    container,
    draft: {
      layer: 'token',
      originalId: null,
      point: { x: 10, y: 20 },
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      style: {
        fontFamily: 'inter',
        fontSize: 64,
        fontWeight: 400,
        primaryColor: '#ffffff',
        strokeColor: '#000000',
        strokeWidth: 8,
      },
    },
    editorClassName: 'editor',
    errorClassName: 'error',
    initialContent: 'Draft text',
    label: 'New map text',
    onChange: vi.fn(),
    onClose,
    onCommit,
  });
  return { container, editor, onClose };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('SceneTextEditorController', () => {
  it('keeps the exact draft open and exposes a commit error', async () => {
    const onCommit = vi.fn(async () => 'Text can contain at most 32 lines.');
    const { container, editor, onClose } = createEditor(onCommit);
    editor.textarea.value = 'unchanged\nlocal\ndraft';

    await expect(editor.commit()).resolves.toBe(false);

    expect(container.contains(editor.textarea)).toBe(true);
    expect(editor.textarea.value).toBe('unchanged\nlocal\ndraft');
    expect(editor.textarea).toHaveAttribute('aria-invalid', 'true');
    expect(container.querySelector('[role="alert"]')).toHaveTextContent(
      'Text can contain at most 32 lines.',
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes only after a successful commit', async () => {
    const { container, editor, onClose } = createEditor(async () => null);

    await expect(editor.commit()).resolves.toBe(true);

    expect(container.contains(editor.textarea)).toBe(false);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('cancels immediately with Escape', () => {
    const { container, editor, onClose } = createEditor(async () => null);

    editor.textarea.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }),
    );

    expect(container.contains(editor.textarea)).toBe(false);
    expect(onClose).toHaveBeenCalledOnce();
  });
});
