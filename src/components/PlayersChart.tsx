import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { setSettings, useDb } from '../lib/store'
import { useLive } from '../lib/live'
import { useLang, useT } from '../lib/i18n'

/** Windows offered by the chart, in seconds. */
const WINDOWS = [600, 1800, 3600, 4 * 3600, 12 * 3600, 24 * 3600, 3 * 24 * 3600] as const
const BARS = 60
const HEIGHT = 112
const PAD = { left: 34, right: 4, top: 8, bottom: 20 }

interface Chart {
  start: number
  bucket: number
  values: (number | null)[]
}

function niceMax(v: number): number {
  if (v <= 4) return 4
  const step = 10 ** Math.floor(Math.log10(v))
  for (const m of [1, 2, 2.5, 5, 10]) if (m * step >= v) return m * step
  return 10 * step
}

/** Total players of the servers in the current view, as a histogram over time. */
export function PlayersChart({ addrs }: { addrs: string[] }) {
  const t = useT()
  const lang = useLang()
  const open = useDb((s) => s.settings.chartOpen)
  const win = useDb((s) => s.settings.chartWindow)
  const results = useLive((l) => l.results)
  const [chart, setChart] = useState<Chart | null>(null)
  const [hover, setHover] = useState<number | null>(null)
  const [width, setWidth] = useState(600)
  const box = useRef<HTMLDivElement>(null)
  const key = addrs.join(',')

  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(200, Math.floor(e.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [open])

  // Refresh about once per bar, between every 5 s and every minute.
  useEffect(() => {
    if (!open) return
    let alive = true
    const load = () =>
      invoke<Chart>('players_history', { addrs: key ? key.split(',') : [], window: win, bars: BARS })
        .then((c) => alive && setChart(c))
        .catch(() => {})
    load()
    const every = Math.min(60, Math.max(5, win / BARS)) * 1000
    const timer = setInterval(load, every)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [key, win, open])

  // "Now" is the live total (same as the sidebar), not the last bar's average.
  const liveNow = useMemo(() => {
    let total = 0, seen = false
    for (const a of addrs) {
      const r = results.get(a)
      if (!r) continue
      seen = true
      if (r.online && r.info) total += r.info.players - r.info.bots
    }
    return seen ? total : null
  }, [addrs, results])

  const stats = useMemo(() => {
    const vals = (chart?.values ?? []).filter((v): v is number => v !== null)
    if (!vals.length) return null
    return {
      now: liveNow ?? Math.round(vals[vals.length - 1]),
      peak: Math.round(Math.max(...vals)),
      avg: Math.round(vals.reduce((a, b) => a + b, 0) / vals.length),
      max: niceMax(Math.max(...vals)),
    }
  }, [chart, liveNow])

  const winLabel = (s: number) =>
    s < 3600 ? t('ch.minutes', s / 60) : s < 86400 ? t('ch.hours', s / 3600) : t('ch.days', s / 86400)

  const fmt = useMemo(() => {
    const time = new Intl.DateTimeFormat(lang, { hour: '2-digit', minute: '2-digit' })
    const day = new Intl.DateTimeFormat(lang, { weekday: 'short', hour: '2-digit', minute: '2-digit' })
    return (ms: number) => (win > 24 * 3600 ? day : time).format(ms)
  }, [lang, win])

  const plotW = width - PAD.left - PAD.right
  const plotH = HEIGHT - PAD.top - PAD.bottom
  const n = chart?.values.length ?? BARS
  const gap = plotW / n > 5 ? 2 : 1
  const barW = Math.max(1, (plotW - gap * (n - 1)) / n)
  const y = (v: number) => PAD.top + plotH - (v / (stats?.max ?? 4)) * plotH
  const x = (i: number) => PAD.left + i * (barW + gap)

  const ticks = stats ? [0, stats.max / 2, stats.max] : [0]
  const xTicks = [0, Math.round(n / 3), Math.round((2 * n) / 3)]

  const hv = hover !== null && chart ? chart.values[hover] : undefined
  const hoverFrom = hover !== null && chart ? chart.start + hover * chart.bucket : 0

  return (
    <section className={`pchart${open ? '' : ' closed'}`} aria-label={t('ch.title')}>
      <div className="pc-head">
        <button className="pc-toggle" aria-expanded={open} onClick={() => setSettings({ chartOpen: !open })}>
          <span className="chev">{open ? '▾' : '▸'}</span> {t('ch.title')}
        </button>
        {open && stats && (
          <dl className="pc-stats">
            <div><dt>{t('ch.now')}</dt><dd>{stats.now}</dd></div>
            <div><dt>{t('ch.peak')}</dt><dd>{stats.peak}</dd></div>
            <div><dt>{t('ch.avg')}</dt><dd>{stats.avg}</dd></div>
          </dl>
        )}
        <span className="spacer" />
        {open && (
          <div className="pc-windows" role="radiogroup" aria-label={t('ch.window')}>
            {WINDOWS.map((s) => (
              <button key={s} role="radio" aria-checked={win === s} className={win === s ? 'on' : ''}
                onClick={() => setSettings({ chartWindow: s })}>{winLabel(s)}</button>
            ))}
          </div>
        )}
      </div>

      {open && (
        <div className="pc-plot" ref={box} onMouseLeave={() => setHover(null)}>
          <svg width={width} height={HEIGHT} role="img"
            aria-label={stats ? t('ch.summary', winLabel(win), stats.now, stats.peak, stats.avg) : t('ch.noData')}>
            {ticks.map((v) => (
              <g key={v}>
                <line x1={PAD.left} x2={width - PAD.right} y1={y(v)} y2={y(v)} className={v === 0 ? 'base' : 'grid'} />
                <text x={PAD.left - 6} y={y(v) + 4} textAnchor="end" className="ytick">{Math.round(v)}</text>
              </g>
            ))}
            {chart?.values.map((v, i) => {
              if (v === null || v <= 0) return null
              const h = Math.max(1, (v / (stats?.max ?? 4)) * plotH)
              const top = PAD.top + plotH - h
              const r = Math.min(2, barW / 2, h)
              const x0 = x(i), x1 = x0 + barW, base = PAD.top + plotH
              return (
                <path key={i} className={hover === i ? 'bar hot' : 'bar'}
                  d={`M${x0},${base}V${top + r}Q${x0},${top} ${x0 + r},${top}H${x1 - r}Q${x1},${top} ${x1},${top + r}V${base}Z`} />
              )
            })}
            {chart && xTicks.map((i) => (
              <text key={i} x={x(i)} y={HEIGHT - 5} className="xtick">{fmt(chart.start + i * chart.bucket)}</text>
            ))}
            <text x={width - PAD.right} y={HEIGHT - 5} textAnchor="end" className="xtick">{t('ch.nowLabel')}</text>
            {/* Hit targets: full-height columns, wider than the bars. */}
            {chart?.values.map((_, i) => (
              <rect key={`h${i}`} x={x(i) - gap / 2} y={PAD.top} width={barW + gap} height={plotH}
                className="hit" onMouseEnter={() => setHover(i)} />
            ))}
          </svg>
          {!stats && <p className="pc-empty">{t('ch.noData')}</p>}
          {hover !== null && chart && (
            <div className={`pc-tip ${x(hover) > width / 2 ? 'left' : 'right'}`}
              style={{ left: x(hover) > width / 2 ? x(hover) - 6 : x(hover) + barW + 6 }}>
              <span className="when">{fmt(hoverFrom)}–{fmt(hoverFrom + chart.bucket)}</span>
              <strong>{hv === null || hv === undefined ? t('ch.gap') : t('ch.players', Math.round(hv))}</strong>
              {hv !== null && hv !== undefined && <span className="note">{t('ch.avgNote')}</span>}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
