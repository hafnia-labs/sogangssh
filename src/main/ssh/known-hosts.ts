import Store from 'electron-store'

// Trust-on-first-use host key store: "host:port" -> "SHA256:<base64>".
// Saved in the app data folder (known-hosts.json). Holds only public fingerprints.
type Schema = { hosts: Record<string, string> }

let store: Store<Schema> | null = null

function getStore(): Store<Schema> {
  store ??= new Store<Schema>({ name: 'known-hosts', defaults: { hosts: {} } })
  return store
}

const keyOf = (host: string, port: number) => `${host.toLowerCase()}:${port}`

export const knownHosts = {
  get(host: string, port: number): string | undefined {
    return getStore().get('hosts')[keyOf(host, port)]
  },
  set(host: string, port: number, fingerprint: string): void {
    // Write the whole map: hostnames contain dots, which electron-store treats as key paths.
    const hosts = { ...getStore().get('hosts'), [keyOf(host, port)]: fingerprint }
    getStore().set('hosts', hosts)
  },
}
