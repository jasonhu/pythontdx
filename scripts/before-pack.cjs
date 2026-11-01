/**
 * electron-builder 打包前检查 sidecar 平台。
 *
 * electron-builder 允许在 Linux 上 `--win dir`，但它只会把当前平台的
 * `python/dist/tdx-bridge` 原样复制进去——Linux 版是 ELF，Windows 包拿到
 * 后无法启动。宁可打包失败，也不要产出“看起来成功”的坏包。
 *
 * 文件名也要按平台区分：Nuitka 在 Windows 上产出的叫 `tdx-bridge.exe`，
 * 早先这里只找不带扩展名的那个，导致 Windows 打包 100% 报“找不到 sidecar”
 * （2026-11-01 实测）。所以路径推导抽成纯函数，由 `before-pack.test.mjs` 守住。
 */
const { readFileSync } = require('node:fs')
const { join } = require('node:path')

/** sidecar 的文件名：Windows 带 .exe，Linux/macOS 不带扩展名 */
function sidecarFileName(platform) {
  return platform === 'win32' ? 'tdx-bridge.exe' : 'tdx-bridge'
}

/** sidecar 的完整路径（由 `npm run build:python` 产出） */
function sidecarPath(projectDir, platform) {
  return join(projectDir, 'python', 'dist', sidecarFileName(platform))
}

function magicOf(path) {
  try {
    return readFileSync(path).subarray(0, 4)
  } catch {
    return null
  }
}

exports.sidecarFileName = sidecarFileName
exports.sidecarPath = sidecarPath

exports.default = async function beforePack(context) {
  const platform = context.electronPlatformName
  const bridge = sidecarPath(context.packager.projectDir, platform)
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
      `Windows 包需要 Windows 版 sidecar（PE），当前 ${bridge} 不是 PE。请在 Windows 上构建，或先交叉编译 sidecar。`
    )
  }
  if (platform === 'darwin' && !isMacho) {
    throw new Error(`macOS 包需要 Mach-O 版 sidecar，当前 ${bridge} 不是 Mach-O。请在 macOS 上构建。`)
  }
  if (platform === 'linux' && !isElf) {
    throw new Error(`Linux 包需要 ELF 版 sidecar，当前 ${bridge} 不是 ELF。`)
  }
}
