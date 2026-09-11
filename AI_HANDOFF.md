# AI_HANDOFF.md

> **Purpose:** Source-of-truth handoff for future ChatGPT/developer sessions working on **Rimmap**.
>
> **Source inspected:** the current project archive supplied on 2026-09-10.
>
> **Authority rule:** When this file conflicts with the current source code, the **current source code wins**. Do not infer architecture from older chats, old README text, old build labels, or migration-era comments.
>
> **Product identity:** The user-facing application name is **Rimmap**. The selected minimalist blue route/R logo is stored under `public/rimmap-logo.png` / `public/rimmap-icon*.png`. Legacy persisted identifiers such as `my-board-project`, `my-board-v12-*`, `my-board-v6-asset:*`, and `application/x-my-board-rich-text` are intentionally retained for backward compatibility and must not be renamed as part of cosmetic branding work.
>
> **Modification status for this handoff:** Updated after the 2026-09-10 connector-routing/label work and the completed responsiveness/performance pass. The current source is schema v12, preserves first-class/nestable Layer groups from v11, keeps Manual/Auto connector routing and WYSIWYG arrow labels, and now combines lazy large-board spatial indexing with frame-coalesced drag/resize work, one centralized visual `requestAnimationFrame` scheduler, cached static-board interaction compositing, dependency-aware connector updates, fast ID/selection lookup, snapshot/binary-search snapping, bounded text/geometry caches, opt-in performance instrumentation, and a Windows/Tauri-native media-drop bridge for filesystem drops. These performance structures are runtime-only and do not change persisted document semantics. Legacy flat `groupId` membership remains migration-only.

## 1. Executive summary

Rimmap is a canvas-driven whiteboard/diagramming application written in TypeScript with no UI framework. The same Vite frontend now runs either in a normal browser development session or inside a thin Tauri v2 desktop shell. It provides an effectively unbounded pan/zoom board with freehand drawing, rectangles, sticky-note-style notes, standalone rich text, arrows/connectors, branching arrow structures, erasing, imported still-image/vector assets, object selection/manipulation, layers, grouping, locking, alignment/distribution, snapping, undo/redo, local recovery, project save/open, and PNG/SVG/PDF export.

The application is mostly client-side and local-first. No backend, authentication layer, collaboration service, or network API is present in the inspected source. Persistent document snapshots and binary media are stored in browser IndexedDB through `idb-keyval`. Explicit project saves use a custom `.board.zip` archive containing `project.json`, `preview.png`, and referenced media assets.

The current persisted document schema is **v12**. The project archive/container format is **archive v1**. Rich text has its own independent canonical `TextDocument` format at **version 1**.

The codebase has been split out of an older monolithic `main.ts`, but it is not cleanly layered: several feature modules form a large circular import graph. Top-level side effects and import order therefore matter.

## 2. What the application currently does

### Board and navigation

- Renders a dotted-paper board on a 2D `<canvas>`.
- Supports panning with the Hand tool and temporary Space-to-pan behavior.
- Supports cursor-anchored wheel zoom.
- Camera zoom is clamped to approximately `0.1` through `5`.
- A Reset View control resets the camera to `{ x: 0, y: 0, zoom: 1 }`.
- Canvas backing resolution follows device pixel ratio but is capped at 2× for rendering performance.

### Creation tools

The actual `Tool` union is:

```ts
'select' | 'hand' | 'pencil' | 'rectangle' | 'note' | 'arrow' | 'eraser'
```

Current creation behavior includes:

- **Brush/Pencil:** freehand paths.
- **Rectangle:** resizable rectangles with optional fill, configurable stroke, and embedded rich text.
- **Note:** sticky-note-style shapes with rich text.
- **Arrow:** connectors/arrows with multiple styles, curves, bindings, labels, and optional branches.
- **Eraser:** preview/marquee-style object erasing.
- **Media import:** only still-image and vector files become `media` elements. Images can be added through the Image button, by dropping supported files directly onto the canvas, or by pasting an image from the OS clipboard with the default Ctrl+V board shortcut. In Tauri/Windows, local Desktop/Explorer drops use Tauri's native webview drag/drop event and filesystem paths; browser development keeps the HTML5 `DataTransfer` path. Browser image drags that expose a readable URL are also materialized opportunistically; cross-origin hosts may still require saving the image locally first. Supported local-drop/import formats are PNG/JPEG/WebP/SVG/SVGZ/AVIF. Animated, video, and audio formats such as GIF/APNG/MP4/MOV/WebM/MP3 are rejected with a clear warning.
- **Standalone text:** there is **no Text toolbar tool** in the current source. Standalone `text` elements are created by double-clicking empty board space.

### Selection and object manipulation

The app currently supports:

- Click selection.
- Multi-selection.
- Marquee selection.
- Move.
- Resize.
- Keyboard nudging by 1 unit; Shift + Arrow nudges by 10.
- Move and resize snapping without visual guide lines.
- Alt-drag duplication.
- Duplicate, cut, copy, paste, delete.
- Group and ungroup, including nested real Layer groups.
- Bring forward / send backward / bring to front / send to back.
- Align and distribute operations, including equal spacing.
- Locking.
- Layer reordering.
- Layer renaming.
- Picking among overlapping objects.
- An “All Layers” panel.

Locked elements are intentionally treated as inert in several interaction paths. The source specifically restricts unlocking to the lock control in the All Layers panel.

### Connectors/arrows

Arrow/connector behavior is substantial and includes:

- Styles:
  - line
  - dots
  - arrow
  - double
  - dotted
  - dashed
- Smooth or sharp curves.
- Connection mode and branches mode.
- Manual connector geometry with arbitrary authored interior waypoints; the existing 3-point/5-point commands remain presets.
- Optional **Auto** routing for normal connection-mode arrows. Auto routing derives a deterministic orthogonal path around visible Note/Rectangle/Media/Text bounds and does not overwrite authored Manual controls.
- Smooth Auto connectors round orthogonal corners; Sharp Auto connectors keep rigid orthogonal corners.
- Binding endpoints to connectable elements.
- Anchor/connection-point calculations.
- Start/end labels.
- Main-path/trunk labels with deterministic collision avoidance against visible Note/Rectangle bounds.
- Main-path/trunk label size uses the shared Text/Note/Rectangle presets: S=16, M=20, L=24, XL=28, XXL=34. The historical 14px arrow-label default is still accepted for compatibility; selecting any preset stores that exact shared size.
- Floating path-label wrapping is WYSIWYG: edit mode and canvas/export use the same `ArrowLabelLayout`, font family/size, `RICH_TEXT_LINE_HEIGHT = 1.35`, and deterministic path-derived wrapping width. The width policy is `max(fontSize × 4.25, pathLength × 0.34, 72)` capped at 360 world px. The wrapping area stays stable while typing; the subtle label background/hit box may still hug the actual rendered glyph block.
- Branch labels with the same deterministic collision policy.
- Branch creation/removal and branch control points. Branches remain Manual-only.
- Direct waypoint gestures: double-click connector path to add a waypoint; Alt-click an interior waypoint to remove it. Shift+double-click preserves the path-label editing gesture.
- Recalculation of bound arrow geometry when connected objects move.
- A keyboard “quick connect” action between exactly two selected objects.

### Text and rich text

Rich text is available on:

- standalone `text` elements
- `note` elements
- `rectangle` elements
- arrow trunk labels
- arrow endpoint labels
- branch labels

Formatting support visible in the source includes:

- bold
- italic
- underline
- strikethrough
- text color
- highlight
- font family
- text sizing/scaling
- alignment
- bullets
- numbered lists
- checklists
- nested list indentation/outdentation
- structured ordered-list numbering

Notes and rectangles support top or middle vertical text placement.

### Project/file operations

The UI includes:

- New project
- Open project
- Save project
- Save As project (`Ctrl+Shift+S`)
- Export PNG
- Export SVG
- Export PDF
- PNG scale choices of 2×, 4×, and 6×

Exports operate on the current selection when one or more objects are selected; otherwise they export all board elements.

### Local recovery

The application automatically saves a recovery snapshot to IndexedDB after edits. It keeps a current snapshot and a previous known-good checkpoint and contains fallback migration logic for multiple older recovery-key generations.

## 3. Technology stack

| Area | Current implementation |
|---|---|
| Language | TypeScript |
| Browser app bundler/dev server | Vite 7 |
| Desktop shell / Windows packaging | Tauri v2 (`tauri` 2.11.5, CLI 2.11.4), Rust thin shell |
| UI framework | None |
| Rendering | HTML5 Canvas 2D |
| Rich-text editing | Native DOM/contenteditable + Selection/Range APIs, with an isolated legacy `execCommand` compatibility adapter |
| Local persistence | IndexedDB through `idb-keyval` |
| Explicit project archive | Custom ZIP reader/writer |
| Browser tests | Playwright |
| Type checking | TypeScript `tsc` |
| Package manager metadata | npm / `package-lock.json` |
| Runtime backend | None found |
| Authentication | None found |
| Collaboration/realtime service | None found |

Relevant package versions/ranges from `package.json`:

```json
{
  "dependencies": {
    "@tauri-apps/api": "^2.11.1",
    "@tauri-apps/plugin-dialog": "^2.7.3",
    "@tauri-apps/plugin-fs": "^2.5.2",
    "idb-keyval": "^6.2.1"
  },
  "devDependencies": {
    "@playwright/test": "^1.55.0",
    "@tauri-apps/cli": "^2.11.4",
    "typescript": "^5.9.2",
    "vite": "^7.1.5"
  }
}
```

`package.json` / the Tauri desktop shell now use application release version **1.0.0**. Do **not** treat that as the project data-schema version; persisted boards remain schema **v12**.

## 4. Important folders and files

