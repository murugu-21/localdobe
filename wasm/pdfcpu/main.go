//go:build js && wasm

package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"syscall/js"

	"github.com/pdfcpu/pdfcpu/pkg/api"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/model"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/types"
)

func jsError(msg string) js.Value {
	return js.ValueOf(map[string]any{"ok": false, "error": msg})
}

func toGoBytes(v js.Value) []byte {
	buf := make([]byte, v.Length())
	js.CopyBytesToGo(buf, v)
	return buf
}

func toJSBytes(b []byte) js.Value {
	dst := js.Global().Get("Uint8Array").New(len(b))
	js.CopyBytesToJS(dst, b)
	return dst
}

func okBytes(out *bytes.Buffer) js.Value {
	return js.ValueOf(map[string]any{"ok": true, "bytes": toJSBytes(out.Bytes())})
}

func newConf() *model.Configuration {
	conf := model.NewDefaultConfiguration()
	conf.ValidationMode = model.ValidationRelaxed
	return conf
}

// wrap adds panic recovery so a pdfcpu crash surfaces as {ok:false} instead of killing the worker.
func wrap(fn func(args []js.Value) js.Value) js.Func {
	return js.FuncOf(func(_ js.Value, args []js.Value) (result any) {
		defer func() {
			if r := recover(); r != nil {
				result = jsError(fmt.Sprintf("pdfcpu panic: %v", r))
			}
		}()
		return fn(args)
	})
}

func optimize(args []js.Value) js.Value {
	input := toGoBytes(args[0])
	var opts struct {
		DedupResources      bool `json:"dedupResources"`
		DedupContentStreams bool `json:"dedupContentStreams"`
	}
	if err := json.Unmarshal([]byte(args[1].String()), &opts); err != nil {
		return jsError("bad config: " + err.Error())
	}
	conf := newConf()
	conf.OptimizeResourceDicts = opts.DedupResources
	conf.OptimizeDuplicateContentStreams = opts.DedupContentStreams
	var out bytes.Buffer
	if err := api.Optimize(bytes.NewReader(input), &out, conf); err != nil {
		return jsError(err.Error())
	}
	return okBytes(&out)
}

func watermark(args []js.Value) js.Value {
	input := toGoBytes(args[0])
	var cfg struct {
		Mode  string `json:"mode"` // addText | addImage | remove
		OnTop bool   `json:"onTop"`
		Text  string `json:"text"`
		Desc  string `json:"desc"`
	}
	if err := json.Unmarshal([]byte(args[1].String()), &cfg); err != nil {
		return jsError("bad config: " + err.Error())
	}
	conf := newConf()
	var out bytes.Buffer
	switch cfg.Mode {
	case "remove":
		if err := api.RemoveWatermarks(bytes.NewReader(input), &out, nil, conf); err != nil {
			return jsError(err.Error())
		}
	case "addText":
		wm, err := api.TextWatermark(cfg.Text, cfg.Desc, cfg.OnTop, false, types.POINTS)
		if err != nil {
			return jsError(err.Error())
		}
		if err := api.AddWatermarks(bytes.NewReader(input), &out, nil, wm, conf); err != nil {
			return jsError(err.Error())
		}
	case "addImage":
		if len(args) < 3 || args[2].IsNull() || args[2].IsUndefined() {
			return jsError("addImage requires image bytes")
		}
		img := toGoBytes(args[2])
		wm, err := api.ImageWatermarkForReader(bytes.NewReader(img), cfg.Desc, cfg.OnTop, false, types.POINTS)
		if err != nil {
			return jsError(err.Error())
		}
		if err := api.AddWatermarks(bytes.NewReader(input), &out, nil, wm, conf); err != nil {
			return jsError(err.Error())
		}
	default:
		return jsError("unknown watermark mode: " + cfg.Mode)
	}
	return okBytes(&out)
}

func validateSignatures(args []js.Value) js.Value {
	input := toGoBytes(args[0])
	// api.ValidateSignatures in pdfcpu v0.14.0 takes a file path; ValidateSignaturesRaw
	// is the in-memory variant (bytes.Reader satisfies api.ReadSeekerAt: ReadSeeker + ReaderAt).
	results, err := api.ValidateSignaturesRaw(bytes.NewReader(input), true, newConf())
	if err != nil {
		return jsError(err.Error())
	}
	report, err := json.Marshal(results)
	if err != nil {
		return jsError("marshal report: " + err.Error())
	}
	return js.ValueOf(map[string]any{"ok": true, "report": string(report)})
}

func removeSignatures(args []js.Value) js.Value {
	input := toGoBytes(args[0])
	var out bytes.Buffer
	if err := api.RemoveSignatures(bytes.NewReader(input), &out, newConf()); err != nil {
		return jsError(err.Error())
	}
	return okBytes(&out)
}

func encrypt(args []js.Value) js.Value {
	input := toGoBytes(args[0])
	var cfg struct {
		UserPw  string `json:"userPw"`
		OwnerPw string `json:"ownerPw"`
	}
	if err := json.Unmarshal([]byte(args[1].String()), &cfg); err != nil {
		return jsError("bad config: " + err.Error())
	}
	if cfg.OwnerPw == "" {
		cfg.OwnerPw = cfg.UserPw
	}
	conf := newConf()
	conf.UserPW = cfg.UserPw
	conf.OwnerPW = cfg.OwnerPw
	conf.EncryptUsingAES = true
	conf.EncryptKeyLength = 256
	var out bytes.Buffer
	if err := api.Encrypt(bytes.NewReader(input), &out, conf); err != nil {
		return jsError(err.Error())
	}
	return okBytes(&out)
}

func decrypt(args []js.Value) js.Value {
	input := toGoBytes(args[0])
	var cfg struct {
		Password string `json:"password"`
	}
	if err := json.Unmarshal([]byte(args[1].String()), &cfg); err != nil {
		return jsError("bad config: " + err.Error())
	}
	conf := newConf()
	conf.UserPW = cfg.Password
	conf.OwnerPW = cfg.Password
	var out bytes.Buffer
	if err := api.Decrypt(bytes.NewReader(input), &out, conf); err != nil {
		return jsError("Wrong password, or the file could not be decrypted: " + err.Error())
	}
	return okBytes(&out)
}

func main() {
	api.DisableConfigDir()
	// DisableConfigDir leaves model.TrustedCertDir empty, and signature
	// validation unconditionally walks that directory to build its trust pool
	// (pkg/api/sign.go -> pdfcpu.LoadCertificates). WalkDir("") fails with
	// EINVAL under js/wasm, breaking validation for every SIGNED pdf.
	// Point it at a fixed virtual path instead; the JS host (worker/smoke)
	// shims globalThis.fs to present /certs as an empty directory, yielding
	// an empty trust pool — integrity checks run fully, trust-chain
	// verification stays unavailable (which the UI already discloses).
	model.TrustedCertDir = "/certs"
	js.Global().Set("__pdfcpuOptimize", wrap(optimize))
	js.Global().Set("__pdfcpuWatermark", wrap(watermark))
	js.Global().Set("__pdfcpuValidateSignatures", wrap(validateSignatures))
	js.Global().Set("__pdfcpuRemoveSignatures", wrap(removeSignatures))
	js.Global().Set("__pdfcpuEncrypt", wrap(encrypt))
	js.Global().Set("__pdfcpuDecrypt", wrap(decrypt))
	select {} // keep the Go runtime alive for future calls
}
