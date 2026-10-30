import { useEffect, useMemo, useState } from 'react'
import { openUrl } from '@tauri-apps/plugin-opener'
import {
  addServers, addTag, ensureTag, findServer, removeServers, removeTag, setFavorite, updateServer, useDb,
} from '../lib/store'
import { fetchRules, history, useLive } from '../lib/live'
import { buddyMatch } from '../lib/alerts'
import { useNow } from '../lib/hooks'
import { ago, duration, pingClass, shortGame } from '../lib/format'
import { facts, flagUrl } from '../lib/serverinfo'
import { isFull, rowName } from '../lib/rows'
import { Sparkline } from './Sparkline'
import type { Rule } from '../lib/types'
import { useT } from '../lib/i18n'

const RULES_EVERY = 10_000 // time left and next map change, so keep rules fresh

export function Detail({ addr, onClose }: { addr: string; onClose: () => void }) {
  const t = useT()
  const state = useDb()
  const saved = findServer(addr, state)
  const r = useLive((l) => l.results.get(addr))
  const info = r?.info
  const now = useNow()
  const [tab, setTab] = useState<'players' | 'rules' | 'organize'>('players')
  const [rules, setRules] = useState<Rule[] | null>(null)
  const [rulesErr, setRulesErr] = useState('')
  const [rulesBusy, setRulesBusy] = useState(false)
  const [ruleFilter, setRuleFilter] = useState('')
  const [newTag, setNewTag] = useState('')
  const [copied, setCopied] = useState(false)
  const [playerSort, setPlayerSort] = useState<'score' | 'time' | 'name'>('score')
  const [refresh, setRefresh] = useState(0)

  // Load rules when the selection changes, then keep refreshing them.
  useEffect(() => {
    let alive = true
    let have = false
    const load = async (quiet: boolean) => {
      if (!quiet) setRulesBusy(true)
      const res = await fetchRules(addr)
      if (!alive) return
      setRulesBusy(false)
      if (res.error) {
        if (quiet && have) return // keep the last good rules on a lost packet
        setRulesErr(res.error.includes('timeout') ? 'timeout' : res.error)
        setRules([])
      } else {
        have = true
        setRulesErr('')
        setRules(res.rules ?? [])
      }
    }
    setRules(null)
    setRuleFilter('')
    load(false)
    const t = setInterval(() => load(true), RULES_EVERY)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [addr, refresh])

  const f = useMemo(() => facts(rules, t), [rules, t])

  const players = useMemo(() => {
    const list = [...(r?.players ?? [])]
    if (playerSort === 'score') list.sort((a, b) => b.score - a.score)
    else if (playerSort === 'time') list.sort((a, b) => b.duration - a.duration)
    else list.sort((a, b) => a.name.localeCompare(b.name))
    return list
  }, [r?.players, playerSort])

  const q = ruleFilter.trim().toLowerCase()
  const shownRules = (rules ?? []).filter((x) => !q || x.name.toLowerCase().includes(q) || x.value.toLowerCase().includes(q))

  // history is updated outside React; r changes whenever a new sample lands.
  const samples = useMemo(() => [...(history.get(addr) ?? [])], [addr, r])
  const pings = samples.map((s) => s.ping)
  const okPings = pings.filter((p): p is number => p !== null)
  const avgPing = okPings.length ? okPings.reduce((a, b) => a + b, 0) / okPings.length : null

  const copyConnect = async () => {
    try {
      await navigator.clipboard.writeText(`connect ${addr}`)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* clipboard unavailable */ }
  }

  const env = (e?: string) => (e ? e[0].toUpperCase() + e.slice(1) : '')
  const serverType = (s: string) =>
    s === 'dedicated' ? t('type.dedicated') : s === 'listen' ? t('type.listen') : s === 'proxy' ? t('type.proxy') : s
  const tagColor = (name: string) => state.tags.find((t) => t.name === name)?.color ?? 'var(--text-dim)'

  return (
    <aside className="detail">
      <header>
        <div className="title">
          <span className={`dot ${!r ? 'wait' : r.online ? 'on' : 'off'}`} />
          <h2 title={info?.name}>{saved ? rowName(saved, r) : info?.name ?? addr}</h2>
          <button className="btn ghost icon" aria-label={t('dt.closeDetails')} onClick={onClose}>✕</button>
        </div>
        {saved?.alias && info?.name && <div className="real dim">{info.name}</div>}
        <div className="addr mono dim selectable">{addr}{saved?.host && ` (${saved.host})`}</div>
        <div className="actions">
          <button className="btn primary" onClick={() => openUrl(`steam://connect/${addr}`)}>{t('dt.connect')}</button>
          <button className="btn" onClick={copyConnect}>{copied ? t('dt.copied') : t('dt.copyConnect')}</button>
          {saved ? (
            <button className={`btn icon${saved.favorite ? ' fav' : ''}`} aria-label={saved.favorite ? t('row.unfavorite') : t('row.favorite')}
              onClick={() => setFavorite([addr])}>★</button>
          ) : (
            <button className="btn" onClick={() => addServers([{ addr }], state.categories[0]?.id ?? null)}>{t('dt.addToList')}</button>
          )}
        </div>
      </header>

      <section className="facts">
        <div className="graph">
          <div className="graph-label">
            <span>{t('dt.ping')}</span>
            {r?.online ? <strong className={pingClass(r.ping)}>{r.ping} ms</strong> : r ? <strong className="poor">{t('dt.noReply')}</strong> : null}
            {avgPing !== null && <span className="faint">{t('dt.avg', avgPing.toFixed(1))}</span>}
          </div>
          <Sparkline label={t('dt.pingOverTime')} values={pings} color="var(--accent)" height={52} />
        </div>

        {!r ? <p className="dim">{t('dt.waiting')}</p> : (
          <>
            {!r.online && <p className="offline">{t('dt.offline', r.lastSeen ? ago(r.lastSeen, now, t) : null)}</p>}
            <dl>
              {r.geo?.country && (
                <>
                  <dt>{t('dt.location')}</dt>
                  <dd className="loc">
                    {flagUrl(r.geo.countryCode) && <img className="fi" src={flagUrl(r.geo.countryCode)} alt="" width={20} height={15} />}
                    <span>{r.geo.country}{r.geo.isp && <span className="dim">, {r.geo.isp}</span>}</span>
                  </dd>
                </>
              )}
              {info && (
                <>
                  <dt>{t('dt.game')}</dt>
                  <dd>{info.game} <span className="dim">({shortGame(info.appid, info.folder, info.game)}{info.folder ? `, ${info.folder}` : ''})</span></dd>
                  <dt>{t('dt.players')}</dt>
                  <dd>
                    <strong className="big">{info.players - info.bots}</strong> / {info.maxPlayers}
                    {info.bots > 0 && <span className="dim">, {t('dt.bots', info.bots)}</span>}
                    {!!saved?.reserved && <span className="dim">, {t('dt.reserved', saved.reserved)}</span>}
                    {isFull(info, saved) && <span className="full-badge">{t('dt.full')}</span>}
                  </dd>
                  <dt>{t('dt.map')}</dt>
                  <dd><strong>{info.map}</strong>{f.nextMap && <span className="dim">, {t('dt.next', f.nextMap)}</span>}</dd>
                  {f.timeLeft && <><dt>{t('dt.timeLeft')}</dt><dd>{f.timeLeft}</dd></>}
                  {f.limits && <><dt>{t('dt.limits')}</dt><dd>{f.limits}</dd></>}
                  {f.friendlyFire && <><dt>{t('dt.friendlyFire')}</dt><dd>{f.friendlyFire}</dd></>}
                  {f.addons.length > 0 && <><dt>{t('dt.addons')}</dt><dd>{f.addons.join(', ')}</dd></>}
                  <dt>{t('dt.server')}</dt>
                  <dd>{[env(info.environment), serverType(info.serverType), info.vac ? t('dt.vac') : t('dt.noVac'), info.password ? t('dt.password') : ''].filter(Boolean).join(', ')}</dd>
                  <dt>{t('dt.version')}</dt>
                  <dd>{info.version ?? '—'} <span className="dim">({t('dt.protocol', info.protocol)})</span></dd>
                  {f.contact && <><dt>{t('dt.contact')}</dt><dd>{f.contact}</dd></>}
                  {info.keywords && <><dt>{t('dt.keywords')}</dt><dd className="dim">{info.keywords}</dd></>}
                  {info.steamId && <><dt>{t('dt.steamId')}</dt><dd className="mono dim">{info.steamId}</dd></>}
                </>
              )}
            </dl>
            {samples.length > 1 && (
              <div className="graph">
                <div className="graph-label">
                  <span>{t('dt.players')}</span>
                  <span className="faint">{t('dt.lastMin', Math.max(1, Math.round((samples[samples.length - 1].ts - samples[0].ts) / 60000)))}</span>
                </div>
                <Sparkline label={t('dt.playersOverTime')} values={samples.map((s) => s.players)} max={info?.maxPlayers} color="var(--blue)" height={30} />
              </div>
            )}
          </>
        )}
      </section>

      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'players'} className={tab === 'players' ? 'on' : ''} onClick={() => setTab('players')}>
          {t('tab.players', r?.online ? r.players.length : null)}
        </button>
        <button role="tab" aria-selected={tab === 'rules'} className={tab === 'rules' ? 'on' : ''} onClick={() => setTab('rules')}>
          {t('tab.rules', rules?.length ?? null)}
        </button>
        {saved && (
          <button role="tab" aria-selected={tab === 'organize'} className={tab === 'organize' ? 'on' : ''} onClick={() => setTab('organize')}>{t('tab.organize')}</button>
        )}
      </div>

      <section className="tabbody">
        {tab === 'players' && (players.length ? (
          <table className="list">
            <thead><tr>
              <th><button onClick={() => setPlayerSort('name')}>{t('dt.name')}</button></th>
              <th className="num"><button onClick={() => setPlayerSort('score')}>{t('dt.score')}</button></th>
              <th className="num"><button onClick={() => setPlayerSort('time')}>{t('dt.time')}</button></th>
            </tr></thead>
            <tbody>
              {players.map((p, i) => (
                <tr key={`${p.name}-${i}`} className={buddyMatch(p.name, state.buddies) ? 'buddy' : ''}>
                  <td className="pname">{p.name || t('dt.connecting')}</td>
                  <td className="num">{p.score}</td>
                  <td className="num dim">{duration(p.duration)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="dim">{r?.online ? t('dt.nobody') : t('dt.noListOffline')}</p>)}

        {tab === 'rules' && (
          <>
            <div className="rulebar">
              <input className="field" placeholder={t('dt.filterCvars')} value={ruleFilter} onChange={(e) => setRuleFilter(e.target.value)} aria-label={t('dt.filterRules')} />
              <button className="btn" onClick={() => setRefresh((n) => n + 1)} disabled={rulesBusy}>{rulesBusy ? t('dt.loading') : t('dt.refresh')}</button>
            </div>
            {rulesErr && <p className="dim">{rulesErr === 'timeout' ? t('dt.rulesTimeout') : rulesErr}</p>}
            {shownRules.length > 0 && (
              <table className="list rules">
                <tbody>
                  {shownRules.map((rule) => (
                    <tr key={rule.name}><td className="mono">{rule.name}</td><td className="mono val">{rule.value}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}

        {tab === 'organize' && saved && (
          <div className="org">
            <label>
              <span className="faint">{t('dt.alias')}</span>
              <input className="field" placeholder={t('dt.aliasPh')} defaultValue={saved.alias ?? ''} key={`alias-${addr}`}
                onBlur={(e) => updateServer(addr, { alias: e.target.value.trim() || undefined })} />
            </label>
            <label>
              <span className="faint">{t('dt.category')}</span>
              <select className="field" value={saved.category ?? ''} onChange={(e) => updateServer(addr, { category: e.target.value || null })}>
                {state.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                <option value="">{t('uncategorized')}</option>
              </select>
            </label>
            <label>
              <span className="faint">{t('dt.reservedLabel')}</span>
              <span className="reserved-field">
                <input className="field n" type="number" min={0} max={64} placeholder="0" defaultValue={saved.reserved || ''} key={`res-${addr}`}
                  onBlur={(e) => updateServer(addr, { reserved: Number(e.target.value) || undefined })} />
                <span className="faint">{t('dt.reservedHelp', info ? Math.max(0, info.maxPlayers - (saved.reserved ?? 0)) : null)}</span>
              </span>
            </label>
            <div className="tagrow">
              <span className="faint">{t('dt.tags')}</span>
              <div className="tags">
                {saved.tags.map((tag) => (
                  <button key={tag} className="chip" style={{ background: tagColor(tag) }} onClick={() => removeTag([addr], tag)} title={t('dt.removeTag')}>{tag} ✕</button>
                ))}
                <form onSubmit={(e) => {
                  e.preventDefault()
                  if (newTag.trim()) addTag([addr], ensureTag(newTag.trim()))
                  setNewTag('')
                }}>
                  <input className="field small" list="all-tags" placeholder={t('tbl.addTag')} value={newTag} onChange={(e) => setNewTag(e.target.value)} aria-label={t('tbl.addTag')} />
                </form>
              </div>
            </div>
            <label>
              <span className="faint">{t('dt.notes')}</span>
              <textarea className="field" rows={3} defaultValue={saved.notes ?? ''} key={`notes-${addr}`}
                onBlur={(e) => updateServer(addr, { notes: e.target.value || undefined })} />
            </label>
            <div className="foot">
              <span className="faint">{t('dt.added', ago(saved.addedAt, now, t))}</span>
              <button className="btn ghost danger" onClick={() => {
                if (!confirm(t('dt.confirmRemove', rowName(saved, r)))) return
                removeServers([addr])
                onClose()
              }}>{t('dt.removeFromList')}</button>
            </div>
          </div>
        )}
      </section>
    </aside>
  )
}
