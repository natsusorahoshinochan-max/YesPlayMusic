# 测试组织

有效测试放在本目录下，文件名使用 `*.test.js`。`obsolete/` 保存过时测试，已从 Jest 测试发现中排除。

有效测试以 GitHub spec #8 和对应 tickets 的公开契约为验收依据，使用真实 Vuex modules、启动装配及关键 Vue 页面。测试只替换存储、网易云请求、Electron 和浏览器等外部依赖，不替换权限、结果解释、持久化投影与详情分页业务实现。

| 目录 | 验证范围 |
| --- | --- |
| `preferences/` | 设置、默认与迁移、选择性保存、页面输入、生产效果 adapter、启动、代理及桌面快捷键 |
| `store/` | 音乐库写权限与业务结果、创建及加曲、同步失败、当前详情与分页 |
| `views/` | 歌单页面及全局弹窗通过真实 store 完成操作与展示 |
| `application/` | 页面与普通 JavaScript 收藏入口、集合/详情/二维码的持久化隔离 |
| `electron/` | 主进程代理提交与恢复 |

`yarn test --listTests` 查看 Jest 实际发现的有效套件，`yarn test` 运行全部有效测试。当前验证为 19 个套件、160 项测试通过。`tests/obsolete/` 继续排除在 Jest 与 ESLint 外；旧断言不构成保留旧业务行为的依据。

自动化使用受控账号身份与远端响应，不依赖真实账号；无法证明真实服务当前可用性。Web 和 Electron 构建命令、运行环境与桌面交互限制见 [开发环境](../docs/development-environment.md)。
