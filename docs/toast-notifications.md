# Toast Notifications

## Responsibility

Toast notifications surface brief, user-relevant information without interrupting the current workflow.

## How It Works

The toast controller creates notifications with a session-local numeric identifier, normalized content, and one of three severities: `info`, `warning`, or `error`. A notification remains visible for five seconds. Before adding a notification, the oldest one is removed when three are already present, so at most three can be visible after insertion.

Creating and removing a toast also emits lifecycle information through the logging system.

## Why It Works This Way

Toasts are transient feedback rather than durable application state. Limiting the visible stack keeps repeated failures or actions from covering the interface. Normalizing unknown values produces predictable message text, and Vue renders that content as text rather than HTML.

## Invariants

- Toast content is normalized to a string before display.
- At most three notifications are visible.
- Each notification expires automatically after five seconds.
- Severity is one of `info`, `warning`, or `error`.
- Toast lifecycle events are logged.

## Gotchas

- There is no manual dismissal control.
- Toasts are not persisted and disappear when the renderer session ends.
- An older toast may be removed early when a fourth toast is added.
- Identifiers are unique only within the current renderer module session.

## Change Surface

- `src/renderer/toast.ts`
- `src/renderer/templates/ToastContainer.vue`
- `src/renderer/templates/ToastEntry.vue`
- `src/renderer/logger.ts`

## Verification

Verify all three severities, content normalization, automatic expiry, and insertion of four notifications in quick succession. The visible collection must never exceed three.
