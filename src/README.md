# Rimmap modular application

This is a behavior-preserving structural split of the supplied 5,132-line `main.ts`.

## Modules

- `model/`: element types, text defaults, IDs, geometry/hit-testing.
- `state/`: shared runtime store and undo/redo history.
- `renderer/`: canvas rendering, shape surfaces, board constants.
- `interactions/`: tool selection, pointer gestures, keyboard commands, alignment.
- `text-editor/`: contenteditable/rich-text editing and toolbar logic.
- `arrows/`: connector geometry, labels, branches, arrow normalization.
- `layers/`: layer naming, picking, ordering, locking panel.
- `persistence/`: project snapshots, IndexedDB recovery, project open/save.
- `exports/`: SVG/PNG/PDF and clipboard export.
- `shortcuts/`: shortcut definitions/preferences/panel behavior.
- `ui/`: DOM shell, property inspector, context menu, project/menu wiring.
- `main.ts`: startup only.

The mutable state is intentionally centralized in `state/store.ts`. This keeps the first refactor low-risk while making ownership visible; later work can replace pieces of that store with narrower feature stores without another 5k-line migration.

## Validation

- `tsc --noEmit` passes with `strict: true` using the included `tsconfig.json`.
- The refactor preserves every top-level function and constant from the supplied source; mutable `let` bindings were moved into `state/store.ts`.
- `style.css` is copied unchanged in this structural pass.

## Integration

Replace the old `src/main.ts` and `src/style.css` with this `src/` tree. The entry point is still `src/main.ts`, so a Vite-style app that already resolves `idb-keyval` can keep the same HTML entry.
