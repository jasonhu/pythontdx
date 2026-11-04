# 通达信 Python 桥接进程

Electron 主进程通过 stdin/stdout 的 JSON Lines 与这个进程通信。
它只依赖 Python 标准库，不需要 pytdx / eltdx。

## 为什么单独一个进程

- 用户希望通讯层用 Python；
- Python 侧只做 TCP + 二进制协议 + 解析，TS 侧继续管窗口、缓存、拼音搜索；
- 打包时用 Nuitka 编译成单文件，用户机器不需要安装 Python，也不携带 Python 源码。

## 开发

```bash
# 直接调试：一行命令一个 JSON
echo '{"id":1,"cmd":"ping"}' | python3 python/tdx_bridge.py
echo '{"id":2,"cmd":"quotes","payload":{"codes":["sh600519"]}}' | python3 python/tdx_bridge.py
```

Electron 开发模式默认调用：

```bash
python3 python/tdx_bridge.py
```

可以用环境变量覆盖：

```bash
PYTHONTDX_PYTHON=/usr/bin/python3 npm run dev
PYTHONTDX_TDX_BRIDGE=/path/to/tdx-bridge npm run dev
```

## 协议

| 命令 | payload | 返回 |
| --- | --- | --- |
| `ping` | — | `"pong"` |
| `code_list` | — | 全量代码表（约 5.2 万条） |
| `quotes` | `{ codes: string[] }` | `Quote[]`（`0x053e`，五档兼容） |
| `snapshots` | `{ codes: string[] }` | `Quote[]`（`0x054c`，买一/卖一） |
| `refresh` | `{ codes: string[], cursors?: Record<string, number> }` | `Quote[]`（`0x0547`，五档基线） |
| `category` | `{ category?, sortType?, start?, count?, ascending?, filterRaw? }` | `Quote[]`（`0x054b`，服务端排序） |
| `trades` | `{ code, start?, count?, date? }` | `TradeTick[]`（`0x0fc5` / `0x0fc6`） |
| `auctions` | `{ code, date?, selector?, start?, limit? }` | `AuctionPoint[]`（`0x056a`） |
| `file_read` | `{ path, offset?, size? }` | `FileContentChunk`（`0x06b9`，contentHex） |
| `file_download` | `{ path, chunkSize?, maxBytes? }` | 完整文件落盘 + SHA256 |
| `tdx_stats` | — | 下载 `zhb.zip`，返回两份 CFG 摘要与样本 |
| `tdx_stats_export` | — | 原始 ZIP + 按日期分区的 JSONL.gz + manifest |
| `money_flow` | `{ code }` | 最近 5 日资金流（`0x0ffc`） |
| `f10_catalog` | `{ code }` | F10 段落目录（`0x02cf`） |
| `f10_content` | `{ code, filename, start, length }` | F10 段落正文（`0x02d0`） |
| `kline` | `{ code, period, count }` | `KLineSeries` |
| `minute` | `{ code }` | `MinuteTrend` |
| `five_day` | `{ code }` | `MultiDayTrend` |
| `top_board` | `{ category?, size? }` | 9 个榜单（`0x053f`） |
| `unusual` | `{ count? }` | 主力监控 19 类事件（`0x0563`） |
| `volume_profile` | `{ code }` | 成交分布（`0x051a`；免费主站暂不响应） |
| `mac_server_info` | — | MAC 0x120F 交易日/交易时段 |
| `mac_symbol_info` | `{ code }` | MAC 0x122A 股票摘要 |
| `mac_quote_detail` | `{ code, date? }` | MAC 0x122D 单只快照 + 分时 |
| `mac_kline` | `{ code, period, start?, count?, adjust? }` | MAC 0x122E K 线 |
| `mac_auctions` | `{ code, start?, count? }` | MAC 0x123D 竞价 |
| `mac_tick_charts` | `{ code, date?, days? }` | MAC 0x123E 多日分时 |
| `finance_history_catalog` | — | gpcw.txt 清单（计算服务器） |
| `finance_history_archive_save` | `{ filename }` | 下载 gpcw zip → `lake/finance_history` |
| `f10_stock_info` / `f10_topic_ids` / `f10_stock_score` / `f10_finance_diagnosis` | `{ code }` | 7615 补齐 Entry |
| `f10_industry_page` | `{ hy, section }` | 7615 行业 20 子页 |
| `offline_sync_catalog` | — | 数据集/预设/窗口状态 |
| `offline_sync_status` | — | 当前任务进度（priority 请求） |
| `offline_sync_start` | 见 `offline_sync.normalize_options` | 启动多进程并行同步 |
| `offline_sync_cancel` | — | 取消并回收 worker |
| `shutdown` | — | `"bye"` 后退出 |

成功：`{"id":1,"ok":true,"result":...}`
失败：`{"id":1,"ok":false,"error":"中文原因"}`

## 模块

| 文件 | 职责 |
| --- | --- |
| `tdx_bridge.py` | 7709 协议、解析、归档、dispatch |
| `tdx_mac.py` / `tdx_f10.py` | MAC 0x12xx / 7615 在线资料 |
| `offline_sync.py` | 离线并行同步：多进程 × 多线程 × 多服务器、08:45–15:45 窗口 |
| `code_archive.py` | 按代码/业务 key 分片的 JSONL.gz + manifest + SHA256 |
| `subscription_hub.py` | SSE/WS 订阅合并轮询（首帧基线、错误隔离、慢客户端丢帧） |
| `protocol_archive.py` | 按 `trade_date` 的整包 dataset 归档 |
| `tick_archive.py` / `auction_archive.py` / `flow_archive.py` | 逐笔/竞价/资金流按日归档 |
| `data_coverage.py` / `data_integrity.py` | 覆盖统计与 manifest/SHA256 校验 |

## 测试

```bash
python3 -m unittest discover -s python -p 'test_*.py' -v
# 或
npm run test:python
```

fixture 是 2026-10-29/30 实盘抓的真实响应，放在 `python/fixtures/*.hex`。

## 打包

```bash
pip install -r requirements.txt
python python/build.py
# 产物：python/dist/tdx-bridge（Windows：tdx-bridge.exe）
```

`electron-builder.yml` 的 `extraResources` 会把它复制到
`resources/tdx-bridge/`。**打包前必须先跑 `npm run build:python`**，
否则 electron-builder 会报找不到 `python/dist`。

注意：Nuitka 的 onefile 产物是编译后的机器码，不携带 Python 源码；
如果在意这一点，可以改用 `--onedir`，同时调整 `extraResources` 与
`bridge.ts` 里的路径。
