#!/usr/bin/env node
// Entry point of the `powdock` command. Works with Node.js 18 or newer and with Bun.
// All the logic is in ../lib/launcher.mjs.
import { main } from '../lib/launcher.mjs'

process.exit(await main(process.argv.slice(2)))
