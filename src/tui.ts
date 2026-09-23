import readline from 'readline'
import { webLoginCommand, type WebLoginStart } from './commands'
import { defaultHttp, HttpClient } from './http'
import { DEFAULT_API_BASE, getSisuHome, readAuth, sisuEngineHome } from './store'
import {
  assertRuntimeAvailable,
  findGrokBuildBinary,
  migrateGrokScratchToEngine,
  pagerBinaryRunnable,
  pagerSpawnCwd,
  pagerStampAllowsSpawn,
  purgeChangelogCache,
  RuntimeUnavailable,
  sisuGrokBuildEnv,
  writeSisuGrokConfig,
} from './runtime/launch'
import { postTranscriptEvent, startTranscriptWatch } from './runtime/transcriptEvents'
import { spawn } from 'child_process'

export interface LineIo {
  write(text: string): void
  question(prompt: string): Promise<string>
  /** Optional hidden prompt. Injected I/O should implement this; default TTY adapter hides echo. */
  questionPassword?(prompt: string): Promise<string>
  close?(): void
}

/** Pager exits with this code so the host runs `sisu login` and respawns. */
export const SISU_LOGIN_EXIT_CODE = 10

/** Native pager missing is a failed launch, not a second product. */
export const NATIVE_PAGER_FALLBACK_NOTICE =
  'sisu: native TUI cannot start on this machine. Run `sisu update` or reinstall @stevezhou/sisu. This CLI will not open the fallback shell.\n'

/** Bare `sisu` is the interactive TUI; pipes and scripts must use the headless command. */
export const TUI_REQUIRES_TTY_NOTICE =
  'sisu: the interactive TUI needs a terminal. For a one-shot question use `sisu exec "<prompt>"` (alias `sisu -p "<prompt>"`).\n'

export interface TuiDeps {
  http: HttpClient
  auth: typeof readAuth
  webLogin?: typeof webLoginCommand
  /** Test double / override for the stamped grok-pager child spawn. */
  spawnGrokPager?: (args?: string[]) => Promise<number | null>
  /** Extra argv for the stamped pager, e.g. `['--resume', sessionId]`. */
  pagerArgs?: string[]
  /** Test double: whether the native pager binary can exec on this OS. */
  pagerRunnable?: (binary: string) => boolean
  probe?: typeof assertRuntimeAvailable
}

/** Pager may leave the alt screen / hide the cursor when it exits 10. */
function restoreInteractiveTerminal(io: LineIo): void {
  io.write('\x1b[?1049l\x1b[?25h\x1b[?2004l\x1b[0m')
}

export function defaultTuiIo(): LineIo {
  let rl: readline.Interface | undefined
  const ensureRl = () => {
    if (!rl) {
      rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    }
    return rl
  }
  const io: LineIo = {
    write(text: string) {
      process.stdout.write(text)
    },
    question(prompt: string) {
      return new Promise((resolve) => {
        ensureRl().question(prompt, (answer) => resolve(answer))
      })
    },
    questionPassword(prompt: string) {
      if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
        return readHiddenPassword(io, prompt)
      }
      return io.question(prompt)
    },
    close() {
      rl?.close()
      rl = undefined
    },
  }
  return io
}

async function readHiddenPassword(io: LineIo, prompt: string): Promise<string> {
  io.close?.()
  io.write(prompt)
  const stdin = process.stdin
  const wasRaw = stdin.isRaw
  if (typeof stdin.setRawMode === 'function') stdin.setRawMode(true)
  stdin.resume()
  try {
    return await new Promise<string>((resolve, reject) => {
      let password = ''
      const finish = (value: string, error?: Error) => {
        stdin.off('data', onData)
        stdin.off('error', onError)
        io.write('\n')
        if (error) reject(error)
        else resolve(value)
      }
      const onError = (error: Error) => finish('', error)
      const onData = (chunk: string | Buffer) => {
        const text = String(chunk)
        for (const ch of text) {
          if (ch === '\n' || ch === '\r') {
            finish(password)
            return
          }
          if (ch === '\u0003') {
            finish('\u0003')
            return
          }
          if (ch === '\u007f' || ch === '\b') {
            password = password.slice(0, -1)
            continue
          }
          password += ch
        }
      }
      stdin.on('data', onData)
      stdin.on('error', onError)
    })
  } finally {
    if (typeof stdin.setRawMode === 'function') stdin.setRawMode(Boolean(wasRaw))
  }
}

