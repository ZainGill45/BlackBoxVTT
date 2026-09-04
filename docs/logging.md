# Logging

## Responsibility

Logging provides bounded runtime diagnostics inside the application and a developer console for inspecting those messages.

## How It Works

Renderer messages pass through the logger. Values are converted into displayable strings, assigned a timestamp and identifier, and appended to an in-memory history capped at 512 entries. Main-process logging broadcasts a message object to every application window, but no renderer code currently registers the exposed listener.

The in-application console is toggled with the backquote key. It displays history, follows new output, and accepts `help`, `clear`, and `ping` commands.

## Why It Works This Way

An in-application history makes runtime behavior visible without requiring users or developers to keep a terminal open. A fixed maximum prevents a long-running session from growing memory usage without bound. Vue renders log content as text, so normalized values are not interpreted as HTML.

## Invariants

- Renderer log values are normalized to strings before display.
- History retains at most 512 entries.
- Logs are session-local and are not written to a persistent log file.
- The supported console commands are `help`, `clear`, and `ping`.

## Gotchas

- Identifiers are based on `Date.now()` and can collide when multiple messages are created in the same millisecond.
- Locale-formatted timestamps are useful for display but are not a stable serialization format.
- Main-process messages are currently broadcast but absent from the in-application history because `onMainLogged` is never called.
- Main-process broadcasts send one message object, while Electron listener callbacks receive an event argument first. The current preload adapter passes both callback arguments directly to `log`, so main-process messages do not currently become the intended renderer entries.
- A command appearing in completion or help text is not sufficient evidence that it is implemented; only commands with handlers are supported.

## Change Surface

- `src/renderer/logger.ts`
- `src/renderer/templates/ConsoleContainer.vue`
- `src/renderer/templates/LogEntry.vue`
- `src/main/logger.ts`
- `src/renderer/preload.ts`
- `src/global.d.ts`

## Verification

Verify string normalization, the 512-entry rollover, console toggling, each supported command, and automatic scrolling. Treat main-process relay as a known unconnected path until startup registration and payload unpacking are both implemented and verified.
