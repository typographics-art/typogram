# Paid one-pager API

Send a document and the hash of a DigiByte payment; get back a one-pager whose picture our own image model drew from the document. **No account, no API key: the transaction is the ticket**, and it is used up once its one-pager is made.

Base URL: `https://api.typographics-art.org`

## 1. Pay

Send at least **10 DGB** to

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

Code: `api/server.mjs` (HTTP and queue), `api/dgb.mjs` (payment check), `api/store.mjs` (SQLite: payments, jobs, ledger), `api/pipeline.mjs` (prompt, image, one-pager). Tests: `test/api.test.js`. Deployment: namespace `typographics` in the AstrionCore home cluster.
