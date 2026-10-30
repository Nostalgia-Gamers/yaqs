import { useEffect, useState } from 'react'
import { Dialog } from './Dialog'
import { addServers, ensureTag, findServer, useDb } from '../lib/store'
import { discover } from '../lib/live'
import { shortGame } from '../lib/format'
import type { Result } from '../lib/types'
import { t as tNow, useT } from '../lib/i18n'

interface Found {
  r: Result
  pick: boolean
  exists: boolean
}
interface Group {
  input: string
  host?: string
  scan: boolean
  error?: string
  found: Found[]
}

function explain(err: string): string {
  if (err.includes('not allowed')) return tNow('add.err.notAllowed')
  if (err.includes('not found')) return tNow('add.err.notFound')
  if (err.includes('invalid')) return tNow('add.err.invalid')
  return err
}

export function AddDialog({ open, onClose, category }: { open: boolean; onClose: () => void; category: string | null }) {
  const t = useT()
  const categories = useDb((s) => s.categories)
  const [text, setText] = useState('')
  const [cat, setCat] = useState('')
  const [tags, setTags] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [groups, setGroups] = useState<Group[] | null>(null)

  useEffect(() => {
    if (open) {
      setCat(category ?? categories[0]?.id ?? '')
      setGroups(null)
    }
  }, [open])

  const lines = () => [...new Set(text.split(/[\n;]+|\s{2,}/).map((l) => l.trim()).filter(Boolean))]

  const find = async (e: React.FormEvent) => {
    e.preventDefault()
    const inputs = lines()
    if (!inputs.length) return
    setBusy(true)
    setProgress(0)
    const out: Group[] = new Array(inputs.length)
    // A few at a time: each IP-only line scans dozens of ports.
    let next = 0
    const worker = async () => {
      while (next < inputs.length) {
        const i = next++
        const res = await discover(inputs[i])
        out[i] = {
          input: inputs[i],
          host: res.host,
          scan: res.scan,
          error: res.error ? explain(res.error) : undefined,
          found: res.servers.map((r) => ({ r, exists: !!findServer(r.addr), pick: !findServer(r.addr) })),
        }
        setProgress((p) => p + 1)
      }
    }
    await Promise.all([worker(), worker(), worker()])
    setGroups(out)
    setBusy(false)
  }

  const picked = groups ? groups.flatMap((g) => g.found.filter((f) => f.pick).map((f) => ({ addr: f.r.addr, host: g.host }))) : []

  const togglePick = (gi: number, fi: number) =>
    setGroups((gs) => gs!.map((g, i) => i !== gi ? g : { ...g, found: g.found.map((f, j) => j !== fi ? f : { ...f, pick: !f.pick }) }))

  const add = () => {
    const tagList = tags.split(',').map((x) => x.trim()).filter(Boolean).map((x) => ensureTag(x))
    addServers(picked, cat || null, tagList)
    setText('')
    setTags('')
    setGroups(null)
    onClose()
  }

  return (
    <Dialog title={t('add.title')} open={open} onClose={onClose} wide actions={!groups ? (
      <>
        <button className="btn" type="button" onClick={onClose}>{t('cancel')}</button>
        <button className="btn primary" type="submit" form="add-form" disabled={busy}>
          {busy ? t('add.looking', progress, lines().length) : t('add.find')}
        </button>
      </>
    ) : (
      <>
        <button className="btn" type="button" onClick={() => setGroups(null)}>{t('back')}</button>
        <button className="btn primary" type="button" onClick={add} disabled={!picked.length}>
          {t('add.addN', picked.length)}
        </button>
      </>
    )}>
      <div className="add">
        {!groups ? (
          <form id="add-form" onSubmit={find}>
            <label>
              <span>{t('add.addresses')}</span>
              <textarea className="field" rows={6} value={text} onChange={(e) => setText(e.target.value)} required disabled={busy}
                placeholder={t('add.placeholder')} />
            </label>
            <p className="hint faint">{t('add.hint')}</p>
          </form>
        ) : (
          <div className="review">
            {groups.map((g, gi) => (
              <section key={g.input}>
                <h3>
                  <span className="mono">{g.input}</span>
                  {g.scan && !g.error && <span className="faint">{t('add.found', g.found.length)}</span>}
                </h3>
                {g.error ? <p className="err">{g.error}</p>
                  : !g.found.length ? <p className="err">{t('add.noneFound', g.input)}</p>
                  : (
                    <ul>
                      {g.found.map((f, fi) => (
                        <li key={f.r.addr} className={f.r.online ? '' : 'off'}>
                          <label>
                            <input type="checkbox" checked={f.pick} disabled={f.exists} onChange={() => togglePick(gi, fi)} />
                            <span className="name">{f.r.info?.name ?? t('add.noReply')}</span>
                          </label>
                          <span className="meta">
                            {f.r.online && f.r.info ? (
                              <>
                                <span className="dim">{f.r.info.map}</span>
                                <span>{f.r.info.players - f.r.info.bots}/{f.r.info.maxPlayers}</span>
                                <span className="dim">{shortGame(f.r.info.appid, f.r.info.folder, f.r.info.game)}</span>
                              </>
                            ) : <span className="faint">{t('add.keepChecking')}</span>}
                            <span className="mono faint">:{f.r.addr.split(':').pop()}</span>
                            {f.exists && <span className="faint">{t('add.inList')}</span>}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
              </section>
            ))}
          </div>
        )}

        <div className="row">
          <label>
            <span>{t('add.category')}</span>
            <select className="field" value={cat} onChange={(e) => setCat(e.target.value)}>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              <option value="">{t('uncategorized')}</option>
            </select>
          </label>
          <label>
            <span>{t('add.tags')}</span>
            <input className="field" value={tags} onChange={(e) => setTags(e.target.value)} placeholder={t('add.tagsPh')} />
          </label>
        </div>
      </div>
    </Dialog>
  )
}
