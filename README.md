# Rimmap modular application

## Desktop app (Tauri v2)

Rimmap includes a thin Tauri v2 desktop shell in `src-tauri/`. The board itself remains the same Vite/TypeScript application. Tauri provides the native Windows window plus the official dialog/filesystem plugins used for desktop Open/Save and the window-close hook used for Rimmap's unsaved-changes dialog. There are still no custom Rust business-logic commands, updater, shell integration, telemetry, or native canvas code.

- Browser development: `npm run dev`
- Desktop development: `npm run desktop:dev`
- Windows release build: `npm run desktop:build`
- Easier Windows build: double-click `build-windows.bat` after the one-time prerequisites are installed.

See `BUILD_WINDOWS.md` for the exact Windows prerequisites and output locations. The application release is **Rimmap 1.0.0**; this is independent of the persisted board **schema v12**.

Desktop behavior intentionally differs from the browser development build where the operating system/browser owns reserved shortcuts:

- **New:** `Ctrl+N` in the desktop app. A stored untouched legacy default of `Ctrl+Alt+N` is migrated automatically; user-customized bindings are preserved.
- **Save:** the first `Ctrl+S` for a board without a native file path opens the Windows Save dialog. After a board is saved or opened from disk, `Ctrl+S` writes back to that same file.
- **Save As:** `Ctrl+Shift+S` always opens the Windows Save dialog and, after a successful save, makes the chosen file the target for future `Ctrl+S` saves.
- **Open:** uses the native Windows file picker in Tauri and the existing browser fallback during browser development/testing.
- **Exit / window X:** if the board has unsaved changes, Rimmap shows its own rounded **Unsaved changes** dialog with **Save & exit**, **Exit without saving**, and **Cancel**. Browser-style `tauri.localhost says` alert/confirm/prompt boxes are not used by current application UI paths.
- The File header now shows the centered, wrapping project name above a smaller Rimmap logo. The old technical project/build status strip has been removed; save/open success uses lightweight Rimmap feedback instead.
- Still images and vector files can be imported with the Image button. In the Windows/Tauri app, dragging local files from Desktop or File Explorer onto the board uses Tauri's native file-drop event, so it works even though WebView2 does not deliver those drops to normal HTML5 canvas handlers. Supported local formats are PNG/JPEG/WebP/SVG/SVGZ/AVIF. Animated, video, and audio formats such as GIF/APNG/MP4/MOV/WebM/MP3 are intentionally rejected with a clear warning. Browser development keeps the existing HTML5 drag/drop fallback. With the default board shortcut, `Ctrl+V` also imports a clipboard image payload at the viewport center; Rimmap internal object paste continues to coexist and is used only when there is no clipboard media payload.


This is a behavior-preserving structural split of the supplied 5,132-line `main.ts`.

## Modules

- `model/`: element types, text defaults, IDs, geometry/hit-testing.
- `state/`: shared runtime store and undo/redo history.
- `renderer/`: canvas rendering, shape surfaces, board constants.
- `interactions/`: tool selection, pointer gestures, keyboard commands, alignment.
- `text-editor/`: contenteditable/rich-text editing and toolbar logic.
- `arrows/`: connector geometry, labels, branches, arrow normalization.
- `layers/`: layer naming, picking, ordering, locking panel.
- `media/`: Blob asset registry, IndexedDB-backed binary asset storage, Object URL hydration, centralized supported-format classification, plus the shared picker/native-drop/browser-drop/clipboard media insertion pipeline.
- `persistence/`: schema migrations, ZIP project archive, current/checkpoint recovery, project open/save.
- `exports/`: SVG/PNG/PDF and clipboard export.
- `shortcuts/`: shortcut definitions/preferences/panel behavior.
- `ui/`: DOM shell, property inspector, context menu, project/menu wiring.
- `main.ts`: startup only.

The mutable state is intentionally centralized in `state/store.ts`. This keeps the first refactor low-risk while making ownership visible; later work can replace pieces of that store with narrower feature stores without another 5k-line migration.

## Validation

