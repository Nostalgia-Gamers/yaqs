// Turns a server's rules (cvars) into the facts HLSW showed in its info box.
import type { Rule } from './types'
import { t as tCurrent, type T } from './i18n'

const flagFiles = import.meta.glob('../../node_modules/flag-icons/flags/4x3/*.svg', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>

const flags = new Map<string, string>()
for (const [path, url] of Object.entries(flagFiles)) {
  const cc = path.match(/([a-z-]+)\.svg$/)?.[1]
  if (cc) flags.set(cc, url)
}

export function flagUrl(countryCode?: string): string | undefined {
  return countryCode ? flags.get(countryCode.toLowerCase()) : undefined
}

export interface Facts {
  nextMap?: string
  timeLeft?: string
  limits?: string
  friendlyFire?: string
  addons: string[]
  contact?: string
}

const first = (r: Map<string, string>, ...names: string[]) => {
  for (const n of names) {
    const v = r.get(n)?.trim()
    if (v) return v
  }
}

const addonCvars: [string, string][] = [
  ['amxmodx_version', 'AMX Mod X'],
  ['metamod_version', 'Metamod'],
  ['reapi_version', 'ReAPI'],
  ['reu_version', 'ReUnion'],
  ['revoice_version', 'ReVoice'],
  ['dp_version', 'DProto'],
  ['sm_version', 'SourceMod'],
  ['mm_version', 'Metamod:Source'],
]

export function facts(rules: Rule[] | null | undefined, t: T = tCurrent): Facts {
  const r = new Map((rules ?? []).map((x) => [x.name.toLowerCase(), x.value]))

  const limits: string[] = []
  const num = (name: string) => Number(r.get(name) ?? 0)
  if (num('mp_timelimit') > 0) limits.push(t('facts.min', num('mp_timelimit')))
  if (num('mp_maxrounds') > 0) limits.push(t('facts.rounds', num('mp_maxrounds')))
  if (num('mp_winlimit') > 0) limits.push(t('facts.wins', num('mp_winlimit')))
  if (num('mp_fraglimit') > 0) limits.push(t('facts.frags', num('mp_fraglimit')))

  const ff = r.get('mp_friendlyfire')

  return {
    nextMap: first(r, 'amx_nextmap', 'sm_nextmap', 'mp_nextmap', 'nextlevel', 'cm_nextmap'),
    timeLeft: first(r, 'amx_timeleft', 'mp_timeleft', 'sm_timeleft'),
    limits: rules?.length ? (limits.length ? limits.join(', ') : t('facts.none')) : undefined,
    friendlyFire: ff === undefined ? undefined : ff !== '0' ? t('facts.on') : t('facts.off'),
    addons: addonCvars.flatMap(([cvar, name]) => {
      const v = r.get(cvar)
      return v ? [`${name} ${v.split(/\s/)[0]}`] : []
    }),
    contact: first(r, 'sv_contact'),
  }
}
