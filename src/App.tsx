import { useEffect, useMemo, useState } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { invoke } from '@tauri-apps/api/core'
import { Sidebar } from './components/Sidebar'
import { ServerTable } from './components/ServerTable'
import { Detail } from './components/Detail'
import { AddDialog } from './components/AddDialog'
import { Settings } from './components/Settings'
import { Browse } from './components/Browse'
import { Buddies } from './components/Buddies'
import { Alerts } from './components/Alerts'
import { Wall } from './components/Wall'
import { Toasts } from './components/Toasts'
import { BulkEdit } from './components/BulkEdit'
import { ContextMenu } from './components/ContextMenu'
import { OptionsMenu } from './components/OptionsMenu'
import { PlayersChart } from './components/PlayersChart'
import { setSettings, setView, update, useDb } from './lib/store'
import { useLive, want } from './lib/live'
import { useNow } from './lib/hooks'
import { ago } from './lib/format'
import { buildRows, inView } from './lib/rows'
import { useLang, useT } from './lib/i18n'
import { toast } from './lib/alerts'

const LIST_VIEWS = ['all', 'favorites', 'uncategorized', 'category', 'tag']

/** Seconds between player-list checks for buddies: a join can wait that long. */
const BUDDY_PLAYERS_EVERY = 10

