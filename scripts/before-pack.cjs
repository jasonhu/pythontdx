/**
 * electron-builder 打包前检查 sidecar 平台。
 *
 * electron-builder 允许在 Linux 上 `--win dir`，但它只会把当前平台的
 * `python/dist/tdx-bridge` 原样复制进去——Linux 版是 ELF，Windows 包拿到
 * 后无法启动。宁可打包失败，也不要产出“看起来成功”的坏包。
 */
const { readFileSync } = require('node:fs')
const { join } = require('node:path')

function magicOf(path) {
  try {
    return readFileSync(path).subarray(0, 4)
  } catch {
    return null
  }
}

exports.default = async function beforePack(context) {
  const platform = context.electronPlatformName
  const bridge = join(context.packager.projectDir, 'python', 'dist', 'tdx-bridge')
  const magic = magicOf(bridge)
  if (!magic) {
    throw new Error(`找不到 sidecar：${bridge}，请先运行 npm run build:python`)
  }
  const isElf = magic[0] === 0x7f && magic[1] === 0x45 && magic[2] === 0x4c && magic[3] === 0x46
  const isMacho =
    magic.readUInt32BE(0) === 0xfeedface ||
    magic.readUInt32BE(0) === 0xfeedfacf ||
    magic.readUInt32BE(0) === 0xcafebabe
  const isPe = magic[0] === 0x4d && magic[1] === 0x5a
  if (platform === 'win32' && !isPe) {
    throw new Error(
      'Windows 包需要 Windows 版 tdx-bridge（PE），当前 sidecar 不是 PE。请在 Windows 上构建，或先交叉编译 sidecar。'
    )
  }
  if (platform === 'darwin' && !isMacho) {
    throw new Error('macOS 包需要 Mach-O 版 tdx-bridge，请在 macOS 上构建。')
  }
  if (platform === 'linux' && !isElf) {
    throw new Error('Linux 包需要 ELF 版 tdx-bridge。')
  }
}
