import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildDesktopEntry,
  installLinuxDesktopIntegration,
  mergeMimeDefault,
  quoteDesktopExec,
  shouldOfferAppImageFix
} from './linux-desktop'

describe('quoteDesktopExec', () => {
  it('没有保留字符时不加引号', () => {
    expect(quoteDesktopExec('/home/river/pythontdx.AppImage')).toBe(
      '/home/river/pythontdx.AppImage'
    )
  })

  it('含空格时整体加引号', () => {
    expect(quoteDesktopExec('/home/river/my apps/pythontdx.AppImage')).toBe(
      '"/home/river/my apps/pythontdx.AppImage"'
    )
  })

  it('引号、反斜杠、美元符和反引号都要转义', () => {
    expect(quoteDesktopExec('/tmp/a"b\\c$d`e')).toBe('"/tmp/a\\"b\\\\c\\$d\\`e"')
  })
})

describe('buildDesktopEntry', () => {
  it('生成可被桌面环境读取的入口', () => {
    const entry = buildDesktopEntry({
      name: 'pythontdx',
      exec: '"/tmp/pythontdx 1.1.0.AppImage" %U',
      icon: '/home/river/.local/share/icons/pythontdx.png',
      comment: 'A 股行情终端',
      startupWMClass: 'pythontdx'
    })
    expect(entry).toContain('[Desktop Entry]')
    expect(entry).toContain('Type=Application')
    expect(entry).toContain('Name=pythontdx')
    expect(entry).toContain('Exec="/tmp/pythontdx 1.1.0.AppImage" %U')
    expect(entry).toContain('Icon=/home/river/.local/share/icons/pythontdx.png')
    expect(entry).toContain('StartupWMClass=pythontdx')
    expect(entry.endsWith('\n')).toBe(true)
  })
})

describe('mergeMimeDefault', () => {
  it('已有 [Default Applications] 时替换同名项并保留其它项', () => {
    const before = [
      '[Default Applications]',
      'text/html=google-chrome.desktop',
      'application/vnd.appimage=gnome-disk-image-mounter.desktop;',
      '',
      '[Added Associations]',
      'text/plain=gedit.desktop',
      ''
    ].join('\n')
    const after = mergeMimeDefault(
      before,
      'application/vnd.appimage',
      'appimage-launcher.desktop'
    )
    expect(after).toContain('text/html=google-chrome.desktop')
    expect(after).toContain('application/vnd.appimage=appimage-launcher.desktop;')
    expect(after).not.toContain('gnome-disk-image-mounter.desktop;')
    expect(after).toContain('[Added Associations]')
    expect(after).toContain('text/plain=gedit.desktop')
  })

  it('没有 section 时追加，不破坏原内容', () => {
    const after = mergeMimeDefault(
      '[Added Associations]\ntext/plain=gedit.desktop\n',
      'application/vnd.appimage',
      'appimage-launcher.desktop'
    )
    expect(after).toContain('[Added Associations]')
    expect(after).toContain('[Default Applications]')
    expect(after).toContain('application/vnd.appimage=appimage-launcher.desktop;')
  })

  it('section 内没有该 MIME 时插到 section 末尾', () => {
    const after = mergeMimeDefault(
      '[Default Applications]\ntext/html=google-chrome.desktop\n\n[Added Associations]\n',
      'application/vnd.appimage',
      'appimage-launcher.desktop'
    )
    expect(after.indexOf('application/vnd.appimage=')).toBeLessThan(
      after.indexOf('[Added Associations]')
    )
  })

  it('空文件也能生成合法结构', () => {
    const after = mergeMimeDefault('', 'application/vnd.appimage', 'appimage-launcher.desktop')
    expect(after.trim()).toBe(
      '[Default Applications]\napplication/vnd.appimage=appimage-launcher.desktop;'
    )
  })

  it('CRLF 输入统一成 LF', () => {
    const after = mergeMimeDefault(
      '[Default Applications]\r\ntext/html=chrome.desktop\r\n',
      'application/vnd.appimage',
      'appimage-launcher.desktop'
    )
    expect(after).not.toContain('\r')
  })
})

describe('installLinuxDesktopIntegration', () => {
  it('安装桌面入口、启动器，并把 AppImage 默认处理指向启动器', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pythontdx-desktop-'))
    const home = join(root, 'home')
    const dataHome = join(root, 'data')
    const configHome = join(root, 'config')
    const appImage = join(home, 'Apps', 'pythontdx 1.1.0.AppImage')
    try {
      await writeFile(appImage, 'fake appimage').catch(async () => {
        const { mkdir } = await import('node:fs/promises')
        await mkdir(join(home, 'Apps'), { recursive: true })
        await writeFile(appImage, 'fake appimage')
      })
      const result = await installLinuxDesktopIntegration({
        appImagePath: appImage,
        homeDir: home,
        dataHome,
        configHome
      })

      const desktop = await readFile(result.desktopFile, 'utf8')
      expect(desktop).toContain('Name=pythontdx')
      expect(desktop).toContain('"') // 路径含空格，Exec 必须加引号
      expect(desktop).toContain('StartupWMClass=pythontdx')

      const launcher = await readFile(result.launcherScript, 'utf8')
      expect(launcher).toContain('exec "$target"')
      expect((await stat(result.launcherScript)).mode & 0o111).not.toBe(0)

      const mime = await readFile(result.mimeAppsFile, 'utf8')
      expect(mime).toContain('application/vnd.appimage=appimage-launcher.desktop;')

      // 重复执行必须幂等
      const again = await installLinuxDesktopIntegration({
        appImagePath: appImage,
        homeDir: home,
        dataHome,
        configHome
      })
      expect(again.changed).toBe(false)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe('shouldOfferAppImageFix', () => {
  it('系统默认是磁盘镜像挂载器时需要修复', () => {
    expect(shouldOfferAppImageFix('gnome-disk-image-mounter.desktop')).toBe(true)
  })

  it('没有处理器时也值得提示', () => {
    expect(shouldOfferAppImageFix(null)).toBe(true)
  })

  it('已经用我们的启动器或 AppImageLauncher 时不打扰', () => {
    expect(shouldOfferAppImageFix('appimage-launcher.desktop')).toBe(false)
    expect(shouldOfferAppImageFix('appimagelauncher.desktop')).toBe(false)
  })
})
