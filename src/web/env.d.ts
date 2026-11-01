/**
 * Vite 在构建时通过 `define` 注入的只读常量。
 * 声明放在这里，让 `src/web` 与测试都能通过 TypeScript 检查。
 */
declare const __APP_VERSION__: string
