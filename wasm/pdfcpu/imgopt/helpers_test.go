package imgopt

import (
	"bytes"
	"compress/zlib"
	"fmt"
	"image"
	"image/color"
	"image/jpeg"
	"math/rand"
	"os"
	"testing"

	"github.com/pdfcpu/pdfcpu/pkg/api"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/model"
)

func TestMain(m *testing.M) {
	api.DisableConfigDir() // never touch ~/.config/pdfcpu from tests
	os.Exit(m.Run())
}

// obj is one PDF object: a dict body (without the << >>) and an optional stream.
type obj struct {
	dict   string
	stream []byte
}

// buildPDF writes a minimal classic-xref PDF; object i in the slice becomes "i+1 0 obj".
// Object 1 must be the catalog.
func buildPDF(objs []obj) []byte {
	var b bytes.Buffer
	b.WriteString("%PDF-1.7\n%\xe2\xe3\xcf\xd3\n")
	offsets := make([]int, len(objs)+1)
	for i, o := range objs {
		offsets[i+1] = b.Len()
		fmt.Fprintf(&b, "%d 0 obj\n", i+1)
		if o.stream != nil {
			fmt.Fprintf(&b, "<<%s /Length %d>>\nstream\n", o.dict, len(o.stream))
			b.Write(o.stream)
			b.WriteString("\nendstream\n")
		} else {
			fmt.Fprintf(&b, "<<%s>>\n", o.dict)
		}
		b.WriteString("endobj\n")
	}
	xref := b.Len()
	fmt.Fprintf(&b, "xref\n0 %d\n0000000000 65535 f \n", len(objs)+1)
	for i := 1; i <= len(objs); i++ {
		fmt.Fprintf(&b, "%010d 00000 n \n", offsets[i])
	}
	fmt.Fprintf(&b, "trailer\n<</Size %d /Root 1 0 R>>\nstartxref\n%d\n%%%%EOF\n", len(objs)+1, xref)
	return b.Bytes()
}

// photo is a deterministic gradient + noise image: many distinct colours, JPEG-friendly.
func photo(w, h int) *image.RGBA {
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	rnd := rand.New(rand.NewSource(1))
	clamp := func(v int) uint8 {
		if v > 255 {
			return 255
		}
		return uint8(v)
	}
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			n := rnd.Intn(24)
			img.SetRGBA(x, y, color.RGBA{clamp(x*255/w + n), clamp(y*255/h + n), clamp((x+y)*127/(w+h) + n), 255})
		}
	}
	return img
}

// checkerboard is flat two-colour art: the auto-filter must keep it Flate.
func checkerboard(w, h, cell int) *image.RGBA {
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			if ((x/cell)+(y/cell))%2 == 0 {
				img.SetRGBA(x, y, color.RGBA{255, 255, 255, 255})
			} else {
				img.SetRGBA(x, y, color.RGBA{0, 0, 0, 255})
			}
		}
	}
	return img
}

func jpegBytes(t *testing.T, img image.Image, q int) []byte {
	t.Helper()
	var b bytes.Buffer
	if err := jpeg.Encode(&b, img, &jpeg.Options{Quality: q}); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

// imageObj is a DCT-encoded DeviceRGB image XObject.
func imageObj(t *testing.T, img image.Image) obj {
	b := img.Bounds()
	return obj{
		dict:   fmt.Sprintf("/Type /XObject /Subtype /Image /Width %d /Height %d /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode", b.Dx(), b.Dy()),
		stream: jpegBytes(t, img, 90),
	}
}

// singleImagePDF: one Letter page, image XObject /Im1 (object 5), given page content.
// A /F1 font resource (object 6) is also declared so content streams may reference
// text operators (see the "after strings and dicts" placement test case) without
// tripping pdfcpu's resource-consolidation validation.
func singleImagePDF(t *testing.T, img image.Image, content string) []byte {
	t.Helper()
	return buildPDF([]obj{
		{dict: "/Type /Catalog /Pages 2 0 R"},
		{dict: "/Type /Pages /Kids [3 0 R] /Count 1"},
		{dict: "/Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources <</XObject <</Im1 5 0 R>> /Font <</F1 6 0 R>> >> /Contents 4 0 R"},
		{dict: "", stream: []byte(content)},
		imageObj(t, img),
		{dict: "/Type /Font /Subtype /Type1 /BaseFont /Helvetica"},
	})
}

func testConf() *model.Configuration {
	conf := model.NewDefaultConfiguration()
	conf.ValidationMode = model.ValidationRelaxed
	conf.Cmd = model.OPTIMIZE
	return conf
}

// loadCtx reads + validates + runs pdfcpu's lossless optimize, exactly like main.go does.
func loadCtx(t *testing.T, pdf []byte) *model.Context {
	t.Helper()
	ctx, err := api.ReadValidateAndOptimize(bytes.NewReader(pdf), testConf())
	if err != nil {
		t.Fatal(err)
	}
	return ctx
}

// onlyImageObjNr returns the object number of the single image in ctx.
func onlyImageObjNr(t *testing.T, ctx *model.Context) int {
	t.Helper()
	if n := len(ctx.Optimize.ImageObjects); n != 1 {
		t.Fatalf("want exactly 1 image object, got %d", n)
	}
	for objNr := range ctx.Optimize.ImageObjects {
		return objNr
	}
	return 0
}

func newFlateWriter(w *bytes.Buffer) *zlib.Writer { return zlib.NewWriter(w) }