```text
.
├── index.html
├── package.json
├── package-lock.json
├── playwright.config.ts
├── tsconfig.json
├── README.md
├── BUILD_WINDOWS.md
├── build-windows.bat
├── src-tauri/
│   ├── Cargo.toml
│   ├── build.rs
│   ├── tauri.conf.json
│   ├── capabilities/
│   ├── icons/
│   └── src/
├── public/
│   ├── favicon.svg
│   └── icons.svg
├── scripts/
│   ├── check-all.sh
│   ├── check-entrypoint.mjs
│   ├── check-store-mutations.mjs
│   ├── check-history-patches.mjs
│   ├── check-media-assets.mjs
│   ├── check-text-model.mjs
│   ├── check-schema-version.mjs
│   ├── ...
│   └── *.smoke.ts / history-runtime.smoke.cjs
├── src/
│   ├── main.ts
│   ├── style.css
│   ├── arrows/
│   ├── exports/
│   ├── interactions/
│   ├── layers/
│   ├── media/
│   ├── model/
│   ├── persistence/
│   ├── performance/
│   ├── renderer/
│   ├── shortcuts/
│   ├── state/
│   ├── testing/
│   ├── text-editor/
│   └── ui/
└── tests/
    ├── canvas-features.spec.ts
    ├── text-editor.regression.spec.ts
    ├── workflows.spec.ts
    └── helpers.ts
```

### Files with especially high architectural importance

- `src/main.ts` — application bootstrap.
- `src-tauri/tauri.conf.json` — desktop product/window/bundler configuration; keeps Rimmap as an NSIS-packaged thin shell over the Vite `dist/` output.
- `src-tauri/src/lib.rs` / `src-tauri/src/main.rs` — intentionally minimal Rust desktop entry points; no board business logic belongs here unless a native capability is explicitly required.
- `BUILD_WINDOWS.md` / `build-windows.bat` — Windows build handoff for the user; these are packaging helpers, not runtime application code.
- `src/ui/dom.ts` — creates the main DOM shell and obtains core DOM/canvas references.
- `src/ui/wiring.ts` — connects project/menu/media/shortcut UI controls to behavior.
- `src/state/store.ts` — central application state and reducer/actions.
- `src/state/history.ts` — runtime history transaction integration.
- `src/state/history-core.ts` — patch calculation/replay data structures.
- `src/model/types.ts` — central persisted/runtime model types.
- `src/model/geometry.ts` — geometry, hit testing, arrow paths/binding helpers, and cached derived arrow geometry.
- `src/performance/scene-index.ts` — lazy large-board scene-index manager, incremental invalidation, z-order projection, and scene-geometry generation.
- `src/performance/spatial-index.ts` — pure uniform-grid spatial-bucket index.
- `src/performance/lru-cache.ts` — bounded runtime LRU used for expensive derived layout/geometry caches.
- `src/model/text-document.ts` — canonical rich-text document representation and conversions.
- `src/text-editor/index.ts` — custom editor lifecycle, selection, lists, clipboard, formatting.
- `src/interactions/pointer.ts` — primary pointer/canvas interaction state machine.
- `src/interactions/keyboard.ts` — keyboard behavior and shortcut dispatch.
- `src/renderer/index.ts` — canvas scene rendering.
- `src/persistence/index.ts` — local recovery, save/open, archive orchestration.
- `src/persistence/migrations.ts` — schema migrations and current-schema sanitization.
- `src/persistence/zip.ts` — custom ZIP implementation.
- `src/media/assets.ts` — binary asset storage/hydration.
- `src/exports/index.ts` — SVG/PNG/PDF and clipboard exports.
- `src/layers/index.ts` — layer list, order, names, independent visibility/lock controls, and large-board search/filter.
- `src/ui/context-menu.ts` — context actions and object clipboard behavior.

## 5. Application entry points and startup

### Browser entry point

`index.html` contains:

```html
<div id="app"></div>
<script type="module" src="/src/main.ts"></script>
```

The application boot path is therefore:

```text
index.html
  → src/main.ts
      → src/style.css
      → src/interactions/pointer.ts   (side-effect listener installation)
      → src/ui/wiring.ts              (side-effect UI wiring)
      → loadShortcutPreferences()
      → loadFromLocal()
      → appReady = true
```

`src/main.ts` explicitly describes `pointer.ts` and `ui/wiring.ts` as side-effect modules whose imports are required for handlers to be installed.

`src/ui/dom.ts` builds the UI shell at module-evaluation time. It is reached transitively by modules that need the canvas and controls. This means import timing and circular-dependency changes can have runtime consequences.

### Initialization sequence

`initializeApp()`:

1. dispatches `appReady: false`
2. calls `resize()`
3. awaits shortcut preference loading
4. awaits local project recovery loading
5. dispatches `appReady: true` in `finally`

### Test entry point

When the page URL includes:

```text
?test=1
```

`src/main.ts` dynamically imports `src/testing/hooks.ts` and installs test-only hooks.

The Playwright server URL uses this test mode.

## 6. Major architecture

The app uses a hand-built, event-driven architecture rather than a framework.

A simplified flow is:

```text
DOM / browser events
    ↓
pointer.ts / keyboard.ts / ui modules
    ↓
dispatch(action)
    ↓
state/store.ts reducer
    ↓
central AppState
    ↓
renderer / layers / inspector / persistence
```

For mutations that should be undoable:

```text
beginHistoryTransaction()
    ↓
one or more store actions
    ↓
history records before/after element versions as patches
    ↓
commitHistory()
```

Text editing temporarily introduces an HTML editing surface:

```text
Canvas element TextDocument
    ↓
TextDocument → sanitized editor HTML
    ↓
contenteditable editing
    ↓
sanitized DOM → TextDocument
    ↓
store action + history transaction
    ↓
canvas rendering from canonical TextDocument
```

Persistence separates logical project data from binary media:

```text
CanvasElement media metadata
    └─ assetId
        ↓
IndexedDB Blob store
        ↓
explicit Save
        ↓
project.json + assets/* + preview.png inside .board.zip
```

### Important caveat: module boundaries are not acyclic

Although the source has been split into feature folders, a source import scan shows a large circular strongly-connected component that includes modules such as:

- `arrows/index.ts`
- `model/geometry.ts`
- `renderer/index.ts`
- `renderer/shapes.ts`
- `ui/context-menu.ts`
- `exports/index.ts`
- `persistence/index.ts`
- `state/history.ts`
- `text-editor/index.ts`
- `ui/inspector.ts`
- `shortcuts/index.ts`
- `interactions/keyboard.ts`
- `interactions/tools.ts`
- `layers/index.ts`
- `interactions/movement.ts`
- `interactions/align.ts`

Do not assume folder separation means dependency isolation. Be cautious when moving top-level code, replacing static imports, or changing initialization order.

One explicit example is the renderer relationship: `renderer/index.ts` imports shape helpers from `renderer/shapes.ts`, while `renderer/shapes.ts` imports rendering helpers from `renderer/index.ts`.

## 7. State management

There is no Redux, Zustand, MobX, React state, or similar library.

The central state lives in:

```text
src/state/store.ts
```

It exposes a read-only-facing `appState` plus `dispatch(...)`. The reducer performs state updates.

### Major categories held in `AppState`

The source currently stores state for:

- document elements
- selected IDs
- active tool
- brush/arrow styling
- camera
- interaction mode
- drawing/moving/resizing working data
- marquee state
- arrow creation/control/branch interaction state
- eraser preview/marquee state
- hover/connection state
- text-editor DOM references
- text-editor selection/range state
- internal object clipboard
- past/future history
- pending history transaction
- pending text-edit history transaction
- media input
- inspector/popover UI state
- layer picker UI state
- project name
- PNG export scale
- dirty state
- local-save timer/resolvers
- `appReady`
- rendering/performance caches
- shortcut bindings and editing/capture state

### Mutation rule

Future feature code should mutate application state through `dispatch(...)`, not by directly assigning to `appState`.

The repository includes a static guard, `scripts/check-store-mutations.mjs`, specifically intended to catch reintroduction of direct mutations.

### Immutability

Store actions clone incoming element payloads using `structuredClone` in important paths and reducer operations replace arrays/objects rather than treating the element store as an arbitrary mutable bag.

## 8. Important models and types

Core types are in:

```text
src/model/types.ts
```

### Core geometry

- `Point`
- `Bounds`

### Base element

All canvas elements share a base shape including:

- `id`
- optional `name`
- optional `parentGroupId` — reference to a first-class `LayerGroupNode`; legacy `groupId` is not part of the current runtime model
- `color`
- `thickness`
- optional `locked`
- optional `hidden` — hidden objects stay in the document/layer order but are canvas-inert and excluded from export until shown again

### Layer-group hierarchy

Current grouping is normalized document state:

```ts
type LayerGroupNode = {
  id: string;
  name: string;
  parentGroupId?: string;
};
```

`ProjectFile` persists `layerGroups: LayerGroupNode[]`. A `CanvasElement` may reference its immediate group via `parentGroupId`; a group may reference its immediate parent group the same way. There are no persisted child arrays: descendants are derived by `src/layers/model.ts`. This adjacency-list model avoids duplicating membership state and supports arbitrary nesting while leaving `elements[]` free to remain the canvas z-order source.

### `CanvasElement` variants

#### `FreehandElement`

Key data:

- `type: 'freehand'`
- ordered `points`

#### `RectangleElement`

Key data includes:

- `x`, `y`, `width`, `height`
- `borderRadius`
- optional fill
- configurable stroke enabled/style/spacing/color
- optional plain convenience `text`
- optional canonical `textDoc`
- font size/scale/family/alignment
- `textVerticalAlign: 'top' | 'middle'`

#### `NoteElement`

Key data includes:

- `x`, `y`, `width`, `height`
- fill
- plain convenience `text`
- canonical `textDoc`
- text scale/font/alignment
- border radius
- `textVerticalAlign`

#### `MediaElement`

Key data includes:

- `x`, `y`, `width`, `height`
- `assetId`
- `mime`
- `name`

Current media elements do **not** persist an inline `src` field.

#### `ArrowElement` / connector model

The arrow model contains substantial geometry and text state, including:

- start/end/control points
- optional multiple controls
- point count
- visual style
- curve mode
- arrow mode
- opacity
- binding information
- normalized anchors
- branch records
- main label
- start/end labels
- branch labels
- canonical text documents for labels
- font family and label-position metadata

#### `TextElement`

Key data includes:

- `x`, `y`
- plain convenience `text`
- canonical `textDoc`
- font size/scale
- alignment
- optional measured width
- font family

### Connectable elements

The current `ConnectableElement` union is:

```text
Rectangle | Note | Media | Text
```

Freehand strokes and arrows are not part of that union.

## 9. Canonical text model

Canonical rich text is defined in:

```text
src/model/text-document.ts
```

Current text model version:

```ts
TextDocument.version === 1
```

Conceptually:

