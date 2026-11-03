/**
 * Linux AppImage 双击修复。
 *
 * 现象：从 GitHub Release 下载 AppImage，命令行 `./pythontdx-1.1.0.AppImage`
 * 能启动，文件管理器双击却「没反应」（或把文件当成磁盘镜像挂载）。
 *
 * 根因不是可执行位，而是 MIME 关联：Ubuntu/GNOME 把 `application/vnd.appimage`
 * 默认交给 `gnome-disk-image-mounter.desktop`，双击只是挂载镜像。
 * AppImage 自己的 `.desktop` 只有 AppImageLauncher 之类的工具会注册，
 * 裸 AppImage 不会自动出现在应用菜单里。
 *
 * 这里做两件事（都只在 Linux AppImage 里、且由用户确认后执行）：
 *  1. 安装 pythontdx 自己的桌面入口，应用菜单里能直接启动；
 *  2. 安装一个极小的通用 AppImage 启动器，并把 `application/vnd.appimage`
 *     的默认打开方式指向它，让「双击任意 AppImage」恢复成「直接运行」。
 *
 * 不自动改用户配置：入口由设置面板里的按钮或首次启动的确认框触发。
 */
import { execFile as execFileCallback } from 'node:child_process'
import { chmod, copyFile, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'

const execFile = promisify(execFileCallback)

export interface LinuxDesktopOptions {
  /** 当前运行的 AppImage 绝对路径（process.env.APPIMAGE） */
  appImagePath: string
  /** AppImage 挂载目录里的图标；不存在时桌面入口不写 Icon */
  iconPath?: string
  /** 应用显示名 */
  name?: string
  version?: string
  /** 默认取当前用户 home */
  homeDir?: string
  /** 默认取 $XDG_DATA_HOME 或 ~/.local/share */
  dataHome?: string
  /** 默认取 $XDG_CONFIG_HOME 或 ~/.config */
  configHome?: string
}

export interface LinuxDesktopResult {
  desktopFile: string
  launcherScript: string
  launcherDesktopFile: string
  mimeAppsFile: string
  /** 本次是否真的改动了文件（重复执行应返回 false） */
  changed: boolean
  /** 当前 application/vnd.appimage 的默认处理器 */
  previousHandler: string | null
}

const DESKTOP_ID = 'pythontdx.desktop'
const LAUNCHER_ID = 'appimage-launcher.desktop'
const APPIMAGE_MIME = 'application/vnd.appimage'

/**
 * freedesktop 的 Exec 字段不是 shell：空格、引号、$、` 都有特殊含义。
 * 含保留字符时整体加双引号，并转义双引号/反斜杠/$/反引号。
 */
export function quoteDesktopExec(value: string): string {
  if (!/[\s"'\\><~|&;$*?#()`]/.test(value)) return value
  return `"${value.replace(/(["\\$`])/g, '\\$1')}"`
}

export interface DesktopEntryOptions {
  name: string
  exec: string
  icon?: string
  comment?: string
  mimeType?: string
  noDisplay?: boolean
  startupWMClass?: string
}

export function buildDesktopEntry(options: DesktopEntryOptions): string {
  const lines = [
    '[Desktop Entry]',
    'Type=Application',
    `Name=${options.name}`,
    `Exec=${options.exec}`,
    'Terminal=false'
  ]
  if (options.icon) lines.push(`Icon=${options.icon}`)
  if (options.comment) lines.push(`Comment=${options.comment}`)
  if (options.mimeType) lines.push(`MimeType=${options.mimeType}`)
  if (options.noDisplay) lines.push('NoDisplay=true')
  if (options.startupWMClass) lines.push(`StartupWMClass=${options.startupWMClass}`)
  lines.push('Categories=Finance;', '')
  return lines.join('\n')
}

/**
 * 写入/更新 `[Default Applications]` 里的一个 MIME。
 *
 * 自己解析而不是调用 xdg-mime：一是可以在没有 xdg-utils 的最小系统上工作，
 * 二是纯函数能单测。保留其它 section 与键，只在目标 section 内替换一行。
 */
export function mergeMimeDefault(
  content: string,
  mime: string,
  desktopId: string
): string {
  const lines = content.replace(/\r\n/g, '\n').split('\n')
  const section = '[Default Applications]'
  const entry = `${mime}=${desktopId};`
  const sectionStart = lines.findIndex((line) => line.trim() === section)
  if (sectionStart < 0) {
    while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
    if (lines.length > 0) lines.push('')
    lines.push(section, entry, '')
    return lines.join('\n')
  }

  let sectionEnd = lines.length
  for (let index = sectionStart + 1; index < lines.length; index += 1) {
    if (lines[index].trim().startsWith('[')) {
      sectionEnd = index
      break
    }
  }

  const existing = lines.findIndex(
    (line, index) => index > sectionStart && index < sectionEnd && line.startsWith(`${mime}=`)
  )
  if (existing >= 0) {
    lines[existing] = entry
  } else {
    // 插到 section 末尾的最后一个非空行之后
    let insertAt = sectionEnd
    while (insertAt > sectionStart + 1 && lines[insertAt - 1] === '') insertAt -= 1
    lines.splice(insertAt, 0, entry)
  }
  return lines.join('\n')
}

