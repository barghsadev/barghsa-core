import { readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
  }
  return value
}

export function contractText(document) {
  if (typeof document.openapi !== 'string' || !document.openapi.startsWith('3.') ||
      !document.paths || !Object.keys(document.paths).length) throw new Error('Missing or empty OpenAPI document')
  return JSON.stringify(canonical(document), null, 2) + '\n'
}

export function assertContract(current, saved) {
  if (contractText(current) !== contractText(saved)) {
    throw new Error('OpenAPI drift: review the generated API contract and run pnpm contract:update after an intentional change.')
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const generated = JSON.parse(await readFile('apps/api/dist/openapi.json', 'utf8'))
    const target = 'apps/api/openapi.json'
    if (process.argv.includes('--write')) {
      await writeFile(target, contractText(generated))
      console.log(`Updated ${target}; review and commit the contract with its implementation.`)
    } else {
      assertContract(generated, JSON.parse(await readFile(target, 'utf8')))
      console.log('PASS generated OpenAPI matches the committed contract')
    }
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
