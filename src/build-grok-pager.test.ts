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

it('builds linux-x64 pager on Ubuntu 20.04 glibc so AutoDL/old distros can run it', () => {
  expect(workflow).toMatch(/platform: linux-x64/)
  expect(workflow).toMatch(/container: ubuntu:20\.04/)
  expect(workflow).toMatch(/ubuntu:20\.04 container `sh` is dash/)
  expect(workflow).toMatch(/defaults:\s+run:\s+shell: bash/s)
  expect(workflow).toMatch(/protoc-\$\{ver\}-linux-x86_64\.zip/)
  expect(workflow).toMatch(/Do not apt protobuf-compiler here/)
  expect(workflow).toMatch(/old-releases\.ubuntu\.com/)
  expect(workflow).toMatch(/gcc bug 95189/)
  expect(workflow).toMatch(/apt_install gcc-10 g\+\+-10/)
  expect(workflow).toMatch(/export CC=gcc-10 CXX=g\+\+-10/)
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
  expect(publish).toMatch(/xai-grok-pager-linux-x64\.br/)
})
