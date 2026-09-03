package imgopt

import (
	"errors"
	"math"

	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/model"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/types"
)

// matrix is a PDF transformation matrix [a b c d e f].
type matrix [6]float64

var identity = matrix{1, 0, 0, 1, 0, 0}

// mul returns m × n, i.e. "apply m, then n". PDF's cm operator sets CTM' = cm × CTM.
func mul(m, n matrix) matrix {
	return matrix{
		m[0]*n[0] + m[1]*n[2], m[0]*n[1] + m[1]*n[3],
		m[2]*n[0] + m[3]*n[2], m[2]*n[1] + m[3]*n[3],
		m[4]*n[0] + m[5]*n[2] + n[4], m[4]*n[1] + m[5]*n[3] + n[5],
	}
}

// footprint is the size in points of the unit square (an image's coordinate space) under m.
func (m matrix) footprint() (w, h float64) {
	return math.Hypot(m[0], m[1]), math.Hypot(m[2], m[3])
}

const maxFormDepth = 8

// ScanPlacements walks every page's content (and nested Form XObjects) and returns,
// per image object number, the largest footprint at which it is drawn. Pages whose
// content cannot be read are skipped: placement is a hint, not a requirement.
func ScanPlacements(ctx *model.Context) (map[int]Placement, error) {
	if ctx == nil || ctx.XRefTable == nil {
		return nil, errors.New("imgopt: nil context")
	}
	out := map[int]Placement{}
	for pageNr := 1; pageNr <= ctx.PageCount; pageNr++ {
		d, _, inh, err := ctx.PageDict(pageNr, false)
		if err != nil || d == nil {
			continue
		}
		content, err := ctx.PageContent(d, pageNr)
		if err != nil {
			continue // includes model.ErrNoContent
		}
		walk(ctx, content, pageResources(ctx, d, inh), identity, 0, map[int]bool{}, out)
	}
	return out, nil
}

func pageResources(ctx *model.Context, d types.Dict, inh *model.InheritedPageAttrs) types.Dict {
	if o, ok := d.Find("Resources"); ok {
		if r, err := ctx.DereferenceDict(o); err == nil && r != nil {
			return r
		}
	}
	if inh != nil {
		return inh.Resources
	}
	return nil
}

func xobjectDict(ctx *model.Context, res types.Dict) types.Dict {
	if res == nil {
		return nil
	}
	o, found := res.Find("XObject")
	if !found {
		return nil
	}
	d, err := ctx.DereferenceDict(o)
	if err != nil {
		return nil
	}
	return d
}

func num(o types.Object) (float64, bool) {
	switch v := o.(type) {
	case types.Integer:
		return float64(v.Value()), true
	case types.Float:
		return v.Value(), true
	}
	return 0, false
}

func matrixFrom(operands []token) (matrix, bool) {
	if len(operands) < 6 {
		return identity, false
	}
	var m matrix
	for i, tok := range operands[len(operands)-6:] {
		if tok.kind != tokNumber {
			return identity, false
		}
		m[i] = tok.num
	}
	return m, true
}

func lastName(operands []token) (string, bool) {
	if n := len(operands); n > 0 && operands[n-1].kind == tokName {
		return operands[n-1].val, true
	}
	return "", false
}

// walk interprets one content stream, tracking the CTM through q/Q/cm and
// recording image footprints at every Do.
func walk(ctx *model.Context, content []byte, res types.Dict, ctm matrix, depth int, visiting map[int]bool, out map[int]Placement) {
	if depth > maxFormDepth {
		return
	}
	xobjs := xobjectDict(ctx, res)
	var stack []matrix
	var operands []token
	lx := newLexer(content)
	for {
		tok, ok := lx.next()
		if !ok {
			return
		}
		if tok.kind != tokOperator {
			operands = append(operands, tok)
			if len(operands) > 32 {
				operands = operands[1:]
			}
			continue
		}
		switch tok.val {
		case "q":
			stack = append(stack, ctm)
		case "Q":
			if n := len(stack); n > 0 {
				ctm = stack[n-1]
				stack = stack[:n-1]
			}
		case "cm":
			if m, ok := matrixFrom(operands); ok {
				ctm = mul(m, ctm)
			}
		case "Do":
			if name, ok := lastName(operands); ok && xobjs != nil {
				doXObject(ctx, xobjs, name, res, ctm, depth, visiting, out)
			}
		case "BI":
			lx.skipInlineImage()
		}
		operands = operands[:0]
	}
}

func doXObject(ctx *model.Context, xobjs types.Dict, name string, parentRes types.Dict, ctm matrix, depth int, visiting map[int]bool, out map[int]Placement) {
	o, found := xobjs.Find(name)
	if !found {
		return
	}
	ir, ok := o.(types.IndirectRef)
	if !ok {
		return
	}
	objNr := ir.ObjectNumber.Value()
	sd, _, err := ctx.DereferenceStreamDict(o)
	if err != nil || sd == nil {
		return
	}
	sub := sd.Subtype()
	if sub == nil {
		return
	}
	switch *sub {
	case "Image":
		w, h := ctm.footprint()
		p := out[objNr]
		if w*h > p.WidthPt*p.HeightPt {
			out[objNr] = Placement{WidthPt: w, HeightPt: h}
		}
	case "Form":
		if visiting[objNr] {
			return // self-referencing form
		}
		visiting[objNr] = true
		defer delete(visiting, objNr)
		m := identity
		if a := sd.ArrayEntry("Matrix"); len(a) == 6 {
			var fm matrix
			okAll := true
			for i, e := range a {
				v, ok := num(e)
				if !ok {
					okAll = false
					break
				}
				fm[i] = v
			}
			if okAll {
				m = fm
			}
		}
		res := parentRes
		if o, ok := sd.Find("Resources"); ok {
			if r, err := ctx.DereferenceDict(o); err == nil && r != nil {
				res = r
			}
		}
		if err := sd.Decode(); err != nil {
			return
		}
		walk(ctx, sd.Content, res, mul(m, ctm), depth+1, visiting, out)
	}
}
