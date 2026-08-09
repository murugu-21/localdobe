# pdfcpu WASM build

`make build` compiles pdfcpu to `public/wasm/pdfcpu.wasm` and copies the matching
`wasm_exec.js` runtime to `src/workers/go/`. Both artifacts are committed so CI and
Cloudflare never need a Go toolchain. Rebuild only when bumping the pdfcpu version.

## Pinned version

`go.mod` pins `github.com/pdfcpu/pdfcpu v0.14.0` (resolved from `latest` via `go mod tidy`
on 2026-08-09). Go toolchain used: go1.26.0 (go.mod declares `go 1.25.0`, the minimum
`go mod tidy` set based on pdfcpu's own requirements).

## API drift from the brief

pdfcpu v0.14.0 changed `api.ValidateSignatures` to take an `inFile string` path instead
of a reader. The in-memory equivalent is `api.ValidateSignaturesRaw(rs ReadSeekerAt, all
bool, conf *model.Configuration)`, where `ReadSeekerAt` is `io.ReadSeeker + io.ReaderAt` —
`*bytes.Reader` satisfies it directly, so `validateSignatures` in `main.go` calls
`api.ValidateSignaturesRaw` instead. No other APIs referenced in the brief (`api.Optimize`,
`api.Encrypt`, `api.Decrypt`, `api.AddWatermarks`, `api.RemoveWatermarks`,
`api.TextWatermark`, `api.ImageWatermarkForReader`, `api.RemoveSignatures`, and all
`model.Configuration` fields) drifted — they match the brief as written. The JS-facing
contract (function names, config JSON keys, return shapes) is unchanged.

## Rebuilding

```bash
cd wasm/pdfcpu
go mod tidy   # only if bumping the pdfcpu version
make build
node smoke.mjs   # sanity check: exercises all six exported functions end-to-end
```

## Exported JS globals

All are installed on `globalThis` by the WASM module once instantiated and `go.run()`'d:

- `__pdfcpuOptimize(input, configJson)`
- `__pdfcpuWatermark(input, configJson, imageBytes)`
- `__pdfcpuValidateSignatures(input)`
- `__pdfcpuRemoveSignatures(input)`
- `__pdfcpuEncrypt(input, configJson)`
- `__pdfcpuDecrypt(input, configJson)`

See `main.go` for exact config JSON shapes and `smoke.mjs` for usage examples of each.
Panics inside pdfcpu are recovered by the `wrap()` helper and surfaced as
`{ ok: false, error: "pdfcpu panic: ..." }` rather than crashing the worker.

## Cache-busting on rebuild

`public/_headers` marks `/wasm/*` as `immutable, max-age=31536000` — browsers and
Cloudflare's edge will happily cache `pdfcpu.wasm` for a year. Unlike `/_astro/*`
assets (which Astro content-hashes into the filename automatically), `pdfcpu.wasm`
and the font files under `public/fonts/` are NOT hashed, so overwriting the file in
place will not bust caches for existing visitors.

When bumping the pdfcpu version and rebuilding this WASM module, rename the output
file (e.g. `pdfcpu-v2.wasm`) and update the fetch URL in
`src/workers/pdfcpu.worker.ts` (`fetch('/wasm/pdfcpu.wasm')`) to match. Leave the old
file in place for one deploy cycle if you want in-flight tabs to keep working, then
remove it.
