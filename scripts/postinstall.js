#!/usr/bin/env node
/** Install the stamped TUI pager from the npm platform package (or registry tarball).
 *  Missing pager is a failed install — not a silent Node TUI fallback.
 */
const { installPager } = require('./install-pager')
const { installCliPath } = require('./ensure-cli-path')

try {
  installCliPath()
} catch (error) {
  process.stdout.write(`sisu: path setup skipped (${error instanceof Error ? error.message : String(error)})\n`)
}

installPager().then(
  (result) => {
    if (result.ok) {
      if (!result.skipped) process.stdout.write(`sisu: pager -> ${result.dest}\n`)
      else if (result.reason) process.stdout.write(`sisu: ${result.reason}\n`)
      process.exit(0)
    }
    process.stderr.write(`sisu: ${result.reason || 'pager install failed'}\n`)
    process.stderr.write('sisu: native TUI is required; re-run npm install -g @stevezhou/sisu\n')
    process.exit(1)
  },
  (error) => {
    process.stderr.write(`sisu: pager install failed (${error instanceof Error ? error.message : String(error)})\n`)
    process.exit(1)
  },
)
