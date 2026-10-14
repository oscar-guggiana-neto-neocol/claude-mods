/** A choice as `<brand>-<mode>`, such as `neocol-dark`. */
export type ChoiceKey = string

declare module 'claude-code' {
  interface PluginState {
    'og-themes': {
      /** The project's choice; null when the project has none. */
      choice: ChoiceKey | null
      /** The line under the menu after a pick. */
      note: string | null
    }
  }
}
