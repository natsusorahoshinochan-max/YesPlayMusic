# 生产源码复杂度与缺陷审查

审查版本：`0eb158bbc2be1eba2d46e558f6b8bd31d747007c`；生产源码与 `6c991784ed4f9838b132e48b356a602b4fb4a6f4` 相同。

**审查状态：本轮源码复杂度审查已完成，覆盖四个 spec、29 个关联 tickets 及四阶段变更并集中的 104 个生产文件。已确认问题、必要增长和待验证疑点分别记录；具体政策与真实 Web/Electron 运行边界见覆盖表，逐需求运行验收尚未完成。**

依据 GitHub spec #1、#8、#17、#26 及关联 tickets 审查生产实现，不审查测试代码。分类为：目标功能所需增长、已确认冗余或缺陷、待验证疑点。代码增长和当前 UI 未使用某个结果字段，均不足以证明实现多余；明确契约必须保留。每项问题记录代码位置、需求依据、证据与建议。历史条目保留原编号，当前判断见各项。

行数采用 `git diff --numstat` 的物理行口径，范围为 `src/` 下的 `.js`、`.vue`。文件变更量用于追踪增量；具体问题的计量范围另列。同一代码块涉及多个问题时通过条目引用连接，避免重复累计。

| Spec | 比较范围 | 新增 | 删除 | 净增 |
| --- | --- | ---: | ---: | ---: |
| [#1](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/1) | `01f2de1..122e4b4` | 1,497 | 1,242 | 255 |
| [#8](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/8) | `122e4b4..810357e` | 1,274 | 632 | 642 |
| [#17](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/17) | `810357e..7c8135f` | 2,034 | 1,541 | 493 |
| [#26](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/26) | `7c8135f..6c99178` | 1,452 | 923 | 529 |
| 合计 | 四段变更量累计 | 6,257 | 4,338 | **1,919** |

这组生产文件从 94 个、20,345 行增至 128 个、22,264 行。

**1. 目标功能所需增长：E1–E6**

以下增量主要用于实现规格明确规定的行为，属于必要职责，不能计入已确认冗余。具体机制是否过量需另有证据；歌词与关闭确认的超时及清理边界见下方补证，超时数值属于实现选择。

| 条目 | 生产代码与引入提交 | 新增工作及增长原因 |
| --- | --- | --- |
| E1：#8 多阶段写入结果 | [libraryChange.js](../../src/store/libraryChange.js)，1–45；[library.js](../../src/store/modules/library.js)，136–146、330–379；`840bfcbc`、`9b1ba1a`、`9269c7a`、`c658a18` | 普通写入新增 `outcome/synchronization`，创建新增 `creation/addition/synchronization`。操作需要保留各阶段事实、分类运输失败、汇合多个同步任务，再由页面映射提示。#8 的“创建和添加歌曲的结果分别表达”“一个更新失败不阻止其他必要更新的尝试”主动增加这些分支。歌曲和详情同步的具体增量见第 4 类。 |
| E2：#17 完整选曲归属与资源准备 | [playback/index.js](../../src/playback/index.js)，79–92、240–369、464–504；[audioAdapter.js](../../src/playback/audioAdapter.js)，8–38、62–120；`15a6fef`、`ab69926`、`8184175` | 从来源列表取得到音频交接都增加操作编号、失效检查、准备任务集合、取消、延迟音频事件和逐实例释放。旧 Player 的来源方法直接读取后替换当前曲目；新规格要求“最新播放操作生效”和严格资源交接，交付同时承担了行为修正。 |
| E3：#17 缓存提交协调 | [audioCache/index.js](../../src/audioCache/index.js)，8–14、34–88；`5c1f610` | 旧容量统计在写入完成前更新；新逻辑新增串行提交、事务内覆盖差额、淘汰和事务成功后发布统计。这里增加的是一致性工作。该提交的 AudioCache 新增 91 行，同时原 db 区域新增 28、删除 103 行，相关迁移合计净增 16 行。 |
| E4：#26 查询退役管理 | [musicSearch/query.js](../../src/musicSearch/query.js)，27–42、49–58、74–106、110–119、144–150；`4863860`、`b255fe5` | 抽出类型与分页规则的同时，新增查询代次、作业集合、销毁状态、加载汇总和详情完成后的归属复查。旧综合页只比较搜索响应阶段的关键词，旧分类页直接累积；“替换或销毁后，详情结果失效”扩大了生产实现的工作范围。 |
| E5：#26 歌词失败重读与消费者时钟 | [lyrics/index.js](../../src/lyrics/index.js)，13–36、49–73、137–143、182–211；[lyrics.vue](../../src/views/lyrics.vue)，233–237、460–487；[playbackPlatform.js](../../src/application/playbackPlatform.js)，16–19、31–40、155–195；`5fbd2eb` | 迁出页面取词、计时和既有写词握手的同时，新增 idle/loading/ready/empty/failed 状态、重试操作和按钮、消费者计数及释放。页面和 Touch Bar 实际消费这些能力。规格纳入失败恢复和按消费者运行，实现又为既有握手附加 5 秒超时及清理；这些新增工作消耗了删除收益。 |
| E6：#26 关闭前的设置保存确认 | [ipcMain.js](../../src/electron/ipcMain.js)，74–117；[ipcRenderer.js](../../src/electron/ipcRenderer.js)，46–61；[windowOperations.js](../../src/electron/windowOperations.js)，43–54；`eba7cae`、`af7a5dc` | 旧路径发送“记住选项”通知后直接隐藏或退出；新路径等待 renderer 保存成功，再执行关闭。一次通知扩成请求编号、发送方验证、成功/失败确认、超时、崩溃和导航失效、监听清理。主进程确认块现为 44 行；这是新增确认协议带来的连带代码。 |

E1 的结果状态进入 [libraryOutcome.js](../../src/utils/libraryOutcome.js) 和创建弹窗的生产提示；E2 的结果进入 `runSelection`、`discardFMTrack` 和播放反馈；E5 的消费与释放分别由歌词页面和 macOS 平台调用。这些条目的目标功能必须保留。下文仅将可具体移除的重复规则和已证明的错误列为问题。

E5 范围补证：#32 自身要求防止迟到发布和悬挂握手；5 秒是实现选择，需求没有指定数值。真实 platform 执行中 idle/loading 不建立等待，empty/failed/ready 各建立一次写词与超时；超时后迟到确认只发布一次 metadata，切歌或 dispose 后旧超时/确认不发布，监听归零。页面消费资格、Touch Bar 消费资格、歌词时钟、平台握手各有不同资源，未发现 B2 之外的重复所有者。#37 属后续 #27，仅按 #32 明确引用理解范围，未用它扩大本轮要求。

E6 范围补证：windowOperations 的 inquiry 覆盖完整询问和保存，ipcMain 的 requestId 只关联其中一次 renderer 保存；quitting 表示退出，不是第二份保存状态。原生产组合并发 close 共用同一 Promise，只询问和发送保存各一次；错误 sender 不退出，正确确认后退出一次并清空监听；真正导航终止等待，主 frame 原地导航保留。旧 background/IPC 询问 helper 已删除，未发现第二套关闭政策。两端确认格式和失效清理属于新增跨进程完成交接成本，5 秒是实现选择；S1 的双保存入口不在此重复计数。

为保持领域计量一致，#26 搜索五文件（query、musicSearch、searchProgress、search、searchType）合计新增 297、删除 172，净增 125 行；每日推荐模块、卡片和页面合计净增 41 行。窗口四文件（windowOperations、background、ipcMain、ipcRenderer）合计新增 148、删除 167，净减 19 行；E6 消耗了该切片的一部分删除收益。

**2. 增加中间层，却保留调用者的业务知识**

**W1：#1 新增 action 后，页面继续解释同一权限与远端协议。历史项，#8 已替换。**

引入提交：`89fd002b`。证据版本为 #1 完成点 `122e4b4`。

| 当期位置 | 同时保留的知识 |
| --- | --- |
| [library.js:212–218](https://github.com/natsusorahoshinochan-max/YesPlayMusic/blob/122e4b49082d739dadbea8fc8a6e84d60f5a5b90/src/store/modules/library.js#L212-L218) 与 [album.vue:245–266](https://github.com/natsusorahoshinochan-max/YesPlayMusic/blob/122e4b49082d739dadbea8fc8a6e84d60f5a5b90/src/views/album.vue#L245-L266) | 新 action 判断账号、判断 `code === 200`、刷新集合；页面改为 dispatch 后，原有执行前账号判断和 `code === 200` 判断继续存在。 |
| [library.js:180–193](https://github.com/natsusorahoshinochan-max/YesPlayMusic/blob/122e4b49082d739dadbea8fc8a6e84d60f5a5b90/src/store/modules/library.js#L180-L193) 与 [添加弹窗:78–93](https://github.com/natsusorahoshinochan-max/YesPlayMusic/blob/122e4b49082d739dadbea8fc8a6e84d60f5a5b90/src/components/ModalAddTrackToPlaylist.vue#L78-L93) | action 透传 `op/pid/tracks`，检查 `body.code` 后返回原响应；弹窗继续构造远端参数、解释 `body.code/message`。 |
| [TrackList.vue:253–274](https://github.com/natsusorahoshinochan-max/YesPlayMusic/blob/122e4b49082d739dadbea8fc8a6e84d60f5a5b90/src/components/TrackList.vue#L253-L274) | 删除入口继续构造相同协议、解释结果，并调用父页面内部方法更新详情。 |

新增层承担集合刷新，却把远端协议与详情更新留给调用者。修改一次成功条件或请求参数，需要同时理解新 module 和原页面。专辑 action 新增块为 7 行，曲目变更 action 为 14 行；其中包含真实请求和集合更新，错误增长集中在迁移后继续维护两份权限与成功条件，而远端参数结构仍然穿透到页面。

#8 的 `840bfcbc`、`9b1ba1a`、`9269c7a` 将这些入口换成业务参数、业务结果和详情协作。当前入口已经替换；W1 用于解释 #1 的增长及下一轮再次替换同一接口的成本。

**3. 私有资料提交被用作歌词身份交接的完成信号**

**I1：歌词身份交接由直调开始，再由私有 mutation 名结束。当前保留。**

#1 的 `dba81cd9`、`3c3bbc8a` 建立模式/凭据在 session、用户资料在 library 的边界；#26 的 `d81800ab`、`5fbd2eb1`、`b255fe5f`、`5df1d87d` 增加下面的交接代码。

| 当前位置 | 新增协作机制 |
| --- | --- |
| [session.js](../../src/store/modules/session.js)，68–84、170–178 | 进入/退出先调用 `identityChanged()`，随后修改模式与资料；公开音乐库浏览身份直接提交另一个 module 的 `library/setUser`。 |
| [store/index.js](../../src/store/index.js)，37、56–60、76–79 | 将一次交接分别转成 daily action、`player.lyrics.identityChanged()` 和自定义监听集合广播；向 store 追加订阅 API。 |
| [application/player.js](../../src/application/player.js)，157–165 | 订阅 session/library mutations，以字符串 `library/setUser` 识别“身份已就绪”。 |
| [lyrics/index.js](../../src/lyrics/index.js)，34、146–158 | 新增 `identityPending`；直接方法调用将其置起，另一路 `sync({ identityReady })` 将其解除。 |
| [application/musicSearch.js](../../src/application/musicSearch.js)，12–22 | 同时注册交接监听和资料变化观察，组合两个注销函数。 |

歌词的生产链为 `session → 根装配直调 → lyrics.identityChanged`，完成识别另走 `library/setUser → 播放器装配订阅 → lyrics.sync(identityReady)`。身份操作的开始、完成和等待位分别落在四个文件。装配代码必须学习 library 私有 mutation 的名字与调用时机，歌词为这个协议增加状态和两个入口。

同一个 setUser 还用于 library.js:87 的加载、194–195 的替换、209 的清空和 session.js:176 的公开身份选择；“资料提交即交接完成”的解释仅存在于播放器装配。全生产 subscribe/watch 核查未找到另一份相同等待协议。持久化按 module 前缀保存、设置镜像按公开 getter 比较均有独立用途，未与 I1 合并计数。

可确认的耦合是装配依赖私有 mutation 名：改变资料提交方式时，必须同步维护播放器装配对交接完成的识别，否则歌词等待可能无法解除。身份等待与旧结果失效本身承担必要功能。本项与 F1 合并计为一个根因，不把等待位与接线整体计算为可删除面积。搜索动态订阅和资料变化观察服务不同的失效条件。上述歌词私有交接协议由 #26 引入；#1 的身份边界是其历史前提。

#32 明确允许先接当前真实身份输入，待 #39 再接统一归属。因此当前 session/library 分离及临时装配本身不列为冗余；开始失效和交接等待还防止以新凭据配旧 userId 读取云盘歌词。问题限定为私有完成信号及 F1 已确认的失败出口遗漏，不要求提前实现后续身份重构。

**4. 多份相关数据继续靠手工同步**

**L1：普通加曲、删曲重复统一写入骨架；多集合同步属于必要职责。**

引入提交：`840bfcbc` 的删除协调、`9b1ba1a` 的喜欢操作、`9269c7a`/`c658a18` 的添加及确认结果保留。主要位置为 [library.js](../../src/store/modules/library.js) 的 `trackAdditionUpdates`、`removePlaylistTracks`、`toggleTrackFavorite`，以及 [playlistDetail.js](../../src/store/modules/playlistDetail.js) 的 `applyLibraryChange`。#8 将集合刷新和详情刷新集中之后，仍由每个写操作列举它影响的歌曲 ID、预览、歌单集合和当前详情。

例如 `toggleTrackFavorite`（411–463）在原有歌曲 ID 更新和预览重读之外，新增喜欢歌单识别的共享 Promise、预览局部删除、详情删除及重读；添加和删除曲目又分别组织自己的任务数组。`synchronize`（libraryChange.js，37–45）并发尝试这些任务，再生成一个同步状态。详情侧按 `tracks-added/tracks-removed/favorite/reload` 再次分派。

[#8](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/8) 与 #13–#15 明确要求维护喜欢 ID、预览、集合和匹配详情，并在一个更新失败后继续其他必要更新。因此任务清单与多份视图数据本身不列为冗余，也不能把四个文件整体 480 行计为错误增长。

此外，library.js 的 136–146 已提供“权限 → 请求解释 → 更新 → 返回结果”的 `write()`，8 个普通写操作使用它，add/remove 又在 271–281、312、315–327 重写同一骨架。双阶段创建有不同流程；这里重复的是两个普通曲目操作已有可用实现的控制流。

合并 add/remove 时，各必要更新仍须作为独立任务交给 synchronize；不能为缩短代码把详情、歌单、喜欢集合和预览包成一个串行任务，否则第一项失败会阻断其余尝试。

原模块 add/remove 八组执行确认：拒绝授权零请求，业务拒绝或空结果不更新；写入成功而读取全部失败时，两者均保留 succeeded/incomplete，并尝试详情、歌单、喜欢 ID、预览四项。重复范围是公共控制流。添加的喜欢 ID 去重并集（124–130）与删除的 ID/预览移除（291–309）来自不同目标行为；添加在构造任务数组时更新本地 ID，删除则在 synchronize 的独立任务内更新，异常边界并非完全等价，不能把整段列为机械重复。

**L2：公开结果字段按契约保留；空任务分支无需优先改动。**

引入提交：`840bfcbc`、`9269c7a`。位置为 [libraryChange.js](../../src/store/libraryChange.js) 的 1–4、37–44，以及 [library.js](../../src/store/modules/library.js) 的 346–362、374–379。

| 字段或分支 | 当前生产读取 | 实现位置与契约用途 |
| --- | --- | --- |
| synchronization 的 completed/not-required 两值 | libraryOutcome.js:15、ModalAddTrackToPlaylist.vue:92、ModalNewPlaylist.vue:96 只判断 incomplete | 同步任务结果生成多个最终被同一分支消费的命名状态。 |
| denied.reason | libraryOutcome.js:4 只读取 denied 的 status，资料库写结果的生产消费者均未读取 outcome.reason | accountRequired 对象附加没有调用者使用的原因字段。 |
| creation.playlistId | 唯一创建调用者 ModalNewPlaylist.vue:80–102 没有读取它 | 内部加曲需要 ID，公开结果另复制一次 ID；library.js:362 的复制没有生产消费者。 |
| addition.not-attempted | 创建弹窗 85–94 在创建失败时先返回，再读取 addition | 为唯一调用者不会进入的子分支构造结果。 |
| synchronize([]) | 所有实际传入的任务数组至少有一项，失败写入在同步前返回 | libraryChange.js:38 新增无生产入口的空任务兜底。 |

前四项是 [#8](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/8) 的业务结果明文契约，当前 UI 合并提示不能作为删除依据。删除这些字段需要先调整需求，当前不列为实现问题。`synchronize([])` 虽无实际调用，但一行分支承接明确的 not-required 语义，尚无明显维护负担，不列为主要简化目标。

**L3：给收藏集合新增的 subscribed 字段没有生产消费者。已确认残留。**

引入提交：`9b1ba1a`。位置为 [library.js](../../src/store/modules/library.js) 的 156–168，特别是 162–166 的正向 map 分支；调用位于 265、386、396、406。

helper 在 favorite 为 true 时复制整个集合，给命中项增加 `subscribed: true`，用于歌单、专辑、歌手和 MV。专辑详情实际读 `dynamicDetail.isSub`，歌手读 `artist.followed`，MV 读 `mv.subed`；歌单页读的是独立 playlistDetail 中的 subscribed。音乐库将集合交给 CoverRow/MvRow，这两个组件按成员、封面和标题展示，也不读取该字段。

旧版确认成功后重读集合，详情页更新各自显示状态；#8 保留这些实际路径，又增加无人读取的字段写入。这个正向分支也没有将新增收藏插入集合。问题涉及 162–166 的 5 行正向映射，尚未以修改验证净删除量；四个 helper 调用点还服务取消收藏时的成员过滤。

**L4：加载流程已共用，部分读取依赖与参数绑定仍重复。**

位置：[library.js](../../src/store/modules/library.js):83、108–109、466–469 的身份检查及 `loadPlaylists → loadPreview` 顺序，88–104 与 238、257、385、396、407 的集合/API/limit 配对。普通加载和刷新各自维护前一依赖顺序；初次加载与写后刷新分别写出 albums/likedAlbums/2000、artists/likedArtists/2000、mvs/likedMVs/1000、cloudDisk/cloudDisk/1000。前三类配对和歌单预览双入口在 #1 已有；cloudDisk 写后刷新两处由 #8 新增，刷新本身服务 #14 集合同步，重复仅在参数绑定。

[#4](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/4) 要求场景入口共用内部实现、真实读取依赖集中表达。当前 loadApplication/loadPage 已共用 loadLibrary，loadCollection 也统一校验和提交；确认剩余重复仅为上述依赖顺序和参数知识，不是两套完整加载流程。简化方向限于减少同一读取规则的维护位置。

原 action 六组执行覆盖账号/公开身份与三个入口：账号应用加载读取资料、五类独立集合及歌单预览；页面加载另加两种历史；refresh 只读歌单预览；公开身份三个入口都只读歌单预览。不能让 refresh 直接执行整个 loadLibrary，也不能把后台读取改为写入 synchronize 后宣称完成时点不变。账号喜欢 ID 与前 12 首预览来源不同，均有实际需求；页面调用方未再组织集合请求。

L1 只记录普通 add/remove 的公共控制流重复，L4 只记录读取顺序和参数知识。同一个必要刷新任务在两项出现时不重复累计整段代码。

**5. 保存触发重复与存储契约**

**S1：同一个设置提交触发两次保存检查。当前保留。**

引入提交：`86585a2`；`5a80a16`、`5da4213`、`39d69dc` 将相同调用继续铺到音频、桌面和代理设置。

生产链为 `settings.vue → preferences action → commit → persistence 的同步订阅 → action 的 persist → 再次 save`。第一次保存已经更新已保存快照，第二次再生成 settings/data 投影并比较。

| 当前位置 | 重复入口的组成 |
| --- | --- |
| [persistence.js](../../src/store/persistence.js)，98–100 | 继续订阅全部 `preferences/session/library` mutations，并调用 save。 |
| [preferences.js](../../src/store/modules/preferences.js)，70、74、78、86、92、98、104、109、114、119、124、129、144、157、172 | 15 个有状态写入操作，在 commit 后显式调用 `await persist()`。179 行的启动配置应用另调用一次。 |
| [store/index.js](../../src/store/index.js)，69–72；persistence.js，88–91 | 为第二入口增加 persist 注入和 save/ready 暴露。 |

生产使用同步 localStorage；Vuex 的 commit 在返回前执行订阅，订阅保存异常也直接进入 async action 的拒绝路径。新增显式保存时保留了设置订阅的原负责范围，第二次再次读取 settings、构造 data 投影并比较。通常实际落盘一次，重复的是触发入口、检查和完成接线。

显式完成承诺应保留；简化必须同时协调保存触发、完成结果和 Electron 镜像交接。真实 Vuex/preferences/persistence/sendSettings 组合中，同步保存抛错时当前顺序为 `save → rejected`、无 IPC；仅排除 preferences 保存订阅的内存对照变为 `IPC → save → rejected`。直接删该订阅会使保存失败的新设置提前发布。可让 action 等待订阅已发起的保存，或让完整操作保存成功后发布镜像，避免再次生成投影；不能将整套完成接线的 25 行算作可删除代码。

**S2：异步排队缺少当前生产使用，但 #26 明确要求保留；仅属需求调整候选。**

引入提交：`86585a2`。位置为 [persistence.js](../../src/store/persistence.js) 的 13、48–73、75、89–97 行。

唯一生产创建链在 [main.js](../../src/main.js) 的 56–75 行，没有传入替代 storage；[store/index.js](../../src/store/index.js) 的 20–33 行因此使用全局 localStorage。`createPersistence` 只有这一个生产调用。Web 与 Electron renderer 共用该入口。

同步 `setItem` 返回 undefined，实际每次都走 persistence.js 的 55–58 行并立即更新 saved；pending 始终为空。新增的同值待办复用、thenable 检测、前驱等待、任务登记和 finally 清理，在这条生产路径中没有异步任务可处理。

[#26](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/26) Implementation Decisions §9 明确保留“按存储项排队”。当前实现满足这一要求，不能直接按冗余删除。若未来决定收窄存储契约，涉及的异步专属代码为 13、49–50、59–61、67–72 行，共 12 个源码行；外围 then 检测、分支选择、Promise 汇合和 ready 接线也由这项泛化引入。独立值快照、深比较和嵌套字段保留服务当前选择性持久化，重复入口仍按 S1 处理；排队机制保留。

**6. 旧的全量联动被搬到新位置**

**B1：删除 Proxy 后，状态变化仍统一进入保存和平台发布。当前保留。**

引入提交：`15a6fef`、`ab69926` 建立 snapshot/publish；`2ba33e9` 接入保存和平台发布；`2f4a4ec` 建立平台比较逻辑。

| 当前位置 | 保留的联动与新增补偿 |
| --- | --- |
| [playback/index.js](../../src/playback/index.js)，64–78、278–290、385–428 | 默认 semantic publish 把暂停、FM loading 开关等变化与持久化变化送进同一回调。 |
| [application/player.js](../../src/application/player.js)，129–143 | 每次 semantic 回调都构造 archive、调用保存、发布平台状态；#26 再加入歌词同步。 |
| [playerStorage.js](../../src/application/playerStorage.js)，33–44 | 重建存档投影，JSON 编码并与 previous 比较，跳过无变化写入。 |
| [playbackPlatform.js](../../src/application/playbackPlatform.js)，198–253 | 保存 lastState、metadataKey，再分别比较播放、模式、元数据变化；每次仍发送完整 player 快照。 |

旧 Proxy 的“顶层变化牵动全部输出”被替换成“semantic publish 牵动全部输出”。以 `personalFMLoading` 为例，它没有进入恢复存档，变化仍先生成、克隆、过滤、编码整份存档，随后才靠比较放弃写盘。新增的存储 previous、平台 previous 和字段比较承担过滤无关通知的工作，触发耦合继续存在。

归因限定：全量联动在基线 store Proxy 已存在，#1 搬入 application/player；#17 在新接合中延续并增加 archive/过滤链及 loading 输入，#26 再接入歌词消费者。旧耦合的延续与新增联动分别记录，不能把原 Proxy 问题全计为重构新增。

引入证据：`2ba33e9` 增加 storage 白名单/比较的同时，将 loadFM/loadFMNext 开始与结束处四个 `publish(false)` 改为 `publish()`，把临时 loading 接入整条输出链。loading-only 写盘为零，符合“不写入临时变化”的行为要求；这里的问题是触发选择仍留给下游过滤。队列编辑的公开通知则必须保留：next.vue:49–53 通过读取 player.state 建立响应式依赖，再调用 upcoming；即使普通展示快照字段未变，也依赖该通知更新队列。

历史范围：原 publish(false) 已更新 snapshot，布尔开关只控制应用回调。稳定 FM nextLoading 最能隔离无关工作；进入 loadFM 时还可能承载此前来源变化，不能把四处调用都直接视为纯 loading。下一首资料在 414–415 独立发布，有封面、队列及恢复消费者。平台 playing/mode/metadata 比较早在 `2f4a4ec` 存在，后续 sourceInfo 条件处理音频尚未交接的真实中间态；不能声称它们全是四处 loading 改动新增的补偿。与宽存档接线同时引入的 storage previous 比较才是直接历史证据。

可确认的问题是临时状态也触发 playerStorage.js:39–43 的投影、编码和比较。平台仍需识别实际播放、模式、元数据和歌词的不同到达时机；现有证据未证明 playbackPlatform.js:210–245 的这些比较可以全部删除。简化应先收窄存档触发，保留必要平台发布判断。

真实 Playback/playerStorage/lyrics/platform 组合按应用原接线执行，得到以下计数。每项从音频与歌词已就绪开始；计数来自受控边界，原生绘制成本未测量。

| 操作 | 状态发布 / archive / lyrics.sync | 实际存档写入 | 新歌词请求 |
| --- | --- | --- | --- |
| 音量改为 0.5 | 各 1 | 1 | 0 |
| 再设 0.5 | 各 1 | 0 | 0 |
| repeat 改为 one、开启 shuffle、append 下一首（分别执行） | 各 1 | 各 1 | 0 |
| FM nextLoading 开启或关闭（分别执行） | 各 1 | 0 | 0 |
| FM 下一首资料返回 | 各 1 | 1 | 0 |

每项还发送一次完整 player IPC、一次 updateTrayLikeState，并调用一次 Media Session setPositionState。存档比较已阻止 loading-only 写盘，歌词 key 已阻止重复取词；实际浪费主要是投影/编码、歌词位置扫描及无变化的平台效果。FM 来源、下一首资料、模式、音量及队列编辑都属于恢复字段，必须保存。

消费者支持进一步收窄：[background.js](../../src/background.js) 127–129 的 /player 读取全局完整快照，应保留更新；桌面 player IPC 的 [mpris.js](../../src/electron/mpris.js) 32–40、[touchBar.js](../../src/electron/touchBar.js) 52–57 只消费 playing/liked，消费者已取得初始状态后的相同投影发布属于优化候选。收藏 IPC 经 [ipcMain.js](../../src/electron/ipcMain.js) 236–238 到 [tray.js](../../src/electron/tray.js) 161–164，Linux 无条件 setContextMenu，所以上述无关变化还重复重设菜单；Windows 仅更新字段。位置发布保留曲目/duration、播放状态及原 progress/seek 节奏，纯音量、模式、队列与 loading 的位置效果属于收窄范围。

范围限制：消费者首次建立时仍需取得当前值。真实 platform/MPRIS 组合中，playing=true 的首发早于 createMpris 时，MPRIS 未收到 playbackStatus；随后音量变化触发的同值发布才补齐 Playing。[background.js](../../src/background.js) 336–350、372–393 先 loadURL，再等待代理恢复和 DBus 后建立原生消费者，因此不能直接删除所有同值发布而忽略初始化交接。这里确认的是收窄建议的约束；实际原生启动与重建行为仍待验证。

**B2：平台元数据键与发布判断重复。**

引入提交：`5fbd2eb`。位置为 [application/player.js](../../src/application/player.js) 的 129–143、157–164，[lyrics/index.js](../../src/lyrics/index.js) 的 155–179，[playbackPlatform.js](../../src/application/playbackPlatform.js) 的 173–194、238–247。

每次 semantic 输出和所有 session/library mutations 都调用歌词 sync，音量、循环、倒序、下一首队列和 FM loading 因而也到达歌词。sync 每次重新计算 `[id, pc, cd, identity]` JSON key，再更新位置和时钟条件。该键本身承担真实的曲目与身份归属；可确认的额外协调是把歌词接入过宽的通知通道，再从中寻找相关变化。宽通知列为次要优化候选，两路 sync 不能整体算作可删除代码；歌词请求归属检查按 E5 的必要职责保留。

mutation 入口还接收 QR 文案、processing、刷新日期、集合和预览就绪变化。它们均进入 application/player.js:157–164；收藏变化有平台消费者，不能将整个 library 订阅视为无用。问题范围是各下游必须从宽通知中重新判断相关性。

真实 Vuex/session/library/lyrics 与原订阅回调执行 13 组 mutation：QR、processing、刷新日期、喜欢歌单 ID、previewReady、七种非 songs 集合及 songs，每组均触发 sync/platform 各 1 次、歌词请求 0 次；只有 songs 改变当前收藏投影。QR 轮询还可每秒提交相同提示（session.js:43–64）。R1 的 songs 通知参数虽已存在，生产装配未注入，实际收藏同步仍依赖宽订阅；写入结果不能替代集合事实，因为启动读取和公开身份预览也会更新 songs。宽订阅确认增加无关下游检查；平台侧两个元数据键定义构成重复规则维护，不能把检查数量直接当作重复职责数量。

R1 的迁移关联：#1 的通知曾调用旧 Player.sendSelfToIpcMain；`ab69926` 换成无此方法的新核心后，该可选调用失效；`2ba33e9` 删除注入并增加全 library 订阅，却留下 library 默认空回调；#26 再扩到 session/歌词。R1 是遗留入口，宽订阅是现行过宽出口，不能计为两套同时生效的通知。删除空回调只能处理遗留，不能据此宣称通知职责已收敛。

平台侧，歌词订阅回调与常规 publish 各自构造 `[currentTrack, generation, status]` 元数据键，并组织 `publishMetadata`。增加一个影响元数据身份的字段，要修改两路键定义与发布分支。两组代码分别位于 playbackPlatform.js 的 188–193、239–246。I1 的身份等待协议另在第 3 类记录。

执行对照：同曲仅改音量新增 metadata 发布 0 次；歌词完成后再次发布同状态，metadata 合计 1 次。B2 确认的是同一规则的两处维护，现有样本未发生重复 metadata I/O。

**7. 同一规则仍需多处维护**

**D1：存档编解码之外，又新增一份字段白名单。当前保留。**

引入提交：`2ba33e9`。位置为 [playback/index.js](../../src/playback/index.js) 的 720–775，以及 [playerStorage.js](../../src/application/playerStorage.js) 的 8–40。

Playback 的 archive 已逐字段构造旧格式，restore 逐字段读取。存储适配器另以 16 项 archiveFields 定义允许字段，启动读取与每次保存各 project 一次。唯一生产保存调用来自 `playback.archive()`，输入已经由同一个核心明确构造；restore 也只读取自己知道的字段。

额外白名单让新增一个持久化属性必须修改编码、解码和存储过滤三处。当前 archive 已输出 `_progress`，适配器又将它剔除，进度经另一项存储保存；恢复数据的边界需要组合两层才能理解。

正常的编码与解码各有方向；额外规则位于 playerStorage.js 的 8–32，共 25 行白名单与过滤函数，34、40 行再各调用一次。增长来自第三份字段规则及重复过滤。

范围约束：#17 明确要求存储 adapter 显式映射 player 与独立进度，#24 要求旧档字段映射。确认问题是核心已编码旧格式后，adapter 再维护相同字段选择；不能把 adapter 的映射职责本身判为无用。25 行是重叠规则涉及面积，未证明可以整块删除，也未确定应删除哪层定义。

成功快照不是同类冗余：真实 storage 首次写入失败、同值重试成功、再同值提交，实际写入尝试 2 次。previous 仅在成功后更新，保留了失败重试；不能与字段白名单一起计作可删除代码。

**D2：身份字段来源重复定义，并保留未被生产使用的默认分支。当前保留。**

引入提交：`c4ed48a9`、`4863860e`、`5fbd2eb1`。位置为 [startup.js](../../src/application/startup.js) 的 15–20、[application/player.js](../../src/application/player.js) 的 41–46、[application/musicSearch.js](../../src/application/musicSearch.js) 的 4–9。

三处都从 session 读取模式与 hasAccount，从 library/user 读取 userId 与 vipType。搜索将模式命名为 mode，仅用于整个对象的归属指纹；字段来源仍与另两处相同。

startup 把 reader 同时交给 musicData 和 createPlayer；搜索另定义一次相同来源。唯一生产 createPlayer 调用总是显式提供 reader，player 参数中的默认映射没有执行机会。`5fbd2eb1` 增加歌词字段时已经同时修改 startup 和 player 两份映射，提供了实际的重复维护证据。

三块定义各 6 行，共 18 行；其中 player 默认映射的 6 行没有生产消费者。相对于一份字段来源规则，另两份占 12 行重复定义面积。实际运行的是 startup 和搜索两份读取；这里重复的是映射知识。

邻接后备链核查：[application/player.js](../../src/application/player.js):40 的 getSettings 默认读取总被 startup.js:14、29 传入的相同 reader 覆盖。61–66 的 liked() 先读公开 getter，再读私有 state，最后返回空数组；唯一生产 store 始终注册 library，getter 提供 songs 数组，初始化及写入路径也维持数组，后两支无生产执行机会。该后备链由 `2ba33e90` 引入，额外维护了公开与私有两条数据路径，属于低优先级残留。普通空 adapter 与可注入参数没有同类业务规则，不据此一并列为冗余。

该后备链归 D2 的附属残留。[#24](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/24) 要求应用接合生成收藏投影，未要求兼容缺失 library 的 store。建议清理不可达的私有 state/空数组后备，保留公开 getter、收藏投影和真实同步能力。

横向覆盖：全生产检索未发现第四份相同身份投影；账号成立判断集中在 session.js:98，其他权限消费者使用公开 getter。playlist.vue:382–386 与 ModalAddTrackToPlaylist.vue:65–70 的 creator 比较属于歌单所有权；requestEnvironment.js:18–20 与 electron/scrobble.js:104–107 的凭据读取属于传输协议，均不计入 D2。I1 的私有完成等待仅由歌词消费，daily/search 没有复制该等待协议。

**D3：自然结束时长与不足一秒的上报门槛在两层维护。**

位置：[playback/index.js](../../src/playback/index.js):96–110 与 [playbackReporting.js](../../src/application/playbackReporting.js):35–36。核心 emit 已把自然结束的 position 设为 durationSeconds；唯一生产上报接合再次按 completed 选择 durationSeconds。接合先排除取整后不足一秒，随后 recordOnce 又对相同 position 判断一次。前者来自 `15a6fefa`，上报接合由 `9607eeaf` 加入。

[#23](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/23) 要求自然结束时长、取整和一秒门槛；[#20](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/20) 要求实例私有认领状态。确认重复的是时长及阈值规则，未发现重复上报。建议减少同一规则的两次解释；实例 recorded、同步交付期限和一次认领均有独立用途，不计入冗余。

**P1：播放实例归属与失败收尾分散，入口重复检查未覆盖异步交接。**

需求为 [#17](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/17)、[#20](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/20) 的操作/实例归属与资源交接。位置均在 [playback/index.js](../../src/playback/index.js)：

| 已确认范围 | 位置与证据 |
| --- | --- |
| 同步入口重复检查 | 276 的 event 已检查操作、当前实例和 released，295 同步调用唯一的 handleError 入口，373 再检查操作与当前实例；中间没有 await。由 `15a6fefa` 引入，属于局部重复。 |
| 已确认的实例归属缺陷 | 372–383 的起点检查实例，313–318 的异步完成只检查操作编号。双 playerror 的迟到恢复可替换同操作下已经成功的新实例，使位置从 7 回到 0；执行证据见生命周期补查。本项包含实际缺陷，不能只按重复检查处理。 |
| 失败收尾覆盖分散 | `c4ed48a` 新增 124–140 的 stopCurrent/failSelection，把 select、loadFM、runSelection 三处 catch 改为释放 current，由此引入 F3 的交接后附属失败扩大处理。F12 的内部耗尽仅 pause/publish 在该提交之前已有；此次只给外部 runSelection 补 unavailable 清理，保留了内外收尾不一致。 |

这里的维护负担是同一播放链需结合事件入口、异步完成、外层结果处理才能确定归属与释放范围。简化方向限于减少同一路径重复判断，并统一核查各失败路径的实际作用域；未制定新的状态模型或接口。

排除范围：各 await 后的 valid 检查承担过时结果防护；外部增加操作编号、内部沿用编号是明确要求。核心 released 与 adapter disposed 保护不同对象，准备失败时还未建立实例；stopCurrent 的两次检查之间有外部上报回调，需考虑重入。以上均不能按检查次数计为冗余。F14 另说明公开 playing 被用于判断尚未完成的播放请求存在缺口，公开播放状态本身仍必需。

**D4：媒体错误的跳歌、重新取源和提示条件跨层维护。**

位置：[audioAdapter.js](../../src/playback/audioAdapter.js):85–96 与 [playback/index.js](../../src/playback/index.js):353–383。adapter 用“非 3/4”生成 retryable；准备 catch 据此重新取源，并另外判断 3/4 跳歌、4 提示；后续 handleError 再维护同样的跳歌、提示及其他错误重新取源政策。后续分类来自 `15a6fefa`；`ab69926` 加入准备 catch 分类，`dfcb82d` 调整条件，`d1c543d` 再加入 retryable 交接。基线单个 loaderror 分支已有这套政策，新增问题是拆分后的多处维护。

这不只是重复数字：新增一种应跳歌的媒体错误，需要同时检查 adapter 的 retryable 排除条件、准备 catch 和后续 handleError；专门提示也需同步两处核心条件。[#17](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/17)、[#20](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/20) 要求播放模块决定失败策略，adapter 封装音频平台；策略分类现在分布在两层、三处。

确认范围仅为分类与政策维护分散，简化方向是减少同一政策的多处定义。准备期释放自身资源、后续错误校验有效实例是不同职责，不能合并计为冗余。retryable 还区分 Howler 媒体事件与构造、设备等普通异常，不能直接删除标记。应用接合的提示文案也有独立用途。本项承接 Q16 的结构核查，不新增功能缺陷。

**既有结构条目的需求与可执行建议**

| 条目 | 当前判断与需求 | 保留功能的简化建议 |
| --- | --- | --- |
| W1 | 历史问题，#8 已替换，不计入当前待修复项 | 无当前改动建议。 |
| I1 | [#32](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/32) 要求真实身份交接、失败后可重试；私有 mutation 交接还造成 F1 的确定缺陷 | 用有完成/失败出口的语义交接替换 `library/setUser` 字符串解锁。保留旧歌词失效；无需提前实现独立会话 spec #27。 |
| L1 | [#13](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/13)、[#15](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/15) 的完整加曲/删曲操作应共用结果解释规则 | 普通 add/remove 复用已有 `write()`，将各自更新任务作为内部参数；双阶段创建单独保留。 |
| L3 | [#14](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/14) 要求集合更新，无需新增无人读取的 `subscribed` 字段 | 删除正向 map 写入，保留取消收藏过滤、远端重读及详情真实字段更新。 |
| S1 | [#9](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/9) 要求完整设置完成承诺与选择性持久化 | 合并同次提交的保存检查与完成承诺，并保持保存成功后再发布镜像；具体顺序反例见 S1。不能仅删除 preferences 保存订阅。 |
| B1 | [#17](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/17) 要求在具体状态转换处选择保存与同步 | 区分展示变化与恢复字段变化，只在后者输出 archive。临时 FM loading 不触发存档处理；平台必要比较保留，不能整体删除去重。 |
| B2 | [#32](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/32) 要求统一歌词输出及平台顺序 | 平台内共用一个 metadata 更新函数，统一 key 与发布判断；保留取消旧握手、代次检查。歌词归属 key 本身有必要，宽通知只作独立优化。 |
| D1 | [#24](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/24) 要求显式恢复字段与独立进度，#17 要求 adapter 映射既有存储表示 | 减少核心旧格式编码与 adapter 字段选择的重叠，保留显式存储表示边界、旧档恢复和独立进度；同步核查 `_progress` 的跨层筛除，不预先指定删除哪层映射。 |
| D2 | [#1](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/1)、[#26](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/26) 要求规则归属与必要装配 | 删除 player 无生产调用的默认 reader；startup/search 共用同一身份投影，保留搜索退役所需字段，无需建立身份服务框架。 |

**当前确认问题**

F1–F19 记录功能缺陷；R1–R13 记录具体冗余、职责残留及已注明边界的优化候选。确认事实与尚待判断的简化范围分别见各项。各项标明源码确认或执行复现；模块复现使用当前生产代码及受控 I/O，未以旧测试通过作为结论依据。

**F1：账号资料失败后，歌词的身份等待永久不结束。**

- 位置：[session.js](../../src/store/modules/session.js) 76–84；[library.js](../../src/store/modules/library.js) 83–87；[player.js](../../src/application/player.js) 157–164；[lyrics/index.js](../../src/lyrics/index.js) 146–158、182–185。
- 需求：[#26 §6](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/26)、[#32 AC2/AC6](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/32)，真实身份交接、普通/云盘读取与当前消费者重试。
- 证据：登录先置 `identityPending=true` 并清空 track，仅 `library/setUser` 能解除等待；资料失败时无该 mutation。真实 createStore + createPlayer 的公开操作序列为 `playTracks([1]) → loginWithPassword（认证成功、资料请求失败）→ playTracks([2]) → lyrics.retry()`。初始 `{trackId:1, lyrics:'ready', calls:[1]}`，最终 `{hasAccount:true, trackId:2, lyrics:'idle', lyricTrackId:null, calls:[1]}`。另一组真实 session/library/lyrics 组合独立得到相同结果。
- 影响：新歌正常选中，普通歌词不再请求；页面仅在 failed 状态显示重试，idle 下没有恢复入口。这是 #26 新增等待协议的失败出口缺失。
- 建议：按 I1 的语义交接修复。普通歌词可用时继续读取；云盘缺少必要身份时表达可恢复状态，保留旧结果失效。此问题与 I1 共用根因，不重复计数。

**F2：同歌单迟到重读恢复了后来已确认删除的歌曲。**

- 位置：[playlistDetail.js](../../src/store/modules/playlistDetail.js) 56–80、176–177。
- 需求：[#13](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/13) 删除后的完整 ID、曲目、数量和分页一致；[#15](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/15) 加曲后按远端顺序恢复详情。
- 证据：执行原模块，初始 IDs `[1,2]`；`tracks-added` 启动挂起的 metadata 重读；随后 `tracks-removed([2])` 得到 `[1]`；先前重读返回 `[1,2,3]` 后，getter 恢复为 `[1,2,3]`。删除未使该读取的 generation 失效。
- 建议：详情所有者记录已确认修改的修订信息，拒收或合并早于修改的读取结果；同时保留远端顺序与原加载范围。单纯串行 library 写操作无法覆盖页面读取参与的情况。
- 验证：生产模块执行已复现；尚未通过浏览器构造同一响应顺序。

**F3：私人 FM 丢弃请求失败会卸载已经播放的新歌曲。**

- 位置：[playback/index.js](../../src/playback/index.js) 653–656、502–504、138–140、124–135。
- 需求：[#22](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/22) 的 FM 完整切换/丢弃；[#20](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/20) 的失败分类与正确音频资源释放。
- 证据：`advanceFM` 已交接曲目 2，随后 `personalFM.trash(1)` 拒绝进入通用选曲 catch，执行 `failSelection → stopCurrent`。真实核心复现得到 `result.status='failed'`、`currentTrackID=2`、`playing=false`、`sourceInfo=null`，两个音频 handle 均 disposed。
- 建议：分开“切换失败”与“丢弃写入失败”的处理，保留已成功交接的新音频，只反馈丢弃失败。无需新增一套选曲归属。

**F4：每日凭据刷新只比较日号，跨月同日跳过刷新。**

- 位置：[session.js](../../src/store/modules/session.js) 180–188。
- 需求：[#1](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/1) 将每日凭据刷新集中到会话 implementation 并由入口调用。
- 证据：`getDate()` 只保存 1–31。执行当前 refreshDaily，前次 2026-09-20、当前 2026-10-20、hasAccount=true，刷新调用次数为 0。
- 建议：使用完整本地日期键；沿用 data 字段，旧数字值读取后完成一次刷新再更新。属于遗留算法缺陷，不能计作重构新增行数。

**F5：切歌准备期间修改输出设备，最终新实例仍使用旧设备。**

- 位置：[audioAdapter.js](../../src/playback/audioAdapter.js) 55–58、108；[playback/index.js](../../src/playback/index.js) 330–338、717–718。
- 需求：[#10](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/10)、[#24](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/24)，设置更新后应用输出设备，并接入唯一 Playback。
- 证据：真实 adapter/core 组合，曲 1 使用 A；曲 2 准备时 `setSinkId(A)` 暂未完成；设置改为 B，等待 `applyOutputDevice()` 完成，再放行准备。结果设置为 B，已卸载曲 1 的 sink 为 B，当前曲 2 的 sink 仍为 A。交接只重新应用音量，未复核设备意图。
- 建议：在音频所有者内统一最新设备意图与交接检查，使新实例使用最终配置；设置页继续只调用完整操作。运行证据来自受控 Howl/URL 边界，实体设备待验证。

**F6：重读期间的旧分页结果推进新列表游标，造成本次详情后续分页无法补回的漏页。**

- 位置：[playlistDetail.js](../../src/store/modules/playlistDetail.js) 19–21、44–54、56–80、125；[playlist.vue](../../src/views/playlist.vue) 177–183、480–486。
- 需求：[#13](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/13) 的完整有序 ID、已遍历范围和分页一致；[#15](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/15) 添加后采用远端顺序恢复范围。
- 证据：初始 ID 1..205、已遍历 101。加曲重读 metadata 挂起期间，旧列表分页发出 `[102,103]`；metadata 返回新列表 `[999,1..205]`、首批 `[999]`，在同一 detail 对象改写 traversed；旧分页通过对象身份检查，将 2 加到新游标。继续全部分页后 `{traversed:206,hasMore:false,missing:[1,2]}`。真实模块执行已复现并独立重跑；无删除操作，区别于 F2；两项修复可能共用列表修订机制，不累计同一修复面积。
- 生产入口：加载更多只受 loadingMore 控制，重读开始又将其置 false；搜索扩展也会请求分页。
- 建议：metadata 与分页共用列表修订归属，重读期间分页等待新列表后计算 batch；旧批次不能推进新列表游标。职责留在 playlistDetail，避免页面另加协调。
- 引入依据：保留旧详情的分支来自 `9b1ba1ac`，按 batch 数量累加游标来自 `840bfcbc`；单独的保留与删除计算各有用途，缺陷在两者未共享读取归属。

**F7：有效旧随机存档被误判为坏顺序，恢复后跳过原本的下一首。**

- 位置：[playback/index.js](../../src/playback/index.js) 746、750–763；关键映射来自 `209322f5`。
- 需求：[#24](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/24) 明确恢复旧普通/随机队列及各自索引。
- 证据：有效旧档 `_list=[1,2,3]、_current=0、_shuffle=true、_shuffledList=[3,1,2]、_shuffledCurrent=0、_currentTrack.id=3`。旧 `810357e:src/utils/Player.js:156–167` 的 current setter 在随机模式只更新随机索引，普通索引可保留历史位置。当前 restore 却预占普通 index=0，导致匹配歌曲 1 时取得 -1，随后重新 shuffle。受控 random=.99 运行后顺序成为 `[1,2,3]`，upcoming 为 `[2,3]`，next 播放 2，原有效顺序的下一首应为 1。
- 对照：当前实现生成的唯一 ID 随机档 `_current=2` 可正确恢复；普通档也通过。这是旧格式合法索引组合的读取错误，非损坏存档恢复扩围。
- 建议：根据旧随机索引所在歌曲建立 occurrence 映射，不能先占用普通模式历史索引；保留完整随机顺序及独立索引。与 F8 一并收拢编解码。

**F8：新存档将随机条目身份降为歌曲 ID，重复歌曲恢复后指向错误位置。**

- 位置：[playback/index.js](../../src/playback/index.js) 731–732、751–760，均来自 `209322f5`；[playerStorage.js](../../src/application/playerStorage.js) 8–30 的重复白名单也影响修复。
- 需求：[#22](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/22) 的重复歌曲与准确队列身份；[#24](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/24) 的完整队列保存恢复。
- 证据：真实公开操作安装 `[1,2,1]`，选择 index=1 的歌曲 2，再启用 shuffle（random=.1）。待播为 `1@index2、1@index0`；archive 只存 `[2,1,1]`，restore 贪心匹配后变为 `1@index0、1@index2`。两边 next 再关闭 shuffle，原实例 upcoming 为空、next 返回 queue-ended；恢复实例 upcoming 为 `[2,1]`、next 又播放 2。当前实现自己的有效档也失败，独立于 F7 的旧格式问题。
- 建议：保留既有字段和旧 ID 档读取，通过可选 occurrence/版本信息无损扩展条目顺序；旧 ID 格式集中做确定性迁移。统一 codec 与 D1 的字段规则，避免新增字段又被 storage 白名单剔除。不要用另一份页面队列镜像补偿丢失的信息。
- 扩展验证：96 组唯一/重复 ID、随机/倒序/循环及主队列/插队/FM 组合中，48 组唯一 ID 全部保持，48 组重复 ID 中 12 组出现本根因差异；现有 16 个存档字段却全部 roundtrip 相等。FM 活跃时双方 upcoming 相同，退出 FM 后休眠主队列的重复条目顺序仍不同，因此必须保存完整主队列位置序列，不能只保存可见 upcoming。F7 的旧档随机锚点也应从随机列表与索引解码，不能依赖可能属于插队/FM 的 currentTrack。

**F9：歌单删除曲目的提示忽略同步失败，重复实现不完整的结果解释。**

- 位置：[TrackList.vue](../../src/components/TrackList.vue) 232–245；[libraryOutcome.js](../../src/utils/libraryOutcome.js) 11–18。局部分支由 `840bfcbc` 引入。
- 需求：[#8](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/8)、[#13](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/13) 将远端写入和后续更新分别表达，由调用者消费业务结果。
- 证据：handler 只读 outcome；`succeeded + incomplete` 仍只显示“已从歌单删除”，丢弃更新失败信息。相邻云盘删除、其他收藏页面已共用包含 incomplete 分支的反馈函数。本项为源码确定的提示遗漏，尚未构造浏览器远端成功/同步失败响应。
- 建议：删除局部条件，使用现有 `showLibraryChangeFeedback` 并传入删除成功文案，保留成功事实及同步警告。

**F10：公开用户名搜索无结果时访问 undefined，导致页面渲染错误。既存缺陷。**

- 位置：[loginUsername.vue](../../src/views/loginUsername.vue) 20、23、31、46、80–82。
- 需求：[#1](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/1)、[#5](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/5) 保留公开音乐库身份选择入口，页面负责输入与展示。
- 证据：合法空数组使 activeUser 变成 undefined，模板直接读 nickname。Codex 内置浏览器在 `/login/username` 搜索 `ypm-audit-no-user-20261020-7f48b3`，出现 LoginUsername 的 `Error in render: TypeError ... reading 'nickname'`，界面停留旧搜索提示。
- 建议：空结果下使用明确的未选择状态，并让模板安全读取或显示无匹配提示；无须新增请求失败体系。该段在 `01f2de1` 已存在，不能计作四阶段新增错误增长。

**F11：喜欢歌单菜单把 MouseEvent 当作起始歌曲，破坏未指定起点的随机播放。**

- 位置：[library.vue](../../src/views/library.vue) 204、351–355；[playback/index.js](../../src/playback/index.js) 474–480。
- 需求：[#28](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/28) 全调用者迁移、页面显式传递播放意图；[#21](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/21) 保留来源起点与随机规则。
- 证据：playLikedSongs 为歌曲行新增 startTrackId 参数，既有 `@click="playLikedSongs"` 会自动传入 MouseEvent。该对象非 null、无法在 ID 数组命中，Playback 将 index 置 0 并把随机首位锚定于第一首。真实页面方法与 Playback/sourceOperations 组合（已开启随机模式，只替换 I/O，random=0）对 `[1,2,3]` 源，无参数时播放 2，传点击事件时播放 1。
- 建议：菜单显式调用 `playLikedSongs()`；歌曲行继续传 track.id。无需在 Playback 增加识别 DOM 事件的兼容分支。

**F12：自然结束后的失败跳歌耗尽时，旧音频仍可被重新播放，声音与当前曲目不一致。**

- 位置：[playback/index.js](../../src/playback/index.js) 203–217、249–259、287–293、491–499、583–584；自然结束的内部 advance 路径来自 `209322f5`。
- 需求：[#20](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/20)、[#22](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/22) 的自然结束、失败跳歌、正确资源交接及公开播放控制。
- 证据：真实核心安装 `[1,2,3]`，仅曲 1 有音源并播放成功。曲 1 onEnd 后，曲 2/3 均无源，内部 advance 耗尽。此时 `{currentTrackID:3,playing:false,sourceInfo:null,disposeCount:0}`；操作已结束后调用公开 play，音频 handle 1 再次播放，结果 `{currentTrackID:3,playing:true,sounds:[1,1]}`。独立重跑同样复现。
- 原因：外部 runSelection 在 unavailable 时有旧实例收尾；自然结束直接调用 advance，耗尽分支仅 pause/publish，保留了已与公开曲目不匹配的 current。
- 建议：失败遍历的终止路径统一清理或明确恢复当前音频与状态归属，避免对已失配实例继续暴露 play。仅清理失配实例，保留正常到达队尾后重播当前歌曲的能力；保留外部选曲和内部自动跳歌的同一操作编号，无需新增选择队列。
- 对照：外部 playTracks 请求全无源时，off/on 模式均正确释放旧实例；缺陷限定于内部自然结束后的失败遍历，不扩写为所有取源失败。

**F13：代理恢复失败中断无关桌面初始化。**

- 位置：[background.js](../../src/background.js) 352–393；[electron/proxy.js](../../src/electron/proxy.js) 1–7。无条件 await 来自 `39d69dc7`。
- 需求：[#8](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/8)、[#11](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/11) 恢复已保存代理并共用应用规则；菜单、快捷键、Touch Bar、MPRIS 保留各自平台能力。
- 判定依据：拒绝条件下的启动阻断已确认；隔离无关初始化是职责分析得出的修复建议，#11 未明文指定代理恢复失败政策。
- 证据：执行真实 handleAppEvents 的 ready 回调与 restoreProxy，仅替换宿主 I/O。成功顺序为 window/window-events/ipc/updates/tray-theme/shortcuts-and-menu/dock-menu/touchbar/mpris；setProxy 拒绝后只出现 window/window-events/ipc，后续均未执行。async ready 监听没有该步骤的错误收尾。
- 建议：代理恢复在本步骤报告失败并收尾，让无关平台初始化继续；不增加重试框架，也不把整个 ready 包成失败后直接结束。共用代理函数本身是必要职责，问题是装配新增的成功依赖。
- 验证边界：已证明拒绝条件下的生产控制流；真实 Electron 中可触发的 setProxy 拒绝条件和界面表现尚待验证。

**F14：异步 play 事件到达前重复 Play，会在同一 Howl 建立两个活跃声音。**

- 位置：[playback/index.js](../../src/playback/index.js) 278–283、583–585；[audioAdapter.js](../../src/playback/audioAdapter.js) 40–42。
- 需求：[#34](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/34) 明确要求重复 Play/Pause 幂等；[#20](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/20) 的唯一有效播放实例。
- 证据：真实 Playback、audioAdapter 与当前安装 Howler，只有 HTMLAudioElement 边界受控。await restore 完成后，在暂停的已准备实例上连续调用 play 两次；Howler 的 play 事件异步投递，state.playing 尚为 false，两次调用均进入无 soundId 的 howl.play()。结果同一 Howl 内 id1001/id1002 两个 sound 均 paused=false、ended=false，公开状态只显示一个 playing=true。
- 建议：音频 adapter 持有单一 soundId 或已发出的播放请求状态，重复 Play 作用于同一个声音；实际 playing 仍由音频事件确认，避免提前伪造成功状态。已证明双活跃声音，尚未以真实输出设备验证可听混音。
- 修复约束：若采用请求标志，暂停、失败、结束和释放均须正确收尾，不能阻止后续正常重播。底层组合由 #17 引入，#34 是继续验收该幂等性的需求来源。
- 下游影响：真实 Howler 组合中令 sound 1001 结束、1002 仍处于 7 秒，核心将共享实例按 249 秒完成记录，切至下一曲并卸载整个旧 Howl。多个声音共享一个实例和记录标志，错误会继续传播到结束与上报，未另计一个缺陷。
- 范围：复现时没有选曲在途，属于已准备实例的重复明确命令，不涉及 spec 排除的加载期间新意图管理。

**F15：切歌后保留已不可用的音译选择，译文显示入口被隐藏。**

- 位置：[lyrics.vue](../../src/views/lyrics.vue) 334、382–388、550–552；`5fbd2eb1` 迁出 getLyric 时删除了读取完成后的显示类型更新。
- 需求：[#32](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/32) 的统一翻译/音译输出与页面显示职责。共享内容已有译文，但页面没有可达显示入口。
- 证据：真实 createLyrics、lyricParser 和页面原 computed/method 组合中，歌曲 A 有译文和音译，用户切到音译；切到仅有译文的 B 后，lyricType 仍为 romaPronunciation，切换按钮条件为 false，显示仅有原文，而 translation 投影包含原文和译文。独立执行得到相同结果；尚未进行浏览器 DOM 复核。
- 原因：切换按钮只在两种附加内容都存在时显示，当前选择却不随内容可用性校正。迁出远端编排时漏保留了这项页面显示职责。
- 建议：页面集中选择可用投影；用户选择有效时保留，失效时采用另一种已有内容。共享所有者继续提供两类投影，不恢复页面取词、对齐或计时。
- 边界：默认 translation 遇到仅有音译时也无法切换，但该对称缺口在基线已存在；本项新增回归仅指从 A 的音译选择切到 B 的译文后无法显示。

**F16：Electron 的 Last.fm 授权 URL 未编码 callback，回调路由落入外层 fragment。**

- 位置：[api/lastfm.js](../../src/api/lastfm.js) 25–27；[background.js](../../src/background.js) 289–306 原样加载授权 URL。
- 需求：[#33](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/33) 的完整授权操作与设置/回调页面接合。
- 证据：执行真实 auth 捕获 window.open 参数，并用 URL 解析。在 origin 为 `http://localhost:8080` 时，Web 的 cb 为 `/lastfm/callback`；Electron 的 cb 只有站点根路径，`#/lastfm/callback` 成为 Last.fm 授权 URL 自身的 fragment。独立重跑得到相同结果，传给服务的 cb 已缺少应用回调路由。
- 建议：用 URL/searchParams 编码完整 hash callback，保持当前 origin，再让页面从实际返回位置读取 token；继续调用既有授权 action，不增加交换监听或状态副本。
- 修复约束：真实 router 与回调 created 组合中，`/?token=sample#/lastfm/callback` 能读取 token；`/#/lastfm/callback?token=sample` 虽匹配同一页面，token 位于 route.query，当前只读 window.location.search 会报无 Token。Electron 静态服务没有该 history 路径回退，不能直接改成 Web callback 路径。编码与 token 承接须一起验证，外部服务最终返回形式尚未确认。
- 归因与边界：该 URL 构造在四阶段之前已存在，是当前完整授权路径上的遗留缺陷，未计为重构新增复杂度。实际 Last.fm 授权往返尚未验证。

**F17：队列菜单打开后条目前移，删除操作使用旧展示下标选择新条目。**

- 位置：[TrackList.vue](../../src/components/TrackList.vue) 188–190、257–259；[next.vue](../../src/views/next.vue) 51–68。
- 需求：[#22](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/22)、[#28](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/28) 的准确队列操作与重复歌曲出现位置语义。
- 证据：真实 Playback、TrackList 原菜单方法、next 全部 computed 组合中，插队 `[1,2,3]` 打开第二行 2 的菜单，当前歌自然结束并取走 1 后，点击删除实际移除 3；重复 `[1,1,2]` 选择第二个 1 后同样误删 2。清空后加入新条目也会被旧菜单删除。
- 原因：打开时只保存展示 index，执行时用它读取已经更新的 rowIdentities。只有静止队列下该 index 才仍对应所选条目。
- 建议：队列改变导致选中身份失效时关闭菜单或拒绝操作；若引入稳定条目标识，由 Playback 统一拥有。仅捕获旧 group/index 或核对歌曲 ID 都不足以处理重复条目与位置前移。
- 修复反例：真实 Vue/Playback 中，同栈清空并重建相同队列不会触发异步值监听；101 个相同 ID 删除首项，upcoming(100) 连值也不变；监听整个 state 又会因普通进度 tick 误关菜单。较小方案是完整插队队列的修改版本，覆盖 shift/splice/enqueue/remove/clear/restore，执行删除时同步核对。无需逐条稳定 ID 系统；普通音量、进度不递增该版本。按全部插队修改失效会保守关闭仍可用的菜单，但避免增加位置迁移规则。
- 归因与边界：基线已有按旧下标删除的风险，#17/#26 的身份迁移未消除；本项由 Q12 升级，未算新增根因。内置浏览器已建立重复队列并打开第二行菜单，但尾段播放未形成所需队列前移，未完成实际误删复核；临时队列已清理。确认结论来自上述生产组合执行。

**F18：写操作的完成回调作用于已被替换的页面对象或弹窗展示。**

- 需求：[#14](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/14)、[#15](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/15) 的完整写操作与对应页面结果交接。远端目标正确，错误发生在结果应用到展示时。
- 艺人路径：[artist.vue](../../src/views/artist.vue) 214–217、281–283、322–330。真实 SFC/Vuex/library 组合中，艺人 101 的收藏挂起，经原 beforeRouteUpdate/loadData 载入未收藏的 202，再放行旧成功结果；唯一远端写入是 `{id:101,t:1}`，当前 202.followed 却变为 true。await 后写 `this.artist`，没有核对它是否仍是提交对象。
- 弹窗路径：[ModalAddTrackToPlaylist.vue](../../src/components/ModalAddTrackToPlaylist.vue) 76–95。曲目 1 加到歌单 55 挂起，关闭后为曲目 2 重开弹窗，旧成功结果关闭新弹窗。请求仍正确提交曲目 1；无条件 close 操作的是当前展示批次。
- 专辑路径：[album.vue](../../src/views/album.vue) 174–177、242–249、277–296。原 loadData(101) 后收藏挂起，原路由更新钩子载入 202；101 成功后 202.isSub 从 false 变为 true。替换发生于原读取方法消费受控 API 响应，未直接替换页面业务状态。
- 创建路径：[ModalNewPlaylist.vue](../../src/components/ModalNewPlaylist.vue) 71–89。提交 First draft 后关闭并重开，输入 Second draft/private=true；旧创建成功使新弹窗 show=false、title=''、private=false。执行使用原 SFC 方法及根 updateModal mutation。
- 导航路径：[playlist.vue](../../src/views/playlist.vue) 468–473。删除 101 挂起，真实 VueRouter abstract history 从 /home→/playlist/101→/playlist/202，载入 202 后旧删除成功执行 go(-1)，导航退回 101。未挂载 router-view，此样本仅确认旧回调改变当前导航。
- 建议：实体页核对发起路由及目标展示归属。album.vue:277–296 分别读取 album 与 dynamicDetail；202 的 dynamicDetail 先返回、album.id 仍为 101 时，旧 101 成功结果可通过单独的实体 ID 检查，继续污染 202 展示。仅核对实体 ID 不足；严格引用相等也需保留同实体同路由重读后的合法成功。弹窗按展示批次约束关闭/清理，导航核对发起路由。批次需覆盖外部 updateModal，且同步捕获关闭重开；真实 Vue 同栈 false→true 对照中普通 watcher 计数 0、同步 watcher 计数 2。仅比较歌曲 ID 无法区分同曲重开。
- 修复约束：不能每次提交都提升全局代次。同对象两次请求、后请求拒绝而先请求成功时，latest-only 会丢弃合法成功；同展示的独立写入也应各自完成反馈及 library 同步。归属检查只约束当前展示效果。
- 归因与边界：五条路径均在 `01f2de1` 已存在，重构保留了该结果归属缺口，未算新增复杂度。确认来自生产模块与原页面方法组合，浏览器交互待复核；MV 收藏仅有类似源码形状，未执行确认。
- 正向对照：新建歌单当前在 await 前捕获待加曲目，已消除基线创建完成后再读取可变选择的错加风险。TrackList 普通远端写入在 await 后只反馈，没有重新选择远端目标。

**F19：相同身份的资料刷新触发搜索失效，清空合法结果并关闭分页。**

- 位置：[application/musicSearch.js](../../src/application/musicSearch.js) 4–9、14–17；[query.js](../../src/musicSearch/query.js) 43–47；[library.js](../../src/store/modules/library.js) 83–87、194–195。
- 需求：[#30](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/30) 的真实身份接合、查询结果与分页。没有身份字段变化的资料重读不应退役当前合法歌曲结果。
- 证据：真实 store/library/搜索装配组合中，查询先得到 tracks=[1]、hasMore=true；loadApplication 返回同样 userId=42、vipType=11，结果变为 []、hasMore=false，loadNext 无操作。独立使用真实 Vue/Vuex 与原搜索装配/query、同值 setUser 再次复现。
- 原因：getIdentity 每次创建对象，deep/sync watcher 在资料引用更换时无条件通知 changed；查询收到通知便清空，不比较 mode/hasAccount/userId/vipType 是否实际改变。身份 JSON 指纹相同也不能阻止这条通知。该 watcher 由 #26 的 `b255fe5f` 引入；同场对照中身份过渡广播与稳定指纹 watcher 均为 0 次，只有对象型 deep watcher 触发。
- 可达链：App.created 发起 loadApplication，异步 userAccount 完成后提交新 profile 对象；期间搜索页面可完成查询。音乐库 loadPage 也复用该资料读取链。
- 建议：监听稳定身份字段指纹，仅在字段值改变时通知；保留独立身份过渡开始信号，使真实交接期间的旧请求失效。无需新增身份副本或引入 #27 全部会话机制。
- 修复对照：真实 query/Vue 组合改用稳定 JSON 指纹后，同值资料保留结果和分页；显式过渡开始仍丢弃挂起旧结果，vipType 真变化仍清空。开始通知与字段变化之间可能产生新查询，不能为了只失效一次而合并两个时点。
- 横向边界：真实 store/player/library/daily/lyrics 组合中，同值 profile 重载后歌词代次/请求保持 2/1，daily 保持 loaded/请求 1；预览的一次请求来自显式 loadApplication 自身。vipType 改变后歌词代次/请求变为 3/2。仅 musicSearch 使用对象型 deep watcher；metadata 按调用取身份，没有同类监听。F19 不扩为所有身份消费者缺陷。
- 关联边界：与 F1 的私有 mutation 解锁不同。认证后资料失败时，daily 可重新 load、search 可重新 replace；只有 lyrics 挂在 identityPending。公开身份选择和 logout 均有 setUser 完成交接，未复现相同挂起。

**已确认问题的机制关联**

| 机制 | 证据关系与调查边界 |
| --- | --- |
| 操作选择与完成时的对象脱节 | F17 是位置身份随队列变化失效，F18 是实体/展示批次被替换；均需在结果应用处核对原操作对象。菜单版本不能靠截断展示数组判断，页面也不能用一个全局代次取消所有独立写入。 |
| 播放实例的阶段边界不完整 | F3 把交接后的附属操作失败当作整体失败，F12 内部失败遍历漏收尾，F14 一个 handle 包含多个声音却共享结束/记录身份。修复应分别限定失败作用域、统一终结收尾、绑定实际声音，而非再增加一套播放器状态镜像。 |
| 持久化、镜像与平台效果的顺序 | S1 的重复保存不能只删入口，F13 的代理失败也不应阻断无业务依赖的初始化；Q14 已执行证实存储失败阻断同回调的歌词/平台输出，但降级契约待定。必须按具体契约判断依赖，不能把所有串行失败都当缺陷。 |
| 身份过渡通知与消费者终止 | I1/F1 的等待由私有 mutation 解锁，F19 则把资料引用变化当身份变化。daily/search 的失败后重读可用，未继承歌词挂起；应统一身份变化含义，同时保留各消费者不同的终止行为。 |

| 编号 | 问题与代码位置 | 对应需求、证据 | 简化建议 |
| --- | --- | --- | --- |
| R1 | 喜欢歌曲通知保留无效注入；[library.js](../../src/store/modules/library.js) 10、14 | [#4](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/4)、[#7](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/7) 要求连接桌面同步并删旧接口。main.js:74 只注入 api；通知始终是默认空函数，实际同步来自 application/player.js:157–164 | 删除参数及调用，保留真实订阅同步。 |
| R2 | 无生产消费者的二维码 endpoint；[auth.js](../../src/api/auth.js) 54–71 | [#5](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/5)、[#7](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/7)。全生产源码 `loginQrCodeCreate` 仅有定义；session:34–36 构造 URL，loginAccount:155–161 渲染图像 | 删除旧导出与说明，保留 key/check 和页面渲染。 |
| R3 | library 仍持有读取失败文案和展示效果；[library.js](../../src/store/modules/library.js) 77–80、88–105 | [#14](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/14) 写明 library 不调用 toast。reportBackground 在后台读取链直接 dispatch 根 showToast，固定“音乐库部分内容加载失败”；写操作已通过业务结果交接展示。本项记录读路径职责残留，不扩为写入调用者迁移遗漏 | 把读取失败交给应用接合处提示，保留必要后台请求；无需新增分区任务框架。 |
| R4 | 未超容量也全量读取音频缓存；[audioCache/index.js](../../src/audioCache/index.js) 22–30、58–72 | [#19](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/19) 要求事务内准确统计与按时间淘汰。已知 total.bytes，仍先 `orderBy(...).toArray()` 物化包含音频 ArrayBuffer 的全部记录，再检查容量 | 未超限立即返回；超限按索引逐条读取并及时终止，保留事务和成功后统计更新。实际内存峰值尚未测量。 |
| R5 | 待播页保留无界歌曲缓存，并新增已加载 ID 的读取过滤；[next.vue](../../src/views/next.vue) 39–42、85–96；[App.vue](../../src/App.vue) 10–12 | [#18](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/18)、[#22](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/22)。upcoming(100) 有界，页面 tracks 只追加且 keep-alive。无界累积在基线已有；`209322f` 新增请求前 loaded ID 过滤，使曾见 ID 不再进入统一读取及后台刷新。两项不能整体计为新增 | 核查超出当前展示窗口的数据保留与统一缓存的重复职责。需求未明确要求每次激活刷新或禁止页面缓存；不把缓存存在本身判为违反需求，用户可见旧权限另见 Q3。 |
| R6 | 设置页保留部分重复默认值；[settings.vue](../../src/views/settings.vue) 940、949、966、976、1002、1013、1025、1037、1125 | [#9](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/9) 要求默认值集中。persistence:20–25 已补齐 undefined，页面仍兜底，自动缓存页面 false 与集中 true 不一致。回退在基线已有，属于集中化后的旧职责残留。生产合并规则保留显式 null，因此 966 的 musicQuality null 回退仍有效，其政策待确认 | 仅将已补齐的 undefined 分支计入冗余；暂不删除 musicQuality 的 null 回退。保留设备可用性判断与输入字符串转换。 |
| R7 | 快捷键控制 IPC 携带无人读取的深克隆数组；[preferences.js](../../src/store/modules/preferences.js) 24；[preferenceEffects.js](../../src/application/preferenceEffects.js) 27–28 | [#12](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/12)。electron/preferences:5–8 只读 enabled/recording；menu:9、globalShortcut:11 从已有镜像读取 shortcuts，无 control.shortcuts 消费者 | 删除控制消息中的 shortcuts 克隆，按键内容继续从设置镜像读取。 |
| R8 | Last.fm storage adapter 重复创建后被覆盖；[store/index.js](../../src/store/index.js) 14、27、34、48–52 | [#33](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/33)。唯一生产 main.js:58–61 已传入 createLastfmOptions 的 storage/exchange，store 仍新建 storage 和空 exchange 后由展开覆盖；#26 新增装配 | store 直接使用已注入的 lastfm 依赖，删除被覆盖的默认构造。收益仅少量代码，保留真实 adapter 和授权所有者。 |
| R9 | 迁移后保留无消费者映射；[Navbar.vue](../../src/components/Navbar.vue) 111；[Player.vue](../../src/components/Player.vue) 205–206；[settings.vue](../../src/views/settings.vue) 853、855；[album.vue](../../src/views/album.vue) 199–200 | [#7](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/7) 的残留接口清理。身份迁移新增 Navbar/Settings 的 likedSongPlaylistID、Player/Album 的 user/likedSongPlaylistID，均无读取；Settings 的 player 在 #8 设备操作迁出后失去消费者 | 删除六个身份 getter 映射及 Settings 的 player 映射，清理随之无用的 mapState/mapGetters import。收益小；Album 的 player 死映射在基线已存在，单独作为历史清理，不算新增。 |
| R10 | 一次 seek 经两路 IPC 重复发出 MPRIS Seeked；[playbackPlatform.js](../../src/application/playbackPlatform.js) 261–264；[mpris.js](../../src/electron/mpris.js) 60–71 | [#24](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/24) 的明确平台输出。真实 Playback/platform/MPRIS 组合执行 seek(42)，两条 IPC 各调用一次 player.seeked，实际参数为 `[42000000,42000000]`；双路交接由 `2f4a4ec7` 引入 | 单次 seek 只走一条系统 Seeked 发布，继续维护位置读取。属于确定重复机制，尚无客户端故障证据。 |
| R11 | 启动凭据恢复读取重复；[session.js](../../src/store/modules/session.js) 93、131–135；[main.js](../../src/main.js) 80 | [#2](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/2) 的显式初始化。state 构造已读取 MUSIC_U，唯一 restore 调用在播放器建立前再次读取；两次间仅有同步配置，无必要异步或认证边界。真实启动组合中四类身份均读取两次，第二次 settings/data 写入为零 | 保留显式 restore 及启动调用，构造 hasCredential 以 false 初始化，删除构造时的凭据读取表达式；无需引入待验证授权状态。收益小，未发现首次身份矛盾，不能将本项描述为重复落盘。 |
| R12 | 代理运行时关闭条件局部重复；[preferences.js](../../src/store/modules/preferences.js) 168–170；[proxy.js](../../src/electron/proxy.js) 11–14 | [#11](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/11)。唯一运行时发送链已把空 server/port 规范为 noProxy，接收端又检查这两项；两处同由 `39d69dc` 引入。启动 restoreProxy 直接读取规则字符串并调用 applyProxyRules，绕过该 handler，不能解释这两项复判 | 减少运行时同一空配置条件的重复解释。范围仅 server/port 两项，优先级低；保留 noProxy 到规则字符串、启动空字符串到平台配置的转换及两种存储表示。未发现功能错误。 |
| R13 | 艺人访客路径重复补歌曲详情；[api/artist.js](../../src/api/artist.js):20–26、[artist.vue](../../src/views/artist.vue):281–283、302–305 | API 访客分支已补详情，页面只取 ID 再调用同一入口。原 SFC/API/metadataCache/common/Dexie 组合中，冷缓存访客详情请求两次、账号一次；访客二读展示字段相同，额外一次为后台刷新。两层补全在 `01f2de1` 已有，属低优先级遗留，未计入新增增长。#18 要求各次读取独立，单次缓存读取仍履约 | 减少访客同一链路的重复补全；账号 API 仅转换 hotSongs，页面详情读取实际补时长、封面与权限，不能整体删除。不引入跨调用共享请求；同值样本限于身份稳定、两读之间缓存未变化。每次转换重新取身份，身份变化也会改变 playable/reason。 |

**待验证与范围待确认事项**

| 编号 | 疑点、代码位置与已有证据 | 尚缺证据及下一步 |
| --- | --- | --- |
| Q1 | [audioAdapter.js](../../src/playback/audioAdapter.js):108、115–117 把设备设置失败归入音频准备失败。受控 NotFoundError 已复现新旧音频都卸载；settings.vue:985–993 只显示 default，保存值仍旧 | 需用真实失联设备验证持续失败及浏览器 fallback；#17 保留设备应用规则，但具体失败回退目标需明确。建议独立反馈设备失败，避免默认将其等同于解码失败；暂不以旧 Player 实现作为回退政策依据。 |
| Q3 | [next.vue](../../src/views/next.vue):85–96 长期缓存可能保留旧身份下的 playable/reason；R5 已确认无界保存 | 需浏览器验证访客切换账号后同曲目的实际显示，尚未证明用户可见错误。 |
| Q5 | 密码登录成功后等待 library 加载，加载失败可能进入账号密码错误提示；QR 初始 key 非 200 无后续轮询 | #1 明确排除失败恢复体验，需与后续会话 spec 区分。仅记录范围疑点，不作为四个 spec 的确定缺陷。 |
| Q6 | [preferences.js](../../src/store/modules/preferences.js):152–156 恢复默认快捷键整体替换数组，执行样本中已有条目扩展字段被删除 | [#9](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/9) 要求嵌套扩展保留，[#12](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/12) 要求恢复默认值；需界定重置是否仅覆盖已知按键字段，再决定按 ID 合并。 |
| Q7 | [lastfmExchange.js](../../src/application/lastfmExchange.js):12–21 中 storage.read 抛错逸出，受控执行后 timer 仍为 1，直到 stop/销毁才释放 | [#33](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/33) 未明确存储失败是否结束交换；若定义为结束，应在 check 捕获并停止，避免重复异常。存储故障降级范围待界定。 |
| Q8 | [credentials.js](../../src/application/credentials.js):13–18 只按 `;;` 拆 cookie；当前安装 API 登录/QR/refresh 模块使用 cookie.join(';') | 安装 API 的 util/request:316–318 只移除 Domain，不补尾分号。真实 request→login_cellphone→adapter 组合中，虚构 cookie 结尾为 HttpOnly 时仅保存 __csrf，结尾为 HttpOnly; 时两项均保存。API 没有保证双分号；实际成功认证响应的无敏感格式仍待确认，再决定升级。勿扩大为登录尝试隔离。 |
| Q9 | [track.js](../../src/api/track.js):53–58、[db.js](../../src/utils/db.js):87–96、[common.js](../../src/utils/common.js):39 对缺失 privilege 的缓存转换不一致；关键缺项入数组及读取 item.id 在基线已存在 | 输入 songs=[{id:987,fee:0}]、privileges=[]，首次成功，下一次缓存命中形成 [undefined] 并在读取 id 时抛错，后台刷新未启动。受支持响应是否允许缺项尚未证明；确认后统一过滤/处理缺项，不新增通用损坏恢复，也不计为四阶段新增缺陷。 |
| Q10 | [MvRow.vue](../../src/components/MvRow.vue):47–53 默认 autoplay 从父页面可选播放器改为全局音乐 playing | 去掉父级耦合有需求，但搜索等普通 MV 入口新增的默认自动播放政策尚无明确目标依据。需确认入口策略并在浏览器验证；暂不按旧行为判回归，也不把该默认变化直接视为必要迁移。 |
| Q11 | [playback/index.js](../../src/playback/index.js):109–113、213–217、583–585 正常单曲队列结束后公开 play 复用已 recorded 的实例 | 真实核心/reporting 连续完整播放两次，仅第一次有网易云/Last.fm 记录，Now Playing 两次。#23 明确自然结束后切歌去重，但未单列队尾重播的实例语义；需界定该重播是否应构成新的记录单位，再决定重置或重建。与 F12 的失败耗尽路径不同。 |
| Q14 | [application/player.js](../../src/application/player.js):131–141 的存储失败跳过同接收函数内歌词及平台输出 | 真实 createPlayer/Playback/storage/lyrics/reporting 组合中，player 保存抛错后播放仍 completed、dispose=0，但歌词 trackId=null，平台仅有初始曲目 0；仅进度保存抛错时核心 seek 到 7，歌词仍在第一行且平台无 progress=7。核心 safe 保护整个接收函数，未隔离其内部职责。机制已证实；#24 的存储失败降级契约待确认，不新增功能缺陷编号。若各输出应独立，在应用接合分别处理失败。 |
| Q15 | [dailyRecommendations.js](../../src/store/modules/dailyRecommendations.js):30–32 的 loaded 快照保留旧 VIP 可播放结果；[App.vue](../../src/App.vue):79–82、101–104 与 [api/playlist.js](../../src/api/playlist.js):201–215 | 真实 store/请求/转换组合中，启动每日读取先于 profile 返回；同 uid42 从 vip0 更新至 vip11 后，fee1/pl0 曲目的已存 playable=false，实时规则为 true，再次 load 不重读。相同 VIP 对照正确；正常登录、公开身份切换、退出均先 reset。[#31](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/31) 要求身份切换清理与已加载快照复用，VIP 更新是否要求即时重算尚未明确，暂不列为缺陷，也不据此要求每次 profile 重读清空推荐。 |
| Q16 | 媒体错误分类分散的结构核查已转 D4；[playback/index.js](../../src/playback/index.js):361 的 3/4 判断还覆盖整个 select try | 核心 catch 同时接收资料、取源、构造及音频准备拒绝，3/4 判断未限制来源。这里保留分类作用范围疑点，尚无非媒体生产错误实际携带此 code 的可达证据，不升级为功能缺陷，也不与 D4 重复计数。 |
| Q17 | UNM 的 url 字段由两端按不同条件解释；[ipcMain.js](../../src/electron/ipcMain.js):169–170 与 [audioResources.js](../../src/playback/audioResources.js):39、42、48 | 主进程按 bilivideo.com 域名将 url 改为 base64，资源侧按 source=bilibili 解码。本地 rust-napi 0.4.0 只声明 source/url，包装层未保证两判据等价。真实两端配受控 UNM/HTTP，bilibili 字节及普通 URL 对照均通过。确认隐含表示约定跨层维护；暂无真实引擎反例，不判功能错误。两端规则由旧实现迁入，不计为新策略增长；继续核查协议保证，不能仅因转换两次就认定冗余。 |
| Q13 | [playbackPlatform.js](../../src/application/playbackPlatform.js):238–251；[mpris.js](../../src/electron/mpris.js):32–57 在最终无有效音频时保留旧系统元数据 | 真实组合中曲 1 成功后曲 2 取源失败，旧实例已释放，当前 ID=2/sourceInfo=null/playing=false，但 Web/MPRIS 仍显示曲 1、状态 Paused。#24 未规定应显示最后播放曲目还是空状态；先明确政策，不能对所有 sourceInfo=null 一概清空。 |

**已核查的非问题与必要职责**

- F3 横查：普通预取、onStateChange 和真实 reporting 请求分别同步抛错/异步拒绝，以及 FM 后台补充/预取拒绝，八组均 completed、当前曲保持 playing、dispose=0，FM loading 正常清除。未复现附属失败卸载；F3 限定为 trash 拒绝进入 runSelection.catch。接收函数内部的输出串联另见 Q14。
- Q2 的“暂停态当前曲目行显示无效播放按钮”未成立。内置浏览器在 /next 点击当前行后，DOM 中 `.play-track` 的 display 为 none；TrackListItem.vue:190–194 按当前 ID 高亮，暂停状态也隐藏该按钮。无 activate 接收者是事实，但缺少要求该展示行重新激活的明确目标，当前不列功能缺陷。
- Q4 在所列失败/删除样本中未复现，关闭该具体疑点：失败时 traversed=1、tracks=102，继续分页最终 206 首唯一、missing=[]。同样核对分页期间删除前缀与批次内曲目，游标正确。另行发现的 F6 是 metadata 更新与旧分页交错，根因不同。

**逐 ticket 覆盖记录**

“源码已核查”表示读过对应生产职责与调用链；运行证据仅覆盖明列场景。未据此判定整个 ticket 通过。测试源码不纳入审查。

| Spec / ticket | 已核查生产范围 | 发现与剩余验证 |
| --- | --- | --- |
| #1 / [#2](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/2) | main/startup/store 的设置、locale、请求、播放器与恢复顺序；注册不发请求 | 真实启动组合确认 locale、request、musicData 均在播放器首次请求前接线，四类身份恢复前后一致；R11 为重复恢复。Web 开发服务可启动；Electron 启动待运行。 |
| #1 / [#3](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/3) | session/library/preferences 字段、getters、路由、data/settings 合并 | F4、S1、D2；已执行旧设置/身份样本，见下方验证边界。 |
| #1 / [#4](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/4) | loadApplication/loadPage 共用编排、歌单/预览依赖、喜欢同步 | R1、R3、L4；收藏写入见 #8。 |
| #1 / [#5](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/5) | 密码、QR key/check/stop、公开身份、凭据 adapter、页面生命周期 | R2、F10；用户名空结果已在浏览器复现，真实登录/退出/QR 生命周期待验证。 |
| #1 / [#6](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/6) | logout/invalidate 共用清理、request 301 信号、sessionEffects、路由 | 源码未发现额外确定问题；真实请求失效待验证。 |
| #1 / [#7](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/7) | 旧鉴权入口、身份判断、残留导出与装配检索 | R1/R2/R9；完整运行验收未完成。 |
| #8 / [#9](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/9) | 完整设置、动态字段、默认/迁移、投影保存与启动 | S1、R6；S2 按 #26 保留；旧档、动态嵌套与选择性写回样本通过，Q6 待界定。 |
| #8 / [#10](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/10) | 音质、设备、缓存、倒放与 applyRestored 差异 | F5、Q1；实体设备切换待验证。 |
| #8 / [#11](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/11) | proxyDraft、submit/disable、主进程既有代理恢复 | 两种表示为需求所需；R12 为重复空配置条件；F13 为恢复失败耦合，真实平台拒绝条件待验证。 |
| #8 / [#12](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/12) | 录制生命周期、设置镜像、平台注册、分类/筛选/关闭记忆入口 | R7；未找到绕过专用 actions 的生产写口；原生录制待验证。 |
| #8 / [#13](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/13) | playlistDetail 全文件、删除分页、页面 open/close/loadMore | F2/F6 已执行复现，F9 为结果提示遗漏；Q4 所列样本未复现，分页期间删除对照正确。 |
| #8 / [#14](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/14) | 收藏、删除、云盘写入、权限与业务结果 | L3、F18；R3 为同一 module 的读路径职责残留。保留明文结果字段；真实写入未执行。 |
| #8 / [#15](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/15) | 添加、创建、详情重读与调用弹窗 | L1、F2/F6/F18；多阶段结果与同步职责必需。 |
| #8 / [#16](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/16) | 全调用面迁移与装配结构检索 | 已核查所列入口与装配，完整 Web/Electron 交互验收待补。 |
| #17 / [#18](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/18) | metadataCache、歌曲/歌词/云盘/专辑、privileges 映射 | 真实元数据/缓存组合的次序、权限映射、命中刷新与写入失败收口已验证；R5、R13、Q9；浏览器数据库待补。 |
| #17 / [#19](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/19) | audioCache 事务、统计、下载、排队、淘汰、清空 | R4；真实 Dexie + fake-indexeddb 的覆盖差额/事务失败/淘汰/清空/初始化交错均验证；实际性能未测。 |
| #17 / [#20](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/20) | Playback、audioResources、audioAdapter、装配 | P1、D4、F3/F5/F12/F14、Q1/Q16/Q17；重复 dispose、准备 abort、解码失败的受控执行均只释放一次且顺序正确；F14 使用真实 Howler 独立复现。真实浏览器音频/Blob 生命周期待补。 |
| #17 / [#21](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/21) | sourceOperations 全部、来源装配与参数 | 未发现旧来源兼容 fallback；各来源页面运行待补。 |
| #17 / [#22](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/22) | 普通/随机队列、模式、FM、next 与队列行身份 | F3/F8/F12/F17、R5；已执行有限失败遍历及待播上限，重复条目的浏览器激活待验证。 |
| #17 / [#23](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/23) | 有效实例、recordOnce、上报条件/快照、Last.fm 门限 | D3 确认时长/门槛规则重复；1 秒、半长、240 秒边界，暂停恢复、重复事件、自然结束后切歌、过时回调、失败交接与 FM 来源快照均受控验证；Q11 队尾重播语义待明确。未发送真实第三方上报。 |
| #17 / [#24](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/24) | archive/restore/dispose、storage、平台接线 | B1、D1、R10、F5/F7/F8；96 组扩展恢复验证中 12 组重复条目身份差异均属 F8；实体设备/原生平台待验证。 |
| #17 / [#25](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/25) | 旧 Player 实例化、内部字段/输出入口全仓检索 | 未见旧生产实例；handler 旧名称本身不作为兼容冗余。完整运行验收待补。 |
| #26 / [#28](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/28) | 八页面十三处列表、行 activate、完整来源与队列身份 | 播放字符串与行父级协议已删除；Q2 的可见无效按钮疑点已排除；F11 为参数迁移遗漏、F17 为菜单条目错位；重复行/筛选需浏览器验证。 |
| #26 / [#29](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/29) | windowOperations、native/IPC/tray/MPRIS 关闭退出、保存确认 | 受控平台政策、并发询问、取消/保存失败重试、明确退出及IPC全退出清理通过；三平台原生冒烟待补。 |
| #26 / [#30](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/30) | query 全文件、search/searchType 生命周期、分页与新页详情 | 内置浏览器综合搜索“周杰伦”显示五类结果，替换为“陈奕迅”后显示对应结果；歌曲分类加载更多后追加内容，主区域链接由 60 增为 121；受控旧详情乱序/销毁拒绝已验证；F19 为同身份资料刷新误清结果；更多页面交互组合待验证。 |
| #26 / [#31](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/31) | dailyRecommendations、卡片/页面、共享 load、统一播放来源 | 真实模块并发 load 共用 Promise、旧身份失败不覆盖新合法空结果、空结果不重读均已验证；浏览器播放竞争待验证。 |
| #26 / [#32](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/32) | lyrics 内容/时钟/重试、页面、平台原始歌词与握手 | F1、F15 经生产组合独立复现；B2/D2；旧曲握手丢弃、当前曲握手发布、暂停后 seek 更新歌词与 Touch Bar、页面消费释放已受控验证；实际 DOM 与 Linux/OSD 待验证。 |
| #26 / [#33](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/33) | lastfm、exchange、回调/设置页、reporting/signing | R8、F16；受控成功采用/beforeunload 的 timer/listener 均释放；保存/删除失败不改状态；Q7 待界定，真实跨窗口交接待验证。 |
| #26 / [#34](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/34) | MPRIS IPC 明确意图、repeat/shuffle 幂等 setter | 目标值迁移有实现，F14 暴露异步事件前重复 Play 不幂等；实际系统消息待原生验证。 |

**#28 十三处列表调用面核对**

| 位置 | 生产参数交接 | 结论 |
| --- | --- | --- |
| album.vue:76 分碟 | playAlbum(album.id, startTrackId=track.id) | 分碟不截断 Playback 读取的完整专辑。 |
| album.vue:85 单碟 | 同一完整专辑操作与选中 ID | 来源、起点一致。 |
| playlist.vue:167 | playPlaylist(playlist.id, startTrackId=track.id) | filteredTracks 只负责展示，播放仍使用完整歌单。 |
| artist.vue:106 | playArtist(artist.id, startTrackId=track.id) | 页面显示 12/24 首不截断完整热门来源。 |
| library.vue:35 喜欢预览 | playLikedSongs(track.id) → playPlaylist(..., fresh=true) | 行参数正确，共享方法的菜单调用另见 F11。 |
| library.vue:146 云盘 | playTracks(cloudDisk.songId 集合, startTrackId=track.songId) | 行展示 simpleSong，事件保留原始 trackProp，ID 获取正确。 |
| library.vue:174 历史 | playTracks(playHistoryList IDs, source=/library, startTrackId=track.id) | week/all 使用当前集合。 |
| search.vue:45 | playTracks(tracks IDs, source=/search/keywords, startTrackId=track.id) | 使用当前综合查询集合。 |
| searchType.vue:21 | playTracks(result IDs, source=/search/keywords/tracks, startTrackId=track.id) | 使用累计分类结果集合。 |
| dailyTracks.vue:23 | dailyRecommendations/play(track.id) | 来源、ID 集合与起点由 daily 单一所有者构造。 |
| next.vue:9 插队 | playQueuedTrack(track.id, identity) | group/index 为原 upcoming 条目，精确删除所选位置。 |
| next.vue:19 主队列 | playQueuedTrack(track.id, identity) | 原队列 index 及随机位置语义保留。 |
| next.vue:4 当前曲目 | 无 activate 接收者 | 展示行边界见 Q2，未按已完成播放交互验收计入。 |

TrackList.vue:63–78 与 TrackListItem.vue:232–238 保留原始 track、显式 identity 和展示 index；按钮与双击共用 activate。以上为生产参数与接收语义核查，重复行的实际浏览器播放仍待验证。

**存档与生命周期执行边界**

队列归因补查执行：shuffle × reversed × repeat(off/on) × 有无插队共 16 组，upcoming(1) 与随后 next 的目标全部一致；重复 ID 随机后条目数保留，静音再恢复返回原音量，按 index 选择重复插队只消费一项，非法删除不改变列表。该组只支持普通模式与编辑规则的覆盖，FM 异步和实例失败仍分别见既有条目。

当前 createStore/persistence/preferences 组合使用内存存储及效果替身执行：空存储首次写 settings/data/appVersion，相同存档再次启动写 0 次；0.3.9 迁移、zh-TW 推导、缺失快捷键补齐、未知嵌套字段保留均符合目标。动态对象更新合并对象、替换数组且只写 settings；重复代理提交保存 1 次、应用 2 次；筛选只写 data；收藏集合与 QR 展示变化写 0 次。独立 Last.fm、队列、进度存储值未改动。快捷键主动重置的扩展字段语义单列 Q6。

设置失败后同值重提的八组真实 action/persistence 执行中，自动缓存关闭、输出设备与代理均重新尝试效果；保存失败后会重存，效果失败后不重复写相同 settings。音质首次提交已改内存值，同值重提只保存、不补清缓存；#10 明确要求相同音质不清缓存，未规定待完成效果或回滚，故记录为契约边界，不据此新增 pending 状态或判为缺陷。

搜索真实 query 的旧详情晚到、新查询及后续分页最终为 `[2,3]`，详情请求为 `1、2、3`、offset 为 `0、0、1`；销毁后迟到拒绝不通知错误，loading=false 且身份监听已注销。Last.fm 保存/删除抛错保持旧授权状态；auth 同步抛错停止交换。执行验证仅替换 I/O，不以测试源码或既有断言作为依据。

窗口关闭使用真实操作所有者及受控宿主执行：macOS 三种保存策略均隐藏；Windows/Linux 的询问、隐藏、退出按策略执行。并发关闭共享一次询问；取消、询问失败、保存失败后可重试；明确退出打断询问后只退出一次，迟到结果不再保存或隐藏。保存确认核对 sender/id；失败、主框架导航、销毁、崩溃、发送异常及超时均清除计时器和监听，同页及子框架导航继续等待。renderer 五个监听释放后为零，后续 nextUp 无动作。三平台原生行为仍未执行。

缓存组合使用真实 Dexie 与 fake-indexeddb：并发新增及同 ID 覆盖后统计与记录为 16 bytes / 2 条；事务失败保持该值，下一提交为 18 / 3；限额淘汰后为 9 / 2；下载中清空全部表后为 0 / 0，迟到下载完成后为 6 / 1；初始化与写入交错后为 9 / 2。元数据请求 `2,1` 在命中与未命中均保持歌曲和权限顺序，可播放状态为 `[true,false]`；每次未命中请求一次、命中后台刷新一次；后台请求或写入失败保留已返回缓存。云盘歌词参数和专辑可播放转换均保留。浏览器数据库与性能测量尚未覆盖。

F14 的独立执行使用安装的 Howler、真实 Playback/audioAdapter，仅替换音频元素及资源 I/O；等待 restore 返回 completed 后连续两次 Play，得到 sound 1001、1002 均 paused=false、ended=false。此时没有选曲请求在途，故属于 #34 的重复目标命令幂等范围。尚未以真实声卡验证声音输出。

**新增模块的增长归因补查**

| 阶段 | 当前生产范围 | 判定与依据 |
| --- | --- | --- |
| #1 | application/library.js:25–46、credentials.js:3–31、requestEnvironment.js:1–37、sessionEffects.js:1–22 | 分别承担 API 注入、凭据操作、真实环境差异和导航效果接合，符合 #1/#2 的依赖边界；未发现可直接删除的新增转发机制。 |
| #8 | application/preferenceEffects.js:4–34、electron/preferences.js:5–13 | 对接 locale/Playback/IPC 与快捷键平台政策，属于 #9–#12 必要职责。无消费者 payload 单列 R7，不能按方法较短删除整层。 |
| #17 | api/metadataCache.js:2–12、playback/sourceOperations.js:3–35 | 实际封装缓存命中刷新、来源请求/智能列表/归属检查，直接实现 #18/#21，属于必要共享流程。 |
| #17/#26 | playback/audioResources.js 全部四阶段 diff | #1/#8 尚无此文件；#17 新增 89 行，#26 显式传 quality 净增 2 行。1–11 注入原 store/db/IPC 依赖；12–17 合并旧两处后台缓存条件；18–36 搬迁 UNM 条件与参数并精简 switch；37–80 将缓存、bilibili、访客外链、账号源交付为 descriptor，移出 Blob URL 创建；82–91 预取只准备数据并接收后台失败。对应 #17/#20 的资源分离，未发现整层冗余。 |
| #17/#26 | playback/index.js:143–193、517–582、602–643、685–713 四阶段归因 | #17 用位置随机排列保留重复歌曲，nextMain 收拢前后边界、供选曲/upcoming 共用；有限 rows 投影和分组位置是 #22 必要新增。playTracks/队列选曲补输入隔离与归属；音量静音搬迁并加范围保护；FM 初始化收回核心，队列编辑补显式保存。#26 显式模式 setter 服务 #34，cycle/toggle 复用，没有另一套模式规则。各处同值 publish 仍归 B1，未新增重复根因。 |
| #26 | application/musicData.js:4–19、api/readingContext.js:1–12 | #26 §9 明确保留必要读取装配；首次请求前接线，具体读取不回导全局 store。 |
| #26 | application/lastfmExchange.js:2–31、lastfmStorage.js:1–8、utils/searchProgress.js:3–18 | 分别拥有交换资源、授权存储和两搜索页共用的延迟展示清理；有实际职责与消费者。第二次 Last.fm 构造单列 R8。 |

**既有文件变更块的增长归因**

| 生产范围 | 已核查职责与判定 |
| --- | --- |
| main.js:5–23、54–107；application/startup.js:1–37 全部四阶段 diff | #1 显式装配凭据、身份、资料库、请求、外观与播放器，并集中启动顺序；#8 接设置效果及恢复后应用；#17 接资源依赖、异步播放器恢复及释放；#26 接 daily/Last.fm/musicData/cache 所有者。无用通知接线见 R1，重复身份投影见 D2。 |
| session.js:180–202 全部四阶段 diff | #1 将旧 dailyTask 的账号判断、日号及成功后保存顺序迁入 session；日号缺陷见 F4。invalidate/logout 共用 clearIdentity，分别处理远端同步抛错和异步拒绝，保证本地退出。#8/#17 此段无变化；#26 仅经 clearIdentity 增加身份开始通知。可选 auth 方法在正常注入下无缺失分支，但未发现重复业务规则，不单独计为冗余。 |
| library.js:16–75、81–108 全部四阶段 diff | #1 从 root actions 与页面迁入歌单/预览/ID/历史读取，合并四类集合提交骨架；previewReady 区分未读与合法空预览，页面实际消费。歌单→预览的 await 修复原分散依赖；账号资料前置 await 是顺序调整，失败契约未扩入 #27。#8 新增数组校验以表达写后同步失败；#17/#26 文件无变化。局部参数和顺序重复见 L4，加载提示依赖见 R3。首项识别喜欢歌单来自旧逻辑，远端保证未独立验证，未据此判缺陷。 |
| store/index.js:1–84 全部四阶段 diff | #1 建立 store 工厂、modules、迁移与持久化并移出 Proxy；#8 接详情及设置保存；#17 无变化；#26 接 daily/Last.fm 与身份广播。重复保存见 S1，私有完成交接见 I1，默认 Last.fm 装配见 R8。 |
| application/player.js:1–202 全部四阶段 diff | Proxy 在 #1 移入，#8 无变化；#17 改资源、audio/reporting/storage/platform/source/restore/dispose 接合与初始发布；#26 接歌词、身份、Last.fm、缓存。必要资源接合与宽输出联动分别核查，后者见 B1/B2/Q14；身份知识见 I1/D2。 |
| application/player.js:79–124、166–202 变更块补查 | #17 的来源/API 响应转 ID、单曲选择、FM 响应校验、真实音频资源注入均接合不同契约，没有复制来源算法。restoreSaved 是唯一恢复入口；dispose 分别释放订阅、平台与核心，先置 disposed 阻止销毁输出。对象展开后的 state getter 保持动态读取，非多余声明。#26 改缓存/身份注入并加入唯一歌词 owner；首次平台发布与恢复后发布用途不同，B1 保留晚注册限制。生产未传 overrides，不存在实际依赖总被覆盖的证据。 |
| background.js:22–31、57–117、271、336–410；ipcMain.js:74–117、184 | 窗口关闭、保存确认和明确退出迁至 #29 所有者，新增监听清理有运行证据；代理恢复的失败耦合单列 F13。 |
| background.js:127–135、357–366；ipcMain.js:194–196、223–240 | HTTP 入口改读 Playback 快照；启动/运行时共用代理、托盘、快捷键效果，settings 镜像不再重复注册快捷键。属于 #8/#17 必要迁移。 |
| ipcRenderer.js:15–66 | 五个监听的建立/释放、完整设置操作的保存确认有实际消费者；旧播放命令迁至唯一平台 adapter，无双份监听。 |
| Player.vue:182–303 | getters、只读快照、seek/setVolume 与公开来源操作替代旧字段写入；喜欢结果接统一反馈，Media Session/键盘归平台所有者。必要接线，三个无消费者映射合并记录于 R9（含 Navbar）。 |
| Cover.vue:75–82；ContextMenu.vue:33–37 | 封面少量公开来源映射获 #26 明确保留；菜单只读 enabled。没有据短转发方法认定冗余。 |
| MvRow.vue:34–53；mv.vue:32、95–106、134–141 | 显式传递 MV 播放状态，公共音量/暂停与收藏结果交接为必要迁移；普通入口新增 autoplay 默认政策单列 Q10。 |
| explore.vue:106、119、190–193；home.vue:102 | 设置改用集中 getters/actions，写入等待完成并反馈失败，符合 #1/#8 的读写归属。 |
| utils/appearance.js:1–104；utils/common.js 的对应删除块 | 主题预设和 DOM 应用从 common 搬出；系统主题监听由隐式读取 store 改为启动注入 getSettings。预设内容及大部分 fallback 已在基线存在，不能把新文件的 104 行全计为新增复杂度。 |
| locale/index.js:13–29；router/index.js:148–160；locale/lang 四文件 | locale 延迟初始化去掉 store 导入；路由使用明确身份 getters 并各返回一次 next；四语言各六处文案区分公开浏览与账号会话。属于 #1 初始化与身份语义迁移。 |
| electron/dockMenu.js:8、globalShortcut.js:19、touchBar.js:20；tray.js:35–282 | 三类切换入口改为 toggle，托盘暂停改为明确 pause；托盘注入 windowOperations 将退出归唯一所有者。分别实现 #34/#29，新增参数交接有实际消费者。services.js 删除未使用鉴权导入。 |
| utils/request.js；api/user.js；loginAccount.vue；loginUsername.vue | 四阶段全部 diff 已核查。#1 请求层净减 44 行，环境与失效效果转注入；账号页净减 75 行，认证、QR 协议及轮询迁出；公开浏览页净减 11 行，用户搜索独立保留。#8 上传删除内部 alert/catch，#26 请求新增 isCurrent 检查；完整公共失败契约属 #27，未扩入当前结论。 |
| store/initLocalStorage.js:26–33；plugins/sendSettings.js:7–15；electron/menu.js:80 | 新增歌词时间和七项 UNM 默认值均有消费者；设置镜像的独立快照、深比较及初始发送必要；菜单改 toggle 符合 #34。镜像过宽触发另见下文。 |
| settings.vue:1、702–728、821–830、921–1300、1312–1455 | 四阶段全部 diff 已核查。#1 身份/设置迁移；#8 将持久化、效果、代理提交和快捷键控制迁至完整操作，页面保留草稿、按键与显示，并释放录制；#17 返回缓存清理完成；#26 Last.fm 操作与生命周期迁出、缓存/语言显式接线。默认兜底见 R6，死映射见 R9，设备失败见 Q1；未将原有展示 getter 整体视为冗余。 |
| ModalAddTrackToPlaylist.vue:31–111；ModalNewPlaylist.vue:69–113 | 四阶段全部 diff 已核查。#1 仍透传协议的中间状态见 W1；#8 改业务参数与分阶段结果，创建后调用完整筛选操作。没有直接刷新详情或父级播放访问；专用提示文案保留，未为少量提示差异建议新抽象。 |
| album.vue:47、76–91、145–258；artist.vue:106–112、183–330 | 四阶段全部 diff 已核查。收藏权限/远端解释迁出，成功后仅更新本页展示；播放来源由公开操作读取，行显式交接起点。Album/Artist 顶部按钮没有 F11 的 MouseEvent 参数遗漏；Artist 既有父级访问仅用于滚动，未误计为播放耦合。死映射见 R9。 |
| lyrics.vue 全部四阶段 diff | #1/#8/#17 分别净增 4/3/16 行，用于状态与公开操作接合；#26 净减 139 行，删除取词、对齐、歌词时钟和 IPC，增加共享内容消费、重试与释放。总净减 116 行，主要为有效收缩；遗漏显示选择合法性见 F15。 |
| playlist.vue、library.vue、next.vue 全部四阶段 diff | #1 模块读取及加载迁移；#8 详情/游标归 playlistDetail、写入消费业务结果；#17 完整来源及 upcoming 投影替代页面算法；#26 显式行激活和条目身份。next 的旧详情返回按当前 upcomingRows 投影，未直接覆盖队列顺序；长期缓存问题仍归 R5/Q3。 |
| TrackList.vue、TrackListItem.vue 全部四阶段 diff | 身份读取、完整写入及公开队列命令迁移；#26 删除歌曲行的全部父级读取、策略字符串和默认播放分派，显式转交原始记录与条目身份。封面按钮定位服务新增可见入口；菜单身份错误见 F17。行组件无用 settings 映射在基线已有，未算新增。 |
| application/lastfm.js、lastfmExchange.js、lastfmStorage.js、store/modules/lastfm.js、api/lastfm.js、lastfmCallback.vue 全部四阶段 diff | 前三阶段无变化；#26 集中授权格式、交换资源和采用/解除操作，上报显式接收捕获的授权，回调页删除双写。设置页、根实例和窗口分别停止同一幂等交换，覆盖不同生命周期；重复装配见 R8，既有 URL 缺陷见 F16。 |
| playbackPlatform.js、electron/mpris.js 全部变化块 | #24 接管系统命令、位置、元数据及释放；#32 接管共享歌词消费与握手，未独立取词；#29/#34 统一退出和明确模式意图。IPC 两端均有消费者；已确认的全量发布/重复元数据/重复 Seeked 分别归 B1/B2/R10，无实例最终展示政策归 Q13。 |
| DailyTracksCard.vue、dailyTracks.vue、FMCard.vue、dailyRecommendations 全部四阶段 diff | 合计净增 49 行：每日推荐 module 新增 71 行，两消费者净减 31 行，FMCard 净增 9 行。#31 的共享读取、失败重试及统一播放构造解释主要增量；FM 的 trackID watcher 避免无关快照变化重复封面取色，非无效抽象。 |
| search.vue、searchType.vue、searchProgress.js 全部四阶段 diff | 前两阶段无变化，#17 仅迁移综合页的插队入口；#26 删除页面类别/响应/详情/游标编排，接独立查询实例、显式播放来源和进度释放。类别名称表仅用于显示；playTrackInSearchResult 无消费者但基线已有，未算新增。 |
| Navbar.vue、utils/playList.js 全部四阶段 diff | Navbar 身份展示、头像及退出迁移为必要接线，死映射见 R9。playList 的身份读取、公开来源及来源导航迁移均有 Player/lyrics/home/explore 消费者；推荐规则未改变，未发现隐藏播放分派。 |
| App.vue、store/state.js、actions.js、mutations.js、plugins/localStorage.js 全部四阶段 diff | 合计新增 45、删除 315，净减 270 行。身份/设置/集合/daily/Last.fm 从根状态退出，旧业务 actions/mutations 与全量保存插件删除；App 改完整加载操作、公开 Playback 状态并释放监听。全仓未见已删除 root 接口的生产调用残留。 |

歌词页面原 watcher/销毁钩子与真实所有者组合中，隐藏时无时钟，显示后启动一次、隐藏取消一次，再显示与销毁各对应启动/取消，累计两次启动、两次取消。页面保留的 1 秒计时器服务日期时间展示，不能算作第二个歌词时钟；滚动、封面色及主题仍为视觉职责。

B1/B2/D1/D2 的面积为问题涉及范围，未承诺等量净删除。存档序列化与成功快照、歌词异步完成和音频变化的两个触发入口、过时代次与握手取消均须保留；只合并重复组织规则。B1 与 D1 的存储投影、B1 与 B2 的平台范围存在交集，不能相加计量。

相关规则横向覆盖：musicData.js:4–17 与 readingContext.js:1–12 仅传递同一身份 reader，没有第四份字段映射。歌词请求 key 与平台 metadata key 分别约束读取归属和内容发布；歌词 generation 与平台 requestId 分别约束远端完成和跨进程写词确认。歌词行索引通知与 Touch Bar 文本去重、浏览器 metadata 与 MPRIS/OSD 协议转换、Last.fm 上报投影均有不同消费者和语义，未计为重复职责。歌词页面没有重新对齐或扫描当前行；根 persistence 也没有再次编码 Playback 存档。

投影隔离覆盖：snapshot 的 18 个展示字段、archive 的 17 个恢复字段、upcoming 行及带收藏的桌面出口有不同消费者；除 D1 外未发现额外字段白名单。真实核心中修改 restore 输入和返回 archive 的队列/曲目均不改变内部数据；音量变化后旧 snapshot 及其 track 仍冻结且保留旧值。多次 clone 不能直接认定为重复职责。currentTrackID 有行高亮消费者；currentTrackDuration 与 durationSeconds 分别服务进度滑块和平台，计算还存在取整差异，未列为可删字段。

R5 的页面横查：album/artist 每次载入替换当前展示；playlistDetail 的 Map 与游标服务 #13 当前详情分页；search 的追加结果随 replace 清空；daily 的共享已加载快照由 #31 要求；library 页面读取所属集合，TrackList 只接收展示数据。未找到第二处以跨窗口历史歌曲 ID 阻止统一读取的页面缓存。艺人 API 与页面两次补详情见 R13，不能与长期缓存混为同一问题。

R5 清理路径核查：next.vue 只有初始化 tracks=[] 和 loadTracks 的 push；没有路由离开、deactivated 或销毁钩子清理，也没有清空/裁剪赋值。activated 与 upcomingKey watcher 都只追加读取。router 开启 keepAlive，App 的 keep-alive 未设 max/exclude/key，未找到普通路由离开时释放历史资料的路径；真实组件生命周期仍未验证。

R13 的详情补全横查：album.vue:277–288 先展示专辑歌曲，再读详情补 mark；原组合受控执行中二读新增 explicit 标记和权限，TrackListItem:60–68 实际消费，不能按访客艺人路径一并计为重复。playlistDetail 对完整 ID `[2,1,3]`、首批 `[2]` 只请求后续 `"1,3"`；track.js 恢复请求批次顺序，详情 module 合并完整歌单顺序，处理范围不同。公共可播放转换已集中，没有另建相同转换规则。

真实每日推荐/Vuex/Playback 组合中，加载期间点击播放不建立迟到播放任务，随后播放曲 9、放行每日读取后仍为曲 9；已加载每日播放在曲 1 准备期间被曲 8 取代，旧结果为 superseded；身份失效后的旧读取返回保持 idle/空集合。#31 明确要求只使用已加载快照，不能将加载期间播放不生效列为缺陷。home 激活会重新 load，每日页面非 keep-alive，未发现永久失去加载入口。

原歌单页 loadData 与真实详情 module 组合中，打开歌单 2 后歌单 1 的迟到失败未覆盖当前详情，close 后 current=null；旧失败仍弹出提示，当前只确认详情归属目标成立。查询双实例执行中，一个失败、另一个空结果各自结束 loading，只有失败实例通知一次；空关键词 replace 清除错误且不增加请求。以上均为生产模块受控执行，未推断全部页面交互通过。

实例归属补充核查：真实 Howler/audioAdapter/Playback 中，一次原生 play 拒绝可从 Howler 的两个分支发出 playerror。audioAdapter.js:85–102 均转发；playback/index.js:372–383 只在入口检查来源实例，313–318 的恢复交接只检查操作编号。受控挂起第一次恢复、先完成第二次并 seek(7)，再放行迟到恢复，位置从 7 回到 0，成功实例被再次替换。最终只有一个 Howl，且只有一次外部播放命令；该证据补充 F12/F14 邻近的实例检查调查，不归为重复 Play。准备错误与播放错误、内部继续与外部选曲的分支本身受 #17/#20 要求，不能因此整段计入冗余；规则分散的具体面积仍在核查。

**API 与缓存的四阶段归因**

album、artist、playlist、track、others、db、common 七文件的四段 diff 均已逐块核查；未列的文件与阶段组合没有变化。

| 阶段 | 变更及当前判定 |
| --- | --- |
| #1 | artist/track/common 改读模块身份及设置；外观和 dailyTask 迁出 common；db 删除等待设置轮询及模块加载初始化，暴露显式 initialize。仍存在的全局 store 读取在后续阶段继续迁移。 |
| #8 | db.clearDB 改为等待全部 table.clear，兑现缓存清理的完成承诺。 |
| #17 | album/track 使用共同 metadata 缓存流程，统一歌曲 ID 顺序并等待写入；db 的容量、事务、淘汰、音频读写迁至 AudioCache，metadata 写方法返回 Promise。该阶段的 AudioCache 构造和 getMP3 仍捕获全局 store。 |
| #26 | 七文件改显式 identity/quality/lang，生产调用者均传入新参数；db 删除 store 与预创建缓存，改配置接线；普通/云盘歌词分键，查询和歌词传 isCurrent。封面下载包装承担真实平台差异，未留下旧云盘键 fallback。 |

#17 后由 #26 再次改动依赖装配，构成分阶段迁移成本；当前旧 store 路径已删除，未记为现存兼容堆积。

**设置镜像的额外检查**

[sendSettings.js](../../src/store/plugins/sendSettings.js):8–15 对全部 Vuex mutation 读取并深比较 settings；[persistence.js](../../src/store/persistence.js):98–101 对三个 module 的全部 mutation 执行保存检查。真实 Vuex/modules/两插件组合逐项提交后的增量如下：

| mutation | persistence 深比较 | 镜像深比较 | 实际落盘 | settings IPC |
| --- | ---: | ---: | --- | ---: |
| 根 toast | 0 | 1 | 无 | 0 |
| QR、processing、songs 集合、previewReady、快捷键录制（分别执行） | 各 2 | 各 1 | 无 | 0 |
| 刷新日期、喜欢歌单 ID、音乐库筛选（分别执行） | 各 2 | 各 1 | data | 0 |
| lang | 2 | 1 | settings | 1 |

无关输入仍重建 data 投影并比较 settings/data；比较相等已阻止 JSON 编码和落盘。镜像即使只限 preferences 前缀，录制状态与音乐库筛选仍是无关输入。维护负担在于触发范围与各自消费字段不一致；未证明性能退化。#9/#12 要求的独立成功/发送快照、深比较、同步镜像及失败重试均保留。两份快照服务不同消费者，不能计为同一职责的重复。此处与 S1 的设置双入口分别发生，不叠加可删除面积。

相关性也不能跨消费者照搬：刷新日期和喜欢歌单 ID 对歌词无关，却必须保存；songs 集合需要平台同步，却不进入既有存档。persistence 的恢复/保存映射未发现 D1 式第三份字段白名单。

默认与迁移覆盖：四阶段 diff 显示 #1 已删除 updateApp 和根 state 的旧迁移入口，#8 集中嵌套恢复，#17/#26 未增加另一套迁移。真实恢复中，0.3.9 的歌词背景 false 改为 true，当前版本 false 保留；快捷键自定义项及扩展字段保留并补齐缺失 ID；嵌套代理保留未知字段并补默认值。版本迁移、集合补齐、语言推导均有独立用途。R6 仅记录页面残留默认；libraryPlaylistFilter 的 `?? 'all'` 与页面 `|| 'all'`、UNM 的页面空值回退条件不等价，尚不能认定无效重复。

`shuffleAList`（utils/common.js:63–74）、`dailySignin`（api/user.js:93）、`cloudDiskTrackDetail`（api/user.js:195）当前无调用，但在四阶段之前的 `01f2de1` 同样仅有定义，未计入重构新增冗余。playerStorage.js:1–5 的 0.2.5 重置分支精确搬迁基线 updateApp.js:44 的既有迁移，原注释说明 0.2.6 重构了播放器；#8/#9 要求保留已有迁移。真实模块中 0.2.5 仅写 player 一次，独立进度、Last.fm、settings 均保留，0.2.6/0.3.9/0.4.11 不重置。该分支保留；重复存档字段投影另见 D1。

**写入结果的组合验证**

结果消费者横向覆盖：除 F9 的 TrackList 删曲二分外，未发现页面重新解释 library 的 code/body.code。收藏、上传、云盘删除等使用 libraryOutcome；实体页成功后的本地展示与删除后导航属于 #14 的页面职责。添加弹窗 85–95 与 libraryOutcome 11–18 重复分类“成功但同步不全”，当前表达完整，属于小范围重复知识；创建弹窗的 creation/addition/synchronization 分阶段反馈受 #15 明确要求，不与普通结果分类合计为冗余。

R3 的失败展示职责横查：dailyRecommendations 保存失败状态，由 dailyTracks 展示；musicSearch/query 负责当前任务有效性并调用 onError，文本与 toast 在 application/musicSearch；Last.fm owner 验证授权，回调页呈现结果；metadataCache 与 audioResources 的后台失败仅交诊断出口。未找到第二处 library.reportBackground 式所有者直接调用 toast；注入错误回调及日志没有因此计为展示职责泄漏。

真实 library、playlistDetail、libraryChange 组合中，收藏成功返回 succeeded/completed；取消喜欢成功而预览及详情读取均失败时，返回 succeeded/incomplete，喜欢 ID 与当前详情保留已确认删除结果；创建成功、加曲被拒绝、集合刷新失败时，creation/addition/synchronization 分别保留 succeeded/rejected/incomplete。消费者未残留 code/body.code 判断，创建流程提取 playlistId 的响应读取承担独立数据提取职责。F9 的提示遗漏仍需修复。

一次喜欢操作在当前详情也为喜欢歌单时，会发出两次相同 metadata 请求，分别服务 library.js:31–41 的预览和 playlistDetail.js:56 的详情重读；实际调用为 `like → getPlaylistDetail(9) → getPlaylistDetail(9) → getTrackDetail('1')`。这属于可选优化候选：先评估一次操作内共享读取是否保持各更新的失败结果、归属检查和分页职责，再决定合并；当前未列为确定冗余，不能直接删任一更新。

Web 检查使用 Codex 内置浏览器和本地开发服务。首次首页读取发生于 API 尚未就绪时，出现 undefined 响应相关错误；之后 API 启动，综合搜索正常。该启动时序现象尚未归因为本次四个 spec 的缺陷。四阶段变更并集共 104 个生产 JS/Vue 文件，增长归因已核查并记录；真实音频/设备、原生消费者首次接合与重建、部分身份变化后的页面交互仍缺运行证据，不能据此声称逐需求验收完成。

R5 的新增真实组件生命周期检查受当前工具环境限制：内置浏览器不可用，Codex 面板打开请求仅返回 queued。未改用外部浏览器；既有浏览器证据保持其原覆盖范围，不能补作 R5 的运行证明。
