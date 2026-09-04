# Electron IPC Validation

## Responsibility

IPC validation prevents untrusted pages, frames, or malformed values from invoking privileged main-process behavior.

## Sender Validation

Every privileged handler calls the shared sender verifier before doing work. A request is accepted only when:

- its sender is the web contents belonging to the application window;
- it comes from the main frame;
- during development, its origin matches the configured renderer development origin; or
- in production, its URL resolves to the packaged renderer entry file after query and hash removal.

## Payload Validation

Sender validation establishes where a request came from; it does not establish that the request data is valid. Game creation validates its payload with `GameSchema` in both the renderer and main process. Game listing validates stored data in the main process and the returned array in the renderer.

## Why It Works This Way

The main process owns filesystem and application privileges. Trusting only the intended window, frame, and origin contains those privileges even if another page or embedded frame can reach an IPC channel. Schema validation separately protects the domain boundary from malformed data.

## Invariants

- Privileged work starts only after sender validation succeeds.
- Development and packaged builds have separate trusted-location rules.
- URL query strings and fragments cannot change which packaged file is trusted.
- Payload validation is explicit for each channel and is not implied by sender validation.

## Gotchas

- Adding a handler without the verifier creates a new unprotected privileged path.
- A valid sender can still send invalid data.
- The delete-game handler currently lacks `GameSchema` validation for its incoming payload.
- Development trust depends on the configured renderer URL matching the actual development server origin.

## Change Surface

- `src/main/main.ts`
- `src/main/ipcVerifier.ts`
- `src/shared/schemas/game.ts`
- `src/renderer/preload.ts`

## Verification

Exercise handlers from the application main frame, a child frame, a different origin, and a mismatched web contents. Separately test malformed payloads from an otherwise valid sender.
