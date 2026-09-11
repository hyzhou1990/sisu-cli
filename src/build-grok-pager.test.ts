import fs from 'fs'
import path from 'path'

const script = fs.readFileSync(path.join(__dirname, '../scripts/build-grok-pager.sh'), 'utf8')
const workflow = fs.readFileSync(path.join(__dirname, '../.github/workflows/pager-release.yml'), 'utf8')
const publish = fs.readFileSync(path.join(__dirname, '../.github/workflows/publish.yml'), 'utf8')

it('builds and packages a win32-x64 pager exe', () => {
  expect(script.startsWith('#!/bin/sh')).toBe(true)
  expect(script).toMatch(/win32-x64/)
  expect(script).toMatch(/mingw\*|msys\*|cygwin\*|windows_nt\*/)
  expect(script).toMatch(/BIN_EXT="\.exe"/)
  expect(script).toMatch(/xai-grok-pager\$\{BIN_EXT\}/)
  expect(script).toMatch(/rm -f "\$ROOT\/vendor\/grok-build\/bin\/protoc"/)
  expect(script).toMatch(/SiSu win32-x64: skip emit_rerun_if_changed/)
  expect(script).toMatch(/cygpath -w/)
  expect(script).toMatch(/require\('\.\/package\.json'\)/)
  expect(script).not.toMatch(/require\('\$\{ROOT\}\/package\.json'\)/)
})

it('tag pager-release includes a native windows-latest win32-x64 job', () => {
  expect(workflow).toMatch(/build-pager-win32/)
  expect(workflow).toMatch(/runs-on: windows-latest/)
  expect(workflow).toMatch(/contains\(github\.event\.inputs\.platforms, 'win32-x64'\)/)
  expect(workflow).toMatch(/shell: bash/)
  expect(workflow).toMatch(/choco install protoc/)
  expect(workflow).toMatch(/core\.autocrlf false/)
  expect(publish).toMatch(/xai-grok-pager-win32-x64\.br/)
  expect(publish).toMatch(/xai-grok-pager-darwin-arm64\.br/)
})