```ts
TextDocument {
  version: 1;
  lines: RichLine[];
}
```

Each `RichLine` can contain:

- runs
- list type
- indentation
- checked state
- ordered-list numbering/index/path data
- continuation metadata

Each `RichRun` can contain:

- text
- bold
- italic
- underline
- strike
- text color
- highlight

### Critical source-of-truth rule for text

The persisted canonical source is **`TextDocument`**, not contenteditable HTML.

Plain `text` fields remain as convenience/derived plain-text fields.

Editor HTML is a temporary editing/clipboard projection and should not become a second persisted source of truth.

The source contains conversion and normalization helpers for:

- plain text → document
- legacy rich content → document
- document → plain text
- document → HTML
- HTML → document
- structured list numbering normalization

## 10. Rendering system

Rendering is Canvas 2D based.

Primary modules:

```text
src/renderer/index.ts
src/renderer/shapes.ts
src/renderer/dpi.ts
src/renderer/constants.ts
```

### Scene rendering

`drawScene()` / rendering helpers:

- operate in CSS-pixel logical coordinates after DPI setup
- apply camera translation and zoom
- cull many off-screen elements
- draw the dotted board background
- render elements by type
- render selections and resize handles
- render arrow control points
- render marquee/eraser overlays
- render connection anchors when relevant

`redraw()` is requestAnimationFrame-coalesced rather than blindly painting synchronously for every request.

### High-DPI behavior

`src/renderer/dpi.ts` clamps effective device-pixel ratio to:

```text
1 ≤ DPR ≤ 2
```

This is tested.

### Freehand performance

Freehand rendering uses cached `Path2D` geometry.

### Large-board spatial index

The current source has a derived, runtime-only uniform-grid scene index in `src/performance/`.

- It activates lazily at **180 elements**; smaller boards intentionally retain the previous linear scan path to avoid index overhead and preserve simple behavior.
- Grid cells are **320 world units**. Scene z-order is **not** stored in the index: `appState.elements` remains authoritative, and queried IDs are projected back into the existing bottom-to-top order.
- Very large objects are kept in an overflow set instead of being duplicated into hundreds of buckets. Extremely large query rectangles fall back to one exact entry scan instead of thousands of bucket lookups.
- Index updates are incremental after element add/delete/move/geometry/style actions. Manual bound arrows are tracked as dependents of their binding targets so their spatial envelope is refreshed when a target moves.
- Auto-routed arrows are deliberately kept as a small volatile fallback candidate set because their path can change when unrelated routing obstacles move. This favors correctness over stale cached bounds.
- Candidate lookup is now used before the existing exact tests for normal point selection/overlap picking, marquee selection, eraser point/marquee targeting, arrow connection magnetism, normal viewport rendering, Arrow-tool connection anchors, text-target lookup, and move-background snapshot capture.
- Candidate lookup never replaces the final exact `hitTestElement` / arrow visual hit test / rectangle intersection checks. The index is an acceleration layer, not a change to interaction semantics.
- Move/resize **snapping intentionally remains a global scan** because current snapping can align to far-away objects that share an X/Y axis; restricting it to a local spatial window would change product behavior.

### Derived layout/geometry caching

The performance layer now extends beyond freehand paths:

- Rich-text measurement/layout uses a bounded **1,200-entry LRU** keyed by canonical text lines, relevant text style, font family/size/scale, and wrap width. Object position, camera pan, and zoom are intentionally excluded, so moving/panning unchanged text reuses the same measurement work.
- Browser font `loadingdone` invalidates rich-text layout metrics and scene spatial bounds, preventing measurements made with a fallback font from remaining stale after the intended font loads.
- Arrow authored/resolved path geometry, sampled Smooth/rounded render paths, and sampled branch paths are cached as derived runtime data. Live-move affected arrows bypass those caches while bindings are moving.
- Auto-route obstacle lists and deterministic label-collision obstacle bounds are cached by the scene-geometry generation because unrelated obstacle movement/visibility can legitimately change those results.
- None of these caches are persisted into `project.json`, recovery snapshots, history, or the project ZIP.

### Move performance optimization

While objects are being moved, the renderer maintains cached background/selection canvases and redraws only the necessary dynamic content, including affected arrows, instead of repainting every note/media item on every mouse move. Large-board move-snapshot capture now spatially culls the snapshot candidates before doing the same exact geometry checks.

Static regression checks explicitly protect parts of this performance behavior.

### Text rendering

Canvas text is rendered from canonical structured lines. Rendering supports:

- list markers
- nested indentation
- rich runs
- highlights
- underline
- strike
- alignment
- text scaling/font choices
- shape text positioning

While a text-bearing object is actively edited, its corresponding canvas text is suppressed so the HTML editor is not visually duplicated underneath it.

### Media rendering

- Images are hydrated into `HTMLImageElement`s and drawn to canvas.
- Videos are hydrated into muted, inline `HTMLVideoElement`s and the current decoded video frame is drawn if available.
- No playback controls or explicit `video.play()` flow were found in the inspected source. Therefore, treat video as imported/renderable media rather than assuming the app is a video player.
- Missing/unready assets render placeholders.

## 11. User interaction system

### Pointer interaction

Primary owner:

```text
src/interactions/pointer.ts
```

It installs canvas/window listeners and acts as a large interaction state machine.

Current interaction modes include:

```text
none
drawing
moving
resizing
marquee
panning
arrow-start
arrow-control
arrow-end
arrow-label-moving
arrow-branch-control
arrow-branch-end
eraser-preview
eraser-marquee
```

Important behavior includes:

- creation of brush/rectangle/note/arrow objects
- immediate note text editing after note creation
- selection and marquee behavior
- move/resize
- snapping
- erasing
- object duplication via Alt-drag
- arrow binding
- arrow control-point editing
- double-click text editing

Double-click behavior is important:

- double-clicking text-bearing objects enters text editing
- double-clicking arrow labels/branch labels edits those labels
- double-clicking relevant connector path areas can add/edit labels
- double-clicking blank canvas creates a standalone `TextElement`

### Keyboard interaction

Primary owner:

```text
src/interactions/keyboard.ts
```

Keyboard handling is generally disabled while the custom text editor is active so editing keystrokes are not interpreted as board commands.

Fixed behavior includes:

- Escape cancellation/deselection/editor exit depending on context
- Space hold-to-pan
- Arrow-key nudging
- Shift + Arrow larger nudging
- Delete/Backspace deletion
- Alt-drag duplication
- Tab / Shift+Tab text-list behavior while editing

The configurable shortcut system covers file, edit, object, and tool commands.

## 12. Text editing system

Primary modules:

```text
src/text-editor/index.ts
src/text-editor/commands.ts
src/model/text-document.ts
```

`src/text-editor/index.ts` is one of the largest and most behaviorally sensitive files in the project.

### Editing surface

Editing uses an HTML contenteditable overlay positioned over or near the canvas text being edited.

The editor supports:

- standalone text
- note text
- rectangle text
- arrow main labels
- arrow endpoint labels
- branch labels

### Editor open flow

`startTextEditing(...)` roughly:

1. closes any prior active editor
2. starts/associates a history transaction
3. selects the target when appropriate
4. converts canonical `TextDocument` data to editor HTML
5. creates/positions the contenteditable shell
6. installs editor-specific input/selection/clipboard/list behavior

### Editor close/commit flow

`closeTextEditor(commit = true, ...)` deliberately tears down editor listeners/DOM before parsing/committing the content. This ordering exists to avoid trapping the user in a broken editor state.

On commit it:

1. sanitizes editor content
2. converts editor DOM/HTML to canonical `TextDocument`
3. derives the convenience plain-text field
4. updates the correct element/label through store actions
5. persists locally
6. commits the associated history transaction

Special empty-content behavior includes:

- an empty standalone `TextElement` can be removed
- empty rectangle text becomes absent/undefined rather than forcing content
- note handling preserves note object semantics

There is fallback logic intended to preserve plain text if rich parsing fails.

### `execCommand` boundary

Legacy browser editing commands are isolated in:

```text
src/text-editor/commands.ts
```

Some inline/list operations still rely on this compatibility path. Avoid scattering new `document.execCommand(...)` calls through unrelated modules.

### Lists are structural

Bullets, numbers, checklists, and nesting are represented structurally in `TextDocument`; they are not merely characters prepended to plain text.

Ordered-list numbering is normalized from structural state to repair browser-generated/stale list metadata.

## 13. Clipboard behavior

There are three distinct clipboard contexts.

### A. Rich-text editor clipboard

The text editor handles copy/paste itself.

On copy, the source can write:

- `text/plain`
- `text/html`
- custom MIME:
  - `application/x-my-board-rich-text`

The custom payload contains canonical rich-text information so same-app paste can survive browsers/hosts that strip HTML or list ancestry.

The editor also keeps an in-memory same-app clipboard fallback for a limited freshness window.

Paste handling includes:

- sanitization
- repairing orphaned list HTML
- preferring canonical same-app payload where available
- handling HTML
- recognizing explicit list-marker plain text
- DOM Range insertion
- caret restoration/retry behavior
- normalization after insertion
- last-resort plain-text insertion

Clipboard regressions are heavily covered by Playwright tests.

### B. Board-object clipboard

Object copy/cut/paste lives primarily in:

```text
src/ui/context-menu.ts
```

Copy:

- stores a `structuredClone` of selected elements in `appState.internalClipboard`
- also attempts to write JSON text to `navigator.clipboard`

Paste:

- uses **`appState.internalClipboard`** for Rimmap object paste
- board-level Ctrl+V first checks for an actual image clipboard payload; if present, the image is imported as media at the viewport center instead of using stale internal object data
- does **not** read the OS clipboard JSON back in
- offsets pasted copies by approximately `+24, +24`
- generates new element IDs
- regenerates group IDs as needed
- keeps shared media `assetId` references instead of duplicating Blob bytes
- pastes copied objects unlocked

Important consequence: **board-object paste is effectively same-running-session behavior**. The OS clipboard write does not currently make copied board objects portable across reloads/tabs/app sessions because the paste path does not read/deserialize that external JSON.

### C. Export clipboard

`src/exports/index.ts` can copy rendered output:

- SVG through `ClipboardItem` when supported, with text fallback
- PNG through `ClipboardItem` when supported

## 14. Undo/redo and history

Primary modules:

```text
src/state/history.ts
src/state/history-core.ts
```

Current history limit:

```ts
HISTORY_LIMIT = 100
```

### History model

History is **patch-based**, not whole-project snapshot-based.

A `HistoryEntry` contains:

- property patches
- inserted elements
- removed elements
- optional element-order before/after arrays

### Transaction model

Features begin a transaction with:

```text
beginHistoryTransaction()
```

and finish with:

```text
commitHistory(...)
```

The history integration observes store changes and captures an element’s “before” version only once per transaction, then constructs the final patch at commit.

This design is important for high-frequency actions such as:

- pointer moves
- resizing
- drawing
- text edits

One user gesture should generally become one undo step rather than hundreds.

### Undo/redo behavior

Undo/redo:

- replays patches through store actions
- closes an active text editor before navigating history
- updates selection as needed
- refreshes layers/rendering
- rehydrates media references
- requests local persistence

### Important rule

New mutation paths that bypass the store or fail to participate in a history transaction can silently break undo/redo even if the visible feature appears to work.

## 15. Persistence, save, load, and recovery

Primary owner:

```text
src/persistence/index.ts
```

### Current recovery keys

```ts
SAFE_PROJECT_KEY = 'my-board-v12-current'
SAFE_CHECKPOINT_KEY = 'my-board-v12-checkpoint'
```

Autosave is debounced by approximately:

```text
180 ms
```

### Recovery strategy

The app maintains:

1. current recovery snapshot
2. previous known-good checkpoint

When persisting, the previous non-empty current snapshot can become the checkpoint before the new current snapshot is stored.

On startup/load, the code can:

- restore current
- recover checkpoint when current is invalid/unusable
- prefer a non-empty checkpoint in a defensive empty-current case
- fall back through older recovery generations
- migrate recovered projects forward
- clean up legacy recovery keys after successful migration

Legacy keys currently recognized include:

```text
my-board-v8-current
my-board-v8-checkpoint
my-board-v7-current
my-board-v7-checkpoint
my-board-v6-current
my-board-v6-checkpoint
my-board-v5-current
my-board-v5-last-nonempty
my-board-v3-current
my-board-v3-last-nonempty
my-board-project-recovery
my-board-elements
```

### Explicit project save format

A normal project save produces a filename ending in:

```text
.board.zip
```

The archive contains:

```text
project.json
preview.png
assets/<asset-file>...
```

Only assets referenced by current media elements are included in the manifest/archive save.

The save path reopens/validates the generated archive before downloading it, checking logical project data and media bytes.

### ZIP implementation

`src/persistence/zip.ts` is a custom ZIP implementation.

Writing uses stored/uncompressed entries.

Reading supports:

- stored entries
- DEFLATE entries through `DecompressionStream`

It validates CRC/size information.

### Open/import compatibility

Open supports current ZIP archives and legacy JSON-style project files. Bare legacy element arrays are also recognized through migration input handling.

Future schema versions greater than the supported current schema are rejected rather than guessed at.

### File System Access API

Where available, project open can use `showOpenFilePicker`; otherwise it falls back to a hidden file input.

## 16. Media/assets handling

Primary owner:

```text
src/media/assets.ts
```

Binary media is intentionally separate from `CanvasElement` document JSON.

### Storage model

Media elements persist:

```text
assetId + display metadata
```

Actual media bytes are stored in IndexedDB under keys beginning with:

```ts
ASSET_STORAGE_PREFIX = 'my-board-v6-asset:'
```

The `v6` in this key is historical: schema v6 introduced external asset storage. It is not the current project schema.

### Runtime caches

The media module maintains in-memory caches for:

- asset manifests
- Blobs
- object URLs
- decoded images
- videos
- data URLs

Object URLs are revoked when runtime media caches are cleared.

### Import types

UI import accepts only still image/vector MIME types and filename extensions, including PNG/JPEG/WebP/SVG/SVGZ/AVIF, and rejects animated/video/audio files such as GIF/APNG/MP4/MOV/WebM/MP3 with a clear warning.

### Duplication/history

Media duplication and undo/redo preserve the same `assetId` reference rather than cloning binary data.

### Potential storage issue

No asset-deletion/garbage-collection path was found in `src/media/assets.ts`; it imports IndexedDB `get` and `set`, not `del`, and deleting a media element does not appear to remove the corresponding stored Blob.

Therefore orphaned binary asset records can plausibly accumulate in IndexedDB over time. Treat this as a visible technical issue unless later source adds explicit cleanup elsewhere.

## 17. Export system

Primary owner:

```text
src/exports/index.ts
```

The export set is:

- SVG
- PNG
- PDF

### Selection semantics

`getExportElements()` first excludes hidden elements. When at least one visible object is selected, it returns the selected **visible** objects; otherwise it returns all visible elements. Hidden objects remain persisted in the project but are not exported until shown again.

### Bounds

Export bounds are calculated from element bounding boxes with padding.

### SVG

SVG is constructed directly in code.

For images, referenced asset Blobs are converted to data URLs and embedded into the SVG.

Video media does not have equivalent embedded-video export behavior; do not assume SVG/PDF/PNG preserves playable video.

### PNG

PNG is rasterized to an offscreen canvas.

Scale is user-selectable, with safeguards around maximum canvas dimensions/pixel count.

### PDF

The code builds a simple PDF directly rather than using a PDF library. It rasterizes/embeds the board representation into a single-page PDF-oriented output.

## 18. Layers, grouping, lock, and arrangement

Primary owner:

```text
src/layers/index.ts
```

Important behaviors:

- stable generated layer names such as type-based numbered names
- inline layer rename
- drag reorder
- lock/unlock control
- independent show/hide visibility control
- overlap/layer picking
- All Layers panel
- a compact search box when the board has at least 20 layers; search matches element type labels and layer names
- preservation of ordering in history
- selection synchronization

Locked layers/elements cannot be reordered through normal layer drag behavior. While a Layers search is active, drag reorder is also disabled so filtered rows cannot make z-order changes ambiguous.

Hidden layers remain in the project and in their existing layer order. They do not render on the canvas, participate in canvas hit-testing/marquee/eraser/snapping/connection targeting, or export. Hiding a selected object removes it from selection. Visibility and lock are independent: a locked object can be hidden/shown without unlocking it.

A notable architectural/design rule in current code is that unlocking is intentionally restricted to the All Layers lock control.

Grouping is now first-class document structure rather than an element tag. The normalized hierarchy is owned by `appState.layerGroups: LayerGroupNode[]`: elements use optional `parentGroupId`, and group nodes can themselves use optional `parentGroupId`, so groups can be nested. The pure hierarchy/projection helpers live in `src/layers/model.ts`.

The Layers panel renders this hierarchy as expandable/collapsible group rows. Collapse state is UI-only (`collapsedLayerGroupIds`) and is intentionally not persisted or recorded in Undo/Redo. Clicking a group row selects its visible/unlocked descendant elements and records the exact `selectedLayerGroupId`; clicking a leaf row in Layers drills into that single object. Normal canvas clicks, direct right-click selection, and the overlap picker retain the outermost-group selection behavior and preserve the exact group target when a single group is selected.

An exact group selection is a **structural target** for copy, duplicate, cut, delete, lock, and ungroup: those commands resolve all descendants, including hidden descendants, so visibility cannot leave ghost children behind. Structural mutations are blocked if any descendant is locked. Canvas move/resize/Alt-drag still operate only on the currently selectable visible/unlocked descendants, preserving the existing lock/visibility interaction model. Align/distribute and Arrange are intentionally disabled when an exact group node is selected; group-level geometry and group-level z-order semantics must be designed explicitly rather than accidentally aligning/reordering a group's children.

**Important z-order design rule:** `appState.elements` remains the authoritative canvas render/export z-order. Layer-group structure is deliberately separate from canvas stacking. This preserves legacy projects where members of one old flat group were interleaved with unrelated objects. Grouping, nesting, ungrouping, migration, and group rename must not silently reorder `elements`. In schema v11, group rows themselves are not drag-reorder targets; leaf element rows retain the existing z-order reorder behavior and do not reparent objects. If group-level z-order moves or drag-to-reparent are added later, define their semantics explicitly rather than conflating tree structure with the element render order.

## 19. Inspector and UI shell

### DOM shell

`src/ui/dom.ts` creates the application UI programmatically with `innerHTML`.

It includes, among other things:

- canvas
- bottom toolbar
- Undo/Redo
- Clear
- Reset View
- Shortcuts
- All Layers
- project menu
- PNG/SVG/PDF export controls
- hidden project/media inputs
- context menu

### Inspector

`src/ui/inspector.ts` owns the contextual Properties UI and related layout/resize behavior.

Visible property controls cover areas such as:

- brush thickness/color
- text size/font/alignment
- note/rectangle fill
- note/rectangle text placement
- rectangle stroke enabled/style/spacing/color
- arrow style
- curve mode
- arrow thickness/color

A regression test explicitly asserts that the Properties UI **omits arrow opacity**, even though arrow opacity exists in the model/rendering/migration system. Do not add an opacity control casually without understanding whether this omission is intentional product behavior.

## 20. Shortcuts

Primary modules:

```text
src/shortcuts/definitions.ts
src/shortcuts/index.ts
```

Shortcut preferences are stored separately from the project.

The app provides:

- default bindings
- shortcut editing UI
- duplicate/conflict handling
- reserved-browser-shortcut checks
- reset/save behavior

Project `AppState` carries active bindings/draft/capture state.

A shortcut preference storage generation of `v1` is visible in the shortcut subsystem; this is separate from project schema v12.

## 21. Current file/data/schema versions

There are several independent version concepts. Do not conflate them.

| Version concept | Current value | Meaning |
|---|---:|---|
| Project document schema | **12** | Structure/content of `project.json` |
| Project ZIP archive version | **1** | Layout/version of the `.board.zip` container |
| Canonical rich-text `TextDocument` | **1** | Rich-text document model |
| Recovery key generation | **v12** | Current IndexedDB current/checkpoint key names |
| Media asset key prefix | **v6** | Historical prefix introduced when media was externalized |
| npm package version | `0.0.0` | Package metadata; not a useful data-schema indicator |
| `SAFE_BUILD_LABEL` | `V5.5-NO-TEXT-TOOL` | UI/status build label; not the document schema |

The authoritative schema constant is:

