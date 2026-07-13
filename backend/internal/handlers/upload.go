package handlers

import (
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// userRaces loads the current user's races from the repo.
func (h *Handler) userRaces(c *gin.Context) []Race {
	races, _ := h.Repo.ListRaces(c.GetString("uid"))
	return races
}

// UploadRace accepts a raw JSON activity export, normalizes it, and stores it.
func (h *Handler) UploadRace(c *gin.Context) {
	var raw map[string]any
	if err := c.ShouldBindJSON(&raw); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid JSON: " + err.Error()})
		return
	}
	race := normalizeRace(raw)
	if race.Date == "" {
		race.Date = time.Now().Format("2006-01-02")
	}
	if race.ID == "" {
		race.ID = time.Now().Format("20060102150405")
	}

	sub := c.GetString("uid")
	if err := h.Repo.SaveRace(sub, race); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	all, _ := h.Repo.ListRaces(sub)
	c.JSON(http.StatusOK, gin.H{"race": race, "comparison": compare(all, race)})
}

// ListRaces returns all of the user's races, newest first.
func (h *Handler) ListRaces(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"races": h.userRaces(c)})
}

// CompareRaces returns the user's races grouped for comparison.
func (h *Handler) CompareRaces(c *gin.Context) {
	races := h.userRaces(c)
	groups := map[string][]Race{}
	for _, r := range races {
		key := bucketKey(r.Sport, r.DistanceKm)
		groups[key] = append(groups[key], r)
	}
	c.JSON(http.StatusOK, gin.H{"races": races, "groups": groups})
}

// compare positions a race against prior same-distance races of the same sport.
func compare(all []Race, r Race) gin.H {
	var peers []Race
	for _, p := range all {
		if p.ID == r.ID {
			continue
		}
		if strings.EqualFold(p.Sport, r.Sport) && sameDistance(p.DistanceKm, r.DistanceKm) {
			peers = append(peers, p)
		}
	}
	if len(peers) == 0 {
		return gin.H{"hasPeers": false}
	}
	sort.Slice(peers, func(i, j int) bool { return peers[i].Date > peers[j].Date })
	prev := peers[0]

	// Best (fastest) prior time.
	best := peers[0]
	for _, p := range peers {
		if p.DurationSec > 0 && (best.DurationSec == 0 || p.DurationSec < best.DurationSec) {
			best = p
		}
	}

	deltaPrev := r.DurationSec - prev.DurationSec
	deltaBest := r.DurationSec - best.DurationSec
	isPR := r.DurationSec > 0 && r.DurationSec <= best.DurationSec

	return gin.H{
		"hasPeers":         true,
		"previous":         prev,
		"best":             best,
		"deltaVsPrevious":  deltaPrev,
		"deltaVsBest":      deltaBest,
		"paceDeltaVsPrev":  r.AvgPaceSecKm - prev.AvgPaceSecKm,
		"isPersonalRecord": isPR,
		"peerCount":        len(peers),
	}
}

func sameDistance(a, b float64) bool {
	if a == 0 || b == 0 {
		return false
	}
	diff := a - b
	if diff < 0 {
		diff = -diff
	}
	return diff/b <= 0.1 // within 10%
}

func bucketKey(sport string, km float64) string {
	switch {
	case km <= 0:
		return sport + ":unknown"
	case km < 6:
		return sport + ":5K"
	case km < 12:
		return sport + ":10K"
	case km < 25:
		return sport + ":Half"
	case km < 45:
		return sport + ":Marathon"
	default:
		return sport + ":Ultra"
	}
}

// normalizeRace maps common Garmin/Strava-style activity fields to our Race model.
func normalizeRace(raw map[string]any) Race {
	g := func(keys ...string) float64 {
		for _, k := range keys {
			if v, ok := raw[k]; ok {
				if f, ok := v.(float64); ok {
					return f
				}
			}
		}
		return 0
	}
	gs := func(keys ...string) string {
		for _, k := range keys {
			if v, ok := raw[k]; ok {
				if s, ok := v.(string); ok && s != "" {
					return s
				}
			}
		}
		return ""
	}

	// Distance may arrive in meters or km.
	dist := g("distanceKm", "distance_km")
	if dist == 0 {
		if m := g("distance", "distanceInMeters", "totalDistanceMeters"); m > 0 {
			dist = m / 1000.0
		}
	}
	dur := g("durationSec", "duration", "elapsedTime", "movingTime", "durationInSeconds")
	if dur == 0 {
		if ms := g("durationInMilliseconds"); ms > 0 {
			dur = ms / 1000.0
		}
	}
	pace := g("avgPaceSecKm")
	if pace == 0 && dist > 0 && dur > 0 {
		pace = dur / dist
	}
	date := gs("date", "calendarDate", "startTimeLocal", "startTimeGMT", "startTimestampLocal")
	if len(date) >= 10 {
		date = date[:10]
	}

	return Race{
		ID:           gs("id", "activityId", "uuid"),
		Name:         gs("name", "activityName"),
		Sport:        normalizeSport(gs("sport", "activityType", "type")),
		Date:         date,
		DistanceKm:   round2(dist),
		DurationSec:  dur,
		AvgPaceSecKm: round2(pace),
		AvgHR:        g("avgHr", "averageHR", "avgHeartRate"),
		MaxHR:        g("maxHr", "maxHeartRate"),
		AvgCadence:   g("avgCadence", "averageRunningCadenceInStepsPerMinute", "averageBikingCadenceInRevPerMinute"),
		AvgPowerW:    g("avgPowerW", "avgPower", "averagePower"),
		Calories:     g("calories", "calorie", "totalKilocalories"),
		Elevation:    g("elevationGain", "elevationGainInMeters", "totalElevationGain"),
	}
}

func normalizeSport(s string) string {
	l := strings.ToLower(s)
	switch {
	case strings.Contains(l, "run"):
		return "running"
	case strings.Contains(l, "swim"):
		return "swimming"
	case strings.Contains(l, "cycl"), strings.Contains(l, "bike"), strings.Contains(l, "ride"):
		return "cycling"
	case s == "":
		return "running"
	default:
		return l
	}
}

func round2(f float64) float64 {
	return float64(int(f*100+0.5)) / 100
}
