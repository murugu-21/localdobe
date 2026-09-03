package imgopt

import (
	"errors"
	"fmt"
	"image"
	"image/jpeg"
	"image/png"
	"sort"

	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/model"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/types"
	"golang.org/x/image/tiff"
)

// Stats summarises one Run for logging and the JS result payload.
type Stats struct {
	Considered, Resampled, Skipped int
	BytesBefore, BytesAfter        int64 // raw stream bytes of the images that were replaced
}

// Run resamples over-resolved images in place. ctx must come from
// api.ReadValidateAndOptimize (we rely on ctx.Optimize.ImageObjects, which also
// means duplicate images have already been folded into one object).
func Run(ctx *model.Context, o Options) (Stats, error) {
	var st Stats
	if ctx == nil || ctx.Optimize == nil {
		return st, errors.New("imgopt: context not optimized")
	}
	placements, err := ScanPlacements(ctx)
	if err != nil {
		placements = map[int]Placement{} // placement is a hint; fall back to the pixel cap
	}
	skip := maskTargets(ctx)

	objNrs := make([]int, 0, len(ctx.Optimize.ImageObjects))
	for objNr := range ctx.Optimize.ImageObjects {
		objNrs = append(objNrs, objNr)
	}
	sort.Ints(objNrs) // deterministic output

	for _, objNr := range objNrs {
		if skip[objNr] {
			continue
		}
		imgObj := ctx.Optimize.ImageObjects[objNr]
		if imgObj == nil || imgObj.ImageDict == nil {
			continue
		}
		sd := imgObj.ImageDict
		st.Considered++

		var p *Placement
		if pl, ok := placements[objNr]; ok {
			p = &pl
		}
		dec := Plan(infoFor(sd, objNr), p, o)
		if !dec.Resample {
			st.Skipped++
			continue
		}

		before := rawLen(sd)
		newSD, err := rebuild(ctx, sd, objNr, dec, o)
		// StreamDict.Content is a decode cache the writer never reads (it serialises
		// Raw only): ExtractImage fills it with the full decoded samples on the dict
		// held by ctx.Optimize.ImageObjects, and CreateFlate/DCTImageStreamDict leave
		// it populated on the replacement. Release both as soon as rebuild is done, or
		// every considered image's pixel buffer stays alive until WriteContext returns.
		sd.Content = nil
		if err != nil {
			st.Skipped++ // undecodable: keep the original
			continue
		}
		newSD.Content = nil
		if len(newSD.Raw) >= before {
			st.Skipped++ // not actually smaller: keep the original
			continue
		}
		// Encode builds a fresh dict, so carry over the entries that tie this XObject
		// to the rest of the document: /OC (optional-content visibility — dropping it
		// makes a hidden layer permanently visible), /StructParent (tagged PDF),
		// /Intent and /Metadata.
		for _, k := range []string{"OC", "StructParent", "Intent", "Metadata"} {
			if v, found := sd.Find(k); found {
				newSD.Insert(k, v)
			}
		}
		entry, ok := ctx.FindTableEntry(objNr, 0)
		if !ok || entry == nil {
			st.Skipped++
			continue
		}
		entry.Object = *newSD
		imgObj.ImageDict = newSD
		st.Resampled++
		st.BytesBefore += int64(before)
		st.BytesAfter += int64(len(newSD.Raw))
	}
	return st, nil
}

// maskTargets returns object numbers referenced as /SMask or /Mask by any image:
// they are alpha/stencil data whose pixel grid must stay aligned with their parent.
func maskTargets(ctx *model.Context) map[int]bool {
	skip := map[int]bool{}
	for _, imgObj := range ctx.Optimize.ImageObjects {
		if imgObj == nil || imgObj.ImageDict == nil {
			continue
		}
		for _, k := range []string{"SMask", "Mask"} {
			if ir := imgObj.ImageDict.IndirectRefEntry(k); ir != nil {
				skip[ir.ObjectNumber.Value()] = true
			}
		}
	}
	return skip
}

func infoFor(sd *types.StreamDict, objNr int) ImageInfo {
	info := ImageInfo{ObjNr: objNr}
	if v := sd.IntEntry("Width"); v != nil {
		info.Width = *v
	}
	if v := sd.IntEntry("Height"); v != nil {
		info.Height = *v
	}
	if v := sd.IntEntry("BitsPerComponent"); v != nil {
		info.BPC = *v
	}
	if v := sd.BooleanEntry("ImageMask"); v != nil && *v {
		info.IsMask = true
		info.BPC = 1
	}
	_, info.HasSMask = sd.Find("SMask")
	_, info.HasMask = sd.Find("Mask")
	_, info.HasDecode = sd.Find("Decode")
	if n := len(sd.FilterPipeline); n > 0 {
		info.Filter = sd.FilterPipeline[n-1].Name
	}
	return info
}

func rawLen(sd *types.StreamDict) int {
	if sd.Raw != nil {
		return len(sd.Raw)
	}
	if sd.StreamLength != nil {
		return int(*sd.StreamLength)
	}
	return 0
}

// decode turns an image XObject into an image.Image via pdfcpu's extractor, which
// already handles Flate/LZW/RunLength/CCITT/DCT, Indexed/ICCBased/CMYK and Decode arrays.
func decode(ctx *model.Context, sd *types.StreamDict, objNr int) (image.Image, error) {
	img, err := pdfcpu.ExtractImage(ctx, sd, false, "", objNr, false)
	if err != nil {
		return nil, err
	}
	switch img.FileType {
	case "jpg":
		return jpeg.Decode(img)
	case "png":
		return png.Decode(img)
	case "tif":
		return tiff.Decode(img)
	}
	return nil, fmt.Errorf("imgopt: cannot decode %q image obj#%d", img.FileType, objNr)
}

// rebuild decodes, resamples and re-encodes one image. pdfcpu's renderers index into
// the decoded sample buffer using assumptions that malformed images can violate (a
// 4-bpc DeviceRGB stream panics with index out of range), so any panic below is turned
// into an error for this image alone: a panic escaping imgopt would fail the whole
// document in main.go's wrap.
func rebuild(ctx *model.Context, sd *types.StreamDict, objNr int, dec Decision, o Options) (newSD *types.StreamDict, err error) {
	defer func() {
		if r := recover(); r != nil {
			newSD, err = nil, fmt.Errorf("imgopt: image obj#%d: %v", objNr, r)
		}
	}()
	src, err := decode(ctx, sd, objNr)
	if err != nil {
		return nil, err
	}
	// pdfcpu renders DeviceGray sources to RGB PNGs; fold those back to gray before
	// resampling so Resample keeps the gray colour model and Encode emits DeviceGray.
	return Encode(ctx.XRefTable, Resample(toGrayIfNeutral(src), dec.NewW, dec.NewH), o.JPEGQuality)
}
