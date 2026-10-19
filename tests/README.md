# 测试组织

有效测试放在本目录下，文件名使用 `*.test.js`。新测试依据相关 spec 和对应 tickets 的公开契约编写，通过公开 interface 验证目标行为；真实业务实现参与测试，仅替换实际 I/O 和平台边界。

| 目录或套件 | 验证入口 |
| --- | --- |
| `api/metadata.test.js` | 歌曲、歌词、云盘歌词和专辑的实际缓存读取、转换及单次刷新 |
| `audioCache/cache.test.js` | 实际 Dexie 与 fake-indexeddb 的缓存提交、容量及维护 |
| `playback/core.test.js`、`queue-modes.test.js`、`source-operations.test.js` | 公开 Playback 选曲、归属、失败处理、队列与模式 |
| `playback/audio*.test.js` | 资源顺序、后台失败、缓存、真实 adapter 的地址生命周期 |
| `playback/*ui.test.js`、`source-callers.test.js` | Vue 调用入口与公开状态 |
| `playback/application.test.js`、`source-assembly.test.js` | 应用启动、来源 API 和反馈接线 |
| `playback/reporting.test.js` | 真实网易云/Last.fm API 接合的参数、门槛、实例去重与跨模式上报 |
| `playback/restore-storage.test.js`、`platform.test.js` | 明确存档、恢复与设置、桌面投影及平台控制 |
| `playback/integration.test.js` | 真实 store、来源 API、元数据、Dexie 音频缓存、资源和音频 adapter 组合，以及恢复资源与用户选曲竞态 |

先按[开发环境](../docs/development-environment.md#工具与激活)激活 Node 16，再执行：

```sh
yarn test --listTests
yarn test tests/playback/integration.test.js tests/playback/reporting.test.js
yarn test
```

过时测试的存放规则与索引见[归档说明](obsolete/README.md)。自动化使用受控身份与远端响应；真实音频、设备和原生桌面接线使用[运行验证入口](../docs/development-environment.md#electron-播放运行验证)。
