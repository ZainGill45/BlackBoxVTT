export type ContextMenuEntry =
  | {
      ariaLabel?: string;
      danger?: boolean;
      disabled?: boolean;
      kind: 'action';
      label: string;
      onSelect: () => void;
    }
  | { kind: 'divider' };

interface ContextMenuStyles {
  deleteItem: string;
  divider: string;
  item: string;
  menu: string;
}

/** Owns the accessible DOM lifecycle for the canvas context menu. */
export class ContextMenuController {
  private menu: HTMLDivElement | null = null;
  private outsideListener: ((event: Event) => void) | null = null;

  constructor(private readonly styles: ContextMenuStyles) {}

  close(): void {
    this.menu?.remove();
    this.menu = null;
    if (this.outsideListener) {
      document.removeEventListener(
        'pointerdown',
        this.outsideListener,
        true,
      );
      this.outsideListener = null;
    }
  }

  open(
    clientX: number,
    clientY: number,
    ariaLabel: string,
    entries: ContextMenuEntry[],
    returnFocus?: () => void,
  ): void {
    this.close();
    const menu = document.createElement('div');
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', ariaLabel);
    menu.className = this.styles.menu;
    menu.style.left = `${clientX}px`;
    menu.style.top = `${clientY}px`;

    for (const entry of entries) {
      if (entry.kind === 'divider') {
        const divider = document.createElement('div');
        divider.className = this.styles.divider;
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
        ? `${this.styles.item} ${this.styles.deleteItem}`
        : this.styles.item;
      if (entry.ariaLabel) {
        button.setAttribute('aria-label', entry.ariaLabel);
      }
      button.addEventListener('click', () => {
        this.close();
        entry.onSelect();
      });
      menu.appendChild(button);
    }

    document.body.appendChild(menu);
    this.menu = menu;
    const bounds = menu.getBoundingClientRect();
    const viewportPadding = 8;
    menu.style.left = `${Math.max(
      viewportPadding,
      Math.min(clientX, window.innerWidth - bounds.width - viewportPadding),
    )}px`;
    menu.style.top = `${Math.max(
      viewportPadding,
      Math.min(clientY, window.innerHeight - bounds.height - viewportPadding),
    )}px`;

    menu.addEventListener('keydown', (event) => {
      const buttons = [
        ...menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
      ];
      const current = buttons.indexOf(
        document.activeElement as HTMLButtonElement,
      );
      if (event.key === 'Escape') {
        event.preventDefault();
        this.close();
        returnFocus?.();
      } else if (
        event.key === 'ArrowDown' ||
        event.key === 'ArrowUp' ||
        event.key === 'Home' ||
        event.key === 'End'
      ) {
        event.preventDefault();
        const next =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? buttons.length - 1
              : (current +
                  (event.key === 'ArrowDown' ? 1 : -1) +
                  buttons.length) %
                buttons.length;
        buttons[next]?.focus();
      }
    });
    menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    const close = (event: Event) => {
      if (!menu.contains(event.target as Node)) {
        this.close();
      }
    };
    this.outsideListener = close;
    queueMicrotask(() => {
      if (this.menu === menu) {
        document.addEventListener('pointerdown', close, true);
      }
    });
  }
}
