import { useEffect, useRef, type ReactNode } from 'react'
import { useT } from '../lib/i18n'

export function Dialog({ title, open, onClose, wide, children, actions }: {
  title: string
  open: boolean
  onClose: () => void
  wide?: boolean
  children: ReactNode
  actions?: ReactNode
}) {
  const t = useT()
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (open && !el.open) el.showModal()
    else if (!open && el.open) el.close()
  }, [open])

  return (
    <dialog ref={ref} className={`dialog${wide ? ' wide' : ''}`} onClose={onClose}
      onClick={(e) => { if (e.target === ref.current) onClose() }}>
      {open && (
        <>
          <header>
            <h2>{title}</h2>
            <button className="btn ghost icon" aria-label={t('close')} onClick={onClose}>✕</button>
          </header>
          <div className="body">{children}</div>
          {actions && <footer>{actions}</footer>}
        </>
      )}
    </dialog>
  )
}
