# 测试组织

有效测试放在本目录下，文件名使用 `*.test.js`。当前有效套件为空。

新测试依据相关 spec 和对应 tickets 的公开契约编写，通过公开 interface 验证目标行为。测试使用真实业务实现，只替换存储、网易云请求、Electron 和浏览器等外部依赖。

`yarn test --listTests` 查看 Jest 实际发现的有效套件，`yarn test` 运行全部有效测试并报告套件与测试数量；有效套件为空时，Jest 默认以退出码 1 结束。

过时测试的存放规则与索引见[归档说明](obsolete/README.md)。

自动化使用受控账号身份与远端响应，不依赖真实账号；无法证明真实服务当前可用性。Web 和 Electron 构建命令、运行环境与桌面交互限制见 [开发环境](../docs/development-environment.md)。
