import { LayersIcon } from 'lucide-react'
import type { CSSProperties } from 'react'
import { brandReadsOn, imageIconKey, imageInitial, type IconKey } from '@/lib/image-icon'
import { cn } from '@/lib/utils'
import { ICON_SET_VERSION, IMAGE_ICON_HEX } from '@/lib/image-icon-colors'

export type ImageIconSize = 20 | 28 | 36

const TILE: Record<ImageIconSize, string> = {
  20: 'size-5 rounded-md text-[0.625rem]',
  28: 'size-7 rounded-lg text-xs',
  36: 'size-9 rounded-lg text-sm',
}
const LOGO: Record<ImageIconSize, string> = { 20: 'size-3', 28: 'size-4', 36: 'size-5' }

/**
 * The tile of an image: the brand logo on a soft tint of the brand color, or, when the image has no
 * known icon, its first letter on a muted tile. The name mapping comes first. Then `stack` (the icon the
 * image config names, from useImageStacks) is used. The tile is decorative: the name sits beside it.
 */
export function ImageIcon({
  image,
  stack = null,
  name,
  size = 28,
  className,
}: {
  /** the image reference, such as "postgres:17" or "bitnami/redis" */
  image: string
  /** the icon the image's config names (null while unknown, or when the config names none) */
  stack?: IconKey | null
  /**
   * What the letter tile falls back to when the image has no name (only a sha256 ID, after its tag
   * moved on), such as the container name. Without it the tile shows a neutral layers icon.
   */
  name?: string
  size?: ImageIconSize
  className?: string
}) {
  const key = imageIconKey(image) ?? stack
  const base = cn('inline-flex shrink-0 items-center justify-center', TILE[size], className)

  if (key) {
    const hex = IMAGE_ICON_HEX[key]
    // The logo takes the brand color only where it reads on the surface. Otherwise it uses the text color.
    const style = {
      backgroundColor: `color-mix(in srgb, #${hex} 12%, transparent)`,
      '--logo-light': brandReadsOn(hex, 'light') ? `#${hex}` : 'var(--foreground)',
      '--logo-dark': brandReadsOn(hex, 'dark') ? `#${hex}` : 'var(--foreground)',
    } as CSSProperties
    // The logo is the icon's SVG as a mask, so it takes the tile's text color. The size is fixed: nothing shifts on load.
    const mask = `url(/api/icons/${key}?v=${ICON_SET_VERSION}) center / contain no-repeat`
    return (
      <span aria-hidden="true" className={cn(base, 'image-tile')} style={style}>
        <span aria-hidden="true" className={cn('shrink-0 bg-current', LOGO[size])} style={{ mask, WebkitMask: mask }} />
      </span>
    )
  }

  // An image known only by its ID has no name to take a letter from: use the given name, or a plain icon.
  const label = image.startsWith('sha256:') ? name : image
  if (!label) {
    return (
      <span aria-hidden="true" className={cn(base, 'bg-muted text-muted-foreground')}>
        <LayersIcon className={LOGO[size]} />
      </span>
    )
  }
  return (
    <span aria-hidden="true" className={cn(base, 'bg-muted font-semibold text-muted-foreground')}>
      {imageInitial(label)}
    </span>
  )
}
