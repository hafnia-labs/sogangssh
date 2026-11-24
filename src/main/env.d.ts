// Build-time settings from the git-ignored `.env.local` (see `.env.example`), inlined by
// electron-vite. Server details are never committed.
interface ImportMetaEnv {
  readonly MAIN_VITE_SNPSLMD_LICENSE_FILE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
