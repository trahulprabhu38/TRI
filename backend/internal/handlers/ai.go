package handlers

import (
	"fmt"
	"net/http"
	"os"
	"strings"

	"garmin-analyzer/internal/ai"
	"garmin-analyzer/internal/data"

	"github.com/gin-gonic/gin"
)

// aiRequest lets the client override the API key/model and choose a focus.
type aiRequest struct {
	APIKey string `json:"apiKey"`
	Model  string `json:"model"`
	Focus  string `json:"focus"` // e.g. "5k", "overall", "recovery", "triathlon"
	Goal   string `json:"goal"`  // free-text user goal
}

// AIInsights builds a data summary and asks OpenAI for a coaching analysis + plan.
func (h *Handler) AIInsights(c *gin.Context) {
	var req aiRequest
	_ = c.ShouldBindJSON(&req)

	key := req.APIKey
	if key == "" {
		key = os.Getenv("OPENAI_API_KEY")
	}
	if key == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "No OpenAI API key. Set OPENAI_API_KEY on the server or paste a key in the UI.",
		})
		return
	}

	b, ok := h.bundle(c)
	if !ok {
		return
	}

	model := req.Model
	if model == "" {
		model = os.Getenv("OPENAI_MODEL")
	}
	client := ai.NewClient(key, model)

	system := "You are an elite endurance coach analyzing a triathlete's Garmin data " +
		"(swim, bike, run). Be specific and quantitative. Use the numbers provided. " +
		"Structure your answer in Markdown with these sections: " +
		"**Snapshot**, **What's Improving**, **What's Holding You Back**, " +
		"**4-Week Plan** (weekly bullet points), and **Race-Day Projection**. " +
		"Keep it practical and encouraging but honest."

	user := buildDataSummary(b, req, h.userRaces(c))

	out, err := client.Complete(c.Request.Context(), system, user)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"insight": out, "model": client.Model})
}

// buildDataSummary compresses the bundle into a compact, number-rich prompt.
func buildDataSummary(b *data.Bundle, req aiRequest, races []Race) string {
	var sb strings.Builder
	p := b.Profile
	fmt.Fprintf(&sb, "Athlete: %s %s, %s, born %s.\n", p.FirstName, p.LastName, p.Gender, p.BirthDate)
	if req.Goal != "" {
		fmt.Fprintf(&sb, "Stated goal: %s.\n", req.Goal)
	}
	if req.Focus != "" {
		fmt.Fprintf(&sb, "Focus for this analysis: %s.\n", req.Focus)
	}

	// Race predictions
	if n := len(b.RacePredictions); n > 0 {
		first := b.RacePredictions[0]
		last := b.RacePredictions[n-1]
		fmt.Fprintf(&sb, "\nGarmin race-time predictions (mm:ss), %s → %s:\n", first.Date, last.Date)
		fmt.Fprintf(&sb, "  5K: %s → %s | 10K: %s → %s | Half: %s → %s | Marathon: %s → %s\n",
			fmtDur(first.Time5K), fmtDur(last.Time5K),
			fmtDur(first.Time10K), fmtDur(last.Time10K),
			fmtDur(first.TimeHalf), fmtDur(last.TimeHalf),
			fmtDur(first.TimeMarathon), fmtDur(last.TimeMarathon))
	}

	// VO2 max
	if n := len(b.VO2Max); n > 0 {
		fmt.Fprintf(&sb, "\nVO2 max (running): %.0f → %.0f over %d readings.\n",
			b.VO2Max[0].VO2Max, b.VO2Max[n-1].VO2Max, n)
	}

	// Training load
	if n := len(b.TrainingLoad); n > 0 {
		last := b.TrainingLoad[n-1]
		fmt.Fprintf(&sb, "Training load: acute %.0f, chronic %.0f, ACWR %.2f (status %s).\n",
			last.Acute, last.Chronic, last.Ratio, last.ACWRStatus)
	}

	// Readiness
	if n := len(b.Readiness); n > 0 {
		last := b.Readiness[n-1]
		fmt.Fprintf(&sb, "Latest training readiness: %.0f/100 (%s). HRV weekly avg %.0f ms. Recovery time %.1f h.\n",
			last.Score, last.FeedbackShort, last.HRVWeeklyAvg, last.RecoveryTimeHours)
	}

	// Sleep
	if len(b.Sleep) > 0 {
		var scores, deep, total []float64
		for _, s := range b.Sleep {
			if s.OverallScore > 0 {
				scores = append(scores, s.OverallScore)
			}
			deep = append(deep, s.DeepMinutes)
			total = append(total, s.TotalMinutes)
		}
		fmt.Fprintf(&sb, "Sleep: avg score %.0f, avg total %.0f min, avg deep %.0f min.\n",
			data.Avg(scores), data.Avg(total), data.Avg(deep))
	}

	// Physio / HRV
	if len(b.Physio) > 0 {
		var hrv, rhr []float64
		for _, ph := range b.Physio {
			if ph.HRV > 0 {
				hrv = append(hrv, ph.HRV)
			}
		}
		for _, d := range b.Daily {
			if d.RestingHR > 0 {
				rhr = append(rhr, d.RestingHR)
			}
		}
		fmt.Fprintf(&sb, "Physiology: avg HRV %.0f ms, avg resting HR %.0f bpm.\n", data.Avg(hrv), data.Avg(rhr))
	}

	// Fitness age
	if n := len(b.FitnessAge); n > 0 {
		last := b.FitnessAge[n-1]
		fmt.Fprintf(&sb, "Fitness age: bio age %.1f vs chrono %.0f; BMI %.1f.\n",
			last.CurrentBioAge, last.ChronologicalAge, last.BMI)
	}

	// Zones
	z := b.Zones
	if z.MaxHR > 0 {
		fmt.Fprintf(&sb, "HR: resting %.0f, max %.0f, lactate threshold %.0f. Zone floors: %v.\n",
			z.RestingHR, z.MaxHR, z.LactateThresholdHR, z.HRZoneFloors)
	}

	// Synced races
	if len(races) > 0 {
		sb.WriteString("\nCompleted races:\n")
		for _, r := range races {
			fmt.Fprintf(&sb, "  %s %s %.1fkm in %s (pace %s/km, avg HR %.0f).\n",
				r.Date, r.Sport, r.DistanceKm, fmtDur(r.DurationSec), fmtDur(r.AvgPaceSecKm), r.AvgHR)
		}
	}

	sb.WriteString("\nProvide the coaching analysis now.")
	return sb.String()
}

func fmtDur(sec float64) string {
	s := int(sec + 0.5)
	if s <= 0 {
		return "—"
	}
	h := s / 3600
	m := (s % 3600) / 60
	ss := s % 60
	if h > 0 {
		return fmt.Sprintf("%d:%02d:%02d", h, m, ss)
	}
	return fmt.Sprintf("%d:%02d", m, ss)
}
