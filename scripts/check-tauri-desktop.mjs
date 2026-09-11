import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(root, p));
const fail = (msg) => { throw new Error(`Tauri desktop guard: ${msg}`); };

const required = [
  'src-tauri/Cargo.toml',
  'src-tauri/build.rs',
  'src-tauri/src/lib.rs',
  'src-tauri/src/main.rs',
  'src-tauri/tauri.conf.json',
  'src-tauri/capabilities/default.json',
  'src-tauri/icons/32x32.png',
  'src-tauri/icons/128x128.png',
  'src-tauri/icons/128x128@2x.png',
  'src-tauri/icons/icon.ico',
  'vite.config.ts',
];
for (const file of required) if (!exists(file)) fail(`missing ${file}`);

const pkg = JSON.parse(read('package.json'));
const conf = JSON.parse(read('src-tauri/tauri.conf.json'));
const capability = JSON.parse(read('src-tauri/capabilities/default.json'));

const lock = JSON.parse(read('package-lock.json'));
if (lock.version !== '1.0.0' || lock.packages?.['']?.version !== '1.0.0') fail('package-lock release version does not match package.json');
if (lock.packages?.['']?.devDependencies?.['@tauri-apps/cli'] !== '^2.11.4') fail('package-lock root is missing the Tauri CLI dependency');
if (lock.packages?.['node_modules/@tauri-apps/cli']?.version !== '2.11.4') fail('package-lock is missing the pinned Tauri CLI package');
if (lock.packages?.['node_modules/@tauri-apps/cli-win32-x64-msvc']?.version !== '2.11.4') fail('package-lock is missing the 64-bit Windows Tauri CLI binary');
const cargo = read('src-tauri/Cargo.toml');
const lib = read('src-tauri/src/lib.rs');
const main = read('src-tauri/src/main.rs');
const vite = read('vite.config.ts');
const gitignore = read('.gitignore');

if (pkg.name !== 'rimmap') fail('package name must remain rimmap');
if (pkg.version !== '1.0.0') fail('desktop release version must be 1.0.0');
if (pkg.devDependencies?.['@tauri-apps/cli'] !== '^2.11.4') fail('Tauri CLI version is not pinned to the verified v2 range');
for (const [name, version] of Object.entries({ '@tauri-apps/api': '^2.11.1', '@tauri-apps/plugin-dialog': '^2.7.3', '@tauri-apps/plugin-fs': '^2.5.2' })) {
  if (pkg.dependencies?.[name] !== version) fail(`${name} dependency is missing or unpinned`);
  if (lock.packages?.['']?.dependencies?.[name] !== version) fail(`package-lock root is missing ${name}`);
}
if (pkg.scripts?.tauri !== 'tauri') fail('npm run tauri entry point is missing');
if (pkg.scripts?.['desktop:dev'] !== 'tauri dev') fail('desktop:dev script is missing');
if (pkg.scripts?.['desktop:build'] !== 'tauri build') fail('desktop:build script is missing');

if (conf.productName !== 'Rimmap') fail('Tauri productName must be Rimmap');
if (conf.version !== '1.0.0') fail('Tauri version must match package version');
if (conf.identifier !== 'com.rimmap.app') fail('unexpected desktop application identifier');
if (conf.build?.devUrl !== 'http://127.0.0.1:1420') fail('Tauri dev URL changed unexpectedly');
if (conf.build?.frontendDist !== '../dist') fail('Tauri must bundle the Vite dist directory');
if (conf.build?.beforeBuildCommand !== 'npm run build') fail('Tauri must build the frontend before bundling');
if (conf.bundle?.active !== true) fail('desktop bundling must be active');
if (!Array.isArray(conf.bundle?.targets) || conf.bundle.targets.join(',') !== 'nsis') fail('client release must target the NSIS setup executable only');
if (conf.bundle?.windows?.webviewInstallMode?.type !== 'downloadBootstrapper') fail('unexpected WebView2 installation policy');

const window = conf.app?.windows?.find((candidate) => candidate.label === 'main');
if (!window) fail('main desktop window is missing');
if (window.title !== 'Rimmap') fail('desktop window title must be Rimmap');
if (window.dragDropEnabled !== true) fail('desktop native drag/drop must stay enabled for filesystem path drops');
if (window.minWidth < 900 || window.minHeight < 600) fail('desktop minimum window size is too small for the current board UI');

if (capability.windows?.join(',') !== 'main') fail('default capability must be scoped to the main window');
const permissions = new Set(capability.permissions || []);
for (const permission of ['core:default', 'core:window:allow-close', 'core:window:allow-destroy', 'dialog:default', 'fs:allow-read-file', 'fs:allow-write-file']) {
  if (!permissions.has(permission)) fail(`missing desktop permission ${permission}`);
}
if (/invoke_handler|\#\[tauri::command\]/.test(lib)) fail('custom native commands were added; project file I/O should stay on the official Tauri plugins');
if (!lib.includes('tauri_plugin_dialog::init()')) fail('native dialog plugin is not registered');
if (!lib.includes('tauri_plugin_fs::init()')) fail('native filesystem plugin is not registered');
if (!lib.includes('tauri::Builder::default()')) fail('Rust shell does not initialize Tauri');
if (!main.includes('windows_subsystem = "windows"')) fail('release Windows build would show a console window');
if (!cargo.includes('tauri = { version = "2.11.5"')) fail('unexpected Tauri Rust crate version');
if (!cargo.includes('tauri-plugin-dialog = "2"')) fail('dialog Rust plugin dependency is missing');
if (!cargo.includes('tauri-plugin-fs = "2"')) fail('filesystem Rust plugin dependency is missing');
if (!cargo.includes('tauri-build = { version = "2.6.3"')) fail('unexpected tauri-build crate version');
if (!vite.includes("ignored: ['**/src-tauri/**']")) fail('Vite must ignore Rust build-tree changes');
if (!gitignore.includes('src-tauri/target/')) fail('Rust target output is not ignored');
if (!gitignore.includes('src-tauri/gen/')) fail('generated Tauri files are not ignored');

// Ensure this packaging-only change did not rename schema/storage compatibility IDs.
const handoff = read('AI_HANDOFF.md');
if (!handoff.includes('CURRENT_SCHEMA_VERSION = 12')) fail('document schema v12 handoff invariant missing');

// Fast binary sanity checks for the bundled Windows icon assets.
const png = fs.readFileSync(path.join(root, 'src-tauri/icons/128x128.png'));
if (png.readUInt32BE(0) !== 0x89504e47 || png.readUInt32BE(4) !== 0x0d0a1a0a) fail('128x128.png is not a PNG');
if (png.readUInt32BE(16) !== 128 || png.readUInt32BE(20) !== 128) fail('128x128.png dimensions are incorrect');
const ico = fs.readFileSync(path.join(root, 'src-tauri/icons/icon.ico'));
if (ico.readUInt16LE(0) !== 0 || ico.readUInt16LE(2) !== 1 || ico.readUInt16LE(4) < 1) fail('icon.ico is not a valid ICO container');

console.log('OK: Tauri v2 desktop configuration, native save/open plugins, and close permissions are internally consistent.');
