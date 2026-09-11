#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

node scripts/check-entrypoint.mjs
node scripts/check-branding.mjs
node scripts/check-tauri-desktop.mjs
node scripts/check-desktop-polish.mjs
node scripts/check-final-desktop-ux.mjs
node scripts/check-native-media-drop.mjs
node scripts/check-layer-rename.mjs
node scripts/check-layer-arrange.mjs
node scripts/check-store-mutations.mjs
node scripts/check-history-patches.mjs
node scripts/check-media-assets.mjs
node scripts/check-text-model.mjs
node scripts/check-css-cleanup.mjs
node scripts/check-schema-version.mjs
node scripts/check-browser-tests.mjs
node scripts/check-paste-exit.mjs
node scripts/check-note-rectangle-performance.mjs
node scripts/check-performance-system.mjs
node scripts/check-dense-board-stability.mjs
node scripts/check-floating-panels.mjs
node scripts/check-canvas-features.mjs
node scripts/check-arrow-connectors.mjs

tsc -p tsconfig.json --noEmit

compile_smoke() {
  local name="$1"; shift
  local out="/tmp/my-board-${name}-smoke"
  rm -rf "$out"
  mkdir -p "$out"
  tsc "$@" \
    --target ES2022 --module CommonJS --moduleResolution Node --lib ES2022,DOM \
    --strict --skipLibCheck --outDir "$out"
  node "$out/scripts/${name}.smoke.js"
}

compile_smoke media-formats \
  scripts/media-formats.smoke.ts src/media/formats.ts
compile_smoke dpi \
  scripts/dpi.smoke.ts src/renderer/dpi.ts
compile_smoke id-generation \
  scripts/id-generation.smoke.ts src/model/ids.ts
compile_smoke text-document \
  scripts/text-document.smoke.ts src/model/text-document.ts src/model/types.ts
compile_smoke history-patches \
  scripts/history-patches.smoke.ts src/state/history-core.ts src/model/types.ts
compile_smoke layers-model \
  scripts/layers-model.smoke.ts src/layers/model.ts src/model/types.ts
compile_smoke spatial-index \
  scripts/spatial-index.smoke.ts src/performance/spatial-index.ts src/model/types.ts
compile_smoke lru-cache \
  scripts/lru-cache.smoke.ts src/performance/lru-cache.ts
compile_smoke instrumentation \
  scripts/instrumentation.smoke.ts src/performance/instrumentation.ts
compile_smoke scene-index \
  scripts/scene-index.smoke.ts src/performance/scene-index.ts src/performance/spatial-index.ts src/state/store.ts src/layers/model.ts src/model/types.ts src/shortcuts/definitions.ts
compile_smoke arrow-routing \
  scripts/arrow-routing.smoke.ts src/arrows/routing.ts src/model/types.ts
compile_smoke arrow-label-collision \
  scripts/arrow-label-collision.smoke.ts src/arrows/label-collision.ts src/model/types.ts
compile_smoke arrow-label-layout \
  scripts/arrow-label-layout.smoke.ts src/arrows/label-layout.ts
compile_smoke arrow-waypoints \
  scripts/arrow-waypoints.smoke.ts src/arrows/waypoints.ts src/model/types.ts
compile_smoke store-actions \
  scripts/store-actions.smoke.ts src/state/store.ts src/layers/model.ts src/model/types.ts src/shortcuts/definitions.ts
compile_smoke schema-migrations \
  scripts/schema-migrations.smoke.ts src/persistence/migrations.ts src/model/text-document.ts src/model/types.ts src/model/ids.ts
compile_smoke zip \
  scripts/zip.smoke.ts src/persistence/zip.ts

history_out="/tmp/my-board-history-runtime-smoke"
rm -rf "$history_out"
mkdir -p "$history_out"
tsc src/env.d.ts src/state/store.ts src/state/history.ts src/state/history-core.ts src/layers/model.ts src/model/types.ts src/shortcuts/definitions.ts \
  --target ES2022 --module CommonJS --moduleResolution Node --lib ES2022,DOM \
  --strict --skipLibCheck --outDir "$history_out"
node scripts/history-runtime.smoke.cjs "$history_out"

echo "OK: complete static/type/model/schema/history/ZIP/UI regression suite passed."
