import { useState } from 'react'
import { Dialog } from './Dialog'
import { setSettings, useDb, useStorageOk } from '../lib/store'
import { languages, useT } from '../lib/i18n'
import { downloadPack, uploadPack } from '../lib/transfer'
import type { ColumnKey } from '../lib/types'

const intervals = [1, 2, 3, 5, 10, 30, 60]
const columns: { key: ColumnKey; label: 'col.status' | 'col.password' | 'col.vac' | 'col.address' | 'col.map' | 'col.players' | 'col.ping' | 'col.game' | 'col.tags' | 'col.lastUpdate' }[] = [
  { key: 'status', label: 'col.status' },
  { key: 'lock', label: 'col.password' },
  { key: 'vac', label: 'col.vac' },
  { key: 'addr', label: 'col.address' },
  { key: 'map', label: 'col.map' },
  { key: 'players', label: 'col.players' },
  { key: 'ping', label: 'col.ping' },
  { key: 'game', label: 'col.game' },
  { key: 'tags', label: 'col.tags' },
  { key: 'updated', label: 'col.lastUpdate' },
]

export function Settings({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT()
  const settings = useDb((s) => s.settings)
  const storageOk = useStorageOk()
  const [replace, setReplace] = useState(false)
  const [message, setMessage] = useState('')
  const [showKey, setShowKey] = useState(false)

  const toggleColumn = (key: ColumnKey) =>
    setSettings({ columns: settings.columns.includes(key) ? settings.columns.filter((c) => c !== key) : [...settings.columns, key] })

  const upload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const msg = await uploadPack(file, replace)
    if (msg) setMessage(msg)
  }

  return (
    <Dialog title={t('st.title')} open={open} onClose={onClose} wide actions={<button className="btn primary" onClick={onClose}>{t('done')}</button>}>
      <div className="settings">
        <section>
          <h3>{t('st.language')}</h3>
          <select className="field" value={settings.lang} onChange={(e) => setSettings({ lang: e.target.value as typeof settings.lang })} aria-label={t('st.language')}>
            <option value="auto">{t('lang.auto')}</option>
            {languages.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </section>

        <section>
          <h3>{t('st.refresh')}</h3>
          <label className="line">
            {t('st.queryEvery')}
            <select className="field" value={settings.interval} onChange={(e) => setSettings({ interval: Number(e.target.value) })}>
              {intervals.map((s) => <option key={s} value={s}>{s < 60 ? t('st.seconds', s) : t('st.minutes', s / 60)}</option>)}
            </select>
          </label>
          <p className="faint">{t('st.refreshHelp')}</p>
        </section>

        <section className="span">
          <h3>{t('st.table')}</h3>
          <div className="line">
            <label><input type="radio" checked={settings.density === 'compact'} onChange={() => setSettings({ density: 'compact' })} /> {t('st.compact')}</label>
            <label><input type="radio" checked={settings.density === 'comfortable'} onChange={() => setSettings({ density: 'comfortable' })} /> {t('st.comfortable')}</label>
          </div>
          <div className="cols">
            {columns.map((c) => (
              <label key={c.key}><input type="checkbox" checked={settings.columns.includes(c.key)} onChange={() => toggleColumn(c.key)} /> {t(c.label)}</label>
            ))}
          </div>
        </section>

        <section className="span">
          <h3>{t('st.steam')}</h3>
          <p className="dim">{t('st.steamHelp')}</p>
          <div className="line">
            <input className="field mono key" type={showKey ? 'text' : 'password'} placeholder={t('br.keyPh')} value={settings.steamKey}
              onChange={(e) => setSettings({ steamKey: e.target.value.trim() })} aria-label={t('br.keyPh')} />
            <button className="btn ghost" onClick={() => setShowKey(!showKey)}>{showKey ? t('st.hide') : t('st.show')}</button>
          </div>
        </section>

        <section className="span">
          <h3>{t('st.data')}</h3>
          <p className="dim">{t('st.dataHelp')}</p>
          {!storageOk && <p className="warn">{t('st.saveFailed')}</p>}
          <div className="line">
            <button className="btn" onClick={() => setMessage(downloadPack())}>{t('st.export')}</button>
            <label className="btn">{t('st.import')}<input type="file" accept="application/json,.json" onChange={upload} hidden /></label>
            <label><input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} /> {t('st.replace')}</label>
          </div>
          {message && <p className="ok">{message}</p>}
        </section>
      </div>
    </Dialog>
  )
}
