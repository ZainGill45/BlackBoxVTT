import styles from './contextMenu.module.css';

export type ContextMenuEntry =
  | {
      ariaLabel?: string;
      danger?: boolean;
      disabled?: boolean;
      kind: 'action';
      label: string;
      /** Return false to keep the menu open, for armed destructive actions. */
      onSelect: (button: HTMLButtonElement) => boolean | void;
    }
  | { kind: 'divider' };

/**
 * Accessible, viewport-aware context menu shared by canvas and DOM collections.
 *
 * Appearance is owned here rather than passed in. Callers described their own
 * classes once, and four near-identical copies drifted apart; the menu a user
 * opens on a Journal row and the one they open on the scene are the same menu,
 * so they are also the same stylesheet.
 */
export class ContextMenuController {
  private menu: HTMLDivElement | null = null;
  private outsideListener: ((event: Event) => void) | null = null;

  close(): void {
    this.menu?.remove();
    this.menu = null;
    if (this.outsideListener) {
      document.removeEventListener('pointerdown', this.outsideListener, true);
      this.outsideListener = null;
    }
  }

  open(
    clientX: number,
    clientY: number,
    ariaLabel: string,
    entries: ContextMenuEntry[],
    returnFocus?: () => void,
    mount?: HTMLElement,
  ): void {
    this.close();
    const menu = document.createElement('div');
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', ariaLabel);
    menu.className = styles.menu;
    menu.style.left = `${clientX}px`;
    menu.style.top = `${clientY}px`;
    for (const entry of entries) {
      if (entry.kind === 'divider') {
        const divider = document.createElement('div');
        divider.className = styles.divider;
        divider.role = 'separator';
        menu.appendChild(divider);
        continue;
      }
      const button = document.createElement('button');
      button.type = 'button';
      button.role = 'menuitem';
      button.textContent = entry.label;
      button.disabled = entry.disabled ?? false;
      button.className = entry.danger
        ? `${styles.item} ${styles.delete}`
        : styles.item;
      if (entry.danger) button.setAttribute('aria-pressed', 'false');
      if (entry.ariaLabel) button.setAttribute('aria-label', entry.ariaLabel);
      button.addEventListener('click', () => {
        const shouldClose = entry.onSelect(button) !== false;
        if (shouldClose) this.close();
      });
      menu.appendChild(button);
    }
    (mount ?? document.body).appendChild(menu);
    this.menu = menu;
    const bounds = menu.getBoundingClientRect();
    const padding = 8;
    menu.style.left = `${Math.max(padding, Math.min(clientX, window.innerWidth - bounds.width - padding))}px`;
    menu.style.top = `${Math.max(padding, Math.min(clientY, window.innerHeight - bounds.height - padding))}px`;
    menu.addEventListener('keydown', (event) => {
      const buttons = [...menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (event.key === 'Escape') {
        event.preventDefault();
        this.close();
        returnFocus?.();
      } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        const next = event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? buttons.length - 1
            : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next]?.focus();
      }
    });
    menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    this.outsideListener = (event) => {
      if (!menu.contains(event.target as Node)) this.close();
    };
    queueMicrotask(() => {
      if (this.menu === menu && this.outsideListener) {
        document.addEventListener('pointerdown', this.outsideListener, true);
      }
    });
  }
}