- `tsc --noEmit` passes with `strict: true` using the included `tsconfig.json`.
- The refactor preserves every top-level function and constant from the supplied source; mutable `let` bindings were moved into `state/store.ts`.
- `style.css` is now consolidated into tokenized component sections; obsolete selectors and duplicate selector generations are guarded by `scripts/check-css-cleanup.mjs`.

## Integration

Replace the old `src/main.ts` and `src/style.css` with this `src/` tree. The entry point is still `src/main.ts`, so a Vite-style app that already resolves `idb-keyval` can keep the same HTML entry.

## Runtime wiring regression fix

The first modular package had a bootstrap bug: `interactions/pointer.ts` and `ui/wiring.ts` were extracted but were not imported by `main.ts`. Because both modules install event listeners as module side effects, the code existed but never ran. That disabled canvas dragging and a large group of UI actions.

The corrected entry point explicitly imports both modules. A dependency reachability guard is included:

```bash
node scripts/check-entrypoint.mjs
tsc -p tsconfig.json --noEmit
```

The reachability check fails if a runtime module becomes orphaned from `main.ts`, including the two listener-registration modules.

## Layer renaming fix

The All Layers panel supports inline object renaming again:

- Single-click selects a layer without rebuilding the panel DOM.
- Double-click the layer name or layer body to edit the object name inline.
- Enter commits the rename.
- Blur commits the rename.
- Escape cancels without creating a history entry.
- Clearing a custom name restores the generated layer label.
- Renaming is persisted and participates in Undo/Redo.
- Locked objects remain renameable from All Layers; the lock still prevents canvas manipulation.

Regression check: `node scripts/check-layer-rename.mjs`.

## Layer rename reliability fix (v2)

The All Layers inline rename interaction now preserves the name input across the full double-click sequence. Layer selection calls `setTool('select', { refreshLayers: false })`, preventing `setTool()` from scheduling a Layers-panel DOM rebuild between click 1 and click 2. The rename input also stops keydown propagation while editing so Space and Escape are handled as text-editing keys rather than canvas shortcuts.

### All Layers arrange controls
Selecting a layer in **All Layers** now participates in the same stacking-order workflow as selecting its object on the canvas. The readonly layer-name field releases focus so `W`, `S`, `Alt+W`, and `Alt+S` continue to work, and right-clicking a layer row opens the shared object context menu with **Bring forward**, **Send backward**, **Bring to front**, and **Send to back**. Active inline layer-name editing keeps the browser text context menu instead.

## Central document/store model

The previous shared `let` globals have been replaced by the central store in `src/state/store.ts`.
Feature modules read through `appState` and change application/document state by dispatching actions instead of assigning shared state directly.

Document actions include:

- `MOVE_ELEMENTS`
- `DELETE_ELEMENTS`
- `LOCK_ELEMENTS`
- `UPDATE_STYLE`
- `CREATE_ARROW`
- `ADD_ELEMENT` / `ADD_ELEMENTS`
- `REPLACE_ELEMENTS`
- `REORDER_ELEMENTS`
- `RENAME_ELEMENT`
- `UPDATE_ELEMENT` / `UPDATE_ELEMENTS` for structured feature-specific edits
- `SET_SELECTION` and `SET_CAMERA` / `PAN_CAMERA`

Tool, interaction, editor, project, history, shortcut, and UI state also have explicit store actions. Incoming document elements are cloned before the store owns them so callers cannot retain an external payload reference and silently mutate the live document.

`node scripts/check-store-mutations.mjs` guards against reintroducing direct `appState` assignments, store-owned array mutations, direct camera writes, or direct mutation of store-owned Sets/Maps in feature modules.

## Final validation

The final central-store build was checked with:

```bash
node scripts/check-entrypoint.mjs
node scripts/check-layer-rename.mjs
node scripts/check-layer-arrange.mjs
node scripts/check-store-mutations.mjs
tsc -p tsconfig.json --noEmit
```

The central document actions were also executed in a Node smoke test. In headless Chromium, the app was bootstrapped and exercised for canvas object dragging, Undo/Redo, toolbar switching, clear, pointer-created arrows, All Layers rename, All Layers arrange shortcuts, locked-layer renaming, explicit style/move/delete actions, and rectangle text-editor open/commit/close. Those checks passed.

