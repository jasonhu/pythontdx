import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

/**
 * 测试配置刻意保持极简：
 * 解析层全是纯函数（输入报文 → 输出结构化数据），不需要 jsdom、不需要 mock 网络，
 * 拿真实报文当 fixture 直接断言即可。
 */
export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared')
    }
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    reporters: 'default'
  }
})
