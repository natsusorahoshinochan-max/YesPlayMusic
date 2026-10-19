# 完整操作：职责与应用接合

**Last Updated:** 2026-10-20

本文维护歌曲行、窗口、音乐搜索、每日推荐、歌词与 Last.fm 的职责和生命周期接合。目标行为与验收条件集中在 [Spec #26](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/26)。

## 歌曲行与播放入口

`TrackListItem.vue` 接收展示 props，发出 `activate({ track, index, identity })`；`TrackList.vue` 提供行资料并转交事件。页面选择 Playback 的已有来源操作，或把当前集合交给 `playTracks`。`next.vue` 提供的 `identity` 是含分组与绝对位置的队列描述，页面把它交给 `playQueuedTrack`。列表布局类型只参与展示。

歌单、专辑、艺人、音乐库、综合搜索、分类搜索、每日推荐和待播队列页面拥有各自的激活处理。每日推荐通过其 module 播放；其余来源读取、选择归属和音频交接由 [Playback](playback-and-audio-resources.md#playback-的公开-interface) 负责。菜单与收藏调用 [library 完整写操作](library-mutations-and-playlist-detail.md#library-的公开-interface)。

## 窗口操作与设置交接

`src/electron/windowOperations.js` 的 `close`、`quit` 拥有关闭政策、当前询问及退出协调。`background.js` 构造唯一实例，绑定原生窗口事件；`ipcMain.js`、托盘和 MPRIS 转交意图，Electron 菜单的退出角色通过 `before-quit` 进入同一协调。

记忆选项由主进程 adapter 发送给 renderer，`ipcRenderer.js` 等待 `preferences/setPreference` 完成后确认；主进程再继续执行已选择的窗口动作。主进程 adapter 按发送方与 `requestId` 配对确认，负责在操作完成、发送失败、renderer 崩溃、主 frame 跨文档导航或窗口销毁造成上下文丢失，以及等待超时时结束等待并释放监听与计时器。设置保存职责仍在[设置操作与持久化](settings-and-persistence.md#electron-设置应用)。原生运行验证入口见[窗口关闭操作说明](../operations/native-window-close.md)。

## 音乐搜索与每日推荐

| 所有者 | 持有与接口 | 应用接合 |
| --- | --- | --- |
| `src/musicSearch/query.js` | 每个查询的结果、分页、加载任务与采用归属；`replace`、`loadNext`、`dispose` | `src/application/musicSearch.js` 为每个页面创建实例，注入身份读取、订阅和反馈；两个搜索页面负责输入、展示与进度资源释放 |
| `src/store/modules/dailyRecommendations.js` | 推荐快照、读取状态与进行中的加载；`load`、`play`、`identityChanged` | 卡片和页面读取同一 module 状态；装配注入推荐读取及取得现有 Playback 的函数；播放构造由 module 交给 `playTracks` |

音乐搜索复用具体 `search` 与 `getTrackDetail` 读取，类别和响应映射留在查询实现内。元数据读取及可播放转换的职责见[Metadata reads](playback-and-audio-resources.md#元数据缓存读取)。公开音乐库浏览身份选择中的用户搜索由 `loginUsername.vue` 独立负责。

## 歌词内容与平台发布

`src/lyrics/index.js` 拥有当前曲目的歌词读取选择、内容对齐、原始歌词、当前行和按消费需求运行的时钟，公开 `state`、`sync`、`position`、`retry`、`consume`、`subscribe` 与释放操作。具体缓存/远端读取仍由元数据 API 执行，云盘缓存以用户与歌曲共同定位。

`src/application/player.js` 建立该所有者并通过 `player.lyrics` 交给消费者，连接 Playback 状态、seek/位置及身份变化。页面的 `consume` 返回释放函数；歌词页面负责显示与滚动，Touch Bar adapter 独立持有当前行消费需求。`playbackPlatform.js` 消费同一内容：Touch Bar 发布当前行，Linux adapter 拥有原始歌词写入、带代次确认、超时收尾和元数据发布的交接。

应用释放播放器时，`player.js` 依次释放身份订阅、歌词、平台 adapter 与 Playback。页面离开只释放自身需求和界面资源。

## Last.fm 授权与上报

`src/store/modules/lastfm.js` 是每个 renderer 的授权状态所有者，提供 `authorization` getter 及 `restore`、`connect`、`completeAuthorization`、`disconnect`、`stopConnecting` 完整操作。设置与回调页面只提交这些操作。

`src/application/lastfmStorage.js` 独占既有 `lastfm` 保存项的格式与读写。`lastfmExchange.js` 持有当前 renderer 的轮询、storage 与卸载监听；module 管理连接的建立和结束，设置页离开及应用销毁通过 `stopConnecting` 释放资源。

`playbackReporting.js` 从 getter 捕获授权快照，把同一快照交给 `api/lastfm.js` 签名和发送。有效播放事件与单次记录权仍由[Playback 上报交接](playback-and-audio-resources.md#上报事件交接)维护。

## 平台命令

`mpris.js` 转换系统模式值，现有 IPC 传递明确命令及目标值；`playbackPlatform.js` 将它们交给 [Playback 公开操作](playback-and-audio-resources.md#操作)。普通菜单、快捷键、Dock 和 Touch Bar 使用切换意图；托盘的播放与暂停项各自提交明确意图。平台 adapter 负责协议转换及状态反馈，模式计算和队列变更留在 Playback。

## 装配与身份交接

`main.js` 通过 `dailyRecommendations.read` 注入推荐 endpoint，并将 `application/lastfm.js` 的 `createLastfmOptions(localStorage)` 结果注入 `lastfm`，提供授权 endpoint、存储与交换 adapter；`createStore` 接收依赖、注册 module 并连接现有 Playback。基础 store 的依赖边界沿用[启动与依赖](session-and-request-results.md#启动与依赖)，注册不创建播放器或发送远端请求。

session 的 `identityChanged` 在凭据与身份替换前同步交接。store 将它交给每日推荐、现有歌词所有者与 `subscribeIdentityChanges` 订阅者；音乐搜索同时监听该交接与资料/VIP 变化，并在 `dispose` 时注销。歌词通过后续 `library/setUser` 接收新身份就绪信号。各内容所有者负责自己的请求采用判定，具体 API 将 `isCurrent` 传给请求层；请求层仍独占授权错误分类与会话失效效果。
