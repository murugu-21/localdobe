package imgopt

import (
	"image"
	"image/color"
	"testing"

	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/model"
)

func TestIsPhotographic(t *testing.T) {
	if !IsPhotographic(photo(400, 300)) {
		t.Fatal("gradient+noise should be photographic")
	}
	if IsPhotographic(checkerboard(400, 300, 20)) {
		t.Fatal("two-colour checkerboard should not be photographic")
	}
	g := image.NewGray(image.Rect(0, 0, 400, 300))
	for y := 0; y < 300; y++ {
		for x := 0; x < 400; x++ {
			g.SetGray(x, y, color.Gray{Y: uint8((x + y) % 256)})
		}
	}
	if !IsPhotographic(g) {
		t.Fatal("gray gradient should be photographic")
	}
}

func TestResampleKeepsColorModel(t *testing.T) {
	out := Resample(photo(1200, 900), 600, 450)
	if b := out.Bounds(); b.Dx() != 600 || b.Dy() != 450 {
		t.Fatalf("got %v, want 600x450", b)
	}
	if _, ok := out.(*image.RGBA); !ok {
		t.Fatalf("colour input should resample to *image.RGBA, got %T", out)
	}
	g := image.NewGray(image.Rect(0, 0, 200, 200))
	if _, ok := Resample(g, 100, 100).(*image.Gray); !ok {
		t.Fatal("gray input should stay *image.Gray")
	}
}

func TestEncodePicksFilterByContent(t *testing.T) {
	xref := loadCtx(t, singleImagePDF(t, photo(64, 64), "")).XRefTable

	sd, err := Encode(xref, photo(400, 300), 75)
	if err != nil {
		t.Fatal(err)
	}
	if f := sd.NameEntry("Filter"); f == nil || *f != "DCTDecode" {
		t.Fatalf("photo: Filter=%v, want DCTDecode", f)
	}
	if cs := sd.NameEntry("ColorSpace"); cs == nil || *cs != model.DeviceRGBCS {
		t.Fatalf("photo: ColorSpace=%v, want DeviceRGB", cs)
	}
	if w, h := sd.IntEntry("Width"), sd.IntEntry("Height"); w == nil || h == nil || *w != 400 || *h != 300 {
		t.Fatalf("photo: dims %v x %v, want 400x300", w, h)
	}
	if len(sd.Raw) == 0 {
		t.Fatal("photo: Raw must be encoded")
	}

	sd, err = Encode(xref, checkerboard(400, 300, 20), 75)
	if err != nil {
		t.Fatal(err)
	}
	if f := sd.NameEntry("Filter"); f == nil || *f != "FlateDecode" {
		t.Fatalf("flat art: Filter=%v, want FlateDecode", f)
	}

	g := image.NewGray(image.Rect(0, 0, 100, 100))
	for i := range g.Pix {
		g.Pix[i] = uint8(i % 251)
	}
	sd, err = Encode(xref, g, 75)
	if err != nil {
		t.Fatal(err)
	}
	if cs := sd.NameEntry("ColorSpace"); cs == nil || *cs != model.DeviceGrayCS {
		t.Fatalf("gray: ColorSpace=%v, want DeviceGray", cs)
	}
}
