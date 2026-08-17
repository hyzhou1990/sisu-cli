import readline from 'readline'
import { execCommand, fetchBalance, formatQuota, listConversationsCommand, listLocalCommand, loginCommand, openConversationCommand, setTrainingCommand, statusCommand, webLoginCommand, type LoginInput, type WebLoginStart } from './commands'
import { defaultHttp, HttpClient } from './http'
import { sisuMobiusArt, sisuSplash, sisuSplashFrame, sisuSplashHeight, sisuWordmark } from './logo'
import { mobiusFrameHeight } from './mobius'
import { runPager, type PagerIo, type RunPagerOptions } from './pager/app'
import { stdioPagerIo } from './pager/stdio'
import { readAuth } from './store'
import { createFastApiTransport, type TurnTransport } from './transport'

export interface LineIo {
  write(text: string): void
  question(prompt: string): Promise<string>
  /** Optional hidden prompt. Injected I/O should implement this; default TTY adapter hides echo. */
  questionPassword?(prompt: string): Promise<string>
  close?(): void
}

export interface TuiDeps {
  http: HttpClient
  status: typeof statusCommand
  exec: typeof execCommand
  ls: typeof listLocalCommand
  history: typeof listConversationsCommand
  openThread: typeof openConversationCommand
  training: typeof setTrainingCommand
  auth: typeof readAuth
  login?: (input: LoginInput) => Promise<string>
  webLogin?: typeof webLoginCommand
  columns: number
  animate?: boolean
  sleep?: (ms: number) => Promise<void>
  color?: boolean
  pager?: (io: PagerIo, transport: TurnTransport, options?: RunPagerOptions) => Promise<number>
}

export function shouldAnimateSplash(env: NodeJS.ProcessEnv = process.env, tty = Boolean(process.stdout.isTTY)): boolean {
  if (env.SISU_TUI_STATIC === '1') return false
  return tty
}

function shouldUsePager(deps: Partial<TuiDeps>, env: NodeJS.ProcessEnv = process.env): boolean {
  if (deps.animate === false) return false
  if (env.SISU_TUI_STATIC === '1') return false
  return Boolean(process.stdout.isTTY)
}

export async function playMobiusIntro(
  io: LineIo,
  options: {
    columns?: number
    frames?: number
    sleep?: (ms: number) => Promise<void>
    color?: boolean
  } = {},
): Promise<void> {
  const columns = options.columns ?? process.stdout.columns ?? 80
  const frames = options.frames ?? 32
  const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)))
  const color = options.color ?? Boolean(process.stdout.isTTY)
  const rows = mobiusFrameHeight(columns)
  io.write('\x1b[?25l')
  for (let i = 0; i < frames; i += 1) {
    const phase = (i / frames) * Math.PI * 2
    const art = sisuMobiusArt(columns, phase, color)
    if (i === 0) io.write(`${art}\n`)
    else io.write(`\x1b[${rows}A${art}\n`)
    await sleep(38)
  }
  io.write('\x1b[?25h')
  io.write(`\n${sisuWordmark()}\n\n`)
}

/** Slide the half-twist around the ∞ so the single face loops. */
export async function playTreeIntro(
  io: LineIo,
  options: {
    columns?: number
    frames?: number
    sleep?: (ms: number) => Promise<void>
    color?: boolean
  } = {},
): Promise<void> {
  const columns = options.columns ?? process.stdout.columns ?? 80
  const frames = Math.max(2, options.frames ?? 36)
  const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)))
  const color = options.color ?? Boolean(process.stdout.isTTY)
  const rows = sisuSplashHeight(columns)
  io.write('\x1b[?25l')
  for (let i = 0; i < frames; i += 1) {
    const u = i / (frames - 1)
    const phase = u * Math.PI * 2
    const art = sisuSplashFrame(columns, color, phase)
    if (i === 0) io.write(`${art}\n`)
    else io.write(`\x1b[${rows}A${art}\n`)
    await sleep(42)
  }
  io.write('\x1b[?25h')
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

async function promptLogin(
  io: LineIo,
  login: (input: LoginInput) => Promise<string>,
): Promise<'ok' | 'cancelled' | 'failed'> {
  const email = (await io.question('Email: ')).trim()
  if (!email) {
    io.write('login cancelled\n')
    return 'cancelled'
  }
  const password = await (io.questionPassword ?? io.question)('Password: ')
  if (password === '\u0003') {
    io.write('login cancelled\n')
    return 'cancelled'
  }
  try {
    const loggedIn = await login({ email, password })
    io.write(`logged in as ${loggedIn}\n`)
    return 'ok'
  } catch (error) {
    io.write(`${error instanceof Error ? error.message : String(error)}\n`)
    return 'failed'
  }
}

