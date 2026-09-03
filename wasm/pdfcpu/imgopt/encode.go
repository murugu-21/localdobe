package imgopt

import (
	"bytes"
	"image"
	"image/draw"
	"image/jpeg"
	"math"

	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/model"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/types"
	xdraw "golang.org/x/image/draw"
)

// photographicDistinctColors is the number of distinct sampled colours above which
// an image is treated as photographic (JPEG) rather than flat art (Flate). It is an
// absolute count, not a fraction of the sample: an 8-bit gray photo can never exceed
// 256 distinct values however many pixels we look at, while two-colour art stays far
// below this in either colour model.
const photographicDistinctColors = 64

// IsPhotographic samples up to ~4096 pixels and reports whether the image carries a
// photographic range of tones (photo, scan) rather than the handful of flat colours of
// a screenshot, diagram or text rendering. Gray images are keyed on their exact 8-bit
// level; colour images on 5-bit-per-channel bins so JPEG noise doesn't inflate the count.
// This is our stand-in for Ghostscript's AutoFilter: photographic → DCT, else Flate.
func IsPhotographic(img image.Image) bool {
	b := img.Bounds()
	step := int(math.Max(1, math.Sqrt(float64(b.Dx()*b.Dy())/4096)))
	_, isGray := img.(*image.Gray)
	seen := map[uint32]struct{}{}
	for y := b.Min.Y; y < b.Max.Y; y += step {
		for x := b.Min.X; x < b.Max.X; x += step {
			r, g, bl, _ := img.At(x, y).RGBA() // 16-bit channels
			var key uint32
			if isGray {
				key = r >> 8
			} else {
				key = (r>>11)<<10 | (g>>11)<<5 | (bl >> 11)
			}
			seen[key] = struct{}{}
			if len(seen) > photographicDistinctColors {
				return true
			}
		}
	}
	return false
}

// Resample scales src to w×h with a bilinear kernel (area-averaging when shrinking).
// Gray stays gray; every other colour model becomes RGBA.
func Resample(src image.Image, w, h int) image.Image {
	r := image.Rect(0, 0, w, h)
	var dst draw.Image
	if _, gray := src.(*image.Gray); gray {
		dst = image.NewGray(r)
	} else {
		dst = image.NewRGBA(r)
	}
	xdraw.BiLinear.Scale(dst, r, src, src.Bounds(), xdraw.Src, nil)
	return dst
}

// Encode builds a replacement image XObject stream dict for img.
func Encode(xref *model.XRefTable, img image.Image, jpegQuality int) (*types.StreamDict, error) {
	b := img.Bounds()
	w, h := b.Dx(), b.Dy()
	gray, isGray := img.(*image.Gray)
	cs := model.DeviceRGBCS
	if isGray {
		cs = model.DeviceGrayCS
	}
	if IsPhotographic(img) {
		var buf bytes.Buffer
		if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: jpegQuality}); err != nil {
			return nil, err
		}
		return model.CreateDCTImageStreamDict(xref, buf.Bytes(), w, h, 8, cs)
	}
	var samples []byte
	if isGray {
		samples = packGray(gray)
	} else {
		samples = packRGB(img)
	}
	return model.CreateFlateImageStreamDict(xref, samples, nil, w, h, 8, cs)
}

func packGray(g *image.Gray) []byte {
	b := g.Bounds()
	out := make([]byte, 0, b.Dx()*b.Dy())
	for y := 0; y < b.Dy(); y++ {
		out = append(out, g.Pix[y*g.Stride:y*g.Stride+b.Dx()]...)
	}
	return out
}

func packRGB(img image.Image) []byte {
	b := img.Bounds()
	out := make([]byte, 0, b.Dx()*b.Dy()*3)
	for y := b.Min.Y; y < b.Max.Y; y++ {
		for x := b.Min.X; x < b.Max.X; x++ {
			r, g, bl, _ := img.At(x, y).RGBA()
			out = append(out, byte(r>>8), byte(g>>8), byte(bl>>8))
		}
	}
	return out
}
