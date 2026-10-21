# 会话与请求结果：结构设计

本文描述 [spec #1](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/1) 对应的已实现结构。职责与交付范围见[代码结构重构需求](../requirements/session-and-request-results-refactoring.md)；待验证会话、完整异步结果隔离等另见[行为完善需求](../requirements/session-behavior-improvements.md)。

## 模块与公开接口

会话身份和音乐库数据由 Vuex 提供响应式状态。页面通过 getters 读取身份和数据，通过 actions 执行完整操作；普通 JavaScript 调用者读取同一 store 的 getters。

| 位置 | 职责与公开接口 |
| --- | --- |
| `src/store/modules/session.js` | 身份查询 `hasAccount`、`hasLibraryIdentity`；`restore`、`loginWithPassword`、`startQrLogin`、`stopQrLogin`、`selectPublicIdentity`、`logout`、`invalidate`、`refreshDaily`；展示查询 `processing`、`qr` |
| `src/store/modules/library.js` | 资料、喜欢歌单标识、收藏、云盘与历史；查询 `user`、`likedSongPlaylistID`、`collections`、`previewReady`；加载 `loadApplication`、`loadPage`、`refreshPlaylists` |
| `src/application/` | 装配认证凭据、请求环境、endpoint 集合、导航和提示效果，连接会话恢复与后续启动依赖 |

session 的工厂接收 credentials、auth、导航、提示、时钟与调度依赖；library 的工厂接收 endpoint 集合。两者不导入全局 store、router 或浏览器存储。endpoint 继续调用 `request(config)`，无需逐一工厂化。

音乐库写操作与当前歌单详情的接口及协作由[音乐库变更与歌单详情设计](library-mutations-and-playlist-detail.md)维护；设置接口、默认值、迁移和持久化由[设置操作与持久化设计](settings-and-persistence.md)维护。播放器的公开状态与应用接合由[播放与音频资源设计](playback-and-audio-resources.md)维护。

## 身份与完整操作

`session/hasAccount` 要求 `loginMode === 'account'` 且有 `MUSIC_U` 凭据；`session/hasLibraryIdentity` 接受账号会话或 `loginMode === 'username'` 的公开音乐库浏览身份。本地资料本身不授予账号权限。`restore` 将恢复的模式和凭据读取结果写入同一响应式状态，不增加待验证状态。

密码登录封装参数整理、密码摘要、认证、凭据写入、身份更新、资料与音乐库预览加载，以及成功导航。表单、校验和焦点留在页面，密码不进入 Vuex 或持久化。二维码登录由 session 管理 key、扫码响应、过期换 key 和调度；页面只渲染二维码与信息，在切换模式或销毁时调用 `stopQrLogin`。停止后的 key 或轮询响应不再调度后续轮询。

`selectPublicIdentity` 写入选择的公开资料，加载公开歌单和预览后导航至音乐库，不调用账号专属加载端点。账号登录也在预览加载完成后导航到音乐库。

`logout` 发起远端退出，但不等待远端完成才清理本地身份。`logout` 与 `invalidate` 共用私有清理逻辑，删除 `MUSIC_U`、`__csrf`，清除登录模式、用户资料和喜欢歌单标识。主动退出回首页；失效提示后，Web 前往 `login`，Electron 前往 `loginAccount`。失效不再调用远端退出。设置、内存收藏集合、播放队列、播放进度、缓存和 Last.fm 授权不随该清理重置。

## 音乐库加载与展示

App 调用 `library/loadApplication`，音乐库页调用 `library/loadPage`，两者共用内部加载实现。账号身份先读取资料，再启动喜欢歌曲、专辑、歌手、MV 和云盘的独立加载；页面入口另外加载听歌历史。公开音乐库浏览身份只加载公开歌单和预览。

两个入口返回的 Promise 都等待歌单及其预览链：歌单确定喜欢歌单标识，歌单详情提供曲目 ID，随后获取前 12 首的详情，最后设置 `previewReady`。公开身份的歌曲 ID 来自公开歌单。专辑等独立集合不阻塞该预览链，其失败通过提示反馈。

音乐库页已有 `previewReady` 时立即展示并刷新；否则等待页面入口成功后展示。`previewReady` 可以表达空歌单已经完成加载，不能用详情数组是否为空替代。页面保留自身进度条和加载失败展示的收尾。

## 请求与环境适配

`src/utils/request.js` 使用 Axios，返回成功响应的业务数据。应用必须调用 `configureRequest` 提供设置读取、凭据读取、失效处理和请求环境；缺少失效处理会拒绝配置，未配置时不允许发送请求。请求实现不导入 router 或 session。

被拒绝的响应同时包含 `code === 301` 与 `msg === '需要登录'` 时，请求层调用失效处理；`/logout` 被排除，避免主动退出递归失效。拦截器处理后交还原始请求错误，不另建错误类型。二维码操作集中处理初次读取与轮询失败，调度终点负责续排；每日凭据刷新在自身 action 收尾，成功后记录刷新日期。

`src/application/requestEnvironment.js` 集中选择 Web/Electron API 地址，并配置 cookie、realIP 和 HTTP/HTTPS proxy。跨源 Web API 在参数中携带现有 `MUSIC_U`；相对 Web 地址与 Electron 继续使用浏览器凭据传输。`src/application/credentials.js` 统一浏览器 cookie 与 `cookie-*` 本地存储的读写和删除。

## 会话状态与持久化交接

session 管理登录模式、凭据存在状态、每日刷新日期、登录处理状态和二维码展示。凭据通过 credentials adapter 管理；`src/store/persistence.js` 接收 session 和 library 的当前状态，按[持久化投影](settings-and-persistence.md#选择性持久化)保存身份字段。

## 启动与依赖

`src/main.js` 提供应用装配，`src/application/startup.js` 显式规定执行顺序：

1. 构造 store，同步读取本地数据、注册模块和安装持久化。模块注册本身不发请求，也不构造播放器。
2. 从恢复的设置初始化 locale。locale 不在导入时读取 store。
3. 配置请求环境、凭据、设置查询和会话失效效果。
4. 执行会话恢复并等待曲目缓存初始化尝试完成，再交给[播放装配](playback-and-audio-resources.md#依赖与启动装配)创建播放器并发起恢复。
5. 等待恢复设置应用完成，安装外观监听，再进入挂载。挂载函数发起每日凭据刷新并创建 Vue 根实例；App 在创建时调用应用音乐库入口，音乐库页激活时调用页面入口和每日刷新。

路由守卫、播放器、公共页面及工具使用统一身份 getters。store 通过注入获得认证与 library API；基础构造不静态依赖播放器、混合 common 或 endpoint。

## 验证边界

测试套件、覆盖领域和归档说明见[测试组织](../../tests/README.md)。

spec #1 不承诺共享会话验证、完整登录尝试隔离、旧请求结果屏蔽、并发失效去重、完整账号集合重置、请求合并或统一失败契约。这些已确认目标及其验收条件保留在独立的[行为完善需求](../requirements/session-behavior-improvements.md)，不作为当前结构实现的能力描述。
