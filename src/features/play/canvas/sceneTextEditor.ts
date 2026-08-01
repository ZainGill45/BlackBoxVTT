import {
  MAX_TEXT_CHARACTERS,
  type SceneLayer,
  type SceneTextStyle,
} from '../../../shared/scenes';

export interface SceneTextEditorDraft {
  layer: SceneLayer;
  originalId: string | null;
  point: { x: number; y: number };
  rotation: number;
  scaleX: number;
  scaleY: number;
  style: SceneTextStyle;
}

export interface SceneTextEditorLayout {
  fontFamily: string;
  fontSize: number;
  left: number;
  minimumHeight: number;
  minimumWidth: number;
  padding: number;
  previewHeight: number;
  previewWidth: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  top: number;
}

interface SceneTextEditorOptions {
  container: HTMLElement;
  draft: SceneTextEditorDraft;
  editorClassName: string;
  errorClassName: string;
  initialContent: string;
  label: string;
  onChange: () => void;
  onClose: () => void;
  onCommit: () => Promise<string | null>;
}

/** Owns the transient DOM and event lifecycle for one local text draft. */
export class SceneTextEditorController {
  readonly draft: SceneTextEditorDraft;
  readonly textarea: HTMLTextAreaElement;
  private committing = false;
  private disposed = false;
  private readonly error: HTMLDivElement;
  private readonly onChange: () => void;
  private readonly onClose: () => void;
  private readonly onCommit: () => Promise<string | null>;

  constructor({
    container,
    draft,
    editorClassName,
    errorClassName,
    initialContent,
    label,
    onChange,
    onClose,
    onCommit,
  }: SceneTextEditorOptions) {
    this.draft = draft;
    this.onChange = onChange;
    this.onClose = onClose;
    this.onCommit = onCommit;

    const textarea = document.createElement('textarea');
    this.textarea = textarea;
    textarea.className = editorClassName;
    textarea.value = initialContent;
    textarea.maxLength = MAX_TEXT_CHARACTERS;
    textarea.rows = 1;
    textarea.spellcheck = false;
    textarea.wrap = 'off';
    textarea.setAttribute('aria-label', label);

    const error = document.createElement('div');
    this.error = error;
    error.className = errorClassName;
    error.hidden = true;
    error.id = `scene-text-error-${crypto.randomUUID()}`;
    error.setAttribute('role', 'alert');
    textarea.setAttribute('aria-describedby', error.id);

    const stopPointer = (event: Event) => event.stopPropagation();
    textarea.addEventListener('pointerdown', stopPointer);
    textarea.addEventListener('click', stopPointer);
    textarea.addEventListener('dblclick', stopPointer);
    textarea.addEventListener('input', () => {
      this.clearError();
      this.onChange();
    });
    textarea.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Escape') {
        event.preventDefault();
        this.cancel();
      } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        void this.commit();
      }
    });
    textarea.addEventListener('blur', () => {
      if (!this.disposed && !this.committing) {
        void this.commit();
      }
    });
    container.appendChild(textarea);
    container.appendChild(error);
    queueMicrotask(() => {
      if (!this.disposed) {
        textarea.focus();
        textarea.select();
      }
    });
  }

  get content(): string {
    return this.textarea.value.replace(/\r\n?/gu, '\n');
  }

  layout(input: SceneTextEditorLayout): void {
    Object.assign(this.textarea.style, {
      fontFamily: input.fontFamily,
      fontSize: `${input.fontSize}px`,
      fontWeight: String(this.draft.style.fontWeight),
      left: `${input.left}px`,
      lineHeight: 'normal',
      padding: `${input.padding}px`,
      top: `${input.top}px`,
      transform: `translate(-50%, -50%) rotate(${input.rotation}deg) scale(${input.scaleX}, ${input.scaleY})`,
    });
    this.textarea.style.width = '1px';
    this.textarea.style.height = '1px';
    const width = Math.max(
      input.minimumWidth,
      this.textarea.scrollWidth + 2,
      input.previewWidth,
    );
    const height = Math.max(
      input.minimumHeight,
      this.textarea.scrollHeight + 2,
      input.previewHeight,
    );
    this.textarea.style.width = `${width}px`;
    this.textarea.style.height = `${height}px`;
    Object.assign(this.error.style, {
      left: `${input.left}px`,
      top: `${input.top + (height * Math.abs(input.scaleY)) / 2 + 8}px`,
      transform: 'translateX(-50%)',
    });
  }

  async commit(): Promise<boolean> {
    if (this.disposed || this.committing) {
      return false;
    }
    this.committing = true;
    this.clearError();
    this.textarea.readOnly = true;
    this.textarea.setAttribute('aria-busy', 'true');
    let message: string | null;
    try {
      message = await this.onCommit();
    } catch {
      message = 'Text could not be saved. Try again.';
    }
    if (this.disposed) {
      return message === null;
    }
    this.committing = false;
    this.textarea.readOnly = false;
    this.textarea.removeAttribute('aria-busy');
    if (message) {
      this.showError(message);
      queueMicrotask(() => {
        if (!this.disposed) {
          this.textarea.focus();
        }
      });
      return false;
    }
    this.dispose();
    return true;
  }

  cancel(): void {
    if (!this.disposed) {
      this.dispose();
    }
  }

  private clearError(): void {
    this.error.hidden = true;
    this.error.textContent = '';
    this.textarea.removeAttribute('aria-invalid');
  }

  private showError(message: string): void {
    this.error.textContent = message;
    this.error.hidden = false;
    this.textarea.setAttribute('aria-invalid', 'true');
  }

  private dispose(): void {
    this.disposed = true;
    this.textarea.remove();
    this.error.remove();
    this.onClose();
  }
}
