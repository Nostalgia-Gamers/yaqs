import { dismiss, useAlerts } from '../lib/alerts'
import { useT } from '../lib/i18n'

export function Toasts({ onPick }: { onPick: (addr: string) => void }) {
  const t = useT()
  const toasts = useAlerts((a) => a.toasts)
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((x) => (
        <div key={x.id} className="toast">
          <button className="body" onClick={() => { if (x.addr) onPick(x.addr); dismiss(x.id) }}>
            <strong>{x.title}</strong>
            {x.body && <span>{x.body}</span>}
          </button>
          <button className="x" aria-label={t('dismiss')} onClick={() => dismiss(x.id)}>✕</button>
        </div>
      ))}
    </div>
  )
}
