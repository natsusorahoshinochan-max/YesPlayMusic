/* eslint-env jest */
test('desktop UI wiring can be imported before application creates its store', () => {
  global.indexedDB = { deleteDatabase() {} };
  expect(() => require('@/electron/ipcRenderer')).not.toThrow();
});
