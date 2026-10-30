import type { BrowseFilter } from './types'
import { t as tCurrent, type T } from './i18n'

export interface GamePreset {
  appid: number
  name: string
  short: string
  gamedir?: string
}

// Browse presets. GoldSrc mods share appid 10 on the master list, so they
// also filter by game directory.
export const games: GamePreset[] = [
  { appid: 10, name: 'Counter-Strike 1.6', short: 'CS 1.6', gamedir: 'cstrike' },
  { appid: 80, name: 'Condition Zero', short: 'CZ', gamedir: 'czero' },
  { appid: 30, name: 'Day of Defeat', short: 'DoD', gamedir: 'dod' },
  { appid: 20, name: 'Team Fortress Classic', short: 'TFC', gamedir: 'tfc' },
  { appid: 70, name: 'Half-Life', short: 'HL', gamedir: 'valve' },
  { appid: 240, name: 'Counter-Strike: Source', short: 'CS:S' },
  { appid: 730, name: 'Counter-Strike 2', short: 'CS2' },
  { appid: 440, name: 'Team Fortress 2', short: 'TF2' },
  { appid: 4000, name: "Garry's Mod", short: 'GMod' },
  { appid: 550, name: 'Left 4 Dead 2', short: 'L4D2' },
  { appid: 252490, name: 'Rust', short: 'Rust' },
]

const byFolder: Record<string, string> = {
  cstrike: 'CS 1.6', czero: 'CZ', dod: 'DoD', tfc: 'TFC', valve: 'HL', gearbox: 'Op4',
  ricochet: 'Ricochet', dmc: 'DMC', ns: 'NS', ts: 'TS', svencoop: 'Sven',
}

export function shortGame(appid?: number, folder?: string, game?: string): string {
  if (appid && appid < 200 && folder && byFolder[folder]) return byFolder[folder]
  const g = games.find((x) => x.appid === appid)
  if (g) return g.short
  if (folder && byFolder[folder]) return byFolder[folder]
  return game || folder || '—'
}

export function presetFilter(appid: number): BrowseFilter {
  const g = games.find((x) => x.appid === appid)
  return { appid, gamedir: g?.gamedir }
}

export function duration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h) return `${h}h ${String(m).padStart(2, '0')}m`
  if (m) return `${m}m ${String(s % 60).padStart(2, '0')}s`
  return `${s}s`
}

export function ago(ts: number | undefined, now = Date.now(), t: T = tCurrent): string {
  if (!ts) return t('ago.never')
  const s = Math.round((now - ts) / 1000)
  if (s < 5) return t('ago.now')
  if (s < 60) return t('ago.s', s)
  if (s < 3600) return t('ago.m', Math.floor(s / 60))
  if (s < 86400) return t('ago.h', Math.floor(s / 3600))
  return t('ago.d', Math.floor(s / 86400))
}

export function pingClass(ping: number): string {
  if (ping < 60) return 'good'
  if (ping < 140) return 'fair'
  return 'poor'
}

const regionKeys = {
  0: 'region.0', 1: 'region.1', 2: 'region.2', 3: 'region.3', 4: 'region.4', 5: 'region.5',
  6: 'region.6', 7: 'region.7', 255: 'region.255',
} as const

export function regionName(id: number, t: T = tCurrent): string {
  const key = regionKeys[id as keyof typeof regionKeys]
  return key ? t(key) : ''
}
