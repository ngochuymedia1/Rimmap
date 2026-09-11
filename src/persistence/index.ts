// Extracted from the original monolithic main.ts.
// Keep feature behavior here; shared mutable runtime data lives in state/store.ts.
import { del, get, set } from 'idb-keyval';
import { chooseProjectOpenPath, chooseProjectSavePath, fileNameFromPath, isDesktopApp, readDesktopFile, writeDesktopFile } from '../desktop/index';
import { ARROW_LABEL_FONT_SIZE, clampArrowLabelPosition, normalizeArrowCurveMode, normalizeArrowLabelFontSize, normalizeArrowRoutingMode, normalizeArrowStyle } from '../arrows/index';
import { ensureOpenedProjectVisible } from '../interactions/keyboard';
import { ensureStableLayerNames, requestLayersPanelRefresh } from '../layers/index';
import { MAX_ARROW_WAYPOINTS, lerpPoint, setArrowInteriorPoints } from '../model/geometry';
import { generateId } from '../model/ids';
import { DEFAULT_FONT_FAMILY, DEFAULT_TEXT_FONT_SIZE, MIN_TEXT_SCALE, getTextScale, normalizeFontFamily } from '../model/text';
import { normalizeTextDocument, textDocumentPlainText } from '../model/text-document';
import { ArrowBranch, ArrowElement, CanvasElement, ProjectAssetManifest, ProjectFile, ProjectSettings } from '../model/types';
import { CURRENT_SCHEMA_VERSION, EmbeddedAssetSource, MigrationResult, currentSchemaElements, currentSchemaLayerGroups, migrateProjectFile } from './migrations';
import { redraw } from '../renderer/index';
import { NOTE_DEFAULT_FILL } from '../renderer/shapes';
import { updateHistoryButtons } from '../state/history';
import { appState, dispatch } from '../state/store';
import { closeTextEditor } from '../text-editor/index';
import { projectInput, projectNameEl } from '../ui/dom';
import { alertDialog, confirmDialog, showToast } from '../ui/dialogs';
import { clampArrowOpacity, updateArrowToolUI, updateBrushStylePanel, updateTextStylePanel } from '../ui/inspector';
import { assetPathFor, clearMediaRuntime, getAssetBlob, hydrateMediaElements as hydrateAssetElements, manifestForElements, putAssetBlob, resetAssetMemory, seedAssetManifest, sourceToBlob } from '../media/assets';
import { createZip, looksLikeZip, readZip } from './zip';

// Recovery keeps exactly one current document snapshot and one previous
// last-known-good checkpoint. Binary assets are stored separately by assetId.
export const SAFE_PROJECT_KEY = 'my-board-v12-current';
export const SAFE_CHECKPOINT_KEY = 'my-board-v12-checkpoint';

let desktopProjectPath: string | null = null;

function safeProjectBaseName(name = appState.projectName): string {
    return name.replace(/[^a-z0-9-_ ]/gi, '').trim() || 'Untitled Board';
}

function projectNameFromFileName(name: string): string {
    return name.replace(/\.(rimmap|board\.zip|board\.json|board|zip|json)$/i, '') || 'Untitled Board';
}

const LEGACY_RECOVERY_KEYS = [
    'my-board-v11-current',
    'my-board-v11-checkpoint',
    'my-board-v10-current',
    'my-board-v10-checkpoint',
    'my-board-v9-current',
    'my-board-v9-checkpoint',
    'my-board-v8-current',
    'my-board-v8-checkpoint',
    'my-board-v7-current',
    'my-board-v7-checkpoint',
    'my-board-v6-current',
    'my-board-v6-checkpoint',
    'my-board-v5-current',
    'my-board-v5-last-nonempty',
    'my-board-v3-current',
    'my-board-v3-last-nonempty',
    'my-board-project-recovery',
    'my-board-elements',
] as const;

export function isProjectSnapshot(value: any): value is {
    project: unknown;
    dirty?: boolean;
    savedAt?: number;
} {
    return !!value?.project && typeof value.project === 'object' && Array.isArray((value.project as any).elements);
}

function migrateSnapshotProject(snapshot: { project: unknown }, fallbackName = 'Untitled Board') {
    return migrateProjectFile(snapshot.project, fallbackName);
}

export function prepareExplicitProjectSave() {
    if (appState.textEditor)
        closeTextEditor(true);
}

