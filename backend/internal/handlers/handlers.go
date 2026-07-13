package handlers

import (
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"garmin-analyzer/internal/data"
	"garmin-analyzer/internal/model"
	"garmin-analyzer/internal/store"

	"github.com/gin-gonic/gin"
)

// Race is the shared persisted race type.
type Race = model.Race

// Handler wires HTTP routes to per-user data stores (falling back to the shared sample).
type Handler struct {
	Store      *data.Store // shared sample fallback
	Repo       store.Repo
	Cache      store.Cache
	mu         sync.Mutex
	userStores map[string]*data.Store
}

func New(sampleStore *data.Store, repo store.Repo, cache store.Cache) *Handler {
	return &Handler{Store: sampleStore, Repo: repo, Cache: cache, userStores: map[string]*data.Store{}}
}

// storeFor returns the user's own Garmin store if they've uploaded data, else the sample.
func (h *Handler) storeFor(sub string) *data.Store {
	if sub == "" || !hasJSON(Users.GarminDir(sub)) {
		return h.Store
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	if s := h.userStores[sub]; s != nil {
		return s
	}
	s := data.NewStore(Users.GarminDir(sub))
	h.userStores[sub] = s
	return s
}

// reloadUser rebuilds a user's store and invalidates their cached bundle.
func (h *Handler) reloadUser(sub string) {
	s := data.NewStore(Users.GarminDir(sub))
	_, _ = s.Reload()
	h.mu.Lock()
	h.userStores[sub] = s
	h.mu.Unlock()
	h.Cache.Del("bundle:" + sub)
}

// bundle returns the user's parsed Garmin metrics, served from Redis when warm.
func (h *Handler) bundle(c *gin.Context) (*data.Bundle, bool) {
	sub := c.GetString("uid")
	key := "bundle:" + sub
	var cached data.Bundle
	if h.Cache.Get(key, &cached) {
		return &cached, true
	}
	built, err := h.storeFor(sub).Bundle()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return nil, false
	}
	h.Cache.Set(key, built, 10*time.Minute)
	return built, true
}

// hasJSON reports whether a directory contains at least one .json file.
func hasJSON(dir string) bool {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return false
	}
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(strings.ToLower(e.Name()), ".json") {
			return true
		}
	}
	return false
}

func countJSON(dir string) int {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return 0
	}
	n := 0
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(strings.ToLower(e.Name()), ".json") {
			n++
		}
	}
	return n
}

// Health is a simple liveness probe.
func (h *Handler) Health(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

// Reload forces a re-parse of the data directory.
func (h *Handler) Reload(c *gin.Context) {
	if _, err := h.Store.Reload(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "reloaded"})
}

// Profile returns athlete identity and training zones.
func (h *Handler) Profile(c *gin.Context) {
	b, ok := h.bundle(c)
	if !ok {
		return
	}
	c.JSON(http.StatusOK, gin.H{"profile": b.Profile, "zones": b.Zones})
}

// Overview computes headline KPIs with trends for the dashboard.
func (h *Handler) Overview(c *gin.Context) {
	b, ok := h.bundle(c)
	if !ok {
		return
	}

	// VO2 max
	vo2Dates, vo2Vals := seriesFromVO2(b.VO2Max)
	vo2Trend := data.ComputeTrend(vo2Dates, vo2Vals)

	// Race prediction (5K)
	rpDates, rp5k := seriesRP(b.RacePredictions, func(r data.RacePrediction) float64 { return r.Time5K })
	rp5kTrend := data.ComputeTrend(rpDates, rp5k)

	// Readiness
	var rdVals []float64
	var rdDates []string
	for _, r := range b.Readiness {
		rdDates = append(rdDates, r.Date)
		rdVals = append(rdVals, r.Score)
	}
	rdTrend := data.ComputeTrend(rdDates, rdVals)

	// Training load / ACWR
	var acuteLast, chronicLast, ratioLast float64
	var acwrStatus string
	if n := len(b.TrainingLoad); n > 0 {
		acuteLast = b.TrainingLoad[n-1].Acute
		chronicLast = b.TrainingLoad[n-1].Chronic
		ratioLast = b.TrainingLoad[n-1].Ratio
		acwrStatus = b.TrainingLoad[n-1].ACWRStatus
	}

	// HRV weekly average (latest)
	var hrvWeekly float64
	for i := len(b.Readiness) - 1; i >= 0; i-- {
		if b.Readiness[i].HRVWeeklyAvg > 0 {
			hrvWeekly = b.Readiness[i].HRVWeeklyAvg
			break
		}
	}

	// Sleep score avg
	var sleepVals []float64
	for _, s := range b.Sleep {
		if s.OverallScore > 0 {
			sleepVals = append(sleepVals, s.OverallScore)
		}
	}

	// Resting HR (from daily)
	var rhr []float64
	for _, d := range b.Daily {
		if d.RestingHR > 0 {
			rhr = append(rhr, d.RestingHR)
		}
	}

	// Fitness age
	var bioAge, chronoAge float64
	if n := len(b.FitnessAge); n > 0 {
		bioAge = b.FitnessAge[n-1].CurrentBioAge
		chronoAge = b.FitnessAge[n-1].ChronologicalAge
	}

	c.JSON(http.StatusOK, gin.H{
		"vo2max": gin.H{
			"latest": data.LatestNonZero(vo2Vals),
			"trend":  vo2Trend,
		},
		"racePrediction5k": gin.H{
			"latest": data.LatestNonZero(rp5k),
			"trend":  rp5kTrend,
		},
		"readiness": gin.H{
			"latest": data.LatestNonZero(rdVals),
			"trend":  rdTrend,
		},
		"trainingLoad": gin.H{
			"acute":      acuteLast,
			"chronic":    chronicLast,
			"ratio":      data.RoundExport(ratioLast, 2),
			"acwrStatus": acwrStatus,
		},
		"hrvWeeklyAvg":  hrvWeekly,
		"sleepScoreAvg": data.Avg(sleepVals),
		"restingHrAvg":  data.Avg(rhr),
		"fitnessAge": gin.H{
			"bioAge":    data.RoundExport(bioAge, 1),
			"chronoAge": chronoAge,
			"delta":     data.RoundExport(bioAge-chronoAge, 1),
		},
		"dateRange": dateRange(b),
	})
}

