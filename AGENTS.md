# BlackBox VTT agent guidance

This file applies to the whole repository. Treat the code, runtime schemas, and
tests as the source of truth for the current architecture. Do not create or
maintain parallel inventories of modules, request paths, or class ownership;
make those relationships clear in the code instead.

## Product and data policies

- Observable behavior is preserved unless the task explicitly requests a
  product change.
- Each release defines the sole canonical persistence and runtime data shape.
  Data created by earlier releases or development builds is intentionally
  unsupported. Do not add schema/data version ladders, upgrade migrations,
  compatibility readers or writers, fallback reads, or dual writes. During
  development, stale local data is deleted and recreated.
- The explicit campaign archive import/conversion pipeline is the only
  compatibility boundary. Archive formats are versioned at that boundary;
  historical readers, conversion logic, fixtures, and reports stay localized
  there. Import always constructs and validates a fresh canonical campaign and
  commits it atomically rather than upgrading a live campaign in place.
- A campaign on disk carries no archive envelope, so salvage recognizes the
  format its data was written in rather than reading a declared one. Format
  recognition is permitted only at the archive boundary: it matches a frozen
  historical shape exactly or refuses, and never runs in normal runtime
  repositories or validators. A near match is not a match, and a recognized
  format is converted by the same direct converter an import would use.
- A change to the canonical campaign persistence or authored-data shape is
  incomplete until the archive pipeline has been reviewed and updated in the
  same change. When the encoded archive shape changes, preserve a representative
  fixture from the previous format, advance the archive format identifier,
  update the current exporter, and add a direct previous-format-to-current
  converter. Tests must prove that the untouched historical fixture imports
  into a fresh current campaign and must assert the resulting import report.
- Archive conversion is best-effort and explicit: preserve recognizable data,
  apply current defaults where information is absent, and report every
  adjustment, omission, or failure that matters to the user. Do not silently
  discard authored content, rewrite historical fixtures to look current, chain
  conversions through intermediate application schemas, or move compatibility
  handling into normal runtime repositories and validators.
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
- Access control is one model wherever it appears: a default for every player
  plus per-user overrides, edited one subject at a time, and saved as it is
  changed rather than confirmed. Introducing a confirm step, a second editor, or
  a per-feature permission shape is a product change, not an implementation
  detail. Which subjects offer permissions at all is a product decision; today
  Journal entries and pages, Storage assets, and scenes do.

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

### Test design

- Tests assert durable product behavior, data contracts, accessibility,
  security boundaries, and user outcomes. They do not freeze incidental
  presentation.
- Do not assert exact CSS properties, CSS-module or utility class names, pixel
  dimensions, element positions, bounding-box ratios, font metrics, colors,
  borders, padding, margins, gradients, or icon/SVG implementations unless the
  task explicitly establishes the detail as a durable product requirement.
- Do not add golden-image or screenshot snapshots for ordinary application UI.
  Screenshot and pixel comparisons are appropriate when they prove that
  canvas/WebGL output appeared, disappeared, or changed, without treating a
  particular design as canonical.
- Authored visual data is behavior: tests may prove that a user's selected
  font, color, text style, stroke, or similar authored setting is validated,
  persisted, synchronized, and rendered. Tests may also enforce durable
  usability constraints such as supported-viewport fit, clipping prevention,
  focus reachability, and accessible state, but should prefer semantic or
  relative assertions over exact presentation measurements.
- Keep intentional visual-policy exceptions isolated under `src/test/design`
  and explain the durable product requirement in the test. Do not hide visual
  conformance assertions inside workflow, integration, or persistence tests.
- When a design changes, delete assertions that described the old presentation
  instead of mechanically updating expected pixels or CSS values. Reviewers
  should reject new tests coupled to incidental visual implementation.

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
