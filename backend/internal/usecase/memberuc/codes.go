package memberuc

import (
	"regexp"
	"strconv"
	"strings"
)

// memberCodePrefix is prepended to auto-generated member codes.
const memberCodePrefix = "M"

var numericMemberCode = regexp.MustCompile(`^[Mm]?([0-9]{1,15})$`)

// NumericMemberCode extracts the numeric part of a member code of the form "123" or "M123".
// It mirrors the SQL used by MemberRepo.MaxNumericCode.
func NumericMemberCode(code string) (int64, bool) {
	m := numericMemberCode.FindStringSubmatch(strings.TrimSpace(code))
	if m == nil {
		return 0, false
	}
	n, err := strconv.ParseInt(m[1], 10, 64)
	if err != nil {
		return 0, false
	}
	return n, true
}

// NextMemberCode builds the auto-generated code that follows the largest numeric code in the store.
func NextMemberCode(maxNumeric int64) string {
	if maxNumeric < 0 {
		maxNumeric = 0
	}
	return memberCodePrefix + strconv.FormatInt(maxNumeric+1, 10)
}

// MaxNumericCode returns the largest numeric code among the given codes (0 when none are numeric).
func MaxNumericCode(codes []string) int64 {
	var max int64
	for _, c := range codes {
		if n, ok := NumericMemberCode(c); ok && n > max {
			max = n
		}
	}
	return max
}

// NormalizeMemberCode trims and upper-cases a user-supplied code.
func NormalizeMemberCode(code string) string { return strings.ToUpper(strings.TrimSpace(code)) }

// NormalizePhone strips spaces and dashes so "081-234 5678" matches "0812345678".
func NormalizePhone(p string) string {
	return strings.NewReplacer(" ", "", "-", "", "(", "", ")", "").Replace(strings.TrimSpace(p))
}