export function tuiHelp(): string {
  return [
    '/login      sign in with the browser',
    '/status     account and quota',
    '/ls         local workspace files',
    '/history    saved cloud conversations',
    '/open <id>  continue a saved conversation',
    '/new        start a new conversation',
    '/training on|off   allow or refuse training use of new turns',
    '/help       this list',
    '/quit       leave',
    'otherwise   send a turn (billed to your SiSu account)',
  ].join('\n')
}

export async function runTui(
  io: LineIo,
  deps: Partial<TuiDeps> = {},
): Promise<number> {
  const http = deps.http ?? defaultHttp
  const status = deps.status ?? statusCommand
  const exec = deps.exec ?? execCommand
  const ls = deps.ls ?? listLocalCommand
  const history = deps.history ?? listConversationsCommand
  const openThread = deps.openThread ?? openConversationCommand
  const training = deps.training ?? setTrainingCommand
  const auth = deps.auth ?? readAuth
  const webLogin = deps.webLogin ?? webLoginCommand
  const columns = deps.columns ?? process.stdout.columns ?? 80
  const animate = deps.animate ?? shouldAnimateSplash()

  try {
  const account = auth()
  const usePager = Boolean(deps.pager || shouldUsePager(deps))
  if (!usePager) {
    if (animate) {
      await playTreeIntro(io, {
        columns,
        color: deps.color ?? true,
        sleep: deps.sleep,
      })
    } else {
      io.write(`${sisuSplash(columns, true)}\n`)
    }
  }

  const startWebLogin = async (notify: (line: string) => void): Promise<string> => {
    return webLogin({
      onStart: (info: WebLoginStart) => {
        notify(`Open ${info.verification_uri_complete}`)
        notify(`Confirm code ${info.user_code}`)
      },
    }, http)
  }

  if (usePager) {
    io.close?.()
    const transport = createFastApiTransport(http)
    return await (deps.pager ?? runPager)(stdioPagerIo(), transport, {
      columns,
      email: account?.email,
      login: startWebLogin,
      intro: animate,
      sleep: deps.sleep,
      quota: async () => formatQuota(await fetchBalance(http)),
      status: () => status(http),
      ls: () => {
        try {
          return ls()
        } catch (error) {
          return error instanceof Error ? error.message : String(error)
        }
      },
      training: (on) => training(on, http),
    })
  }

  io.write(`${await status(http)}\n`)
  if (!account) io.write('Not logged in. Type /login to sign in with your browser.\n')
  io.write(`${tuiHelp()}\n\n`)

  let newConversation = false
  while (true) {
    const raw = (await io.question('› ')).trim()
    if (!raw) continue
    if (raw === '/login') {
      try {
        const email = await startWebLogin((line) => io.write(`${line}\n`))
        io.write(`logged in as ${email}\n`)
      } catch (error) {
        io.write(`${error instanceof Error ? error.message : String(error)}\n`)
      }
      continue
    }
    if (raw === '/quit' || raw === '/exit') {
      io.write('bye\n')
      return 0
    }
    if (raw === '/help') {
      io.write(`${tuiHelp()}\n`)
      continue
    }
    if (raw === '/status') {
      io.write(`${await status(http)}\n`)
      continue
    }
    if (raw === '/ls') {
      try {
        io.write(`${ls()}\n`)
      } catch (error) {
        io.write(`${error instanceof Error ? error.message : String(error)}\n`)
      }
      continue
    }
    if (raw === '/new') {
      newConversation = true
      io.write('next turn starts a new conversation\n')
      continue
    }
    if (raw === '/history') {
      try {
        io.write(`${await history(http)}\n`)
      } catch (error) {
        io.write(`${error instanceof Error ? error.message : String(error)}\n`)
      }
      continue
    }
    if (raw.startsWith('/open ')) {
      try {
        io.write(`${openThread(raw.slice(6).trim())}\n`)
        newConversation = false
      } catch (error) {
        io.write(`${error instanceof Error ? error.message : String(error)}\n`)
      }
      continue
    }
    if (raw === '/training on' || raw === '/training off') {
      try {
        io.write(`${await training(raw.endsWith('on'), http)}\n`)
      } catch (error) {
        io.write(`${error instanceof Error ? error.message : String(error)}\n`)
      }
      continue
    }
    try {
      const result = await exec(raw, { newConversation, client: 'tui' }, http)
      newConversation = false
      io.write(`${result.text || '(empty reply)'}\n`)
    } catch (error) {
      io.write(`${error instanceof Error ? error.message : String(error)}\n`)
    }
  }
  } finally {
    io.close?.()
  }
}
