# StockLens 1.0.0-rc.1 发布说明（Linux 候选）

- 版本：`1.0.0-rc.1`
- 日期：2026-11-02
- 许可证：GPL-3.0-or-later
- 状态：**release candidate / Linux x64 已打包；Windows x64、macOS arm64 待原生重打**
- 未创建 `v1.0.0` tag；已创建并推送 `v1.0.0-rc.1` tag（commit `b519d8a`）；
  `v0.14.4` tag 仍指向 `dc2bcb4`

## 本版重点

### 0x0547 增量行情

- 确认 `cursor=0` 建立基线；
- 记录内 `updateTime` 作为下一次游标，无新成交返回 0 条；
- 客户端保存 per-code cursor，空响应复用上一帧，不触发 MAC 兜底；
- 部分返回按记录内「市场 + 代码」映射，不能按请求顺序硬配；
- 未配对 `0x0547` 推送帧入队并由 `Bridge` 合并；
- 当前免费主站 **48 个配置主站各 5 秒、75 秒单代码、45 秒 80 代码**观察窗内未主动下发，
  实时链路以 1 秒增量刷新为主；不宣称所有主站永不推送。

### 实时鲁棒性

- 空闲 30 秒自动 `0x0004` 心跳；
- 8 秒请求超时、断线重连；
- 跨交易日清空游标；
- 历史竞价服务器返回 0 条时回退永久本地归档；
- 本地 `.day` 真实文件回读、`.lc1/.lc5/.5` 合成测试；
- 板块行情列表显示指数涨跌幅，选中板块显示点位/涨跌幅/领涨股。

## 验证结果

```text
npm run check     315 TS + 168 Python（1 skipped），exit 0
npm run audit:data 39/39
build:python      exit 0
build:linux       exit 0
build:web         exit 0
```

- 0x0547 探针：`INCREMENTAL_CURSOR_CONFIRMED`
- 打包 sidecar 连续两次 `refresh`：第二次无新成交仍返回上一帧
- 板块截图：`screenshots/boards-market-1.0.png`
- 真实 `sh600519.day`：2026-10-26~10-30 五根日线回读成功

## Linux 产物

| 产物 | 大小 | SHA256 |
| --- | ---: | --- |
| `StockLens-1.0.0-rc.1.AppImage` | 154,565,422 B | `bf542ba00478c42c0adc5b302bc559f016f74482aa15d6c8a533fe1230d0919b` |
| `stocklens_1.0.0-rc.1_amd64.deb` | 128,682,692 B | `6061fbd92bdf8d2e3da311260374c2fc4f33e57302db5dea327d30bc0cdbc57f` |
| `app.asar` | 3,613,001 B | `e9c97e6e7f014b0b258927b8a6c28e02a7f2ba602707d4bf5574989dbc4cf9a3` |
| `tdx-bridge` | 28,489,936 B | `381a0050917cc9d2da4f9db7994986e943aa7b4ce583e5f96f27bfa41341b581` |

产物目录：`release/1.0.0-rc.1/`

## 安装 / 启动

```bash
# AppImage
chmod +x release/1.0.0-rc.1/StockLens-1.0.0-rc.1.AppImage
./release/1.0.0-rc.1/StockLens-1.0.0-rc.1.AppImage

# deb
sudo apt install ./release/1.0.0-rc.1/stocklens_1.0.0-rc.1_amd64.deb
```

AppImage 无 FUSE 时：

```bash
./release/1.0.0-rc.1/StockLens-1.0.0-rc.1.AppImage --appimage-extract-and-run
```

## 未完成 / 边界

- Windows x64 / macOS arm64 的 1.0.0-rc.1 需在对应机器重打，不能从 Linux 交叉编译；
- `0x06b9` 有按文件名/zhb 已知清单，但无服务器完整目录枚举命令；
- 本地文件 API 已接，主行情 UI 仍以 7709 为主；
- 6 项 ⛔：研报正文、交易/下单、Level-2/付费、7727/EX、港股美股、登录/账户；
- 因此本文件是 **1.0 发布准备**，不是最终 `v1.0.0` 发布。
