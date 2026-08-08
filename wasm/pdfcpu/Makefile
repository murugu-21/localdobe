.PHONY: build
build:
	GOOS=js GOARCH=wasm go build -ldflags="-s -w" -o ../../public/wasm/pdfcpu.wasm .
	cp "$$(go env GOROOT)/lib/wasm/wasm_exec.js" ../../src/workers/go/wasm_exec.js || \
	cp "$$(go env GOROOT)/misc/wasm/wasm_exec.js" ../../src/workers/go/wasm_exec.js