## Project schema v8, canonical text documents, external media assets, and ZIP archives

Media bytes are no longer part of the element model. A media element carries only stable metadata and an `assetId`:

```json
{
  "id": "media-1",
  "type": "media",
  "assetId": "a1",
  "mime": "image/png",
  "name": "diagram.png",
  "x": 100,
  "y": 100,
  "width": 640,
  "height": 480
}
```

`src/media/assets.ts` owns binary image assets. Imports are stored as `Blob`s under their asset IDs, while rendering hydrates still images/vectors through revocable Object URLs. Duplicating or moving a media element therefore copies or patches only the small `assetId` reference; it does not copy the image/video bytes. SVG export can resolve an asset to a data URL at export time when a self-contained SVG is required, but that encoding is not written back into the document model.

The media split introduced schema v6. The current document schema is now **v8**. v7 removed the obsolete standalone Color-panel preferences; v8 makes structured text documents canonical and removes persisted editor HTML/rich-line cache fields. Current `project.json` metadata looks like:

```json
{
  "format": "my-board-project",
  "schemaVersion": 8,
  "archiveVersion": 1,
  "name": "Untitled Board",
  "savedAt": "...",
  "elements": [],
  "assets": [],
  "settings": {}
}
```

The canonical save format is now a standard ZIP archive with a `.board.zip` suffix:

```text
Untitled Board.board.zip
├── project.json
├── preview.png
└── assets/
    ├── a1.png
    ├── a2.webp
    └── v1.mp4
```

`src/persistence/zip.ts` implements a standards-compatible ZIP reader/writer with CRC verification. New archives store media entries without a second compression pass because common image formats are already compressed; this avoids Base64 expansion and keeps the binary assets directly extractable by normal ZIP tools. The loader also supports DEFLATE entries so archives repacked by common ZIP utilities remain readable. Before a download is allowed, the generated archive is reopened and checked for `project.json`, `preview.png`, referenced asset entries, object count, and asset byte sizes.

`src/persistence/migrations.ts` owns the schema pipeline. Legacy `version` is accepted only as an input compatibility field; current saves no longer emit it. The chain is:

- `v1 → v2` and `v2 → v3`: compatibility adapters for the oldest saved boards and bare element-array backups.
- `v3 → v4`: makes layer lock/name metadata and text/shape presentation defaults explicit.
- `v4 → v5`: makes connector style/mode/geometry/opacity/label defaults and branch metadata explicit.
- `v5 → v6`: extracts legacy `MediaElement.src` data URLs into Blob assets, assigns stable `assetId` references, builds the asset manifest, and removes embedded media payloads from the element model.
- `v6 → v7`: removes `currentColor`, `previousColor`, and `recentColors`. If a legacy board has no `brushColor`, its old `currentColor` is used once to seed the brush color; Arrow and text colors remain independent.
- `v7 → v8`: converts text/note/rectangle content plus arrow, endpoint, and branch labels into versioned `TextDocument` structures, derives the convenience plain-text fields from that structure, and removes persisted contenteditable HTML / `richLines` caches.

Legacy JSON/`.board.json` files are still accepted. Embedded Base64 media is decoded once during import, written to the Blob asset store, and the loaded document migrates through v6/v7 into v8. A v8 document is idempotent through the migration entry point, while future schemas are rejected instead of guessed at.

### Simplified IndexedDB recovery

Continuous persistence now keeps only two document snapshots:

- `my-board-v8-current`: the latest recovery document.
- `my-board-v8-checkpoint`: the previous known-good document.

Binary assets are stored separately under asset IDs and are referenced by both snapshots rather than duplicated inside either snapshot. The previous continuously-written `my-board-elements` and `my-board-project-recovery` copies are gone. Old v3/v5/v6 recovery keys and the legacy element copy are read only as one-time migration fallbacks; after a successful restore they are migrated into the v8 current/checkpoint model and removed.

Schema, media, recovery, and ZIP regression coverage is included in `scripts/check-all.sh`, including executable v3→v4→v5→v6→v7→v8 migration tests and ZIP round-trip tests. A generated archive was also verified with Python's standard `zipfile` implementation to confirm external ZIP interoperability.

