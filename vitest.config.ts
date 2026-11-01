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
    // scripts/ 里只有构建脚本的纯函数测试（before-pack 的平台判定），
    // 和业务测试一起跑，省得再维护第二套测试命令。
    include: ['src/**/*.test.ts', 'scripts/**/*.test.mjs'],
    environment: 'node',
    reporters: 'default'
  }
})
