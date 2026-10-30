import type { Info, Result, SavedServer, Settings, SortKey, View } from './types'
import { shortGame } from './format'

export interface Row {
  s: SavedServer
  r?: Result
  name: string
}

/** Slots open to the public: max players minus reserved (admin/VIP) slots. */
export function publicSlots(info: Info, s?: SavedServer): number {
  return Math.max(0, info.maxPlayers - (s?.reserved ?? 0))
}

/** Full once every public slot is taken (bots count, they occupy slots). */
export function isFull(info: Info, s?: SavedServer): boolean {
  return info.players >= publicSlots(info, s)
}

export function inView(s: SavedServer, view: View): boolean {
  switch (view.kind) {
    case 'all': return true
    case 'favorites': return !!s.favorite
    case 'uncategorized': return !s.category
    case 'category': return s.category === view.id
    case 'tag': return s.tags.includes(view.name)
    default: return false
  }
}

export function rowName(s: SavedServer, r?: Result): string {
  return s.alias || r?.info?.name || s.host || s.addr
}

function matches(row: Row, q: string): boolean {
  const { s, r } = row
  const hay = [row.name, s.addr, s.host, s.notes, r?.info?.name, r?.info?.map, ...s.tags, ...(r?.players.map((p) => p.name) ?? [])]
  return hay.some((h) => h?.toLowerCase().includes(q))
}

const sorters: Record<SortKey, (a: Row, b: Row) => number> = {
  name: (a, b) => a.name.localeCompare(b.name),
  addr: (a, b) => compareAddr(a.s.addr, b.s.addr),
  map: (a, b) => (a.r?.info?.map ?? '').localeCompare(b.r?.info?.map ?? ''),
  players: (a, b) => players(a) - players(b),
  ping: (a, b) => ping(a) - ping(b),
  game: (a, b) => game(a).localeCompare(game(b)),
  updated: (a, b) => (a.r?.ts ?? 0) - (b.r?.ts ?? 0),
}

// compareAddr orders "ip:port" numerically: 10.0.0.2 before 10.0.0.10, then by port.
export function compareAddr(a: string, b: string): number {
  const split = (s: string) => {
    const i = s.lastIndexOf(':')
    const host = s.slice(0, i).replace(/^\[|\]$/g, '')
    const parts = host.includes('.') ? host.split('.').map(Number) : null
    return { host, parts, port: Number(s.slice(i + 1)) }
  }
  const x = split(a), y = split(b)
  if (x.parts && y.parts) {
    for (let i = 0; i < 4; i++) if (x.parts[i] !== y.parts[i]) return x.parts[i] - y.parts[i]
  } else if (x.host !== y.host) {
    return x.parts ? -1 : y.parts ? 1 : x.host.localeCompare(y.host) // IPv4 before IPv6
  }
  return x.port - y.port
}

const players = (x: Row) => (x.r?.online ? (x.r.info?.players ?? 0) : -1)
const ping = (x: Row) => (x.r?.online ? x.r.ping : 99999)
const game = (x: Row) => shortGame(x.r?.info?.appid, x.r?.info?.folder, x.r?.info?.game)

export function buildRows(
  servers: SavedServer[], results: Map<string, Result>, view: View, query: string, st: Settings,
): Row[] {
  const q = query.trim().toLowerCase()
  const rows: Row[] = []
  for (const s of servers) {
    if (!inView(s, view)) continue
    const r = results.get(s.addr)
    const row = { s, r, name: rowName(s, r) }
    if (q && !matches(row, q)) continue
    if (r && st.hideOffline && !r.online) continue
    if (r?.online && r.info) {
      const humans = r.info.players - r.info.bots
      if (st.hideEmpty && humans <= 0) continue
      if (st.hideFull && isFull(r.info, s)) continue
    }
    rows.push(row)
  }
  const cmp = sorters[st.sort.key] ?? sorters.players
  const dir = st.sort.dir
  // Favourites float to the top, then the chosen sort, then name for stability.
  return rows.sort((a, b) =>
    Number(!!b.s.favorite) - Number(!!a.s.favorite) || dir * cmp(a, b) || a.name.localeCompare(b.name))
}
