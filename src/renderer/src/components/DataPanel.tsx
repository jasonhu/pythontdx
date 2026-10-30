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
  LocalDayResult
} from '@shared/types'
import { thousands } from '@shared/format'
import { appState, updateSettings } from '../stores/app'
import { api, errorMessage } from '../lib/ipc'
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
  const [engine, setEngine] = createSignal<'sqlite' | 'duckdb'>('sqlite')
  const [csvExporting, setCsvExporting] = createSignal(false)
  const [csvResult, setCsvResult] = createSignal<StatsCsvExport | null>(null)
  const [parquetExporting, setParquetExporting] = createSignal(false)
  const [parquetResult, setParquetResult] = createSignal<StatsParquetExport | null>(null)
  const [localPath, setLocalPath] = createSignal(appState.settings.localDayPath ?? '')
  const [localDay, setLocalDay] = createSignal<LocalDayResult | null>(null)
  const [localLoading, setLocalLoading] = createSignal(false)
  const [localError, setLocalError] = createSignal<string | null>(null)

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
                <strong>本地行情文件</strong>
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
              </div>
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
