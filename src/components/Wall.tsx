import { memo } from 'react'
import { useDb } from '../lib/store'
import { useLive, type Change } from '../lib/live'
import { useFlash } from '../lib/hooks'
import { openMenu } from '../lib/menu'
import { pingClass } from '../lib/format'
import { isFull, publicSlots, type Row } from '../lib/rows'
import { useT } from '../lib/i18n'

export function Wall({ rows, selected, onSelect }: { rows: Row[]; selected: string | null; onSelect: (a: string | null) => void }) {
  const t = useT()
  const categories = useDb((s) => s.categories)
  const changes = useLive((l) => l.changes)

  // Group by category, in sidebar order; uncategorized last.
  const groups: { name: string; color: string; rows: Row[] }[] = []
  for (const c of categories) {
    const rs = rows.filter((r) => r.s.category === c.id)
    if (rs.length) groups.push({ name: c.name, color: c.color, rows: rs })
  }
  const rest = rows.filter((r) => !r.s.category || !categories.some((c) => c.id === r.s.category))
  if (rest.length) groups.push({ name: t('uncategorized'), color: 'var(--text-faint)', rows: rest })

  return (
    <div className="wall">
      {groups.map((g) => (
        <section key={g.name}>
          <h2><span className="bar" style={{ background: g.color }} />{g.name}</h2>
          <div className="grid">
            {g.rows.map((row) => (
              <Card key={row.s.addr} row={row} selected={selected === row.s.addr} change={changes.get(row.s.addr)}
                onClick={() => onSelect(selected === row.s.addr ? null : row.s.addr)} />
            ))}
          </div>
        </section>
      ))}
      {!groups.length && <p className="dim">{t('wall.empty')}</p>}
    </div>
  )
}

const Card = memo(function Card({ row, selected, change, onClick }: { row: Row; selected: boolean; change?: Change; onClick: () => void }) {
  const t = useT()
  const ref = useFlash<HTMLButtonElement>(change)
  const { r } = row
  const info = r?.info
  return (
    <button ref={ref} className={`card${r && !r.online ? ' off' : ''}${selected ? ' sel' : ''}`} onClick={onClick}
      onContextMenu={(e) => openMenu(e, [row.s.addr])}>
      <div className="top">
        <span className={`dot ${!r ? 'wait' : r.online ? 'on' : 'off'}`} />
        <span className="nm">{row.name}</span>
      </div>
      {r?.online && info ? (
        <>
          <div className="count"><strong>{info.players - info.bots}</strong><span>/{info.maxPlayers}</span></div>
          <div className={`meter${isFull(info, row.s) ? ' full' : ''}`}>
            <span style={{ width: `${Math.min(100, (info.players / Math.max(1, info.maxPlayers)) * 100)}%` }} />
            {!!row.s.reserved && <b className="reserve" style={{ left: `${(publicSlots(info, row.s) / Math.max(1, info.maxPlayers)) * 100}%` }} />}
          </div>
          <div className="meta"><span>{info.map}</span><span className={pingClass(r.ping)}>{r.ping} ms</span></div>
        </>
      ) : r ? <div className="down">{t('wall.offline')}</div> : <div className="down faint">{t('wall.waiting')}</div>}
    </button>
  )
}, (a, b) => a.row.r === b.row.r && a.row.s === b.row.s && a.row.name === b.row.name && a.selected === b.selected && a.change === b.change)