export function buildProjectFile(): ProjectFile {
    // Always snapshot the live in-memory canvas state at the exact moment Save is invoked.
    // structuredClone preserves nested points/rich-text data without sharing references.
    const serializedElements = currentSchemaElements(appState.elements);
    const serializedLayerGroups = currentSchemaLayerGroups(appState.layerGroups, serializedElements);
    return {
        format: 'my-board-project',
        schemaVersion: CURRENT_SCHEMA_VERSION,
        archiveVersion: 1,
        name: appState.projectName,
        savedAt: new Date().toISOString(),
        elements: serializedElements,
        layerGroups: serializedLayerGroups,
        assets: manifestForElements(serializedElements),
        settings: {
            brushColor: appState.brushColor,
            currentThickness: appState.currentThickness,
            arrowStyle: appState.arrowStyle,
            arrowColor: appState.arrowColor,
            camera: { x: appState.camera.x, y: appState.camera.y, zoom: appState.camera.zoom },
            exportPngScale: appState.exportPngScale,
        },
    };
}

export function setProjectStatus(_text: string) {
    // Technical recovery/save diagnostics no longer occupy permanent UI space.
    // User-facing success/error feedback is handled by Rimmap dialogs/toasts.
}

export function setProjectName(name: string) {
    const projectName = (name || 'Untitled Board').replace(/\.(rimmap|board\.zip|board\.json|board|zip|json)$/i, '') || 'Untitled Board';
    dispatch({ type: 'SET_PROJECT', patch: { projectName } });
    if (projectNameEl)
        projectNameEl.textContent = appState.projectName;
}

async function cleanupLegacyRecoveryKeys() {
    await Promise.all(LEGACY_RECOVERY_KEYS.map(key => del(key).catch(() => undefined)));
}

async function materializeEmbeddedAssets(items: EmbeddedAssetSource[]) {
    for (const item of items) {
        const blob = await sourceToBlob(item.source, item.mime);
        await putAssetBlob(blob, { id: item.id, name: item.name, mime: item.mime, path: item.path });
    }
}

export async function persistRecoveryNow(dirty = true) {
    try {
        const project = buildProjectFile();
        const stamped = { dirty, savedAt: Date.now(), project };
        const previous = await get(SAFE_PROJECT_KEY);
        // The checkpoint is the previous known-good current snapshot, not another
        // copy of the just-written document. Asset Blobs are shared by assetId.
        if (isProjectSnapshot(previous) && (previous.project as any).elements.length > 0) {
            await set(SAFE_CHECKPOINT_KEY, previous);
        }
        await set(SAFE_PROJECT_KEY, stamped);
    }
    finally {
        const resolvers = [...appState.pendingLocalSaveResolvers];
        dispatch({ type: 'SET_PROJECT', patch: { pendingLocalSaveResolvers: [] } });
        resolvers.forEach(resolve => resolve());
    }
}

async function createPreviewPng(): Promise<Blob> {
    try {
        // Dynamic import avoids a static persistence <-> exports cycle. The preview
        // is intentionally capped; it is a project thumbnail, not a second export.
        const { buildRasterCanvas } = await import('../exports/index');
        const canvas = buildRasterCanvas(false, 1, 1600, 0.05) ?? document.createElement('canvas');
        if (!canvas.width || !canvas.height) {
            canvas.width = 1;
            canvas.height = 1;
            const context = canvas.getContext('2d');
            if (context) { context.fillStyle = '#fbfaf6'; context.fillRect(0, 0, 1, 1); }
        }
        const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
        if (blob) return blob;
    } catch (error) {
        console.warn('Could not render project preview; using a minimal preview.', error);
    }
    // Valid 1x1 transparent PNG fallback.
    const png = Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1,8,6,0,0,0,31,21,196,137,0,0,0,13,73,68,65,84,8,215,99,248,207,192,240,31,0,5,0,1,255,137,153,61,29,0,0,0,0,73,69,78,68,174,66,96,130]);
    return new Blob([png], { type: 'image/png' });
}

