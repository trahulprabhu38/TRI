package handlers

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"

	"github.com/gin-gonic/gin"
)

// GarminSyncURL is the base URL of the Python garmin-sync service (injected from main).
var GarminSyncURL string

var syncHTTP = &http.Client{Timeout: 15 * time.Minute}

func syncConfigured() bool { return GarminSyncURL != "" }

// callSync POSTs a JSON body to the garmin-sync service and decodes the reply.
func callSync(path string, body any) (map[string]any, error) {
	raw, _ := json.Marshal(body)
	resp, err := syncHTTP.Post(GarminSyncURL+path, "application/json", bytes.NewReader(raw))
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	var out map[string]any
	if err := json.Unmarshal(data, &out); err != nil {
		return nil, fmt.Errorf("garmin-sync bad response (%d)", resp.StatusCode)
	}
	return out, nil
}

// GarminConnectStatus reports whether the user has a live Garmin session and synced data.
func (h *Handler) GarminConnectStatus(c *gin.Context) {
	sub := c.GetString("uid")
	resp := gin.H{"available": syncConfigured(), "connected": false, "hasData": false}
	if raw, err := h.Repo.GetBundle(sub); err == nil && len(raw) > 0 {
		resp["hasData"] = true
	}
	if t, err := h.Repo.BundleUpdatedAt(sub); err == nil && !t.IsZero() {
		resp["lastSync"] = t.UTC().Format(time.RFC3339)
	}
	if syncConfigured() {
		resp2, err := syncHTTP.Get(GarminSyncURL + "/status?id=" + url.QueryEscape(sub))
		if err == nil {
			defer resp2.Body.Close()
			var s map[string]any
			if json.NewDecoder(resp2.Body).Decode(&s) == nil {
				resp["connected"], _ = s["connected"].(bool)
			}
		}
	}
	c.JSON(http.StatusOK, resp)
}

// GarminConnectLogin logs into Garmin Connect via the sync service (password never stored).
func (h *Handler) GarminConnectLogin(c *gin.Context) {
	if !syncConfigured() {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Garmin live sync is not enabled."})
		return
	}
	var body struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.Email == "" || body.Password == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "email and password required"})
		return
	}
	out, err := callSync("/login", gin.H{"id": c.GetString("uid"), "email": body.Email, "password": body.Password})
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	if s, _ := out["status"].(string); s == "error" {
		c.JSON(http.StatusBadGateway, gin.H{"error": out["error"]})
		return
	}
	c.JSON(http.StatusOK, out) // {status: ok | mfa_required}
}

// GarminConnectMFA submits a Garmin multi-factor code.
func (h *Handler) GarminConnectMFA(c *gin.Context) {
	var body struct {
		Code string `json:"code"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.Code == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "code required"})
		return
	}
	out, err := callSync("/login/mfa", gin.H{"id": c.GetString("uid"), "code": body.Code})
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	if s, _ := out["status"].(string); s == "error" {
		c.JSON(http.StatusBadGateway, gin.H{"error": out["error"]})
		return
	}
	c.JSON(http.StatusOK, out)
}

// GarminConnectToken connects using a pre-generated garth session token (no code needed).
func (h *Handler) GarminConnectToken(c *gin.Context) {
	if !syncConfigured() {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Garmin live sync is not enabled."})
		return
	}
	var body struct {
		Token string `json:"token"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.Token == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "token required"})
		return
	}
	out, err := callSync("/login/token", gin.H{"id": c.GetString("uid"), "token": body.Token})
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	if s, _ := out["status"].(string); s == "error" {
		c.JSON(http.StatusBadGateway, gin.H{"error": out["error"]})
		return
	}
	c.JSON(http.StatusOK, out)
}

// GarminConnectSync pulls fresh Garmin data and stores it as the user's live bundle.
func (h *Handler) GarminConnectSync(c *gin.Context) {
	if !syncConfigured() {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Garmin live sync is not enabled."})
		return
	}
	sub := c.GetString("uid")
	var body struct {
		Days int `json:"days"`
	}
	_ = c.ShouldBindJSON(&body)
	if body.Days <= 0 {
		body.Days = 28
	}

	out, err := callSync("/sync", gin.H{"id": sub, "days": body.Days})
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	switch s, _ := out["status"].(string); s {
	case "not_connected":
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Connect your Garmin account first."})
		return
	case "error":
		c.JSON(http.StatusBadGateway, gin.H{"error": out["error"]})
		return
	}

	// Persist the returned bundle and refresh the cache.
	raw, err := json.Marshal(out["bundle"])
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "invalid bundle from sync"})
		return
	}
	if err := h.Repo.SaveBundle(sub, raw); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	h.Cache.Del("bundle:" + sub)
	c.JSON(http.StatusOK, gin.H{"status": "ok", "counts": out["counts"]})
}

// GarminConnectDisconnect clears the user's live Garmin bundle.
func (h *Handler) GarminConnectDisconnect(c *gin.Context) {
	sub := c.GetString("uid")
	_ = h.Repo.SaveBundle(sub, []byte{})
	h.Cache.Del("bundle:" + sub)
	c.JSON(http.StatusOK, gin.H{"status": "disconnected"})
}
