# Electron Preload API

## Responsibility

The preload API is the renderer's narrow bridge to privileged Electron and filesystem operations. Renderer code does not receive direct Node.js or Electron access.

## Exposed Interface

- `requestEnsureFileSystemStructure()` prepares the application data layout.
- `requestGameEntryData()` returns the locally stored games.
- `requestCreateGame(game)` creates a game container.
- `requestDeleteGame(game)` deletes a game container.
- `requestApplicationExit()` requests application shutdown.
- `onMainLogged()` registers the current main-process log listener.

Request methods use `ipcRenderer.invoke` and return the corresponding handler result. `onMainLogged` is a registration call rather than a request and has different semantics from those methods.

## Why It Works This Way

The renderer only needs a small set of application capabilities. Exposing those capabilities individually keeps the process boundary understandable and prevents UI code from acquiring unrestricted filesystem or IPC access.

## Invariants

- Renderer features call `window.electronAPI`, not Electron modules directly.
- Channel names must match between the preload registration and main-process handler.
- The TypeScript declaration for `window.electronAPI` must match the runtime object exposed by the preload script.
- Main-process handlers remain responsible for sender and payload validation.

## Gotchas

- A renderer served outside Electron, such as a standalone Vite page, does not have `window.electronAPI` unless a test supplies it.
- No renderer code currently calls `onMainLogged`, so the listener is not registered during startup.
- Electron listener callbacks receive the IPC event before the transmitted payload. The current adapter passes those two arguments directly to `log`, even though the main process sends one `{ content, type }` object. Relayed main-process messages therefore do not currently become the intended renderer log entry.
- The declaration says `onMainLogged` accepts a `Log`, while its runtime implementation accepts no arguments.
- Calling `onMainLogged` repeatedly creates repeated listeners; the current interface does not return an unsubscribe function.

## Change Surface

- `src/renderer/preload.ts`
- `src/global.d.ts`
- `src/main/main.ts`
- `src/main/logger.ts`
- `src/renderer/logger.ts`

## Verification

Type-check the exposed request methods and invoke each one through a real Electron window. Before changing log relay behavior, reproduce both current constraints: startup does not register the listener, and manually registering it does not unpack the transmitted message object correctly.