## Legacy color-state removal and CSS cleanup

The retired standalone Color panel no longer leaves runtime or persisted state behind. `ProjectSettings` and `AppState` no longer contain `currentColor`, `previousColor`, or `recentColors`; saves write only the active Brush/Arrow/tool preferences. Migration v6→v7 strips the old fields and preserves the only useful compatibility behavior by using a legacy `currentColor` once as the brush fallback when `brushColor` is absent.

The stylesheet was rebuilt from the live UI surface instead of keeping another override layer:

- A small `:root` token set owns the repeated neutral palette and board background.
- Rules are grouped into foundation, shared primitives, toolbar, history, context menu, project/export, inspector, rich-text editor, layers, shortcuts, and responsive sections.
- The removed Color panel, custom-color popover, old selection toolbar, obsolete layer-row generations, and other unreferenced selectors are gone.
- Exact duplicate selectors and duplicate declarations within consolidated selectors were eliminated.
- The stylesheet dropped from 564 qualified rules / ~79 KB to 404 qualified rules / ~58 KB while retaining every class selector referenced by the current TypeScript UI.

`node scripts/check-css-cleanup.mjs` fails if obsolete Color-panel selectors return, a current CSS class has no source reference, duplicate selectors are appended again, or common neutral literals bypass the design tokens.

## Design-token system

`src/style.css` now has a semantic token layer rather than a small neutral-color alias list. The canonical tokens include:

```css
--surface
--surface-raised
--border
--text-primary
--text-muted
--accent
--radius-sm
--radius-md
--shadow-panel
--space-1
--space-2
```

The system also defines stronger borders, hover/pressed surfaces, focus/danger colors, a radius scale, panel/menu/toolbar shadows, a 4px spacing scale, and motion timings. Current component rules consume the semantic tokens directly; the previous `--white`, `--ink`, `--text`, `--focus`, and similar compatibility aliases were removed. `scripts/check-css-cleanup.mjs` now verifies both consolidation and the canonical token contract.

## Canonical structured text model

Rich text now has one persisted source of truth: `TextDocument` in `src/model/types.ts` / `src/model/text-document.ts`. A document is versioned independently and contains structured `RichLine`/`RichRun` data for formatting, lists, nesting, ordered-number paths, checkboxes, colors, highlights, and decorations.

Text-bearing objects reference that structure directly (`textDoc`, `labelDoc`, `startLabelDoc`, `endLabelDoc`). The current element types no longer expose `richText`, `richLines`, `labelRichText`, or `labelRichLines`. The ordinary `text`/`label` strings remain only as derived convenience fields for search, empty checks, and UI labels.

The contenteditable DOM is now an editing projection:

1. `textDocumentToHtml()` creates temporary editor HTML from the structured document.
2. The browser edits that DOM.
3. `textDocumentFromHtml()` parses the editor representation back into a `TextDocument`.
4. The plain `text`/`label` value is derived from that document.
5. Canvas and SVG/PNG/PDF rendering consume the same document lines instead of reinterpreting saved HTML.

This removes the former three-way truth problem between plain text, editor HTML, and cached canvas lines—the source of several list, wrapping, numbering, and line-break regressions. Schema v7→v8 performs the one-time conversion for existing projects.

`document.execCommand` is no longer scattered through the editor. Remaining browser-command compatibility is isolated in `src/text-editor/commands.ts`; paste already uses Selection/Range insertion. This leaves a narrow replacement seam for converting list/inline toolbar commands to Selection/Range + `beforeinput` later without touching persistence or canvas rendering. `scripts/check-text-model.mjs` fails if `execCommand` leaks outside that adapter or if current element types regain persisted editor-HTML fields.

## Patch-based Undo/Redo history

Undo/Redo no longer stores full `CanvasElement[]` snapshots. The old history path used `structuredClone(elements)` before edits and compared complete boards with `JSON.stringify`; that made every history step scale with the entire document and repeatedly carried large media payloads.

The current history system in `src/state/history.ts` / `src/state/history-core.ts` is transaction + patch based:

