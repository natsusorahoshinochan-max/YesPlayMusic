import cloneDeep from 'lodash/cloneDeep';
import isEqual from 'lodash/isEqual';

export function createSettingsSender() {
  const { ipcRenderer } = window.require('electron');
  let previous;
  return settings => {
    if (isEqual(settings, previous)) return;
    ipcRenderer.send('settings', settings);
    previous = cloneDeep(settings);
  };
}
