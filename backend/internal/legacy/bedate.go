package legacy

import (
	"regexp"
	"strconv"
	"strings"
	"time"
)

var beDateRx = regexp.MustCompile(`^(\d{1,2})/(\d{1,2})/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$`)

// ParseBEDateTime parses legacy text timestamps like "2/1/2563  14:42:36" (d/M/BEyyyy H:mm:ss, Thai
// Buddhist year) into Bangkok time. Gregorian years (< 2400) are accepted as-is.
func ParseBEDateTime(s string) (time.Time, bool) {
	s = strings.TrimSpace(s)
	m := beDateRx.FindStringSubmatch(s)
	if m == nil {
		return time.Time{}, false
	}
	d, _ := strconv.Atoi(m[1])
	mo, _ := strconv.Atoi(m[2])
	y, _ := strconv.Atoi(m[3])
	if y >= 2400 {
		y -= 543
	}
	h, mi, se := 0, 0, 0
	if m[4] != "" {
		h, _ = strconv.Atoi(m[4])
		mi, _ = strconv.Atoi(m[5])
		if m[6] != "" {
			se, _ = strconv.Atoi(m[6])
		}
	}
	if mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || se > 59 {
		return time.Time{}, false
	}
	return time.Date(y, time.Month(mo), d, h, mi, se, 0, Bangkok), true
}

// CombineDateTime merges a date with a legacy text time "H:mm" or "H:mm:ss".
func CombineDateTime(date time.Time, clock string) time.Time {
	clock = strings.TrimSpace(clock)
	parts := strings.Split(clock, ":")
	h, mi, se := 0, 0, 0
	if len(parts) >= 2 {
		h, _ = strconv.Atoi(parts[0])
		mi, _ = strconv.Atoi(parts[1])
		if len(parts) >= 3 {
			se, _ = strconv.Atoi(parts[2])
		}
	}
	if h > 23 || mi > 59 || se > 59 {
		h, mi, se = 0, 0, 0
	}
	return time.Date(date.Year(), date.Month(), date.Day(), h, mi, se, 0, Bangkok)
}

// PeriodFromDocNo extracts the BE yyMM period from a legacy document number (N6602-05115 → "6602").
func PeriodFromDocNo(doc string) (period string, seq int, ok bool) {
	i := strings.Index(doc, "-")
	if i < 4 {
		return "", 0, false
	}
	period = doc[i-4 : i]
	n, err := strconv.Atoi(doc[i+1:])
	if err != nil {
		return "", 0, false
	}
	return period, n, true
}