```ts
CURRENT_SCHEMA_VERSION = 12
```

in `src/persistence/migrations.ts`.

## 22. Existing migrations

Migrations live in:

```text
src/persistence/migrations.ts
```

The migration chain currently reaches v12.

### v1 → v2

- normalizes/defaults project settings

### v2 → v3

- normalizes/defaults project settings

### v3 → v4

Makes several previously implicit presentation/layer fields explicit:

- lock state
- stable layer names
- text shape presentation
- one-time font-size → text-scale conversion
- default font family/alignment
- note fill/radius
- rectangle stroke fields

### v4 → v5

Makes arrow/connector representation more explicit:

- control geometry
- arrow styles
- smooth/sharp curve mode
- connection/branches mode
- opacity
- 3/5-point controls
- deterministic branch IDs
- label position/side/font defaults
- branch geometry normalization

### v5 → v6

Externalizes media:

- removes inline/embedded `src` from `MediaElement`
- creates/uses `assetId`
- establishes asset manifest entries
- stages legacy embedded data for Blob materialization
- sets archive version 1

### v6 → v7

Removes obsolete standalone/global color-panel preference semantics.

Legacy `currentColor` can seed brush color, while brush and arrow colors remain independent.

### v7 → v8

Makes `TextDocument` canonical:

- converts text/note/rectangle content
- converts arrow trunk/start/end/branch labels
- removes persisted contenteditable HTML
- removes legacy `richLines` caches
- derives plain convenience text from canonical structure

### v8 → v9

Adds/normalizes shape text positioning and list numbering:

- explicit `textVerticalAlign` for notes and rectangles
- structured list-numbering normalization to repair stale ordered-list browser metadata

### v9 → v10

Adds explicit element visibility persistence:

- normalizes `hidden` to a boolean on every element
- old v9 projects open with elements visible by default
- current saves/recovery preserve hidden state

### v10 → v11

Replaces flat element grouping with first-class Layer-group nodes:

- creates document-level `layerGroups: LayerGroupNode[]`
- migrates legacy element `groupId` membership to element `parentGroupId`
- allows each `LayerGroupNode` to reference a `parentGroupId`, enabling nested groups
- assigns stable migrated group names such as `Group 1`
- removes legacy `groupId` from current element data
- preserves the `elements[]` array order exactly, including legacy interleaved-group cases
- validates/deduplicates group IDs and repairs invalid/cyclic parent references during normalization
- removes empty structural groups during normalization/cleanup

### v11 → v12

Makes connector routing mode explicit without changing legacy visuals:

- adds optional persisted `ArrowElement.routingMode: 'manual' | 'auto'`
- migrates every v11 arrow/connector to `routingMode: 'manual'`, even if unknown pre-v12 data contains a similarly named field
- keeps branches Manual-only
- permits arbitrary authored `controls[]` waypoint counts in the current runtime/import model, with one shared 32-waypoint cap enforced during live editing and import so saved/reopened projects preserve exactly what the UI can create
- moves current recovery snapshots to `my-board-v12-current` / `my-board-v12-checkpoint`; v11 keys remain legacy recovery inputs
- Auto route corners remain derived render geometry rather than persisted controls

Auto routing itself is implemented in `src/arrows/routing.ts` and integrated through shared geometry in `src/model/geometry.ts`. Floating-label avoidance is implemented in `src/arrows/label-collision.ts`; direct waypoint array operations live in `src/arrows/waypoints.ts`.

### Current-schema cleanup

Even when data is already at the current schema, the migration/current-schema cleanup code strips legacy rich-text/cache fields and rejects invalid current media records missing an `assetId`.

Future schema versions are rejected.

## 23. Testing setup

### npm commands

From `package.json`:

```bash
npm run dev
npm run build
npm run typecheck
npm run test:static
npm run test:text
npm run test:e2e
npm run test:browser
npm test
```

Meanings:

```text
npm run dev
  → vite

npm run build
  → vite build

npm run typecheck
  → tsc -p tsconfig.json --noEmit

npm run test:static
  → bash scripts/check-all.sh

npm run test:text
  → playwright test tests/text-editor.regression.spec.ts

npm run test:e2e
  → playwright test tests/workflows.spec.ts

npm run test:browser
  → playwright test

npm test
  → npm run test:static && npm run test:browser
```

### Static/guard suite

`scripts/check-all.sh` runs:

- entry-point reachability guard
- layer rename guard
- layer arrangement guard
- store mutation guard
- patch-history guard
- media asset guard
- text-model guard
- CSS cleanup guard
- schema-version guard
- browser-test presence/coverage guard
- paste/exit guard
- note/rectangle performance guard
- large-board spatial-index / derived-cache guard
- canvas-feature guard
- TypeScript typecheck
- DPI smoke test
- UUID/id-generation smoke test
- `TextDocument` smoke test
- history patch smoke test
- store action smoke test
- schema migration smoke test
- ZIP smoke test
- runtime undo/redo smoke test

### Playwright

`playwright.config.ts` currently uses:

- `tests/` as test directory
- one worker
- non-fully-parallel execution
- Desktop Chrome project
- base URL `http://127.0.0.1:4173`
- Vite dev server on port 4173
- test URL mode with `?test=1`
- trace retained on failure
- screenshot only on failure
- video retained on failure
- `/usr/bin/chromium` when available, otherwise Playwright/default executable behavior
- `--no-sandbox` launch argument

### Browser regression coverage

`tests/canvas-features.spec.ts` covers:

- DPR cap
- keyboard nudging
- move snapping
- resize snapping
- align/distribute/equal spacing
- Layers visibility/lock independence and hidden-object export/selection behavior
- large-board Layers search visibility and type/name filtering
- real nested Layer-group rows, collapse/expand, leaf drill-down, group visibility, and group rename
- large-board spatial-candidate activation/selectivity and reuse of rich-text layout measurements

`tests/text-editor.regression.spec.ts` has extensive coverage for:

- empty Note editing
- logical line breaks
- wrapping
- bullet/numbered/nested lists
- Tab/Shift+Tab nesting
- selection direction/toolbar anchoring
- toolbar viewport positioning
- Escape commit/exit
- save/open of structured formatting
- rectangle list structure
- shape text padding/center positioning
- rich list clipboard
- paste then editor exit
- cross-object list copy/paste
- selected-range list context
- numbering preservation
- immediate paste behavior
- same-app clipboard fallbacks
- real Ctrl+C/Ctrl+V behavior
- suppression of accidental editor background highlights
- omission of arrow opacity from Properties
- exact clipboard range
- wrapped HTML list clipboard across Text/Rectangle/Note

`tests/workflows.spec.ts` includes an integrated workflow:

```text
Note
→ rich text
→ bound arrow
→ move
→ save
→ reload
→ geometry/text preserved
```

## 24. Test status observed during the latest connector-routing refactor

The current source is schema v12. Manual connector behavior remains the compatibility default; Auto routing is opt-in. The final audit covers routing determinism/obstacle avoidance, deterministic label collision avoidance, arbitrary waypoint insertion/removal, v11→v12 migration compatibility, renderer/export integration, and existing Layer-group/history behavior.

A later arrow-label sizing follow-up keeps schema v12 because `ArrowElement.labelFontSize` already existed in the persisted model. `src/model/text.ts` now owns the shared S/M/L/XL/XXL preset values, the Arrow Properties panel reuses those same controls, current-project normalization preserves supported `labelFontSize` values instead of resetting them to 14px, and the live trunk-label editor renders at the selected size. Endpoint and branch-label sizing were intentionally not changed by this request.

A subsequent WYSIWYG label-layout fix also keeps schema v12 because label width remains derived state. `src/arrows/label-layout.ts` owns the pure connector-length/font-size width policy, and `getPathLabelLayoutFromLines()` is now the shared layout seam for normal trunk/branch rendering and the live connector-label editor. The editor no longer has hardcoded `14px`, `1.25` line-height, or `230px` maximum-width overrides; it uses the same 1.35 line height and exact path-derived wrapping width as canvas/export. This also fixes the previous double-wrap bug where view mode wrapped at 220px, shrank to the longest wrapped line, then wrapped a second time against that smaller width. Endpoint labels retain their compact 220px maximum; path labels can use up to 360px based on connector length.

### Passed independently in the final v12 audit

- TypeScript 5.8.3: `tsc -p tsconfig.json --noEmit`
- layer rename guard
- layer arrangement/exact-group z-order guard
- store mutation guard
- history patch guard
- media asset guard
- text-model guard
- CSS cleanup guard
- schema-version guard
- browser-test static coverage guard
- paste/exit guard
- note/rectangle performance guard
- large-board spatial-index / derived-cache guard
- canvas-feature guard
- connector static integration guard
- arrow-label size integration guard (shared presets, Properties wiring, persistence preservation, live-editor sizing)
- arrow-label WYSIWYG/layout integration guard (shared edit/view layout, no hardcoded 14px editor override, 1.35 line-height)
- arrow-label path-width smoke test (deterministic scaling from connector length/font size, 360px cap)
- DPI smoke test
- UUID/id-generation smoke test
- `TextDocument` smoke test
- history-patch smoke test
- Layer-group model smoke test
- spatial-bucket index smoke test
- bounded LRU-cache smoke test
- scene-index/invalidation smoke test
- Auto router smoke test, including deterministic routing through a synthetic 100-card board
- arrow-label collision smoke test
- arbitrary arrow-waypoint insertion/removal/duplicate-detection smoke test; runtime/import both enforce the shared 32-waypoint persistence cap
- store-action smoke test
- schema-migration smoke test, including v11→v12 forced-Manual compatibility
- ZIP round-trip smoke test
- runtime Undo/Redo smoke test

### Large-board responsiveness/performance audit (2026-09-10)

This performance update remains **schema v12** because all acceleration structures, timing data, interaction snapshots, and caches are derived runtime state only. `appState.elements` remains the persisted document and authoritative z-order. The spatial index still activates at 180 elements and preserves the old linear path below that threshold.

The completed hot-path pass adds the following behavior on top of the existing spatial index/culling system:

