import { decodeKeys } from './input'

describe('decodeKeys', () => {
  it('decodes arrows, enter, backspace, and utf8 chars', () => {
    expect(decodeKeys('\x1b[A\x1b[D').keys).toEqual([{ type: 'up' }, { type: 'left' }])
    expect(decodeKeys('\r').keys).toEqual([{ type: 'enter' }])
    expect(decodeKeys('\x7f').keys).toEqual([{ type: 'backspace' }])
    expect(decodeKeys('你').keys).toEqual([{ type: 'char', value: '你' }])
  })

  it('maps remaining arrow keys, newline, and backspace variants', () => {
    expect(decodeKeys('\x1b[B\x1b[C').keys).toEqual([{ type: 'down' }, { type: 'right' }])
    expect(decodeKeys('\n').keys).toEqual([{ type: 'enter' }])
    expect(decodeKeys('\b').keys).toEqual([{ type: 'backspace' }])
  })

  it('maps lone escape and ctrl+c to escape', () => {
    expect(decodeKeys('\x1b').keys).toEqual([{ type: 'escape' }])
    expect(decodeKeys('\x03').keys).toEqual([{ type: 'escape' }])
  })

  it('keeps incomplete escape sequences in rest', () => {
    expect(decodeKeys('\x1b')).toEqual({ keys: [{ type: 'escape' }], rest: '' })
    expect(decodeKeys('\x1b[')).toEqual({ keys: [], rest: '\x1b[' })
    expect(decodeKeys('\x1b[A')).toEqual({ keys: [{ type: 'up' }], rest: '' })
  })

  it('decodes printable ascii and multi-char chunks', () => {
    expect(decodeKeys('ab').keys).toEqual([
      { type: 'char', value: 'a' },
      { type: 'char', value: 'b' },
    ])
    expect(decodeKeys('你好').keys).toEqual([
      { type: 'char', value: '你' },
      { type: 'char', value: '好' },
    ])
  })
})
