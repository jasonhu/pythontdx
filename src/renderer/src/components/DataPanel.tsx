/**
 * 数据工具：下载 zhb.zip、查看 tdxstat 摘要、写规范化层。
 *
 * 只做只读数据管理，不碰交易；导出路径由 Python 后端决定并在界面上明确展示。
 */
import { createSignal, For, onMount, Show, type JSX } from 'solid-js'
import type {
  StatsCsvExport,
  StatsParquetExport,
  StatsQueryResult,
  TdxStatsExport,
  TdxStatsSummary,
  LocalDayResult,
  LocalImportResult,
  LocalDayWriteResult,
  DataInventory,
  KLineCacheResult,
  KLineExportResult,
  SnapshotArchiveResult,
  SnapshotArchiveItem,
  BlockKind
} from '@shared/types'
import { thousands } from '@shared/format'
import { appState, updateSettings, watchCodes } from '../stores/app'
import { api, errorMessage } from '../lib/ipc'
import { downloadText } from '../lib/download'
import { toCsv } from '@shared/csv'
import { IconClose } from './Icons'

interface DataPanelProps {
  onClose: () => void
}

type DownloadKey = 'kline' | 'kline1m' | 'indexKline' | 'blocks' | 'snapshot' | 'stats' | 'archive'

const DOWNLOAD_TASKS: Array<{ key: DownloadKey; label: string; hint: string }> = [
  { key: 'kline', label: '日 K 缓存', hint: '自选/全 A，全历史自动探测' },
  { key: 'kline1m', label: '1 分钟 K 缓存', hint: '自选/全 A，全历史自动探测' },
  { key: 'indexKline', label: '指数 K 缓存', hint: 'ZS 指数全历史' },
  { key: 'blocks', label: '板块文件', hint: '概念/风格/指数/一般' },
  { key: 'snapshot', label: '全市场快照', hint: 'MAC 报价导出 CSV' },
  { key: 'stats', label: 'TDX 统计', hint: 'zhb.zip + 规范化 tdxstat' },
  { key: 'archive', label: '数据湖归档', hint: '全市场快照按 trade_date 归档' }
]