- Raw move/resize/pan mouse events are coalesced. Pointer events only replace the latest pending input and request shared visual work; expensive interaction-state work runs at most once per animation frame.
- Canvas invalidation and interaction visual tasks share one module-local `requestAnimationFrame` scheduler in `src/renderer/index.ts`, so independent callers cannot force multiple canvas paints in the same display frame.
- The move-time cached static-board renderer now asks the connector dependency graph for only arrows bound to the moving element IDs instead of scanning every connector/branch.
- `src/performance/scene-index.ts` maintains fast ID projection plus binding-dependency lookup (`getSceneElementById`, `getConnectedArrowIdsForElementIds`) alongside spatial buckets.
- Selection membership has a memoized `Set` in `src/performance/selection-cache.ts` for hot interaction checks.
- Drag/resize snapping captures stationary target geometry once at interaction start and performs sorted/binary-range lookup during frames. This retains current far-axis snapping semantics while avoiding a full geometry rebuild/scan per raw pointer event.
- Element envelopes, rich-text layout, measured rich-text paint widths, connector render samples, branch paths, and arrow-label geometry are runtime-cached and invalidated by immutable object/style/content/geometry dependencies rather than camera movement.
- Text layout keeps both content-addressed bounded LRU caching and immutable-element reuse; repeated paints can reuse per-line/per-run measured widths instead of calling `measureText()` for every run on every frame. Font-load completion clears dependent text/spatial geometry.
- Opt-in instrumentation in `src/performance/instrumentation.ts` records frame, `drawScene`, text-layout-miss, spatial-query, and binding-update durations only while explicitly enabled.
- Test hooks provide a deterministic 600-object stress board plus instrumentation/stat access for repeatable profiling.
- Confirmed unreachable default Vite starter residue (`src/counter.ts` and unused starter assets) was removed after the hot-path work; the entry-point reachability guard is now green.

Passed after the completed responsiveness refactor:

- `bash scripts/check-all.sh` (the full static/type/model/schema/history/ZIP/UI guard/smoke suite)
- `tsc -p tsconfig.json --noEmit` through that suite
- `scripts/check-performance-system.mjs`
- `scripts/spatial-index.smoke.ts`
- `scripts/lru-cache.smoke.ts`
- `scripts/instrumentation.smoke.ts`
- `scripts/scene-index.smoke.ts`, including lazy activation, local-query selectivity, bound-arrow dependency refresh, connector dependency lookup, scene-generation invalidation, and Auto-arrow volatile fallback
- the existing deterministic 100-card Auto-routing regression
- all existing DPI, ID, text-document, history, Layer-group, arrow-label, waypoint, store, migration, ZIP, and runtime Undo/Redo smoke tests

The browser stress regression remains present in `tests/canvas-features.spec.ts`. The release archive intentionally excludes `node_modules`, so live Vite/Playwright execution requires a normal platform-correct dependency install.

### Browser/build environment limitation in the final packaging environment

The release archive intentionally excludes `node_modules`. In the final sandbox, Vite and Playwright are not installed/cached, so `vite build` and `playwright test --list` cannot run there without fetching packages. This is an environment limitation, not a source diagnostic. After a normal platform-correct dependency install, run:

```bash
npm install
npm run build
npm run test:browser
```

The repository contains browser regressions for Auto routing, deterministic label collision avoidance, double-click/Alt-click waypoint editing, shared S–XXL trunk-label sizing, and edit/view arrow-label layout synchronization with connector-length-aware width in `tests/canvas-features.spec.ts`.

## 25. Architectural rules future changes should preserve

These rules are supported by current implementation and/or explicit regression guards.

### State and history

1. **Mutate board/application state through store actions.**
   Do not introduce casual direct assignments to `appState`.

2. **Wrap undoable user gestures in history transactions.**
   One drag/edit should normally become one history entry.

3. **Keep history patch-based.**
   Do not casually revert to serializing/cloning the whole board for every interaction.

4. **Preserve element order through history when a feature changes z-order.**

### Text

5. **`TextDocument` is the persisted rich-text source of truth.**
   Do not persist contenteditable HTML as a competing canonical representation.

6. **Derive convenience plain-text fields from canonical text structure.**

7. **Keep list semantics structural.**
   Numbering, bullets, check state, indentation, and nesting should survive edit → render → save → reload → clipboard round trips.

8. **Preserve the editor teardown-before-parse/commit behavior unless there is a very strong reason to change it.**
   It is a defensive measure against a trapped editor.

9. **Keep legacy `execCommand` usage isolated to the editor command boundary.**

10. **Do not reintroduce white/editor-surface background formatting through clipboard operations.**

### Persistence and schema

11. **Bump the schema when persisted semantics change incompatibly.**
   Add an explicit migration instead of silently interpreting old data as new.

12. **Keep document schema version and archive version conceptually separate.**

13. **Reject future unknown schemas rather than guessing.**

14. **Do not put binary media back into `CanvasElement` JSON.**
   Persist media by `assetId` and keep Blob storage/archive assets separate.

15. **Preserve current/checkpoint recovery behavior and do not weaken data-loss safeguards casually.**

16. **When saving, include only referenced assets but ensure every referenced current media object can resolve its asset.**

### Rendering and interaction

17. **Respect the 2× live-canvas DPR cap unless performance/testing is deliberately reconsidered.**

18. **Preserve move-time rendering caches/performance shortcuts.**
   Avoid making every raw mousemove publish expensive document work or repaint every note/media object. Move/resize/pan input is intentionally coalesced to the shared visual frame, and the cached static-board interaction renderer should redraw only moving content, affected connectors, and overlays.

18a. **Keep one centralized visual-frame scheduler.**
   Canvas redraw requests and interaction-frame tasks share the scheduler in `renderer/index.ts`. Do not add independent `requestAnimationFrame` redraw loops without a measured reason; coalesce work into the existing frame.

18b. **Treat the spatial index and fast scene lookup as derived acceleration state, never document state.**
   Keep `appState.elements` authoritative for persistence and z-order. Spatial queries must narrow candidates and then run the existing exact geometry/hit tests. Preserve the small-board linear path unless intentionally re-benchmarking the threshold.

18c. **Invalidate caches by their real dependencies rather than camera movement or unrelated UI state.**
   Text measurement/layout keys should depend on content/style/wrap geometry, not object position or camera. Scene-dependent Auto routing/label-obstacle caches must invalidate when relevant scene geometry/visibility changes. Font loading must invalidate cached text metrics. Never serialize these caches into history/recovery/project files.

18d. **Preserve correctness fallbacks for geometry that is globally scene-dependent.**
   Auto-routed arrows currently remain volatile spatial candidates because unrelated obstacles may change their route. Do not place them into stable buckets without a complete invalidation strategy.

18e. **Use the connector dependency graph for moving-target updates.**
   Bound-arrow updates and move-time connector compositing should query `getConnectedArrowIdsForElementIds()` rather than scan every arrow/branch. Keep dependency refresh correct when bindings are created, detached, pasted, deleted, or replaced.

18f. **Preserve snapshot/binary-search snapping semantics.**
   Stationary snap geometry is captured once per move/resize interaction and queried from sorted target arrays. This optimization intentionally preserves alignment to far-away objects sharing an axis; do not replace it with local-only spatial snapping unless product semantics are deliberately changed and tested.

18g. **Keep performance instrumentation opt-in and representative.**
   Instrumentation must have negligible disabled overhead. Maintain the deterministic stress-board hook and measure frame/draw/text/spatial/binding costs before introducing more invasive rendering architecture.

19. **Keep bound arrow geometry synchronized when connectable objects move/resize.**

20. **Preserve the current locked-object interaction model, especially the All Layers-only unlock path, unless product behavior is intentionally changed.**

20a. **Treat visibility as independent document state, not as lock state.**
   Hidden objects must remain persisted/in layer order, stay canvas-inert, and stay out of default export until shown again.

20b. **Keep Layer-group structure normalized and separate from canvas z-order.**
   `layerGroups[]` + `parentGroupId` is now the grouping source of truth. Do not reintroduce runtime `groupId`, persisted child arrays, or implicit element reordering as a side effect of grouping/nesting. Group-level z-order operations and drag-to-reparent require explicit semantics and tests.

20c. **Treat an exact Layer-group selection as a structural target.**
   Copy/duplicate/cut/delete/lock/ungroup must resolve the whole descendant tree, including hidden descendants; locked descendants remain a mutation barrier. Canvas move/resize/Alt-drag stay limited to visible/unlocked selected descendants. Do not make Align/Distribute or Arrange operate on an exact group until group-level geometry/z-order behavior is explicitly designed.

21. **Remember that blank-canvas double-click is the current standalone-text creation mechanism.**
   There is no `'text'` tool in the `Tool` union.

### Initialization/module behavior

22. **Treat `pointer.ts` and `ui/wiring.ts` as required side-effect modules.**

23. **Be careful with import-order refactors.**
   The code currently has significant circular dependencies and top-level DOM/listener setup.

### Testing

24. **Run static guards and Playwright regressions for cross-cutting changes.**
   Text, persistence, history, arrows, and renderer changes should not be validated only by manual clicking.

## 26. Fragile or high-risk areas

### 1. Rich-text editor and clipboard

Files:

```text
src/text-editor/index.ts
src/text-editor/commands.ts
src/model/text-document.ts
src/renderer/index.ts
src/persistence/migrations.ts
tests/text-editor.regression.spec.ts
```

Why high risk:

- multiple representations are converted at boundaries
- browser Selection/Range behavior is subtle
- list HTML differs across browsers/clipboard hosts
- same-app fallback behavior is intentionally defensive
- editor exit/commit ordering matters
- text affects rendering, migration, persistence, clipboard, and history simultaneously

### 2. Persistence/migrations/recovery

Files:

```text
src/persistence/index.ts
src/persistence/migrations.ts
src/persistence/zip.ts
src/media/assets.ts
```

Why high risk:

- mistakes can cause user data loss
- multiple historical formats are supported
- current/checkpoint recovery has defensive fallback behavior
- explicit saves combine logical data and external asset bytes
- schema and archive versions are independent
- legacy media migration can materialize embedded data into Blob storage

### 3. Arrow geometry and binding

Files:

```text
src/model/geometry.ts
src/arrows/index.ts
src/interactions/pointer.ts
src/interactions/movement.ts
src/renderer/index.ts
```

Why high risk:

- bindings depend on object geometry
- multiple curve/control-point modes exist
- branches introduce separate path/label geometry
- movement must update dependent connectors
- labels have path-relative positioning

### 4. History/store coupling

