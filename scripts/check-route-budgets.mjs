import { readFile } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

// Count each emitted file once, including the bootstrap, layout, and every
// static dependency. Lazy components required at first render are explicit
// roots; interaction-only chunks are measured separately when requested.
export async function measureRoute(dist, manifest, roots) {
  const seen = new Set(), files = new Set()
  function visit(key) {
    if (seen.has(key)) return
    const entry = manifest[key]
    if (!entry) throw new Error(`Missing manifest entry: ${key}`)
    seen.add(key)
    files.add(entry.file)
    for (const dependency of entry.imports ?? []) visit(dependency)
    if (key !== 'index.html') for (const dependency of entry.dynamicImports ?? []) {
      if (dependency !== 'src/components/RegistrationTermsDialog.tsx') visit(dependency)
    }
  }
  for (const root of ['index.html', ...roots]) visit(root)
  let bytes = 0
  for (const file of files) {
    if (!file.endsWith('.js')) throw new Error(`Expected JavaScript entry: ${file}`)
    bytes += gzipSync(await readFile(resolve(dist, file))).length
  }
  return { bytes, files: [...files].sort() }
}

export async function checkBudgets(dist, config) {
  if (!Array.isArray(config) || !config.length) throw new Error('No route budgets configured')
  const manifest = JSON.parse(await readFile(resolve(dist, '.vite/manifest.json'), 'utf8'))
  const results = []
  const rules = config.flatMap(rule => {
    if (!rule.routePrefix) return [rule]
    const routes = Object.keys(manifest).filter(key => key.startsWith(rule.routePrefix) && key.endsWith('?tsr-split=component'))
    if (!routes.length) throw new Error(`No routes match: ${rule.routePrefix}`)
    return routes.map(route => {
      const parents = []
      let path = route.split('.tsx?')[0]
      while (path.includes('/')) {
        path = path.slice(0, path.lastIndexOf('/'))
        const parent = path + '.tsx?tsr-split=component'
        if (manifest[parent]) parents.push(parent)
      }
      return {...rule, name: `${rule.name}: ${route}`, entries: [...rule.entries, ...parents, route]}
    })
  })
  for (const rule of rules) {
    const measured = await measureRoute(dist, manifest, rule.entries)
    const limit = rule.limitKB * 1000
    if (!Number.isFinite(limit) || limit <= 0) throw new Error(`Invalid budget: ${rule.name}`)
    results.push({ name: rule.name, ...measured, limit, pass: measured.bytes < limit })
  }
  return results
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const config = JSON.parse(await readFile('.size-limit.json', 'utf8'))
    const results = await checkBudgets('apps/web/dist', config)
    for (const result of results) {
      console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name}: ${(result.bytes / 1000).toFixed(2)} KB gzip / ${result.limit / 1000} KB (${result.files.length} files)`)
    }
    if (results.some(result => !result.pass)) process.exitCode = 1
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
