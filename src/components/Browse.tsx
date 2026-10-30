import { useEffect, useMemo, useState } from 'react'
import { addServers, findServer, setSettings, setView, uid, update, useDb } from '../lib/store'
import { browse, useLive, want } from '../lib/live'
import { games, pingClass, presetFilter, regionName } from '../lib/format'
import { useT } from '../lib/i18n'
import { openMenu } from '../lib/menu'
import type { BrowseFilter, BrowseServer } from '../lib/types'

const LIVE_LIMIT = 150 // live-query this many results; the rest show the master's snapshot

export function Browse({ searchId, selected, onSelect }: {
  searchId?: string
  selected: string | null
  onSelect: (addr: string | null) => void
}) {
  const t = useT()
  const state = useDb()
  const results = useLive((l) => l.results)
  const saved = searchId ? state.savedSearches.find((s) => s.id === searchId) : undefined
  const [filter, setFilter] = useState<BrowseFilter>({ ...presetFilter(10), notEmpty: true, limit: 500 })
  const [list, setList] = useState<BrowseServer[] | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [local, setLocal] = useState('')
  const [target, setTarget] = useState(() =>
    state.categories.find((c) => /other|otras/i.test(c.name))?.id ?? state.categories[0]?.id ?? '')
  const [sort, setSort] = useState<'players' | 'name' | 'map' | 'ping'>('players')
  const [keyInput, setKeyInput] = useState('')

  const run = async (f: BrowseFilter = filter) => {
    setBusy(true)
    setError('')
    const res = await browse(useDb.getState().settings.steamKey, f)
    setBusy(false)
    if (res.error) {
      setError(res.error.includes('rejected') ? t('br.err.key') : res.error.includes('unreachable') ? t('br.err.net') : res.error)
      setList(null)
    } else setList(res.servers ?? [])
  }

  useEffect(() => {
    if (saved && state.settings.steamKey) {
      setFilter({ ...saved.filter })
      run(saved.filter)
    }
  }, [searchId])

  const shown = useMemo(() => {
    if (!list) return []
    const q = local.trim().toLowerCase()
    const rows = q ? list.filter((s) => s.name.toLowerCase().includes(q) || s.map.toLowerCase().includes(q) || s.addr.includes(q)) : [...list]
    const players = (s: BrowseServer) => results.get(s.addr)?.info?.players ?? s.players
    switch (sort) {
      case 'players': rows.sort((a, b) => players(b) - players(a)); break
      case 'name': rows.sort((a, b) => a.name.localeCompare(b.name)); break
      case 'map': rows.sort((a, b) => a.map.localeCompare(b.map)); break
      case 'ping': rows.sort((a, b) => (results.get(a.addr)?.ping ?? 9999) - (results.get(b.addr)?.ping ?? 9999)); break
    }
    return rows
  }, [list, local, sort, results])

  const liveKey = shown.slice(0, LIVE_LIMIT).map((s) => s.addr).join(',')
  useEffect(() => {
    want('browse', liveKey ? liveKey.split(',') : [], Math.max(5, state.settings.interval))
  }, [liveKey, state.settings.interval])
  useEffect(() => () => want('browse', [], 5), [])

  if (!state.settings.steamKey) {
    return (
      <div className="browse">
        <div className="notice">
          <h2>{t('br.keyTitle')}</h2>
          <p>{t('br.keyBody')}</p>
          <form className="keyform" onSubmit={(e) => { e.preventDefault(); if (keyInput.trim()) setSettings({ steamKey: keyInput.trim() }) }}>
            <input className="field mono" placeholder={t('br.keyPh')} value={keyInput} onChange={(e) => setKeyInput(e.target.value)} aria-label={t('br.keyPh')} />
            <button className="btn primary">{t('br.saveKey')}</button>
          </form>
          <p className="faint">{t('br.noKeyHint')}</p>
        </div>
      </div>
    )
  }

  const set = (patch: Partial<BrowseFilter>) => setFilter((f) => ({ ...f, ...patch }))

  return (
    <div className="browse">
      <form className="filters" onSubmit={(e) => { e.preventDefault(); run() }}>
        <select className="field" value={filter.appid} aria-label={t('br.game')}
          onChange={(e) => set(presetFilter(Number(e.target.value)))}>
          {games.map((g) => <option key={g.appid} value={g.appid}>{g.name}</option>)}
        </select>
        <input className="field" placeholder={t('br.nameContains')} value={filter.name ?? ''} onChange={(e) => set({ name: e.target.value })} aria-label={t('br.nameContains')} />
        <input className="field map" placeholder={t('br.map')} value={filter.map ?? ''} onChange={(e) => set({ map: e.target.value })} aria-label={t('br.map')} />
        <label><input type="checkbox" checked={!!filter.notEmpty} onChange={(e) => set({ notEmpty: e.target.checked })} /> {t('br.hasPlayers')}</label>
        <label><input type="checkbox" checked={!!filter.notFull} onChange={(e) => set({ notFull: e.target.checked })} /> {t('br.notFull')}</label>
        <label><input type="checkbox" checked={!!filter.noPassword} onChange={(e) => set({ noPassword: e.target.checked })} /> {t('br.noPassword')}</label>
        <button className="btn primary" disabled={busy}>{busy ? t('br.searching') : t('br.search')}</button>
        {saved ? (
          <button className="btn ghost" type="button" onClick={() => {
            update((d) => { d.savedSearches = d.savedSearches.filter((s) => s.id !== searchId) })
            setView({ kind: 'browse' })
          }}>{t('br.forget', saved.name)}</button>
        ) : list && (
          <button className="btn ghost" type="button" onClick={() => {
            const name = prompt(t('br.nameSearch'), filter.name || games.find((g) => g.appid === filter.appid)?.short || 'Search')
            if (!name) return
            const id = uid()
            update((d) => { d.savedSearches.push({ id, name, filter: { ...filter } }) })
            setView({ kind: 'browse', search: id })
          }}>{t('br.saveSearch')}</button>
        )}
      </form>

      {error && <p className="err">{error}</p>}

      {list ? (
        <>
          <div className="bar">
            <span className="dim">{t('br.count', shown.length, list.length, list.length > LIVE_LIMIT ? LIVE_LIMIT : null)}</span>
            <input className="field" placeholder={t('br.filterResults')} value={local} onChange={(e) => setLocal(e.target.value)} aria-label={t('br.filterResults')} />
            <span className="spacer" />
            <label className="dim">{t('br.addTo')}
              <select className="field" value={target} onChange={(e) => setTarget(e.target.value)}>
                {state.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                <option value="">{t('uncategorized')}</option>
              </select>
            </label>
            <button className="btn" disabled={!shown.length} onClick={() => {
              const n = addServers(shown.map((s) => ({ addr: s.addr })), target || null)
              alert(t('br.added', n))
            }}>{t('br.addAll', shown.length)}</button>
          </div>
          <div className="table-wrap">
            <table className="browse-table">
              <thead><tr>
                <th><button onClick={() => setSort('name')}>{t('br.server')}</button></th>
                <th><button onClick={() => setSort('map')}>{t('col.map')}</button></th>
                <th className="num"><button onClick={() => setSort('players')}>{t('col.players')}</button></th>
                <th className="num"><button onClick={() => setSort('ping')}>{t('col.ping')}</button></th>
                <th>{t('br.region')}</th>
                <th />
              </tr></thead>
              <tbody>
                {shown.map((s) => {
                  const r = results.get(s.addr)
                  const mine = !!findServer(s.addr, state)
                  return (
                    <tr key={s.addr} className={selected === s.addr ? 'sel' : ''} onClick={() => onSelect(selected === s.addr ? null : s.addr)}
                      onContextMenu={(e) => openMenu(e, [s.addr])}>
                      <td className="name">
                        <span className={`dot ${!r ? 'wait' : r.online ? 'on' : 'off'}`} />
                        <span>{r?.info?.name ?? s.name}</span>
                        <span className="faint mono addr">{s.addr}</span>
                      </td>
                      <td>{r?.info?.map ?? s.map}</td>
                      <td className="num">{r?.info ? r.info.players - r.info.bots : s.players - s.bots}<span className="dim">/{s.max_players}</span></td>
                      <td className="num">{r?.online && <span className={pingClass(r.ping)}>{r.ping}</span>}</td>
                      <td className="dim">{regionName(s.region, t)}</td>
                      <td className="act">
                        {mine ? <span className="faint">{t('br.inList')}</span>
                          : <button className="btn small" onClick={(e) => { e.stopPropagation(); addServers([{ addr: s.addr }], target || null) }}>{t('br.add')}</button>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : !busy && (
        <p className="dim hint">{t('br.hint')}</p>
      )}
    </div>
  )
}