Files:

```text
src/state/store.ts
src/state/history.ts
src/state/history-core.ts
```

Why high risk:

- a mutation can visibly work while silently bypassing undo/redo
- one high-frequency interaction should remain a single history entry
- reorder history needs order metadata
- media history must preserve IDs without copying Blob payloads

### 5. Import cycles and side effects

The large circular import component makes “simple” module rearrangement risky.

Potential failure classes include:

- imported bindings observed before expected initialization
- DOM nodes not yet created
- listeners not installed
- cycles becoming runtime errors after moving a top-level expression
- bundler-dependent behavior changing after refactoring

### 6. Canvas performance

Large boards can be sensitive to:

- repeated full-scene scans and redraws
- note/media rendering during drag
- repeated rich-text `measureText()` / wrapping work
- repeated Smooth/Auto/branch arrow sampling and obstacle collection
- freehand geometry allocations
- high-DPI bitmap sizes
- export bitmap size limits

The current mitigation is layered: small boards keep simple linear scans; boards with 180+ elements use uniform spatial buckets for local/viewport candidate lookup; exact hit/bounds checks still decide behavior; text layout uses a bounded LRU; freehand and arrow-derived geometry are cached; move snapshots avoid repainting static content. Performance regressions are explicitly guarded by `check-performance-system.mjs` plus spatial-index/LRU/scene-index smoke tests.

## 27. Known TODOs/issues visible in the current source

### Explicit TODO markers

No `TODO`, `FIXME`, `HACK`, or `XXX` markers were found in the inspected `src/`, `scripts/`, or `tests/` files.

### Observed issues / inconsistencies

#### A. Static test suite currently fails on `src/counter.ts`

`src/counter.ts` is unreachable from the actual application entry graph, and `check-entrypoint.mjs` fails because of it.

This file appears to be unused Vite starter residue.

#### B. Top-level README is stale about the current schema

`README.md` still describes the current document schema as **v8** and names `my-board-v8-current` / `my-board-v8-checkpoint` as current recovery keys.

The source-of-truth implementation is:

```text
schema v12
my-board-v12-current
my-board-v12-checkpoint
```

#### C. Schema guards are synchronized with connector-routing schema v12

`scripts/check-schema-version.mjs` now checks the v12 model constant, v9→v10 visibility, v10→v11 real Layer groups, v11→v12 connector routing, v12 recovery keys, `layerGroups`, `parentGroupId`, and the absence of runtime `groupId`. `scripts/schema-migrations.smoke.ts` covers interleaved legacy-group z-order preservation, nested current groups, visibility migration, forced-Manual v11 connector migration, idempotence, and future-version rejection.

#### D. Recovery terminology is version-neutral

During the v11 final audit, stale “v6 snapshot/recovery” wording in `src/persistence/index.ts` was normalized to version-neutral current/checkpoint terminology. The actual recovery key generation remains defined by `SAFE_PROJECT_KEY` / `SAFE_CHECKPOINT_KEY`.

#### E. `SAFE_BUILD_LABEL` is not aligned with current schema naming

The UI status build label is:

```text
V5.5-NO-TEXT-TOOL
```

This is independent of project schema v12 and can be confusing.

The “NO-TEXT-TOOL” phrase is technically consistent with the absence of a toolbar Text tool, but the app does have a full text system and standalone text creation through double-click.

#### F. Starter/unreferenced assets appear to remain

Reference scanning indicates likely unused starter artifacts such as:

```text
src/assets/vite.svg
src/assets/typescript.svg
src/assets/hero.png
```

and `src/counter.ts`.

`public/favicon.svg` / `public/icons.svg` also did not appear to be referenced by active TypeScript imports; verify before deleting because public assets can be referenced by URL rather than imports.

#### G. Media Blob garbage collection is not implemented

No deletion of `my-board-v6-asset:*` IndexedDB records was found when media elements are removed.

This can leave orphaned asset Blobs.

#### H. Board-object clipboard is not cross-session

Copy writes JSON to the browser clipboard, but paste uses only `appState.internalClipboard`.

A copied board object therefore should not be assumed to paste after a reload/new tab/new app session.

#### I. Video playback behavior is limited

Video elements are created and a decoded frame can be drawn on the canvas, but no playback-control or explicit playback flow was found.

Do not assume imported videos are interactively playable.

#### J. Browser compatibility is only directly tested against the configured Chrome target

A broader supported-browser policy is not documented in source. Features such as Selection/Range, ClipboardItem, File System Access API, `DecompressionStream`, and contenteditable behavior can vary between browsers.

## 28. Inconsistencies with older architecture assumptions

The current source contains multiple signs that older mental models/documentation may no longer apply.

### Old assumption: current schema is v8

**Current source:** schema is v12.

### Old assumption: current recovery keys are v8

**Current source:** current keys are `my-board-v12-current` and `my-board-v12-checkpoint`; v11 and older keys are legacy migration/recovery inputs.

### Old assumption: rich text is persisted as editor HTML or `richLines`

**Current source:** schema v8 migration made `TextDocument` canonical and removes persisted HTML/cache fields.

### Old assumption: media lives inline in element `src`/Base64

**Current source:** schema v6 externalized media. `MediaElement` uses `assetId`; Blob bytes live separately.

### Old assumption: undo/redo is whole-board snapshot history

**Current source:** history is patch/transaction based.

### Old assumption: grouping is a flat `groupId` property on elements

**Current source:** schema v12 retains the first-class `LayerGroupNode` model introduced in v11 with immediate `parentGroupId` references on elements/groups. `groupId` exists only in v10 migration/import cleanup. Nested group structure is real document state; canvas z-order remains the independent `elements[]` order.

### Old assumption: there is one global drawing color preference

**Current source:** schema v7 removed obsolete global Color-panel semantics; brush and arrow colors are separate.

### Old assumption: all app logic lives in `main.ts`

**Current source:** comments show logic was extracted from the old monolith into feature modules. `main.ts` is now primarily bootstrap.

### Old assumption: there is a Text toolbar tool

**Current source:** `Tool` has no `'text'` value. Standalone text is created by double-clicking blank space.

### Old assumption: feature folders imply clean dependency boundaries

**Current source:** many modules participate in circular imports. Refactoring should be based on the actual import graph, not folder names alone.

## 29. Module ownership table

