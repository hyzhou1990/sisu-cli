import os from 'os'
import path from 'path'

import { npmGlobalPrefix, planUpdate } from './update'

it('plans a CLI upgrade when npm latest is newer than this process', () => {
  expect(planUpdate('0.3.17', '0.3.18')).toEqual({ action: 'upgrade', from: '0.3.17', to: '0.3.18' })
  expect(planUpdate('0.3.18', '0.3.18')).toEqual({ action: 'pager', version: '0.3.18' })
  expect(planUpdate('0.3.18', null)).toEqual({ action: 'upgrade', from: '0.3.18', to: 'latest' })
})

it('resolves the npm --prefix from a unix global install layout', () => {
  expect(npmGlobalPrefix('/home/ada/.sisu/lib/node_modules/@stevezhou/sisu')).toBe('/home/ada/.sisu')
  expect(npmGlobalPrefix('/usr/local/lib/node_modules/@stevezhou/sisu')).toBe('/usr/local')
})

it('resolves the npm --prefix from a Windows global install layout', () => {
  const root = process.platform === 'win32' ? 'C:\\Users\\ada\\AppData\\Roaming\\npm' : path.join(os.tmpdir(), 'npm')
  const pkg = path.join(root, 'node_modules', '@stevezhou', 'sisu')
  expect(npmGlobalPrefix(pkg)).toBe(root)
})
