# Before I Tell — codename relay

The one server in this project. It carries Level 2: a student writes to an adult
at their school under a codename, that adult replies, and the reply comes back to
the codename. Neither side learns who the other is.

Levels 1 and 3 do not touch this service and still make zero external requests.

---

## Why it is built this way

Three rules do most of the work. Each exists because the obvious version of this
feature is dangerous:

1. **School addresses only** (`schools.js`). A relay that will email *any* address
   is an anonymous remailer — a harassment tool wearing a mental-health costume.
   Freemail domains are hard-denied; recipients must match a known school board or
   an educational pattern.
2. **Crisis content is never relayed** (`safety.js`). If a message says the student
   is unsafe right now, it is not sent. An unread email is the worst possible
   answer to an emergency: an adult who learns a child is in danger and has no way
   to reach them. That student is routed to Kids Help Phone and 9-8-8 instead.
   The site checks before sending and the server checks again, because the client
   is not a security boundary.
3. **Every first email carries a block link.** Nobody is opted in to receiving
   messages from a service they have never heard of. The link is a GET that only
   *offers* a confirm button; the block happens on POST — because M365 Safe Links,
   Proofpoint and Mimecast (which the Ontario boards run) fetch every URL in an
   inbound email, and a state-changing GET would silently blocklist a real
   counsellor before they ever read the message.

4. **Inbound replies are authenticated.** The thread tag is in the `Reply-To`, so
   anyone the counsellor forwards the email to holds it — the tag alone is not
   proof of identity. A reply is only filed if its `From:` matches the address
   this thread writes to, and auto-replies / bounces / out-of-office messages are
   dropped rather than shown to a child as their counsellor's answer.

Plus: passphrase-gated reads (scrypt-hashed), per-IP and per-recipient rate limits,
and no name, email, IP or device identifier **belonging to the student** is ever
persisted — rate-limit keys are salted hashes held in memory and die with the
process. What *is* stored, because delivery is impossible without it: the
**counsellor's** school address on the thread, and any address on the block
list. Both are adults' work addresses, never the student's.

---

## Run it locally (no credentials needed)

```bash
node server.js
```

Defaults to **dry mode**: nothing is sent. Outgoing mail is written to `outbox/*.eml`
so you can read exactly what a counsellor would receive. To simulate a reply, drop a
file in `inbox-drop/`:

```
To: relay+bit<THREAD_TAG>@localhost
From: <THE THREAD'S OWN RECIPIENT>

Come by my office any time this week.
```

The tag is in the `.eml` you just generated. The poller picks it up within 20s.

**The `From:` line is required, and must be the exact address the thread writes
to.** A reply is only filed if it genuinely came from that adult — anyone the
counsellor forwards our email to also holds the tag, so the tag alone is not
proof of identity. Without a matching `From:`, the drop file is rejected as an
impostor and renamed `.done`, which looks like the reply silently vanishing.

Run the test suites (no network, no install):

```bash
npm test
```

Three suites, and the last two exist to protect the durability work: `relay`
(the API and reply routing), `degraded` (a failed boot read disables writes,
and /send, /thread and the poller all refuse rather than pretend), and
`writefail` (writes failing *after* a good boot — the state a free-plan
database actually ends in). Each runs in its own process, because the storage
backend is chosen once at import.

---

## Go live with Gmail

1. On the Gmail account you want to send from, turn on **2-Step Verification**.
2. Google Account → Security → 2-Step Verification → **App passwords**. Create one.
   (Your normal password will not work for SMTP.)
3. `cp .env.example .env` and fill in `BIT_GMAIL_USER` and `BIT_GMAIL_APP_PASSWORD`.
4. Set `BIT_RELAY_MODE=live`.
5. `npm install` (nodemailer + imapflow), then `node server.js`.

**How replies find their way home.** Every outgoing message sets
`Reply-To: you+bit<tag>@gmail.com`. Gmail delivers plus-addressed mail to the same
inbox, so one free account carries every conversation, and the tag in the envelope
tells the poller which thread a reply belongs to. No database lookup by human
identity, ever.

Gmail allows roughly 500 messages/day — far beyond what this needs.

---

## Deploy

