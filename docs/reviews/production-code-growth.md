# 生产源码错误增长审查

审查版本：`6c991784ed4f9838b132e48b356a602b4fb4a6f4`。

**审查状态：未完成。现有条目仅覆盖局部增长机制，四阶段全部生产变更的逐块归因尚待补齐。**

本文按七类问题定位生产源码的错误增长。归因分为两种：**范围扩写**，即精简任务主动承担额外行为；**冗余设计与实现**，即同一工作重复执行、同一规则重复维护，或为没有生产消费者的能力增加机制。条目记录文件、代码范围、生产调用和引入提交。

行数采用 `git diff --numstat` 的物理行口径，范围为 `src/` 下的 `.js`、`.vue`。文件变更量用于追踪增量；具体问题的计量范围另列。同一代码块涉及多个问题时通过条目引用连接，避免重复累计。

| Spec | 比较范围 | 新增 | 删除 | 净增 |
| --- | --- | ---: | ---: | ---: |
| [#1](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/1) | `01f2de1..122e4b4` | 1,497 | 1,242 | 255 |
| [#8](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/8) | `122e4b4..810357e` | 1,274 | 632 | 642 |
| [#17](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/17) | `810357e..7c8135f` | 2,034 | 1,541 | 493 |
| [#26](https://github.com/natsusorahoshinochan-max/YesPlayMusic/issues/26) | `7c8135f..6c99178` | 1,452 | 923 | 529 |
| 合计 | 四段变更量累计 | 6,257 | 4,338 | **1,919** |

这组生产文件从 94 个、20,345 行增至 128 个、22,264 行。

**1. 精简目标被行为完善挤占**

以下增量来自任务范围扩大。所列代码承担新增工作，其增长发生在规格和执行范围的选择上。

| 条目 | 生产代码与引入提交 | 新增工作及增长原因 |
| --- | --- | --- |
| E1：#8 多阶段写入结果 | [libraryChange.js](../../src/store/libraryChange.js)，1–45；[library.js](../../src/store/modules/library.js)，136–146、330–379；`840bfcbc`、`9b1ba1a`、`9269c7a`、`c658a18` | 普通写入新增 `outcome/synchronization`，创建新增 `creation/addition/synchronization`。操作需要保留各阶段事实、分类运输失败、汇合多个同步任务，再由页面映射提示。#8 的“创建和添加歌曲的结果分别表达”“一个更新失败不阻止其他必要更新的尝试”主动增加这些分支。歌曲和详情同步的具体增量见第 4 类。 |
| E2：#17 完整选曲归属与资源准备 | [playback/index.js](../../src/playback/index.js)，79–92、240–369、464–504；[audioAdapter.js](../../src/playback/audioAdapter.js)，8–38、62–120；`15a6fef`、`ab69926`、`8184175` | 从来源列表取得到音频交接都增加操作编号、失效检查、准备任务集合、取消、延迟音频事件和逐实例释放。旧 Player 的来源方法直接读取后替换当前曲目；新规格要求“最新播放操作生效”和严格资源交接，交付同时承担了行为修正。 |
| E3：#17 缓存提交协调 | [audioCache/index.js](../../src/audioCache/index.js)，8–14、34–88；`5c1f610` | 旧容量统计在写入完成前更新；新逻辑新增串行提交、事务内覆盖差额、淘汰和事务成功后发布统计。这里增加的是一致性工作。该提交的 AudioCache 新增 91 行，同时原 db 区域新增 28、删除 103 行，相关迁移合计净增 16 行。 |
| E4：#26 查询退役管理 | [musicSearch/query.js](../../src/musicSearch/query.js)，27–42、49–58、74–106、110–119、144–150；`4863860`、`b255fe5` | 抽出类型与分页规则的同时，新增查询代次、作业集合、销毁状态、加载汇总和详情完成后的归属复查。旧综合页只比较搜索响应阶段的关键词，旧分类页直接累积；“替换或销毁后，详情结果失效”扩大了生产实现的工作范围。 |
| E5：#26 歌词失败重读与消费者时钟 | [lyrics/index.js](../../src/lyrics/index.js)，13–36、49–73、137–143、182–211；[lyrics.vue](../../src/views/lyrics.vue)，233–237、460–487；[playbackPlatform.js](../../src/application/playbackPlatform.js)，16–19、31–40、155–195；`5fbd2eb` | 迁出页面取词、计时和既有写词握手的同时，新增 idle/loading/ready/empty/failed 状态、重试操作和按钮、消费者计数及释放。页面和 Touch Bar 实际消费这些能力。规格纳入失败恢复和按消费者运行，实现又为既有握手附加 5 秒超时及清理；这些新增工作消耗了删除收益。 |
| E6：#26 关闭前的设置保存确认 | [ipcMain.js](../../src/electron/ipcMain.js)，74–117；[ipcRenderer.js](../../src/electron/ipcRenderer.js)，46–61；[windowOperations.js](../../src/electron/windowOperations.js)，43–54；`eba7cae`、`af7a5dc` | 旧路径发送“记住选项”通知后直接隐藏或退出；新路径等待 renderer 保存成功，再执行关闭。一次通知扩成请求编号、发送方验证、成功/失败确认、超时、崩溃和导航失效、监听清理。主进程确认块现为 44 行；这是新增确认协议带来的连带代码。 |

E1 的结果状态进入 [libraryOutcome.js](../../src/utils/libraryOutcome.js) 和创建弹窗的生产提示；E2 的结果进入 `runSelection`、`discardFMTrack` 和播放反馈；E5 的消费与释放分别由歌词页面和 macOS 平台调用。这些条目的归因是范围扩写。下文继续定位重复解释、重复协调与没有生产消费者的代码，并标明规格要求和实施追加各自的来源。

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

**3. 身份归属没有理清，交接代码向装配扩散**

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

这是边界拆分后的额外协调成本：改变资料提交方式，必须同时检查 session、根装配、播放器订阅和歌词等待位。具体控制面包含歌词等待位声明及 146–158 的 13 行、播放器 157–165 的 9 行接线。搜索动态订阅和资料变化观察服务不同的失效条件。上述歌词私有交接协议由 #26 引入；#1 的身份边界是其历史前提。

**4. 多份相关数据继续靠手工同步**

**L1：同一次写入新增维护多份数据的任务清单。当前保留。**

引入提交：`840bfcbc` 的删除协调、`9b1ba1a` 的喜欢操作、`9269c7a`/`c658a18` 的添加及确认结果保留。主要位置为 [library.js](../../src/store/modules/library.js) 的 `trackAdditionUpdates`、`removePlaylistTracks`、`toggleTrackFavorite`，以及 [playlistDetail.js](../../src/store/modules/playlistDetail.js) 的 `applyLibraryChange`。#8 将集合刷新和详情刷新集中之后，仍由每个写操作列举它影响的歌曲 ID、预览、歌单集合和当前详情。

例如 `toggleTrackFavorite`（411–463）在原有歌曲 ID 更新和预览重读之外，新增喜欢歌单识别的共享 Promise、预览局部删除、详情删除及重读；添加和删除曲目又分别组织自己的任务数组。`synchronize`（libraryChange.js，37–45）并发尝试这些任务，再生成一个同步状态。详情侧按 `tracks-added/tracks-removed/favorite/reload` 再次分派。

增量来自“多份数据分别修改，再逐项尝试恢复一致”的实现形状。旧版已经持有歌曲 ID 和预览，#8 新增的是详情协作，以及加曲、删曲、点喜欢三条路径各自维护副本关联和更新政策。规则集中到了一个较大的 module，但每增加一个受影响视图，写操作仍要增加一项更新知识和失败收尾。E1 又为这些同步步骤引入独立结果维度，进一步增加任务与结果分支。

#8 的 library 文件新增 312、删除 103，净增 209 行；playlistDetail 新增 201 行，libraryChange 新增 45 行，libraryOutcome 新增 25 行。480 行采用四文件整体口径，包含职责迁移与范围扩写。本项的局部证据位于 library.js 的 111–134、271–329、411–463，以及 playlistDetail.js 的 159–195。

此外，library.js 的 136–146 已提供“权限 → 请求解释 → 更新 → 返回结果”的 `write()`，8 个普通写操作使用它，add/remove 又在 271–281、312、315–327 重写同一骨架。双阶段创建有不同流程；这里重复的是两个普通曲目操作已有可用实现的控制流。

**L2：结果契约包含生产调用者从不区分的维度。当前保留。**

引入提交：`840bfcbc`、`9269c7a`。位置为 [libraryChange.js](../../src/store/libraryChange.js) 的 1–4、37–44，以及 [library.js](../../src/store/modules/library.js) 的 346–362、374–379。

| 新增字段或分支 | 生产读取证据 | 错误增长位置 |
| --- | --- | --- |
| synchronization 的 completed/not-required 两值 | libraryOutcome.js:15、ModalAddTrackToPlaylist.vue:92、ModalNewPlaylist.vue:96 只判断 incomplete | 同步任务结果生成多个最终被同一分支消费的命名状态。 |
| denied.reason | libraryOutcome.js:4 只读取 denied 的 status，资料库写结果的生产消费者均未读取 outcome.reason | accountRequired 对象附加没有调用者使用的原因字段。 |
| creation.playlistId | 唯一创建调用者 ModalNewPlaylist.vue:80–102 没有读取它 | 内部加曲需要 ID，公开结果另复制一次 ID；library.js:362 的复制没有生产消费者。 |
| addition.not-attempted | 创建弹窗 85–94 在创建失败时先返回，再读取 addition | 为唯一调用者不会进入的子分支构造结果。 |
| synchronize([]) | 所有实际传入的任务数组至少有一项，失败写入在同步前返回 | libraryChange.js:38 新增无生产入口的空任务兜底。 |

规格先枚举所有阶段组合，实现逐处制造对应对象，调用者再将多个值压回同一提示分支。前四项由 #8 明确规定，主要归因于契约设计过宽；空任务兜底是实施追加的泛化。增长定位到这些多余字段与分支；已有成功、失败和同步警告各有生产消费。E1 和本项涉及相同结果支持代码，计量共用 45 行 libraryChange 和创建流程的变更范围。

**L3：给收藏集合新增的 subscribed 字段没有生产消费者。当前保留。**

引入提交：`9b1ba1a`。位置为 [library.js](../../src/store/modules/library.js) 的 156–168，特别是 162–166 的正向 map 分支；调用位于 265、386、396、406。

helper 在 favorite 为 true 时复制整个集合，给命中项增加 `subscribed: true`，用于歌单、专辑、歌手和 MV。专辑详情实际读 `dynamicDetail.isSub`，歌手读 `artist.followed`，MV 读 `mv.subed`；歌单页读的是独立 playlistDetail 中的 subscribed。音乐库将集合交给 CoverRow/MvRow，这两个组件按成员、封面和标题展示，也不读取该字段。

旧版确认成功后重读集合，详情页更新各自显示状态；#8 保留这些实际路径，又增加无人读取的字段写入。这个正向分支也没有将新增收藏插入集合。可定位的冗余是 162–166 的 5 行正向映射。四个 helper 调用点还服务取消收藏时的成员过滤。

**5. 保存存在重复入口和多余泛化**

**S1：同一个设置提交触发两次保存检查。当前保留。**

引入提交：`86585a2`；`5a80a16`、`5da4213`、`39d69dc` 将相同调用继续铺到音频、桌面和代理设置。

生产链为 `settings.vue → preferences action → commit → persistence 的同步订阅 → action 的 persist → 再次 save`。第一次保存已经更新已保存快照，第二次再生成 settings/data 投影并比较。

| 当前位置 | 重复入口的组成 |
| --- | --- |
| [persistence.js](../../src/store/persistence.js)，98–100 | 继续订阅全部 `preferences/session/library` mutations，并调用 save。 |
| [preferences.js](../../src/store/modules/preferences.js)，70、74、78、86、92、98、104、109、114、119、124、129、144、157、172 | 15 个有状态写入操作，在 commit 后显式调用 `await persist()`。179 行的启动配置应用另调用一次。 |
| [store/index.js](../../src/store/index.js)，69–72；persistence.js，88–91 | 为第二入口增加 persist 注入和 save/ready 暴露。 |

生产使用同步 localStorage；Vuex 的 commit 在返回前执行订阅，订阅保存异常也直接进入 async action 的拒绝路径。新增显式保存时保留了设置订阅的原负责范围，因而增加了第二次投影构造和比较。通常实际落盘一次，重复的是触发入口、检查和完成接线。

16 行显式 persist、1 行注入参数、4 行 store 接线和 4 行 save/ready 暴露，共 25 行承载第二入口及完成等待。此范围与 S2 的等待机制有交集。

**S2：同步存储被扩展成没有生产消费者的异步队列。当前保留。**

引入提交：`86585a2`。位置为 [persistence.js](../../src/store/persistence.js) 的 13、48–73、75、89–97 行。

唯一生产创建链在 [main.js](../../src/main.js) 的 56–75 行，没有传入替代 storage；[store/index.js](../../src/store/index.js) 的 20–33 行因此使用全局 localStorage。`createPersistence` 只有这一个生产调用。Web 与 Electron renderer 共用该入口。

同步 `setItem` 返回 undefined，实际每次都走 persistence.js 的 55–58 行并立即更新 saved；pending 始终为空。新增的同值待办复用、thenable 检测、前驱等待、任务登记和 finally 清理，在这条生产路径中没有异步任务可处理。

可精确圈定的异步专属代码为 13、49–50、59–61、67–72 行，共 12 个源码行；外围 then 检测、分支选择、Promise 汇合和 ready 接线也由这项泛化引入。独立值快照、深比较和嵌套字段保留服务当前选择性持久化，错误增长限定在额外的异步协议及重复入口。

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

增长涉及 playerStorage.js:36 的 previous 与 39–43 的投影、编码、比较；平台侧对应 playbackPlatform.js:210–213 的播放变化判定、233–235 的模式比较条件、239–245 的元数据键构造和比较。模式消息发送、元数据发布、旧任务取消和进度输出各有实际动作，定位时按这些语句分开。#17 指定的只读快照在此作为输入，结构负担在于各输出共同接收全部 semantic 变化，再各自判断相关性。

**B2：#26 将歌词接入全量通道，再追加无关变化过滤与两路发布组织。当前保留。**

引入提交：`5fbd2eb`。位置为 [application/player.js](../../src/application/player.js) 的 129–143、157–164，[lyrics/index.js](../../src/lyrics/index.js) 的 155–179，[playbackPlatform.js](../../src/application/playbackPlatform.js) 的 173–194、238–247。

每次 semantic 输出和所有 session/library mutations 都调用歌词 sync，音量、循环、倒序、下一首队列和 FM loading 因而也到达歌词。sync 每次重新计算 `[id, pc, cd, identity]` JSON key，再更新位置和时钟条件。该键本身承担真实的曲目与身份归属；可确认的额外协调是把歌词接入过宽的通知通道，再从中寻找相关变化。此处增长定位在 application/player.js 的两路 sync 接线，歌词请求归属检查按 E5 的范围成本记录。

平台侧，歌词订阅回调与常规 publish 各自构造 `[currentTrack, generation, status]` 元数据键，并组织 `publishMetadata`。增加一个影响元数据身份的字段，要修改两路键定义与发布分支。两组代码分别位于 playbackPlatform.js 的 188–193、239–246。I1 的身份等待协议另在第 3 类记录。

**7. 同一规则仍需多处维护**

**D1：存档编解码之外，又新增一份字段白名单。当前保留。**

引入提交：`2ba33e9`。位置为 [playback/index.js](../../src/playback/index.js) 的 720–775，以及 [playerStorage.js](../../src/application/playerStorage.js) 的 8–40。

Playback 的 archive 已逐字段构造旧格式，restore 逐字段读取。存储适配器另以 16 项 archiveFields 定义允许字段，启动读取与每次保存各 project 一次。唯一生产保存调用来自 `playback.archive()`，输入已经由同一个核心明确构造；restore 也只读取自己知道的字段。

额外白名单让新增一个持久化属性必须修改编码、解码和存储过滤三处。当前 archive 已输出 `_progress`，适配器又将它剔除，进度经另一项存储保存；恢复数据的边界需要组合两层才能理解。

正常的编码与解码各有方向；额外规则位于 playerStorage.js 的 8–32，共 25 行白名单与过滤函数，34、40 行再各调用一次。增长来自第三份字段规则及重复过滤。

**D2：身份字段来源重复定义，并保留未被生产使用的默认分支。当前保留。**

引入提交：`c4ed48a9`、`4863860e`、`5fbd2eb1`。位置为 [startup.js](../../src/application/startup.js) 的 15–20、[application/player.js](../../src/application/player.js) 的 41–46、[application/musicSearch.js](../../src/application/musicSearch.js) 的 4–9。

三处都从 session 读取模式与 hasAccount，从 library/user 读取 userId 与 vipType。搜索将模式命名为 mode，仅用于整个对象的归属指纹；字段来源仍与另两处相同。

startup 把 reader 同时交给 musicData 和 createPlayer；搜索另定义一次相同来源。唯一生产 createPlayer 调用总是显式提供 reader，player 参数中的默认映射没有执行机会。`5fbd2eb1` 增加歌词字段时已经同时修改 startup 和 player 两份映射，提供了实际的重复维护证据。

三块定义各 6 行，共 18 行；其中 player 默认映射的 6 行没有生产消费者。相对于一份字段来源规则，另两份占 12 行重复定义面积。实际运行的是 startup 和搜索两份读取；这里重复的是映射知识。

**增长责任分布**

| Spec | 可确认的错误增长位置 |
| --- | --- |
| #1 | W1：增加 action 所有者后保留页面协议解释；I1 的历史前提：身份交接仍穿过 session/library。 |
| #8 | E1：多阶段结果与恢复同步扩大范围；L1：多份数据手工同步；L2：过宽结果维度；L3：无消费者字段写入；S1：重复保存入口；S2：无生产消费者的异步队列。 |
| #17 | E2/E3：选曲、资源与缓存一致性扩大范围；B1：全量联动迁到回调及下游比较；D1：额外存档字段规则。 |
| #26 | E4/E5/E6：查询退役、歌词恢复/时钟、关闭确认扩大范围；I1：身份交接私有协议；B2：歌词全量接线及重复元数据键；D2：重复身份映射。 |

这些具体位置显示，旧入口删除之后仍有规则双重解释、状态间手工协调与全量触发后的过滤。接口替换和文件迁移消除了旧调用形式，新增协调代码继续承担同一项业务知识跨位置维护的成本。