const BLOCK_KINDS: BlockKind[] = ['gn', 'fg', 'zs', 'general']

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes} B`
}

export function DataPanel(props: DataPanelProps): JSX.Element {
  const [summary, setSummary] = createSignal<TdxStatsSummary | null>(null)
  const [exported, setExported] = createSignal<TdxStatsExport | null>(null)
  const [loading, setLoading] = createSignal(false)
  const [exporting, setExporting] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  const [sql, setSql] = createSignal(
    'SELECT stats_date, code, beta60, pe_ttm FROM tdxstat ORDER BY stats_date DESC, code LIMIT 20'
  )
  const [querying, setQuerying] = createSignal(false)
  const [query, setQuery] = createSignal<StatsQueryResult | null>(null)
  const [queryError, setQueryError] = createSignal<string | null>(null)
  const [engine, setEngine] = createSignal<'sqlite' | 'duckdb' | 'local'>('sqlite')
  const [csvExporting, setCsvExporting] = createSignal(false)
  const [csvResult, setCsvResult] = createSignal<StatsCsvExport | null>(null)
  const [parquetExporting, setParquetExporting] = createSignal(false)
  const [parquetResult, setParquetResult] = createSignal<StatsParquetExport | null>(null)
  const [localPath, setLocalPath] = createSignal(appState.settings.localDayPath ?? '')
  const [klineExporting, setKlineExporting] = createSignal(false)
  const [klineExport, setKlineExport] = createSignal<KLineExportResult | null>(null)
  const [klinePeriod, setKlinePeriod] = createSignal('day')
  const [klineCount, setKlineCount] = createSignal(240)
  const [cacheLoading, setCacheLoading] = createSignal(false)
  const [cacheResult, setCacheResult] = createSignal<KLineCacheResult | null>(null)
  const [cacheError, setCacheError] = createSignal<string | null>(null)
  const [inventory, setInventory] = createSignal<DataInventory | null>(null)
  const [inventoryLoading, setInventoryLoading] = createSignal(true)
  const [inventoryError, setInventoryError] = createSignal<string | null>(null)
  const [bulkRunning, setBulkRunning] = createSignal(false)
  const [bulkScope, setBulkScope] = createSignal<'watchlist' | 'all'>('watchlist')
  const [bulkDone, setBulkDone] = createSignal(0)
  const [bulkTotal, setBulkTotal] = createSignal(0)
  const [bulkSkipped, setBulkSkipped] = createSignal(0)
  const [bulkFailed, setBulkFailed] = createSignal(0)
  const [bulkIncremental, setBulkIncremental] = createSignal(true)
  const [bulkFullHistory, setBulkFullHistory] = createSignal(true)
  const [bulkPeriod, setBulkPeriod] = createSignal<'day' | '1m'>('day')
  const [bulkError, setBulkError] = createSignal<string | null>(null)
  const [downloadSelection, setDownloadSelection] = createSignal<Record<DownloadKey, boolean>>({
    kline: true,
    kline1m: true,
    indexKline: true,
    blocks: true,
    snapshot: true,
    stats: true,
    archive: true
  })
  const [downloadRunning, setDownloadRunning] = createSignal(false)
  const [downloadDone, setDownloadDone] = createSignal(0)
  const [downloadTotal, setDownloadTotal] = createSignal(0)
  const [downloadMessage, setDownloadMessage] = createSignal('')
  const [downloadError, setDownloadError] = createSignal<string | null>(null)
  let bulkCancel = false
  const [klineExportError, setKlineExportError] = createSignal<string | null>(null)
  const [snapshotExporting, setSnapshotExporting] = createSignal(false)
  const [snapshotResult, setSnapshotResult] = createSignal<number | null>(null)
  const [snapshotError, setSnapshotError] = createSignal<string | null>(null)
  const [archiving, setArchiving] = createSignal(false)
  const [archive, setArchive] = createSignal<SnapshotArchiveResult | null>(null)
  const [archiveError, setArchiveError] = createSignal<string | null>(null)
  const [archives, setArchives] = createSignal<SnapshotArchiveItem[]>([])
  const [archivesLoading, setArchivesLoading] = createSignal(false)
  const [archivesError, setArchivesError] = createSignal<string | null>(null)
  const [localDay, setLocalDay] = createSignal<LocalDayResult | null>(null)
  const [localLoading, setLocalLoading] = createSignal(false)
  const [localError, setLocalError] = createSignal<string | null>(null)
  const [importLoading, setImportLoading] = createSignal(false)
  const [importResult, setImportResult] = createSignal<LocalImportResult | null>(null)
  const [importError, setImportError] = createSignal<string | null>(null)
  const [writeLoading, setWriteLoading] = createSignal(false)
  const [writeResult, setWriteResult] = createSignal<LocalDayWriteResult | null>(null)
  const [writeError, setWriteError] = createSignal<string | null>(null)

  const loadInventory = async (): Promise<void> => {
    setInventoryLoading(true)
    setInventoryError(null)
    try {
      setInventory(await api.data.inventory())
    } catch (cause) {
      setInventoryError(errorMessage(cause))
    } finally {
      setInventoryLoading(false)
    }
  }

  const loadArchives = async (): Promise<void> => {
    setArchivesLoading(true)
    setArchivesError(null)
    try {
      setArchives(await api.data.lakeArchives(20))
    } catch (cause) {
      setArchivesError(errorMessage(cause))
    } finally {
      setArchivesLoading(false)
    }
  }

  const runArchive = async (): Promise<void> => {
    if (archiving()) return
    setArchiving(true)
    setArchiveError(null)
    try {
      setArchive(await api.data.archiveSnapshot())
      await loadArchives()
    } catch (cause) {
      setArchiveError(errorMessage(cause))
    } finally {
      setArchiving(false)
    }
  }

  const runSnapshotExport = async (): Promise<void> => {
    if (snapshotExporting()) return
    setSnapshotExporting(true)
    setSnapshotError(null)
    try {
      const catalog = await api.quote.catalog()
      const codes = catalog
        .filter(
          (item) =>
            item.kind === 'GP-A' &&
            ((item.market === 'SH' && /^(600|601|603|605|688|689)/.test(item.symbol)) ||
              (item.market === 'SZ' && /^(000|001|002|003|300|301|302)/.test(item.symbol)) ||
              (item.market === 'BJ' && /^[489]/.test(item.symbol)))
        )
        .map((item) => item.code)
      const quotes = []
      for (let start = 0; start < codes.length; start += 500) {
        quotes.push(...(await api.quote.macQuotes(codes.slice(start, start + 500))))
      }
      downloadText(
        `stocklens-market-snapshot-${new Date().toISOString().slice(0, 10)}.csv`,
        toCsv(
          ['代码', '名称', '现价', '昨收', '涨跌幅', '成交额', '换手率', '量比', '涨速'],
          quotes.map((quote) => [
            quote.code,
            quote.name,
            quote.price,
            quote.prevClose,
            quote.changePct,
            quote.amount,
            quote.turnoverRate ?? '',
            quote.volumeRatio ?? '',
            quote.riseSpeed ?? ''
          ])
        )
      )
      setSnapshotResult(quotes.length)
    } catch (cause) {
      setSnapshotError(errorMessage(cause))
    } finally {
      setSnapshotExporting(false)
    }
  }

  const runKlineExport = async (): Promise<void> => {
    if (klineExporting()) return
    setKlineExporting(true)
    setKlineExportError(null)
    try {
      setKlineExport(
        await api.data.exportKlines({
          codes: watchCodes(),
          period: klinePeriod(),
          count: klineCount(),
          adjust: 'qfq'
        })
      )
    } catch (cause) {
      setKlineExportError(errorMessage(cause))
    } finally {
      setKlineExporting(false)
    }
  }

  const allAShareCodes = async (): Promise<string[]> => {
    const catalog = await api.quote.catalog()
    return catalog
      .filter(
        (item) =>
          item.kind === 'GP-A' &&
          ((item.market === 'SH' && /^(600|601|603|605|688|689)/.test(item.symbol)) ||
            (item.market === 'SZ' && /^(000|001|002|003|300|301|302)/.test(item.symbol)) ||
            (item.market === 'BJ' && /^[489]/.test(item.symbol)))
      )
      .map((item) => item.code)
  }

  const runBulkCache = async (period = bulkPeriod()): Promise<void> => {
    if (bulkRunning()) return
    bulkCancel = false
    setBulkRunning(true)
    setBulkError(null)
    setBulkDone(0)
    setBulkSkipped(0)
    setBulkFailed(0)
    setBulkTotal(0)
    try {
      const codes = bulkScope() === 'watchlist' ? watchCodes() : await allAShareCodes()
      setBulkTotal(codes.length)
      const full = bulkFullHistory()
      const chunkSize = full ? 1 : 10
      for (let start = 0; start < codes.length && !bulkCancel; start += chunkSize) {
        const chunk = codes.slice(start, start + chunkSize)
        try {
          const result = full
            ? await api.data.fullCacheKlines({
                codes: chunk,
                period,
                adjust: 'none',
                skipExisting: bulkIncremental()
              })
            : await api.data.cacheKlines({
                codes: chunk,
                period,
                count: 800,
                adjust: 'qfq',
                skipExisting: bulkIncremental()
              })
          setBulkDone((value) => value + result.cached + result.skipped)
          setBulkSkipped((value) => value + result.skipped)
          setBulkFailed((value) => value + result.failed.length)
        } catch {
          setBulkFailed((value) => value + chunk.length)
        }
      }
    } catch (cause) {
      setBulkError(errorMessage(cause))
    } finally {
      setBulkRunning(false)
    }
  }

  const runIndexCache = async (): Promise<void> => {
    if (bulkRunning()) return
    bulkCancel = false
    setBulkRunning(true)
    setBulkError(null)
    setBulkDone(0)
    setBulkSkipped(0)
    setBulkFailed(0)
    setBulkTotal(0)
    try {
      const catalog = await api.quote.catalog()
      const codes = catalog.filter((item) => item.kind === 'ZS').map((item) => item.code)
      setBulkTotal(codes.length)
      for (const code of codes) {
        if (bulkCancel) break
        try {
          const result = await api.data.fullCacheKlines({
            codes: [code],
            period: 'day',
            adjust: 'none',
            skipExisting: bulkIncremental()
          })
          setBulkDone((value) => value + result.cached + result.skipped)
          setBulkSkipped((value) => value + result.skipped)
          setBulkFailed((value) => value + result.failed.length)
        } catch {
          setBulkFailed((value) => value + 1)
        }
      }
    } catch (cause) {
      setBulkError(errorMessage(cause))
    } finally {
      setBulkRunning(false)
    }
  }

  const toggleDownload = (key: DownloadKey): void => {
    setDownloadSelection((current) => ({ ...current, [key]: !current[key] }))
  }

  const selectAllDownloads = (value: boolean): void => {
    setDownloadSelection({
      kline: value,
      kline1m: value,
      indexKline: value,
      blocks: value,
      snapshot: value,
      stats: value,
      archive: value
    })
  }

  const runDownloads = async (): Promise<void> => {
    if (downloadRunning()) return
    const keys = DOWNLOAD_TASKS.filter((task) => downloadSelection()[task.key]).map(
      (task) => task.key
    )
    if (keys.length === 0) {
      setDownloadError('至少选择一项离线数据')
      return
    }

    setDownloadRunning(true)
    setDownloadError(null)
    setDownloadDone(0)
    setDownloadTotal(keys.length)
    let done = 0
    try {
      for (const key of keys) {
        const task = DOWNLOAD_TASKS.find((item) => item.key === key)
        setDownloadMessage(`正在下载：${task?.label ?? key}`)
        if (key === 'kline') await runBulkCache('day')
        else if (key === 'kline1m') await runBulkCache('1m')
        else if (key === 'indexKline') await runIndexCache()
        else if (key === 'blocks') {
          for (const kind of BLOCK_KINDS) await api.block.list(kind)
        } else if (key === 'snapshot') await runSnapshotExport()
        else if (key === 'stats') await runExport()
        else await runArchive()
        done += 1
        setDownloadDone(done)
      }
      setDownloadMessage('全部选中任务已完成')
    } catch (cause) {
      setDownloadError(errorMessage(cause))
    } finally {
      setDownloadRunning(false)
    }
  }

  const runCacheKlines = async (): Promise<void> => {
    if (cacheLoading()) return
    setCacheLoading(true)
    setCacheError(null)
    try {
      setCacheResult(
        await api.data.cacheKlines({
          codes: watchCodes(),
          period: 'day',
          count: 800,
          adjust: 'qfq'
        })
      )
    } catch (cause) {
      setCacheError(errorMessage(cause))
    } finally {
      setCacheLoading(false)
    }
  }

  const loadSummary = async (): Promise<void> => {
    if (loading()) return
    setLoading(true)
    setError(null)
    try {
      setSummary(await api.data.statsSummary())
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setLoading(false)
    }
  }

  const runExport = async (): Promise<void> => {
    if (exporting()) return
    setExporting(true)
    setError(null)
    try {
      const result = await api.data.statsExport()
      setExported(result)
      setSummary(null)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setExporting(false)
    }
  }

  const runCsv = async (): Promise<void> => {
    if (csvExporting()) return
    setCsvExporting(true)
    setError(null)
    try {
      setCsvResult(await api.data.statsCsv())
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setCsvExporting(false)
    }
  }

  const runParquet = async (): Promise<void> => {
    if (parquetExporting()) return
    setParquetExporting(true)
    setError(null)
    try {
      setParquetResult(await api.data.statsParquet())
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setParquetExporting(false)
    }
  }

  const outputPath = (): string => {
    const source = localPath().trim()
    if (!source) return ''
    const match = source.match(/\.[^.\\/]+$/)
    if (!match) return `${source}.out.day`
    return `${source.slice(0, -match[0].length)}.out${match[0].toLowerCase()}`
  }

  const runLocalWrite = async (): Promise<void> => {
    const data = localDay()
    if (!data || writeLoading()) return
    setWriteLoading(true)
    setWriteError(null)
    try {
      const target = outputPath()
      setWriteResult(
        target.toLowerCase().endsWith('.day')
          ? await api.data.localDayWrite(target, data.bars)
          : await api.data.localMinWrite(target, data.bars)
      )
    } catch (cause) {
      setWriteError(errorMessage(cause))
    } finally {
      setWriteLoading(false)
    }
  }

  const runLocalImport = async (): Promise<void> => {
    if (importLoading()) return
    const path = localPath().trim()
    if (!path) {
      setImportError('请先读取本地文件')
      return
    }
    setImportLoading(true)
    setImportError(null)
    try {
      setImportResult(await api.data.localImport(path))
      updateSettings({ localDayPath: path })
    } catch (cause) {
      setImportError(errorMessage(cause))
    } finally {
      setImportLoading(false)
    }
  }

  const exportLocalCsv = (): void => {
    const data = localDay()
    if (!data) return
    const header = 'date,open,high,low,close,amount,volume\n'
    const body = data.bars
      .map((bar) =>
        [bar.date, bar.open, bar.high, bar.low, bar.close, bar.amount, bar.volume].join(',')
      )
      .join('\n')
    const blob = new Blob([`\ufeff${header}${body}`], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${data.path.split(/[\\/]/).pop() ?? 'local'}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const runLocalDay = async (): Promise<void> => {
    if (localLoading()) return
    const path = localPath().trim()
    if (!path) {
      setLocalError('请输入 .day 文件绝对路径')
      return
    }
    setLocalLoading(true)
    setLocalError(null)
    try {
      setLocalDay(await api.data.localDay(path, 500))
      updateSettings({ localDayPath: path })
    } catch (cause) {
      setLocalDay(null)
      setLocalError(errorMessage(cause))
    } finally {
      setLocalLoading(false)
    }
  }

  const runQuery = async (): Promise<void> => {
    if (querying()) return
    setQuerying(true)
    setQueryError(null)
    try {
      setQuery(
        engine() === 'duckdb'
          ? await api.data.duckQuery(sql(), 100)
          : engine() === 'local'
            ? await api.data.localQuery(sql(), 100)
            : await api.data.statsQuery(sql(), 100)
      )
    } catch (cause) {
      setQuery(null)
      setQueryError(errorMessage(cause))
    } finally {
      setQuerying(false)
    }
  }

  onMount(() => void loadInventory())

  return (
    <div class="data-backdrop" onClick={() => props.onClose()}>
      <section
        class="data-panel"
        role="dialog"
        aria-modal="true"
        aria-label="数据工具"
        onClick={(event) => event.stopPropagation()}
      >
        <header class="data__head">
          <div>
            <div class="data__eyebrow">0x06b9 · 原始文件 / 规范化层</div>
            <h2 class="data__title">数据工具</h2>
          </div>
          <button
            class="btn btn--icon btn--bare"
            title="关闭数据工具"
            onClick={() => props.onClose()}
          >
            <IconClose size={16} />
          </button>
        </header>

        <div class="data__body">
          <div class="data__intro">
            下载官方 <code>zhb.zip</code>，先看摘要；规范化会写原始 ZIP、按交易日分区的
            JSONL.gz、SQLite 查询层和 manifest。
          </div>

          <section class="data__download">
            <div class="data__inventory-head">
              <div>
                <div class="data__label">离线数据下载</div>
                <div class="data__sub">勾选数据集后一键执行，进度按任务汇总。</div>
              </div>
              <div class="data__download-select">
                <button
                  class="btn"
                  disabled={downloadRunning()}
                  onClick={() => selectAllDownloads(true)}
                >
                  全选
                </button>
                <button
                  class="btn"
                  disabled={downloadRunning()}
                  onClick={() => selectAllDownloads(false)}
                >
                  清空
                </button>
              </div>
            </div>

            <div class="data__download-list">
              <For each={DOWNLOAD_TASKS}>
                {(task) => (
                  <label class="data__download-item">
                    <input
                      type="checkbox"
                      checked={downloadSelection()[task.key]}
                      disabled={downloadRunning()}
                      onChange={() => toggleDownload(task.key)}
                    />
                    <span>
                      <strong>{task.label}</strong>
                      <small>{task.hint}</small>
                    </span>
                  </label>
                )}
              </For>
            </div>

            <div class="data__download-actions">
              <select
                class="data__bulk-scope"
                value={bulkScope()}
                disabled={downloadRunning() || !downloadSelection().kline}
                onChange={(event) => setBulkScope(event.currentTarget.value as 'watchlist' | 'all')}
              >
                <option value="watchlist">K 线：仅自选</option>
                <option value="all">K 线：全 A 股</option>
              </select>
              <label class="data__incremental">
                <input
                  type="checkbox"
                  checked={bulkIncremental()}
                  disabled={downloadRunning()}
                  onChange={() => setBulkIncremental((value) => !value)}
                />
                增量：跳过已有
              </label>
              <label class="data__incremental">
                <input
                  type="checkbox"
                  checked={bulkFullHistory()}
                  disabled={downloadRunning()}
                  onChange={() => setBulkFullHistory((value) => !value)}
                />
                全部历史（自动探测）
              </label>
              <button
                class="btn btn--primary data__download-run"
                disabled={downloadRunning()}
                onClick={() => void runDownloads()}
              >
                {downloadRunning() ? '下载中…' : '开始下载'}
              </button>
            </div>

            <Show when={downloadTotal() > 0}>
              <div class="data__bulk-progress">
                <span
                  style={{
                    width: `${Math.min(100, (downloadDone() / downloadTotal()) * 100)}%`
                  }}
                />
              </div>
              <div class="data__bulk-meta">
                {downloadDone()} / {downloadTotal()} 项 · {downloadMessage()}
              </div>
            </Show>
            <Show when={downloadError()}>
              {(message) => <div class="data__query-error">{message()}</div>}
            </Show>
          </section>

          <section class="data__inventory">
            <div class="data__inventory-head">
              <div>
                <div class="data__label">本地离线数据</div>
                <div class="data__sub">
                  扫描 raw / cache / lake / exports / normalized / local 六个目录。
                </div>
              </div>
              <button
                class="btn data__inventory-refresh"
                disabled={inventoryLoading()}
                onClick={() => void loadInventory()}
              >
                {inventoryLoading() ? '扫描中…' : '重新扫描'}
              </button>
            </div>
            <Show when={inventoryError()}>
              {(message) => <div class="data__query-error">{message()}</div>}
            </Show>
            <Show when={inventory()}>
              {(data) => (
                <>
                  <div class="data__path">
                    <span>数据根目录</span>
                    <code>{data().root}</code>
                  </div>
                  <div class="data__inventory-grid">
                    <For
                      each={
                        [
                          ['raw', '原始报文'],
                          ['cache', 'K 线缓存'],
                          ['lake', '数据湖'],
                          ['exports', '导出'],
                          ['normalized', '规范化'],
                          ['local', '本地文件']
                        ] as const
                      }
                    >
                      {([key, label]) => (
                        <div class="data__metric">
                          <span>{label}</span>
                          <strong>
                            {data()[key].files} 文件 / {formatBytes(data()[key].bytes)}
                          </strong>
                        </div>
                      )}
                    </For>
                  </div>
                  <div class="data__kline-manifest">
                    K 线缓存：{data().klineCache.files} 文件 · {data().klineCache.codes} 只 ·{' '}
                    {data().klineCache.periods.join(' / ') || '无'} · 最近{' '}
                    {data().klineCache.latest > 0
                      ? new Date(data().klineCache.latest).toLocaleString('zh-CN')
                      : '无'}
                  </div>
                </>
              )}
            </Show>
          </section>

          <section class="data__bulk">
            <div>
              <div class="data__label">批量预热日 K</div>
              <div class="data__sub">
                分批写入本地缓存；全 A 模式约 5,615 只，耗时较长，可随时取消。
              </div>
            </div>
            <div class="data__bulk-actions">
              <select
                class="data__bulk-scope"
                value={bulkScope()}
                disabled={bulkRunning()}
                onChange={(event) => setBulkScope(event.currentTarget.value as 'watchlist' | 'all')}
              >
                <option value="watchlist">仅自选</option>
                <option value="all">全 A 股</option>
              </select>
              <select
                class="data__bulk-scope"
                value={bulkPeriod()}
                disabled={bulkRunning()}
                onChange={(event) => setBulkPeriod(event.currentTarget.value as 'day' | '1m')}
              >
                <option value="day">日 K</option>
                <option value="1m">1 分钟</option>
              </select>
              <label class="data__incremental">
                <input
                  type="checkbox"
                  checked={bulkIncremental()}
                  disabled={bulkRunning()}
                  onChange={() => setBulkIncremental((value) => !value)}
                />
                增量：跳过已有
              </label>
              <label class="data__incremental">
                <input
                  type="checkbox"
                  checked={bulkFullHistory()}
                  disabled={bulkRunning()}
                  onChange={() => setBulkFullHistory((value) => !value)}
                />
                全部历史（自动探测）
              </label>
              <Show
                when={bulkRunning()}
                fallback={
                  <button class="btn data__bulk-run" onClick={() => void runBulkCache()}>
                    开始预热
                  </button>
                }
              >
                <button
                  class="btn data__bulk-cancel"
                  onClick={() => {
                    bulkCancel = true
                  }}
                >
                  停止
                </button>
              </Show>
            </div>
            <Show when={bulkTotal() > 0}>
              <div class="data__bulk-progress">
                <span
                  style={{
                    width: `${Math.min(100, ((bulkDone() + bulkFailed()) / bulkTotal()) * 100)}%`
                  }}
                />
              </div>
              <div class="data__bulk-meta">
                {bulkDone()} / {bulkTotal()} 完成 · 跳过 {bulkSkipped()} · 失败 {bulkFailed()}
                {bulkRunning() ? ' · 进行中' : ' · 已结束'}
              </div>
            </Show>
            <Show when={bulkError()}>
              {(message) => <div class="data__query-error">{message()}</div>}
            </Show>
          </section>

          <section class="data__kline">
            <div>
              <div class="data__label">自选 K 线导出</div>
              <div class="data__sub">
                最近 {klineCount()} 根
                {klinePeriod() === 'day' ? '日' : klinePeriod() === 'week' ? '周' : '月'} K，CSV +
                JSONL.gz + manifest。
              </div>
            </div>
            <div class="data__kline-options">
              <select
                class="data__kline-period"
                value={klinePeriod()}
                onChange={(event) => setKlinePeriod(event.currentTarget.value)}
              >
                <option value="day">日 K</option>
                <option value="week">周 K</option>
                <option value="month">月 K</option>
              </select>
              <select
                class="data__kline-count"
                value={String(klineCount())}
                onChange={(event) => setKlineCount(Number(event.currentTarget.value))}
              >
                <option value="120">120 根</option>
                <option value="240">240 根</option>
                <option value="480">480 根</option>
              </select>
              <button
                class="btn data__kline-export"
                disabled={klineExporting() || watchCodes().length === 0}
                onClick={() => void runKlineExport()}
              >
                {klineExporting() ? '导出中…' : `导出 ${watchCodes().length} 只`}
              </button>
            </div>
          </section>
          <section class="data__cache">
            <div>
              <div class="data__label">离线 K 线缓存</div>
              <div class="data__sub">
                为自选股预热最近 800 根前复权日 K；行情失败时图表自动回退到本地缓存。
              </div>
            </div>
            <button
              class="btn data__cache-run"
              disabled={cacheLoading() || watchCodes().length === 0}
              onClick={() => void runCacheKlines()}
            >
              {cacheLoading() ? '缓存中…' : `缓存 ${watchCodes().length} 只`}
            </button>
          </section>
          <Show when={cacheError()}>
            {(message) => <div class="data__query-error">{message()}</div>}
          </Show>
          <Show when={cacheResult()}>
            {(data) => (
              <div class="data__summary data__summary--kline">
                <div class="data__path">
                  <span>缓存目录</span>
                  <code>{data().dir}</code>
                </div>
                <div class="data__path">
                  <span>结果</span>
                  <code>
                    {data().cached} 只 / {data().count} 根 / 失败 {data().failed.length} 只
                  </code>
                </div>
              </div>
            )}
          </Show>

          <Show when={klineExportError()}>
            {(message) => <div class="data__query-error">{message()}</div>}
          </Show>
          <Show when={klineExport()}>
            {(data) => (
              <div class="data__summary data__summary--kline">
                <div class="data__path">
                  <span>K 线导出</span>
                  <code>{data().dir}</code>
                </div>
                <div class="data__path">
                  <span>结果</span>
                  <code>
                    {data().codes} 只 / {data().rows} 根 / {data().files.length} 个文件
                  </code>
                </div>
                <Show when={data().failed.length > 0}>
                  <div class="data__query-error">
                    失败 {data().failed.length} 只：
                    {data()
                      .failed.map((item) => item.code)
                      .join(', ')}
                  </div>
                </Show>
              </div>
            )}
          </Show>

          <section class="data__kline">
            <div>
              <div class="data__label">全市场快照</div>
              <div class="data__sub">MAC 批量报价 5,615 只 A 股，导出 CSV 用于离线分析。</div>
            </div>
            <button
              class="btn data__snapshot"
              disabled={snapshotExporting()}
              onClick={() => void runSnapshotExport()}
            >
              {snapshotExporting() ? '拉取中…' : '导出全市场 CSV'}
            </button>
          </section>
          <section class="data__kline">
            <div>
              <div class="data__label">归档到数据湖</div>
              <div class="data__sub">
                lake/quotes/trade_date=/quotes.jsonl.gz + CSV + manifest（MAC 全 A 快照）。
              </div>
            </div>
            <button
              class="btn data__archive"
              disabled={archiving()}
              onClick={() => void runArchive()}
            >
              {archiving() ? '归档中…' : '归档全市场'}
            </button>
          </section>
          <label class="data__auto-archive">
            <input
              type="checkbox"
              checked={appState.settings.autoArchive ?? false}
              onChange={(event) => updateSettings({ autoArchive: event.currentTarget.checked })}
            />
            <span>工作日 15:05–15:40 自动归档全市场</span>
            <Show when={appState.settings.autoArchiveLastDate}>
              {(date) => <em>最近 {date()}</em>}
            </Show>
          </label>
          <Show when={archiveError()}>
            {(message) => <div class="data__query-error">{message()}</div>}
          </Show>
          <Show when={archive()}>
            {(data) => (
              <div class="data__summary data__summary--archive">
                <div class="data__path">
                  <span>数据湖目录</span>
                  <code>{data().dir}</code>
                </div>
                <div class="data__path">
                  <span>分区 / 行数</span>
                  <code>
                    {data().tradeDate} / {data().rows}
                    {data().skipped ? ' · 已存在，已跳过' : ''}
                  </code>
                </div>
                <div class="data__path">
                  <span>SHA256</span>
                  <code>{data().sha256}</code>
                </div>
              </div>
            )}
          </Show>

          <section class="data__lake">
            <div class="data__lake-head">
              <div>
                <div class="data__label">数据湖归档历史</div>
                <div class="data__sub">lake/quotes 下最近 20 个 trade_date 分区。</div>
              </div>
              <button
                class="btn data__lake-refresh"
                disabled={archivesLoading()}
                onClick={() => void loadArchives()}
              >
                {archivesLoading() ? '读取中…' : '刷新归档'}
              </button>
            </div>
            <Show when={archivesError()}>
              {(message) => <div class="data__query-error">{message()}</div>}
            </Show>
            <Show when={archives().length > 0}>
              <table class="data__table data__lake-table">
                <thead>
                  <tr>
                    <th>分区</th>
                    <th class="num">行数</th>
                    <th class="num">大小</th>
                    <th>SHA256</th>
                  </tr>
                </thead>
                <tbody>
                  <For each={archives()}>
                    {(item) => (
                      <tr>
                        <td>{item.tradeDate}</td>
                        <td class="num">{thousands(item.rows)}</td>
                        <td class="num">{formatBytes(item.size)}</td>
                        <td class="data__lake-sha">{item.sha256.slice(0, 12)}…</td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </Show>
          </section>

          <Show when={snapshotError()}>
            {(message) => <div class="data__query-error">{message()}</div>}
          </Show>
          <Show when={snapshotResult()}>
            {(count) => (
              <div class="data__summary data__summary--snapshot">
                <div class="data__path">
                  <span>全市场快照</span>
                  <code>{count()} 只已下载 CSV</code>
                </div>
              </div>
            )}
          </Show>

          <div class="data__actions">
            <button
              class="btn btn--primary data__load"
              disabled={loading() || exporting()}
              onClick={() => void loadSummary()}
            >
              {loading() ? '下载解析中…' : '下载摘要'}
            </button>
            <button
              class="btn data__export"
              disabled={loading() || exporting()}
              onClick={() => void runExport()}
            >
              {exporting() ? '导出中…' : '规范化导出'}
            </button>
            <button
              class="btn data__parquet"
              disabled={loading() || exporting() || parquetExporting()}
              onClick={() => void runParquet()}
            >
              {parquetExporting() ? '导出 Parquet…' : '导出 Parquet'}
            </button>
            <button
              class="btn data__csv"
              disabled={loading() || exporting() || csvExporting()}
              onClick={() => void runCsv()}
            >
              {csvExporting() ? '导出 CSV…' : '导出 CSV'}
            </button>
            <span class="data__hint">只读操作，不访问付费/加密数据</span>
          </div>

          <Show when={error()}>
            {(message) => (
              <div class="data__error" role="alert">
                {message()}
                <button class="data__retry" onClick={() => void loadSummary()}>
                  重试摘要
                </button>
              </div>
            )}
          </Show>

          <Show when={summary()}>
            {(data) => (
              <div class="data__summary">
                <div class="data__grid">
                  <div class="data__metric">
                    <span>ZIP</span>
                    <strong>{formatBytes(data().zipBytes)}</strong>
                  </div>
                  <div class="data__metric">
                    <span>下载块</span>
                    <strong>{thousands(data().chunks)}</strong>
                  </div>
                  <div class="data__metric">
                    <span>ZIP 条目</span>
                    <strong>{thousands(data().zipEntries)}</strong>
                  </div>
                  <div class="data__metric">
                    <span>tdxstat 行</span>
                    <strong>{thousands(data().statCount)}</strong>
                  </div>
                  <div class="data__metric">
                    <span>tdxstat2 行</span>
                    <strong>{thousands(data().stat2Count)}</strong>
                  </div>
                  <div class="data__metric">
                    <span>主日期</span>
                    <strong>{data().statsDate ?? '—'}</strong>
                  </div>
                </div>
                <div class="data__path">
                  <span>原始 ZIP</span>
                  <code>{data().savedTo}</code>
                </div>
                <div class="data__path">
                  <span>SHA256</span>
                  <code>{data().sha256}</code>
                </div>
                <Show when={data().statSamples.length > 0}>
                  <table class="data__table">
                    <thead>
                      <tr>
                        <th>代码</th>
                        <th>日期</th>
                        <th class="num">Beta60</th>
                        <th class="num">PE TTM</th>
                        <th class="num">流通股本(万)</th>
                      </tr>
                    </thead>
                    <tbody>
                      <For each={data().statSamples}>
                        {(row) => (
                          <tr>
                            <td>{row.code}</td>
                            <td>{row.statsDate}</td>
                            <td class="num">{row.beta60 ?? '—'}</td>
                            <td class="num">{row.peTtm ?? '—'}</td>
                            <td class="num">{thousands(row.freeFloatShares10k ?? 0)}</td>
                          </tr>
                        )}
                      </For>
                    </tbody>
                  </table>
                </Show>
              </div>
            )}
          </Show>

          <Show when={parquetResult()}>
            {(data) => (
              <div class="data__summary data__summary--parquet">
                <div class="data__path">
                  <span>Parquet 目录</span>
                  <code>{data().target}</code>
                </div>
                <div class="data__path">
                  <span>manifest</span>
                  <code>{data().manifest}</code>
                </div>
                <div class="data__partitions">
                  <span class="data__partition">{thousands(data().rowCount)} 行</span>
                  <span class="data__partition">{data().files.length} 个文件</span>
                  <span class="data__partition">schema v{data().schemaVersion}</span>
                </div>
              </div>
            )}
          </Show>

          <Show when={csvResult()}>
            {(data) => (
              <div class="data__summary data__summary--csv">
                <div class="data__path">
                  <span>tdxstat.csv</span>
                  <code>{data().statCsv}</code>
                </div>
                <div class="data__path">
                  <span>tdxstat2.csv</span>
                  <code>{data().stat2Csv}</code>
                </div>
                <div class="data__partitions">
                  <span class="data__partition">{thousands(data().statCount)} 行</span>
                  <span class="data__partition">{thousands(data().stat2Count)} 行</span>
                </div>
              </div>
            )}
          </Show>

          <Show when={exported()}>
            {(data) => (
              <div class="data__summary data__summary--export">
                <div class="data__grid">
                  <div class="data__metric">
                    <span>有效行</span>
                    <strong>{thousands(data().statCount)}</strong>
                  </div>
                  <div class="data__metric">
                    <span>分区</span>
                    <strong>{data().partitions.length}</strong>
                  </div>
                  <div class="data__metric">
                    <span>空日期跳过</span>
                    <strong>{data().statSkipped}</strong>
                  </div>
                  <div class="data__metric">
                    <span>生成时间</span>
                    <strong>{data().generatedAt.slice(0, 19)}</strong>
                  </div>
                </div>
                <div class="data__path">
                  <span>规范化目录</span>
                  <code>{data().normalizedTo}</code>
                </div>
                <div class="data__path">
                  <span>SQLite</span>
                  <code>{data().database}</code>
                </div>
                <div class="data__path">
                  <span>manifest</span>
                  <code>{data().manifest}</code>
                </div>
                <div class="data__partitions">
                  <For each={data().partitions.slice(0, 6)}>
                    {(partition) => (
                      <span class="data__partition">
                        {partition.tradeDate} · {thousands(partition.statCount)}
                      </span>
                    )}
                  </For>
                  <Show when={data().partitions.length > 6}>
                    <span class="data__partition">… 共 {data().partitions.length} 个分区</span>
                  </Show>
                </div>
              </div>
            )}
          </Show>

          <section class="data__local">
            <div class="data__query-head">
              <div>
                <strong>本地行情文件（读/写）</strong>
                <span>.day / .lc1 / .lc5 / .5；只读，成交量按手换算，最多 500 根</span>
              </div>
              <button
                class="btn data__local-run"
                disabled={localLoading()}
                onClick={() => void runLocalDay()}
              >
                {localLoading() ? '读取中…' : '读取'}
              </button>
            </div>
            <input
              class="data__local-path"
              value={localPath()}
              placeholder="/path/to/sh600519.day 或 .lc1"
              aria-label=".day 文件路径"
              onInput={(event) => setLocalPath(event.currentTarget.value)}
            />
            <Show when={localError()}>
              {(message) => <div class="data__query-error">{message()}</div>}
            </Show>
            <Show when={localDay()}>
              {(data) => (
                <div class="data__local-result">
                  <div class="data__query-meta">
                    {data().count} 根 · {data().firstDate} → {data().lastDate}
                    <button class="btn data__local-csv" onClick={exportLocalCsv}>
                      导出 CSV
                    </button>
                    <button
                      class="btn data__local-import"
                      disabled={importLoading()}
                      onClick={() => void runLocalImport()}
                    >
                      {importLoading() ? '导入中…' : '导入数据湖'}
                    </button>
                    <button
                      class="btn data__local-write"
                      disabled={writeLoading()}
                      onClick={() => void runLocalWrite()}
                    >
                      {writeLoading() ? '写入中…' : '写回文件'}
                    </button>
                  </div>
                  <div class="data__query-table-wrap">
                    <table class="data__query-table">
                      <thead>
                        <tr>
                          <th>日期</th>
                          <th>开</th>
                          <th>高</th>
                          <th>低</th>
                          <th>收</th>
                          <th>量(手)</th>
                        </tr>
                      </thead>
                      <tbody>
                        <For each={data().bars.slice(-10)}>
                          {(bar) => (
                            <tr>
                              <td class="num">{bar.date}</td>
                              <td class="num">{bar.open.toFixed(2)}</td>
                              <td class="num">{bar.high.toFixed(2)}</td>
                              <td class="num">{bar.low.toFixed(2)}</td>
                              <td class="num">{bar.close.toFixed(2)}</td>
                              <td class="num">{thousands(bar.volume)}</td>
                            </tr>
                          )}
                        </For>
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </Show>
            <Show when={writeError()}>
              {(message) => <div class="data__query-error">{message()}</div>}
            </Show>
            <Show when={writeResult()}>
              {(data) => (
                <div class="data__local-imported">
                  已写入 {data().count} 根 · <code>{data().path}</code>
                </div>
              )}
            </Show>
            <Show when={importError()}>
              {(message) => <div class="data__query-error">{message()}</div>}
            </Show>
            <Show when={importResult()}>
              {(data) => (
                <div class="data__local-imported">
                  <div>
                    已导入 {data().rows} 行 · 累计 {data().totalRows} 行 · {data().code}
                  </div>
                  <code>{data().jsonlPath}</code>
                  <code>{data().database}</code>
                </div>
              )}
            </Show>
          </section>

          <section class="data__query">
            <div class="data__query-head">
              <div>
                <strong>SQL 查询</strong>
                <span>只读 SELECT/WITH，最多 500 行</span>
              </div>
              <div class="data__engines">
                <button
                  class="data__engine"
                  data-active={engine() === 'sqlite'}
                  onClick={() => setEngine('sqlite')}
                >
                  SQLite
                </button>
                <button
                  class="data__engine data__duck"
                  data-active={engine() === 'duckdb'}
                  onClick={() => setEngine('duckdb')}
                >
                  DuckDB
                </button>
                <button
                  class="data__engine data__local-engine"
                  data-active={engine() === 'local'}
                  onClick={() => {
                    setEngine('local')
                    setSql('SELECT code, date, close, volume FROM bars ORDER BY date DESC LIMIT 20')
                  }}
                >
                  本地
                </button>
              </div>
              <Show when={engine() === 'local'}>
                <button
                  class="btn data__cross-example"
                  title="local_bars + stats.tdxstat 跨库查询"
                  onClick={() =>
                    setSql(
                      'SELECT b.code, b.date, b.close, s.pe_ttm FROM bars b LEFT JOIN stats.tdxstat s ON s.code = b.code AND s.stats_date = b.date LIMIT 20'
                    )
                  }
                >
                  跨库示例
                </button>
              </Show>
              <button
                class="btn data__query-run"
                disabled={querying()}
                onClick={() => void runQuery()}
              >
                {querying() ? '查询中…' : '执行'}
              </button>
            </div>
            <textarea
              class="data__sql"
              rows="3"
              value={sql()}
              aria-label="SQL 查询"
              onInput={(event) => setSql(event.currentTarget.value)}
            />
            <Show when={queryError()}>
              {(message) => <div class="data__query-error">{message()}</div>}
            </Show>
            <Show when={query()}>
              {(result) => (
                <div class="data__query-result">
                  <div class="data__query-meta">
                    {result().rowCount} 行{result().limited ? '（已截断）' : ''}
                  </div>
                  <div class="data__query-table-wrap">
                    <table class="data__query-table">
                      <thead>
                        <tr>
                          <For each={result().columns}>{(column) => <th>{column}</th>}</For>
                        </tr>
                      </thead>
                      <tbody>
                        <For each={result().rows}>
                          {(row) => (
                            <tr>
                              <For each={row}>
                                {(cell) => (
                                  <td class="num">{cell === null ? '—' : String(cell)}</td>
                                )}
                              </For>
                            </tr>
                          )}
                        </For>
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </Show>
          </section>
        </div>

        <footer class="data__foot">
          <span>Python 后端下载/解析，Electron 只负责展示</span>
          <span>写入用户数据目录，不修改原始行情</span>
        </footer>
      </section>
    </div>
  )
}
