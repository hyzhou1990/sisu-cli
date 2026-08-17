#!/usr/bin/env node
import {
  execCommand,
  listConversationsCommand,
  listLocalCommand,
  listModelsCommand,
  loginCommand,
  logoutCommand,
  openCommand,
  openConversationCommand,
  setModelCommand,
  setTrainingCommand,
  statusCommand,
  webLoginCommand,
} from './commands'
import { defaultHttp, HttpClient } from './http'
import { DEFAULT_API_BASE } from './store'
import { defaultTuiIo, runTui } from './tui'

export function helpText(): string {
  return `sisu — SiSu local client

One login. Cloud quota. Local workspace.

Install:
  npm install -g @stevezhou/sisu

Usage:
  sisu login                  open a browser (or print a URL) to sign in
  sisu login --code <grant>   paste the grant code from the approve page
  sisu login --email <email> --password <password> [--api <url>]
  sisu login --token <jwt> [--api <url>]
  sisu logout
  sisu status
  sisu open <dir> --project <project-id>
  sisu ls [--project <project-id>]
  sisu exec "<prompt>" [--project <id>] [--model <name>] [--new] [--stub]
  sisu -p "<prompt>"          headless local-agent turn (alias of exec)
  sisu models
  sisu model <name>
  sisu history
  sisu thread <conversation-id>
  sisu training --on|--off
  sisu                 Grok Build TUI (SiSu account, models, quota)
  sisu help

Auth and workspaces live in $SISU_HOME (default ~/.sisu), shared with Desktop.
`
}

function printHelp(): void {
  process.stdout.write(helpText())
}

function flag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name)
  if (index === -1) return undefined
  return args[index + 1]
}

function parseArgs(args: string[]): { flags: Record<string, string>; rest: string[]; switches: Set<string> } {
  const flags: Record<string, string> = {}
  const rest: string[] = []
  const switches = new Set<string>()
  for (let i = 0; i < args.length; i += 1) {
    const item = args[i]
    if (item === '--new' || item === '--stub' || item === '-p' || item === '--print') {
      switches.add(item.replace(/^-+/, ''))
      continue
    }
    if (item.startsWith('--')) {
      flags[item] = args[i + 1] || ''
      i += 1
      continue
    }
    rest.push(item)
  }
  return { flags, rest, switches }
}

export async function runCli(
  argv: string[],
  deps: { http?: HttpClient } = {},
): Promise<number> {
  const http = deps.http ?? defaultHttp
  const [command, ...args] = argv
  if (command === 'help' || command === '--help' || command === '-h') {
    printHelp()
    return 0
  }
  if (!command || command === 'tui') {
    return runTui(defaultTuiIo())
  }
  if (command === 'status') {
    process.stdout.write(`${await statusCommand(defaultHttp)}\n`)
    return 0
  }
  if (command === 'logout') {
    logoutCommand()
    process.stdout.write('logged out\n')
    return 0
  }
  if (command === 'login') {
    const email = flag(args, '--email') || process.env.SISU_EMAIL || ''
    const password = flag(args, '--password') || process.env.SISU_PASSWORD || ''
    const token = flag(args, '--token') || process.env.SISU_TOKEN || ''
    const grantCode = flag(args, '--code') || ''
    const apiBase = flag(args, '--api') || process.env.SISU_API_BASE || DEFAULT_API_BASE
    const loggedIn = grantCode
      ? await webLoginCommand({
        apiBase,
        grantCode,
        openBrowser: deps.http ? () => undefined : undefined,
      }, http)
      : (email && password) || token
        ? await loginCommand({ email, password, token, apiBase }, http)
        : await webLoginCommand({
          apiBase,
          openBrowser: deps.http ? () => undefined : undefined,
          onStart: (info) => {
            process.stdout.write(`Open ${info.verification_uri_complete}\n`)
            process.stdout.write(`Confirm code ${info.user_code} (or paste --code from the page)\n`)
          },
        }, http)
    process.stdout.write(`logged in as ${loggedIn}\n`)
    process.stdout.write(`${await statusCommand(http)}\n`)
    return 0
  }
  if (command === 'open') {
    const dir = args.find((item) => !item.startsWith('--')) || '.'
    const projectId = flag(args, '--project') || ''
    if (!projectId) {
      process.stderr.write('sisu open requires --project <project-id>\n')
      return 2
    }
    process.stdout.write(`${openCommand(projectId, dir)}\n`)
    return 0
  }
  if (command === 'ls') {
    process.stdout.write(`${listLocalCommand(flag(args, '--project'))}\n`)
    return 0
  }
  if (command === 'exec' || command === '-p' || command === '--print') {
    const parsed = parseArgs(args)
    const prompt = parsed.rest.join(' ').trim()
    if (!prompt) {
      process.stderr.write('sisu exec requires a prompt\n')
      return 2
    }
    const result = await execCommand(prompt, {
      projectId: parsed.flags['--project'],
      model: parsed.flags['--model'],
      newConversation: parsed.switches.has('new'),
      stub: parsed.switches.has('stub') || process.env.SISU_RUNTIME_STUB === '1',
    })
    if (result.text) process.stdout.write(`${result.text}\n`)
    return 0
  }
  if (command === 'history') {
    process.stdout.write(`${await listConversationsCommand(defaultHttp)}\n`)
    return 0
  }
  if (command === 'thread') {
    const id = args.find((item) => !item.startsWith('--')) || ''
    process.stdout.write(`${openConversationCommand(id)}\n`)
    return 0
  }
  if (command === 'models') {
    process.stdout.write(`${await listModelsCommand(http)}\n`)
    return 0
  }
  if (command === 'model') {
    const name = args.find((item) => !item.startsWith('--')) || ''
    process.stdout.write(`${await setModelCommand(name, http)}\n`)
    return 0
  }
  if (command === 'training') {
    if (args.includes('--on')) {
      process.stdout.write(`${await setTrainingCommand(true)}\n`)
      return 0
    }
    if (args.includes('--off')) {
      process.stdout.write(`${await setTrainingCommand(false)}\n`)
      return 0
    }
    process.stderr.write('sisu training requires --on or --off\n')
    return 2
  }
  process.stderr.write(`unknown command: ${command}\n`)
  printHelp()
  return 2
}

if (require.main === module) {
  runCli(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
      process.exit(1)
    },
  )
}
