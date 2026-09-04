// Package promptpay builds the EMVCo QR payload that Thai banking apps read as a PromptPay transfer.
//
// The string is a chain of tag-length-value groups ("00" "02" "01" …) ending with a CRC over
// everything before it. Banks are strict: a wrong length byte or a lower-case checksum makes the
// app say the code is unreadable, so the encoder here is deliberately literal.
package promptpay

import (
	"errors"
	"fmt"
	"strings"
	"unicode"

	"github.com/shopspring/decimal"
)

// Application id of the PromptPay scheme, carried inside tag 29.
const aid = "A000000677010111"

var (
	ErrTarget = errors.New("promptpay: id must be a 10-digit phone, a 13-digit national/tax id or a 15-digit e-wallet id")
	ErrAmount = errors.New("promptpay: amount out of range")
)

// Target is the account the money goes to, already normalised for the QR.
type Target struct {
	// Tag inside the merchant-account template: 01 phone, 02 national id, 03 e-wallet.
	Tag   string
	Value string
	// Kind is for humans ("phone", "national_id", "ewallet").
	Kind string
}

// ParseTarget accepts what a shopkeeper would actually type: a phone number with or without
// dashes, a citizen/tax id, or an e-wallet id.
func ParseTarget(raw string) (Target, error) {
	digits := strings.Map(func(r rune) rune {
		if unicode.IsDigit(r) {
			return r
		}
		return -1
	}, raw)

	switch {
	case len(digits) == 10 && strings.HasPrefix(digits, "0"):
		// 0812345678 → 0066812345678 (country code, left-padded to 13)
		return Target{Tag: "01", Value: "0066" + digits[1:], Kind: "phone"}, nil
	case len(digits) == 11 && strings.HasPrefix(digits, "66"):
		return Target{Tag: "01", Value: "00" + digits, Kind: "phone"}, nil
	case len(digits) == 13:
		return Target{Tag: "02", Value: digits, Kind: "national_id"}, nil
	case len(digits) == 15:
		return Target{Tag: "03", Value: digits, Kind: "ewallet"}, nil
	}
	return Target{}, ErrTarget
}

func field(tag, value string) string {
	return fmt.Sprintf("%s%02d%s", tag, len(value), value)
}

// Payload renders the QR string. An amount of zero produces a static code the payer types the
// amount into; a positive amount produces a one-off code for exactly that bill.
func Payload(t Target, amount decimal.Decimal, merchantName string) (string, error) {
	if amount.IsNegative() || amount.GreaterThan(decimal.NewFromInt(9999999999)) {
		return "", ErrAmount
	}
	var b strings.Builder
	b.WriteString(field("00", "01"))
	if amount.IsPositive() {
		b.WriteString(field("01", "12")) // dynamic: one payment of this amount
	} else {
		b.WriteString(field("01", "11")) // static: reusable
	}
	b.WriteString(field("29", field("00", aid)+field(t.Tag, t.Value)))
	b.WriteString(field("53", "764")) // THB
	if amount.IsPositive() {
		b.WriteString(field("54", amount.Round(2).StringFixed(2)))
	}
	b.WriteString(field("58", "TH"))
	if name := sanitiseName(merchantName); name != "" {
		b.WriteString(field("59", name))
	}
	body := b.String() + "6304"
	return body + fmt.Sprintf("%04X", crc16(body)), nil
}

// sanitiseName keeps tag 59 within the 25 ASCII characters banks accept. Thai shop names cannot be
// carried here, so anything non-ASCII is dropped rather than mangled.
func sanitiseName(s string) string {
	var b strings.Builder
	for _, r := range s {
		if r < 32 || r > 126 {
			continue
		}
		b.WriteRune(r)
	}
	out := strings.Join(strings.Fields(b.String()), " ")
	if len(out) > 25 {
		out = strings.TrimSpace(out[:25])
	}
	return out
}

// crc16 is CRC-16/CCITT-FALSE, the checksum the EMVCo QR specification mandates.
func crc16(s string) uint16 {
	crc := uint16(0xFFFF)
	for i := 0; i < len(s); i++ {
		crc ^= uint16(s[i]) << 8
		for bit := 0; bit < 8; bit++ {
			if crc&0x8000 != 0 {
				crc = crc<<1 ^ 0x1021
			} else {
				crc <<= 1
			}
		}
	}
	return crc
}
