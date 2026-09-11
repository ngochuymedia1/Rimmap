# Build Rimmap for Windows

Rimmap is already configured as a Tauri v2 desktop application. The web/Vite version is still available for development, but normal users do not need Node.js or a terminal after the Windows app has been built.

## One-time prerequisites on the Windows build computer

1. Install **Node.js LTS** if it is not already installed.
2. Install **Microsoft C++ Build Tools** and select **Desktop development with C++**.
3. Install **Rust (rustup)** using the MSVC toolchain. If Rust is already installed, run:

   ```powershell
   rustup default stable-msvc
   ```

4. Windows 10/11 normally already includes **Microsoft Edge WebView2**. If it is missing, install the WebView2 Evergreen Runtime.

Restart CMD/PowerShell after installing development tools so PATH changes are visible.

## Build the desktop app

Open CMD or PowerShell inside the Rimmap project folder and run:

```powershell
npm install
npm run desktop:build
```

The first build takes longer because Cargo downloads and compiles the Rust/Tauri dependencies.



## Desktop file and dialog behavior

This build uses Tauri's official **dialog** and **filesystem** plugins for native project Open/Save. The normal application UI uses Rimmap's own rounded dialogs for confirmations and unsaved-change warnings, so desktop users should not see browser messages such as `tauri.localhost says` during current workflows.

- `Ctrl+N` creates a new board in the desktop app.
- On a board that has not been saved to a native path yet, `Ctrl+S` opens the Windows Save dialog.
- After Save or Open establishes a file path, later `Ctrl+S` saves directly to that same file.
- Closing the native window (or choosing **File > Exit**) prompts when the current board is dirty and can Save & exit, Exit without saving, or Cancel.

Use **`npm install`**, not `npm ci`, for the first build from this handoff. The source archive was prepared in a sandbox that could not reach npm to fully hydrate the newly added Tauri JavaScript plugin entries in `package-lock.json`; `npm install` on the Windows build machine resolves them and updates the lockfile normally before the Tauri build starts. This does not affect Rimmap's runtime project format or board data.

## Where the files appear

After a successful 64-bit Windows build:

- Installer: `src-tauri\target\release\bundle\nsis\...-setup.exe`
- Raw application executable: `src-tauri\target\release\rimmap.exe`

Use the `-setup.exe` as the normal client-facing release. The raw executable is useful for local testing.

## Desktop development mode

To test Rimmap inside a desktop window while developing:

```powershell
npm install
npm run desktop:dev
```

The original browser workflow still works:

```powershell
npm run dev
```

## Important compatibility note

The desktop shell does **not** change Rimmap's project schema. The document schema remains v12 and the existing project/recovery identifiers remain unchanged for compatibility. Browser IndexedDB recovery and Tauri/WebView2 IndexedDB are separate application origins, so use Rimmap's normal **Save project / Open project** flow when moving a board from the browser version into the desktop version.