| Feature / concern | Primary owner(s) | Secondary / coupled modules |
|---|---|---|
| Browser bootstrap | `index.html`, `src/main.ts` | `ui/dom.ts`, `interactions/pointer.ts`, `ui/wiring.ts` |
| Desktop shell / Windows packaging | `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `src-tauri/src/*` | `vite.config.ts`, `package.json`, desktop icon assets |
| Global styling/layout | `src/style.css` | `ui/dom.ts`, editor/inspector modules |
| DOM shell / toolbar / menus | `src/ui/dom.ts` | `ui/wiring.ts`, `ui/context-menu.ts`, `ui/inspector.ts` |
| Project/menu/media UI wiring | `src/ui/wiring.ts` | persistence, exports, media, shortcuts |
| Central runtime state | `src/state/store.ts` | nearly all feature modules |
| Undo/redo transaction orchestration | `src/state/history.ts` | store, persistence, renderer, layers |
| Patch diff/history primitives | `src/state/history-core.ts` | `state/history.ts` |
| Element/data model | `src/model/types.ts` | all model/render/persistence code |
| ID generation | `src/model/ids.ts` | creation, copy/paste, migrations, media |
| Geometry / hit testing | `src/model/geometry.ts` | pointer, renderer, arrows, movement |
| Arrow styles / label layout | `src/arrows/index.ts` | geometry, renderer, inspector |
| Pointer state machine | `src/interactions/pointer.ts` | history, geometry, renderer, text editor |
| Keyboard behavior | `src/interactions/keyboard.ts` | shortcuts, history, context actions, tools |
| Object movement / bound-arrow updates | `src/interactions/movement.ts` | geometry, store |
| Move/resize snapping | `src/interactions/snapping.ts` | pointer |
| Align/distribute/equal spacing | `src/interactions/align.ts` | history, store, persistence |
| Tool switching | `src/interactions/tools.ts` | inspector, renderer, state |
| Layers / z-order / rename / visibility / lock / search | `src/layers/index.ts` | store, history, context menu |
| Canonical rich-text model | `src/model/text-document.ts` | editor, renderer, migrations, exports |
| Text sizing/font helpers | `src/model/text.ts` | editor, renderer, exports, migrations |
| Rich-text editor lifecycle | `src/text-editor/index.ts` | text document, history, store, renderer |
| Legacy editing command adapter | `src/text-editor/commands.ts` | `text-editor/index.ts` |
| Main canvas renderer | `src/renderer/index.ts` | geometry, arrows, shapes, media, state |
| Note/rectangle surface rendering | `src/renderer/shapes.ts` | renderer, inspector-related style semantics |
| DPI/backing-store sizing | `src/renderer/dpi.ts` | renderer/UI resize |
| Board visual constants | `src/renderer/constants.ts` | renderer, exports |
| Context menu / board clipboard / object actions | `src/ui/context-menu.ts` | history, exports, layers, persistence |
| Properties inspector | `src/ui/inspector.ts` | renderer, state, text/editor/tool behavior |
| Local autosave/recovery | `src/persistence/index.ts` | media assets, migrations, ZIP, store |
| Project save/open | `src/persistence/index.ts` | exports, media, migrations, ZIP |
| Schema migrations | `src/persistence/migrations.ts` | text document, model types, media staging |
| ZIP read/write | `src/persistence/zip.ts` | persistence |
| Binary asset store/cache | `src/media/assets.ts` | persistence, renderer, export, import UI |
| SVG/PNG/PDF export | `src/exports/index.ts` | renderer helpers, media assets, geometry |
| Shortcut definitions | `src/shortcuts/definitions.ts` | shortcut runtime, store types |
| Shortcut persistence/UI | `src/shortcuts/index.ts` | keyboard, `ui/wiring.ts` |
| Test-only browser hooks | `src/testing/hooks.ts` | Playwright tests |
| Static architecture guards | `scripts/check-*.mjs`, `scripts/check-all.sh` | source tree |
| Model/runtime smoke tests | `scripts/*.smoke.ts`, `history-runtime.smoke.cjs` | model/state/persistence code |
| Browser regression tests | `tests/*.spec.ts` | full application |

## 30. Unknown / not determinable from the current source

The following should be treated as **Unknown** unless additional authoritative project material is supplied:

- Production hosting/deployment target.
- CI/CD provider or deployment pipeline.
- Formal browser-support policy beyond the Playwright Chrome configuration.
- Product roadmap.
- Whether the stale `SAFE_BUILD_LABEL` has external release meaning.
- Intended long-term behavior for imported videos.
- Intended policy for garbage-collecting orphaned media assets.
- Whether apparently unused public assets are referenced by an external hosting layer not present in the archive.
- Whether the current omission of arrow opacity from Properties is permanent product intent or only current behavior.

## 31. Recommended source-tracing order for future changes

For a future ChatGPT/developer session, start from the feature owner in the module table, then trace both state and persistence implications before editing.

Useful patterns:

### For a new board element/property

Inspect at minimum:

```text
model/types.ts
state/store.ts
renderer/*
interactions/*
persistence/migrations.ts
exports/index.ts
history tests/guards
browser tests
```

### For a text change

Inspect at minimum:

```text
model/text-document.ts
text-editor/index.ts
text-editor/commands.ts
renderer/index.ts
persistence/migrations.ts
exports/index.ts
tests/text-editor.regression.spec.ts
```

### For a save/load/schema change

Inspect at minimum:

```text
model/types.ts
persistence/index.ts
persistence/migrations.ts
persistence/zip.ts
media/assets.ts
scripts/check-schema-version.mjs
schema/ZIP smoke tests
browser workflow save/reload tests
```

### For an arrow/binding change

Inspect at minimum:

```text
model/types.ts
model/geometry.ts
arrows/index.ts
arrows/label-layout.ts   # path-label wrapping-width policy; keep pure/deterministic
interactions/pointer.ts
interactions/movement.ts
renderer/index.ts
exports/index.ts
history behavior
```

### For a stateful user action

Verify all of:

```text
store action exists
history transaction boundaries are correct
local save happens when required
render/layer UI refresh happens
locked-object behavior is respected
undo then redo reproduces the state
```


## 32A. Tauri desktop packaging and desktop UX (Rimmap 1.0.0)

The current source is Tauri-ready while preserving the browser application architecture. This remains intentionally a **thin shell**, not a rewrite:

- Tauri product/window name: `Rimmap`.
- Desktop application release version: `1.0.0`.
- Tauri identifier: `com.rimmap.app`.
- Frontend dev URL: `http://127.0.0.1:1420`; Tauri runs `npm run dev -- --port 1420`.
- Production assets: Vite builds `dist/`, which Tauri embeds through `frontendDist: ../dist`.
- Windows bundle target: **NSIS setup EXE** only.
- WebView2 policy: `downloadBootstrapper`.
- Main window: native decorated/resizable window, 1440×900 initial size, 960×640 minimum.
- Native integration is narrowly scoped to official Tauri v2 APIs/plugins: `@tauri-apps/api`, `@tauri-apps/plugin-dialog`, and `@tauri-apps/plugin-fs`. Rust registers only the dialog/fs plugins; there are no custom `#[tauri::command]` business-logic commands, shell/updater plugins, telemetry, or native renderer logic.
- `src-tauri/capabilities/default.json` is scoped to the `main` window and grants only core defaults, close/destroy, dialog defaults, and file read/write needed for the chosen native project path.
- `src/desktop/index.ts` is the browser/Tauri boundary. Keep Tauri-specific calls there instead of scattering environment checks through board modules.
- `src/ui/dialogs.ts` owns current user-facing confirmation/prompt/toast UI. Do not reintroduce `window.alert`, `window.confirm`, or `window.prompt`, because inside Tauri they display dry browser-origin chrome such as `tauri.localhost says`.
- New-project default shortcut is **Ctrl+N** in the desktop app. `src/shortcuts/index.ts` automatically migrates the exact old untouched `Ctrl+Alt+N` default, while preserving user-customized bindings. Browser-reserved shortcut enforcement remains active in the browser environment.
- Desktop Save/Open use native pickers. A first Save with no native path opens the save picker; after Save or native Open establishes a path, later Ctrl+S writes directly to the same file. **Save As** is a separate File command with **Ctrl+Shift+S** and always opens the native Save dialog; after a successful Save As, that new path becomes the target for future Ctrl+S saves. Browser development keeps the download/input fallback.
- The File menu contains a desktop-only **Exit** command. Both that command and the native window close button share one dirty-close guard. Dirty close presents **Unsaved changes** with Save & exit / Exit without saving / Cancel; Save & exit only closes after `saveProject()` succeeds.
- The File header presents the **project name first**, centered and allowed to wrap across multiple lines, with the smaller Rimmap logo beneath it. The old technical build/save status strip has been removed. User-facing results use Rimmap dialogs/toasts instead.
- Media import is shared through `src/media/import.ts`, with extension/MIME classification centralized in `src/media/formats.ts`. The Image button, browser drag/drop, Tauri-native filesystem drag/drop, and image clipboard paste must all use that one asset-backed insertion path; do not reintroduce Base64 media or duplicate media-element construction logic.
- **Windows/Tauri native drops:** Tauri's default native drag/drop handler must remain enabled (`dragDropEnabled: true`). On Windows it intercepts OS file drops before HTML5 canvas drop events, so `src/desktop/index.ts` listens with `getCurrentWebview().onDragDropEvent()`, converts physical event coordinates to logical/CSS coordinates using the current window scale factor, and `src/ui/wiring.ts` materializes allowed dropped paths through `@tauri-apps/plugin-fs`. Tauri dynamically scopes dropped file paths for access; keep `fs:allow-read-file`. Do not delete this bridge merely because browser Playwright drop tests still pass.
- Browser canvas drag/drop remains the web-development fallback and inserts media at the drop point. Default board Ctrl+V inserts clipboard images at viewport center. Text-editor paste remains isolated and must keep precedence while a text editor or editable input is active.
- `app.security.csp` remains `null` deliberately for behavior parity with the existing browser app, including Blob/Object-URL media paths. Tighten CSP only after explicitly testing media, clipboard, editor, exports, and project workflows.
- `src-tauri/target/` and `src-tauri/gen/` are build/generated output and must not be committed or packaged as source.

Desktop integration does **not** alter `CURRENT_SCHEMA_VERSION = 12`, archive v1, legacy `my-board-*` persistence identifiers, or clipboard MIME identifiers. Existing v12 project files remain compatible. Browser IndexedDB and the Tauri/WebView2 application storage origin are separate, so transfer boards using explicit project save/open.

Build note: this handoff archive must be built with `npm install` before `npm run desktop:build`. The sandbox used to prepare it could not reach npm long enough to hydrate the newly added Tauri JS-plugin package-lock nodes, although the dependency declarations and source/type/static guards are complete. `build-windows.bat` intentionally runs `npm install`, allowing the Windows machine to resolve/update the lockfile before building. Do not use `npm ci` on this particular source handoff until that lockfile has been refreshed once on a networked machine.

The Tauri Rust layer must remain minimal unless a future requirement genuinely needs native OS integration. Do not migrate canvas rendering, document state, history, media ownership, or general persistence logic into Rust merely because Tauri is present.

Validation: `scripts/check-tauri-desktop.mjs` guards product/version/build paths, NSIS target, official plugin wiring/capabilities, Rust thin-shell structure, icon containers, Vite watch isolation, native drag/drop enablement, and schema compatibility. `scripts/check-desktop-polish.mjs` guards Ctrl+N, native save/open wiring, custom Rimmap dialogs, File-menu cleanup, and unsaved-close behavior. `scripts/check-final-desktop-ux.mjs` guards Save As, the project-name/logo header layout, shared media drag/drop import, and image clipboard paste precedence. `scripts/check-native-media-drop.mjs` specifically guards the Tauri-native Windows file-drop bridge, DPI coordinate conversion, filesystem-read permission, and shared insertion path; `scripts/media-formats.smoke.ts` executes the still-image/vector-only format classifier.

## 32. Final source-of-truth reminders

Before making future changes:

1. Read the current implementation, not only `README.md`.
2. Treat `CURRENT_SCHEMA_VERSION = 12` as authoritative for the inspected source.
3. Treat `TextDocument v1` as canonical for rich text.
4. Keep media binary bytes outside element JSON.
5. Use store actions and history transactions.
6. Preserve save/recovery safeguards.
7. Assume text clipboard/list behavior is regression-sensitive.
8. Assume arrow geometry/binding is regression-sensitive.
9. Assume top-level import changes are regression-sensitive because of circular dependencies and side effects.
10. Run the static guards and browser regressions relevant to the feature.
11. If the source does not establish a fact, mark it **Unknown** instead of filling the gap with an older architectural assumption.
12. Keep Tauri as a thin shell by default; native plugins/commands require a concrete product need and corresponding capability/test review.

---

**End of handoff.**

### Dense-board connector + floating-panel stabilization (2026-09-11)

This update remains **schema v12**. It changes runtime/UI behavior only.

- The user-facing media import control is now **Image** (`Import image` tooltip/ARIA and `Image` layer type label). Internal `media` element/asset identifiers remain unchanged for compatibility.
- `positionInspectorPanel()` now clamps a user-positioned Properties panel back inside the current viewport after window resize/maximize/restore. It preserves the user's location when still visible and only converts to explicit left/top coordinates when the previous position is outside the restored window.
- `cloneSelectionHierarchy()` now remaps `startBinding`, `endBinding`, and branch `endBinding` references to cloned target IDs when the target is inside the duplicated/copied payload. External bindings remain detached. This fixes repeated connected-diagram duplication producing arrows that merely looked attached. Existing already-detached copies are intentionally not guessed/rebound automatically.
- Auto routing now uses a spatially localized obstacle corridor with deterministic validation/expansion instead of passing every board obstacle into every route search. The route cache key is based on local obstacle geometry, and the sampled arrow path is reused while those local inputs remain unchanged.
- Manual/bound trunk and branch path caches now key off immutable bound-target/path references rather than the global scene geometry generation, so moving an unrelated object no longer forces every connected Smooth arrow/branch to be resampled.
- New regression guard: `scripts/check-dense-board-stability.mjs`. Browser regressions cover Properties viewport clamping, duplicated binding remapping, spatial magnetism past the 180-object threshold, and a finite Auto route on the dense board.
