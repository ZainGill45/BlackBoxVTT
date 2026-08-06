# BlackBox VTT agent guidance

This file applies to the whole repository. Treat the code, runtime schemas, and
tests as the source of truth for the current architecture. Do not create or
maintain parallel inventories of modules, request paths, or class ownership;
make those relationships clear in the code instead.

## Product and data policies

- Observable behavior is preserved unless the task explicitly requests a
  product change.
- Campaigns created before the SQLite-only storage design are intentionally
  unsupported. Do not add importers, compatibility migrations, fallback reads,
  or dual writes unless the user explicitly changes that policy.
- Each local campaign's authoritative structured state is in
  `campaign.sqlite`. Application-wide saved connections and remote-cache
  metadata are in `userData/data/application.sqlite`.
- Asset payloads remain ordinary files under `content/assets` because they are
  streamed, chunked, and moved through the operating system's trash. Campaign
  TLS certificates and private keys remain files under `content/network`
  because their file permissions and TLS consumption matter. Do not move these
  payloads into SQLite without an explicit product decision.
- Saved passwords remain encrypted with Electron `safeStorage`; changing the
  database container does not permit storing plaintext credentials.
- Scene operation idempotency is durable. Undo/redo history and transform locks
  are intentionally process-lifetime state: committed scene data survives a
  restart, but edit history and live leases do not.

## Game systems and authored Journal content

- BlackBox VTT does not bundle premade characters, monsters, items, spells, or
  similar campaign content. The active game system supplies authoring
  structure and behavior; the GM and players author the records they use.
- Core Journal infrastructure must remain game-system neutral. It may own
  generic record concerns such as identity, titles, hierarchy, ordering,
  grouping mechanics, search, permissions, persistence, and synchronization,
  but it must not define a particular game's record taxonomy or rules.
- Core defines the universal Note entry available in every campaign. The
  active bundled system contributes additional Journal entry types and groups
  and owns those entries' schemas and defaults, editors and sheets, validation
  and derived values, roll automation, searchable-field extraction, and
  relationships to scene tokens or other authored entries.
- D&D-specific concepts belong to the `dnd5e` system. Do not introduce
  `core.character`, `core.monster`, `core.item`, `core.spell`, or equivalent
  universal types. If the required system extension contract does not exist,
  establish that contract instead of bypassing the system boundary.
- Do not treat the core Note implementation as precedent for making additional
  game-system concepts core types. Notes are universal; characters and other
  rules-owned records are not.
- The `dnd5e` system owns its 5e/5.5e behavior through system settings. Do not
  invent per-character rules-version fields or overrides unless the product
  explicitly introduces them.
- A scene token may reference an authored system record, but core scene state
  owns only system-neutral spatial and reference data. The active system owns
  the distinction between a shared record definition and per-scene instance
  state such as current health or conditions.

## Trust boundaries

- Renderer IPC and remote network input are separate trust boundaries. Validate
  data at each boundary and derive the actor from the authenticated sender or
  connection; never accept an actor identity supplied by a renderer or peer.
- Keep network protocols explicitly versioned. Do not replace explicit IPC or
  TCP operations with a generic dispatcher that could expose a local-only
  capability remotely.

## Verification

- `npm test` runs the unit and integration suite.
- `npm run typecheck` checks production and test contracts.
- `npm run lint` also runs the design-rule suite.
- `npm run package` verifies the production Electron bundle.
- `npm run test:e2e` builds and drives real Electron processes, WebGL, SQLite,
  TLS, TCP, and UDP. It is intentionally serial; do not parallelize it.
- Use focused checks while iterating, then run every validation gate affected
  by the change. Preserve real boundary tests rather than replacing them with
  mocks.

Update this file only when one of these non-code policies changes. Architectural
structure and extension instructions belong in types, schemas, focused modules,
and executable tests.
