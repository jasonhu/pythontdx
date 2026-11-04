# pythontdx · A 股行情终端

> **只做 A 股、只接通达信行情源**的跨平台行情终端。
> Electron 桌面端与浏览器 Web 端共用一套 SolidJS 界面；Python 负责通达信协议、
> 实时行情、离线数据与面向机器学习的数据湖。

`Electron` · `Vite` · `SolidJS` · `TypeScript` · `Python` · `通达信 7709 / MAC / 7615`

**版本：1.2.0** · **许可证：GPL-3.0-or-later** ·
`npm run check`：359 个 TS 测试 + 175 个 Python 测试（Python 1 skipped）·
`npm run audit:data`：39/39。

> 1.1.0 正式统一名称为 **pythontdx**；旧 StockLens 的 userData、Python 数据目录、
> 便携目录、localStorage key 与备份清单会在首次启动时自动复制/迁移，旧目录保留。
> 旧的 `STOCKLENS_*` 环境变量仍作为别名兼容。
> 桌面窗口默认 **1440×900**；主行情指标固定单行，全市场/板块/排行榜在 1440 下无横向滚动。
> 发布说明：[RELEASE_NOTES-1.1.0.md](RELEASE_NOTES-1.1.0.md)。

> 0x0547 已于 2026-11-02 盘中确认是**按代码游标的增量刷新**：cursor=0 建立基线，
> 用返回的 updateTime 再请求返回 0 条（无变化）；客户端已缓存上一帧并推进 cursor。
> 未配对推送帧也已入队/合并，但当前免费主站 48 个配置主站各 5 秒、75 秒单代码、
> 45 秒 80 代码实测未主动下发；独立 eltdx 项目在 2026-10-12 的四层实测同样为 0 帧
> （[issue #21](https://github.com/electkismet/eltdx/issues/21)），并指出增量刷新可用。
> 实时链路以 1 秒增量刷新为主。
> 1.0.0 三平台（Linux x64 / Windows x64 / macOS arm64）由 GitHub Actions 构建，
> 通过 GitHub Release 发布；Windows 使用免费自签名（不购买付费证书），
> macOS 使用 ad-hoc 签名。
> 发布说明：[RELEASE_NOTES-1.0.0.md](RELEASE_NOTES-1.0.0.md)。
> macOS 只支持 Apple Silicon，不维护 Intel 版。
> 0.14.4 Windows 安装版 K 线首图约 0.35 秒、逐笔首行约 0.21 秒（本机实测），
> 并已用本机自签名证书做完整性签名（不改变 SmartScreen 提示）。

## 跨平台与验证环境

pythontdx 是 **Windows / macOS / Linux 三平台**项目，代码同一套，构建和测试在对应
系统上原生进行，**不做交叉编译**。

| 平台    | 编译 / 测试环境     | 架构                  | 主要产物                                                       |
| ------- | ------------------- | --------------------- | -------------------------------------------------------------- |
| Windows | **Windows 10 22H2** | x64                   | NSIS 安装包、单文件便携版、win-unpacked（绿色 zip 本地手工 / CI 自动） |
| macOS   | **macOS 27.2**      | Apple Silicon / arm64 | 散装 `.app`、dmg                                               |
| Linux   | **Ubuntu 26.04.1**  | x64                   | AppImage、deb                                                  |

- macOS 只支持 Apple Silicon（M 系列），不维护 Intel/x64 版本；
- Windows / Linux 构建机需要 Python 3.10+ 与 Nuitka；macOS 需要 Xcode Command Line Tools；
- 发布产物在 `release/<version>/`；本机验证记录见 `docs/07`。

---

## 界面

### 主界面：K 线、盘口与自选

![pythontdx 主界面](docs/assets/pythontdx-overview.png)

主图上方集中显示今开/最高/最低/昨收、换手、量比、振幅、均价、涨停/跌停；
右侧是五档盘口、逐笔/分价/竞价/资金流/指标页签；左栏自选股按添加顺序排列，
支持拖拽调整，多股同列会同步这个顺序。

### 多股同列：九宫格分时 / K 线，可翻页、可拖动排序

![pythontdx 多股同列](docs/assets/pythontdx-multi.png)

- 固定 3×3 九宫格，默认**分时全天**（240 个交易分钟固定横轴），也可切日/周/月/60/30/15/5/1 分；
- 每一格都有价格线、均价线、昨收基准、分钟量；
- 顶部数据行：名称/周期/现价/涨跌幅/涨跌额/现量/换手/量比/均价；
- 右侧刻度：分时只显示百分比，K 线只显示价格；
- 分时图有三道淡色时间线（10:30 / 11:30 / 14:00）；
- 自选/自定义超过 9 只自动分页（`‹ 1/2 ›`，左右方向键）；
- 卡片可直接拖动调整九格布局，点击卡片切主图。

### 全市场列表：20 列 + 滚动加载

![pythontdx 全市场列表](docs/assets/pythontdx-market.png)

代码/名称/现价/涨跌幅/成交额/换手/量比/涨速 + 今开/最高/最低/昨收/成交量/均价/
振幅/涨停/跌停/总市值/流通市值/迷你走势。默认窗口 1440×900，无横向滚动条，
向下滚动自动加载。

### 排行榜与板块

![pythontdx 排行榜](docs/assets/pythontdx-ranking.png)

![pythontdx 板块/概念](docs/assets/pythontdx-block.png)

排行榜复用同一套指标列；板块/概念左侧板块栏 + 成分股表，均支持迷你走势图按可见行懒加载。
垂直浏览已全部改为滚动，不再有上一页/下一页。

### F10：16 段目录、19 个在线页签

![pythontdx F10](docs/assets/pythontdx-f10.png)

固定 1056px 阅读宽度，正文、表格、公告链接、GBK 原文按段落渲染；
最新提示里的单列框线段落保留换行，不再和表格最后一行混排。

### 数据工具：离线统计 + 全量校验报告

![pythontdx 数据工具](docs/assets/pythontdx-data.png)

- 统计：9 类数据集文件数、大小、日期覆盖，六个目录合计；
- 校验：逐份校验 manifest + SHA256，当前数据 **1 万余份 / 0 失败**；
- 可导出 JSON 报告；备份恢复采用同名文件全量覆盖。

---

## 项目定位

这是一个**学习项目**，目标不是复刻商业行情软件，而是把下面几条链路走通：

- 通达信 7709 / MAC / 7615 真实协议与数据解析；
- 实时行情、K 线、逐笔、竞价、资金流、F10；
- 离线数据湖：Parquet + DuckDB，按 `trade_date` 分区，可追溯、可重放；
- 桌面与 Web 共用同一套界面；
- 财务/公告 point-in-time，给未来的数据挖掘和机器学习用；
- 代码、测试、数据审计能重复跑通。

**明确不做**：港股/美股/期货/期权/外汇、7727 扩展行情、Level-2/逐笔委托、
研报正文、交易下单、登录账户。协议拿不到或授权不允许的数据不会伪造。

---

## 功能概览

### 行情与图表

- 实时行情：通达信 7709 / MAC 批量快照，1 秒级刷新，价格跳变高亮；
- 标题栏北京时间：秒级时钟、日期/星期/交易时段，集合竞价与连续竞价带脉冲；
- 分时 / 五日 / 多周期 K：5s、15s、1–60 分钟、2–45 日、日/周/月/季/年；
  交易时段分时与 K 线统一 1 秒刷新，九宫格同步；开盘第一秒用 09:30 基准 +
  1 秒报价轨迹补线，官方分钟点到达后替换；
- 五档盘口、成交明细、分价表、集合竞价（最新虚拟撮合价 + 自动跟随）、资金流；
- K 线均线、BOLL、成交量、MACD/KDJ/RSI 等副图；
- 线性/对数坐标、缩放、平移、十字光标、区间统计；
- 画线：趋势线、水平线、垂直线、文字、斐波那契、测量、箭头、平行通道；
  吸附、拖动、复制粘贴、撤销/重做、按复权隔离、日期锚点持久化；
- 智能画线：Python 识别主摆动，生成常用组合；
- 多股同列、独立分时窗口、全屏自选、当前窗口置顶。

### 资料、选股与复盘

- F10：16 段目录、19 个在线页签，GBK 正文与表格渲染；
- 左栏「自选股 / 板块 / 自定义」三视图：
  - 自选股单层平铺，按添加顺序，支持拖拽排序；
  - 板块用大窗口选一级/二级行业、通达信行业、概念、风格、指数板块、一般；
  - 自定义板块单独管理，同样按添加顺序并可拖拽；
- 排行榜：涨幅/成交额/涨速/换手/量比/市值/资金流等；
- 条件选股、预设、自动股票池、公式选股、单标的/组合回测；
- 复盘：日 K 逐根、分时逐分钟、历史逐笔前进/回放；
- 个股列表右键菜单：加入自选或具名自定义板块；
- 离线数据单文件备份/恢复（恢复为全量覆盖）；备份和恢复都有真实字节/文件进度条，
  扫描、写入、SHA256、恢复阶段分开显示，备份路径可直接输入或通过对话框选择。

### 数据与工程

- **数据湖**：K 线/逐笔/资金流/竞价/F10 PIT/服务器文件清单；
- **存储**：Parquet + ZSTD，DuckDB 读写；数据分析使用 pandas/pyarrow/numpy，不进入 sidecar；
- **PIT**：F10/财务/公告查询自动快照，保存抓取时间、报告期、SHA256；
- **归档**：逐笔、竞价、资金流按 `trade_date` 分区；
- **下载**：日 K / 1 分钟 K / 逐笔，自选全量/市场全量，支持停止、失败清单、断点续跑；
- **审计**：`data_coverage` 覆盖九类数据，`data_integrity` 逐份校验 manifest/SHA256；
- **双前端**：桌面 Electron + Web，共用 `src/renderer` 和设计令牌；
- **质量门禁**：`npm run check`（类型/Lint/TS 测试/Python 测试）。

---

## 快速开始

### 环境

| 依赖                     | 版本                                          | 用途                                           |
| ------------------------ | --------------------------------------------- | ---------------------------------------------- |
| Node.js                  | ≥ 20.19（实测 24.22.2）                       | 前端与 Electron                                |
| Python                   | ≥ 3.10（Linux 实测 3.14.4）                   | 开发/Python 后端；打包后的桌面版不需要用户安装 |
| duckdb                   | ≥ 2                                           | Parquet 读写与查询                             |
| pyarrow / pandas / numpy | 最新稳定版                                    | 数据挖掘/ML，sidecar 不打包                    |
| Nuitka                   | 4.x（Linux 实测 4.3.3）                       | 构建 Python sidecar                            |
| OS / 工具链              | Windows 10 22H2 / macOS 27.2 / Ubuntu 26.04.1 | 原生编译，不做交叉编译                         |

Ubuntu 26.04 的系统 Python 受 PEP 668 管理，**不要直接往系统 Python 装包**；在项目内建 venv：

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
npm install
```

Windows PowerShell 对应：

```powershell
py -3 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
npm.cmd install
```

### 开发

```bash
npm run dev          # 桌面：Electron + Vite + Python 桥接
```

Web：

```bash
python3 python/tdx_server.py --port 8765
npm run dev:web
```

单端口托管 Web：

```bash
npm run build:web
python3 python/tdx_server.py --web-dir out/web --port 8765
```

## 快速编译手册

### 0. 通用准备

三平台都需要 **Node.js ≥ 20.19（实测 24.22.2）**、**Python ≥ 3.10（Linux 实测 3.14.4）**
和 **Nuitka 4.x（Linux 实测 4.3.3）**。先拉代码并在项目内建 venv：

```bash
git clone https://github.com/riverzhou/pythontdx.git
cd pythontdx
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
npm install
```

Windows 上 `python3` 换成 `py -3`，激活命令换成 `.\.venv\Scripts\Activate.ps1`，
`npm` 换成 `npm.cmd`（PowerShell 执行策略限制时）。
打包脚本会自动先跑 `npm run build:python`，把 Python sidecar 编成单个可执行文件；
不需要用户机器安装 Python。

首次构建会下载 Electron 运行时与 NSIS 工具链；仓库 `.npmrc` 已配国内镜像，
网络环境不同时检查 `electron_mirror` 与 `electron_builder_binaries_mirror` 两个键
（详见 `docs/07` 2.3）。

提交/发版前先跑质量门禁：

```bash
npm run check        # 类型 + Lint + 315 TS + 168 Python
npm run audit:data   # 39 项数据覆盖/完整性审计
```

### 1. Windows 10 22H2（x64）

前置：Visual Studio 2022 Build Tools（Desktop development with C++，Nuitka 需要 MSVC）、
64 位 Python 3.10+、Node.js 20+。

```powershell
npm.cmd install
py -3 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
npm.cmd run check

npm.cmd run build:win            # NSIS 安装包 + 单文件便携版 + 绿色 zip
npm.cmd run build:win:setup      # 只出安装包
npm.cmd run build:win:portable   # 只出便携版
npm.cmd run build:win:zip        # 从 win-unpacked 单独补绿色 zip
```

`build:win` 在 `release/<version>/` 留下：

- `pythontdx-<version>-setup.exe`：NSIS 安装包；
- `pythontdx-<version>-portable.exe`：单文件便携版；
- `pythontdx-<version>-win-x64/`：签名后的散装绿色包；
- `pythontdx-<version>-win-x64.zip` + `.sha256`：可直接分发的绿色 zip；
- `win-unpacked/`：Electron 解包目录。

`build:win` 最后会自动调用 `npm run build:win:zip`：从 `win-unpacked` 生成绿色目录，
复制 `pythontdx-selfsigned.cer`，压缩为 zip，并校验 `pythontdx.exe` /
`tdx-bridge.exe` 存在。只补 zip 时运行：

```powershell
npm.cmd run build:win:zip
```

> GitHub Actions 的 `build-windows-x64`、`release-windows-zip` 和完整 `release`
> 现在都调用同一个 `scripts/build-win-zip.ps1`，本地与 CI 的 zip 结构一致。
> `release-windows-zip` 可只给已有 Release 补 zip（选择 tag，默认 `v1.1.0`），
> 不会重打 Linux/macOS，也不会改动其他资产。

> Windows 包使用**本机自签名证书**做完整性签名（`build:win` 会自动调用
> `npm run sign:win`）。首次构建会创建一张 10 年有效的代码签名证书，公钥导出到
> `release/<version>/pythontdx-selfsigned.cer`。
>
> 它只保证文件签名后没有被改过，**不会消除 SmartScreen 的「未知发布者」**。
> 校验：
>
> ```powershell
> Get-AuthenticodeSignature release\<version>\pythontdx-<version>-setup.exe |
>   Format-List Status, SignerCertificate
> ```
>
> `Status` 为 `UnknownError` 是正常的（自签名根未被系统信任）；`NotSigned` /
> `HashMismatch` 才说明文件没有有效签名或被改过。安装公钥后系统才会把发布者显示为
> `pythontdx Self-Signed`。

### 2. macOS 27.2（Apple Silicon / arm64）

前置：Xcode Command Line Tools（`xcode-select --install`）、Node.js/Python 均为 arm64。
**只支持 Apple Silicon，不构建 Intel/x64 版本。**

```bash
npm install
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
npm run check

npm run build:mac:app   # 只出散装 .app，最快验证
npm run build:mac:all   # 散装 .app + dmg
npm run build:mac       # 只出 dmg
```

产物：

```text
release/<version>/mac-arm64/pythontdx.app
release/<version>/pythontdx-<version>-arm64.dmg
```

macOS 首次启动会触发 Gatekeeper 对 sidecar 的安全扫描，**首屏约 10 秒**；之后同一
解包路径复用扫描结果，**约 0.36 秒**。本机 0.14.4 实测：

| 场景                                      |          到分时图 |
| ----------------------------------------- | ----------------: |
| 真首次（全新 userData + 清 sidecar 缓存） |      **10,333ms** |
| 第二次                                    |         **365ms** |
| 第三次 / 第四次                           | **364ms / 389ms** |

首次慢是 macOS 安全机制，不是 CPU/解包问题；详见 `docs/06` 第 42 条。首次之后
图表直接命中 localStorage 分时快照，并标「离线缓存」，网络回来覆盖。

> **macOS 安装（ad-hoc 签名、未公证）**：从浏览器下载后首次打开会被 Gatekeeper
> 拦截——点「完成」，到 系统设置 → 隐私与安全性 → 仍要打开；或在核对 SHA256 后执行
> `xattr -dr com.apple.quarantine /Applications/pythontdx.app`。
> ad-hoc 不是可信任签名（`spctl -a` 仍拒绝），但整包签名完整
> （`codesign --verify --deep --strict` 通过）；详见 `docs/07` 第三十五节。

### 3. Ubuntu 26.04.1（x64）

前置：`build-essential`、`python3-dev`、`python3-venv`、`patchelf`；AppImage 运行还需要 FUSE
（Ubuntu 26.04 包名 `libfuse2t64`，deb 不需要）。

```bash
sudo apt install build-essential python3-dev python3-venv patchelf libfuse2t64
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
npm install
npm run check

npm run build:linux   # AppImage + deb
```

如果 `.venv` 已存在，只需 `source .venv/bin/activate`；不想激活时也可以用
`PYTHONTDX_PYTHON=.venv/bin/python npm run build:linux`。

产物在 `release/<version>/`：`pythontdx-<version>.AppImage`、
`pythontdx_<version>_amd64.deb`。AppImage 需要 `chmod +x` 后运行；没有 FUSE 时用
`--appimage-extract-and-run`：

```bash
chmod +x release/<version>/pythontdx-<version>.AppImage
./release/<version>/pythontdx-<version>.AppImage
# FUSE 不可用：
./release/<version>/pythontdx-<version>.AppImage --appimage-extract-and-run
```

deb 可用 `sudo apt install ./release/<version>/pythontdx_<version>_amd64.deb`
（自动解析依赖），或 `dpkg-deb -x` 解包直接运行。

> **Ubuntu/GNOME 双击 AppImage 没反应？** 不是可执行位问题：系统把
> `application/vnd.appimage` 默认交给磁盘镜像挂载器，双击只会挂载。
> 新版首次从 AppImage 启动会询问是否修复；也可以不开窗口直接修：
>
> ```bash
> ./pythontdx-<version>.AppImage --install-desktop
> ```
>
> 或到「设置 → Linux 桌面集成 → 修复双击」。它会安装应用菜单入口，并把该 MIME
> 的默认打开方式改为通用 AppImage 启动器（详见 `docs/06` 第 43 条）。

### 4. 产物速查

| 平台        | 命令                    | 产物                                                             |
| ----------- | ----------------------- | ---------------------------------------------------------------- |
| Windows x64 | `npm run build:win`     | setup.exe / portable.exe / win-unpacked（绿色原料）              |
| macOS arm64 | `npm run build:mac:all` | `.app` + dmg                                                     |
| Linux x64   | `npm run build:linux`   | `pythontdx-<version>.AppImage` + `pythontdx_<version>_amd64.deb` |

三平台都**在本机原生构建，不做交叉编译**。每次版本更新后建议至少跑一次
`npm run build:mac:all`（macOS）或对应的 `build:win` / `build:linux`，并实际启动产物验证。

> **0.14.4 本地验证**：Windows setup / portable / 绿色包 / zip 已打包、逐个启动，
> 并用本机自签名证书签名（安装版 K 线 353ms、逐笔 209ms；绿色包 335ms / 184ms；
> 公钥在 `release/0.14.4/pythontdx-selfsigned.cer`，SmartScreen 仍会提示未知发布者）；
> `release/0.14.4/mac-arm64/pythontdx.app` 与 `release/0.14.4/pythontdx-0.14.4-arm64.dmg`
> 也已构建、签名和 GPL 校验通过；dmg 只做本地验证，不发布 GitHub Release。
> Linux 0.14.4 AppImage/deb 已在本机启动验收：`v0.14.4`、GPL 文本、
> 备份/恢复进度条均回读通过。

> **1.1.0 三平台正式发布**：Linux AppImage/deb、Windows setup/portable/绿色 zip、
> macOS arm64 dmg 均由 GitHub Actions 构建，并上传到
> [GitHub Release v1.1.0](https://github.com/riverzhou/pythontdx/releases/tag/v1.1.0)
> （run `41449933914`，四个 job 全部 success）。
> 包内版本 `1.1.0`；含 pythontdx 改名/迁移、1440×900 默认窗口与宽表适配。
> Windows 使用免费自签名；macOS 使用 ad-hoc 签名，均未购买付费证书。

| 产物 | 大小 | SHA256 |
| --- | ---: | --- |
| `pythontdx-1.1.0.AppImage` | 165,172,596 B | `e74894e4c97bfaa94a89ff8965d3c5aabae33826664305132f2631a6d3681d0d` |
| `pythontdx_1.1.0_amd64.deb` | 138,700,728 B | `e01d84e9a9f2e4fad0070c68434a627f8fe222f57d2c70cba180c218d7257c0a` |
| `pythontdx-1.1.0-setup.exe` | 133,377,656 B | `3f96a6a701120a46ed92e1ed6d21379768ab02c49a8b943c9092b8a9f7695c31` |
| `pythontdx-1.1.0-portable.exe` | 133,123,520 B | `9d7d2e473d6156cb3dda9212dc61ab3a48129272325f31263fd90c77c71f48bc` |
| `pythontdx-1.1.0-arm64.dmg` | 166,977,703 B | `aeb66ed0ed0993b259ba9d1f7b583e97f99cb89dda886adea2fb84fe15bcde34` |
| `pythontdx-1.1.0-win-x64.zip` | 180,395,724 B | `74e4b9df72d376321c07d637cbb61ca3d85e88da5057a1d05af720c553efc864` |
| `pythontdx-selfsigned.cer` | 822 B | `769d56c46507487c97ce9d087c4fdc2bdd7497695c76b5a060a7548c170d350c` |

Windows 绿色 zip 内含签名后的 exe 与本次 CI 的自签名公钥；`.sha256` 同目录提供。
1.0.0 的 Release 仍保留在旧 tag 上，本表只列 1.1.0 产物。

---

## 架构

```text
Electron 壳 ─┐
             ├── IPC / HTTP / SSE / WebSocket ── Python 后端 ── 通达信 7709 / MAC / 7615
浏览器 Web ──┘                                      │
                                                    ├── 本地数据湖（Parquet + DuckDB）
                                                    └── 通达信文件/本地文件
```

- 桌面与 Web 共用 `src/renderer`；
- Python 是唯一的行情 socket / 文件 IO 入口；
- 纯函数和类型放 `src/shared`，桌面/Web/Node 三端可编译；
- 技术分析识别放 Python，画线交互/渲染放 TS：
  `python/patterns.py` → `chart_patterns` → `KLineChart` 日期映射；
- 数据目录默认在用户数据目录下的 `data/`，结构见 [docs/12](docs/12-数据覆盖审计.md)。

---

## 数据与协议边界

| 数据                          | 状态                             |
| ----------------------------- | -------------------------------- |
| 实时五档、K 线、分时、逐笔    | ✅ 通达信 7709/MAC               |
| 竞价、资金流                  | ✅ `0x056a` / `0x0ffc`，本地归档 |
| F10 / 财务 / 公告             | ✅ 7709 + 7615，PIT 快照         |
| 日 K / 1 分钟 / 逐笔归档      | ✅ Parquet + DuckDB              |
| 服务器文件已知清单            | ✅ `zhb.zip` 47 文件及差分       |
| 服务器完整目录                | ⛔ 无目录枚举命令                |
| 历史五档 / Level-2 / 逐笔委托 | ⛔ 协议/授权边界                 |
| 研报正文                      | ⛔ 授权边界                      |
| 7727 / EX                     | ⛔ 非 A 股范围                   |
| `0x0547` 盘中增量/推送        | ✅ 增量 cursor 已确认；推送帧队列已接入，当前主站未主动下发 |

不伪造数据；缺失数据在 UI 显示 `—`，并保留边界说明。

---

## 目录

```text
src/
├── main/          Electron 主进程、窗口、存储、行情门面
├── preload/       contextBridge 白名单桥
├── shared/        类型与纯函数（桌面/Web/Node 共享）
├── renderer/      SolidJS 界面：components / stores / lib / styles
└── web/           Web 入口与 HTTP API 客户端

python/
├── tdx_bridge.py  通达信桥接 + JSON Lines 命令
├── tdx_server.py  HTTP API / SSE / WebSocket
├── patterns.py    技术形态识别（可被 ML/回测直接 import）
├── f10_pit.py     F10/财务 point-in-time
├── parquet_store.py
├── tick_archive.py / auction_archive.py / flow_archive.py
├── data_coverage.py / data_integrity.py / server_catalog.py
├── test_*.py
└── fixtures/      真实报文

scripts/           截图、图标、探针、数据审计入口
docs/              目标、架构、协议、UI、路线图、发布、数据审计
screenshots/       本地验收截图（gitignore）
docs/assets/       README 截图
```

---

## 文档

| 文档                                                           | 内容                   |
| -------------------------------------------------------------- | ---------------------- |
| [docs/00-项目章程.md](docs/00-项目章程.md)                     | 目标、范围与非目标     |
| [docs/01-快速开始.md](docs/01-快速开始.md)                     | 环境与命令             |
| [docs/02-架构设计.md](docs/02-架构设计.md)                     | 桌面/Web/Python 架构   |
| [docs/03-通达信行情手册.md](docs/03-通达信行情手册.md)         | 7709 帧与字段          |
| [docs/04-UI设计系统.md](docs/04-UI设计系统.md)                 | 设计令牌与布局         |
| [docs/05-开发路线图.md](docs/05-开发路线图.md)                 | 里程碑                 |
| [docs/06-踩坑笔记.md](docs/06-踩坑笔记.md)                     | 实际踩坑               |
| [docs/07-手动编译发布手册.md](docs/07-手动编译发布手册.md)     | 构建/发布/验收         |
| [docs/08-通达信资料索引.md](docs/08-通达信资料索引.md)         | 协议资料来源           |
| [docs/09-官方客户端功能清单.md](docs/09-官方客户端功能清单.md) | 功能矩阵               |
| [docs/12-数据覆盖审计.md](docs/12-数据覆盖审计.md)             | 数据清单、schema、审计 |
| [docs/13-技术分析算法.md](docs/13-技术分析算法.md)             | Python/TS 算法边界     |
| [docs/14-eltdx数据能力调研.md](docs/14-eltdx数据能力调研.md)   | 协议/数据能力对比与增强 |

工程规则见 [AGENTS.md](AGENTS.md)、[PRINCIPLES.md](PRINCIPLES.md)、
[PLAN.md](PLAN.md) 和 [CHANGELOG.md](CHANGELOG.md)。

---

## 许可证

本项目采用 **GNU General Public License v3.0 or later**（GPL-3.0-or-later）。
完整条款见 [LICENSE](LICENSE)。

## 免责声明

本项目是学习项目，行情数据来自通达信社区逆向协议，**不构成投资建议**，
不保证数据实时性、完整性或适用于交易。请遵守数据源服务条款，不要用于
商业转售、绕过授权或高频滥用。
