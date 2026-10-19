import Player from '@/utils/Player';
import { createStore } from '@/store';
import { createPreferenceEffects } from '@/application/preferenceEffects';

test('真实设置操作沿 Player 公开输出设备方法等待音频节点并传播错误', async () => {
  let finish;
  const pending = new Promise(resolve => {
    finish = resolve;
  });
  const node = { setSinkId: jest.fn(() => pending) };
  // Howler 提供的音频节点是 Player 与浏览器音频输出的边界。
  const player = Object.create(Player.prototype);
  player._howler = { _sounds: [{ _node: node }] };
  const values = {};
  const storage = {
    getItem: key => values[key] ?? null,
    setItem: (key, value) => {
      values[key] = value;
    },
  };
  const effects = createPreferenceEffects({
    getLocale: () => ({}),
    getPlayer: () => player,
  });
  const store = createStore({ storage, preferences: effects });
  let completed = false;
  const operation = store
    .dispatch('preferences/setOutputDevice', 'speaker')
    .then(() => {
      completed = true;
    });
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(node.setSinkId).toHaveBeenCalledWith('speaker');
  expect(completed).toBe(false);
  finish();
  await operation;
  node.setSinkId.mockRejectedValueOnce(new Error('sink rejected'));
  await expect(
    store.dispatch('preferences/setOutputDevice', 'other')
  ).rejects.toThrow('sink rejected');
});
