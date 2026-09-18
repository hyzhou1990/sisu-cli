#!/usr/bin/env node
/** Publish @stevezhou/sisu-pager-* from GitHub Release .br assets (CI only). */
'use strict'

const { execFileSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { NPM_PAGER_PLATFORMS, pagerAssetName, pagerPackageManifest } = require('./install-pager.js')

const version = process.argv[2] || require('../package.json').version
const assetDir = process.argv[3] || process.cwd()
const doPublish = process.argv.includes('--publish')

function publishOne(key) {
  const asset = path.join(assetDir, pagerAssetName(key))
  if (!fs.existsSync(asset)) {
    process.stdout.write(`skip ${key}: no ${pagerAssetName(key)}\n`)
    return false
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `sisu-pager-pkg-${key}-`))
  fs.copyFileSync(asset, path.join(dir, pagerAssetName(key)))
  fs.writeFileSync(path.join(dir, 'package.json'), `${JSON.stringify(pagerPackageManifest(key, version), null, 2)}\n`)
  process.stdout.write(`packed ${pagerPackageManifest(key, version).name}@${version}\n`)
  if (doPublish) {
    execFileSync('npm', ['publish', '--access', 'public'], { cwd: dir, stdio: 'inherit' })
  }
  return true
}

let published = 0
for (const key of NPM_PAGER_PLATFORMS) {
  if (publishOne(key)) published += 1
}
if (published < 1) {
  process.stderr.write('no pager platform packages to publish\n')
  process.exit(1)
}
