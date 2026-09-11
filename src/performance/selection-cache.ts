import { appState } from '../state/store';

let lastSelection: readonly string[] | null = null;
let selected = new Set<string>();

export function getSelectedIdSet(): ReadonlySet<string> {
  if (lastSelection !== appState.selectedIds) {
    lastSelection = appState.selectedIds;
    selected = new Set(appState.selectedIds);
  }
  return selected;
}

export function isSelectedId(id: string): boolean {
  return getSelectedIdSet().has(id);
}
