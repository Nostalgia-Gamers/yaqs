// Everything the user configures lives here and is saved to localStorage
// (kept by Tauri in the app's data folder).
import { create } from 'zustand'
import { produce } from 'immer'
import type {
  AlertRule, Category, SavedSearch, SavedServer, Settings, State, Tag, View,
} from './types'

const KEY = 'yaqs:v1'

export const swatches = [
  '#4db8ff', '#0088ff', '#7fa8c9', '#ffb000', '#5ec4c4', '#c9d6e0', '#8c9eff', '#ff8a80',
]

export function uid(): string {
  return Math.random().toString(36).slice(2, 10)
}

const defaultSettings: Settings = {
  interval: 2,
  density: 'compact',
  columns: ['status', 'lock', 'name', 'addr', 'map', 'players', 'ping', 'game', 'tags'],
  sort: { key: 'players', dir: -1 },
  hideEmpty: false,
  hideOffline: false,
  hideFull: false,
  notify: false,
  sound: false,
  steamKey: '',
  lang: 'auto',
  chartOpen: false,
  chartWindow: 3600,
  updateChannel: 'auto',
}

function defaults(): State {
  const mine = uid()
  // Store can't import i18n (it imports the store), so pick default names here.
  const es = navigator.language.toLowerCase().startsWith('es')
  return {
    version: 3,
    servers: [],
    categories: [
      { id: mine, name: es ? 'Mis servidores' : 'My servers', color: swatches[0] },
      { id: uid(), name: es ? 'Otras comunidades' : 'Other communities', color: swatches[2] },
    ],
    tags: [],
    buddies: [],
    alerts: [
      { id: uid(), kind: 'offline', scope: `cat:${mine}`, enabled: true },
      { id: uid(), kind: 'online', scope: `cat:${mine}`, enabled: true },
    ],
    savedSearches: [],
    settings: { ...defaultSettings },
    view: { kind: 'all' },
    wall: false,
  }
}

const arr = <T>(v: unknown, fallback: T[]): T[] => (Array.isArray(v) ? (v as T[]) : fallback)

// migrate fills in anything missing so older or hand-edited data still loads.
function migrate(raw: any): State {
  const d = defaults()
  if (!raw || typeof raw !== 'object') return d
  return {
    version: 3,
    servers: arr<SavedServer>(raw.servers, []).filter((s) => typeof s?.addr === 'string')
      .map((s) => ({ ...s, tags: arr<string>(s.tags, []), category: s.category ?? null })),
    categories: arr<Category>(raw.categories, d.categories),
    tags: arr<Tag>(raw.tags, []),
    buddies: arr<string>(raw.buddies, []),
    alerts: arr<AlertRule>(raw.alerts, d.alerts),
    savedSearches: arr<SavedSearch>(raw.savedSearches, []),
    settings: { ...defaultSettings, ...(raw.settings ?? {}) },
    view: raw.view?.kind ? raw.view : d.view,
    wall: !!raw.wall,
  }
}

function load(): State {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? migrate(JSON.parse(raw)) : defaults()
  } catch {
    return defaults()
  }
}

export const useDb = create<State>()(() => load())
export const useStorageOk = create<boolean>()(() => true)

/** Mutates the persisted state through an immer draft. */
export function update(fn: (d: State) => void) {
  useDb.setState(produce(useDb.getState(), fn), true)
}

export const db = () => useDb.getState()

let saveTimer: ReturnType<typeof setTimeout> | undefined
useDb.subscribe((s) => {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(s))
      useStorageOk.setState(true, true)
    } catch {
      useStorageOk.setState(false, true)
    }
  }, 300)
})

// Servers

export function findServer(addr: string, s: State = db()): SavedServer | undefined {
  return s.servers.find((x) => x.addr === addr)
}

export function addServers(
  entries: { addr: string; host?: string; alias?: string }[],
  category: string | null,
  tags: string[] = [],
): number {
  let added = 0
  update((d) => {
    for (const e of entries) {
      if (d.servers.some((s) => s.addr === e.addr)) continue
      d.servers.push({ addr: e.addr, host: e.host, alias: e.alias, category, tags: [...tags], addedAt: Date.now() })
      added++
    }
    for (const t of tags) ensureTagIn(d, t)
  })
  return added
}

export function removeServers(addrs: string[]) {
  const set = new Set(addrs)
  update((d) => {
    d.servers = d.servers.filter((s) => !set.has(s.addr))
    d.alerts = d.alerts.filter((a) => !(a.scope.startsWith('srv:') && set.has(a.scope.slice(4))))
  })
}

export function updateServer(addr: string, patch: Partial<SavedServer>) {
  update((d) => {
    const s = d.servers.find((x) => x.addr === addr)
    if (s) Object.assign(s, patch)
  })
}

/** Applies the same patch to several servers (bulk edit). */
export function updateServers(addrs: string[], patch: Partial<SavedServer>) {
  const set = new Set(addrs)
  update((d) => {
    for (const s of d.servers) if (set.has(s.addr)) Object.assign(s, patch)
  })
}

