package data

import (
	"math"
	"time"
)

// Trend describes the direction/magnitude of change across a series.
type Trend struct {
	First       float64 `json:"first"`
	Last        float64 `json:"last"`
	Change      float64 `json:"change"`      // last - first
	PercentDiff float64 `json:"percentDiff"` // % change vs first
	SlopePerDay float64 `json:"slopePerDay"` // linear-regression slope
	Direction   string  `json:"direction"`   // up | down | flat
}

// Forecast holds a projected value with a naive confidence band.
type Forecast struct {
	Date  string  `json:"date"`
	Value float64 `json:"value"`
}

// linreg fits value = a + b*x where x is day-index, returning slope b and intercept a.
func linreg(dates []string, values []float64) (slope, intercept float64) {
	n := len(values)
	if n < 2 {
		return 0, 0
	}
	base, _ := time.Parse("2006-01-02", dates[0])
	var sx, sy, sxx, sxy float64
	for i := 0; i < n; i++ {
		d, err := time.Parse("2006-01-02", dates[i])
		x := float64(i)
		if err == nil {
			x = d.Sub(base).Hours() / 24.0
		}
		y := values[i]
		sx += x
		sy += y
		sxx += x * x
		sxy += x * y
	}
	nf := float64(n)
	denom := nf*sxx - sx*sx
	if denom == 0 {
		return 0, sy / nf
	}
	slope = (nf*sxy - sx*sy) / denom
	intercept = (sy - slope*sx) / nf
	return slope, intercept
}

// ComputeTrend summarizes a date/value series. lowerIsBetter flips the "improving" label.
func ComputeTrend(dates []string, values []float64) Trend {
	if len(values) == 0 {
		return Trend{}
	}
	first := values[0]
	last := values[len(values)-1]
	change := last - first
	pct := 0.0
	if first != 0 {
		pct = change / math.Abs(first) * 100
	}
	slope, _ := linreg(dates, values)
	dir := "flat"
	if math.Abs(change) > 1e-9 {
		if change > 0 {
			dir = "up"
		} else {
			dir = "down"
		}
	}
	return Trend{
		First:       round(first, 2),
		Last:        round(last, 2),
		Change:      round(change, 2),
		PercentDiff: round(pct, 1),
		SlopePerDay: round(slope, 4),
		Direction:   dir,
	}
}

// ForecastSeries projects `days` future points using linear regression.
func ForecastSeries(dates []string, values []float64, days int) []Forecast {
	if len(values) < 2 {
		return nil
	}
	slope, intercept := linreg(dates, values)
	base, _ := time.Parse("2006-01-02", dates[0])
	lastDate, _ := time.Parse("2006-01-02", dates[len(dates)-1])
	out := []Forecast{}
	for i := 1; i <= days; i++ {
		d := lastDate.AddDate(0, 0, i)
		x := d.Sub(base).Hours() / 24.0
		out = append(out, Forecast{
			Date:  d.Format("2006-01-02"),
			Value: round(intercept+slope*x, 2),
		})
	}
	return out
}

// RiegelFatigueFactor is the exponent in Riegel's race-time model, T2 = T1 * (D2/D1)^factor,
// which captures that pace naturally slows as distance grows even at equal effort/fitness.
const RiegelFatigueFactor = 1.06

// DistanceAdjustedPace rescales a pace run at distKm to the equivalent pace at refDistKm,
// using Riegel's formula. This lets races of different lengths (e.g. a 5K and a 10K) be
// compared on a level footing: raw pace always looks "worse" over longer distances even
// when the underlying fitness/effort is identical, so comparisons must correct for that
// before treating a pace difference as an improvement or regression.
func DistanceAdjustedPace(paceSecKm, distKm, refDistKm float64) float64 {
	if paceSecKm <= 0 || distKm <= 0 || refDistKm <= 0 {
		return paceSecKm
	}
	return paceSecKm * math.Pow(refDistKm/distKm, RiegelFatigueFactor-1)
}

func round(f float64, places int) float64 {
	p := math.Pow(10, float64(places))
	return math.Round(f*p) / p
}

// RoundExport rounds f to the given number of decimal places (exported helper).
func RoundExport(f float64, places int) float64 { return round(f, places) }

// Avg returns the mean of a slice (0 if empty).
func Avg(vals []float64) float64 {
	if len(vals) == 0 {
		return 0
	}
	var s float64
	for _, v := range vals {
		s += v
	}
	return round(s/float64(len(vals)), 2)
}

// LatestNonZero returns the last non-zero value in a slice.
func LatestNonZero(vals []float64) float64 {
	for i := len(vals) - 1; i >= 0; i-- {
		if vals[i] != 0 {
			return vals[i]
		}
	}
	return 0
}
