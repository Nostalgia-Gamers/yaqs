import { setSettings, uid, update, useDb } from '../lib/store'
import { clearLog, enableNotifications, testNotification, useAlerts } from '../lib/alerts'
import { useLive } from '../lib/live'
import { useNow } from '../lib/hooks'
import { ago } from '../lib/format'
import { rowName } from '../lib/rows'
import type { AlertKind } from '../lib/types'
import { useT } from '../lib/i18n'

const kinds: AlertKind[] = ['offline', 'online', 'players', 'map']

export function Alerts({ onSelect }: { onSelect: (addr: string) => void }) {
  const t = useT()
  const state = useDb()
  const results = useLive((l) => l.results)
  const log = useAlerts((a) => a.log)
  const now = useNow()

  return (
    <div className="page">
      <section>
        <h2>{t('al.title')}</h2>
        <p className="dim">{t('al.intro')}</p>
        <div className="opts">
          <label>
            <input type="checkbox" checked={state.settings.notify} onChange={async (e) => {
              const on = e.target.checked
              setSettings({ notify: on ? await enableNotifications() : false })
            }} /> {t('al.notify')}
          </label>
          <label>
            <input type="checkbox" checked={state.settings.sound} onChange={(e) => setSettings({ sound: e.target.checked })} /> {t('al.sound')}
          </label>
          <button className="btn" onClick={() => testNotification()}>{t('al.test')}</button>
        </div>
        <p className="faint hint">{t('al.testHint')}</p>
      </section>

      <section>
        <h3>{t('al.rules')}</h3>
        <div className="rules">
          {state.alerts.map((a, i) => (
            <div key={a.id} className={`rule${a.enabled ? '' : ' off'}`}>
              <input type="checkbox" checked={a.enabled} aria-label={t('al.enabled')} onChange={(e) => update((d) => { d.alerts[i].enabled = e.target.checked })} />
              <span className="dim">{t('al.when')}</span>
              <select className="field" value={a.scope} aria-label={t('al.which')} onChange={(e) => update((d) => { d.alerts[i].scope = e.target.value })}>
                <option value="all">{t('al.anyServer')}</option>
                <optgroup label={t('al.groupCategory')}>
                  {state.categories.map((c) => <option key={c.id} value={`cat:${c.id}`}>{c.name}</option>)}
                </optgroup>
                <optgroup label={t('al.groupServer')}>
                  {state.servers.map((s) => <option key={s.addr} value={`srv:${s.addr}`}>{rowName(s, results.get(s.addr))}</option>)}
                </optgroup>
              </select>
              <select className="field" value={a.kind} aria-label={t('al.event')} onChange={(e) => update((d) => { d.alerts[i].kind = e.target.value as AlertKind })}>
                {kinds.map((k) => <option key={k} value={k}>{t(`al.kind.${k}`)}</option>)}
              </select>
              {a.kind === 'players' && (
                <input className="field n" type="number" min={1} max={128} value={a.threshold ?? 10} aria-label={t('al.playerCount')}
                  onChange={(e) => update((d) => { d.alerts[i].threshold = Number(e.target.value) })} />
              )}
              <button className="btn ghost small" onClick={() => update((d) => { d.alerts.splice(i, 1) })}>{t('delete')}</button>
            </div>
          ))}
        </div>
        <button className="btn" onClick={() => update((d) => { d.alerts.push({ id: uid(), kind: 'offline', scope: 'all', enabled: true, threshold: 10 }) })}>{t('al.addRule')}</button>
      </section>

      <section>
        <h3>{t('al.recent')}</h3>
        {log.length ? (
          <>
            <ul className="log">
              {log.map((x) => (
                <li key={x.id}>
                  <button className="entry" onClick={() => x.addr && onSelect(x.addr)}>
                    <span className="when faint">{ago(x.ts, now, t)}</span>
                    <strong>{x.title}</strong>
                    <span className="dim">{x.body}</span>
                  </button>
                </li>
              ))}
            </ul>
            <button className="btn ghost" onClick={clearLog}>{t('al.clear')}</button>
          </>
        ) : <p className="dim">{t('al.nothing')}</p>}
      </section>
    </div>
  )
}
