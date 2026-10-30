// Export/import of the server list as a JSON pack (shared by Settings and the
// Options menu).
import { exportPack, importPack } from './store'
import { t } from './i18n'

/** Saves the list to the Downloads folder; returns a message for the user. */
export function downloadPack(): string {
  const blob = new Blob([JSON.stringify(exportPack(), null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `yaqs-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(a.href)
  return t('st.exported')
}

/** Imports a pack file; returns a message for the user (success or error). */
export async function uploadPack(file: File, replace: boolean): Promise<string | null> {
  try {
    if (replace && !confirm(t('st.confirmReplace'))) return null
    const n = importPack(await file.text(), replace)
    return replace ? t('st.loaded', n) : t('st.imported', n)
  } catch (err) {
    if (err instanceof SyntaxError) return t('st.badJson')
    if ((err as Error).message === 'not-a-yaqs-export') return t('st.notExport')
    return (err as Error).message
  }
}
