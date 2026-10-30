// Wire types: mirror src-tauri (a2s.rs, poller.rs, master.rs, discover.rs).

export interface Info {
  protocol: number
  name: string
  map: string
  folder: string
  game: string
  appid: number
  players: number
  maxPlayers: number
  bots: number
  serverType: string
  environment: string
  password: boolean
  vac: boolean
  version?: string
  gamePort?: number
  steamId?: string
  keywords?: string
  gameId?: string
  tvPort?: number
  tvName?: string
  engine: 'goldsrc' | 'source'
}

export interface Player {
  name: string
  score: number
  duration: number
}

export interface Rule {
  name: string
  value: string
}

export interface Geo {
  country?: string
  countryCode?: string
  isp?: string
  org?: string
  as?: string
}

export interface Result {
  addr: string
  online: boolean
  ping: number
  info?: Info
  geo?: Geo
  players: Player[]
  error?: string
  ts: number
  lastSeen?: number
}

export interface BrowseFilter {
  appid: number
  name?: string
  map?: string
  gamedir?: string
  notEmpty?: boolean
  notFull?: boolean
  noPassword?: boolean
  limit?: number
}

export interface BrowseServer {
  addr: string
  gameport: number
  steamid: string
  name: string
  appid: number
  gamedir: string
  version: string
  product: string
  region: number
  players: number
  max_players: number
  bots: number
  map: string
  secure: boolean
  dedicated: boolean
  os: string
}

// Persisted state (localStorage).

export interface SavedServer {
  addr: string
  host?: string // hostname the user typed, if any
  alias?: string
  category: string | null
  tags: string[]
  notes?: string
  favorite?: boolean
  reserved?: number // slots kept for admins/VIPs; the server is full when the rest are taken
  addedAt: number
}

export interface Category {
  id: string
  name: string
  color: string
}

export interface Tag {
  name: string
  color: string
}

export type AlertKind = 'offline' | 'online' | 'players' | 'map'

export interface AlertRule {
  id: string
  kind: AlertKind
  scope: string // 'all' | 'cat:<id>' | 'srv:<addr>'
  threshold?: number
  enabled: boolean
}

export interface SavedSearch {
  id: string
  name: string
  filter: BrowseFilter
}

export type ColumnKey =
  | 'status' | 'lock' | 'vac' | 'name' | 'addr' | 'map' | 'players' | 'ping' | 'game' | 'tags' | 'updated'

export type SortKey = 'name' | 'addr' | 'map' | 'players' | 'ping' | 'game' | 'updated'

export interface Settings {
  interval: number
  density: 'compact' | 'comfortable'
  columns: ColumnKey[]
  sort: { key: SortKey; dir: 1 | -1 }
  hideEmpty: boolean
  hideOffline: boolean
  hideFull: boolean
  notify: boolean
  sound: boolean
  steamKey: string
  lang: 'auto' | 'es-AR' | 'en'
  chartOpen: boolean
  chartWindow: number // seconds
  updateChannel: 'auto' | 'stable' | 'beta'
}

export type View =
  | { kind: 'all' }
  | { kind: 'favorites' }
  | { kind: 'uncategorized' }
  | { kind: 'category'; id: string }
  | { kind: 'tag'; name: string }
  | { kind: 'browse'; search?: string }
  | { kind: 'buddies' }
  | { kind: 'alerts' }

export interface State {
  version: 3
  servers: SavedServer[]
  categories: Category[]
  tags: Tag[]
  buddies: string[]
  alerts: AlertRule[]
  savedSearches: SavedSearch[]
  settings: Settings
  view: View
  wall: boolean
}