- `beginHistoryTransaction()` creates a lightweight token; it does **not** clone the board.
- The history recorder observes central-store document actions and captures the original version only for element IDs touched by that transaction.
- High-frequency pointer edits capture the final versions once at commit, rather than rescanning the document after every mousemove.
- Existing elements are stored as top-level property patches containing only fields whose values actually changed.
- New elements are stored once as indexed insertions.
- Deleted elements are stored once as indexed removals.
- Layer/z-order changes store ID order only, not cloned element objects.
- Undo/Redo replays through `APPLY_ELEMENT_PATCH`, `INSERT_ELEMENT_AT`, `DELETE_ELEMENTS`, and `REORDER_BY_IDS` store actions.

This is particularly important for media. Moving or styling an imported image records fields such as `x`, `y`, `width`, `height`, or style values; the history entry only keeps the element's small `assetId` reference and never contains the Blob bytes. A deleted/inserted media history record still contains only the media element metadata, so Undo/Redo can restore the reference without duplicating the binary asset.

Freehand point appends are now immutable at the store level so history can safely retain references to prior element versions without later drawing mutations corrupting them.

History regression coverage is included in `scripts/check-all.sh`:

- `scripts/check-history-patches.mjs` prevents reintroduction of full-board cloning or `JSON.stringify` state comparison.
- `scripts/history-patches.smoke.ts` verifies changed-field diffs and confirms media movement history does not duplicate or patch the underlying asset reference/payload.
- `scripts/history-runtime.smoke.cjs` executes real store/history Undo/Redo for move, style, insert, delete, and reorder operations.

## Automated text regressions and Playwright workflows

Text editing is now protected by browser-level regression coverage **before any further editor behavior changes**. The Playwright suite lives in `tests/` and covers the fragile cases that previously regressed:

- Enter / logical line breaks
- long-word wrapping inside constrained canvas text
- numbered lists
- bullet lists
- nested lists and ordered-number paths
- Tab / Shift+Tab list nesting
- forward and backward selections producing the same stable toolbar anchor
- toolbar positioning inside the viewport
- Escape committing the active editor
- save/open preserving structured formatting

A second Playwright spec covers the critical application workflow end-to-end:

```text
create Note
→ type rich text
→ style selection
→ create an arrow bound to the Note
→ move the Note
→ verify the bound arrow follows
→ save .board.zip
→ reload/recovery
→ reopen the downloaded archive
→ verify text, formatting, binding, and geometry
```

Run the browser suite with:

```bash
npm install
npm run test:browser
```

or only the text regressions / workflow suite with:

```bash
npm run test:text
npm run test:e2e
```

`playwright.config.ts` starts the included Vite entry point automatically. On this Linux environment it can use `/usr/bin/chromium`; elsewhere Playwright uses its normal installed browser unless `PLAYWRIGHT_CHROMIUM_EXECUTABLE` is set.

Test-only inspection helpers are loaded only when the page URL contains `?test=1`. Production boots never import or install `window.__MY_BOARD_TEST__`.

`node scripts/check-browser-tests.mjs` is part of `scripts/check-all.sh` and fails if one of the required regression cases, the critical workflow, the gated test-hook import, or the UUID contract disappears. The static/type/model/history/schema/ZIP suite currently passes. The Playwright package itself could not be installed in this execution environment because the npm install attempt timed out, so the browser specs are included and runnable but were not falsely reported as executed here.

## UUID element and asset IDs

New runtime IDs now come from `crypto.randomUUID()` instead of short PRNG strings. `src/model/ids.ts` uses `crypto.randomUUID()` on modern browsers/Node and a Web-Crypto `getRandomValues()` UUID-v4 fallback only for environments that expose Web Crypto without `randomUUID()`.

This applies uniformly to new elements, groups, connector branches, duplicated objects, imported media asset IDs, and other runtime-generated identifiers because those features already share `generateId()`.

`scripts/id-generation.smoke.ts` generates 2,000 IDs and verifies UUID-v4 shape and uniqueness. The source contains no weak PRNG ID fallback.

### Empty Note editor regression (Playwright)
The browser text suite now includes an explicit regression for a newly created empty Note. Shape editors retain a one-line minimum editing surface so the caret/contenteditable does not collapse to zero height before the first character is typed.

