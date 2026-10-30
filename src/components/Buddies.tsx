import { useState } from 'react'
import { update, useDb } from '../lib/store'
import { useLive } from '../lib/live'
import { buddiesOnline, displayName } from '../lib/alerts'
import { duration } from '../lib/format'
import { useT } from '../lib/i18n'

export function Buddies({ selected, onSelect }: { selected: string | null; onSelect: (addr: string) => void }) {
  const t = useT()
  const state = useDb()
  const results = useLive((l) => l.results)
  const [input, setInput] = useState('')
  const online = buddiesOnline(state, results)

  return (
    <div className="page">
      <section>
        <h2>{t('bd.title')}</h2>
        <p className="dim">{t('bd.intro')}</p>
        <form className="inline" onSubmit={(e) => {
          e.preventDefault()
          const name = input.trim()
          if (name && !state.buddies.some((b) => b.toLowerCase() === name.toLowerCase())) update((d) => { d.buddies.push(name) })
          setInput('')
        }}>
          <input className="field" placeholder={t('bd.namePh')} value={input} onChange={(e) => setInput(e.target.value)} aria-label={t('bd.nameAria')} />
          <button className="btn primary">{t('bd.add')}</button>
        </form>
        {state.buddies.length > 0 && (
          <ul className="names">
            {state.buddies.map((b, i) => (
              <li key={b}><span>{b}</span>
                <button className="btn ghost small" onClick={() => update((d) => { d.buddies.splice(i, 1) })}>{t('remove')}</button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3>{t('bd.playingNow')}</h3>
        {online.length ? (
          <table className="plain">
            <thead><tr><th>{t('bd.player')}</th><th>{t('col.server')}</th><th>{t('col.map')}</th><th className="num">{t('dt.score')}</th><th className="num">{t('dt.time')}</th></tr></thead>
            <tbody>
              {online.map((o, i) => {
                const r = results.get(o.addr)
                return (
                  <tr key={`${o.addr}-${o.player}-${i}`} className={selected === o.addr ? 'sel' : ''} onClick={() => onSelect(o.addr)}>
                    <td className="who">{o.player}</td>
                    <td>{displayName(o.addr, r)}</td>
                    <td className="dim">{r?.info?.map}</td>
                    <td className="num">{o.score}</td>
                    <td className="num dim">{duration(o.duration)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        ) : <p className="dim">{state.buddies.length ? t('bd.noneOnline') : t('bd.none')}</p>}
      </section>
    </div>
  )
}
