/** Python 技术形态识别返回的计划；只含日期/价格，不含屏幕坐标。 */
export interface SmartDrawingPlan {
  type: 'fib' | 'measure' | 'trend' | 'channel' | 'horizontal' | 'arrow'
  startDate?: string
  endDate?: string
  startIndex?: number
  endIndex?: number
  startPrice?: number
  endPrice?: number
  price?: number
  offset?: number
  extended?: boolean
  algorithm?: string
  score?: number
}

export interface ChartPatternsSummary {
  algorithm: string
  count: number
  types: string[]
  generatedAt: string
}

export interface ChartPatternsResult {
  code: string
  period: string
  adjust: string
  source: string
  summary: ChartPatternsSummary
  plans: SmartDrawingPlan[]
}

export interface ChartPatternsRequest {
  code: string
  period?: string
  adjust?: 'none' | 'qfq' | 'hfq'
  lookback?: number
}
