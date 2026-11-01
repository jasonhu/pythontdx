/**
 * Web 端版本号。
 *
 * 必须由构建配置从 package.json 注入，不能写死：
 * 0.13.2 的 Linux 回归发现右下角仍显示 `v0.7.0-web`，原因是这个常量
 * 从 v0.7 起就没再跟随版本更新。构建注入从根上避免下一次遗忘。
 */
export const WEB_VERSION = `${__APP_VERSION__}-web`
