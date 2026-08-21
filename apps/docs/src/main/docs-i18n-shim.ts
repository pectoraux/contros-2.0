/**
 * i18n shim for the coordinator.
 *
 * The existing docs-main.ts uses a `tm()` function for localized strings.
 * The coordinator can't import from docs-main.ts (circular dep), so we
 * provide a minimal shim that returns the key when the real translator
 * isn't connected.
 *
 * When the shell wires up, it calls setTranslator() to connect the real i18n.
 */

interface Translator {
  t(key: string): string
}

let translator: Translator | null = null

export function setTranslator(t: Translator): void {
  translator = t
}

export const i18n = {
  t(key: string): string {
    return translator?.t(key) ?? key
  },
}
