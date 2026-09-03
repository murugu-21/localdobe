package imgopt

import "testing"

// A stray, unbalanced ')' in a content stream used to make lexer.next() return an
// empty operator token without advancing l.i, so walk() spun forever. These cases
// must terminate; if the bug returns the test hangs and `go test -timeout 60s`
// reports it as a timeout panic.
func TestScanPlacementsTerminatesOnStrayCloseParen(t *testing.T) {
	t.Run("no placement", func(t *testing.T) {
		ctx := loadCtx(t, singleImagePDF(t, photo(200, 200), "q 1 0 0 1 0 0 cm ) /Im1 Do Q"))
		if _, err := ScanPlacements(ctx); err != nil {
			t.Fatal(err)
		}
	})
	t.Run("placement still recorded", func(t *testing.T) {
		ctx := loadCtx(t, singleImagePDF(t, photo(200, 200), "q 288 0 0 288 162 252 cm ) /Im1 Do Q"))
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
