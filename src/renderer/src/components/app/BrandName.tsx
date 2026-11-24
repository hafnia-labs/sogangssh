import { appName } from '@/config'
import { cn } from '@/lib/utils'
// Official Sogang University emblem (교표), from sogang.ac.kr/ko/symbol/ui. Do not alter its shape or colors.
import markUrl from '@/assets/brand/sogang-emblem.png'

type Props = {
  size?: 'sm' | 'lg'
  className?: string
}

export function BrandName({ size = 'sm', className }: Props) {
  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      <span className={cn('font-semibold', size === 'lg' ? 'text-xl' : 'text-sm')}>{appName}</span>
      <img
        src={markUrl}
        alt=""
        aria-hidden="true"
        className={cn('shrink-0 object-contain', size === 'lg' ? 'size-8' : 'size-5')}
      />
    </span>
  )
}
