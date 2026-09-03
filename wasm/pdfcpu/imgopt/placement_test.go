package imgopt

import (
	"math"
	"testing"
)

func near(a, b float64) bool { return math.Abs(a-b) < 0.01 }

func TestScanPlacementsDirectDraw(t *testing.T) {
	cases := []struct {
		name, content string
	}{
		{"plain", "q 288 0 0 288 162 252 cm /Im1 Do Q"},
		{"rotated 90", "q 0 288 -288 0 450 252 cm /Im1 Do Q"},
		{"nested cm", "q 2 0 0 2 0 0 cm q 144 0 0 144 81 126 cm /Im1 Do Q Q"},
		{"after inline image", "q BI /W 2 /H 2 /CS /G /BPC 8 ID \x00\x01\x02\x03 EI Q q 288 0 0 288 162 252 cm /Im1 Do Q"},
		{"after strings and dicts", "BT /F1 12 Tf (Do) Tj <446F> Tj ET /Span <</MCID 0>> BDC EMC q 288 0 0 288 162 252 cm /Im1 Do Q"},
		{"drawn twice keeps the larger", "q 72 0 0 72 0 0 cm /Im1 Do Q q 288 0 0 288 162 252 cm /Im1 Do Q"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			ctx := loadCtx(t, singleImagePDF(t, photo(200, 200), c.content))
			got, err := ScanPlacements(ctx)
			if err != nil {
				t.Fatal(err)
			}
			p, ok := got[onlyImageObjNr(t, ctx)]
			if !ok || !near(p.WidthPt, 288) || !near(p.HeightPt, 288) {
				t.Fatalf("got %+v (found=%v), want 288x288 pt", p, ok)
			}
		})
	}
}

func TestScanPlacementsThroughFormXObject(t *testing.T) {
	// Page draws form /Fx1 (object 6) translated; the form's /Matrix halves everything and
	// draws /Im1 at 576 pt → effective footprint 288 pt.
	pdf := buildPDF([]obj{
		{dict: "/Type /Catalog /Pages 2 0 R"},
		{dict: "/Type /Pages /Kids [3 0 R] /Count 1"},
		{dict: "/Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources <</XObject <</Fx1 6 0 R>> >> /Contents 4 0 R"},
		{dict: "", stream: []byte("q 1 0 0 1 18 100 cm /Fx1 Do Q")},
		imageObj(t, photo(200, 200)),
		{dict: "/Type /XObject /Subtype /Form /BBox [0 0 576 576] /Matrix [0.5 0 0 0.5 0 0] /Resources <</XObject <</Im1 5 0 R>> >>", stream: []byte("q 576 0 0 576 0 0 cm /Im1 Do Q")},
	})
	ctx := loadCtx(t, pdf)
	got, err := ScanPlacements(ctx)
	if err != nil {
		t.Fatal(err)
	}
	p, ok := got[onlyImageObjNr(t, ctx)]
	if !ok || !near(p.WidthPt, 288) || !near(p.HeightPt, 288) {
		t.Fatalf("got %+v (found=%v), want 288x288 pt via form matrix", p, ok)
	}
}

func TestScanPlacementsUnreferencedImageAbsent(t *testing.T) {
	ctx := loadCtx(t, singleImagePDF(t, photo(200, 200), "0 0 1 rg 0 0 100 100 re f"))
	got, err := ScanPlacements(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 0 {
		t.Fatalf("want no placements for an image that is never drawn, got %+v", got)
	}
}
