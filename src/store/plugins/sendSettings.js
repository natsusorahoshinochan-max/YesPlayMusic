import cloneDeep from 'lodash/cloneDeep';
import isEqual from 'lodash/isEqual';

export function getSendSettingsPlugin() {
  const { ipcRenderer } = window.require('electron');
  return store => {
    let previous;
    const sync = () => {
      const settings = store.getters['preferences/settings'];
      if (isEqual(settings, previous)) return;
      ipcRenderer.send('settings', settings);
      previous = cloneDeep(settings);
    };
    sync();
    store.subscribe(sync);
  };
}
