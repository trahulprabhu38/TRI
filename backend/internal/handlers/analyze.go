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

	dates := make([]string, len(races))
	paces := make([]float64, len(races))
	times := make([]float64, len(races))
	hrs := make([]float64, 0)
	for i, r := range races {
		dates[i] = r.Date
		paces[i] = r.AvgPaceSecKm
		times[i] = r.DurationSec
		if r.AvgHR > 0 {
			hrs = append(hrs, r.AvgHR)
		}
	}

	// Best / average by pace (normalizes across distances).
	best := races[0]
	for _, r := range races {
		if r.AvgPaceSecKm > 0 && (best.AvgPaceSecKm == 0 || r.AvgPaceSecKm < best.AvgPaceSecKm) {
			best = r
		}
	}

	paceTrend := data.ComputeTrend(dates, paces)
	paceForecast := data.ForecastSeries(dates, paces, 30)

	// Per-race deltas vs the previous selected race.
	type raceDelta struct {
		Race            Race    `json:"race"`
		PaceDeltaVsPrev float64 `json:"paceDeltaVsPrev"`
		TimeDeltaVsPrev float64 `json:"timeDeltaVsPrev"`
		IsFastest       bool    `json:"isFastest"`
	}
	deltas := make([]raceDelta, len(races))
	for i, r := range races {
		d := raceDelta{Race: r, IsFastest: r.ID == best.ID}
		if i > 0 {
			d.PaceDeltaVsPrev = round2(r.AvgPaceSecKm - races[i-1].AvgPaceSecKm)
			d.TimeDeltaVsPrev = round2(r.DurationSec - races[i-1].DurationSec)
		}
		deltas[i] = d
	}

	// Projected next-race pace, and the time it implies for the last distance raced.
	var projectedPace float64
	if len(paceForecast) > 0 {
		projectedPace = paceForecast[len(paceForecast)-1].Value
	}
	lastDist := races[len(races)-1].DistanceKm
	projectedTime := projectedPace * lastDist

	c.JSON(http.StatusOK, gin.H{
		"enough":        true,
		"races":         races,
		"deltas":        deltas,
		"best":          best,
		"paceTrend":     paceTrend,
		"paceForecast":  paceForecast,
		"avgPace":       data.Avg(paces),
		"avgHr":         data.Avg(hrs),
		"projectedPace": round2(projectedPace),
		"projectedTime": round2(projectedTime),
		"projectDist":   lastDist,
		"improved":      paceTrend.Change < 0, // lower pace = faster
	})
}
