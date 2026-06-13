import { $ } from 'bun'
import { readFile, rename, rm } from 'node:fs/promises'
import path from 'node:path'

const repoRoot = path.resolve(import.meta.dir, '..', '..')
const desktopRoot = path.join(repoRoot, 'desktop')
const outfile = path.join(desktopRoot, 'src-tauri/resources/preview-agent.js')
const tmpfile = `${outfile}.${process.pid}.tmp`
const entrypoint = path.join(desktopRoot, 'src/preview-agent/index.ts')

await $`bun build ${entrypoint} --outfile=${tmpfile} --format=iife --minify`

try {
  const [current, next] = await Promise.all([
    readFile(outfile),
    readFile(tmpfile),
  ])
  if (current.equals(next)) {
    await rm(tmpfile, { force: true })
    console.log('preview-agent.js unchanged')
    process.exit(0)
  }
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
    await rm(tmpfile, { force: true })
    throw error
  }
}

await rename(tmpfile, outfile)
console.log('preview-agent.js built')
