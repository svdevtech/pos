package domain

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// A happy hour that runs past midnight (a bar's 22:00-01:00) has to be open on both sides of it.
func TestMenuPromoRunsAtOverMidnight(t *testing.T) {
	tz, err := time.LoadLocation("Asia/Bangkok")
	require.NoError(t, err)
	at := func(hh, mm int) time.Time { return time.Date(2026, 9, 15, hh, mm, 0, 0, tz) } // a Tuesday

	day := MenuPromo{IsActive: true, Days: []int{0, 1, 2, 3, 4, 5, 6}, StartTime: "14:00", EndTime: "17:00"}
	require.True(t, day.RunsAt(at(14, 0)))
	require.True(t, day.RunsAt(at(16, 59)))
	require.False(t, day.RunsAt(at(13, 59)))
	require.False(t, day.RunsAt(at(17, 1)))

	night := MenuPromo{IsActive: true, Days: []int{0, 1, 2, 3, 4, 5, 6}, StartTime: "22:00", EndTime: "01:00"}
	require.True(t, night.RunsAt(at(22, 0)))
	require.True(t, night.RunsAt(at(23, 59)))
	require.True(t, night.RunsAt(at(0, 30)))
	require.True(t, night.RunsAt(at(1, 0)))
	require.False(t, night.RunsAt(at(1, 1)))
	require.False(t, night.RunsAt(at(21, 59)))
}
