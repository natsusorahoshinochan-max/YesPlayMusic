# 本地开发与验收环境

## 工具与激活

本机为 macOS arm64。项目本地使用 Node 16.20.2、Yarn 1.22.22；系统默认 Node 不变。Node 与 Yarn 位于被 Git 忽略的 `.direnv/runtime/`，本地配置位于 `.env`。`package.json` 声明 Node 14 或 16；当前执行验证使用 Node 16.20.2，未验证 Node 14 运行。

在项目根目录的新终端执行：

```sh
export PATH="$PWD/.direnv/runtime/node-v16.20.2-darwin-arm64/bin:$PWD/.direnv/runtime/yarn/node_modules/.bin:$PATH"
export npm_config_python=/usr/bin/python3
export npm_config_cache="$PWD/.direnv/cache/npm"
export electron_config_cache="$PWD/.direnv/cache/electron"
node --version
yarn --version
```

Python 3.9.6 和系统 Command Line Tools 用于原生依赖编译。上述变量只影响当前终端。

仓库也提供 Nix flake；本机没有安装 Nix，使用上述本地工具目录。

## 安装与配置

Node 官方 darwin-arm64 安装包版本为 16.20.2，解压到 `.direnv/runtime/`；安装包通过官方 SHASUMS256.txt 校验。Yarn 1.22.22 安装在 `.direnv/runtime/yarn/`。

```sh
yarn install --frozen-lockfile --non-interactive
```

Electron 13.6.9 的官方 arm64 安装包与校验文件缓存在 `.direnv/runtime/`，安装器缓存位于 `.direnv/cache/electron/`。如果安装器未生成 Electron 可执行文件，使用同一缓存补齐：

```sh
node node_modules/electron/install.js
```

本地 `.env` 基于 `.env.example`，Web 请求通过 `/api` 代理到本地 3000 端口；Electron 开发请求使用 10754 端口。

## 启动

每个终端先激活本地工具环境。

```sh
# Web API，端口 3000
yarn netease_api:run
```

```sh
# Web，端口 20201
yarn serve
```

```sh
# Electron，独立开发服务器端口 20202；应用内置 API 使用 10754
DEV_SERVER_PORT=20202 yarn electron:serve
```

Web 地址为 http://127.0.0.1:20201 。Electron 内置 API 与 Web API 分别运行。

## 验证入口

```sh
yarn test
yarn build
yarn vue-cli-service electron:build --skipElectronBuild
yarn lint --no-fix
curl --fail http://127.0.0.1:3000/login/status
```

自动测试工具保留 Jest 29、jsdom、Vue 2 SFC 转换与 Vue Test Utils。Jest、babel-jest 与 jsdom 测试环境的 Node 范围为 `^14.15.0 || ^16.10.0 || >=18`；本项目使用 Node 16.20.2。

过时测试位于 `tests/obsolete/`，Jest 与 ESLint 均排除此目录。当前没有有效测试套件，`yarn test --listTests` 返回空列表，`yarn test` 以非零状态报告没有测试。新测试依据[设置结构重构需求](requirements/settings-refactoring.md)、[音乐库变更结构重构需求](requirements/library-mutations-refactoring.md)及对应设计编写，从公开 interface 验证目标行为。

Browserslist 固定为 4.24.0、node-releases 固定为 2.0.18，满足测试工具的依赖范围并保持 Node 16 可安装。

## 运行基线

- 常规依赖安装与 `--frozen-lockfile` 安装均通过；Electron 可执行文件保持可用。
- Web 生产构建通过；Electron renderer 与主进程 bundle 构建通过（`--skipElectronBuild`）；开发首页可显示推荐内容。
- Web API 的登录状态接口正常返回访客结果。
- Electron 主进程创建窗口并触发 ready-to-show，内置 API 对推荐内容请求返回成功。桌面完整交互尚未手动验证。
- lint 存在 6 个错误、7 个警告。错误为桌面主进程和 IPC 中的未使用参数，以及 API 服务中未使用的 import。
- Electron 启动日志存在 Discord IPC 连接失败和 Vue Devtools 安装失败；应用窗口与内置 API 已继续启动。

本地验证日志位于被 Git 忽略的 `.direnv/`，仅用于定位运行问题。
