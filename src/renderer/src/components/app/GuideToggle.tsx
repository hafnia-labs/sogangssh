import { CircleHelp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n/context'
import { cn } from '@/lib/utils'
import { setGuideHidden, useGuideHidden } from './guide-visibility'

/** Shows or hides the guide character 서강이. */
export function GuideToggle({ className }: { className?: string }) {
  const { t } = useI18n()
  const hidden = useGuideHidden()
  const label = hidden ? t.guide.show : t.guide.hide

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setGuideHidden(!hidden)}
          aria-label={label}
          aria-pressed={!hidden}
          className={cn(hidden ? 'text-muted-foreground' : 'text-guide', className)}
        >
          <CircleHelp />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