## Browser regression fixes (September 2026)

The Playwright suite exposed three concrete editor/runtime issues after the initial test pass:

- Empty canonical lines now project to `<div><br></div>` instead of an empty styled span, preventing Chromium from preserving a phantom empty block when typing or pressing Enter.
- Tab/Shift+Tab list nesting preserves the exact selected LI nodes and reconstructs a collapsed caret after DOM moves, so immediate indent/outdent is reversible.
- The floating rich-text toolbar no longer animates its transform. Its viewport position is now geometrically stable, and performance-first CSS now disables decorative transitions entirely.

These are behavior fixes, not relaxed tests: the existing Enter, Esc, list nesting, selection-direction, save/open, and end-to-end workflow assertions remain strict.


## Note/Rectangle text + performance stabilization (schema v9)

Schema v9 makes shape text placement explicit and repairs structured list numbering produced by older browser editing DOM. Notes and Rectangles now share the same canonical `TextDocument` behavior as plain Text for numbered/bulleted lists, nesting, Tab/Shift+Tab, copy/paste, canvas rendering, and exports.

- Shape text uses a consistent internal inset (`TEXT_PAD_X = 10`, `TEXT_PAD_Y = 8`) so text no longer touches Note/Rectangle borders.
- Properties includes **Top left** and **Center** placement for Note/Rectangle text. Centering applies horizontally and vertically; top-left remains the default.
- Chromium `li[value]` and `ol[start]` artifacts are stripped from the editor projection, and canonical ordered-list numbering is recalculated from structural nesting.
- Rich clipboard copy writes both clean `text/html` and visible-marker `text/plain`; paste canonicalizes list HTML before inserting it. This applies to Text, Note, and Rectangle editors.
- Arrow opacity controls were removed from Properties. Existing project opacity data remains readable for backward compatibility, but there is no ongoing opacity UI.
- Dots and Double Arrow Style previews now use explicit SVG geometry matching their real connector styles.
- Performance-first CSS removes backdrop blur, box shadows, transitions, animations, and `will-change` hints from the app UI. Panels are separated using solid surfaces and borders instead of compositor-heavy effects.

The complete non-browser validation command is now:

```bash
npm run test:static
```

It runs strict TypeScript plus entry-point, store, patch-history, media/ZIP, schema, text-model, CSS, UUID, layer, and Note/Rectangle/performance regression checks. Browser Playwright coverage additionally includes shape list nesting, padding/centering, bullet and numbered clipboard preservation, and the Arrow Properties UI contract.

## Note visual rollback + rich-list paste exit fix

- Restored the earlier Note card rendering: the paper fill/outline again uses the crisp 4 px offset card shadow from the pre-performance-cleanup design. This is a canvas-drawn hard shadow, not a CSS blur.
- Rich-list paste now explicitly restores a valid contenteditable focus/caret after Chromium repairs inserted UL/OL fragments.
- Escape is captured at document level while an editor session is active, so a paste-induced focus/selection change cannot strand the editor.
- Outside-click detection now treats only the actual editable surface and rich-text controls as "inside" the editor; an oversized shell cannot swallow an outside click.
- Note/Rectangle live editors are bounded to the shape's inner height so pasted lists cannot create a transparent editing overlay far beyond the object.
- Added Playwright coverage for pasting bulleted/numbered lists and exiting with both Esc and an outside click.

### Rich-list paste exit hardening

Text-edit shutdown is now fail-safe after rich-list clipboard paste. Escape is captured at both window/document level, editor DOM/list parsing happens only after the editing shell and listeners have been detached, and parsing failures fall back to plain text instead of leaving the board trapped in edit mode. Note/Rectangle editors also clip/scroll pasted content within the shape so an overflowing contenteditable cannot create an invisible canvas-blocking hit area. The Playwright suite includes an app-to-app numbered-list copy/paste regression covering both Escape and outside-click exit.

## v9 clipboard list-context fix

