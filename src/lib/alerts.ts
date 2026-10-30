// Turns live updates into alerts: rule matches and buddies joining.
import { create } from 'zustand'
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification'
import { db, findServer } from './store'
import { onUpdate, useLive } from './live'
import { t } from './i18n'
import type { AlertRule, Result, State } from './types'

export interface Toast {
  id: number
  title: string
  body: string
  addr?: string
  ts: number
}

export const useAlerts = create<{ toasts: Toast[]; log: Toast[] }>()(() => ({ toasts: [], log: [] }))

let toastId = 1

export function displayName(addr: string, r?: Result): string {
  return findServer(addr)?.alias || r?.info?.name || addr
}

function inScope(rule: AlertRule, addr: string): boolean {
  if (rule.scope === 'all') return !!findServer(addr)
  if (rule.scope.startsWith('srv:')) return rule.scope.slice(4) === addr
  if (rule.scope.startsWith('cat:')) return findServer(addr)?.category === rule.scope.slice(4)
  return false
}

export function buddyMatch(name: string, buddies: string[] = db().buddies): string | undefined {
  const n = name.toLowerCase()
  return buddies.find((b) => b.trim() && n.includes(b.trim().toLowerCase()))
}

function check(prev: Result | undefined, next: Result) {
  if (!prev || !findServer(next.addr)) return // first sight is a baseline, not an event
  const name = displayName(next.addr, next)

  for (const rule of db().alerts) {
    if (!rule.enabled || !inScope(rule, next.addr)) continue
    switch (rule.kind) {
      case 'offline':
        if (prev.online && !next.online) fire(t('ev.down', name), t('ev.downBody', next.addr), next.addr)
        break
      case 'online':
        if (!prev.online && next.online) fire(t('ev.up', name), t('ev.upBody', next.info?.map ?? ''), next.addr)
        break
      case 'players': {
        const th = rule.threshold ?? 1
        const a = prev.info?.players ?? 0
        const b = next.info?.players ?? 0
        if (next.online && a < th && b >= th) fire(t('ev.players', name, b), t('ev.playersBody', th, next.info?.map ?? ''), next.addr)
        break
      }
      case 'map':
        if (prev.online && next.online && prev.info?.map && next.info?.map && prev.info.map !== next.info.map) {
          fire(t('ev.map', name), `${prev.info.map} → ${next.info.map}`, next.addr)
        }
        break
    }
  }

  if (db().buddies.length && next.online) {
    const before = new Set(prev.players.map((p) => p.name))
    for (const p of next.players) {
      if (!before.has(p.name) && buddyMatch(p.name)) fire(t('ev.joined', p.name), `${name} (${next.info?.map ?? ''})`, next.addr)
    }
  }
}

function fire(title: string, body: string, addr?: string) {
  const t: Toast = { id: toastId++, title, body, addr, ts: Date.now() }
  useAlerts.setState((s) => ({ toasts: [...s.toasts, t], log: [t, ...s.log].slice(0, 100) }))
  setTimeout(() => dismiss(t.id), 8000)

  const settings = db().settings
  if (settings.notify && !document.hasFocus()) sendNotification({ title, body })
  if (settings.sound) beep()
}

/** A plain in-app message (no sound, not logged as an alert). */
export function toast(title: string, body = '') {
  const t: Toast = { id: toastId++, title, body, ts: Date.now() }
  useAlerts.setState((s) => ({ toasts: [...s.toasts, t] }))
  setTimeout(() => dismiss(t.id), 5000)
}

export function dismiss(id: number) {
  useAlerts.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
}

export function clearLog() {
  useAlerts.setState({ log: [] })
}

let audio: AudioContext | undefined
function beep() {
  try {
    audio ??= new AudioContext()
    const o = audio.createOscillator()
    const g = audio.createGain()
    o.type = 'square'
    o.frequency.value = 880
    g.gain.setValueAtTime(0.06, audio.currentTime)
    g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.18)
    o.connect(g).connect(audio.destination)
    o.start()
    o.stop(audio.currentTime + 0.2)
  } catch { /* audio unavailable */ }
}

/** Sends a Windows notification right away, to check they show up. */
export async function testNotification() {
  if (await enableNotifications()) sendNotification({ title: t('al.testTitle'), body: t('al.testBody') })
}

export async function enableNotifications(): Promise<boolean> {
  if (await isPermissionGranted()) return true
  return (await requestPermission()) === 'granted'
}

/** Where each buddy is playing right now, across the saved servers. */
export function buddiesOnline(s: State, results: Map<string, Result>) {
  const out: { buddy: string; player: string; addr: string; score: number; duration: number }[] = []
  for (const [addr, r] of results) {
    if (!r.online || !s.servers.some((x) => x.addr === addr)) continue
    for (const p of r.players) {
      const b = buddyMatch(p.name, s.buddies)
      if (b) out.push({ buddy: b, player: p.name, addr, score: p.score, duration: p.duration })
    }
  }
  return out
}

export function startAlerts() {
  onUpdate(check)
}

// Re-exported so components don't need two imports for live results.
export { useLive }
