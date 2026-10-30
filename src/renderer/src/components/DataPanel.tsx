/**
 * 数据工具：下载 zhb.zip、查看 tdxstat 摘要、写规范化层。
 *
 * 只做只读数据管理，不碰交易；导出路径由 Python 后端决定并在界面上明确展示。
 */
import { createSignal, For, Show, type JSX } from 'solid-js'
import type {
  StatsCsvExport,
  StatsParquetExport,
  StatsQueryResult,
  TdxStatsExport,
  TdxStatsSummary,
  LocalDayResult,
  LocalImportResult,
  LocalDayWriteResult,
  KLineExportResult,
  SnapshotArchiveResult,
  SnapshotArchiveItem
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
          period: 'day',
          count: 240,
          adjust: 'qfq'
        })
      )
    } catch (cause) {
      setKlineExportError(errorMessage(cause))
    } finally {
      setKlineExporting(false)
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

          <section class="data__kline">
            <div>
              <div class="data__label">自选 K 线导出</div>
              <div class="data__sub">
                最近 240 根日 K，CSV + JSONL.gz + manifest，写入数据目录。
              </div>
            </div>
            <button
              class="btn data__kline-export"
              disabled={klineExporting() || watchCodes().length === 0}
              onClick={() => void runKlineExport()}
            >
              {klineExporting() ? '导出中…' : `导出 ${watchCodes().length} 只`}
            </button>
          </section>
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
