/**
 * 极简 HTTP 客户端。
 *
 * 为什么不直接在渲染进程里 fetch？
 *  1. 腾讯行情接口不发送 CORS 头，浏览器环境会被同源策略拦截；
 *  2. 实时行情与搜索接口返回的是 GBK 编码，需要 Node 的 TextDecoder；
 *  3. 网络出口统一收敛在主进程，便于做超时、重试、缓存与限流。
 */

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

const DEFAULT_TIMEOUT = 10_000

export type Encoding = 'utf-8' | 'gbk'

export interface RequestOptions {
  /** 响应体编码，默认 utf-8；腾讯的 qt.gtimg.cn / smartbox 需要 gbk */
  encoding?: Encoding
  timeoutMs?: number
  referer?: string
  /** 外部取消信号（如窗口关闭时中断在途请求） */
  signal?: AbortSignal
}

/** 统一的网络错误：message 已经是「可以直接展示给用户」的中文 */
export class NetError extends Error {
  readonly status?: number

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'NetError'
    this.status = status
  }
}

function toNetError(err: unknown): NetError {
  if (err instanceof NetError) return err
  if (err instanceof Error) {
    if (err.name === 'TimeoutError') return new NetError('请求超时，请检查网络连接')
    if (err.name === 'AbortError') return new NetError('请求已取消')
    // undici / Chromium 抛出的网络层错误都是 TypeError: fetch failed
    if (err.name === 'TypeError') return new NetError('网络不可达，请检查网络或代理设置')
    return new NetError(err.message)
  }
  return new NetError(String(err))
}

/**
 * 发起一次 GET 请求并解码为字符串。
 * @throws {NetError} 任何失败都会转成带中文 message 的 NetError
 */
export async function requestText(url: string, options: RequestOptions = {}): Promise<string> {
  const { encoding = 'utf-8', timeoutMs = DEFAULT_TIMEOUT, referer, signal } = options

  const timeout = AbortSignal.timeout(timeoutMs)
  const combined = signal ? AbortSignal.any([timeout, signal]) : timeout

  let response: Response
  try {
    response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: combined,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: '*/*',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        ...(referer ? { Referer: referer } : {})
      }
    })
  } catch (err) {
    throw toNetError(err)
  }

  if (!response.ok) {
    throw new NetError(`行情接口返回 HTTP ${response.status}`, response.status)
  }

  try {
    const buffer = await response.arrayBuffer()
    return new TextDecoder(encoding).decode(buffer)
  } catch (err) {
    throw toNetError(err)
  }
}

/** 发起 GET 并解析 JSON */
export async function requestJson<T>(url: string, options: RequestOptions = {}): Promise<T> {
  const text = await requestText(url, { ...options, encoding: 'utf-8' })
  try {
    return JSON.parse(text) as T
  } catch {
    throw new NetError('行情接口返回了非预期的数据格式')
  }
}

/**
 * 带一次重试的请求：只对网络层错误重试，HTTP 4xx 之类的协议错误直接抛出。
 */
export async function requestTextWithRetry(
  url: string,
  options: RequestOptions = {},
  retries = 1
): Promise<string> {
  let lastError: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await requestText(url, options)
    } catch (err) {
      lastError = err
      if (err instanceof NetError && err.status !== undefined) throw err
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)))
      }
    }
  }
  throw toNetError(lastError)
}
