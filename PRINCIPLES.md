# 工程原则

> 这份文件定义 StockLens 项目里**不可违背**的规则。
>
> 与 `docs/` 下的说明文档分工不同：
>
> - `docs/` 解释「**是什么、为什么**」——读一遍就懂的背景知识；
> - 这份文件规定「**必须怎么做**」——每次写代码都要对照的硬约束。
>
> 每条原则都有编号，代码评审、提交信息、issue 里可以直接引用（例如「违反 C3」）。

## 效力与例外

- 所有新增代码必须遵守本文件。**违反即视为未完成**，不管功能是否跑通。
- 确实需要例外时，必须：① 在代码处写明 `// 例外(X1): 具体原因`；
  ② 在提交信息里说明；③ 在 `PLAN.md` 的技术债清单里登记。
- 例外必须可复查。「赶时间」「先这样」不是理由。

---

## 一、架构原则

### A1 · 依赖方向单向，`shared` 不碰平台 API

```
renderer  ──┐
            ├──▶  shared（只有类型与纯函数）
preload   ──┘
main      ──┘
```

- `src/shared/**` **禁止** import `electron` / `node:*` / DOM API。
  它同时被 `tsconfig.node.json` 和 `tsconfig.web.json` 编译，引入平台代码必然有一侧编译失败。
- `src/renderer/**` **禁止** import `electron`。需要主进程能力时走 `window.api`。

### A2 · 主进程管 IO，渲染层管呈现

网络请求、定时器、文件读写、原生对话框**一律放主进程**（行情 socket 由主进程拉起的 Python 子进程持有）。理由：

1. 渲染层的 `fetch` 会被 CORS 拦截，也开不了 TCP（行情协议是 7709 二进制 socket）；
2. 窗口最小化时渲染进程被 Chromium 节流，`setInterval` 会漂移；
3. 将来加托盘常驻 / 多窗口时，数据源只需要一份。

**反例**：在组件里写 `setInterval(() => fetch(...))`。

### A3 · 新增 IPC 通道要同步改 5 处，类型契约先行

| 顺序 | 文件                   | 改什么                    |
| ---- | ---------------------- | ------------------------- |
| 1    | `src/shared/ipc.ts`    | `IPC` 常量表加通道名      |
| 2    | `src/shared/ipc.ts`    | `StockLensApi` 加方法签名 |
| 3    | `src/preload/index.ts` | 实现 `ipcRenderer.invoke` |
| 4    | `src/main/ipc.ts`      | 注册 `ipcMain.handle`     |
| 5    | `src/main/services/**` | 真正的业务实现            |

**先写 2、再写 3**。这样漏实现会直接编译报错，而不是运行时才炸。

### A4 · 组件不直接调 `window.api`

渲染层组件只跟 `stores/` 或 `lib/` 打交道。
`window.api` 的调用点收敛在 `lib/ipc.ts` 与 `stores/**`，
这样加统一的错误处理、日志、重试时只需要改一个地方。

### A5 · preload 只暴露白名单，绝不交出 `ipcRenderer`

```ts
// ✅ 正确：暴露具体能力
contextBridge.exposeInMainWorld('api', { quote: { snapshot: (codes) => ... } })

// ❌ 严禁：等于关掉整个隔离层
contextBridge.exposeInMainWorld('ipcRenderer', ipcRenderer)
```

---

## 二、代码原则

### C1 · 注释解释「为什么」，不解释「是什么」

```ts
// ❌ 废话：把代码翻译成中文
// 遍历数组并把价格加起来
for (const item of list) { ... }

// ✅ 有价值：解释动机、约束、踩过的坑
// 成交量是累计值，图表里需要的是「每分钟增量」
const volume = Math.max(0, cumulativeVolume - lastCumulativeVolume)
```

特别注意：**踩过的坑必须在代码里留痕**（配合 `docs/06-踩坑笔记.md`），
否则下一个人会把同一个坑再踩一遍。

### C2 · 跨进程数据必须是纯数据

`ipcRenderer.invoke` 用结构化克隆传输，**不能传** Proxy、类实例、函数、`Map`/`Set`。

Solid 的 store 是 Proxy，发送前必须转成纯对象：

```ts
// ✅ 统一走 plainGroups() 这样的转换函数
function plainGroups(groups: readonly WatchGroup[]): WatchGroup[] {
  return groups.map((g) => ({ id: g.id, name: g.name, items: g.items.map((i) => ({ ...i })) }))
}
```

### C3 · 错误必须变成可展示的中文，不把原始异常丢到界面上

- 网络层抛 `NetError`，`message` 已经是「请求超时，请检查网络连接」这种能直接显示的话；
- 渲染层统一用 `errorMessage(err)` 剥掉 Electron 的 `Error invoking remote method 'x': Error:` 外壳；
- **永远不要让 `NaN` / `Infinity` / `undefined` 出现在界面上**，用 `fixed()` 之类的格式化函数兜底成 `—`。

### C4 · 第三方字段一律可选 + 显式兜底，不用非空断言

上游接口随时可能少给字段、改变含义（港股和 A 股的字段布局就是完全不同的）。

```ts
// ✅
const peTtm: number | undefined = num(fields, 39)

// ❌
const peTtm = Number(fields[39])! // 缺失时会变成 NaN 一路传到界面上
```

**并且**：`?.` 会掩盖「路径写错」这类错误（项目里真的发生过：`raw.qt?.[code]`
语法完全合法，但那个路径永远取不到值）。关键字段必须有单元测试锁住。

