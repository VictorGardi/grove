import type { ConfigValues, KeyAction, Launcher, LayoutSection } from '../../protocol/messages.ts'

export const FILES = ['settings.json', 'keys.json', 'launchers.json', 'theme.json', 'layout.json'] as const
export type ConfigFile = (typeof FILES)[number]

// The section of ConfigValues each file fills.
export interface ConfigSections {
  'settings.json': ConfigValues['settings']
  'keys.json': ConfigValues['keys']
  'launchers.json': ConfigValues['launchers']
  'theme.json': ConfigValues['theme']
  'layout.json': ConfigValues['layout']
}

export const SECTION: Record<ConfigFile, keyof ConfigValues> = {
  'settings.json': 'settings',
  'keys.json': 'keys',
  'launchers.json': 'launchers',
  'theme.json': 'theme',
  'layout.json': 'layout',
}

export const KEY_ACTIONS = [
  'grid-toggle',
  'new-shell',
  'new-space',
  'close-tab',
  'previous-tab',
  'grid-tab',
  'sidebar-toggle',
  'notes',
  'space-1',
  'space-2',
  'space-3',
  'space-4',
  'space-5',
  'space-6',
  'space-7',
  'space-8',
  'space-9',
] as const satisfies readonly KeyAction[]
export const LAYOUT_SECTIONS = ['spaces', 'agents'] as const satisfies readonly LayoutSection[]
export const THEME_TOKENS = [
  'accent',
  'state-needs-you',
  'state-working',
  'state-finished',
  'state-idle',
  'state-unknown',
  'pane-unfocused-opacity',
  'font-ui',
  'font-mono',
  'space-1',
  'space-2',
  'space-3',
  'space-4',
  'space-5',
  'space-6',
  'radius-sm',
  'radius-md',
  'text-sm',
  'text-md',
  'text-lg',
] as const

export const DEFAULT_VALUES: ConfigValues = {
  settings: { sidebarWidth: 240 },
  keys: {
    'grid-toggle': 'mod+g',
    'new-shell': 'mod+t',
    'new-space': 'mod+n',
    'close-tab': 'mod+w',
    'previous-tab': 'ctrl+tab',
    'grid-tab': 'mod+shift+g',
    'sidebar-toggle': 'mod+b',
    notes: 'mod+shift+n',
    'space-1': 'mod+1',
    'space-2': 'mod+2',
    'space-3': 'mod+3',
    'space-4': 'mod+4',
    'space-5': 'mod+5',
    'space-6': 'mod+6',
    'space-7': 'mod+7',
    'space-8': 'mod+8',
    'space-9': 'mod+9',
  },
  launchers: [],
  // Tokens not in the file keep their defaults in tokens.css, so the default is no override at all.
  theme: {},
  layout: { sidebarOrder: ['spaces', 'agents'] },
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; problem: string }
export type Validated<T> = { ok: true; value: T } | { ok: false; message: string }

// One key of a file. `type` and `description` are written into AGENTS.md; `parse` checks one value.
export interface Field {
  name: string
  type: string
  description: string
  default: unknown
  parse: (value: unknown) => Parsed<unknown>
}

export interface Schema {
  file: ConfigFile
  description: string
  fields: Field[]
  // A rule across fields; returns the problem, or null when the fields agree.
  check?: (fields: Record<string, unknown>) => string | null
  // The field whose value is the section, when the file wraps it. Otherwise the fields object is the section.
  unwrap?: string
}

const ok = <T>(value: T): Parsed<T> => ({ ok: true, value })
const no = (problem: string): Parsed<never> => ({ ok: false, problem })

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function integerIn(min: number, max: number): (value: unknown) => Parsed<number> {
  return (value) =>
    Number.isInteger(value) && (value as number) >= min && (value as number) <= max
      ? ok(value as number)
      : no(`must be an integer from ${min} to ${max}`)
}

const MODIFIERS = ['mod', 'ctrl', 'alt', 'shift'] as const

// The keys a binding can name besides a letter or digit.
const NAMED_KEYS = ['tab'] as const

// The canonical form of a key binding such as "mod+shift+1": one or more modifiers in a fixed order, then one
// lowercase letter, digit or named key (tab). Returns null when the text is not a binding.
export function canonicalBinding(text: string): string | null {
  const parts = text.split('+')
  const key = parts.pop() ?? ''
  if (!/^[a-z0-9]$/.test(key) && !(NAMED_KEYS as readonly string[]).includes(key)) return null
  if (parts.length === 0) return null
  if (new Set(parts).size !== parts.length) return null
  if (!parts.every((part) => (MODIFIERS as readonly string[]).includes(part))) return null
  return [...MODIFIERS.filter((modifier) => parts.includes(modifier)), key].join('+')
}

