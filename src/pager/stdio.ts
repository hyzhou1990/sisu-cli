import type { PagerIo } from './app'

export function stdioPagerIo(): PagerIo {
  const stdin = process.stdin
  const stdout = process.stdout
  let previousRaw = false

  return {
    write(text: string) {
      stdout.write(text)
    },
    onData(handler) {
      const listener = (chunk: string | Buffer) => {
        handler(typeof chunk === 'string' ? chunk : chunk.toString('utf8'))
      }
      stdin.on('data', listener)
      return () => {
        stdin.off('data', listener)
      }
    },
    enterRaw() {
      if (stdin.isTTY && typeof stdin.setRawMode === 'function') {
        previousRaw = Boolean(stdin.isRaw)
        stdin.setRawMode(true)
      }
      stdin.setEncoding('utf8')
      stdin.resume()
    },
    leaveRaw() {
      if (stdin.isTTY && typeof stdin.setRawMode === 'function') {
        stdin.setRawMode(previousRaw)
      }
      stdin.pause()
    },
    get columns() {
      return stdout.columns || 80
    },
    get rows() {
      return stdout.rows || 24
    },
  }
}
