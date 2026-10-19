# Native window close smoke

Run from the repository root with Node 16.20.2 and dependencies from `yarn.lock`:

```sh
node scripts/native/run-window-close.cjs /absolute/path/to/evidence
```

The runner bundles the production window operation and IPC entry point, then starts the installed Electron executable. It records the Git revision, host platform, runtime versions, native assertions and process log in the evidence directory. The generated `.native-window-close.cjs` bundle is removed after execution.

Windows requires an interactive desktop session and PowerShell with Windows Forms. Linux requires a display server, `xdotool` and a window manager. A headless Linux invocation can use:

```sh
xvfb-run -a sh -c 'openbox >/tmp/ypm-openbox.log 2>&1 & node scripts/native/run-window-close.cjs /absolute/path/to/evidence'
```

The real platform determines the policy. On Windows and Linux, keyboard input dismisses a native dialog with Escape and selects its default tray action on retry. Both native close and real renderer IPC then hide the live window; selecting the saved exit option exercises normal application cleanup. macOS verifies hide, reopen and explicit quit.

The contract suite in `tests/electron/window-close-contract.test.js` covers platform policy combinations, concurrent inquiries and preference persistence with substituted I/O. Native evidence is produced only by running the native script on the recorded operating system.
