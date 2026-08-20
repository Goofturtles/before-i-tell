/* env.js — load .env into process.env.

   THIS MUST BE THE FIRST IMPORT IN server.js.

   ESM hoists import declarations and fully evaluates each dependency before
   ANY statement in the importing module runs. mailer.js, inbox.js and store.js
   all read process.env at module scope, so a loader written as inline code in
   server.js would run too late: `cp .env.example .env` + BIT_RELAY_MODE=live
   would leave the service silently in dry mode — mail piling up in outbox/,
   no IMAP polling, nobody emailed, and no error to explain it.

   Putting the loader in its own module and importing it first is what makes
   the ordering guaranteed rather than accidental.

   Real env vars always win: hosts like Render inject them directly and there
   is no .env file there at all. */

import { readFileSync, existsSync } from "node:fs";

const FILE = process.env.BIT_ENV_FILE || ".env";

if (existsSync(FILE)) {
  for (const line of readFileSync(FILE, "utf8").split(/\r?\n/)) {
    if (/^\s*(#|$)/.test(line)) continue;
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    const value = m[2].trim().replace(/^(['"])([\s\S]*)\1$/, "$2");
    if (!(m[1] in process.env)) process.env[m[1]] = value;
  }
}
