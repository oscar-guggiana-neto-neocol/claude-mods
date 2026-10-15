// Pure logic of the focus: reading what the person typed, and the status line.
// No `$` here, so tests drive it alone.

import type { Focus } from '../types'

const ID = /^[A-Z][A-Z0-9]+-\d+$/
const MAX = 60

const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim()

/** A focus from an ID and a description, either optional; neither is no focus. */
export const focusOf = (id: string | undefined, description: string | undefined): Focus | undefined => {
  const key = oneLine(id ?? '')
  const text = oneLine(description ?? '')
  if (key === '' && text === '') return undefined

  return key === '' ? { description: text } : { id: key, description: text }
}

/** `/og-ticket` text: the first word is the ID when it looks like one, the rest the description. */
export const parseFocus = (text: string): Focus | undefined => {
  const [first = '', ...rest] = oneLine(text).split(' ')

  return ID.test(first) ? focusOf(first, rest.join(' ')) : focusOf(undefined, text)
}

/** Cuts a text to `max` characters (an emoji counts as one), ending in `…`. */
const cut = (text: string, max: number) => {
  const chars = [...text]
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join('')}…`
}

export const statusText = (focus: Focus) =>
  cut(`🎫 ${[focus.id, focus.description].filter(Boolean).join(' · ')}`, MAX)
