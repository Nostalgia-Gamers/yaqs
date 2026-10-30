import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  addTag, ensureTag, moveToCategory, removeServers, removeTag, setFavorite, update, useDb,
} from '../lib/store'
import { useLive, type Change } from '../lib/live'
import { useFlash, useNow } from '../lib/hooks'
import { ago, pingClass, shortGame } from '../lib/format'
import { flagUrl } from '../lib/serverinfo'
import { openMenu } from '../lib/menu'
import { isFull, publicSlots, type Row } from '../lib/rows'
import type { ColumnKey, SortKey, Tag } from '../lib/types'
import { useT, type T } from '../lib/i18n'

const DRAG = 'application/x-yaqs-addrs'

type ColLabel = 'col.server' | 'col.address' | 'col.map' | 'col.players' | 'col.ping' | 'col.game' | 'col.tags' | 'col.updated'

const headers: { key: ColumnKey; label?: ColLabel; sort?: SortKey; cls: string }[] = [
  { key: 'status', cls: 'c-status' },
  { key: 'lock', cls: 'c-icon' },
  { key: 'vac', cls: 'c-icon' },
  { key: 'name', label: 'col.server', sort: 'name', cls: 'c-name' },
  { key: 'addr', label: 'col.address', sort: 'addr', cls: 'c-addr' },
  { key: 'map', label: 'col.map', sort: 'map', cls: 'c-map' },
  { key: 'players', label: 'col.players', sort: 'players', cls: 'c-players' },
  { key: 'ping', label: 'col.ping', sort: 'ping', cls: 'c-ping' },
  { key: 'game', label: 'col.game', sort: 'game', cls: 'c-game' },
  { key: 'tags', label: 'col.tags', cls: 'c-tags' },
  { key: 'updated', label: 'col.updated', sort: 'updated', cls: 'c-updated' },
]