async function createProjectArchive(project: ProjectFile): Promise<Uint8Array> {
    seedAssetManifest(project.assets);
    const referenced = manifestForElements(project.elements).map(asset => ({
        ...asset,
        path: assetPathFor(asset.id, asset.mime, asset.name),
    }));
    const assets: Array<{ manifest: ProjectAssetManifest; blob: Blob }> = [];
    for (const manifest of referenced) {
        const blob = await getAssetBlob(manifest.id);
        if (!blob) throw new Error(`Media asset ${manifest.id} (${manifest.name}) is missing from local storage.`);
        assets.push({ manifest: { ...manifest, size: blob.size, mime: manifest.mime || blob.type || 'application/octet-stream' }, blob });
    }
    project.assets = assets.map(item => item.manifest);
    project.archiveVersion = 1;
    project.schemaVersion = CURRENT_SCHEMA_VERSION;
    project.savedAt = new Date().toISOString();

    const payload = {
        ...project,
        integrity: {
            objectCount: project.elements.length,
            mediaCount: project.elements.filter(el => el.type === 'media').length,
            assetCount: project.assets.length,
            schemaVersion: CURRENT_SCHEMA_VERSION,
            archiveVersion: 1,
            exportedBy: 'my-board-zip-v1',
        },
    };
    const preview = await createPreviewPng();
    const zip = await createZip([
        { name: 'project.json', data: JSON.stringify(payload) },
        { name: 'preview.png', data: preview },
        ...assets.map(({ manifest, blob }) => ({ name: manifest.path, data: blob })),
    ]);

    // Verify the exact archive bytes before allowing the browser download.
    const verifiedEntries = await readZip(zip);
    const projectBytes = verifiedEntries.get('project.json');
    if (!projectBytes || !verifiedEntries.has('preview.png')) throw new Error('Verified ZIP export is missing project.json or preview.png.');
    const verified = JSON.parse(new TextDecoder().decode(projectBytes));
    if (!Array.isArray(verified.elements) || verified.elements.length !== project.elements.length) {
        throw new Error('Verified ZIP export failed: object count changed during serialization.');
    }
    for (const asset of project.assets) {
        const bytes = verifiedEntries.get(asset.path);
        if (!bytes || bytes.length !== asset.size) throw new Error(`Verified ZIP export failed for media asset ${asset.name}.`);
    }
    return zip;
}

async function prepareProjectArchiveForSave(): Promise<{ zipBytes: Uint8Array; project: ProjectFile }> {
    prepareExplicitProjectSave();
    await persistRecoveryNow(appState.projectDirty);

    let project = buildProjectFile();
    const durable = await get(SAFE_PROJECT_KEY);
    if (isProjectSnapshot(durable)) {
        try {
            const durableProject = migrateSnapshotProject(durable, appState.projectName).project;
            if (durableProject.elements.length === project.elements.length) project = durableProject;
        } catch (error) {
            console.warn('Ignoring invalid durable project snapshot during save', error);
        }
    }

    if (project.elements.length === 0) {
        const checkpoint = await get(SAFE_CHECKPOINT_KEY);
        if (isProjectSnapshot(checkpoint)) {
            try {
                const backupProject = migrateSnapshotProject(checkpoint, appState.projectName).project;
                if (backupProject.elements.length > 0) {
                    const useBackup = await confirmDialog({
                        title: 'Use recovery copy?',
                        message: `This board is currently empty, but Rimmap found a recovery copy with ${backupProject.elements.length} object${backupProject.elements.length === 1 ? '' : 's'}. Use the recovery copy for this save?`,
                        confirmLabel: 'Use recovery copy',
                        cancelLabel: 'Save empty board',
                    });
                    if (useBackup) {
                        project = backupProject;
                        project.name = appState.projectName || project.name;
                    }
                }
            } catch (error) {
                console.warn('Ignoring invalid recovery checkpoint during save', error);
            }
        }
    }

    seedAssetManifest(project.assets);
    return { zipBytes: await createProjectArchive(project), project };
}

async function finishSuccessfulSave(project: ProjectFile) {
    dispatch({ type: 'SET_PROJECT', patch: { projectDirty: false } });
    await persistRecoveryNow(false);
    setProjectStatus(`Saved · ${project.elements.length} object${project.elements.length === 1 ? '' : 's'} · ${project.assets.length} asset${project.assets.length === 1 ? '' : 's'}`);
}

