/**
 * Assembles npm-package/: the folder that `npm publish` uploads as the `powdock` package.
 *
 * Run by `bun run build:npm` after the build and the start.js bundle, or alone with
 * `bun run pack:npm` when those outputs already exist. Only the files listed here are copied, so
 * no source, tests, node_modules, source maps or dev-only files ship. The package has no
 * dependencies and no scripts: nothing runs on install.
 */
import { copyFile, cp, mkdir, readFile, rm, writeFile, chmod, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const outDir = path.join(root, 'npm-package')

const rootPackage = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')) as { version: string }

const required = ['start.js', 'dist/client', 'dist/server/server.js', 'npm/bin/powdock.mjs', 'npm/lib/launcher.mjs']

async function exists(relative: string): Promise<boolean> {
  return stat(path.join(root, relative))
    .then(() => true)
    .catch(() => false)
}

for (const relative of required) {
  if (!(await exists(relative))) {
    throw new Error(`Missing ${relative}. Run bun run build:npm (it runs the build first).`)
  }
}

/** Copies a folder, leaving out source maps. */
async function copyTree(from: string, to: string): Promise<void> {
  await cp(from, to, {
    recursive: true,
    filter: (source) => !source.endsWith('.map'),
  })
}

await rm(outDir, { recursive: true, force: true })
await mkdir(path.join(outDir, 'bin'), { recursive: true })
await mkdir(path.join(outDir, 'lib'), { recursive: true })

await copyFile(path.join(root, 'start.js'), path.join(outDir, 'start.js'))
await copyTree(path.join(root, 'dist', 'client'), path.join(outDir, 'dist', 'client'))
await copyTree(path.join(root, 'dist', 'server'), path.join(outDir, 'dist', 'server'))
await copyFile(path.join(root, 'npm', 'bin', 'powdock.mjs'), path.join(outDir, 'bin', 'powdock.mjs'))
await chmod(path.join(outDir, 'bin', 'powdock.mjs'), 0o755)
await copyFile(path.join(root, 'npm', 'lib', 'launcher.mjs'), path.join(outDir, 'lib', 'launcher.mjs'))
await copyFile(path.join(root, 'README.md'), path.join(outDir, 'README.md'))

// Apache-2.0 asks every copy to carry the license and the NOTICE file.
await copyFile(path.join(root, 'LICENSE'), path.join(outDir, 'LICENSE'))
await copyFile(path.join(root, 'NOTICE'), path.join(outDir, 'NOTICE'))

const manifest = {
  name: 'powdock',
  version: rootPackage.version,
  description: 'A lightweight web UI for the Docker Engine on your machine. Start it with npx powdock.',
  type: 'module',
  bin: { powdock: 'bin/powdock.mjs' },
  files: ['bin', 'lib', 'dist', 'start.js', 'README.md', 'LICENSE', 'NOTICE'],
  engines: { node: '>=18' },
  keywords: ['docker', 'docker-engine', 'containers', 'web-ui', 'bun'],
  repository: { type: 'git', url: 'git+https://github.com/powroom/powdock.git' },
  homepage: 'https://github.com/powroom/powdock#readme',
  bugs: { url: 'https://github.com/powroom/powdock/issues' },
  license: 'Apache-2.0',
}
await writeFile(path.join(outDir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)

console.log(`Assembled ${path.relative(root, outDir)}/ for powdock ${rootPackage.version}`)