/** 读取 `gio mime` 的默认处理器；gio 不存在时返回 null。 */
export async function readAppImageHandler(): Promise<string | null> {
  try {
    const { stdout } = await execFile('gio', ['mime', APPIMAGE_MIME], {
      env: { ...process.env, LC_ALL: 'C' },
      timeout: 5000
    })
    const match = /Default application[^:]*:\s*(\S+)/.exec(stdout)
    return match?.[1] ?? null
  } catch {
    return null
  }
}

/**
 * 只有「当前默认是磁盘镜像挂载器」时才值得提示修复。
 * 已经装了 AppImageLauncher / 我们的启动器，或者用户明确指向别的程序，都不打扰。
 */
export function shouldOfferAppImageFix(handler: string | null): boolean {
  if (!handler) return true
  return handler === 'gnome-disk-image-mounter.desktop'
}

async function readText(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''
    throw error
  }
}

async function writeIfChanged(path: string, content: string, mode: number): Promise<boolean> {
  const previous = await readText(path)
  if (previous === content) {
    // 权限可能被外部改坏，仍然校正一次
    await chmod(path, mode)
    return false
  }
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.part`
  await writeFile(temporary, content, { encoding: 'utf8', mode })
  await chmod(temporary, mode)
  await rename(temporary, path)
  return true
}

export async function installLinuxDesktopIntegration(
  options: LinuxDesktopOptions
): Promise<LinuxDesktopResult> {
  const appImagePath = options.appImagePath.trim()
  if (!appImagePath.startsWith('/')) {
    throw new Error('AppImage 路径必须是绝对路径')
  }
  try {
    const info = await stat(appImagePath)
    if (!info.isFile()) throw new Error('not a file')
  } catch {
    throw new Error(`找不到 AppImage：${appImagePath}`)
  }

  const home = options.homeDir ?? homedir()
  const dataHome = options.dataHome ?? process.env.XDG_DATA_HOME ?? join(home, '.local', 'share')
  const configHome = options.configHome ?? process.env.XDG_CONFIG_HOME ?? join(home, '.config')
  const applications = join(dataHome, 'applications')
  const desktopFile = join(applications, DESKTOP_ID)
  const launcherDesktopFile = join(applications, LAUNCHER_ID)
  const launcherScript = join(home, '.local', 'bin', 'appimage-launcher')
  const mimeAppsFile = join(configHome, 'mimeapps.list')

  const name = options.name ?? 'pythontdx'
  const iconTarget = join(dataHome, 'icons', 'hicolor', '512x512', 'apps', 'pythontdx.png')
  let icon: string | undefined
  if (options.iconPath) {
    try {
      await mkdir(dirname(iconTarget), { recursive: true })
      await copyFile(options.iconPath, iconTarget)
      icon = iconTarget
    } catch {
      // 图标复制失败不影响启动，桌面入口不写 Icon 即可
      icon = undefined
    }
  }

  const appEntry = buildDesktopEntry({
    name,
    exec: `${quoteDesktopExec(appImagePath)} %U`,
    icon,
    comment: `${name} · A 股行情终端`,
    startupWMClass: 'pythontdx'
  })
  const launcherEntry = buildDesktopEntry({
    name: 'AppImage Launcher',
    exec: `${quoteDesktopExec(launcherScript)} %f`,
    comment: '双击 AppImage 直接运行（由 pythontdx 安装）',
    mimeType: APPIMAGE_MIME,
    noDisplay: true
  })

  // 用 sh 而不是 bash：最小发行版也一定有 /bin/sh
  const launcher = `#!/bin/sh
# 由 pythontdx 安装：让文件管理器双击 AppImage 时直接运行，而不是挂载成磁盘镜像。
target="$1"
if [ -z "$target" ] || [ ! -f "$target" ]; then
  echo "AppImage Launcher: 参数不是文件：$target" >&2
  exit 2
fi
# 浏览器下载的文件通常没有可执行位；用户双击本身就表达了「要运行」的意图。
chmod +x "$target" 2>/dev/null || true
exec "$target"
`

  let changed = false
  changed = (await writeIfChanged(desktopFile, appEntry, 0o644)) || changed
  changed = (await writeIfChanged(launcherDesktopFile, launcherEntry, 0o644)) || changed
  changed = (await writeIfChanged(launcherScript, launcher, 0o755)) || changed

  const previousHandler = await readAppImageHandler()
  const mimeContent = await readText(mimeAppsFile)
  const nextMimeContent = mergeMimeDefault(mimeContent, APPIMAGE_MIME, LAUNCHER_ID)
  changed = (await writeIfChanged(mimeAppsFile, nextMimeContent, 0o644)) || changed

  return {
    desktopFile,
    launcherScript,
    launcherDesktopFile,
    mimeAppsFile,
    changed,
    previousHandler
  }
}
