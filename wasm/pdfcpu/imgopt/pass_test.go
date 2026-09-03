package imgopt

import (
	"bytes"
	"math/rand"
	"testing"

	"github.com/pdfcpu/pdfcpu/pkg/api"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/model"
)

// roundTrip runs the pass, writes the PDF, and re-reads it so assertions hit real output.
func roundTrip(t *testing.T, pdf []byte, o Options) (Stats, []byte) {
	t.Helper()
	return roundTripInspect(t, pdf, o, nil)
}

// roundTripInspect is roundTrip with a hook that sees the live ctx after Run but
// before WriteContext, for assertions about in-memory state the writer might disturb.
func roundTripInspect(t *testing.T, pdf []byte, o Options, inspect func(*model.Context)) (Stats, []byte) {
	t.Helper()
	ctx := loadCtx(t, pdf)
	st, err := Run(ctx, o)
	if err != nil {
		t.Fatal(err)
	}
	if inspect != nil {
		inspect(ctx)
	}
	var out bytes.Buffer
	if err := api.WriteContext(ctx, &out); err != nil {
		t.Fatal(err)
	}
	return st, out.Bytes()
}

// fourBpcRGBPDF is a 1200×1200 DeviceRGB Flate image at 4 bits per component with a
// correctly sized 4-bpc buffer, drawn at 288 pt. pdfcpu's renderDeviceRGBToPNG reads
// 3 bytes per pixel regardless of bpc, so decoding it panics with index out of range.
func fourBpcRGBPDF() []byte {
	var flate bytes.Buffer
	zw := newFlateWriter(&flate)
	zw.Write(make([]byte, 1200*1200*3/2))
	zw.Close()
	return buildPDF([]obj{
		{dict: "/Type /Catalog /Pages 2 0 R"},
		{dict: "/Type /Pages /Kids [3 0 R] /Count 1"},
		{dict: "/Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources <</XObject <</Im1 5 0 R>> >> /Contents 4 0 R"},
		{dict: "", stream: []byte("q 288 0 0 288 162 252 cm /Im1 Do Q")},
		{dict: "/Type /XObject /Subtype /Image /Width 1200 /Height 1200 /ColorSpace /DeviceRGB /BitsPerComponent 4 /Filter /FlateDecode", stream: flate.Bytes()},
	})
}

// TestRebuildRecoversFromRendererPanic drives rebuild past Plan's bpc guard to reach
// the panicking renderer directly: the panic must surface as an error for that image,
// never unwind out of imgopt (a panic there fails the whole document in main.go's wrap).
func TestRebuildRecoversFromRendererPanic(t *testing.T) {
	ctx := loadCtx(t, fourBpcRGBPDF())
	objNr := onlyImageObjNr(t, ctx)
	sd := ctx.Optimize.ImageObjects[objNr].ImageDict
	newSD, err := rebuild(ctx, sd, objNr, Decision{Resample: true, NewW: 600, NewH: 600}, DefaultOptions())
	if err == nil {
		t.Fatal("want an error from the panicking renderer, got nil")
	}
	if newSD != nil {
		t.Fatalf("want a nil stream dict on failure, got %+v", newSD)
	}
}

// TestRunSkipsFourBpcBeforeDecode: in the normal Run path the bpc rule keeps the
// panicking image away from the decoder entirely.
func TestRunSkipsFourBpcBeforeDecode(t *testing.T) {
	st, out := roundTrip(t, fourBpcRGBPDF(), DefaultOptions())
	if st.Considered != 1 || st.Resampled != 0 || st.Skipped != 1 {
		t.Fatalf("stats %+v, want 1 considered / 0 resampled / 1 skipped", st)
	}
	ctx2 := loadCtx(t, out)
	sd := ctx2.Optimize.ImageObjects[onlyImageObjNr(t, ctx2)].ImageDict
	if b := sd.IntEntry("BitsPerComponent"); b == nil || *b != 4 {
		t.Fatalf("BitsPerComponent=%v, want the untouched 4", b)
	}
}

