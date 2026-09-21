/**
 * 内联 SVG 图标集。
 *
 * 为什么不装 iconfont / lucide？
 *  - 桌面包体积敏感，几十个图标没必要引一整个库；
 *  - 内联 SVG 可以直接吃 currentColor，跟随主题和 hover 变色；
 *  - 每个图标就是一个组件，Solid 会把它编译成极小的 DOM 操作。
 *
 * 统一规格：24×24 视图框、2px 描边、圆头圆角。
 */
import type { JSX } from 'solid-js'

export interface IconProps {
  size?: number
  class?: string
  /** 描边粗细，密集区域可以调细一点 */
  strokeWidth?: number
}

function svgProps(props: IconProps, strokeWidth?: number): JSX.SvgSVGAttributes<SVGSVGElement> {
  return {
    width: props.size ?? 14,
    height: props.size ?? 14,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    // 注意：Solid 的 JSX 属性沿用 SVG 的 kebab-case 写法
    'stroke-width': strokeWidth ?? props.strokeWidth ?? 2,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    class: props.class,
    'aria-hidden': 'true'
  }
}

export function IconSearch(props: IconProps): JSX.Element {
  return (
    <svg {...svgProps(props)}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.6-3.6" />
    </svg>
  )
}

export function IconStar(props: IconProps): JSX.Element {
  return (
    <svg {...svgProps(props)}>
      <path d="M12 3.6l2.6 5.3 5.8.84-4.2 4.1 1 5.76L12 16.9l-5.2 2.7 1-5.76-4.2-4.1 5.8-.84z" />
    </svg>
  )
}

export function IconStarFilled(props: IconProps): JSX.Element {
  return (
    <svg {...svgProps(props)} fill="currentColor">
      <path d="M12 3.6l2.6 5.3 5.8.84-4.2 4.1 1 5.76L12 16.9l-5.2 2.7 1-5.76-4.2-4.1 5.8-.84z" />
    </svg>
  )
}

export function IconClose(props: IconProps): JSX.Element {
  return (
    <svg {...svgProps(props)}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  )
}

export function IconMinimize(props: IconProps): JSX.Element {
  return (
    <svg {...svgProps(props, props.strokeWidth ?? 1.6)}>
      <path d="M5 12h14" />
    </svg>
  )
}

export function IconMaximize(props: IconProps): JSX.Element {
  return (
    <svg {...svgProps(props, props.strokeWidth ?? 1.6)}>
      <rect x="5" y="5" width="14" height="14" rx="2" />
    </svg>
  )
}

export function IconRestore(props: IconProps): JSX.Element {
  return (
    <svg {...svgProps(props, props.strokeWidth ?? 1.6)}>
      <rect x="4" y="8" width="12" height="12" rx="2" />
      <path d="M8 8V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2" />
    </svg>
  )
}

export function IconRefresh(props: IconProps): JSX.Element {
  return (
    <svg {...svgProps(props)}>
      <path d="M20 11a8 8 0 1 0-2.3 5.7" />
      <path d="M20 5v6h-6" />
    </svg>
  )
}

export function IconSun(props: IconProps): JSX.Element {
  return (
    <svg {...svgProps(props)}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  )
}

export function IconMoon(props: IconProps): JSX.Element {
  return (
    <svg {...svgProps(props)}>
      <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" />
    </svg>
  )
}

export function IconChart(props: IconProps): JSX.Element {
  return (
    <svg {...svgProps(props)}>
      <path d="M3 20h18" />
      <path d="M6 16V9M11 16V5M16 16v-4M21 16v-7" />
    </svg>
  )
}

export function IconInfo(props: IconProps): JSX.Element {
  return (
    <svg {...svgProps(props)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 7.6v.1" />
    </svg>
  )
}

export function IconArrowUp(props: IconProps): JSX.Element {
  return (
    <svg {...svgProps(props, props.strokeWidth ?? 2.4)}>
      <path d="M12 19V5M6 11l6-6 6 6" />
    </svg>
  )
}

export function IconArrowDown(props: IconProps): JSX.Element {
  return (
    <svg {...svgProps(props, props.strokeWidth ?? 2.4)}>
      <path d="M12 5v14M18 13l-6 6-6-6" />
    </svg>
  )
}

export function IconPlus(props: IconProps): JSX.Element {
  return (
    <svg {...svgProps(props)}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}
