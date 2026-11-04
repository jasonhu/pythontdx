# pythontdx

**只做 A 股、只接通达信行情源**的跨平台行情终端。Electron 桌面端与浏览器 Web 端共用
一套 SolidJS 界面，Python 负责通达信协议、实时行情、离线数据与面向机器学习的数据湖。

`Electron` · `Vite` · `SolidJS` · `TypeScript` · `Python` · `7709 / MAC / 7615`

**v1.4.0-rc16** · GPL-3.0-or-later · Windows x64 / macOS arm64 / Linux x64

`npm run check` **359 TS（357 通过 / 2 skipped）+ 282 Python（281 通过 / 1 skipped）**

[GitHub Releases](https://github.com/riverzhou/pythontdx/releases) ·
[数据并行同步](docs/18-离线数据并行同步.md) ·
[协议总表](docs/21-通达信协议总表.md) ·
[MAC 策略](docs/19-MAC协议与数据源策略.md)

---

## 一眼看懂

![pythontdx 主界面](docs/assets/pythontdx-1.3-overview.png)

- **实时行情**：1 秒刷新；分时、五日、K 线、九宫格同一节奏；
- **数据工具**：24 个离线数据集，日 K 与 1 分钟 K 独立勾选；多进程 × 多线程 × 多服务器并行下载；
- **协议覆盖**：7709 主站 29 条命令、MAC 15 条 A 股相关命令、7615 51 个入口；
- **本地数据湖**：Parquet/ZSTD + DuckDB、JSONL.gz、`trade_date=` 分区、manifest + SHA256；
- **桌面 + Web**：同一套渲染层，桌面走 IPC，Web 走 HTTP/SSE/WebSocket。

> **1.4.0 重点**：离线 K 线下载重做。日 K 改用官方 `0x06b9` `.day` 文件，
> 1 分钟 K 改为 100 日窗口 + 本地缓存复用；Parquet 写入从约 4 秒/文件降到
> 0.19 秒/文件，1m 批量速度提升约 20 倍；数据工具增加任务摘要、失败/中断续跑
> 和自动续跑。官方 1 分钟**没有 HTTP 文件 URL**，是行情协议抓取后写 `vipdoc/*.lc1`。

---

## 截图

### 主图：指数 K 线、成交量、盘口

![指数 K 线与成交量](docs/assets/pythontdx-1.3-overview.png)

主图上方是今开/最高/最低/昨收、换手、量比、振幅、均价、涨停/跌停、成交量/成交额；
右侧五档盘口 + 明细/指标/分价/资金/竞价页签；下方成交量与 MACD 副图。
指数成交量已统一成「手」，与 K 线同单位。

### 多股同列：九宫格分时 / K 线

![多股同列](docs/assets/pythontdx-multi.png)

- 固定 3×3，默认全天分时（240 个交易分钟固定横轴）；
- 可切日/周/月/60/30/15/5/1 分；
- 自选/自定义超过 9 只自动分页，卡片可拖动调整九格布局，点击卡片切主图。

### 全市场列表

![全市场列表](docs/assets/pythontdx-market.png)

20 列：代码/名称/现价/涨跌幅/成交额/换手/量比/涨速 + 今开/最高/最低/昨收/成交量/
均价/振幅/涨停/跌停/总市值/流通市值/迷你走势；1440×900 下无横向滚动。

### 排行榜与板块

![排行榜](docs/assets/pythontdx-ranking.png)

![板块/概念](docs/assets/pythontdx-block.png)

排行榜复用同一套指标列；板块/概念左侧板块栏 + 成分股表，迷你走势按可见行懒加载。

### F10：目录 + 在线页签

![F10](docs/assets/pythontdx-f10.png)

16 段目录、19 个在线页签；固定 1056px 阅读宽度，正文/表格/公告链接/GBK 原文按段落渲染；
个股结果自动写 point-in-time 快照。

### 数据工具：并行同步 + 真实进度

![数据工具](docs/assets/pythontdx-1.3-data.png)

- 并行离线同步：8 进程 × 4 线程默认（可调 1–48 × 1–4），24 个数据集；
- 日 K（全历史，官方 `0x06b9` `.day` 文件）与 1 分钟 K（最近 100 交易日，服务端实际约 92 日/22,080 根）是两个独立选项；
- 数据集勾选、范围、数据源、进程/线程数、跳过已有、自动续跑会持久化；
- 最近任务摘要保留 `completed / failed / incomplete / cancelled`，中断任务可一键续跑，默认自动续跑一次；
- 1m 任务先用本地 1m 缓存补最近几页，再写 `lake/kline_1m`；全市场 100 只实测 8.2 秒（48×4）；
- Parquet 写入使用临时 CSV staging，最终仍是 Parquet+ZSTD+manifest，CSV 不保留；
- 每个耗时操作都有进度条：同步（探测/计划/完成数/吞吐/ETA）、下载 zhb.zip、
  扫描/校验、备份/恢复字节进度、K 线导出、全市场快照、数据湖归档、本地导入/写回；
- 08:45–15:45 自动保护：窗口内启动返回 `blocked`，跑到一半暂停，15:45 后续跑。

![数据工具进度条](docs/assets/pythontdx-1.3-progress.png)

### 尾盘集合竞价

![尾盘集合竞价](docs/assets/pythontdx-1.3-auction.png)

「竞价」页签支持 **早盘 / 尾盘 / 全天**：

- 早盘 09:15–09:25；
- 尾盘 14:57–15:00（`0x056a selector=1`）；
- 全天合并；虚拟匹配量不是正式成交，15:00 最终成交看「明细」。

---

## 功能

### 行情与图表

- 7709 实时快照/增量刷新，MAC 批量报价兜底；
- 分时 / 五日 / 多周期 K：5s、15s、1–60 分钟、2–45 日、日/周/月/季/年；
- 五档盘口、逐笔、分价、集合竞价、资金流；
- 均线、BOLL、成交量、MACD/KDJ/RSI 等副图；线性/对数坐标；
- 缩放、平移、十字光标、区间统计；
- 画线：趋势线/水平线/垂直线/文字/斐波那契/测量/箭头/平行通道，
  吸附、拖动、复制粘贴、撤销/重做、按复权隔离、日期锚点持久化；
- 多股同列、独立分时窗口、全屏自选、置顶。

### 资料、选股与复盘

- F10：16 段目录、19 个在线页签；
- 左栏「自选股 / 板块 / 自定义」三视图，自选/自定义可拖拽排序；
- 排行榜：涨幅/成交额/涨速/换手/量比/市值/资金流等；
- 条件选股、预设、自动股票池、公式选股、单标的/组合回测；
- 复盘：日 K 逐根、分时逐分钟、历史逐笔回放；
- 离线数据单文件备份/恢复；备份/恢复有真实字节/文件进度。

### 数据与协议

- **7709**：29 条命令；K 线、分时、逐笔、竞价、财务、F10、文件、代码表；
- **MAC**：15 条 A 股相关命令；报价/K 线/分时/逐笔/竞价/板块/资金流/文件元信息；
- **7615**：51 个 `fetch_*`、9/9 HQServ 页、20 个行业子页、84 个资讯频道、涨跌停梯子；
- **gpcw 历史财务**：5,572 只 × 658 float，写 `lake/finance_history`；
- **本地 GBBQ**：本机 202,313 条，解密后写 `lake/gbbq`；
- **归档去重**：按 `trade_date` 或「代码/业务 key」分片，合法同名归档保留第一版，
  只有损坏副本才允许重写；
- **并发安全**：分区级文件锁 + 唯一临时文件 + 原子替换；
- **窗口保护**：交易日 08:45–15:45 不下载离线数据，实时查询不受影响。

> MAC 不是 7709 超集：没有代码表/F10/136B 财务/股本变迁/特殊涨跌停/退市/九榜；
> 采用 MAC 优先 + 7709 兜底。0x1217 文件分片已实现，但测试主机返回空分片，
> 生产下载仍走 0x06b9。边界见 [docs/19](docs/19-MAC协议与数据源策略.md)。

---

## 数据湖

```text
~/.local/share/pythontdx/data/
  raw/tdx/                 原始 ZIP / 文件
  cache/klines/            K 线 Parquet + manifest
  lake/
    today_minute/          分时（按代码分片）
    ticks/                 逐笔 Parquet
    auction/               竞价
    money_flow/            资金流
    category_quotes/       分类行情
    top_board/             九榜
    unusual/               主力监控
    finance/               136B 财务快照
    corporate/             股本变迁
    finance_history/       gpcw 历史财务
    gbbq/                  本地 GBBQ
    blocks/                板块与行业
    limit_ladder/          涨跌停梯子
    f10_pit/               F10 快照（point-in-time）
    server_files/          服务器文件清单
  exports/                 导出 CSV/JSON/Parquet
```

每份归档带 `manifest.json`（来源、时间、行数、SHA256、文件列表）；
`data_coverage` 扫描 32 项覆盖，`data_integrity` 逐份校验 manifest/SHA256。
**不需要为了修显示问题重新下载历史数据**——缓存本身有校验，只有损坏副本才会重写。

---

## 快速开始

### 依赖

- Node.js ≥ 20.19（实测 24.x）
- Python ≥ 3.10（开发/后端；打包版用户不需要）
- duckdb、pyarrow/pandas/numpy、Nuitka（构建 sidecar 时需要）

### 开发

```bash
npm install
python -m pip install -r requirements.txt

npm run dev          # 桌面：Electron + Vite + Python
```

Web：

```bash
python python/tdx_server.py --port 8765
npm run dev:web
```

### 检查与构建

```bash
npm run check        # 类型 + Lint + TS 测试 + Python 测试
npm run build        # Electron 生产构建
npm run build:web    # Web 产物 out/web
npm run build:win    # Windows 安装包/便携版/绿色 zip
npm run build:linux  # AppImage + deb
npm run build:mac    # macOS arm64 dmg
```

发布产物在 `release/<version>/`；打 tag 后 GitHub Actions 构建三平台并上传 Release。

---

## 项目结构

```text
src/main/        桌面壳：窗口/托盘/更新/拉起 Python sidecar
src/preload/     contextBridge 白名单
src/shared/      桌面/Web/后端共享类型与纯函数
src/renderer/    SolidJS 界面（桌面与 Web 共用）
python/          7709/MAC/7615 协议、离线同步、数据湖、HTTP API
docs/            协议手册、架构、数据覆盖、发布手册
scripts/         探针、截图、构建辅助
```

关键入口：

- `python/tdx_bridge.py`：7709 协议、sidecar JSONL、归档；
- `python/tdx_mac.py` / `python/tdx_mac_ext.py`：MAC 命令；
- `python/offline_sync.py`：多进程 × 多线程 × 多服务器同步；
- `python/tdx_f10.py`：7615 TQLEX；
- `python/tdx_server.py`：HTTP/SSE/WS；
- `src/renderer/src/components/DataPanel.tsx`：数据工具与进度。

---

## 测试

```bash
npm run check
python -m pytest python -q
npm run audit:data
```

当前基线：**359 TS（357 通过 / 2 skipped）+ 282 Python（281 通过 / 1 skipped）**。
协议测试使用 `python/fixtures/` 真实报文；MAC/GBBQ/gpcw/离线同步均有独立单测。

---

## 文档

| 文档 | 内容 |
| --- | --- |
| [docs/00-项目章程](docs/00-项目章程.md) | 目标、范围与非目标 |
| [docs/02-架构设计](docs/02-架构设计.md) | 桌面/Web/Python 架构 |
| [docs/03-通达信行情手册](docs/03-通达信行情手册.md) | 7709/MAC/7615 帧与字段 |
| [docs/08-通达信资料索引](docs/08-通达信资料索引.md) | 资料与来源台账 |
| [docs/12-数据覆盖审计](docs/12-数据覆盖审计.md) | 数据清单、schema、审计 |
| [docs/15-协议实现矩阵](docs/15-协议实现矩阵.md) | 命令状态与落盘 |
| [docs/16-gotdx 调研](docs/16-gotdx能力与推送机制调研.md) | gotdx 对照与推送事实 |
| [docs/17-eltdx 差距](docs/17-eltdx协议差距与补齐清单.md) | eltdx 差距与落地状态 |
| [docs/18-离线数据并行同步](docs/18-离线数据并行同步.md) | 并发、窗口、数据集 |
| [docs/19-MAC 策略](docs/19-MAC协议与数据源策略.md) | MAC 矩阵与边界 |
| [docs/20-数据功能与审计](docs/20-数据功能补齐与代码审计.md) | 补齐清单与审计 |
| [docs/21-协议总表](docs/21-通达信协议总表.md) | 一页协议总表 |

---

## 边界

- 只做 A 股；港股/美股/期货/期权/外汇、7727 EX 不做；
- 不做 Level-2/逐笔委托、研报正文、交易下单、账户登录；
- 不引入腾讯/新浪/东财/AKShare 等第三方行情兜底；
- 协议拿不到或授权不允许的数据不伪造；验证不了的字段标「未验证」并保留原始值。

## 许可证

GPL-3.0-or-later。完整条款见 [LICENSE](LICENSE)。