export function ServerTable({ rows, selected, onSelect, checked, setChecked, empty, onEdit }: {
  rows: Row[]
  selected: string | null
  onSelect: (addr: string | null) => void
  checked: string[]
  setChecked: (c: string[]) => void
  empty: string
  onEdit: (addrs: string[]) => void
}) {
  const t = useT()
  const settings = useDb((s) => s.settings)
  const categories = useDb((s) => s.categories)
  const tags = useDb((s) => s.tags)
  const servers = useDb((s) => s.servers)
  const changes = useLive((l) => l.changes)
  const now = useNow()
  const anchor = useRef<string | null>(null)
  const [bulkTag, setBulkTag] = useState('')

  const cols = useMemo(() => headers.filter((h) => settings.columns.includes(h.key)), [settings.columns])
  const colKeys = useMemo(() => cols.map((c) => c.key), [cols])
  const checkedSet = new Set(checked)
  // Row callbacks read the latest state through a ref so they stay stable and
  // memoized rows only re-render when their own server changes.
  const latest = useRef({ rows, checked, selected, onSelect, setChecked })
  latest.current = { rows, checked, selected, onSelect, setChecked }
  const allChecked = rows.length > 0 && rows.every((r) => checkedSet.has(r.s.addr))

  const sortBy = (key?: SortKey) => {
    if (!key) return
    update((d) => {
      if (d.settings.sort.key === key) d.settings.sort.dir = d.settings.sort.dir === 1 ? -1 : 1
      else d.settings.sort = { key, dir: key === 'players' || key === 'updated' ? -1 : 1 }
    })
  }

  const toggle = useCallback((addr: string) => {
    const { checked, setChecked } = latest.current
    setChecked(checked.includes(addr) ? checked.filter((a) => a !== addr) : [...checked, addr])
  }, [])

  const click = useCallback((e: React.MouseEvent, addr: string) => {
    const { rows, checked, selected, onSelect, setChecked } = latest.current
    if (e.shiftKey && anchor.current) {
      const a = rows.findIndex((r) => r.s.addr === anchor.current)
      const b = rows.findIndex((r) => r.s.addr === addr)
      const [from, to] = a < b ? [a, b] : [b, a]
      setChecked([...new Set([...checked, ...rows.slice(from, to + 1).map((r) => r.s.addr)])])
      return
    }
    if (e.ctrlKey || e.metaKey) {
      toggle(addr)
    } else {
      onSelect(selected === addr ? null : addr)
    }
    anchor.current = addr
  }, [toggle])

  // Arrow keys move the selection, Space checks, Escape clears.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!rows.length || (e.target as HTMLElement).closest('input, select, textarea, dialog')) return
      const i = rows.findIndex((r) => r.s.addr === selected)
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const j = Math.max(0, Math.min(rows.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))
        onSelect(rows[j].s.addr)
        document.getElementById(`row-${j}`)?.scrollIntoView({ block: 'nearest' })
      } else if (e.key === 'Escape') {
        onSelect(null)
        setChecked([])
      } else if (e.key === ' ' && selected) {
        e.preventDefault()
        toggle(selected)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const checkedTags = [...new Set(servers.filter((s) => checkedSet.has(s.addr)).flatMap((s) => s.tags))]
  const tagColor = (name: string) => tags.find((t) => t.name === name)?.color ?? 'var(--text-dim)'

  return (
    <>
      {checked.length > 0 && (
        <div className="bulk">
          <span><strong>{checked.length}</strong> {t('tbl.selected')}</span>
          <select className="field" value="" aria-label={t('tbl.moveAria')} onChange={(e) => {
            const v = e.target.value
            if (v) moveToCategory(checked, v === '-' ? null : v)
          }}>
            <option value="">{t('tbl.moveTo')}</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            <option value="-">{t('uncategorized')}</option>
          </select>
          <form onSubmit={(e) => {
            e.preventDefault()
            if (bulkTag.trim()) addTag(checked, ensureTag(bulkTag.trim()))
            setBulkTag('')
          }}>
            <input className="field" list="all-tags" placeholder={t('tbl.addTag')} value={bulkTag} onChange={(e) => setBulkTag(e.target.value)} aria-label={t('tbl.addTagAria')} />
          </form>
          {checkedTags.map((tag) => (
            <button key={tag} className="chip rm" style={{ background: tagColor(tag) }} onClick={() => removeTag(checked, tag)} title={t('tbl.removeFromSelected')}>{tag} ✕</button>
          ))}
          <span className="spacer" />
          <button className="btn primary" onClick={() => onEdit(checked)}>{t('tbl.editN', checked.length)}</button>
          <button className="btn danger" onClick={() => {
            if (!confirm(t('tbl.confirmRemove', checked.length))) return
            removeServers(checked)
            if (selected && checkedSet.has(selected)) onSelect(null)
            setChecked([])
          }}>{t('remove')}</button>
          <button className="btn ghost" onClick={() => setChecked([])}>{t('tbl.clearSelection')}</button>
        </div>
      )}

      <datalist id="all-tags">{tags.map((tag) => <option key={tag.name} value={tag.name} />)}</datalist>

      <div className={`table-wrap${settings.density === 'comfortable' ? ' comfortable' : ''}`}>
        <table className="servers">
          <thead>
            <tr>
              <th className="c-check">
                <input type="checkbox" checked={allChecked} aria-label={t('tbl.selectAll')}
                  onChange={() => setChecked(allChecked ? [] : rows.map((r) => r.s.addr))} />
              </th>
              {cols.map((h) => (
                <th key={h.key} className={h.cls}
                  aria-sort={settings.sort.key === h.sort ? (settings.sort.dir === 1 ? 'ascending' : 'descending') : undefined}>
                  {h.sort ? (
                    <button onClick={() => sortBy(h.sort)}>
                      {h.label && t(h.label)}
                      {settings.sort.key === h.sort && <span className="arrow">{settings.sort.dir === 1 ? '▲' : '▼'}</span>}
                    </button>
                  ) : h.key === 'lock' ? <span title={t('col.password')}>🔒</span>
                    : h.key === 'vac' ? <span title={t('col.vacSecured')}>🛡</span>
                    : h.label && t(h.label)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <ServerRow key={row.s.addr} t={t} index={i} row={row} cols={colKeys} tags={tags}
                selected={selected === row.s.addr} checked={checkedSet.has(row.s.addr)} change={changes.get(row.s.addr)}
                now={settings.columns.includes('updated') ? now : 0}
                onClick={click} onToggle={toggle} draggedAddrs={checkedSet.has(row.s.addr) ? checked : undefined} />
            ))}
          </tbody>
        </table>
        {!rows.length && <p className="empty dim">{empty}</p>}
      </div>
    </>
  )
}

const ServerRow = memo(function ServerRow({ t, index, row, cols, tags, selected, checked, change, now, onClick, onToggle, draggedAddrs }: {
  t: T
  index: number
  row: Row
  cols: ColumnKey[]
  tags: Tag[]
  selected: boolean
  checked: boolean
  change?: Change
  now: number
  onClick: (e: React.MouseEvent, addr: string) => void
  onToggle: (addr: string) => void
  draggedAddrs?: string[]
}) {
  const ref = useFlash<HTMLTableRowElement>(change)
  const { r, s } = row
  const info = r?.info
  const on = !!r?.online
  const flag = flagUrl(r?.geo?.countryCode)
  const tagColor = (name: string) => tags.find((t) => t.name === name)?.color ?? 'var(--text-dim)'

  return (
    <tr ref={ref} id={`row-${index}`} className={[selected && 'sel', checked && 'checked', r && !on && 'offline'].filter(Boolean).join(' ')}
      draggable onClick={(e) => onClick(e, s.addr)}
      onContextMenu={(e) => openMenu(e, draggedAddrs ?? [s.addr])}
      onDragStart={(e) => {
        const addrs = draggedAddrs ?? [s.addr]
        e.dataTransfer.setData(DRAG, JSON.stringify(addrs))
        e.dataTransfer.setData('text/plain', addrs.join('\n'))
        e.dataTransfer.effectAllowed = 'copyMove'
      }}>
      <td className="c-check" onClick={(e) => e.stopPropagation()}>
        <input type="checkbox" checked={checked} onChange={() => onToggle(s.addr)} aria-label={t('row.select', row.name)} />
      </td>
      {cols.map((c) => {
        switch (c) {
          case 'status':
            return <td key={c} className="c-status"><span className={`dot ${!r ? 'wait' : on ? 'on' : 'off'}`} title={!r ? t('row.waiting') : on ? t('row.online') : t('row.offlineErr', r.error ?? '')} /></td>
          case 'lock':
            return <td key={c} className="c-icon">{info?.password && <span title={t('row.passwordProtected')}>🔒</span>}</td>
          case 'vac':
            return <td key={c} className="c-icon">{info?.vac && <span className="vac" title={t('col.vacSecured')}>🛡</span>}</td>
          case 'name':
            return (
              <td key={c} className="c-name">
                <button className={`fav${s.favorite ? ' on' : ''}`} aria-label={s.favorite ? t('row.unfavorite') : t('row.favorite')}
                  onClick={(e) => { e.stopPropagation(); setFavorite([s.addr]) }}>★</button>
                {flag && <img className="fi flag" src={flag} alt={r?.geo?.country} title={r?.geo?.country} width={16} height={12} />}
                <span className="nm" title={info?.name ?? s.addr}>{row.name}</span>
                {s.alias && info?.name && <span className="real faint">{info.name}</span>}
              </td>
            )
          case 'addr':
            return <td key={c} className="c-addr mono dim">{s.addr}</td>
          case 'map':
            return <td key={c} className="c-map">{info?.map ?? ''}</td>
          case 'players':
            return (
              <td key={c} className="c-players">
                {on && info ? (
                  <div className={`pl${isFull(info, s) ? ' full' : ''}`}
                    title={t('row.slots', info.players - info.bots, info.bots, info.maxPlayers, s.reserved ?? 0, isFull(info, s))}>
                    <span className="cnt">
                      <strong>{info.players - info.bots}</strong>
                      {info.bots > 0 && <span className="bots">+{info.bots}</span>}
                      <span className="max">/{info.maxPlayers}</span>
                    </span>
                    <span className="meter">
                      <i style={{ width: `${Math.min(100, (info.players / Math.max(1, info.maxPlayers)) * 100)}%` }} />
                      {!!s.reserved && <b className="reserve" style={{ left: `${(publicSlots(info, s) / Math.max(1, info.maxPlayers)) * 100}%` }} />}
                    </span>
                  </div>
                ) : r ? <span className="faint">{t('row.offline')}</span> : null}
              </td>
            )
          case 'ping':
            return <td key={c} className="c-ping">{on && <span className={pingClass(r!.ping)}>{r!.ping}</span>}</td>
          case 'game':
            return <td key={c} className="c-game dim">{info ? shortGame(info.appid, info.folder, info.game) : ''}</td>
          case 'tags':
            return <td key={c} className="c-tags">{s.tags.map((tag) => <span key={tag} className="chip" style={{ background: tagColor(tag) }}>{tag}</span>)}</td>
          case 'updated':
            return <td key={c} className="c-updated faint">{r ? ago(r.ts, now, t) : ''}</td>
        }
      })}
    </tr>
  )
}, (a, b) =>
  a.t === b.t && a.row.r === b.row.r && a.row.s === b.row.s && a.row.name === b.row.name && a.index === b.index &&
  a.cols === b.cols && a.tags === b.tags && a.selected === b.selected && a.checked === b.checked &&
  a.change === b.change && a.now === b.now && a.draggedAddrs === b.draggedAddrs)