// TestRunSurvivesUndecodableImage: a DeviceRGB Flate image whose stream decodes to far
// fewer bytes than Width*Height*3. The failure must stay scoped to that one image and
// the document must still be writable — "per-image failures never fail the document".
func TestRunSurvivesUndecodableImage(t *testing.T) {
	var flate bytes.Buffer
	zw := newFlateWriter(&flate)
	zw.Write(make([]byte, 100)) // 100 bytes where 1200*1200*3 are declared
	zw.Close()
	in := buildPDF([]obj{
		{dict: "/Type /Catalog /Pages 2 0 R"},
		{dict: "/Type /Pages /Kids [3 0 R] /Count 1"},
		{dict: "/Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources <</XObject <</Im1 5 0 R>> >> /Contents 4 0 R"},
		{dict: "", stream: []byte("q 288 0 0 288 162 252 cm /Im1 Do Q")},
		{dict: "/Type /XObject /Subtype /Image /Width 1200 /Height 1200 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode", stream: flate.Bytes()},
	})
	ctx := loadCtx(t, in)
	st, err := Run(ctx, DefaultOptions())
	if err != nil {
		t.Fatalf("Run must not fail the document for one bad image: %v", err)
	}
	if st.Considered != 1 || st.Resampled != 0 || st.Skipped != 1 {
		t.Fatalf("stats %+v, want 1 considered / 0 resampled / 1 skipped", st)
	}
	var out bytes.Buffer
	if err := api.WriteContext(ctx, &out); err != nil {
		t.Fatalf("WriteContext: %v", err)
	}
}

func TestRunResamplesOverResolvedJPEG(t *testing.T) {
	// 1200 px into 4 in = 300 dpi → 600 px at 150 dpi.
	in := singleImagePDF(t, photo(1200, 1200), "q 288 0 0 288 162 252 cm /Im1 Do Q")
	st, out := roundTripInspect(t, in, DefaultOptions(), func(ctx *model.Context) {
		// The decoded-sample cache must be released as soon as the image is rebuilt,
		// not held until WriteContext finishes.
		sd := ctx.Optimize.ImageObjects[onlyImageObjNr(t, ctx)].ImageDict
		if sd.Content != nil {
			t.Errorf("swapped-in dict retains %d bytes of decoded Content", len(sd.Content))
		}
	})
	if st.Resampled != 1 || st.Considered != 1 {
		t.Fatalf("stats %+v, want 1 considered / 1 resampled", st)
	}
	if len(out) >= len(in) {
		t.Fatalf("output %d bytes not smaller than input %d", len(out), len(in))
	}
	ctx2 := loadCtx(t, out) // also validates the output
	sd := ctx2.Optimize.ImageObjects[onlyImageObjNr(t, ctx2)].ImageDict
	if w := sd.IntEntry("Width"); w == nil || *w != 600 {
		t.Fatalf("Width=%v, want 600", w)
	}
	if f := sd.NameEntry("Filter"); f == nil || *f != "DCTDecode" {
		t.Fatalf("Filter=%v, want DCTDecode for photographic content", f)
	}
}

func TestRunLeavesImagesAtOrBelowThresholdUntouched(t *testing.T) {
	// 1200 px into 8 in = 150 dpi → pass-through, bytes identical to plain optimize.
	in := singleImagePDF(t, photo(1200, 1200), "q 576 0 0 576 18 108 cm /Im1 Do Q")
	st, out := roundTrip(t, in, DefaultOptions())
	if st.Resampled != 0 {
		t.Fatalf("stats %+v, want nothing resampled", st)
	}
	ctx := loadCtx(t, in)
	var plain bytes.Buffer
	if err := api.WriteContext(ctx, &plain); err != nil {
		t.Fatal(err)
	}
	// pdfcpu stamps write-time metadata (ModDate, Producer, file ID) that differs
	// between two independent writes even when neither touches image content, so
	// byte-equality between the two outputs doesn't hold. Instead assert the
	// encoded image content is identical between them.
	ctx2 := loadCtx(t, out)
	sd := ctx2.Optimize.ImageObjects[onlyImageObjNr(t, ctx2)].ImageDict
	if w := sd.IntEntry("Width"); w == nil || *w != 1200 {
		t.Fatalf("Width=%v, want untouched 1200", w)
	}
	if f := sd.NameEntry("Filter"); f == nil || *f != "DCTDecode" {
		t.Fatalf("Filter=%v, want untouched DCTDecode", f)
	}
	ctxPlain := loadCtx(t, plain.Bytes())
	sdPlain := ctxPlain.Optimize.ImageObjects[onlyImageObjNr(t, ctxPlain)].ImageDict
	if len(sd.Raw) != len(sdPlain.Raw) {
		t.Fatalf("images-preset raw len %d != lossless-optimize raw len %d", len(sd.Raw), len(sdPlain.Raw))
	}
}

