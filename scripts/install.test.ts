import { execFileSync, spawnSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'

const root = path.join(__dirname, '..')
const installSh = path.join(root, 'scripts', 'install.sh')
const installPs1 = path.join(root, 'scripts', 'install.ps1')
const installCmd = path.join(root, 'scripts', 'install.cmd')

function writeExec(file: string, body: string) {
  fs.writeFileSync(file, body)
  fs.chmodSync(file, 0o755)
}

it('ships curl and PowerShell installers that never apt/brew/choco a system Node', () => {
  expect(fs.existsSync(installSh)).toBe(true)
  expect(fs.existsSync(installPs1)).toBe(true)
  expect(fs.existsSync(installCmd)).toBe(true)
  const sh = fs.readFileSync(installSh, 'utf8')
  const ps1 = fs.readFileSync(installPs1, 'utf8')
  const cmd = fs.readFileSync(installCmd, 'utf8')
  expect(sh.startsWith('#!/')).toBe(true)
  expect(sh).toMatch(/nodejs\.org\/dist/)
  expect(sh).toMatch(/--prefix/)
  expect(sh).toMatch(/@stevezhou\/sisu/)
  expect(sh).toMatch(/npm_config_scripts_prepend_node_path/)
  expect(sh).toMatch(/downloading Node/)
  expect(sh).toMatch(/verifying Node checksum/)
  expect(sh).toMatch(/extracting Node/)
  expect(sh).toMatch(/installing package/)
  expect(sh).toMatch(/curl -fL -#/)
  expect(sh).not.toMatch(/\[ -t 2 \]/)
  expect(sh).toMatch(/\/opt\/homebrew\/bin/)
  expect(sh).toMatch(/this shell: export PATH=/)
  expect(sh).toMatch(/\$\{SISU_HOME\}\/node\/bin:\$\{PATH\}/)
  expect(sh).toMatch(/link_bin "\$\{SISU_HOME\}\/node\/bin\/npm" npm/)
  expect(sh).toMatch(/link_bin "\$\{SISU_HOME\}\/node\/bin\/npm" nmp/)
  expect(sh).toMatch(/\$\{HOME\}\/\.local\/bin/)
  expect(sh).not.toMatch(/apt-get |apt install |dnf install |yum install |brew install |choco install|winget install/)
  expect(ps1).toMatch(/nodejs\.org\/dist/)
  expect(ps1).toMatch(/@stevezhou\/sisu/)
  expect(ps1).toMatch(/UseBasicParsing/)
  expect(ps1).toMatch(/Use-SisuNodeOnPath/)
  expect(ps1).toMatch(/downloading Node/)
  expect(ps1).toMatch(/verifying Node checksum/)
  expect(ps1).toMatch(/extracting Node/)
  expect(ps1).toMatch(/installing package/)
  expect(ps1).toMatch(/curl\.exe/)
  expect(ps1).toMatch(/-#/)
  expect(ps1).toMatch(/next: \$sisuCmd login/)
  expect(ps1).toMatch(/npm_config_scripts_prepend_node_path/)
  expect(ps1).toMatch(/node\.exe/)
  expect(ps1.indexOf('Use-SisuNodeOnPath')).toBeLessThan(ps1.indexOf('install -g'))
  expect(ps1).toMatch(/\$ps1Shim\s*=\s*Join-Path \$SisuHome 'sisu\.ps1'/)
  expect(ps1).toMatch(/if \(Test-Path \$ps1Shim\)\s*\{/)
  expect(ps1).toMatch(/Remove-Item -Force -ErrorAction Stop \$ps1Shim/)
  expect(ps1.indexOf('Remove-Item -Force -ErrorAction Stop $ps1Shim')).toBeGreaterThan(ps1.indexOf('install -g'))
  expect(ps1).not.toMatch(/winget install|choco install|scoop install/)
  expect(cmd).toMatch(/install\.ps1/)
})

it('uses an existing Node 20+ and does not download a runtime', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sisu-install-node-'))
  const bindir = path.join(home, 'bin')
  const sisuHome = path.join(home, '.sisu')
  const npmLog = path.join(home, 'npm.log')
  fs.mkdirSync(bindir, { recursive: true })
  writeExec(
    path.join(bindir, 'node'),
    '#!/bin/sh\n[ "$1" = "-p" ] && echo 22 && exit 0\necho v22.23.2\n',
  )
  writeExec(
    path.join(bindir, 'npm'),
    `#!/bin/sh\nprintf '%s\\n' "$@" > "${npmLog}"\nmkdir -p "${sisuHome}/bin"\nprintf '#!/bin/sh\\necho sisu\\n' > "${sisuHome}/bin/sisu"\nchmod +x "${sisuHome}/bin/sisu"\n`,
  )
  writeExec(
    path.join(bindir, 'curl'),
    '#!/bin/sh\necho curl-should-not-run >&2\nexit 1\n',
  )
  try {
    execFileSync('bash', [installSh], {
      encoding: 'utf8',
      env: {
        HOME: home,
        PATH: `${bindir}${path.delimiter}/usr/bin:/bin`,
        SISU_HOME: sisuHome,
        SISU_NPM_PACKAGE: '@stevezhou/sisu',
      },
    })
    const logged = fs.readFileSync(npmLog, 'utf8')
    expect(logged).toMatch(/install/)
    expect(logged).toMatch(/--prefix/)
    expect(logged).toContain('@stevezhou/sisu')
    expect(fs.existsSync(path.join(home, '.local', 'bin', 'sisu'))).toBe(true)
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})

it('never relinks a live sisu that already resolves to the same file', () => {
  // A previous odd state left ~/.sisu/bin/sisu pointing at the live PATH link
  // while the live link points at the real binary. Relinking the live entry
  // to ~/.sisu/bin/sisu would close a self-referential loop and kill `sisu`.
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sisu-install-loop-'))
  const bindir = path.join(home, 'bin')
  const live = path.join(home, 'live')
  const sisuHome = path.join(home, '.sisu')
  const npmLog = path.join(home, 'npm.log')
  const realSisu = path.join(home, 'real-sisu')
  fs.mkdirSync(bindir, { recursive: true })
  fs.mkdirSync(live, { recursive: true })
  writeExec(realSisu, '#!/bin/sh\necho sisu\n')
  fs.symlinkSync(realSisu, path.join(live, 'sisu'))
  writeExec(
    path.join(bindir, 'node'),
    '#!/bin/sh\n[ "$1" = "-p" ] && echo 22 && exit 0\necho v22.23.2\n',
  )
  writeExec(
    path.join(bindir, 'npm'),
    `#!/bin/sh\nprintf '%s\\n' "$@" > "${npmLog}"\nmkdir -p "${sisuHome}/bin"\nln -sfn "${live}/sisu" "${sisuHome}/bin/sisu"\n`,
  )
  writeExec(
    path.join(bindir, 'curl'),
    '#!/bin/sh\necho curl-should-not-run >&2\nexit 1\n',
  )
  try {
    execFileSync('bash', [installSh], {
      encoding: 'utf8',
      env: {
        HOME: home,
        PATH: `${live}${path.delimiter}${bindir}${path.delimiter}/usr/bin:/bin`,
        SISU_HOME: sisuHome,
        SISU_NPM_PACKAGE: '@stevezhou/sisu',
      },
    })
    expect(fs.readlinkSync(path.join(live, 'sisu'))).toBe(realSisu)
    expect(fs.realpathSync(path.join(live, 'sisu'))).toBe(fs.realpathSync(realSisu))
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})

it('prints package install stages when Node 20+ is already on PATH', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sisu-install-progress-'))
  const bindir = path.join(home, 'bin')
  const sisuHome = path.join(home, '.sisu')
  const npmLog = path.join(home, 'npm.log')
  fs.mkdirSync(bindir, { recursive: true })
  writeExec(
    path.join(bindir, 'node'),
    '#!/bin/sh\n[ "$1" = "-p" ] && echo 22 && exit 0\necho v22.23.2\n',
  )
  writeExec(
    path.join(bindir, 'npm'),
    `#!/bin/sh\nprintf '%s\\n' "$@" > "${npmLog}"\nmkdir -p "${sisuHome}/bin"\nprintf '#!/bin/sh\\necho sisu\\n' > "${sisuHome}/bin/sisu"\nchmod +x "${sisuHome}/bin/sisu"\n`,
  )
  writeExec(
    path.join(bindir, 'curl'),
    '#!/bin/sh\necho curl-should-not-run >&2\nexit 1\n',
  )
  try {
    const result = spawnSync('bash', [installSh], {
      encoding: 'utf8',
      env: {
        HOME: home,
        PATH: `${bindir}${path.delimiter}/usr/bin:/bin`,
        SISU_HOME: sisuHome,
        SISU_NPM_PACKAGE: '@stevezhou/sisu',
      },
    })
    expect(result.status).toBe(0)
    expect(result.stderr).toMatch(/sisu: installing @stevezhou\/sisu into /)
    expect(result.stderr).toMatch(/sisu: installing package/)
    expect(result.stderr).toMatch(/sisu: npm -> /)
    expect(result.stderr).toMatch(/sisu login/)
    expect(result.stderr).not.toMatch(/downloading Node/)
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})

it('downloads a user-local Node into ~/.sisu/node when node is missing', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sisu-install-bootstrap-'))
  const bindir = path.join(home, 'bin')
  const sisuHome = path.join(home, '.sisu')
  const npmLog = path.join(home, 'npm.log')
  const downloads = path.join(home, 'downloads')
  fs.mkdirSync(bindir, { recursive: true })
  fs.mkdirSync(downloads, { recursive: true })
  const unameS = execFileSync('uname', ['-s'], { encoding: 'utf8' }).trim()
  const unameM = execFileSync('uname', ['-m'], { encoding: 'utf8' }).trim()
  const osKey = unameS === 'Darwin' ? 'darwin' : 'linux'
  const archKey = unameM === 'arm64' || unameM === 'aarch64' ? 'arm64' : 'x64'
  const platform = `${osKey}-${archKey}`
  const version = '22.23.2'
  const folder = `node-v${version}-${platform}`
  const staging = path.join(home, 'node-src', folder)
  fs.mkdirSync(path.join(staging, 'bin'), { recursive: true })
  writeExec(path.join(staging, 'bin', 'node'), '#!/bin/sh\necho v22.23.2\n')
  writeExec(
    path.join(staging, 'bin', 'npm'),
    `#!/bin/sh\nprintf '%s\\n' "$@" > "${npmLog}"\nmkdir -p "${sisuHome}/bin"\nprintf '#!/bin/sh\\necho sisu\\n' > "${sisuHome}/bin/sisu"\nchmod +x "${sisuHome}/bin/sisu"\n`,
  )
  const tarball = path.join(downloads, `${folder}.tar.gz`)
  execFileSync('tar', ['-czf', tarball, folder], { cwd: path.join(home, 'node-src') })
  const digest = execFileSync('shasum', ['-a', '256', tarball], { encoding: 'utf8' }).split(' ')[0]
  fs.writeFileSync(path.join(downloads, 'SHASUMS256.txt'), `${digest}  ${folder}.tar.gz\n`)
  writeExec(
    path.join(bindir, 'curl'),
    `#!/bin/sh
out=""
url=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift 2 ;;
    -fsSL|-f|-s|-S|-L|--progress-bar|-#) shift ;;
    *) url="$1"; shift ;;
  esac
done
base=$(basename "$url")
src="${downloads}/$base"
if [ -z "$out" ]; then cat "$src"; exit 0; fi
cp "$src" "$out"
`,
  )
  writeExec(path.join(bindir, 'shasum'), '#!/bin/sh\nexec /usr/bin/shasum "$@"\n')
  writeExec(path.join(bindir, 'tar'), '#!/bin/sh\nexec /usr/bin/tar "$@"\n')
  writeExec(path.join(bindir, 'uname'), '#!/bin/sh\nexec /usr/bin/uname "$@"\n')
  writeExec(path.join(bindir, 'mktemp'), '#!/bin/sh\nexec /usr/bin/mktemp "$@"\n')
  try {
    execFileSync('bash', [installSh], {
      encoding: 'utf8',
      env: {
        HOME: home,
        PATH: `${bindir}${path.delimiter}/usr/bin:/bin`,
        SISU_HOME: sisuHome,
        SISU_NODE_VERSION: version,
        SISU_NODE_DIST: 'https://nodejs.org/dist',
      },
    })
    expect(fs.existsSync(path.join(sisuHome, 'node', 'bin', 'node'))).toBe(true)
    expect(fs.readFileSync(npmLog, 'utf8')).toContain('@stevezhou/sisu')
    expect(fs.existsSync(path.join(home, '.local', 'bin', 'sisu'))).toBe(true)
    expect(fs.existsSync(path.join(home, '.local', 'bin', 'npm'))).toBe(true)
    expect(fs.existsSync(path.join(home, '.local', 'bin', 'nmp'))).toBe(true)
    expect(fs.realpathSync(path.join(home, '.local', 'bin', 'nmp'))).toBe(
      fs.realpathSync(path.join(sisuHome, 'node', 'bin', 'npm')),
    )
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})
