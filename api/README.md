# Paid one-pager API

Send a document and the hash of a DigiByte payment; get back a one-pager whose picture our own image model drew from the document. **No account, no API key: the transaction is the ticket**, and it is used up once its one-pager is made.

Base URL: `https://api.typographics-art.org`

## 1. Pay

Send at least **10 DGB** to the address of the public service (a self-hosted instance sets its own with `RECEIVE_ADDRESS`):

```
DT6eHuhe5Bvh2yKnVvt6EFLjURK7vad1CC
```

and wait for **2 confirmations** (about 30 seconds). `GET /` returns the current address, price and confirmations.

## 2. Send the document

```sh
curl -X POST https://api.typographics-art.org/v1/onepage?title=Grundgesetz \
  -H "Content-Type: application/pdf" \
  -H "X-DGB-Tx: <transaction hash>" \
  --data-binary @document.pdf
```

Plain text (`text/plain`) and Markdown (`text/markdown`) work too; up to 20 MB.

| Answer | Meaning |
|---|---|
| `202` `{ job, token, status_url }` | paid and queued; keep the token, it is the only way to fetch the result |
| `400` `missing_or_invalid_tx` | no transaction hash (64 hex characters) |
| `402` `tx_not_found` | our node does not know the transaction yet: wait a minute |
| `402` `not_confirmed` / `amount_too_low` / `no_output_to_address` | the payment is not (yet) enough; the answer says what was paid and what is needed |
| `409` `tx_already_used` | this transaction already paid for a one-pager (the answer says nothing about that job) |
| `503` `payment_check_unavailable` | our node cannot be reached; the transaction is not used |

## 3. Fetch the one-pager

```sh
curl -o onepage.pdf "https://api.typographics-art.org/v1/jobs/<job>?token=<token>&wait=60"
```

`202` while it runs (the image takes about a minute, the layout up to another), `200` with the PDF when done. If a job fails **before** the picture is made (an outage on our side), the transaction is **released** and can be sent again, up to three times. Once the picture is made, the payment is used even if a later step fails.

Transaction hashes are public on the chain, so the job and its PDF are only reachable with the token from the `202` answer.

## What happens

1. The payment is checked on our own DigiByte node (`getrawtransaction`): outputs to the address above add up to at least 10 DGB, with at least 2 confirmations.
2. The transaction hash is reserved atomically, so the same payment cannot start two jobs.
3. Our language model writes an image prompt from the title and the opening of the document; our image model (Qwen-Image) draws the picture.
4. The whole text is set on one A4 page with that picture as motif and read back with MuPDF: the PDF holds every character of the document.
5. The hash is burned, and the image is booked in the service's own ledger (append-only), separately from any account.

Code: `api/server.mjs` (HTTP and queue), `api/dgb.mjs` (payment check), `api/store.mjs` (SQLite: payments, jobs, ledger), `api/config.mjs` (settings), `api/pipeline.mjs` (prompt, image, one-pager). Tests: `test/api.test.js` and `test/api-server.test.js` (over HTTP against a fake node).

## Answers

| Status | Meaning |
|---|---|
| `202` | Accepted (or still running). Keep the `token`. |
| `200` | The PDF. |
| `400` / `415` | No or malformed hash / unsupported type (send `application/pdf`, `text/plain` or `text/markdown`). |
| `402` | Payment not sufficient (the answer says why: `tx_not_found`, `no_output_to_address`, `amount_too_low`, `not_confirmed`). |
| `409` | This transaction is already used. |
| `410` | The result was removed (results are kept 7 days). |
| `413` | Upload too large (default 20 MB). |
| `429` | Too many payment checks from one address; wait a minute. |
| `500` | The job failed. The answer says whether the transaction was released (`transaction_released`): before the picture was made it is, afterwards it is not. A refused document (`document_refused`: no text, or longer than `MAX_CHARACTERS`) is released too. |

The payment is checked, and the node asked, before the document is read: an unpaid request cannot make the service buffer a large upload.

## Known limits

- **A public transaction can be claimed by whoever submits its hash first.** The hash identifies the payment, not the payer. Someone who watches the address could send a payer's hash before the payer does; the payer would then get `409`. The ticket model accepts this today: price and typical flow make it a nuisance rather than a gain, and a fix (a per-order amount or address) changes the protocol. If it matters for your deployment, bind each payment to an order.
- **Rate limiting is basic.** Payment checks are limited per client address and for everybody together, in memory, with a fixed-size table. Behind a proxy every connection comes from the proxy, so set `TRUST_PROXY=1` only if the proxy overwrites `cf-connecting-ip` / `x-forwarded-for` (a client can send those itself); without it the limit uses the connection's own address. Put real rate limiting at the proxy as well.
- One job runs at a time. A job that exceeds `JOB_TIMEOUT_MINUTES` is failed and its browser is shut down; the service goes on. Documents above `MAX_CHARACTERS` (default 700 000) or without text are refused before any model or browser work is spent, and the transaction is released (`document_refused`).

## Configuration

All settings are environment variables. The first four have no default on purpose; the service refuses to start without them, and refuses numbers that are not valid (a typo must not switch the payment check off).

| Variable | Required | Meaning |
|---|---|---|
| `RECEIVE_ADDRESS` | yes | The DigiByte address that payments go to. Use one whose key you hold. |
| `DGB_RPC_URL` | yes | A DigiByte node with `txindex=1` (payments are checked with `getrawtransaction`, no wallet needed). |
| `LLM_URL` | yes | OpenAI-compatible chat endpoint that writes the image prompt. |
| `IMAGE_URL` | yes | Image endpoint that draws the picture. |
| `DGB_RPC_USER`, `DGB_RPC_PASS` | if the node needs them | RPC credentials. |
| `LLM_API_KEY`, `LLM_MODEL`, `IMAGE_MODEL` | no | Credentials and model names for the two endpoints. |
| `MIN_DGB`, `MIN_CONFIRMATIONS` | no | Price (number above 0, default 10) and confirmations (integer from 0, default 2). |
| `MAX_UPLOAD_MB` | no | Upload limit (default 20). |
| `JOB_TIMEOUT_MINUTES` | no | A job running longer ends the process (default 20). |
| `KEEP_RESULTS_DAYS` | no | How long finished results stay downloadable (default 7). |
| `PAYMENT_CHECKS_PER_MINUTE`, `PAYMENT_CHECKS_PER_MINUTE_ALL` | no | Payment checks per client address and minute (30) and for everybody together (300). |
| `TRUST_PROXY` | no | `1` if a proxy that overwrites `cf-connecting-ip` / `x-forwarded-for` sits in front; default off. |
| `MAX_CHARACTERS` | no | Longest document accepted (default 700 000 characters; the EU AI Act, 596 000, fits). |
| `DATA_DIR`, `PORT` | no | Directory with the SQLite ledger and jobs (`/data`), port (8080). |

Needs **Node 22.5 or newer** (`node:sqlite`) and, for the one-pager, Chromium, MuPDF (`mutool`) and `qpdf` (the Docker image has them). Build the image from the repository root with `docker build -f api/Dockerfile -t typographics-api .`.
