// Throwaway observation UI. Remove this file when the prototype is discarded.
export function observeComplexity({ store, router }) {
  const panel = document.createElement('details');
  panel.id = 'complexity-prototype';
  panel.style.cssText =
    'position:fixed;right:12px;bottom:82px;z-index:2000;width:340px;max-height:65vh;overflow:auto;background:#fff;color:#17212b;border:1px solid #888;border-radius:8px;padding:10px;font:12px/1.5 monospace;box-shadow:0 2px 12px #0003';
  panel.innerHTML = `<summary>一次性原型，采用待决定</summary>
    <nav></nav>
    <p>曲目：播放、切歌、打开歌词，再刷新观察恢复。<br>
    UNM：在设置页改写/清空字段，再查询真实备用音源。<br>
    滚动：打开简介或菜单，滚轮、Tab、PageDown，观察页面位置。</p>
    <pre data-state style="white-space:pre-wrap;overflow-wrap:anywhere"></pre>
    <button type="button">用当前设置查询真实备用音源</button>
    <p>查询不发送 Cookie。仅用于本地 scratch 设置。</p>
    <pre data-result style="white-space:pre-wrap;overflow-wrap:anywhere"></pre>`;
  for (const [name, path] of [
    ['专辑', '/album/1754736'],
    ['艺人', '/artist/6452'],
    ['歌单', '/playlist/6792103822'],
    ['设置', '/settings'],
  ]) {
    const link = document.createElement('a');
    link.textContent = name;
    link.href = router.resolve(path).href;
    link.style.cssText = 'margin-right:14px;color:#335eea';
    link.onclick = event => {
      event.preventDefault();
      router.push(path);
    };
    panel.querySelector('nav').appendChild(link);
  }
  document.body.appendChild(panel);
  const output = panel.querySelector('[data-state]');
  const result = panel.querySelector('[data-result]');
  const query = panel.querySelector('button');
  let querying = false;
  const visible = selector =>
    [...document.querySelectorAll(selector)].filter(
      node => node.getClientRects().length > 0
    ).length;
  const refresh = () => {
    const state = store.state.player.state;
    const settings = store.getters['preferences/settings'];
    const main = document.querySelector('main');
    const active = document.activeElement;
    output.textContent = JSON.stringify(
      {
        currentTrack: {
          id: state.currentTrack.id,
          name: state.currentTrack.name,
        },
        playing: state.playing,
        progress: state.progress,
        duration: state.durationSeconds,
        currentTrackIDExists: Object.prototype.hasOwnProperty.call(
          state,
          'currentTrackID'
        ),
        mainScrollTop: main?.scrollTop,
        mainOverflow: main && getComputedStyle(main).overflow,
        showLyrics: store.state.showLyrics,
        visibleModal: visible('.shade > .modal'),
        visibleMenu: visible('.context-menu .menu'),
        activeElement: `${active.tagName}#${active.id}.${active.className}`,
        unmJooxCookie: settings.unmJooxCookie ? '已填' : '空',
        unmQQCookie: settings.unmQQCookie ? '已填' : '空',
      },
      null,
      2
    );
    query.disabled = querying || !state.currentTrack.id;
  };
  query.onclick = async () => {
    const settings = store.getters['preferences/settings'];
    const request = {
      trackId: store.state.player.state.currentTrack.id,
      settings: {
        unmSource: settings.unmSource,
        unmSearchMode: settings.unmSearchMode,
        unmEnableFlac: settings.unmEnableFlac,
        unmProxyUri: settings.unmProxyUri,
        unmYtDlExe: settings.unmYtDlExe,
        unmJooxCookie: '',
        unmQQCookie: '',
      },
    };
    querying = true;
    refresh();
    result.textContent = JSON.stringify({ request, status: '查询中' }, null, 2);
    try {
      const response = await fetch('http://127.0.0.1:3093/unm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      result.textContent = JSON.stringify(
        { request, status: response.status, result: await response.json() },
        null,
        2
      );
    } catch (error) {
      result.textContent = JSON.stringify(
        { request, error: error.message },
        null,
        2
      );
    } finally {
      querying = false;
      refresh();
    }
  };
  refresh();
  const timer = setInterval(refresh, 500);
  window.addEventListener('pagehide', () => clearInterval(timer), {
    once: true,
  });
}
