#!/usr/bin/env node
/** Keep the pager platform optionalDependencies pinned to the package version.
 *  `npm version x.y.z` bumps only `version`; the publish workflow's tests require
 *  every @stevezhou/sisu-pager-* optionalDependency to equal it. Wired as the
 *  `version` npm lifecycle script so a bump cannot forget this again.
 */
'use strict'

const fs = require('fs')
const path = require('path')

const pkgPath = path.join(__dirname, '..', 'package.json')
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
let changed = false
for (const name of Object.keys(pkg.optionalDependencies || {})) {
  if (!name.startsWith('@stevezhou/sisu-pager-')) continue
  if (pkg.optionalDependencies[name] !== pkg.version) {
    pkg.optionalDependencies[name] = pkg.version
    changed = true
  }
}
if (changed) {
  fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)
  process.stdout.write(`sisu: pager optionalDependencies -> ${pkg.version}\n`)
}
