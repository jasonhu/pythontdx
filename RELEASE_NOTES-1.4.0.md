# pythontdx 1.4.0 发布说明（RC 候选）

- 版本：`1.4.0-rc17`
- 日期：2026-11-04
- 状态：**本地 RC，未打 tag、未发 Release**；人工验收通过后才打 `v1.4.0`
- 平台：Windows x64（本机 RC）；正式版再出 Linux x64 / macOS arm64

## 重点：离线 K 线下载重做

### 日 K：官方 `.day` 文件

- `0x06b9` 直接下载 `vipdoc/{sh,sz,bj}/lday/<code>.day`；
- 600519 实测 193,120 字节、7 个块、6,035 根，最后 2026-11-04；
- 100 只 16×4 实测 **6.2 秒**；
- 失败自动回退 0x052d 分页。

### 1 分钟 K：100 个交易日

- `kline_1m` 与日 K 独立；
- 服务端实际约 92 个交易日（22,080 根/只），请求 100 日返回全部可用；
- 优先复用本地 1m 全历史缓存，只补最新页；
- 100 只实测：48×4 **8.2 秒**，8×4 **12.3 秒**。

### Parquet 写入

- 逐行 DuckDB INSERT → 临时 CSV staging + `COPY`；
- 2.2 万行约 **4 秒 → 0.19 秒/文件**；
- 最终仍是 Parquet+ZSTD+manifest+SHA256，CSV 写完即删。

## 中断恢复

- 最近任务摘要保留 `completed/failed/incomplete/cancelled`、计划/完成/失败/行数、
  数据集、目录、完成时间；
- 失败/中断可「继续未完成任务（跳过已有）」；
- 「自动续跑」默认开启，桥接重启后自动续跑最近一次 `incomplete` 一次；
- Windows worker 看门狗改用 `OpenProcess + WaitForSingleObject`，不再误发 Ctrl+C；
- 父进程退出后 worker 自动退出，不再留下 48 个孤儿进程吃 CPU。

## 官方 1 分钟通道调查结论

- 本地是 `vipdoc/*/minline/*.lc1` 文件；
- 但 7719 文件服务对 `.lc1` 返回 `size=0`，没有 HTTP 文件 URL；
- 官方 1m 是行情协议抓取后写 `.lc1`，因此本项目继续用 0x052d，不伪造文件通道。

## 验证

- `npm run check`：359 TS（357 通过/2 skipped）+ 283 Python（282 通过/1 skipped）；
- 日 K 100 只：16×4 6.2s、48×4 12.2s；
- 1m 100 只：48×4 8.2s、8×4 12.3s；
- 数据完整性：最近全量任务仍有中断，摘要会明确标 `incomplete`，可续跑。

## RC 产物

```text
release/1.4.0-rc17/pythontdx-1.4.0-rc17-setup.exe        d5968878…e5c5
release/1.4.0-rc17/pythontdx-1.4.0-rc17-portable.exe     8b09f56e…9d79
release/1.4.0-rc17/pythontdx-1.4.0-rc17-win-x64.zip      f97cd069…5ff83
```

正式版资产与 SHA256 在 `v1.4.0` 发布时补齐。
