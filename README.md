# @gaius-ar/sdk

JavaScript and TypeScript client for the Gaius API, generated with Orval.

## Installation

```bash
npm install @gaius-ar/sdk
```

The package uses ES modules and native Fetch APIs. Use Node.js 22 or later, or Bun.
Compiled JavaScript and TypeScript declarations are included; TypeScript is not
required at runtime.

## Usage

```js
import { createGaiusClient } from '@gaius-ar/sdk'

const gaius = createGaiusClient(process.env.GAIUS_API_KEY)
const response = await gaius.getV1CaseById('your-case-id')

console.log(response.data)
```

The default API URL is `https://api.gaius.com.ar`. Each client sends its API key
as a Bearer token. Use the SDK in server-side code to keep your API key private.
Requests require the permissions configured on the key and the user's account.

Low-level methods retain their generated Orval names and return `{ data, status, headers }`.
For example, to list cases:

```js
const response = await gaius.getV1Case({
  limit: 20,
  offset: 0,
  statuses: ['active'],
})

console.log(response.data.items)
```

## Create a case with files

`createCase` follows the frontend flow: validate form values against the current
case type, create the case, upload its files using the returned signed URLs, and
confirm the uploads. It uses the existing API without backend changes.

```ts
import { CaseUploadError, createGaiusClient } from '@gaius-ar/sdk'

const gaius = createGaiusClient(process.env.GAIUS_API_KEY!)

try {
  const result = await gaius.createCase({
    personType: 'individual',
    firstName: 'Ana',
    lastName: 'Pérez',
    idType: 'DNI',
    idValue: '12.345.678',
    intakeChannel: 'web',
    intakeDate: '2026-10-30',
    caseTypeId: '00000000-0000-4000-8000-000000000001',
    answers: {
      '00000000-0000-4000-8000-000000000002': new File([pdfBytes], 'evidence.pdf'),
    },
    documents: [{
      title: 'Supporting document',
      file: new File([otherPdfBytes], 'support.pdf'),
    }],
  })
  console.log(result.caseId, result.submittedDocumentIds)
} catch (error) {
  if (!(error instanceof CaseUploadError)) throw error
  console.log('Case already created:', error.caseId)
  const result = await error.retry()
  console.log(result.caseId)
}
```

Replace the example IDs and byte buffers with your case type, question and file
contents. Inputs follow the frontend form, rather than the low-level API:

- `caseTypeId` is lowercase. Dates use `YYYY-MM-DD`.
- `answers` is keyed by question ID. Text, numbers and dates are strings;
  booleans are `'true'` or `'false'`; selections use an option ID or an array of
  option IDs; files are native `File` objects.
- `personType`, `idType`, `idValue`, `intakeChannel` and `intakeDate` are required.
  Individual cases also need `firstName` and `lastName`; companies need
  `businessName` and a CUIT or CDI.
- Other string fields default to `''`, `answers` to `{}`, and `documents` to `[]`.
  Additional documents require both a title and a file. `caseDraftId` is optional.

The SDK reuses the frontend's Zod schemas, identification normalization, answer
conversion and upload function. It fetches the current case type before checking
required answers, text and number limits, integer/decimal rules, dates, booleans
and options. A complete submission must also provide file questions marked
`required` or `requiredDocument`. File names use the frontend's extension allowlist
and the backend's filename byte/control restrictions. Failures reject with a
`ZodError` containing field paths before case creation or any uploads. Case type
lookup failures propagate as API errors. The existing creation endpoint still
checks permissions, organization references and all server-side rules before
inserting the case.

If an upload or confirmation fails **after creation succeeds**, `CaseUploadError`
exposes `caseId`, the original `cause`, and `retry({ signal? })`. As in the frontend,
retry skips successful uploads and confirms the same case. It does not create a
new case or validate the form again. Files and retry state remain in memory;
keep the error object while retrying. Calling `createCase` again starts a new
case. Retries reuse the original signed URLs and work while those URLs remain
valid, matching the frontend's case creation flow. The helper does not renew
expired URLs. A creation request that fails without a response is not retried
automatically, because the server's outcome may be unknown.

Pass `{ signal }` as the second argument to cancel requests and uploads. After an
abort following creation, call `retry` with a fresh signal. Uploads use raw fetch
and signed headers, without the API key. The injected `fetch` also receives
storage requests, so custom wrappers must only apply credentials to the API host.

Creating requires `case:create`, and looking up a selected type requires
`case_type:read`. Low-level API methods remain available for incomplete cases or
manual upload control.

## Configuration

```js
const gaius = createGaiusClient({
  apiKey: process.env.GAIUS_API_KEY,
  baseUrl: 'http://localhost:8888',
  fetch: (input, init) => globalThis.fetch(input, init),
})
```

`baseUrl` and `fetch` are optional. A custom fetch receives the request with the
resolved URL and Authorization header already applied. Each instance has its own
configuration.

Pass headers and an AbortSignal through the method's request options:

```js
const controller = new AbortController()

const response = await gaius.getV1CaseById('your-case-id', {
  signal: controller.signal,
})
```

## Types

Import models and client types from the package root:

```ts
import type {
  DetailedCase,
  FetchFn,
  GaiusClient,
  GaiusClientParams,
} from '@gaius-ar/sdk'
```

URL helpers are hidden from the public TypeScript client type, but remain on the
runtime object generated by Orval.

## Errors

Non-success HTTP responses reject with an Error containing `status` and `info`
(the API error body). Network failures and abort errors propagate from fetch.
Requests are not retried automatically.

```js
try {
  const response = await gaius.getV1CaseById('your-case-id')
  console.log(response.data)
} catch (error) {
  console.error(error.status, error.info ?? error.message)
}
```

## Development

```bash
bun install
```

The generated API files are ignored by Git. Before building a fresh checkout,
copy `.env.example` to `.env`, configure `BASE_URL` for a running Gaius API (or
set `OPENAPI_URL`), and regenerate:

```bash
bun run gen
bun run typecheck
bun run test
bun run build
```

The build uses `bun build` to bundle JavaScript into `dist/index.js`, and `tsc`
to emit `dist/index.d.ts` and its supporting declaration files in `dist/api`.
It does not require a running API once generation is complete.

## Packaging

```bash
npm pack --ignore-scripts=false --dry-run
npm pack --ignore-scripts=false
```

The `prepack` script checks types, runs tests and builds the package. Only `dist`
and npm's standard package metadata files are included. Inspect and test the
tarball before publishing with `npm publish --ignore-scripts=false`. The explicit
flag also runs these checks when npm is configured to ignore lifecycle scripts.
Public access is configured in `publishConfig`.

## Frontend rule synchronization

The files in `src/frontend` are synchronized from the existing Gaius frontend.
They are committed and bundled so installing or building the SDK does not require
a checkout of the app. Update them from a sibling checkout with:

```bash
bun run sync:frontend
# Or pass the frontend source directory explicitly:
bun run sync:frontend /path/to/gaius/app/src
```

The synchronization changes import paths and replaces the UI upload hook's type
with its plain input shape. Business rules and the upload/conversion functions
remain the frontend source. Update the rules in the frontend, then synchronize;
avoid editing these copies independently.
