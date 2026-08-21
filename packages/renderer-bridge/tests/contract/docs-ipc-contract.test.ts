/**
 * Increment 2I — Typed IPC contract tests.
 *
 * Verifies that the DocsIpcContract channel maps encode the correct
 * channel names, argument tuples, and return/event payload types.
 *
 * These are COMPILE-TIME tests — if the types are wrong, the file won't
 * compile. The runtime assertions verify the channel names exist and
 * the type-level checks pass.
 */
import { describe, test, expect } from 'vitest'
import type { DocsIpcRequestChannels, DocsIpcSendChannels, DocsIpcEventChannels } from '../../src/docs-ipc-contract.js'
import type { DocsIpcTransport } from '../../src/ipc-transport.js'

// ── Compile-time type checks ────────────────────────────────────────────
//
// If any of these type-level assignments fail to compile, the contract
// types are wrong. The tests below also verify the channel names at runtime.

// Helper: extract the keys of a type as a string array
type Keys<T> = Array<keyof T>

// Verify the request channels exist with the right shape
const requestChannelNames: Keys<DocsIpcRequestChannels> = [
  'app:get-language',
  'app:get-theme',
  'docs:open',
  'docs:open-path',
  'docs:consume-pending-open',
  'docs:consume-new-blank',
  'docs:save',
  'docs:write-recovery',
  'docs:save-as',
  'docs:save-new',
  'docs:recent',
  'docs:pick-image',
  'docs:font-metrics',
  'docs:print',
  'docs:export-pdf',
  'docs:print-pdf-buffer',
  'docs:save-merged-pdf',
  'files:pick',
  'files:add',
  'files:add-pasted-image',
  'files:read',
  'files:read-image',
  'ai:get-settings',
  'ai:set-settings',
  'ai:chat',
  'ai:stream',
  'ai:stream-cancel',
  'ai:gsk-status',
  'ai:gsk-login',
  'ai:web-search',
  'ai:image-search',
  'ai:fetch-image',
  'win:new',
  'win:list',
  'win:focus',
]

// Verify the send channels exist
const sendChannelNames: Keys<DocsIpcSendChannels> = [
  'docs:view-menu-state',
  'docs:close-check-result',
  'docs:close-save-result',
]

// Verify the event channels exist
const eventChannelNames: Keys<DocsIpcEventChannels> = [
  'app:language-changed',
  'app:theme-changed',
  'app:chrome-pressed',
  'docs:opened',
  'docs:renamed',
  'docs:teardown',
  'ai:stream-chunk',
  'menu:command',
  'docs:close-check',
  'docs:close-save-request',
]

// ── Runtime tests ────────────────────────────────────────────────────────

