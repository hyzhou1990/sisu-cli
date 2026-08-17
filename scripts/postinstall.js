#!/usr/bin/env node
/** Best-effort: fetch the grok-build pager like @xai-official/grok postinstall.
 *  Never fail `npm install` — Node TUI still works without the binary.
 */
const { installPager } = require('./install-pager')

installPager().then(
  (result) => {
    if (result.ok && !result.skipped) {
      process.stdout.write(`sisu: grok pager -> ${result.dest}\n`)
    } else if (!result.ok && result.reason) {
      process.stdout.write(`sisu: ${result.reason} (Node TUI still works)\n`)
    }
  },
  (error) => {
    process.stdout.write(`sisu: pager download skipped (${error instanceof Error ? error.message : String(error)})\n`)
  },
)