const KEY_DESCRIPTIONS: Record<KeyAction, string> = {
  'grid-toggle': 'Shows or hides the grid of the active space\'s tabs in it.',
  'new-shell': 'Opens a shell tab in the active space.',
  'new-space': 'Adds a space at the home folder, or selects it if it exists, and opens a shell tab there.',
  'close-tab': 'Closes the active tab.',
  'previous-tab': 'Goes back to the tab you were in before the active one, in the active space. Pressed again, it goes back to the one before.',
  'grid-tab': 'Puts the active tab into the grid and shows the grid. A tab already in the grid goes out of it and shows full screen. The grid holds nine tabs.',
  'sidebar-toggle': 'Shows or hides the sidebar. The button in the tab strip does the same.',
  notes: 'Opens or closes the notes: one markdown page that saves as you type.',
  'space-1': 'Focuses the first space in the sidebar, with the tab it last showed.',
  'space-2': 'Focuses the second space in the sidebar, with the tab it last showed.',
  'space-3': 'Focuses the third space in the sidebar, with the tab it last showed.',
  'space-4': 'Focuses the fourth space in the sidebar, with the tab it last showed.',
  'space-5': 'Focuses the fifth space in the sidebar, with the tab it last showed.',
  'space-6': 'Focuses the sixth space in the sidebar, with the tab it last showed.',
  'space-7': 'Focuses the seventh space in the sidebar, with the tab it last showed.',
  'space-8': 'Focuses the eighth space in the sidebar, with the tab it last showed.',
  'space-9': 'Focuses the ninth space in the sidebar, with the tab it last showed.',
}

