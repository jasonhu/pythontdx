# AGENTS.md

**StockLens** —— 跨平台桌面行情软件，练习项目，从 0 开始手写。
技术栈：Electron + Vite + SolidJS + TypeScript；行情层为 Python sidecar（通达信 7709 协议）。

> 定位：**学习项目**。代码质量与可读性优先于功能数量；
> 每引入一个依赖、每写一段复杂逻辑，都要能说清「为什么」。

---

## 一、先读这三份

| 文件            | 什么时候读       | 内容                                                          |
| --------------- | ---------------- | ------------------------------------------------------------- |
| `PRINCIPLES.md` | **每次写代码前** | 不可违背的工程原则，带编号（`A1` / `C3` / `U4`…），可直接引用 |
| `PLAN.md`       | **每次开工前**   | 当前状态、待人工验证项、下一步候选、技术债、完成的定义        |
| `README.md`     | 第一次接触项目   | 功能一览、命令表、目录结构                                    |

背景知识按需查 `docs/`：`01` 快速开始 · `02` 架构 · `03` 接口手册 ·
`04` 设计系统 · `05` 路线图 · `06` 踩坑笔记 · `07` 编译发布。

---

## 二、硬规则（违反即视为未完成）

1. **文件编辑只用专用工具，shell 只跑命令**
   - 读用 Read、改用 Edit/Write、搜索用 Grep/Glob；
   - PowerShell **仅**用于构建 / 测试 / git 等命令执行；
   - **禁止**用 shell 做字符串替换式文件编辑。
   - 理由：转义歧义、编码转换、正则误切已多次造成文件损坏且静默失败。

2. **`src/shared/**` 禁止 import `electron` / `node:*` / DOM API**
   它同时被 Node 侧和 Web 侧的 tsconfig 编译，引入平台代码必然有一侧失败。

3. **主进程管 IO，渲染层管呈现**
   网络、定时器、文件读写一律放主进程；行情 socket 由主进程拉起的 Python
   桥接进程持有。渲染层组件不直接调 `window.api`。

4. **提交前 `npm run check` 必须全绿**（类型 + Lint + TS 测试 + Python 测试）。

5. **视觉改动必须 `npm run shot` 截图确认**
   类型检查和单元测试永远抓不到布局溢出、颜色不可读、图表画歪。

6. **修 bug 必须先补能复现的失败测试，再改代码。**

7. **验证不了的事情必须明说**，不要用「应该没问题」代替证据。

> 以上是摘要，完整规则与理由见 `PRINCIPLES.md`。

---

## 三、常用命令

```bash
npm run dev                 # 开发模式（主进程重启 + 渲染层热更新 + Python 桥接）
npm run check               # 类型 + Lint + TS 测试 + Python 测试，一条命令
npm run test                # 只跑 TS 测试（157 个用例）
npm run test:python         # 只跑 Python 协议测试（17 个用例）
npm run build:python        # PyInstaller 打行情桥接单文件（打包前必跑）
npm run shot                # 构建并截图到 screenshots/，用来肉眼验收界面
npm run icon                # 重新生成应用图标（纯 Node 手写 PNG/ICO 编码）
npm run build               # 生产构建（产物在 out/）
npm run build:win           # Windows 打包：安装包 + 单文件便携版
npm run build:win:portable  # 只要单文件便携版 exe
npm run build:win:setup     # 只要 NSIS 安装包
```

**Python 提示**：开发机需要 Python 3.10+（`python3` 或 `python` 在 PATH 上；
也可用 `STOCKLENS_PYTHON` 指定）。打包后的 exe 自带桥接程序，用户不需要 Python。
打包前先 `pip install pyinstaller`。

**Windows 提示**：若 PowerShell 报 `npm.ps1 cannot be loaded`，用 `npm.cmd` 代替 `npm`。

**打包提示**：产物在 `release/<版本号>/`。
`build:*` 会先跑 `npm run build:python`，把 `python/tdx_bridge.py` 打成
`python/dist/tdx-bridge`，再交给 electron-builder 复制到 `resources/tdx-bridge/`。
国内网络下打包还依赖 `.npmrc` 里的 `electron_builder_binaries_mirror` ——
注意它和安装 Electron 用的 `electron_mirror` 是**两套独立下载器**，都要配。

**要正式发一个版本**（改版本号 → 更新 CHANGELOG → 打包 → 实测 → 打标签），
照 **`docs/07-手动编译发布手册.md`** 走，那里有完整的判定标准与验收清单。

---

## 四、目录速查

```
src/main/        主进程：窗口、桥接管理、持久化、定时器、IPC 注册
src/preload/     contextBridge 白名单桥（唯一同时能碰 Node 与 DOM 的地方）
src/shared/      三进程共享的类型与纯函数（禁止平台 API）
src/renderer/    SolidJS 界面：components / stores / lib / styles
python/          7709 协议 + JSON Lines 服务（仅标准库，PyInstaller 打包）
scripts/         图标生成、截图、Python 入口、协议探针
docs/            说明文档（是什么、为什么）
```

新代码往哪放：

- 新的上游协议 / 字段解析 → `python/tdx_bridge.py` + `python/test_tdx.py` 加 fixture 用例
- 新的行情业务 / 缓存 → `src/main/services/tdx/index.ts`
- 新的全局状态 → `src/renderer/src/stores/`
- 可复用的响应式工具 → `src/renderer/src/lib/`
- 任何颜色 / 间距 / 动效 → `src/renderer/src/styles/tokens.css`

---

## 五、当前阶段

**v0.6 数据源迁移（进行中）**——A 股行情已切通达信 7709（Python sidecar），
腾讯 web 接口与解析模块已删除。健康度 `npm run check` 全绿
（157 个 TS 测试 + 17 个 Python 测试）。

已交付：完整行情终端界面 + 多分组自选 + 五档盘口 + 分时/五日/K线
（K 线支持 `↑↓` / 滚轮缩放可见根数、`←→` 移动十字光标、`End` 回最新，档位跨重启记忆；
**指针停在图上就能用键盘**），Windows 单文件便携版 exe，
以及**图表几何层与 Python 协议层的测试覆盖**。

- 下一步候选见 `PLAN.md` 第四节，**需要用户拍板**
- 待人工验证：Windows PyInstaller 打包 / macOS 打包 → `PLAN.md` 第三节
- 港股/美股暂不支持（7709 没有；7727 扩展行情未排期）
- 技术债见 `PLAN.md` 第五节

**开工前请先读 `PLAN.md`，收工前请更新它。**
发布新版本时记得同步更新 `CHANGELOG.md`。
