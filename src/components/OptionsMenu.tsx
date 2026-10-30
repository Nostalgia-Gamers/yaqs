import { useEffect, useRef, useState } from 'react'
import { getVersion } from '@tauri-apps/api/app'
import { setSettings, useDb } from '../lib/store'
import { languages, useT } from '../lib/i18n'
import { downloadPack, uploadPack } from '../lib/transfer'

/** The toolbar's Options menu: settings, language, export/import, version. */
export function OptionsMenu({ onSettings, onMessage }: { onSettings: () => void; onMessage: (msg: string) => void }) {
  const t = useT()
  const lang = useDb((s) => s.settings.lang)
  const [open, setOpen] = useState(false)
  const [sub, setSub] = useState(false)
  const [version, setVersion] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const file = useRef<HTMLInputElement>(null)

  useEffect(() => {
    getVersion().then(setVersion).catch(() => {})
  }, [])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const run = (fn: () => void) => () => {
    setOpen(false)
    fn()
  }

  const langItems: { id: typeof lang; name: string }[] = [{ id: 'auto', name: t('lang.auto') }, ...languages]

  return (
    <div className="options" ref={ref}>
      <button className="btn icon" aria-haspopup="menu" aria-expanded={open} aria-label={t('options')} title={t('options')}
        onClick={() => { setOpen(!open); setSub(false) }}>⚙</button>
      {open && (
        <div className="ctx options-menu" role="menu">
          <button role="menuitem" onClick={run(onSettings)}>{t('om.settings')}</button>
          <div className={`has-sub left${sub ? ' open' : ''}`} onMouseEnter={() => setSub(true)} onMouseLeave={() => setSub(false)}>
            <button role="menuitem" aria-haspopup="menu" aria-expanded={sub} onClick={() => setSub(!sub)}>
              {t('om.language')} <span className="chev">‹</span>
            </button>
            {sub && (
              <div className="submenu" role="menu">
                {langItems.map((l) => (
                  <button key={l.id} role="menuitemradio" aria-checked={lang === l.id} onClick={run(() => setSettings({ lang: l.id }))}>
                    <span className="check">{lang === l.id ? '✓' : ''}</span>{l.name}
                  </button>
                ))}
              </div>
            )}
          </div>
          <hr />
          <button role="menuitem" onClick={run(() => onMessage(downloadPack()))}>{t('om.export')}</button>
          <button role="menuitem" onClick={run(() => file.current?.click())}>{t('om.import')}</button>
          {version && (
            <>
              <hr />
              <div className="ctx-title">{t('om.version', version)}</div>
            </>
          )}
        </div>
      )}
      <input ref={file} type="file" accept="application/json,.json" hidden onChange={async (e) => {
        const f = e.target.files?.[0]
        e.target.value = ''
        if (!f) return
        const msg = await uploadPack(f, false)
        if (msg) onMessage(msg)
      }} />
    </div>
  )
}
