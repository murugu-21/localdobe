// Package imgopt adds a lossy image pass (placement-aware downsampling + re-encoding)
// on top of pdfcpu's lossless optimizer. It is pure Go with no wasm build tag so it
// can be unit-tested natively; wasm/pdfcpu/main.go wires it into __pdfcpuOptimize.
package imgopt

import "math"

// Placement is the largest on-page footprint, in PDF points, at which an image
// XObject is drawn anywhere in the document (see ScanPlacements).
type Placement struct {
	WidthPt, HeightPt float64
}

// Options tunes the pass. DefaultOptions mirrors Ghostscript's /ebook preset.
type Options struct {
	TargetDPI            int     // effective on-page resolution to resample down to
	Threshold            float64 // resample only when effective dpi > TargetDPI*Threshold
	JPEGQuality          int     // 1..100 for photographic output
	MaxPixelsNoPlacement int     // long-edge cap used when the on-page size is unknown
	MaxSourcePixels      int     // never decode images with more pixels than this (wasm memory)
}

// DefaultOptions returns the production defaults (150 dpi, 1.5× threshold, JPEG q75).
func DefaultOptions() Options {
	return Options{TargetDPI: 150, Threshold: 1.5, JPEGQuality: 75, MaxPixelsNoPlacement: 2000, MaxSourcePixels: 40_000_000}
}

// ImageInfo is everything Plan needs to know about an image XObject, read from its dict.
type ImageInfo struct {
	ObjNr, Width, Height, BPC int
	Filter                    string // last filter in the pipeline, "" when unfiltered
	IsMask, HasSMask, HasMask bool
}

// Decision says whether to resample an image and to what pixel size.
// Reason is "resample" or a short skip reason for stats/debugging.
type Decision struct {
	Resample   bool
	NewW, NewH int
	Reason     string
}

// Plan applies the skip rules, then the resolution rule. It is pure and side-effect free.
func Plan(img ImageInfo, p *Placement, o Options) Decision {
	switch {
	case img.IsMask || img.HasSMask || img.HasMask:
		return Decision{Reason: "mask"}
	case img.Filter == "JPXDecode" || img.Filter == "JBIG2Decode":
		return Decision{Reason: "undecodable"}
	case img.BPC == 1:
		return Decision{Reason: "bilevel"} // keep scanned text crisp; Ghostscript keeps mono at 4× colour dpi too
	case img.BPC > 8:
		return Decision{Reason: "bpc"}
	case img.Width < 64 || img.Height < 64:
		return Decision{Reason: "tiny"}
	case img.Width*img.Height > o.MaxSourcePixels:
		return Decision{Reason: "too-large"}
	}

	var scale float64
	if p != nil && p.WidthPt > 0 && p.HeightPt > 0 {
		dpiW := float64(img.Width) / (p.WidthPt / 72)
		dpiH := float64(img.Height) / (p.HeightPt / 72)
		eff := math.Max(dpiW, dpiH)
		if eff <= float64(o.TargetDPI)*o.Threshold {
			return Decision{Reason: "resolution-ok"}
		}
		scale = float64(o.TargetDPI) / eff
	} else {
		long := math.Max(float64(img.Width), float64(img.Height))
		if long <= float64(o.MaxPixelsNoPlacement) {
			return Decision{Reason: "no-placement-under-cap"}
		}
		scale = float64(o.MaxPixelsNoPlacement) / long
	}

	w := int(math.Max(1, math.Round(float64(img.Width)*scale)))
	h := int(math.Max(1, math.Round(float64(img.Height)*scale)))
	if w >= img.Width || h >= img.Height {
		return Decision{Reason: "resolution-ok"}
	}
	return Decision{Resample: true, NewW: w, NewH: h, Reason: "resample"}
}
