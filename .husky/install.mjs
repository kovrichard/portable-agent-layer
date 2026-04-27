import { existsSync } from 'node:fs'

if (process.env.CI === 'true' || process.env.NODE_ENV === 'production' || !existsSync('.git')) {
  process.exit(0)
}

const husky = (await import('husky')).default
console.log(husky())