export function moveToCategory(addrs: string[], category: string | null) {
  update((d) => {
    for (const s of d.servers) if (addrs.includes(s.addr)) s.category = category
  })
}

export function setFavorite(addrs: string[], on?: boolean) {
  update((d) => {
    for (const s of d.servers) if (addrs.includes(s.addr)) s.favorite = on ?? !s.favorite
  })
}

// Tags

function ensureTagIn(d: State, name: string): Tag {
  let t = d.tags.find((x) => x.name.toLowerCase() === name.toLowerCase())
  if (!t) {
    t = { name, color: swatches[d.tags.length % swatches.length] }
    d.tags.push(t)
  }
  return t
}

/** Creates the tag if needed and returns its canonical name. */
export function ensureTag(name: string): string {
  let out = name
  update((d) => {
    out = ensureTagIn(d, name.trim()).name
  })
  return out
}

export function tagColor(name: string, s: State = db()): string {
  return s.tags.find((t) => t.name === name)?.color ?? swatches[5]
}

export function addTag(addrs: string[], name: string) {
  update((d) => {
    const tag = ensureTagIn(d, name.trim())
    for (const s of d.servers) if (addrs.includes(s.addr) && !s.tags.includes(tag.name)) s.tags.push(tag.name)
  })
}

export function removeTag(addrs: string[], name: string) {
  update((d) => {
    for (const s of d.servers) if (addrs.includes(s.addr)) s.tags = s.tags.filter((t) => t !== name)
  })
}

export function deleteTag(name: string) {
  update((d) => {
    d.tags = d.tags.filter((t) => t.name !== name)
    for (const s of d.servers) s.tags = s.tags.filter((t) => t !== name)
    if (d.view.kind === 'tag' && d.view.name === name) d.view = { kind: 'all' }
  })
}

// Categories

export function createCategory(name: string): string {
  const id = uid()
  update((d) => {
    d.categories.push({ id, name, color: swatches[d.categories.length % swatches.length] })
  })
  return id
}

export function deleteCategory(id: string) {
  update((d) => {
    d.categories = d.categories.filter((c) => c.id !== id)
    for (const s of d.servers) if (s.category === id) s.category = null
    d.alerts = d.alerts.filter((a) => a.scope !== `cat:${id}`)
    if (d.view.kind === 'category' && d.view.id === id) d.view = { kind: 'all' }
  })
}

export function moveCategory(id: string, delta: -1 | 1) {
  update((d) => {
    const i = d.categories.findIndex((c) => c.id === id)
    const j = i + delta
    if (i < 0 || j < 0 || j >= d.categories.length) return
    const [c] = d.categories.splice(i, 1)
    d.categories.splice(j, 0, c)
  })
}

export function setView(v: View) {
  update((d) => {
    d.view = v
  })
}

export function setSettings(patch: Partial<Settings>) {
  update((d) => {
    Object.assign(d.settings, patch)
  })
}

// Import / export (same format as the web version, so packs move between them)

export interface Pack {
  yaqs: 1
  servers: SavedServer[]
  categories: Category[]
  tags: Tag[]
  buddies?: string[]
  alerts?: AlertRule[]
  savedSearches?: SavedSearch[]
}

export function exportPack(): Pack {
  const s = db()
  return {
    yaqs: 1,
    servers: s.servers,
    categories: s.categories,
    tags: s.tags,
    buddies: s.buddies,
    alerts: s.alerts,
    savedSearches: s.savedSearches,
  }
}

// importPack merges a pack: categories match by name, servers already saved
// keep their settings. Returns how many servers were added.
export function importPack(text: string, replace: boolean): number {
  const pack = JSON.parse(text) as Partial<Pack>
  if (!pack || !Array.isArray(pack.servers)) throw new Error('not-a-yaqs-export')
  if (replace) {
    const fresh = migrate({ ...pack, settings: db().settings, view: { kind: 'all' } })
    useDb.setState(fresh, true)
    return fresh.servers.length
  }
  let added = 0
  update((d) => {
    const catMap = new Map<string, string>()
    for (const c of arr<Category>(pack.categories, [])) {
      const existing = d.categories.find((x) => x.name.toLowerCase() === c.name?.toLowerCase())
      if (existing) catMap.set(c.id, existing.id)
      else {
        const id = c.id && !d.categories.some((x) => x.id === c.id) ? c.id : uid()
        d.categories.push({ ...c, id })
        catMap.set(c.id, id)
      }
    }
    for (const t of arr<Tag>(pack.tags, [])) if (t?.name) ensureTagIn(d, t.name).color = t.color ?? swatches[0]
    for (const s of pack.servers!) {
      if (typeof s?.addr !== 'string' || d.servers.some((x) => x.addr === s.addr)) continue
      d.servers.push({ ...s, tags: arr<string>(s.tags, []), category: s.category ? catMap.get(s.category) ?? null : null })
      added++
    }
    for (const b of arr<string>(pack.buddies, [])) if (!d.buddies.includes(b)) d.buddies.push(b)
    for (const q of arr<SavedSearch>(pack.savedSearches, [])) if (!d.savedSearches.some((x) => x.name === q.name)) d.savedSearches.push(q)
  })
  return added
}
