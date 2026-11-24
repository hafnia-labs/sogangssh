import Store from 'electron-store'
import type { LastLogin } from '../shared/ipc'

// User settings in the app data folder (settings.json). Never put passwords or keys here.
type Schema = { lastLogin?: LastLogin }

let store: Store<Schema> | null = null

function getStore(): Store<Schema> {
  store ??= new Store<Schema>({ name: 'settings' })
  return store
}

export const settings = {
  getLastLogin(): LastLogin | null {
    return getStore().get('lastLogin') ?? null
  },
  /** Remember where this user logs in, so the next launch opens with the same server and ID. */
  setLastLogin(login: LastLogin): void {
    getStore().set('lastLogin', login)
  },
}
