# 测试组织

有效测试放在本目录下，文件名使用 `*.test.js`。

新测试依据相关 spec 和对应 tickets 的公开契约编写，通过公开 interface 验证目标行为；真实业务实现参与测试，仅替换实际 I/O 和平台边界。

| 套件 | 覆盖领域 |
| --- | --- |
| [store/playlist-detail-contract.test.js](store/playlist-detail-contract.test.js) | 写入后的详情刷新、补读失败后的继续分页与缺失歌曲的遍历进度 |
| [playback/selection-contract.test.js](playback/selection-contract.test.js) | 最新选曲的失败与不可用结果、过时操作隔离、音频释放及下一首队列保留 |
| [playback/storage-reporting-contract.test.js](playback/storage-reporting-contract.test.js) | Playback 存档与独立进度恢复、保存失败重试及有效实例上报 |
| [playback/mpris-position-contract.test.js](playback/mpris-position-contract.test.js) | 位置采样与显式 seek 的 MPRIS 输出 |
| [application/session-preferences-contract.test.js](application/session-preferences-contract.test.js) | 身份与会话完整操作、设置保存及效果、选择性持久化与启动恢复 |
| [application/music-data-contract.test.js](application/music-data-contract.test.js) | 显式身份和设置读取、音质与缓存容量、首次播放请求前的数据接线 |

先按[开发环境](../docs/development-environment.md#工具与激活)激活 Node 16，再执行：

```sh
yarn test --listTests
yarn test
```

过时测试的存放规则与索引见[归档说明](obsolete/README.md)。自动化使用受控身份与远端响应；真实音频、设备和原生桌面接线使用[运行验证入口](../docs/development-environment.md#electron-播放运行验证)。
