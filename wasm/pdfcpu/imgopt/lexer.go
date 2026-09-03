package imgopt

import (
	"strconv"
	"strings"
)

// A deliberately small content-stream tokenizer: it only needs to distinguish
// numbers, names and operators, and to skip everything else (strings, hex
// strings, dicts, arrays, comments, inline image data) without misreading
// their contents as operators.

type tokKind int

const (
	tokNumber tokKind = iota
	tokName
	tokOperator
	tokOther // string, hex string, dict/array delimiter — never an operand we care about
)

type token struct {
	kind tokKind
	val  string  // operator or name (name without the leading slash)
	num  float64 // for tokNumber
}

type lexer struct {
	b []byte
	i int
}

func newLexer(b []byte) *lexer { return &lexer{b: b} }

func isWS(c byte) bool { return c == ' ' || c == '\n' || c == '\r' || c == '\t' || c == '\f' || c == 0 }

func isDelim(c byte) bool { return strings.IndexByte("()<>[]{}/%", c) >= 0 }

func (l *lexer) next() (token, bool) {
	for l.i < len(l.b) {
		c := l.b[l.i]
		switch {
		case isWS(c):
			l.i++
		case c == '%':
			for l.i < len(l.b) && l.b[l.i] != '\n' && l.b[l.i] != '\r' {
				l.i++
			}
		case c == '(':
			l.skipString()
			return token{kind: tokOther}, true
		case c == ')':
			// A stray, unbalanced ')' — skipString never left one behind, so this is
			// malformed content. Consume it so the caller always makes progress.
			l.i++
			return token{kind: tokOther}, true
		case c == '<':
			if l.i+1 < len(l.b) && l.b[l.i+1] == '<' {
				l.i += 2
			} else {
				l.skipHex()
			}
			return token{kind: tokOther}, true
		case c == '>':
			l.i++
			if l.i < len(l.b) && l.b[l.i] == '>' {
				l.i++
			}
			return token{kind: tokOther}, true
		case c == '[' || c == ']' || c == '{' || c == '}':
			l.i++
			return token{kind: tokOther}, true
		case c == '/':
			l.i++
			start := l.i
			for l.i < len(l.b) && !isWS(l.b[l.i]) && !isDelim(l.b[l.i]) {
				l.i++
			}
			return token{kind: tokName, val: decodeName(l.b[start:l.i])}, true
		default:
			start := l.i
			for l.i < len(l.b) && !isWS(l.b[l.i]) && !isDelim(l.b[l.i]) {
				l.i++
			}
			if l.i == start {
				// Defensive: a delimiter with no case above would scan zero bytes and
				// return an empty token forever. Always advance.
				l.i++
				return token{kind: tokOther}, true
			}
			s := string(l.b[start:l.i])
			if f, err := strconv.ParseFloat(s, 64); err == nil {
				return token{kind: tokNumber, num: f}, true
			}
			return token{kind: tokOperator, val: s}, true
		}
	}
	return token{}, false
}

// decodeName expands #xx escapes (e.g. /Im#201 → "Im 1").
func decodeName(raw []byte) string {
	if !strings.Contains(string(raw), "#") {
		return string(raw)
	}
	var sb strings.Builder
	for i := 0; i < len(raw); i++ {
		if raw[i] == '#' && i+2 < len(raw) {
			if v, err := strconv.ParseUint(string(raw[i+1:i+3]), 16, 8); err == nil {
				sb.WriteByte(byte(v))
				i += 2
				continue
			}
		}
		sb.WriteByte(raw[i])
	}
	return sb.String()
}

// skipString consumes a literal string "( ... )" honouring nesting and backslash escapes.
func (l *lexer) skipString() {
	depth := 0
	for l.i < len(l.b) {
		switch l.b[l.i] {
		case '\\':
			l.i++ // skip the escaped byte
		case '(':
			depth++
		case ')':
			depth--
			if depth == 0 {
				l.i++
				return
			}
		}
		l.i++
	}
}

// skipHex consumes "< ... >".
func (l *lexer) skipHex() {
	for l.i < len(l.b) && l.b[l.i] != '>' {
		l.i++
	}
	if l.i < len(l.b) {
		l.i++
	}
}

// skipInlineImage is called right after a BI operator. It consumes the inline
// image dict, the ID operator, and the binary data up to and including EI.
func (l *lexer) skipInlineImage() {
	for {
		tok, ok := l.next()
		if !ok {
			return
		}
		if tok.kind == tokOperator && tok.val == "ID" {
			break
		}
	}
	if l.i < len(l.b) {
		l.i++ // single whitespace after ID
	}
	for j := l.i; j+1 < len(l.b); j++ {
		if l.b[j] == 'E' && l.b[j+1] == 'I' && (j == 0 || isWS(l.b[j-1])) && (j+2 == len(l.b) || isWS(l.b[j+2])) {
			l.i = j + 2
			return
		}
	}
	l.i = len(l.b)
}