export async function runTui(
  io: LineIo,
  deps: Partial<TuiDeps> = {},
): Promise<number> {
  const http = deps.http ?? defaultHttp
  const auth = deps.auth ?? readAuth
  const webLogin = deps.webLogin ?? webLoginCommand
  const probe = deps.probe ?? assertRuntimeAvailable

  try {
  if (!process.stdout.isTTY && !deps.spawnGrokPager) {
    io.write(TUI_REQUIRES_TTY_NOTICE)
    return 1
  }

  let openedBrowserLogin = false
  const startWebLogin = async (notify: (line: string) => void): Promise<string> => {
    openedBrowserLogin = true
    return webLogin({
      onStart: (info: WebLoginStart) => {
        notify(`Open ${info.verification_uri_complete}`)
        notify(`Confirm code ${info.user_code}`)
      },
    }, http)
  }

  let account = auth()
  if (!account) {
    try {
      const email = await startWebLogin((line) => io.write(`${line}\n`))
      io.write(`logged in as ${email}\n`)
    } catch (error) {
      io.write(`${error instanceof Error ? error.message : String(error)}\n`)
      io.write('login failed — run `sisu login`\n')
      return 1
    }
    account = auth()
    if (!account) {
      io.write('login failed — run `sisu login`\n')
      return 1
    }
  }

  try {
    await probe(http, account.api_base)
  } catch (error) {
    if (!(error instanceof RuntimeUnavailable)) throw error
    io.write(
      `sisu: SiSu runtime is not available at ${account.api_base}/api/runtime. ` +
        'This CLI will not fall back to xAI or open the fallback shell. Try again later.\n',
    )
    return 1
  }

  const grokBin = findGrokBuildBinary()
  const runnable = deps.pagerRunnable ?? pagerBinaryRunnable
  const nativePagerOk = Boolean(
    deps.spawnGrokPager ||
      (grokBin &&
        process.stdout.isTTY &&
        pagerStampAllowsSpawn(grokBin) &&
        runnable(grokBin)),
  )
  if (!nativePagerOk) {
    io.write(NATIVE_PAGER_FALLBACK_NOTICE)
    return 1
  }

  const pagerArgs = deps.pagerArgs ?? []
  const spawnOnce: () => Promise<number | null> =
    deps.spawnGrokPager
      ? () => deps.spawnGrokPager!(pagerArgs)
      : () => {
      const grokBin = findGrokBuildBinary()
      if (!grokBin || !process.stdout.isTTY) {
        return Promise.resolve(null)
      }
      if (!pagerStampAllowsSpawn(grokBin)) {
        io.write(
          'sisu: refusing to spawn a pager older than this CLI. Reinstall the pager or run `sisu` after postinstall.\n',
        )
        return Promise.resolve(null)
      }
      if (!runnable(grokBin)) {
        return Promise.resolve(null)
      }
      const home = getSisuHome()
      const engine = sisuEngineHome()
      migrateGrokScratchToEngine(home)
      purgeChangelogCache(home, engine)
      writeSisuGrokConfig()
      io.close?.()
      const env = sisuGrokBuildEnv()
      const stopWatch = startTranscriptWatch({
        engineHome: engine,
        conversationId: String(env.SISU_CONVERSATION_ID || ''),
        post: async (event) => {
          const current = auth()
          if (!current?.token) return false
          return postTranscriptEvent(
            http,
            current.api_base || DEFAULT_API_BASE,
            current.token,
            event,
          )
        },
      })
      const child = spawn(grokBin, pagerArgs, {
        stdio: 'inherit',
        env,
        cwd: pagerSpawnCwd(),
      })
      return new Promise<number>((resolve) => {
        const finish = (code: number) => {
          void stopWatch().finally(() => resolve(code))
        }
        child.on('exit', (code) => finish(code ?? 1))
        child.on('error', () => finish(1))
      })
    }

  // Login handoff: pager exits 10 → host web login at most once → respawn
  // grok-pager. A pager that cannot spawn at all is a failed launch.
  let retriedWithSession = false
  while (true) {
    const code = await spawnOnce()
    if (code === null) {
      io.write(NATIVE_PAGER_FALLBACK_NOTICE)
      return 1
    }
    if (code !== SISU_LOGIN_EXIT_CODE) return code
    restoreInteractiveTerminal(io)
    if (!auth() && !openedBrowserLogin) {
      try {
        const email = await startWebLogin((line) => io.write(`${line}\n`))
        io.write(`logged in as ${email}\n`)
      } catch (error) {
        io.write(`${error instanceof Error ? error.message : String(error)}\n`)
        io.write('login failed — run `sisu login`\n')
        return 1
      }
      continue
    }
    if (retriedWithSession) {
      io.write('sisu: grok pager still requesting login after a saved session.\n')
      return SISU_LOGIN_EXIT_CODE
    }
    retriedWithSession = true
  }
  } finally {
    io.close?.()
  }
}
