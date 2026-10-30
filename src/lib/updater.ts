// Automatic updates from GitHub Releases: checked at startup and every few
// hours (YAQS tends to stay open on a second screen), installed without asking.
// Two channels: stable (tested releases) and beta (pre-releases first, then the
// stable version once it's out). A beta build follows the beta channel unless
// the user picks otherwise.
import { invoke } from '@tauri-apps/api/core'
import { getVersion } from '@tauri-apps/api/app'
import { toast } from './alerts'
import { t } from './i18n'
import { db } from './store'

export type Channel = 'stable' | 'beta'

const EVERY = 6 * 60 * 60 * 1000

let version = ''
getVersion().then((v) => (version = v)).catch(() => {})

/** The channel this copy follows: the setting, or beta when running a beta build. */
export function channelFor(setting: 'auto' | Channel, appVersion = version): Channel {
  if (setting !== 'auto') return setting
  return appVersion.includes('-') ? 'beta' : 'stable'
}

let busy = false

/** Checks the channel and installs a newer version. Resolves to the outcome. */
export async function updateNow(): Promise<'latest' | 'installing' | 'failed'> {
  if (busy) return 'installing'
  busy = true
  try {
    const channel = channelFor(db().settings.updateChannel)
    const next = await invoke<string | null>('update_check', { channel })
    if (!next) return 'latest'
    toast(t('up.installing', next), t('up.restart'))
    await invoke('update_install', { channel }) // exits and restarts YAQS
    return 'installing'
  } catch (e) {
    console.warn('update check failed', e) // offline or GitHub down: try again later
    return 'failed'
  } finally {
    busy = false
  }
}

export function startUpdater() {
  if (import.meta.env.DEV) return
  setTimeout(updateNow, 3000) // let the window settle first
  setInterval(updateNow, EVERY)
}
