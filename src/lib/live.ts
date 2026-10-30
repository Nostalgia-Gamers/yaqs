// Live data from the Rust side: which servers to watch (and how often), the
// latest result per server, and on-demand requests.
import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { BrowseFilter, BrowseServer, Result, Rule } from './types'

export interface Sample {
  ts: number
  players: number
  ping: number | null
}

/** A change worth flashing: up = players joined or server back (green),
 *  down = players left or server down (red), same = e.g. map change (blue). */
export interface Change {
  ts: number
  dir: 'up' | 'down' | 'same'
}

interface Live {
  results: Map<string, Result>
  changes: Map<string, Change>
  lastUpdate: number
  rejected: string[]
}

export const useLive = create<Live>()(() => ({
  results: new Map(),
  changes: new Map(),
  lastUpdate: 0,
  rejected: [],
}))

const HISTORY = 900 // samples per server kept for graphs (~30 min at 2 s)
export const history = new Map<string, Sample[]>()

type Listener = (prev: Result | undefined, next: Result) => void
const listeners = new Set<Listener>()
export function onUpdate(fn: Listener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function apply(batch: Result[]) {
  const { results, changes } = useLive.getState()
  const nextResults = new Map(results)
  const nextChanges = new Map(changes)
  const events: [Result | undefined, Result][] = []
  for (const r of batch) {
    const prev = results.get(r.addr)
    nextResults.set(r.addr, r)

    const h = history.get(r.addr) ?? []
    h.push({ ts: r.ts, players: r.online ? r.info?.players ?? 0 : 0, ping: r.online ? r.ping : null })
    if (h.length > HISTORY) h.splice(0, h.length - HISTORY)
    history.set(r.addr, h)

    if (prev && (prev.online !== r.online || prev.info?.players !== r.info?.players || prev.info?.map !== r.info?.map)) {
      const before = prev.online ? prev.info?.players ?? 0 : -1
      const after = r.online ? r.info?.players ?? 0 : -1
      nextChanges.set(r.addr, { ts: Date.now(), dir: after > before ? 'up' : after < before ? 'down' : 'same' })
    }
    events.push([prev, r])
  }
  useLive.setState({ results: nextResults, changes: nextChanges, lastUpdate: Date.now() })
  for (const [prev, r] of events) for (const fn of listeners) fn(prev, r)
}

export function startLive() {
  listen<Result[]>('updates', (e) => apply(e.payload))
}

// Each owner (e.g. 'saved', 'focus', 'browse') wants addresses at some
// interval; Rust watches the union, each at the fastest interval asked for.
const wanted = new Map<string, { addrs: string[]; interval: number }>()
let syncTimer: ReturnType<typeof setTimeout> | undefined

export function want(owner: string, addrs: string[], interval: number) {
  wanted.set(owner, { addrs, interval })
  clearTimeout(syncTimer)
  syncTimer = setTimeout(sync, 30)
}

async function sync() {
  const desired = new Map<string, number>()
  for (const { addrs, interval } of wanted.values()) {
    for (const a of addrs) desired.set(a, Math.min(desired.get(a) ?? Infinity, interval))
  }
  const items = [...desired].map(([addr, interval]) => ({ addr, interval }))
  const rejected = await invoke<string[]>('set_watch', { items })

  // Forget results for servers nobody watches any more.
  const { results } = useLive.getState()
  if ([...results.keys()].some((a) => !desired.has(a))) {
    const next = new Map([...results].filter(([a]) => desired.has(a)))
    useLive.setState({ results: next })
  }
  useLive.setState({ rejected })
}

export async function fetchRules(addr: string): Promise<{ rules?: Rule[]; error?: string }> {
  try {
    return { rules: await invoke<Rule[]>('rules', { addr }) }
  } catch (e) {
    return { error: String(e) }
  }
}

export async function browse(key: string, filter: BrowseFilter): Promise<{ servers?: BrowseServer[]; error?: string }> {
  try {
    return { servers: await invoke<BrowseServer[]>('browse', { key, filter }) }
  } catch (e) {
    return { error: String(e) }
  }
}

export interface Discovery {
  input: string
  host?: string
  scan: boolean
  servers: Result[]
  error?: string
}

export function discover(input: string) {
  return invoke<Discovery>('discover', { input })
}
