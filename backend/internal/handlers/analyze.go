package handlers

import (
	"net/http"
	"sort"

	"garmin-analyzer/internal/data"

	"github.com/gin-gonic/gin"
)

type analyzeRequest struct {
	IDs []string `json:"ids"`
}

// AnalyzeRaces compares a selected set of races and projects the next result.
func (h *Handler) AnalyzeRaces(c *gin.Context) {
	var req analyzeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}
	all := h.userRaces(c)
	sel := map[string]bool{}
	for _, id := range req.IDs {
		sel[id] = true
	}
	var races []Race
	for _, r := range all {
		if sel[r.ID] {
			races = append(races, r)
		}
	}
	if len(races) < 2 {
		c.JSON(http.StatusOK, gin.H{"races": races, "enough": false})
		return
	}
	sort.Slice(races, func(i, j int) bool { return races[i].Date < races[j].Date })

	// Races of different lengths naturally have different paces even at equal fitness
	// (a 10K is always run slower per-km than a 5K). To compare fairly across distances
	// we rescale every race's pace to what it would be at a shared reference distance —
	// the first (base) race's distance — before treating any pace gap as a real change.
	refDist := races[0].DistanceKm
	mixedDistances := false
	for _, r := range races {
		if r.DistanceKm != refDist {
			mixedDistances = true
			break
		}
	}

	dates := make([]string, len(races))
	adjPaces := make([]float64, len(races))
	times := make([]float64, len(races))
	hrs := make([]float64, 0)
	for i, r := range races {
		dates[i] = r.Date
		adjPaces[i] = data.DistanceAdjustedPace(r.AvgPaceSecKm, r.DistanceKm, refDist)
		times[i] = r.DurationSec
		if r.AvgHR > 0 {
			hrs = append(hrs, r.AvgHR)
		}
	}

	// Best / average by distance-adjusted pace, so a longer race isn't unfairly
	// penalised just for being longer.
	best := races[0]
	bestAdjPace := adjPaces[0]
	for i, r := range races {
		if adjPaces[i] > 0 && (bestAdjPace == 0 || adjPaces[i] < bestAdjPace) {
			best = r
			bestAdjPace = adjPaces[i]
		}
	}

	paceTrend := data.ComputeTrend(dates, adjPaces)
	paceForecast := data.ForecastSeries(dates, adjPaces, 30)

	// Per-race deltas vs the previous selected race.
	type raceDelta struct {
		Race              Race    `json:"race"`
		AdjustedPaceSecKm float64 `json:"adjustedPaceSecKm"`
		PaceDeltaVsPrev   float64 `json:"paceDeltaVsPrev"`
		TimeDeltaVsPrev   float64 `json:"timeDeltaVsPrev"`
		IsFastest         bool    `json:"isFastest"`
	}
	deltas := make([]raceDelta, len(races))
	for i, r := range races {
		d := raceDelta{Race: r, AdjustedPaceSecKm: round2(adjPaces[i]), IsFastest: r.ID == best.ID}
		if i > 0 {
			d.PaceDeltaVsPrev = round2(adjPaces[i] - adjPaces[i-1])
			d.TimeDeltaVsPrev = round2(r.DurationSec - races[i-1].DurationSec)
		}
		deltas[i] = d
	}

	// Projected next-race pace (in reference-distance terms), converted back to a pace
	// and time for the distance of the most recent race raced.
	var projectedAdjPace float64
	if len(paceForecast) > 0 {
		projectedAdjPace = paceForecast[len(paceForecast)-1].Value
	}
	lastDist := races[len(races)-1].DistanceKm
	projectedPace := data.DistanceAdjustedPace(projectedAdjPace, refDist, lastDist)
	projectedTime := projectedPace * lastDist

	c.JSON(http.StatusOK, gin.H{
		"enough":           true,
		"races":            races,
		"deltas":           deltas,
		"best":             best,
		"paceTrend":        paceTrend,
		"paceForecast":     paceForecast,
		"avgPace":          data.Avg(adjPaces),
		"avgHr":            data.Avg(hrs),
		"projectedPace":    round2(projectedPace),
		"projectedTime":    round2(projectedTime),
		"projectDist":      lastDist,
		"improved":         paceTrend.Change < 0, // lower adjusted pace = faster
		"refDistanceKm":    refDist,
		"mixedDistances":   mixedDistances,
		"distanceAdjusted": true,
	})
}
