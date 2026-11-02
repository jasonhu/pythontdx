# StockLens 1.0.0 发布说明

- 版本：`1.0.0`
- 日期：2026-11-02
- 许可证：GPL-3.0-or-later
- 平台：Linux x64 / Windows x64 / macOS arm64
- 构建与发布：全部由 GitHub Actions 完成，产物附加到 GitHub Release
- 签名：**不购买付费证书**；Windows 使用免费自签名（CI 失败则保持未签名），macOS 使用 ad-hoc 签名

## 本版重点

### 0x0547 增量行情

- `0x0547` 已确认是按代码 `updateTime` 游标的增量刷新；
- `cursor=0` 建立基线，无新成交返回 0 条，有新成交返回 1 条并推进；
- 客户端保存 per-code cursor、缓存上一帧，0 条响应不清空；
- 部分返回按记录内「市场 + 代码」映射；
- 每 60 秒强制一次 cursor=0 基线，防游标失步；
- 未配对推送帧仍会入队/合并，但真实免费 7709 主站不做可靠主动推送：
  本项目 48 个配置主站各 5 秒、75 秒单代码、45 秒 80 代码均 0 帧；
  独立 eltdx issue #21 四层实测与维护者复验同样 0 帧，增量刷新可用。

### 实时鲁棒性

- 30 秒空闲心跳、8 秒请求超时、断线重连、跨日游标重置；
- 历史竞价服务器为空时回退永久本地归档；
- 本地 `.day/.lc1/.lc5/.5` 读/写 API 与测试；
- 板块行情列表显示指数涨跌幅，选中显示点位/涨跌幅/领涨股。

## 验证

```text
npm run check     315 TS + 168 Python（1 skipped）
npm run audit:data 39/39
build:linux / build:web / build:python 通过
```

三平台产物由 `.github/workflows/release.yml` 在 `v1.0.0` tag 上构建，构建完成后
自动创建 GitHub Release 并上传。

## 边界

- Windows 无付费证书：CI 尝试免费自签名；失败时发布未签名产物；
- macOS 为 ad-hoc 签名，未做 Developer ID 公证；
- 6 项 ⛔：研报正文、交易/下单、Level-2/付费、7727/EX、港股美股、登录/账户；
- `0x06b9` 无服务器完整目录枚举命令；
- 本地文件 API 已接，主行情 UI 仍以 7709 为主。

## 安装

- Linux：AppImage / deb
- Windows：setup.exe / portable.exe
- macOS：arm64 dmg
- 详细哈希见 GitHub Release 附件中的 `.sha256`
