package imgopt

import "testing"

func TestPlanResamplesOverResolvedImage(t *testing.T) {
	// 1200 px drawn into 288 pt (4 in) = 300 dpi effective; target 150 × 1.5 = 225 → resample to 600 px.
	d := Plan(ImageInfo{Width: 1200, Height: 1200, BPC: 8, Filter: "DCTDecode"}, &Placement{288, 288}, DefaultOptions())
	if !d.Resample || d.NewW != 600 || d.NewH != 600 {
		t.Fatalf("got %+v, want resample to 600x600", d)
	}
}

func TestPlanLeavesImagesUnderThreshold(t *testing.T) {
	// 1200 px over 432 pt (6 in) = 200 dpi < 225 → pass through untouched.
	d := Plan(ImageInfo{Width: 1200, Height: 1200, BPC: 8, Filter: "DCTDecode"}, &Placement{432, 432}, DefaultOptions())
	if d.Resample || d.Reason != "resolution-ok" {
		t.Fatalf("got %+v, want no resample (resolution-ok)", d)
	}
}

func TestPlanUsesLongEdgeCapWithoutPlacement(t *testing.T) {
	d := Plan(ImageInfo{Width: 4000, Height: 3000, BPC: 8, Filter: "DCTDecode"}, nil, DefaultOptions())
	if !d.Resample || d.NewW != 2000 || d.NewH != 1500 {
		t.Fatalf("got %+v, want 2000x1500", d)
	}
	d = Plan(ImageInfo{Width: 1800, Height: 1200, BPC: 8, Filter: "DCTDecode"}, nil, DefaultOptions())
	if d.Resample {
		t.Fatalf("got %+v, want no resample under the 2000 px cap", d)
	}
}

func TestPlanAnisotropicPlacementUsesWorstAxis(t *testing.T) {
	// Squashed horizontally: 1200 px over 144 pt = 600 dpi wide, 300 dpi tall → scale by 150/600.
	d := Plan(ImageInfo{Width: 1200, Height: 1200, BPC: 8}, &Placement{144, 288}, DefaultOptions())
	if !d.Resample || d.NewW != 300 || d.NewH != 300 {
		t.Fatalf("got %+v, want 300x300", d)
	}
}

func TestPlanSkipRules(t *testing.T) {
	big := &Placement{72, 72} // 1 inch: every 1200 px image below is hugely over-resolved
	cases := []struct {
		name string
		img  ImageInfo
		want string
	}{
		{"image mask", ImageInfo{Width: 1200, Height: 1200, BPC: 1, IsMask: true}, "mask"},
		{"has smask", ImageInfo{Width: 1200, Height: 1200, BPC: 8, HasSMask: true}, "mask"},
		{"has mask", ImageInfo{Width: 1200, Height: 1200, BPC: 8, HasMask: true}, "mask"},
		{"decode array", ImageInfo{Width: 1200, Height: 1200, BPC: 8, HasDecode: true}, "decode"},
		{"jpx", ImageInfo{Width: 1200, Height: 1200, BPC: 8, Filter: "JPXDecode"}, "undecodable"},
		{"jbig2", ImageInfo{Width: 1200, Height: 1200, BPC: 1, Filter: "JBIG2Decode"}, "undecodable"},
		{"bilevel", ImageInfo{Width: 1200, Height: 1200, BPC: 1, Filter: "CCITTFaxDecode"}, "bilevel"},
		{"16 bpc", ImageInfo{Width: 1200, Height: 1200, BPC: 16, Filter: "FlateDecode"}, "bpc"},
		{"4 bpc rgb", ImageInfo{Width: 1200, Height: 1200, BPC: 4, Filter: "FlateDecode"}, "bpc"},
		{"tiny", ImageInfo{Width: 32, Height: 1200, BPC: 8}, "tiny"},
		{"too large", ImageInfo{Width: 9000, Height: 9000, BPC: 8}, "too-large"},
	}
	for _, c := range cases {
		if d := Plan(c.img, big, DefaultOptions()); d.Resample || d.Reason != c.want {
			t.Errorf("%s: got %+v, want skip reason %q", c.name, d, c.want)
		}
	}
}