### C5 · 魔法数字要么具名，要么注释说明来源

```ts
// ❌
if (fields.length < 10) continue

// ✅
/** 单次实时请求的代码数量上限（URL 长度与接口限制的折中） */
const BATCH_SIZE = 60
```

接口字段下标（`fields[37]`）属于例外：它们必须集中在一个解析函数里，
并在 `docs/03-通达信行情手册.md` 里有对应表格。

---

## 三、数据原则

### D1 · 一切上游请求必须有超时

`AbortSignal.timeout()` 是底线。没有超时的网络请求等于给自己埋一个永久挂起的坑。

### D2 · 缓存要有 TTL，并发要合并

同一个 key 的并发调用必须共享同一个 Promise（见 `TtlCache.resolve`）。
理由：上游出问题时，**失败不写缓存**，界面重试会瞬间打出几十个真实请求 ——
这是项目里真实发生过的「重试风暴」。

### D3 · 解析层必须是纯函数

`python/tdx_bridge.py` 里的 `parse_quotes` / `parse_bars` / `parse_today_minute` 等函数
不允许出现 socket、`time.time()`（时间由调用方传入）、缓存或全局状态。
这样才能拿真实报文直接写单元测试。

### D4 · 接口相关的改动必须同时更新「三件套」

改动解析逻辑时，必须同步：

1. `docs/03-通达信行情手册.md` 的字段表；
2. `python/test_tdx.py` 的用例（用真实报文当 fixture）；
3. 解析函数里的兜底逻辑。

只改代码不改文档与测试的接口改动，一律视为未完成。

### D5 · 区分交易时段与非交易时段

盘后继续用 3 秒轮询是对上游的浪费，也是被限流的常见原因。
新增任何轮询逻辑都要问一句：非交易时段它该怎么表现？

---

## 四、界面原则

### U1 · 所有视觉参数取自 `tokens.css`，禁止硬编码

颜色、圆角、间距、动效时长、字体族 —— 一律用 CSS 变量。

```css
/* ❌ */
color: #e9edf7;
padding: 14px;
/* ✅ */
color: var(--text-1);
padding: var(--sp-4);
```

唯一例外是图表里的线条颜色（由 `toneColor()` 统一返回变量引用）。

### U2 · 数字必须等宽

所有数字元素加 `class="num"`（内部是 `font-variant-numeric: tabular-nums` + 数字专用字体）。
否则价格每秒刷新时整行宽度会来回抖动，观感非常廉价。

### U3 · 涨跌色只能通过 `toneOf()` 判定

不允许在组件里写 `value > 0 ? 'up' : 'down'`。红涨绿跌的语义必须在全 App 保持一致，
包括文字、标签底色、盘口量条、图表折线、成交量柱。

### U4 · 默认窗口尺寸下一屏无滚动条

这是硬约束，不是「尽量」。实现手段见 `docs/04-UI设计系统.md`：
高度锁死 + 只有图表吸收余量 + 列表行按可用高度均分。

### U5 · 视觉改动必须截图确认

```powershell
npm run shot
```

类型检查和单元测试**永远抓不到**布局溢出、颜色不可读、图表画歪。
「我觉得应该没问题」不算验证。

### U6 · 图表按真实像素绘制

用 `ResizeObserver` 量容器尺寸后按真实像素画，**不要**用 `viewBox` 缩放 ——
那会把线宽和文字一起拉伸变形。

---

## 五、质量原则

### Q1 · 提交前 `npm run check` 必须全绿

一条命令跑完类型检查 + Lint + 单元测试。任何一项红着都不许提交。

### Q2 · 修 bug 必须补回归测试

先写一个能复现 bug 的失败测试，再改代码让它变绿。
项目里两个真实 bug（分时昨收为 0、`000858` 判错市场）都是这么被永久钉住的。

### Q3 · 声称「完成」之前必须有可复现的验证证据

可以说的：「`npm run check` 退出码 0」「截图见 `screenshots/app.png`」「实测日志如下」。
不可以说的：「应该可以了」「理论上没问题」。

**验证不了的事情必须明说**。例如拖拽交互无法用截图工具验证，
就应该明确告诉用户「这条路径需要你手动试一下」，而不是默认它没问题。

### Q4 · 提交信息写清「做了什么 + 为什么」

格式：`<type>: <一句话总结>` + 分类要点。
修 bug 的提交要写清**根因**，而不只是现象。

---

## 六、协作原则

### E1 · 文件编辑只用专用工具，shell 只跑命令

- 读用 Read、改用 Edit/Write、搜索用 Grep/Glob；
- PowerShell **仅**用于构建 / 测试 / git 等命令执行；
- **禁止**用 shell 做字符串替换式文件编辑。

原因：转义歧义、编码转换、正则误切已经多次造成文件损坏且静默失败。

### E2 · 不确定就问，不要猜

需求有歧义时先问清楚，比做完了再返工便宜得多。
但**能自己查证的不要问**（读代码、跑接口探针、看文档）。

### E3 · 报告要包含失败与不确定

不要只报喜。构建失败、测试没过、某条路径没验证 —— 都要说。
用户需要的是真实状态，不是好看的状态。

### E4 · 大改动先给方案，再动手

涉及架构调整、数据结构变更、新增依赖时，先说明方案与取舍，
得到确认后再实施。小改动（改文案、调间距）直接做。
