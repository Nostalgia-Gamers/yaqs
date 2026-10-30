import { useState } from 'react'
import {
  addTag, createCategory, deleteCategory, deleteTag, moveCategory, moveToCategory, setFavorite, setView, swatches, update, useDb,
} from '../lib/store'
import { useLive } from '../lib/live'
import { buddiesOnline, useAlerts } from '../lib/alerts'
import type { View } from '../lib/types'
import { useT } from '../lib/i18n'

const DRAG = 'application/x-yaqs-addrs'

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const t = useT()
  const s = useDb()
  const results = useLive((l) => l.results)
  const logCount = useAlerts((a) => a.log.length)
  const [editing, setEditing] = useState(false)
  const [newCat, setNewCat] = useState('')
  const [dropTarget, setDropTarget] = useState<string | null>(null)

  const stats = (filter: (cat: string | null, fav?: boolean) => boolean) => {
    let servers = 0, players = 0
    for (const x of s.servers) {
      if (!filter(x.category, x.favorite)) continue
      servers++
      const r = results.get(x.addr)
      if (r?.online) players += (r.info?.players ?? 0) - (r.info?.bots ?? 0)
    }
    return { servers, players }
  }
  const total = stats(() => true)
  const favs = stats((_, f) => !!f)
  const uncategorized = stats((c) => !c)
  const buddyCount = new Set(buddiesOnline(s, results).map((b) => b.player)).size

  const active = (v: View) => {
    const cur = s.view
    if (cur.kind !== v.kind) return false
    if (v.kind === 'category' && cur.kind === 'category') return cur.id === v.id
    if (v.kind === 'tag' && cur.kind === 'tag') return cur.name === v.name
    if (v.kind === 'browse' && cur.kind === 'browse') return cur.search === v.search
    return true
  }
  const go = (v: View) => {
    setView(v)
    onNavigate?.()
  }

  // Rows are dragged with their addresses as JSON.
  const dropProps = (key: string, apply: (addrs: string[]) => void) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes(DRAG)) return
      e.preventDefault()
      setDropTarget(key)
    },
    onDragLeave: () => setDropTarget(null),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault()
      setDropTarget(null)
      const raw = e.dataTransfer.getData(DRAG)
      if (raw) apply(JSON.parse(raw))
    },
  })
  const cls = (base: string, v: View, key?: string) =>
    `${base}${active(v) ? ' active' : ''}${key && dropTarget === key ? ' drop' : ''}`

  return (
    <nav className="sidebar">
      <div className="brand">
        <span className="logo" aria-hidden="true">Y</span>
        <div>
          <div className="name">YAQS</div>
          <div className="sum dim">{t('sb.summary', total.players, total.servers)}</div>
        </div>
      </div>

      <div className="group">
        <button className={cls('item', { kind: 'all' })} onClick={() => go({ kind: 'all' })}>
          <span className="label">{t('view.all')}</span><span className="n">{total.servers}</span>
        </button>
        <button className={cls('item', { kind: 'favorites' }, 'fav')} onClick={() => go({ kind: 'favorites' })}
          {...dropProps('fav', (a) => setFavorite(a, true))}>
          <span className="label">★ {t('view.favorites')}</span><span className="n">{favs.servers}</span>
        </button>
      </div>

      <div className="group">
        <div className="head">
          <span>{t('sb.categories')}</span>
          <button className="btn ghost small" onClick={() => setEditing(!editing)}>{editing ? t('done') : t('sb.edit')}</button>
        </div>
        {s.categories.map((c, i) => {
          const st = stats((cat) => cat === c.id)
          return editing ? (
            <div className="edit-row" key={c.id}>
              <input className="field" value={c.name} aria-label={t('sb.catName')}
                onChange={(e) => update((d) => { d.categories[i].name = e.target.value })} />
              <div className="swatches">
                {swatches.map((sw) => (
                  <button key={sw} className={`sw${c.color === sw ? ' sel' : ''}`} style={{ background: sw }} aria-label={t('sb.color', sw)}
                    onClick={() => update((d) => { d.categories[i].color = sw })} />
                ))}
              </div>
              <div className="edit-actions">
                <button className="btn ghost icon" aria-label={t('sb.moveUp')} disabled={i === 0} onClick={() => moveCategory(c.id, -1)}>↑</button>
                <button className="btn ghost icon" aria-label={t('sb.moveDown')} disabled={i === s.categories.length - 1} onClick={() => moveCategory(c.id, 1)}>↓</button>
                <button className="btn ghost danger" onClick={() => { if (confirm(t('sb.deleteCat', c.name))) deleteCategory(c.id) }}>{t('delete')}</button>
              </div>
            </div>
          ) : (
            <button key={c.id} className={cls('item', { kind: 'category', id: c.id }, c.id)} title={t('sb.summary', st.players, st.servers)}
              onClick={() => go({ kind: 'category', id: c.id })} {...dropProps(c.id, (a) => moveToCategory(a, c.id))}>
              <span className="bar" style={{ background: c.color }} />
              <span className="label">{c.name}</span>
              {st.players > 0 && <span className="players">{st.players}</span>}
              <span className="n">{st.servers}</span>
            </button>
          )
        })}
        {uncategorized.servers > 0 && !editing && (
          <button className={cls('item', { kind: 'uncategorized' }, 'none')} onClick={() => go({ kind: 'uncategorized' })}
            {...dropProps('none', (a) => moveToCategory(a, null))}>
            <span className="bar" style={{ background: 'var(--text-faint)' }} />
            <span className="label dim">{t('uncategorized')}</span><span className="n">{uncategorized.servers}</span>
          </button>
        )}
        <form className="new" onSubmit={(e) => {
          e.preventDefault()
          if (!newCat.trim()) return
          go({ kind: 'category', id: createCategory(newCat.trim()) })
          setNewCat('')
        }}>
          <input className="field" placeholder={t('sb.newCategory')} value={newCat} onChange={(e) => setNewCat(e.target.value)} aria-label={t('sb.newCategoryAria')} />
        </form>
      </div>

      {s.tags.length > 0 && (
        <div className="group">
          <div className="head"><span>{t('sb.tags')}</span></div>
          <div className="tags">
            {s.tags.map((tag) => (
              <span key={tag.name} className={`tagwrap${dropTarget === `tag:${tag.name}` ? ' drop' : ''}`}
                {...dropProps(`tag:${tag.name}`, (a) => addTag(a, tag.name))}>
                <button className={`chip tag${active({ kind: 'tag', name: tag.name }) ? ' active' : ''}`} style={{ background: tag.color }}
                  onClick={() => go({ kind: 'tag', name: tag.name })}>{tag.name}</button>
                {editing && <button className="x" aria-label={t('sb.deleteTag', tag.name)} onClick={() => deleteTag(tag.name)}>✕</button>}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="group">
        <div className="head"><span>{t('sb.findServers')}</span></div>
        <button className={cls('item', { kind: 'browse' })} onClick={() => go({ kind: 'browse' })}>
          <span className="label">{t('sb.browse')}</span>
        </button>
        {s.savedSearches.map((q) => (
          <button key={q.id} className={cls('item sub', { kind: 'browse', search: q.id })} onClick={() => go({ kind: 'browse', search: q.id })}>
            <span className="label">{q.name}</span>
          </button>
        ))}
      </div>

      <div className="group">
        <div className="head"><span>{t('sb.watch')}</span></div>
        <button className={cls('item', { kind: 'buddies' })} onClick={() => go({ kind: 'buddies' })}>
          <span className="label">{t('view.buddies')}</span>
          {buddyCount > 0 && <span className="players">{t('sb.online', buddyCount)}</span>}
        </button>
        <button className={cls('item', { kind: 'alerts' })} onClick={() => go({ kind: 'alerts' })}>
          <span className="label">{t('view.alerts')}</span>
          {logCount > 0 && <span className="n">{logCount}</span>}
        </button>
      </div>
    </nav>
  )
}
