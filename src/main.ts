// Extracted from the original monolithic main.ts.
// Keep feature behavior here; shared mutable runtime data lives in state/store.ts.
import './style.css';

// Side-effect modules: these install the canvas/input and application UI listeners.
// They must be imported by the entry point or the extracted handlers never run.
import './interactions/pointer';
import './ui/wiring';
import './ui/floating-panels';
import { loadFromLocal, saveProject } from './persistence/index';
import { loadShortcutPreferences } from './shortcuts/index';
import { appState, dispatch } from './state/store';
import { resize } from './ui/inspector';
import { installDesktopCloseGuard } from './desktop/index';
import { unsavedExitDialog } from './ui/dialogs';

if (new URLSearchParams(window.location.search).get('test') === '1') {
    void import('./testing/hooks').then(({ installTestHooks }) => installTestHooks());
}

export async function initializeApp() {
    dispatch({ type: 'SET_PROJECT', patch: { appReady: false } });
    resize();
    try {
        await loadShortcutPreferences();
        await loadFromLocal();
        await installDesktopCloseGuard(
            () => appState.projectDirty,
            async () => {
                const choice = await unsavedExitDialog();
                if (choice === 'cancel') return 'cancel';
                if (choice === 'discard') return 'close';
                return await saveProject() ? 'close' : 'cancel';
            },
        );
    }
    finally {
        dispatch({ type: 'SET_PROJECT', patch: { appReady: true } });
    }
}

void initializeApp();