export async function downloadProjectFile(): Promise<boolean> {
    const { zipBytes, project } = await prepareProjectArchiveForSave();
    const url = URL.createObjectURL(new Blob([zipBytes], { type: 'application/zip' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${safeProjectBaseName()}.board.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    await finishSuccessfulSave(project);
    return true;
}

async function saveDesktopProjectAs(): Promise<boolean> {
    const previousPath = desktopProjectPath;
    const previousName = appState.projectName;
    const defaultPath = previousPath || `${safeProjectBaseName()}.board.zip`;
    const path = await chooseProjectSavePath(defaultPath);
    if (!path) return false;

    const nextName = projectNameFromFileName(fileNameFromPath(path));
    setProjectName(nextName);
    try {
        const { zipBytes, project } = await prepareProjectArchiveForSave();
        await writeDesktopFile(path, zipBytes);
        desktopProjectPath = path;
        await finishSuccessfulSave(project);
        showToast('Saved as new file');
        return true;
    } catch (error) {
        desktopProjectPath = previousPath;
        setProjectName(previousName);
        throw error;
    }
}

async function saveDesktopProject(): Promise<boolean> {
    if (!desktopProjectPath) return saveDesktopProjectAs();

    const { zipBytes, project } = await prepareProjectArchiveForSave();
    await writeDesktopFile(desktopProjectPath, zipBytes);
    await finishSuccessfulSave(project);
    showToast('Saved');
    return true;
}

async function reportSaveFailure(err: unknown) {
    setProjectStatus('Save failed');
    console.error('Safe save failed', err);
    await alertDialog({
        title: 'Could not save board',
        message: 'Rimmap could not save this board. Your local recovery copy is still kept. Please try again.',
        tone: 'danger',
    });
}

export async function saveProject(): Promise<boolean> {
    try {
        return isDesktopApp() ? await saveDesktopProject() : await downloadProjectFile();
    }
    catch (err) {
        await reportSaveFailure(err);
        return false;
    }
}

export async function saveProjectAs(): Promise<boolean> {
    try {
        return isDesktopApp() ? await saveDesktopProjectAs() : await downloadProjectFile();
    }
    catch (err) {
        await reportSaveFailure(err);
        return false;
    }
}

export function normalizeImportedElements(raw: any[]): CanvasElement[] {
    return raw.map((el: any) => {
        const item = structuredClone(el) as CanvasElement;
        item.locked = !!(item as any).locked;
        item.hidden = !!(item as any).hidden;
        item.parentGroupId = typeof (item as any).parentGroupId === 'string' && (item as any).parentGroupId.trim() ? (item as any).parentGroupId.trim() : undefined;
        delete (item as any).groupId;
        if (item.type === 'arrow' || item.type === 'connector') {
            const a = item as ArrowElement;
            a.style = normalizeArrowStyle((a as any).style);
            a.curveMode = normalizeArrowCurveMode((a as any).curveMode);
            a.color = typeof a.color === 'string' && a.color ? a.color : '#111827';
            a.opacity = clampArrowOpacity(a.opacity);
            const legacyPointCount = (a as any).pointCount === 5 ? 5 : 3;
            if (Array.isArray((a as any).controls)) {
                const controls = (a as any).controls.filter((pt: any) => pt && Number.isFinite(Number(pt.x)) && Number.isFinite(Number(pt.y))).slice(0, MAX_ARROW_WAYPOINTS).map((pt: any) => ({ x: Number(pt.x), y: Number(pt.y) }));
                setArrowInteriorPoints(a, controls);
            } else if (legacyPointCount === 5)
                setArrowInteriorPoints(a, [lerpPoint(a.start, a.control, .5), a.control, lerpPoint(a.control, a.end, .5)]);
            else
                setArrowInteriorPoints(a, [a.control || lerpPoint(a.start, a.end, .5)]);
            a.arrowMode = a.arrowMode === 'branches' ? 'branches' : 'connection';
            a.routingMode = a.arrowMode === 'branches' ? 'manual' : normalizeArrowRoutingMode(a.routingMode);
            a.labelFontFamily = normalizeFontFamily(a.labelFontFamily || DEFAULT_FONT_FAMILY);
            a.labelFontSize = normalizeArrowLabelFontSize(a.labelFontSize);
            a.labelPosition = clampArrowLabelPosition(a.labelPosition);
            a.labelSide = a.labelSide === 1 ? 1 : -1;
            a.startLabelFontFamily = normalizeFontFamily(a.startLabelFontFamily || DEFAULT_FONT_FAMILY);
            a.endLabelFontFamily = normalizeFontFamily(a.endLabelFontFamily || DEFAULT_FONT_FAMILY);
            if (a.labelDoc || a.label) {
                a.labelDoc = normalizeTextDocument(a.labelDoc, a.label || '', '#27272a');
                a.label = textDocumentPlainText(a.labelDoc);
            }
            if (a.startLabelDoc || a.startLabel) {
                a.startLabelDoc = normalizeTextDocument(a.startLabelDoc, a.startLabel || '', '#27272a');
                a.startLabel = textDocumentPlainText(a.startLabelDoc);
            }
            if (a.endLabelDoc || a.endLabel) {
                a.endLabelDoc = normalizeTextDocument(a.endLabelDoc, a.endLabel || '', '#27272a');
                a.endLabel = textDocumentPlainText(a.endLabelDoc);
            }
            if (Array.isArray(a.branches))
                a.branches = a.branches.map((rawBranch: any) => {
                    const branch = structuredClone(rawBranch) as ArrowBranch;
                    branch.id = branch.id || generateId();
                    branch.root = branch.root === 'start' ? 'start' : 'end';
                    const trunkRoot = branch.root === 'start' ? a.start : a.end;
                    branch.end = branch.end || { ...trunkRoot };
                    if (Array.isArray(branch.controls)) {
                        branch.controls = branch.controls.filter((pt: any) => pt && Number.isFinite(Number(pt.x)) && Number.isFinite(Number(pt.y))).slice(0, MAX_ARROW_WAYPOINTS).map((pt: any) => ({ x: Number(pt.x), y: Number(pt.y) }));
                        if (branch.controls.length === 1) branch.pointCount = 3;
                        else if (branch.controls.length === 3) branch.pointCount = 5;
                        else delete branch.pointCount;
                    } else {
                        branch.controls = [lerpPoint(trunkRoot, branch.end, .5)];
                        branch.pointCount = 3;
                    }
                    branch.labelPosition = clampArrowLabelPosition(branch.labelPosition);
                    branch.labelSide = branch.labelSide === 1 ? 1 : -1;
                    branch.labelFontFamily = normalizeFontFamily(branch.labelFontFamily || DEFAULT_FONT_FAMILY);
                    if (branch.labelDoc || branch.label) {
                        branch.labelDoc = normalizeTextDocument(branch.labelDoc, branch.label || '', '#27272a');
                        branch.label = textDocumentPlainText(branch.labelDoc);
                    }
                    return branch;
                });
            else a.branches = [];
        }
        if (item.type === 'media') {
            const media = item as any;
            media.assetId = typeof media.assetId === 'string' && media.assetId ? media.assetId : `asset-${media.id || generateId()}`;
            media.mime = typeof media.mime === 'string' && media.mime ? media.mime : 'application/octet-stream';
            media.name = typeof media.name === 'string' && media.name ? media.name : media.assetId;
            delete media.src;
        }
        if (item.type === 'text' || item.type === 'note' || item.type === 'rectangle') {
            const rawSize = Number((item as any).fontSize ?? DEFAULT_TEXT_FONT_SIZE);
            const oldScale = getTextScale(item as any);
            item.textScale = Math.max(MIN_TEXT_SCALE, oldScale * rawSize / DEFAULT_TEXT_FONT_SIZE);
            item.fontSize = DEFAULT_TEXT_FONT_SIZE;
            item.fontFamily = normalizeFontFamily(item.fontFamily);
            item.textDoc = normalizeTextDocument(item.textDoc, item.text || '', item.color || '#111827');
            item.text = textDocumentPlainText(item.textDoc);
            if (item.type === 'note') {
                item.fillColor = typeof item.fillColor === 'string' && item.fillColor ? item.fillColor : NOTE_DEFAULT_FILL;
                item.borderRadius = Number.isFinite(item.borderRadius) ? item.borderRadius : 3;
                item.textVerticalAlign = item.textVerticalAlign === 'middle' ? 'middle' : 'top';
            }
            else if (item.type === 'rectangle') {
                item.fillColor = typeof item.fillColor === 'string' && item.fillColor ? item.fillColor : undefined;
                item.strokeEnabled = item.strokeEnabled !== false;
                item.strokeStyle = item.strokeStyle === 'dotted' || item.strokeStyle === 'dashed' ? item.strokeStyle : 'solid';
                item.strokePatternSpacing = Number.isFinite(Number(item.strokePatternSpacing)) ? Math.max(.55, Math.min(2, Number(item.strokePatternSpacing))) : 1;
                item.strokeColor = typeof item.strokeColor === 'string' && item.strokeColor ? item.strokeColor : '#111111';
                item.textVerticalAlign = item.textVerticalAlign === 'middle' ? 'middle' : 'top';
            }
        }
        return item;
    });
}

export async function applyProjectFile(project: ProjectFile) {
    seedAssetManifest(project.assets);
    clearMediaRuntime();
    dispatch({
        type: 'REPLACE_DOCUMENT',
        elements: normalizeImportedElements(Array.isArray(project.elements) ? project.elements : []),
        layerGroups: Array.isArray(project.layerGroups) ? project.layerGroups : [],
    });
    ensureStableLayerNames();
    const settings: ProjectSettings = project.settings;
    dispatch({
        type: 'SET_PREFERENCES',
        patch: {
            brushColor: settings.brushColor || '#111827',
            currentThickness: Math.max(1, Math.min(12, Number(settings.currentThickness) || 3)),
            arrowStyle: normalizeArrowStyle(settings.arrowStyle),
            arrowColor: typeof settings.arrowColor === 'string' && settings.arrowColor ? settings.arrowColor : '#111827',
        },
    });
    dispatch({ type: 'SET_PROJECT', patch: { exportPngScale: Math.max(1, Math.min(6, Number(settings.exportPngScale) || 4)), projectDirty: false } });
    if (settings.camera) {
        const rawX = Number(settings.camera.x), rawY = Number(settings.camera.y), rawZoom = Number(settings.camera.zoom);
        dispatch({ type: 'SET_CAMERA', camera: {
            x: Number.isFinite(rawX) ? rawX : 0,
            y: Number.isFinite(rawY) ? rawY : 0,
            zoom: Number.isFinite(rawZoom) ? Math.min(5, Math.max(.1, rawZoom)) : 1,
        } });
    } else {
        dispatch({ type: 'SET_CAMERA', camera: { x: 0, y: 0, zoom: 1 } });
    }
    setProjectName(project.name || 'Untitled Board');
    dispatch({ type: 'SET_SELECTION', ids: [] });
    dispatch({ type: 'SET_HISTORY', patch: { historyPast: [], historyFuture: [], pendingHistoryBefore: null } });
    dispatch({ type: 'SET_EDITOR', patch: { textEditBefore: null } });
    ensureOpenedProjectVisible();
    redraw();
    await hydrateMediaElements();
    setProjectStatus('Opened locally');
    updateHistoryButtons();
    updateBrushStylePanel();
    updateArrowToolUI();
    updateTextStylePanel();
    requestLayersPanelRefresh();
    document.querySelectorAll<HTMLButtonElement>('[data-export-scale]').forEach(b => b.classList.toggle('selected', Number(b.dataset.exportScale) === appState.exportPngScale));
    redraw();
}

type PreparedProjectAsset = { manifest: ProjectAssetManifest; blob: Blob };
type PreparedProject = { migration: MigrationResult; assets: PreparedProjectAsset[]; wasZip: boolean };

async function prepareProjectFile(file: File): Promise<PreparedProject> {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const fallbackName = file.name.replace(/\.(rimmap|board\.zip|board\.json|board|zip|json)$/i, '') || 'Untitled Board';
    if (looksLikeZip(bytes)) {
        const entries = await readZip(bytes);
        const projectBytes = entries.get('project.json');
        if (!projectBytes) throw new Error('Invalid board ZIP: project.json is missing.');
        const migration = migrateProjectFile(JSON.parse(new TextDecoder().decode(projectBytes)), fallbackName);
        const assets: PreparedProjectAsset[] = [];
        for (const manifest of migration.project.assets) {
            const data = entries.get(manifest.path);
            if (!data) throw new Error(`Invalid board ZIP: missing ${manifest.path}.`);
            assets.push({ manifest, blob: new Blob([data], { type: manifest.mime || 'application/octet-stream' }) });
        }
        const declared = new Set(migration.project.assets.map(asset => asset.id));
        for (const element of migration.project.elements) {
            if (element.type === 'media' && !declared.has(element.assetId)) {
                throw new Error(`Invalid board ZIP: media element ${element.name} references undeclared asset ${element.assetId}.`);
            }
        }
        return { migration, assets, wasZip: true };
    }

    // Legacy JSON remains readable. v1-v5 Base64 media is decoded once into
    // staged Blobs, then installed into the v6 asset store only after open is confirmed.
    const raw = JSON.parse(new TextDecoder().decode(bytes));
    const migration = migrateProjectFile(raw, fallbackName);
    const assets: PreparedProjectAsset[] = [];
    for (const embedded of migration.embeddedAssets) {
        assets.push({
            manifest: { id: embedded.id, path: embedded.path, mime: embedded.mime, name: embedded.name, size: 0 },
            blob: await sourceToBlob(embedded.source, embedded.mime),
        });
    }
    return { migration, assets, wasZip: false };
}

async function installPreparedProject(prepared: PreparedProject) {
    resetAssetMemory();
    seedAssetManifest(prepared.migration.project.assets);
    for (const asset of prepared.assets) {
        await putAssetBlob(asset.blob, {
            id: asset.manifest.id,
            path: asset.manifest.path,
            mime: asset.manifest.mime,
            name: asset.manifest.name,
        });
    }
    await applyProjectFile(prepared.migration.project);
}

export async function openProjectFile(file: File, sourcePath: string | null = null): Promise<boolean> {
    try {
        if (appState.projectDirty) {
            const discard = await confirmDialog({
                title: 'Open another board?',
                message: 'You have unsaved changes. Opening another board will discard those changes.',
                confirmLabel: 'Discard & open',
                cancelLabel: 'Cancel',
                tone: 'danger',
                confirmStyle: 'danger',
            });
            if (!discard) return false;
        }

        const prepared = await prepareProjectFile(file);
        const project = prepared.migration.project;
        const fallbackName = projectNameFromFileName(file.name);
        if (project.elements.length === 0 && appState.elements.length > 0) {
            const openEmpty = await confirmDialog({
                title: 'Open empty board?',
                message: 'This project contains no objects. Opening it will replace the current canvas.',
                confirmLabel: 'Open empty board',
                cancelLabel: 'Cancel',
            });
            if (!openEmpty) {
                setProjectStatus('Open cancelled');
                return false;
            }
        }
        await installPreparedProject(prepared);
        desktopProjectPath = sourcePath;
        setProjectName(project.name || fallbackName);
        await persistRecoveryNow(false);
        if (!prepared.wasZip) await cleanupLegacyRecoveryKeys();
        if (prepared.migration.migrated) setProjectStatus(`Opened · migrated schema v${prepared.migration.fromVersion} → v${CURRENT_SCHEMA_VERSION}`);
        else setProjectStatus(`Opened · ZIP schema v${CURRENT_SCHEMA_VERSION}`);
        showToast('Board opened');
        return true;
    }
    catch (err) {
        console.error('Open project failed', err);
        const message = err instanceof Error ? err.message : 'Invalid project file';
        setProjectStatus(message.includes('newer than this build') ? 'Project schema is newer than this build' : 'Invalid project file');
        await alertDialog({
            title: message.includes('newer than this build') ? 'Newer project version' : 'Could not open board',
            message: message.includes('newer than this build') ? message : `Rimmap could not open this project. ${message}`,
            tone: 'danger',
        });
        return false;
    }
}

export async function openProject() {
    if (isDesktopApp()) {
        try {
            const path = await chooseProjectOpenPath();
            if (!path) return;
            const bytes = await readDesktopFile(path);
            const name = fileNameFromPath(path);
            const file = new File([bytes as unknown as BlobPart], name, { type: name.toLowerCase().endsWith('.json') || name.toLowerCase().endsWith('.board') ? 'application/json' : 'application/zip' });
            await openProjectFile(file, path);
        } catch (err) {
            console.error('Native open failed', err);
            await alertDialog({
                title: 'Could not open board',
                message: 'Rimmap could not read the selected project file. Please try again.',
                tone: 'danger',
            });
        }
        return;
    }

    const picker = (window as any).showOpenFilePicker as undefined | ((options: any) => Promise<FileSystemFileHandle[]>);
    if (!picker) {
        projectInput?.click();
        return;
    }
    try {
        const [handle] = await picker({
            multiple: false,
            types: [{
                description: 'Rimmap project',
                accept: {
                    'application/zip': ['.zip'],
                    'application/json': ['.json', '.board'],
                },
            }],
        });
        if (!handle) return;
        const file = await handle.getFile();
        const opened = await openProjectFile(file);
        if (!opened) return;
        setProjectName(projectNameFromFileName(handle.name));
    }
    catch (err) {
        if ((err as any)?.name !== 'AbortError') setProjectStatus('Open failed');
    }
}

export async function newProject() {
    if (appState.projectDirty) {
        const discard = await confirmDialog({
            title: 'Create a new board?',
            message: 'You have unsaved changes. Starting a new board will discard those changes.',
            confirmLabel: 'Discard & create',
            cancelLabel: 'Cancel',
            tone: 'danger',
            confirmStyle: 'danger',
        });
        if (!discard) return;
    }
    desktopProjectPath = null;
    resetAssetMemory();
    dispatch({ type: 'REPLACE_DOCUMENT', elements: [], layerGroups: [] });
    dispatch({ type: 'SET_SELECTION', ids: [] });
    dispatch({ type: 'SET_HISTORY', patch: { historyPast: [], historyFuture: [], pendingHistoryBefore: null } });
    dispatch({ type: 'SET_EDITOR', patch: { textEditBefore: null } });
    dispatch({ type: 'SET_CAMERA', camera: { x: 0, y: 0, zoom: 1 } });
    setProjectName('Untitled Board');
    dispatch({ type: 'SET_PREFERENCES', patch: {
        brushColor: '#111827',
        currentThickness: 3,
        arrowStyle: 'line',
        arrowColor: '#111827',
    } });
    dispatch({ type: 'SET_PROJECT', patch: { projectDirty: false } });
    updateBrushStylePanel();
    updateArrowToolUI();
    updateTextStylePanel();
    requestLayersPanelRefresh();
    redraw();
    await persistRecoveryNow(false);
    setProjectStatus('New project');
}

export function saveToLocal(): Promise<void> {
    dispatch({ type: 'SET_PROJECT', patch: { projectDirty: true } });
    setProjectStatus('Local recovery');
    if (appState.localSaveTimer !== null) window.clearTimeout(appState.localSaveTimer);
    let resolvePromise!: () => void;
    const promise = new Promise<void>(resolve => { resolvePromise = resolve; });
    dispatch({ type: 'SET_PROJECT', patch: { pendingLocalSaveResolvers: [...appState.pendingLocalSaveResolvers, resolvePromise] } });
    const localSaveTimer = window.setTimeout(() => {
        dispatch({ type: 'SET_PROJECT', patch: { localSaveTimer: null } });
        persistRecoveryNow(true).catch(() => {
            const resolvers = [...appState.pendingLocalSaveResolvers];
            dispatch({ type: 'SET_PROJECT', patch: { pendingLocalSaveResolvers: [] } });
            resolvers.forEach(resolve => resolve());
        });
    }, 180);
    dispatch({ type: 'SET_PROJECT', patch: { localSaveTimer } });
    return promise;
}

export async function hydrateMediaElements() {
    await hydrateAssetElements(appState.elements, redraw);
}

async function restoreMigratedProject(migration: MigrationResult, dirty: boolean) {
    resetAssetMemory();
    seedAssetManifest(migration.project.assets);
    await materializeEmbeddedAssets(migration.embeddedAssets);
    await applyProjectFile(migration.project);
    dispatch({ type: 'SET_PROJECT', patch: { projectDirty: dirty } });
}

export async function loadFromLocal() {
    const [current, checkpoint] = await Promise.all([
        get(SAFE_PROJECT_KEY),
        get(SAFE_CHECKPOINT_KEY),
    ]);

    if (isProjectSnapshot(current)) {
        try {
            let chosen = current;
            let migration = migrateSnapshotProject(current, 'Untitled Board');
            // Only treat an empty current snapshot as suspicious when it was dirty.
            // A clean empty snapshot is a legitimate newly-created blank project.
            if (current.dirty && migration.project.elements.length === 0 && isProjectSnapshot(checkpoint)) {
                const checkpointMigration = migrateSnapshotProject(checkpoint, migration.project.name);
                if (checkpointMigration.project.elements.length > 0) {
                    chosen = checkpoint;
                    migration = checkpointMigration;
                }
            }
            const recoveredCheckpoint = chosen === checkpoint;
            await restoreMigratedProject(migration, recoveredCheckpoint ? true : !!chosen.dirty);
            if (migration.migrated) await persistRecoveryNow(appState.projectDirty);
            setProjectStatus(recoveredCheckpoint
                ? `RECOVERED CHECKPOINT · ${migration.project.elements.length} objects · schema v${CURRENT_SCHEMA_VERSION}`
                : `${migration.project.elements.length} objects restored · schema v${CURRENT_SCHEMA_VERSION}`);
            return;
        } catch (error) {
            console.warn('Could not restore current recovery snapshot; trying checkpoint.', error);
        }
    }

    if (isProjectSnapshot(checkpoint)) {
        try {
            const migration = migrateSnapshotProject(checkpoint, 'Untitled Board');
            await restoreMigratedProject(migration, true);
            await persistRecoveryNow(true);
            setProjectStatus(`RECOVERED CHECKPOINT · ${migration.project.elements.length} objects · schema v${CURRENT_SCHEMA_VERSION}`);
            return;
        } catch (error) {
            console.warn('Could not restore v6 checkpoint; trying one-time legacy migration.', error);
        }
    }

    // Legacy sources are read only when no usable current/checkpoint snapshot exists. They are
    // deleted after one successful migration and are never written again.
    const legacyValues = await Promise.all(LEGACY_RECOVERY_KEYS.map(key => get(key)));
    const candidates: Array<{ migration: MigrationResult; dirty: boolean }> = [];
    for (let index = 0; index < legacyValues.length; index++) {
        const value = legacyValues[index];
        try {
            if (isProjectSnapshot(value)) {
                candidates.push({ migration: migrateSnapshotProject(value, 'Untitled Board'), dirty: !!value.dirty });
            } else if (LEGACY_RECOVERY_KEYS[index] === 'my-board-elements' && Array.isArray(value)) {
                candidates.push({ migration: migrateProjectFile(value, 'Untitled Board'), dirty: value.length > 0 });
            }
        } catch (error) {
            console.warn(`Ignoring invalid legacy recovery source ${LEGACY_RECOVERY_KEYS[index]}`, error);
        }
    }

    const candidate = candidates.find(item => item.migration.project.elements.length > 0) ?? candidates[0];
    if (candidate) {
        await restoreMigratedProject(candidate.migration, candidate.dirty || candidate.migration.project.elements.length > 0);
        await persistRecoveryNow(appState.projectDirty);
        await cleanupLegacyRecoveryKeys();
        setProjectStatus(`${appState.elements.length} objects migrated once · schema v${candidate.migration.fromVersion} → v${CURRENT_SCHEMA_VERSION}`);
        return;
    }

    setProjectStatus(`0 objects · new local board · schema v${CURRENT_SCHEMA_VERSION}`);
}