func TestRunSkipsSoftMaskedImageAndItsMask(t *testing.T) {
	// /Im1 (obj 5) carries /SMask 6 0 R; both are over-resolved but must stay untouched.
	img := imageObj(t, photo(1200, 1200))
	img.dict += " /SMask 6 0 R"
	gray := obj{
		dict:   "/Type /XObject /Subtype /Image /Width 1200 /Height 1200 /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /DCTDecode",
		stream: jpegBytes(t, photo(1200, 1200), 90),
	}
	in := buildPDF([]obj{
		{dict: "/Type /Catalog /Pages 2 0 R"},
		{dict: "/Type /Pages /Kids [3 0 R] /Count 1"},
		{dict: "/Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources <</XObject <</Im1 5 0 R>> >> /Contents 4 0 R"},
		{dict: "", stream: []byte("q 288 0 0 288 162 252 cm /Im1 Do Q")},
		img,
		gray,
	})
	st, out := roundTrip(t, in, DefaultOptions())
	if st.Resampled != 0 {
		t.Fatalf("stats %+v, want nothing resampled", st)
	}
	ctx2 := loadCtx(t, out)
	for objNr, io := range ctx2.Optimize.ImageObjects {
		if w := io.ImageDict.IntEntry("Width"); w == nil || *w != 1200 {
			t.Fatalf("obj %d Width=%v, want untouched 1200", objNr, w)
		}
	}
}

// TestRunGrayFlateStaysGray: pdfcpu's gray renderer emits an RGB PNG, so a decoded
// DeviceGray scan arrives as a colour image and used to be re-encoded as 3-channel
// DeviceRGB Flate — triple the samples of the correct gray JPEG. The pass must detect
// the neutral pixels and keep the image DeviceGray/DCTDecode.
func TestRunGrayFlateStaysGray(t *testing.T) {
	rnd := rand.New(rand.NewSource(7))
	raw := make([]byte, 0, 1200*1200)
	for y := 0; y < 1200; y++ {
		for x := 0; x < 1200; x++ {
			v := (x*255/1200 + y*255/1200) / 2 + rnd.Intn(24) // gradient + noise: >64 levels
			if v > 255 {
				v = 255
			}
			raw = append(raw, byte(v))
		}
	}
	var flate bytes.Buffer
	zw := newFlateWriter(&flate)
	zw.Write(raw)
	zw.Close()
	in := buildPDF([]obj{
		{dict: "/Type /Catalog /Pages 2 0 R"},
		{dict: "/Type /Pages /Kids [3 0 R] /Count 1"},
		{dict: "/Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources <</XObject <</Im1 5 0 R>> >> /Contents 4 0 R"},
		{dict: "", stream: []byte("q 288 0 0 288 162 252 cm /Im1 Do Q")},
		{dict: "/Type /XObject /Subtype /Image /Width 1200 /Height 1200 /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode", stream: flate.Bytes()},
	})
	st, out := roundTrip(t, in, DefaultOptions())
	if st.Considered != 1 || st.Resampled != 1 {
		t.Fatalf("stats %+v, want 1 considered / 1 resampled", st)
	}
	if len(out) >= len(in) {
		t.Fatalf("output %d bytes not smaller than input %d", len(out), len(in))
	}
	ctx2 := loadCtx(t, out)
	sd := ctx2.Optimize.ImageObjects[onlyImageObjNr(t, ctx2)].ImageDict
	if cs := sd.NameEntry("ColorSpace"); cs == nil || *cs != model.DeviceGrayCS {
		t.Fatalf("ColorSpace=%v, want DeviceGray", cs)
	}
	if f := sd.NameEntry("Filter"); f == nil || *f != "DCTDecode" {
		t.Fatalf("Filter=%v, want DCTDecode for a noisy gray scan", f)
	}
	if w := sd.IntEntry("Width"); w == nil || *w != 600 {
		t.Fatalf("Width=%v, want 600", w)
	}
}

// TestRunPreservesOptionalContentRef: /OC marks an image as belonging to an optional
// content group, so dropping it when the dict is rebuilt would make a hidden layer
// permanently visible. The replacement dict must carry the reference over.
func TestRunPreservesOptionalContentRef(t *testing.T) {
	img := imageObj(t, photo(1200, 1200))
	img.dict += " /OC 6 0 R"
	in := buildPDF([]obj{
		{dict: "/Type /Catalog /Pages 2 0 R /OCProperties <</OCGs [6 0 R] /D <</Order [6 0 R] /ON [6 0 R]>> >>"},
		{dict: "/Type /Pages /Kids [3 0 R] /Count 1"},
		{dict: "/Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources <</XObject <</Im1 5 0 R>> >> /Contents 4 0 R"},
		{dict: "", stream: []byte("q 288 0 0 288 162 252 cm /Im1 Do Q")},
		img,
		{dict: "/Type /OCG /Name (Layer)"},
	})
	st, out := roundTrip(t, in, DefaultOptions())
	if st.Resampled != 1 {
		t.Fatalf("stats %+v, want 1 resampled", st)
	}
	ctx2 := loadCtx(t, out)
	sd := ctx2.Optimize.ImageObjects[onlyImageObjNr(t, ctx2)].ImageDict
	if w := sd.IntEntry("Width"); w == nil || *w != 600 {
		t.Fatalf("Width=%v, want 600", w)
	}
	if _, found := sd.Find("OC"); !found {
		t.Fatalf("replacement dict dropped /OC: %v", sd.Dict)
	}
}

