import { useEffect, useMemo, useState } from 'react'
import { Dialog } from './Dialog'
import { swatches, update, useDb } from '../lib/store'
import type { SavedServer } from '../lib/types'
import { useT } from '../lib/i18n'

const KEEP = '__keep'

/** One value if every server shares it, otherwise undefined ("mixed"). */
function common<T>(servers: SavedServer[], get: (s: SavedServer) => T): T | undefined {
  const first = get(servers[0])
  return servers.every((s) => get(s) === first) ? first : undefined
}

/** Edits several saved servers at once. Untouched fields stay as they are on each server. */
export function BulkEdit({ open, onClose, addrs }: { open: boolean; onClose: () => void; addrs: string[] }) {
  const t = useT()
  const state = useDb()
  const servers = useMemo(() => state.servers.filter((s) => addrs.includes(s.addr)), [state.servers, addrs])

  const [category, setCategory] = useState(KEEP)
  const [favorite, setFavorite] = useState(KEEP)
  const [reserved, setReserved] = useState('')
  const [addTags, setAddTags] = useState<string[]>([])
  const [dropTags, setDropTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState('')
  const [notes, setNotes] = useState('')
  const [clearNotes, setClearNotes] = useState(false)
  const [alias, setAlias] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setCategory(KEEP)
    setFavorite(KEEP)
    setReserved('')
    setAddTags([])
    setDropTags([])
    setTagInput('')
    setNotes('')
    setClearNotes(false)
    setAlias(null)
  }, [open])

  if (!servers.length) return null

  const sameCategory = common(servers, (s) => s.category ?? '')
  const sameReserved = common(servers, (s) => s.reserved ?? 0)
  const sameFavorite = common(servers, (s) => !!s.favorite)
  const tagCounts = new Map<string, number>()
  for (const s of servers) for (const t of s.tags) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1)
  const tagColor = (name: string) => state.tags.find((t) => t.name === name)?.color ?? 'var(--text-dim)'
  const catName = (id: string) => (id ? state.categories.find((c) => c.id === id)?.name ?? '?' : t('uncategorized'))

  const pushTag = () => {
    const t = tagInput.trim()
    if (t && !addTags.some((x) => x.toLowerCase() === t.toLowerCase())) setAddTags([...addTags, t])
    setTagInput('')
  }

  const apply = () => {
    const set = new Set(addrs)
    update((d) => {
      // Create new tags once, reusing an existing tag's spelling when it matches.
      const names = addTags.map((tag) => {
        const existing = d.tags.find((x) => x.name.toLowerCase() === tag.toLowerCase())
        if (existing) return existing.name
        d.tags.push({ name: tag, color: swatches[d.tags.length % swatches.length] })
        return tag
      })
      for (const s of d.servers) {
        if (!set.has(s.addr)) continue
        if (category !== KEEP) s.category = category || null
        if (favorite !== KEEP) s.favorite = favorite === 'yes'
        if (reserved !== '') s.reserved = Number(reserved) || undefined
        s.tags = [...new Set([...s.tags.filter((tag) => !dropTags.includes(tag)), ...names])]
        if (alias !== null && servers.length === 1) s.alias = alias.trim() || undefined
        if (clearNotes) s.notes = undefined
        else if (notes.trim()) s.notes = notes
      }
    })
    onClose()
  }

  const changes = alias !== null || category !== KEEP || favorite !== KEEP || reserved !== '' || addTags.length > 0 || dropTags.length > 0 || clearNotes || notes.trim() !== ''

  return (
    <Dialog title={servers.length === 1 ? t('be.title1', servers[0].alias || servers[0].addr) : t('be.titleN', servers.length)} open={open} onClose={onClose} actions={
      <>
        <button className="btn" onClick={onClose}>{t('cancel')}</button>
        <button className="btn primary" disabled={!changes} onClick={apply}>{servers.length === 1 ? t('save') : t('be.apply', servers.length)}</button>
      </>
    }>
      <div className="bulkedit">
        {servers.length > 1 ? <p className="faint">{t('be.intro')}</p> : (
          <label>
            <span>{t('dt.alias')}</span>
            <input className="field" placeholder={t('dt.aliasPh')} value={alias ?? servers[0].alias ?? ''} onChange={(e) => setAlias(e.target.value)} />
          </label>
        )}

        <label>
          <span>{t('dt.category')}</span>
          <select className="field" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value={KEEP}>{sameCategory === undefined ? t('be.keepMixed') : t('be.keep', catName(sameCategory))}</option>
            {state.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            <option value="">{t('uncategorized')}</option>
          </select>
        </label>

        <label>
          <span>{t('be.favorite')}</span>
          <select className="field" value={favorite} onChange={(e) => setFavorite(e.target.value)}>
            <option value={KEEP}>{sameFavorite === undefined ? t('be.keepMixed') : t('be.keep', sameFavorite ? t('yes') : t('no'))}</option>
            <option value="yes">{t('yes')}</option>
            <option value="no">{t('no')}</option>
          </select>
        </label>

        <label>
          <span>{t('be.reserved')}</span>
          <span className="inline">
            <input className="field n" type="number" min={0} max={64} value={reserved} onChange={(e) => setReserved(e.target.value)}
              placeholder={sameReserved === undefined ? t('be.mixed') : String(sameReserved)} />
            <span className="faint">{t('be.reservedHelp')}</span>
          </span>
        </label>

        <div className="tagrow">
          <span>{t('dt.tags')}</span>
          <div className="tags">
            {[...tagCounts].map(([tag, n]) => {
              const dropping = dropTags.includes(tag)
              return (
                <button key={tag} className={`chip${dropping ? ' dropping' : ''}`} style={{ background: tagColor(tag) }}
                  title={dropping ? t('be.willRemove') : t('be.clickRemove')}
                  onClick={() => setDropTags(dropping ? dropTags.filter((x) => x !== tag) : [...dropTags, tag])}>
                  {tag}{n < servers.length && <small> {n}/{servers.length}</small>} {dropping ? '↺' : '✕'}
                </button>
              )
            })}
            {addTags.map((tag) => (
              <button key={`+${tag}`} className="chip adding" style={{ background: tagColor(tag) }} title={t('be.willAdd')}
                onClick={() => setAddTags(addTags.filter((x) => x !== tag))}>+ {tag}</button>
            ))}
            <form onSubmit={(e) => { e.preventDefault(); pushTag() }}>
              <input className="field small" list="all-tags" placeholder={t('tbl.addTag')} value={tagInput} onChange={(e) => setTagInput(e.target.value)} onBlur={pushTag} />
            </form>
          </div>
        </div>

        <label>
          <span>{t('dt.notes')}</span>
          <span className="stack">
            <textarea className="field" rows={2} value={notes} disabled={clearNotes} onChange={(e) => setNotes(e.target.value)}
              placeholder={t('be.notesPh')} />
            <label className="check"><input type="checkbox" checked={clearNotes} onChange={(e) => setClearNotes(e.target.checked)} /> {t('be.clearNotes')}</label>
          </span>
        </label>
      </div>
    </Dialog>
  )
}
