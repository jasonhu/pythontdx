# 通达信 Python 桥接进程

Electron 主进程通过 stdin/stdout 的 JSON Lines 与这个进程通信。
它只依赖 Python 标准库，不需要 pytdx / eltdx。

## 为什么单独一个进程

- 用户希望通讯层用 Python；
- Python 侧只做 TCP + 二进制协议 + 解析，TS 侧继续管窗口、缓存、拼音搜索；
- 打包时用 PyInstaller 打成单文件，用户机器不需要安装 Python。

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
STOCKLENS_PYTHON=/usr/bin/python3 npm run dev
STOCKLENS_TDX_BRIDGE=/path/to/tdx-bridge npm run dev
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
| `kline` | `{ code, period, count }` | `KLineSeries` |
| `minute` | `{ code }` | `MinuteTrend` |
| `five_day` | `{ code }` | `MultiDayTrend` |
| `shutdown` | — | `"bye"` 后退出 |

成功：`{"id":1,"ok":true,"result":...}`
失败：`{"id":1,"ok":false,"error":"中文原因"}`

## 测试

```bash
python3 -m unittest discover -s python -p 'test_*.py' -v
# 或
npm run test:python
```

fixture 是 2026-10-29/30 实盘抓的真实响应，放在 `python/fixtures/*.hex`。

## 打包

```bash
pip install pyinstaller
python python/build.py
# 产物：python/dist/tdx-bridge（Windows：tdx-bridge.exe）
```

`electron-builder.yml` 的 `extraResources` 会把它复制到
`resources/tdx-bridge/`。**打包前必须先跑 `npm run build:python`**，
否则 electron-builder 会报找不到 `python/dist`。

注意：PyInstaller 的 onefile 产物在 Windows 上可能被杀软误报；
如果在意这一点，可以改用 `--onedir`，同时调整 `extraResources` 与
`bridge.ts` 里的路径。
