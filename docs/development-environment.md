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

测试套件状态、发现与运行命令见[测试说明](../tests/README.md)。

Browserslist 固定为 4.24.0、node-releases 固定为 2.0.18，满足测试工具的依赖范围并保持 Node 16 可安装。

## Electron 播放运行验证

先激活工具环境并生成当前代码的 Electron bundle：

```sh
yarn vue-cli-service electron:build --skipElectronBuild
YPM_RUNTIME_ROOT="$PWD" node scripts/verify-playback-runtime.cjs
```

入口为 `scripts/verify-playback-runtime.cjs`，音频与元数据 fixture 位于 `scripts/playback-runtime-fixture.cjs`。默认加载 `dist_electron/bundled/background.js`；使用 `YPM_ELECTRON_MAIN` 指向其他本次构建的主进程 bundle。Electron 可执行文件默认使用当前依赖，可用 `YPM_ELECTRON_BINARY` 指定。

脚本创建独立的临时访客 profile，退出后清理。验证使用真实缓存音频、Howler、Blob URL、默认输出设备、原生播放控制、桌面状态和 `/player`；fixture 歌曲的元数据刷新指向本地 HTTP 服务。结果默认写入 `/tmp/yesplaymusic-spec17-context/runtime25-result.json`，可用 `YPM_RUNTIME_RESULT` 指定；读取结果中的检查项与错误确认实际通过范围。

Web 使用正常页面交互验证播放；Linux MPRIS 和其他目标平台的原生能力在对应系统验证。听歌记录与 Last.fm 生产请求参数通过[受控 API 接合套件](../tests/README.md)验证。
