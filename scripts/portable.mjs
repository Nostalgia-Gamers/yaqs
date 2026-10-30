// Copies the release exe as a portable build: the "portable" in its name
// makes YAQS keep its data in a YAQS-data folder next to the exe.
// Usage: node scripts/portable.mjs [version]   (CI passes the tag's version)
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs'

const version = process.argv[2] || JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8')).version
const dir = 'src-tauri/target/release/bundle/portable'
const out = `${dir}/YAQS_${version}_x64-portable.exe`
mkdirSync(dir, { recursive: true })
try {
  copyFileSync('src-tauri/target/release/yaqs.exe', out)
  console.log(`Portable build: ${out}`)
} catch (e) {
  if (e.code !== 'EBUSY' && e.code !== 'EPERM') throw e
  console.error(`${out} is open. Close YAQS and run: node scripts/portable.mjs`)
  process.exitCode = 1
}