// TestRunSkipsImageWithDecodeArray: a non-default /Decode inverts the samples, and
// pdfcpu's renderers don't honour it for RGB/DCT input, so a rebuilt image would come
// out un-inverted. Plan must skip these outright.
func TestRunSkipsImageWithDecodeArray(t *testing.T) {
	img := imageObj(t, photo(1200, 1200))
	img.dict += " /Decode [1 0 1 0 1 0]"
	in := buildPDF([]obj{
		{dict: "/Type /Catalog /Pages 2 0 R"},
		{dict: "/Type /Pages /Kids [3 0 R] /Count 1"},
		{dict: "/Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources <</XObject <</Im1 5 0 R>> >> /Contents 4 0 R"},
		{dict: "", stream: []byte("q 288 0 0 288 162 252 cm /Im1 Do Q")},
		img,
	})
	st, out := roundTrip(t, in, DefaultOptions())
	if st.Considered != 1 || st.Resampled != 0 || st.Skipped != 1 {
		t.Fatalf("stats %+v, want 1 considered / 0 resampled / 1 skipped", st)
	}
	ctx2 := loadCtx(t, out)
	sd := ctx2.Optimize.ImageObjects[onlyImageObjNr(t, ctx2)].ImageDict
	if w := sd.IntEntry("Width"); w == nil || *w != 1200 {
		t.Fatalf("Width=%v, want untouched 1200", w)
	}
}

func TestRunNeverGrowsAnImage(t *testing.T) {
	// Every row is the same 256-colour ramp, so Flate squeezes the 1200×1200 original down
	// to a few KB — yet the image has 256 distinct colours and is classified photographic.
	// Resampling to 600 px and JPEG-encoding produces far more bytes than the original, so
	// the pass must recognise the growth and keep the original stream untouched.
	raw := make([]byte, 0, 1200*1200*3)
	for y := 0; y < 1200; y++ {
		for x := 0; x < 1200; x++ {
			raw = append(raw, byte(x%256), 128, byte((x*7)%256))
		}
	}
	var flate bytes.Buffer
	zw := newFlateWriter(&flate)
	zw.Write(raw)
	zw.Close()
	in := buildPDF([]obj{
		{dict: "/Type /Catalog /Pages 2 0 R"},
		{dict: "/Type /Pages /Kids [3 0 R] /Count 1"},
		{dict: "/Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources <</XObject <</Im1 5 0 R>> >> /Contents 4 0 R"},
		{dict: "", stream: []byte("q 288 0 0 288 162 252 cm /Im1 Do Q")},
		{dict: "/Type /XObject /Subtype /Image /Width 1200 /Height 1200 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode", stream: flate.Bytes()},
	})
	st, out := roundTripInspect(t, in, DefaultOptions(), func(ctx *model.Context) {
		// Even on the keep-the-original path the decode cache must be released.
		sd := ctx.Optimize.ImageObjects[onlyImageObjNr(t, ctx)].ImageDict
		if sd.Content != nil {
			t.Errorf("kept original retains %d bytes of decoded Content", len(sd.Content))
		}
	})
	if st.Considered != 1 || st.Resampled != 0 || st.Skipped != 1 {
		t.Fatalf("stats %+v, want 1 considered / 0 resampled / 1 skipped (re-encode would grow the image)", st)
	}
	if st.BytesBefore != 0 || st.BytesAfter != 0 {
		t.Fatalf("stats %+v, want no byte accounting for a kept image", st)
	}
	ctx2 := loadCtx(t, out)
	sd := ctx2.Optimize.ImageObjects[onlyImageObjNr(t, ctx2)].ImageDict
	if w := sd.IntEntry("Width"); w == nil || *w != 1200 {
		t.Fatalf("Width=%v, want untouched 1200", w)
	}
	if f := sd.NameEntry("Filter"); f == nil || *f != "FlateDecode" {
		t.Fatalf("Filter=%v, want the original FlateDecode stream kept", f)
	}
}
