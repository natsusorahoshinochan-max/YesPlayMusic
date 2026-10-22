import { globalShortcut } from 'electron';
import { registerGlobalShortcut } from './globalShortcut';
import { createMenu } from './menu';

export function applyDesktopShortcuts(win, store, control, updateMenu = false) {
  if (updateMenu) createMenu(win, store);
  globalShortcut.unregisterAll();
  if (control.enabled && !control.recording) registerGlobalShortcut(win, store);
}
