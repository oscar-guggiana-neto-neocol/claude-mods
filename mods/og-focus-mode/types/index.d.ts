declare module 'claude-code' {
  interface PluginState {
    'og-focus-mode': {
      /** Whether the cleaner interface is on; kept in the store across sessions. */
      isOn: boolean
      /** The session's directory, so file paths draw relative to it. */
      cwd: string | null
    }
  }
}