`render.yaml` at the **repo root** (Blueprint discovery requires it there; it
points at this folder via `rootDir: relay`) is a ready Render blueprint. Push,
then **New → Blueprint** on render.com, and set the `sync: false` values in the
dashboard: `BIT_BREVO_API_KEY`, the Gmail pair (use a dedicated relay account,
never a personal one — counsellors see the sender address), `BIT_PUBLIC_URL`
(the service's own onrender.com URL) and `BIT_ALLOW_ORIGIN`
(`https://goofturtles.github.io`).

⚠️ **`BIT_BREVO_API_KEY` is required on the free plan.** Render blocks outbound
SMTP, so the Gmail transport cannot connect (it times out against
`smtp.gmail.com:465`) — this is why Level 2 appeared to work while never
actually delivering anything. Brevo's transactional API sends over HTTPS
instead, and `mailer.js` prefers it whenever the key is set. The Gmail
credentials are still needed: replies are read by **IMAP** polling, which is
not blocked. Confirm which transport is live at `/health` → `"transport"`
(`"brevo"`, `"smtp"`, or `"none"` — `none` means every send will fail).

⚠️ **Durability — set `DATABASE_URL`.** The free plan's filesystem is ephemeral
and cannot take a disk, so *without* a database every redeploy and every
spin-down erases every conversation, and a reply arriving for a lost thread is
dropped. That is not hypothetical: it is why counsellor replies never showed up
during testing.

Attach a Render Postgres instance and link its `DATABASE_URL`, and `store.js`
persists there instead. Confirm which mode is actually live at `/health`:

```json
{ "durable": true, "loaded": true, "lastWriteOk": true }
```

`durable:false` means conversations are being lost again. `loaded:false` means
the boot read failed — the relay then *refuses to write*, deliberately, because
a write from an empty in-memory state would overwrite every stored conversation
with nothing.

⚠️ Render's **free Postgres expires 30 days after creation** (this one:
**2026-10-04**) and is then deleted. Upgrade it or create and relink a
replacement before that date, or the relay quietly falls back to losing
conversations.

Then point the website at it: put the deployed origin in `PROD_RELAY` in
`../js/config.js`. Leave it empty and Level 2 degrades to a clearly-labelled preview
rather than breaking.

---

## Demo recipients & staying warm

- `BIT_DEMO_RECIPIENTS` — comma-separated EXACT addresses (never domains) the
  gate will accept in addition to school accounts. For filming the full
  send→reply loop against an inbox the operator controls, and for boards whose
  mail gateways block all outside senders. Empty by default; set it in the
  Render dashboard. It deliberately cannot widen the gate beyond the listed
  addresses.
- `.github/workflows/keepalive.yml` pings `/health` every 10 minutes so the
  free-tier instance never spins down (cold starts made every first send after
  a quiet spell take up to a minute). Delete the workflow after judging if the
  workspace's free instance-hours matter.

## API

| Method | Path      | Body                                  | Notes |
|--------|-----------|---------------------------------------|-------|
| POST   | `/send`   | `{to, message}` or `{tag, pass, message}` | First call creates the thread and returns `pass` **once** |
| POST   | `/thread` | `{codename, pass}` or `{tag, pass}`   | Passphrase never travels in a URL |
| GET    | `/block`  | `?tag=…`                              | Shows a confirm button. Safe — mutates nothing |
| POST   | `/block`  | `tag=…` (form or JSON)                | Performs the permanent opt-out |
| GET    | `/health` | —                                     | Liveness + mode |

Refusal reasons a client should handle: `personal`, `unknown`, `malformed`,
`blocked`, `crisis`, `rate`, `rate_recipient`, `too_long`, `empty`, `auth`,
`delivery`, `offline`, `timeout`, `capacity`, `storage`.

`storage` is returned by both `/send` and `/thread`; `capacity` only by
`/send`. Their copy deliberately ends mid-sentence so the client can append the
crisis line for the reader's own region — render them through `refusalNote()`,
never as bare text, or the sentence dangles and the helpline link disappears.
The client detects that structurally (no terminal punctuation), so a new
open-ended refusal needs no list updating.

`storage` covers **two** different failures, and the distinction matters —
assuming only the first is what let the poller destroy replies:

1. **The boot read failed** (`degraded()`): writes are disabled for the whole
   process, `/send` and `/thread` refuse, and the poller collects nothing.
2. **Writes are failing after a good boot** — the state a free-plan database
   actually ends in. `degraded()` is false and cannot see it, so every write
   path must confirm its own write landed: `/send` and `POST /block` await
   `settled()` before promising anything, and `record()` returns
   `"unpersisted"` so the reply is left in the mailbox instead of consumed.

In both cases nothing was sent, nothing was lost, and no passphrase was issued.

---

## Honest limits

- Pattern-based crisis detection is not a model. Misses are possible. That is why
  both tiers surface human help and why the copy never promises detection.
- The school-domain list is Ontario-centric and incomplete. An unrecognised board
  sends the student to Level 3 rather than guessing.
- Deliverability is Gmail's. A school spam filter can still quarantine a message
  from an unfamiliar sender; that is a real limitation of any small relay.
- Once an email is in someone's inbox, it is theirs. The site says so plainly.
