import { Languages } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n/context'

export function LanguageToggle() {
  const { lang, setLang, t } = useI18n()

  return (
    <Button
      variant="ghost"
      size="sm"
      title={t.language.switchLabel}
      onClick={() => setLang(lang === 'ko' ? 'en' : 'ko')}
    >
      <Languages />
      {t.language.switchTo}
    </Button>
  )
}
