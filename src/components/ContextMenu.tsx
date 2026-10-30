import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { openUrl } from '@tauri-apps/plugin-opener'
import { addServers, moveToCategory, removeServers, setFavorite, useDb } from '../lib/store'
import { useLive } from '../lib/live'
import { rowName } from '../lib/rows'
import { closeMenu, useMenu } from '../lib/menu'
import { useT } from '../lib/i18n'

/** Right-click menu for one server or the current multi-selection. */
export function ContextMenu({ onShow, onEdit }: { onShow: (addr: string) => void; onEdit: (addrs: string[]) => void }) {
  const t = useT()
  const menu = useMenu((m) => m.menu)
  const state = useDb()
  const results = useLive((l) => l.results)
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const [sub, setSub] = useState<'move' | 'add' | null>(null)

  // Keep the menu inside the window.
  useLayoutEffect(() => {
    if (!menu || !ref.current) return
    const r = ref.current.getBoundingClientRect()
    setPos({
      x: Math.min(menu.x, window.innerWidth - r.width - 8),
      y: Math.min(menu.y, window.innerHeight - r.height - 8),
    })
    setSub(null)
    ref.current.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
  }, [menu])

  useEffect(() => {
    if (!menu) return
    const close = () => closeMenu()
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) close() }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return close()
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
      e.preventDefault()
      const items = [...(ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]
      const i = items.indexOf(document.activeElement as HTMLButtonElement)
      items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus()
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    window.addEventListener('blur', close)
    window.addEventListener('resize', close)
    document.addEventListener('scroll', close, true)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', close)
      window.removeEventListener('resize', close)
      document.removeEventListener('scroll', close, true)
    }
  }, [menu])

  if (!menu) return null
  const addrs = menu.addrs
  const one = addrs.length === 1 ? addrs[0] : null
  const saved = state.servers.filter((s) => addrs.includes(s.addr))
  const allSaved = saved.length === addrs.length
  const allFav = allSaved && saved.every((s) => s.favorite)
  const n = addrs.length
  const label = one ? rowName(saved[0] ?? { addr: one, category: null, tags: [], addedAt: 0 }, results.get(one)) : t('servers', n)

  const run = (fn: () => void) => () => {
    closeMenu()
    fn()
  }
  const copy = (text: string) => navigator.clipboard.writeText(text).catch(() => {})

  const categoryList = (pick: (id: string | null) => void) => (
    <div className="submenu" role="menu">
      {state.categories.map((c) => (
        <button key={c.id} role="menuitem" onClick={run(() => pick(c.id))}>
          <span className="swatch" style={{ background: c.color }} />{c.name}
        </button>
      ))}
      <button role="menuitem" onClick={run(() => pick(null))}><span className="swatch" />{t('uncategorized')}</button>
    </div>
  )

  return (
    <div ref={ref} className="ctx" role="menu" aria-label={t('cm.actions', label)} style={{ left: pos.x, top: pos.y }}
      onContextMenu={(e) => e.preventDefault()}>
      <div className="ctx-title">{label}</div>

      {one && <button role="menuitem" onClick={run(() => openUrl(`steam://connect/${one}`))}>{t('dt.connect')}</button>}
      {one && <button role="menuitem" onClick={run(() => onShow(one))}>{t('cm.details')}</button>}
      <button role="menuitem" onClick={run(() => copy(addrs.join('\n')))}>{one ? t('cm.copyAddr') : t('cm.copyAddrs', n)}</button>
      {one && <button role="menuitem" onClick={run(() => copy(`connect ${one}`))}>{t('cm.copyConnect')}</button>}

      <hr />

      {allSaved ? (
        <>
          <button role="menuitem" onClick={run(() => setFavorite(addrs, !allFav))}>{allFav ? t('cm.unfav') : t('cm.fav')}</button>
          <div className={`has-sub${sub === 'move' ? ' open' : ''}`} onMouseEnter={() => setSub('move')} onMouseLeave={() => setSub(null)}>
            <button role="menuitem" aria-haspopup="menu" aria-expanded={sub === 'move'}
              onClick={() => setSub(sub === 'move' ? null : 'move')} onKeyDown={(e) => { if (e.key === 'ArrowRight') setSub('move') }}>
              {t('cm.moveTo')} <span className="chev">›</span>
            </button>
            {sub === 'move' && categoryList((id) => moveToCategory(addrs, id))}
          </div>
          <button role="menuitem" onClick={run(() => onEdit(addrs))}>{one ? t('cm.edit') : t('tbl.editN', n)}</button>
          <hr />
          <button role="menuitem" className="danger" onClick={run(() => {
            if (confirm(one ? t('dt.confirmRemove', label) : t('tbl.confirmRemove', n))) removeServers(addrs)
          })}>{one ? t('dt.removeFromList') : t('cm.removeN', n)}</button>
        </>
      ) : (
        <div className={`has-sub${sub === 'add' ? ' open' : ''}`} onMouseEnter={() => setSub('add')} onMouseLeave={() => setSub(null)}>
          <button role="menuitem" aria-haspopup="menu" aria-expanded={sub === 'add'}
            onClick={() => setSub(sub === 'add' ? null : 'add')} onKeyDown={(e) => { if (e.key === 'ArrowRight') setSub('add') }}>
            {t('cm.addToList')} <span className="chev">›</span>
          </button>
          {sub === 'add' && categoryList((id) => addServers(addrs.filter((a) => !saved.some((s) => s.addr === a)).map((addr) => ({ addr })), id))}
        </div>
      )}
    </div>
  )
}