describe('Increment 2I — Typed IPC contract', () => {
  describe('Request channels (invoke → Promise<Return>)', () => {
    test('all required request channels are present', () => {
      for (const name of requestChannelNames) {
        expect(typeof name).toBe('string')
      }
      // Verify the exact count (35 request channels)
      expect(requestChannelNames).toHaveLength(35)
    })

    test('app:get-language channel exists with correct types', () => {
      // Compile-time: the channel's Args and Return are typed
      type Channel = DocsIpcRequestChannels['app:get-language']
      // Runtime: the channel name is a string literal
      const channel: Channel['Args'] = []
      expect(channel).toEqual([])
    })

    test('docs:open channel exists with correct types', () => {
      type Channel = DocsIpcRequestChannels['docs:open']
      const args: Channel['Args'] = []
      expect(args).toEqual([])
    })

    test('docs:save channel exists with 3 args (path, data, auto)', () => {
      type Channel = DocsIpcRequestChannels['docs:save']
      const args: Channel['Args'] = ['/p.docx', new ArrayBuffer(0), true]
      expect(args).toHaveLength(3)
    })

    test('docs:export-pdf channel exists with 4 args', () => {
      type Channel = DocsIpcRequestChannels['docs:export-pdf']
      const args: Channel['Args'] = ['name.pdf', 12240, 15840, undefined]
      expect(args).toHaveLength(4)
    })

    test('docs:save-merged-pdf channel exists with 3 args', () => {
      type Channel = DocsIpcRequestChannels['docs:save-merged-pdf']
      const args: Channel['Args'] = ['name.pdf', ['part1'], undefined]
      expect(args).toHaveLength(3)
    })

    test('ai:web-search channel exists with 2 args', () => {
      type Channel = DocsIpcRequestChannels['ai:web-search']
      const args: Channel['Args'] = ['query', 10]
      expect(args).toHaveLength(2)
    })

    test('win:new channel exists with 1 arg (openPath: string | null)', () => {
      type Channel = DocsIpcRequestChannels['win:new']
      const args: Channel['Args'] = [null]
      expect(args).toHaveLength(1)
    })
  })

  describe('Send channels (send → void)', () => {
    test('all required send channels are present', () => {
      for (const name of sendChannelNames) {
        expect(typeof name).toBe('string')
      }
      expect(sendChannelNames).toHaveLength(3)
    })

    test('docs:view-menu-state channel exists with 1 arg', () => {
      type Channel = DocsIpcSendChannels['docs:view-menu-state']
      const args: Channel['Args'] = [{ aiSidebar: true, darkCanvas: false }]
      expect(args).toHaveLength(1)
    })

    test('docs:close-check-result channel exists with 1 arg', () => {
      type Channel = DocsIpcSendChannels['docs:close-check-result']
      const args: Channel['Args'] = [{ dirty: true, autoSave: false, filePath: null }]
      expect(args).toHaveLength(1)
    })

    test('docs:close-save-result channel exists with 1 arg', () => {
      type Channel = DocsIpcSendChannels['docs:close-save-result']
      const args: Channel['Args'] = [true]
      expect(args).toHaveLength(1)
    })
  })

  describe('Event channels (on → listener receives Payload)', () => {
    test('all required event channels are present', () => {
      for (const name of eventChannelNames) {
        expect(typeof name).toBe('string')
      }
      expect(eventChannelNames).toHaveLength(10)
    })

    test('app:language-changed channel exists with 1 payload arg', () => {
      type Channel = DocsIpcEventChannels['app:language-changed']
      const payload: Channel['Payload'] = ['en']
      expect(payload).toHaveLength(1)
    })

    test('app:theme-changed channel exists with 1 payload arg', () => {
      type Channel = DocsIpcEventChannels['app:theme-changed']
      const payload: Channel['Payload'] = ['dark']
      expect(payload).toHaveLength(1)
    })

    test('docs:opened channel exists with 1 payload arg', () => {
      type Channel = DocsIpcEventChannels['docs:opened']
      const payload: Channel['Payload'] = [
        { path: '/p.docx', name: 'p.docx', data: new ArrayBuffer(0), hash: 'h' },
      ]
      expect(payload).toHaveLength(1)
    })

    test('docs:renamed channel exists with 1 payload arg', () => {
      type Channel = DocsIpcEventChannels['docs:renamed']
      const payload: Channel['Payload'] = [{ oldPath: '/old.docx', newPath: '/new.docx' }]
      expect(payload).toHaveLength(1)
    })

    test('docs:teardown channel exists with 0 payload args', () => {
      type Channel = DocsIpcEventChannels['docs:teardown']
      const payload: Channel['Payload'] = []
      expect(payload).toHaveLength(0)
    })

    test('ai:stream-chunk channel exists with 1 payload arg', () => {
      type Channel = DocsIpcEventChannels['ai:stream-chunk']
      // AiStreamChunk is a complex type — just verify the payload tuple has 1 element
      type PayloadLen = Channel['Payload']['length']
      const len: PayloadLen = 1
      expect(len).toBe(1)
    })

    test('menu:command channel exists with 2 payload args', () => {
      type Channel = DocsIpcEventChannels['menu:command']
      const payload: Channel['Payload'] = ['save', undefined]
      expect(payload).toHaveLength(2)
    })

    test('docs:close-check channel exists with 0 payload args', () => {
      type Channel = DocsIpcEventChannels['docs:close-check']
      const payload: Channel['Payload'] = []
      expect(payload).toHaveLength(0)
    })

    test('docs:close-save-request channel exists with 0 payload args', () => {
      type Channel = DocsIpcEventChannels['docs:close-save-request']
      const payload: Channel['Payload'] = []
      expect(payload).toHaveLength(0)
    })
  })

  describe('DocsIpcTransport type', () => {
    test('DocsIpcTransport is a TypedIpcTransport with the Docs contract', () => {
      // Compile-time: DocsIpcTransport is assignable to the typed transport shape.
      // If this compiles, the contract is correctly wired.
      const transport: DocsIpcTransport = {
        invoke: () => Promise.resolve(null),
        send: () => {},
        on: () => () => {},
      }
      expect(transport).toBeDefined()
      expect(typeof transport.invoke).toBe('function')
      expect(typeof transport.send).toBe('function')
      expect(typeof transport.on).toBe('function')
    })
  })
})