// RacePredictions returns the prediction series with per-distance trend + forecast.
func (h *Handler) RacePredictions(c *gin.Context) {
	b, ok := h.bundle(c)
	if !ok {
		return
	}
	dates := make([]string, len(b.RacePredictions))
	for i, r := range b.RacePredictions {
		dates[i] = r.Date
	}
	build := func(get func(data.RacePrediction) float64) gin.H {
		vals := make([]float64, len(b.RacePredictions))
		for i, r := range b.RacePredictions {
			vals[i] = get(r)
		}
		return gin.H{
			"trend":    data.ComputeTrend(dates, vals),
			"forecast": data.ForecastSeries(dates, vals, 30),
		}
	}
	c.JSON(http.StatusOK, gin.H{
		"series": b.RacePredictions,
		"analysis": gin.H{
			"time5k":       build(func(r data.RacePrediction) float64 { return r.Time5K }),
			"time10k":      build(func(r data.RacePrediction) float64 { return r.Time10K }),
			"timeHalf":     build(func(r data.RacePrediction) float64 { return r.TimeHalf }),
			"timeMarathon": build(func(r data.RacePrediction) float64 { return r.TimeMarathon }),
		},
	})
}

// VO2Max returns the VO2 max series with trend and 30-day forecast.
func (h *Handler) VO2Max(c *gin.Context) {
	b, ok := h.bundle(c)
	if !ok {
		return
	}
	dates, vals := seriesFromVO2(b.VO2Max)
	c.JSON(http.StatusOK, gin.H{
		"series":   b.VO2Max,
		"trend":    data.ComputeTrend(dates, vals),
		"forecast": data.ForecastSeries(dates, vals, 30),
	})
}

// Physiology returns HRV/HR/SpO2/respiration/stress plus resting HR & body battery.
func (h *Handler) Physiology(c *gin.Context) {
	b, ok := h.bundle(c)
	if !ok {
		return
	}
	var hrvDates []string
	var hrvVals []float64
	for _, p := range b.Physio {
		if p.HRV > 0 {
			hrvDates = append(hrvDates, p.Date)
			hrvVals = append(hrvVals, p.HRV)
		}
	}
	c.JSON(http.StatusOK, gin.H{
		"physio":     b.Physio,
		"daily":      b.Daily,
		"zones":      b.Zones,
		"hrvTrend":   data.ComputeTrend(hrvDates, hrvVals),
		"fitnessAge": b.FitnessAge,
	})
}

// TrainingLoad returns acute/chronic load and ACWR series.
func (h *Handler) TrainingLoad(c *gin.Context) {
	b, ok := h.bundle(c)
	if !ok {
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"series":    b.TrainingLoad,
		"endurance": b.Endurance,
		"hill":      b.Hill,
	})
}

// Readiness returns training readiness series and its factor breakdown.
func (h *Handler) Readiness(c *gin.Context) {
	b, ok := h.bundle(c)
	if !ok {
		return
	}
	c.JSON(http.StatusOK, gin.H{"series": b.Readiness})
}

// Sleep returns nightly sleep summaries.
func (h *Handler) Sleep(c *gin.Context) {
	b, ok := h.bundle(c)
	if !ok {
		return
	}
	var vals []float64
	for _, s := range b.Sleep {
		if s.OverallScore > 0 {
			vals = append(vals, s.OverallScore)
		}
	}
	c.JSON(http.StatusOK, gin.H{
		"series":    b.Sleep,
		"hydration": b.Hydration,
		"avgScore":  data.Avg(vals),
	})
}

// ---------- helpers ----------

func seriesFromVO2(pts []data.VO2Point) ([]string, []float64) {
	var d []string
	var v []float64
	for _, p := range pts {
		d = append(d, p.Date)
		v = append(v, p.VO2Max)
	}
	return d, v
}

func seriesRP(pts []data.RacePrediction, get func(data.RacePrediction) float64) ([]string, []float64) {
	var d []string
	var v []float64
	for _, p := range pts {
		d = append(d, p.Date)
		v = append(v, get(p))
	}
	return d, v
}

func dateRange(b *data.Bundle) gin.H {
	var min, max string
	consider := func(s string) {
		if s == "" {
			return
		}
		if min == "" || s < min {
			min = s
		}
		if max == "" || s > max {
			max = s
		}
	}
	for _, p := range b.Daily {
		consider(p.Date)
	}
	for _, p := range b.RacePredictions {
		consider(p.Date)
	}
	return gin.H{"start": min, "end": max}
}