const LAUNCHER_KEYS: readonly string[] = ['id', 'label', 'command', 'args', 'env']
const LAUNCHER_ID = /^[a-z0-9-]{1,32}$/
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/
const TOKEN_VALUE = /^[#(),.%\w\s-]{1,80}$/

function parseLaunchers(value: unknown): Parsed<Launcher[]> {
  if (!Array.isArray(value)) return no('must be a list of launcher objects')
  const ids = new Set<string>()
  const launchers: Launcher[] = []
  for (const [index, item] of value.entries()) {
    const where = `launcher ${index + 1}`
    if (!isPlainObject(item)) return no(`${where} must be an object`)
    const extra = Object.keys(item).find((key) => !LAUNCHER_KEYS.includes(key))
    if (extra !== undefined) return no(`${where}: unknown key "${extra}"`)
    const { id, label, command } = item
    if (typeof id !== 'string' || !LAUNCHER_ID.test(id)) {
      return no(`${where}: id must be 1 to 32 lowercase letters, digits or dashes`)
    }
    if (ids.has(id)) return no(`${where}: id "${id}" is used by another launcher`)
    if (typeof label !== 'string' || label.trim() === '' || label.length > 40) {
      return no(`${where}: label must be 1 to 40 characters`)
    }
    if (typeof command !== 'string' || command.trim() === '') return no(`${where}: command must be a non-empty string`)
    const args = item.args ?? []
    if (!Array.isArray(args) || !args.every((arg) => typeof arg === 'string')) {
      return no(`${where}: args must be a list of strings`)
    }
    const env = item.env ?? {}
    if (!isPlainObject(env) || !Object.entries(env).every(([name, text]) => ENV_NAME.test(name) && typeof text === 'string')) {
      return no(`${where}: env must map variable names to strings`)
    }
    ids.add(id)
    launchers.push({ id, label, command, args: args as string[], env: env as Record<string, string> })
  }
  return ok(launchers)
}

function parseTokens(value: unknown): Parsed<Record<string, string>> {
  if (!isPlainObject(value)) return no('must be an object of token names to values')
  const tokens: Record<string, string> = {}
  for (const [name, text] of Object.entries(value)) {
    if (!(THEME_TOKENS as readonly string[]).includes(name)) return no(`unknown token "${name}"`)
    if (typeof text !== 'string' || !TOKEN_VALUE.test(text) || /url\(/i.test(text)) {
      return no(`token "${name}" must be 1 to 80 characters from letters, digits, # ( ) , . % - and spaces`)
    }
    tokens[name] = text
  }
  return ok(tokens)
}

function parseOrder(value: unknown): Parsed<LayoutSection[]> {
  const valid =
    Array.isArray(value) && value.length === LAYOUT_SECTIONS.length && LAYOUT_SECTIONS.every((name) => value.includes(name))
  return valid ? ok(value as LayoutSection[]) : no('must list "spaces" and "agents", each once')
}

export const SCHEMAS: Record<ConfigFile, Schema> = {
  'settings.json': {
    file: 'settings.json',
    description: 'Window settings.',
    fields: [
      {
        name: 'sidebarWidth',
        type: 'integer, 180 to 480',
        description: 'Width of the sidebar in pixels.',
        default: DEFAULT_VALUES.settings.sidebarWidth,
        parse: integerIn(180, 480),
      },
    ],
  },
  'keys.json': {
    file: 'keys.json',
    description:
      'Key bindings of the window. A binding is one or more modifiers (mod, ctrl, alt, shift) and one letter, digit or "tab", joined by "+", in any order. "mod" is Cmd on macOS and Ctrl elsewhere; "ctrl" is the Control key on every platform. Two actions cannot share a binding. The space actions name the sidebar order, and a space past the last one is ignored.',
    fields: KEY_ACTIONS.map((action) => ({
      name: action,
      type: 'key binding, e.g. "mod+g"',
      description: KEY_DESCRIPTIONS[action],
      default: DEFAULT_VALUES.keys[action],
      parse: (value: unknown) =>
        typeof value === 'string' && canonicalBinding(value) !== null
          ? ok(value)
          : no('must be a key binding such as "mod+g", "mod+shift+n" or "ctrl+tab"'),
    })),
    check: (fields) => {
      const seen = new Map<string, string>()
      for (const action of KEY_ACTIONS) {
        const canonical = canonicalBinding(fields[action] as string) ?? ''
        const other = seen.get(canonical)
        if (other !== undefined) return `${action}: same binding as ${other}`
        seen.set(canonical, action)
      }
      return null
    },
  },
  'launchers.json': {
    file: 'launchers.json',
    description:
      'Launchers are buttons in the tab strip. A click opens a shell tab in the active space and types the launcher line into it.',
    fields: [
      {
        name: 'launchers',
        type: 'list of launcher objects, default []',
        description:
          'Each launcher is an object with "id" (1 to 32 lowercase letters, digits or dashes; unique), "label" (1 to 40 characters, the button text), "command" (the program to run), "args" (optional list of strings) and "env" (optional object of variable names to strings, set before the command).',
        default: DEFAULT_VALUES.launchers,
        parse: parseLaunchers,
      },
    ],
    unwrap: 'launchers',
  },
  'theme.json': {
    file: 'theme.json',
    description:
      'Colours, sizes and fonts of the window. Each token is a CSS value written on the document root as --<name>. Tokens not listed keep their defaults.',
    fields: [
      {
        name: 'tokens',
        type: 'object of token names to CSS values, default {}',
        description: `Token names: ${THEME_TOKENS.join(', ')}. A value is 1 to 80 characters from letters, digits, # ( ) , . % - and spaces (no semicolons, braces, quotes or url()).`,
        default: DEFAULT_VALUES.theme,
        parse: parseTokens,
      },
    ],
    unwrap: 'tokens',
  },
  'layout.json': {
    file: 'layout.json',
    description: 'Arrangement of the sidebar.',
    fields: [
      {
        name: 'sidebarOrder',
        type: 'list holding "spaces" and "agents" once each',
        description: 'The order of the two sidebar sections, top first.',
        default: DEFAULT_VALUES.layout.sidebarOrder,
        parse: parseOrder,
      },
    ],
  },
}

// The file as the core writes it when it is missing: the version and every field at its default.
export function defaultFile(file: ConfigFile): Record<string, unknown> {
  const fields = SCHEMAS[file].fields.map((field) => [field.name, structuredClone(field.default)])
  return { version: 1, ...Object.fromEntries(fields) }
}

// Checks a parsed file against its schema. A failure message starts with the file name and names the field.
export function validateFile<F extends ConfigFile>(file: F, json: unknown): Validated<ConfigSections[F]> {
  const fail = (problem: string): Validated<never> => ({ ok: false, message: `${file}: ${problem}` })
  const schema = SCHEMAS[file]
  if (!isPlainObject(json)) return fail('must be a JSON object')
  if (json.version !== 1) return fail('"version" must be 1')
  const names = new Set(schema.fields.map((field) => field.name))
  for (const key of Object.keys(json)) {
    if (key !== 'version' && !names.has(key)) return fail(`unknown key "${key}"`)
  }
  const fields: Record<string, unknown> = {}
  for (const field of schema.fields) {
    const raw = json[field.name]
    if (raw === undefined) {
      fields[field.name] = structuredClone(field.default)
      continue
    }
    const parsed = field.parse(raw)
    if (!parsed.ok) return fail(`${field.name}: ${parsed.problem}`)
    fields[field.name] = parsed.value
  }
  const problem = schema.check?.(fields)
  if (problem) return fail(problem)
  const section = schema.unwrap === undefined ? fields : fields[schema.unwrap]
  return { ok: true, value: section as ConfigSections[F] }
}
