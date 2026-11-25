import path from 'node:path'

/** The data folder: $POWDOCK_DATA_DIR when set, otherwise ./.data in the current folder. */
export function dataDir(): string {
  const setting = process.env.POWDOCK_DATA_DIR
  return setting ? path.resolve(setting) : path.resolve(process.cwd(), '.data')
}