export function App() {
  const t = useT()
  const lang = useLang()
  const state = useDb()
  const results = useLive((l) => l.results)
  const lastUpdate = useLive((l) => l.lastUpdate)
  const rejected = useLive((l) => l.rejected)
  const now = useNow()
  const [selected, setSelected] = useState<string | null>(null)
  const [checked, setChecked] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [navOpen, setNavOpen] = useState(false)
  const [editAddrs, setEditAddrs] = useState<string[] | null>(null)

  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])

  // Like HLSW: every saved server at the chosen interval, the selected one every second.
  const addrKey = state.servers.map((s) => s.addr).join(',')
  useEffect(() => {
    // Player lists: every poll while searching (it matches player names),
    // every 10 s when there are buddies to spot, otherwise not at all.
    const players = query.trim() ? 0 : state.buddies.length ? BUDDY_PLAYERS_EVERY : null
    want('saved', addrKey ? addrKey.split(',') : [], state.settings.interval, players)
  }, [addrKey, state.settings.interval, query, state.buddies.length])
  useEffect(() => {
    want('focus', selected ? [selected] : [], 1, 0)
  }, [selected])
  useEffect(() => {
    invoke('set_query_rate', { perSecond: state.settings.queryRate }).catch(() => {})
  }, [state.settings.queryRate])

  const listView = LIST_VIEWS.includes(state.view.kind)
  const rows = useMemo(
    () => (listView ? buildRows(state.servers, results, state.view, query, state.settings) : []),
    [listView, state.servers, results, state.view, query, state.settings],
  )

  // The chart totals every server in the view, whatever the search or filters hide.
  const viewAddrs = useMemo(
    () => (listView ? state.servers.filter((s) => inView(s, state.view)).map((s) => s.addr) : []),
    [listView, state.servers, state.view],
  )

  // Clear the multi-selection when the view changes.
  useEffect(() => setChecked([]), [state.view])

  // The window title shows live totals, like a tab on a second screen.
  const v = state.view
  const title =
    v.kind === 'all' ? t('view.all')
      : v.kind === 'favorites' ? t('view.favorites')
      : v.kind === 'uncategorized' ? t('uncategorized')
      : v.kind === 'category' ? state.categories.find((c) => c.id === v.id)?.name ?? t('view.category')
      : v.kind === 'tag' ? t('view.tag', v.name)
      : v.kind === 'browse' ? t('view.browse')
      : v.kind === 'buddies' ? t('view.buddies')
      : t('view.alerts')

  // The window title counts the servers of the view on screen (a category, a
  // tag, favorites…); views without a server list count every saved server.
  const totals = useMemo(() => {
    const addrs = listView ? viewAddrs : state.servers.map((s) => s.addr)
    let players = 0, down = 0
    for (const a of addrs) {
      const r = results.get(a)
      if (!r) continue
      if (r.online) players += (r.info?.players ?? 0) - (r.info?.bots ?? 0)
      else down++
    }
    return { players, down }
  }, [listView, viewAddrs, state.servers, results])
  const windowTitle = `${totals.down ? `⚠${totals.down} ` : ''}(${totals.players}) ${listView ? `${title} · ` : ''}YAQS`
  useEffect(() => {
    getCurrentWindow().setTitle(windowTitle).catch(() => {})
  }, [windowTitle])

  const st = state.settings
  const emptyText = query ? t('empty.query', query)
    : st.hideEmpty || st.hideOffline || st.hideFull ? t('empty.filtered')
    : t('empty.view')

  const toggle = (key: 'hideEmpty' | 'hideFull' | 'hideOffline', label: string) => (
    <label><input type="checkbox" checked={st[key]} onChange={(e) => setSettings({ [key]: e.target.checked })} /> {label}</label>
  )

  return (
    <>
      <div className={`app${selected ? ' with-detail' : ''}${navOpen ? ' nav-open' : ''}`}>
        <div className="side"><Sidebar onNavigate={() => setNavOpen(false)} /></div>
        {navOpen && <button className="scrim" aria-label={t('closeMenu')} onClick={() => setNavOpen(false)} />}

        <main>
          <div className="toolbar">
            <button className="btn ghost icon menu" aria-label={t('menu')} onClick={() => setNavOpen(!navOpen)}>☰</button>
            <h1>{title}</h1>
            {listView ? (
              <>
                <input className="field search" type="search" placeholder={t('search.placeholder')} value={query}
                  onChange={(e) => setQuery(e.target.value)} aria-label={t('search.aria')} />
                <div className="toggles">
                  {toggle('hideEmpty', t('filter.hideEmpty'))}
                  {toggle('hideFull', t('filter.hideFull'))}
                  {toggle('hideOffline', t('filter.hideOffline'))}
                </div>
                <span className="spacer" />
                <button className={`btn${state.wall ? ' primary' : ''}`} aria-pressed={state.wall}
                  onClick={() => update((d) => { d.wall = !d.wall })}>{t('wall')}</button>
              </>
            ) : <span className="spacer" />}
            <button className="btn primary" onClick={() => setAddOpen(true)}>{t('addServers')}</button>
            <OptionsMenu onSettings={() => setSettingsOpen(true)} onMessage={(m) => toast(m)} />
          </div>

          {v.kind === 'browse' ? <Browse searchId={v.search} selected={selected} onSelect={setSelected} />
            : v.kind === 'buddies' ? <Buddies selected={selected} onSelect={setSelected} />
            : v.kind === 'alerts' ? <Alerts onSelect={setSelected} />
            : !state.servers.length ? (
              <div className="welcome">
                <h2>{t('welcome.title')}</h2>
                <p>{t('welcome.body')}</p>
                <div className="row">
                  <button className="btn primary" onClick={() => setAddOpen(true)}>{t('addServers')}</button>
                  <button className="btn" onClick={() => setView({ kind: 'browse' })}>{t('welcome.browse')}</button>
                  <button className="btn ghost" onClick={() => setSettingsOpen(true)}>{t('welcome.import')}</button>
                </div>
              </div>
            )
            : (
              <>
                {state.wall ? <Wall rows={rows} selected={selected} onSelect={setSelected} />
                  : <ServerTable rows={rows} selected={selected} onSelect={setSelected} checked={checked} setChecked={setChecked} empty={emptyText} onEdit={setEditAddrs} />}
                <PlayersChart addrs={viewAddrs} />
              </>
            )}
        </main>

        {selected && <div className="detail-slot"><Detail addr={selected} onClose={() => setSelected(null)} /></div>}

        <footer className="status">
          <span className="conn"><span className={`dot ${state.servers.length ? 'on' : 'wait'}`} />{t('status.watching', state.servers.length)}</span>
          <span>{t('status.updated', ago(lastUpdate, now, t))}</span>
          <span>{t('status.refresh', st.interval)}</span>
          {rejected.length > 0 && <span className="warn" title={rejected.join('\n')}>{t('status.invalid', rejected.length)}</span>}
          <span className="spacer" />
          <span className="faint">{t('status.ping')}</span>
        </footer>
      </div>

      <AddDialog open={addOpen} onClose={() => setAddOpen(false)} category={v.kind === 'category' ? v.id : null} />
      <Settings open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <Toasts onPick={setSelected} />
      <BulkEdit open={!!editAddrs} onClose={() => setEditAddrs(null)} addrs={editAddrs ?? []} />
      <ContextMenu onShow={setSelected} onEdit={setEditAddrs} />
    </>
  )
}