- Copying only part of a numbered/bulleted list now restores the missing OL/UL wrapper that Chromium omits from `Range.cloneContents()` when the list container is the selection's common ancestor.
- Paste repairs orphan LI fragments and falls back to parsing visible `1.`, `1.1.`, and bullet markers from `text/plain` when rich clipboard HTML is missing/incomplete.
- Added a browser regression covering: plain text above a numbered list → select only the list items → copy → paste into another Note → commit with `[1],[2],[3]` canonical number paths intact.

## v9 Note/paste/reopen stabilization

- Rich numbered/bulleted paste now establishes a valid contenteditable selection before insertion, so an immediate paste works in Note, Rectangle, and Text even before the editor's deferred caret frame runs.
- Pasting a structured list into an untouched editor replaces the browser `<div><br></div>` placeholder instead of inserting beside it. This preserves OL/UL structure and prevents a trailing phantom blank line.
- Untouched empty Notes no longer persist Chromium's placeholder newline. Closing and reopening an empty Note returns to exactly one first-line caret surface.
- Notes now use the supplied classic sticky-note reference treatment: warmer pale-yellow paper, near-square corners, thin dark outline, crisp 5px lower-right shadow, 10×8px internal text inset, and a smaller default text scale for newly created Notes. Existing custom Note fill colors remain intact.
- Browser regression coverage now includes untouched Note reopen behavior and immediate numbered-list paste into Note, Rectangle, and Text.

## v9 deterministic editor clipboard fix

Editor copy now cancels Chromium's default contenteditable copy and writes the canonical clipboard payload directly. This prevents the browser from overwriting numbered/bulleted list structure or injecting the editor surface background into ordinary copied text. Partial list selections rebuild missing LI/OL/UL context before serialization, paste recognizes markerless same-app clipboard text, and native white editor-surface background styles are discarded defensively. The browser regression suite now includes the exact mixed plain-text + list → copy list only → paste into another Note workflow.

## Clipboard range + rich-list stabilization

The text editor clipboard path now treats the browser's `text/plain` selection as the exact range boundary and the canonical `TextDocument` as the same-app rich payload. Copy no longer promotes browser caret placeholders or unselected empty boundary blocks into the clipboard. Same-app paste restores `TextDocument` directly, preserving list type, nesting, numbering, inline formatting, and line structure across Text, Rectangle, and Note.

External clipboard HTML is recursively sanitized even when Chrome/Office/Docs wraps content in `html`, `body`, `section`, or other containers. `ol`/`ul` structure is preserved instead of being flattened by an unprocessed wrapper. When HTML is absent, visible numeric/bullet markers in `text/plain` remain the fallback reconstruction path.

## Canvas precision & high-DPI pass

- The interactive canvas now renders in CSS-pixel coordinates on a backing store scaled by `devicePixelRatio`, capped at **2×** for a sharper Retina/high-DPI result without unbounded GPU/memory cost. Drag snapshot canvases use the same pixel ratio.
- Moving selections use **gentle invisible snapping** (6 screen px tolerance) against other objects' left/center/right and top/middle/bottom anchors. No alignment guide lines are drawn. Corner resizing uses the same invisible snapping for the active edge/center; Shift-resize keeps aspect-ratio control authoritative and temporarily disables snapping.
- **Align** now includes center distribution and equal-gap distribution: Distribute horizontally, Distribute vertically, Equal horizontal spacing, and Equal vertical spacing. Distribution requires at least three unlocked selected objects.
- Selected objects can be nudged with **Arrow keys = 1 world unit** and **Shift+Arrow = 10 world units**. Bound connectors follow nudged shapes.
- `tests/canvas-features.spec.ts` covers DPR backing resolution, keyboard nudging, move/resize snapping without visual guides, and the Align distribution UI.

### Dense-board connector stability

Rimmap now preserves internal connector bindings when duplicating or pasting a connected selection. If both the arrow and its bound target are duplicated together, the cloned arrow is rebound to the cloned target; bindings to objects outside the copied selection remain detached. This prevents repeated diagram duplication from producing connectors that only look attached.

Auto routing is also localized for dense boards. Instead of sending every Note/Rectangle/Image/Text obstacle on the entire board into each Auto connector path search, Rimmap queries a spatial corridor around that connector, validates the resulting detour for omitted blockers, and expands only when needed. Cached Auto routes and sampled paths are reused when unrelated distant geometry changes.
