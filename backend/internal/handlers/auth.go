package handlers

import (
	"net/http"
	"time"

	"garmin-analyzer/internal/auth"
	"garmin-analyzer/internal/users"

	"github.com/gin-gonic/gin"
)

// Injected from main.
var (
	Users          *users.Store
	GoogleClientID string
	SessionSecret  string
)

const sessionTTL = 30 * 24 * time.Hour

// AuthConfig exposes the public Google client ID so the frontend can render the button.
func (h *Handler) AuthConfig(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"googleClientId": GoogleClientID})
}

// AuthMiddleware validates the session cookie and sets "uid" on the context.
func (h *Handler) AuthMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		cookie, err := c.Cookie("session")
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "not authenticated"})
			return
		}
		var s auth.Session
		if err := auth.Verify(SessionSecret, cookie, &s); err != nil || !s.Valid() {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "session expired"})
			return
		}
		c.Set("uid", s.Sub)
		c.Next()
	}
}

// GoogleLogin verifies a Google ID token, upserts the user, and sets a session cookie.
func (h *Handler) GoogleLogin(c *gin.Context) {
	var body struct {
		Credential string `json:"credential"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.Credential == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "missing credential"})
		return
	}
	claims, err := auth.VerifyGoogleIDToken(c.Request.Context(), body.Credential, GoogleClientID)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}

	now := time.Now().UTC().Format(time.RFC3339)
	p, e := h.Repo.GetProfile(claims.Sub)
	if e != nil {
		p = &users.Profile{Sub: claims.Sub, CreatedAt: now}
	}
	p.Email, p.Name, p.Picture, p.LastLogin = claims.Email, claims.Name, claims.Picture, now
	_ = h.Repo.UpsertProfile(p)

	sess := auth.Session{
		Sub: claims.Sub, Email: claims.Email, Name: claims.Name, Picture: claims.Picture,
		Exp: time.Now().Add(sessionTTL).Unix(),
	}
	tok, _ := auth.Sign(SessionSecret, sess)
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie("session", tok, int(sessionTTL.Seconds()), "/", "", false, true)

	c.JSON(http.StatusOK, gin.H{"user": userView(p)})
}

// Me returns the current user plus onboarding status.
func (h *Handler) Me(c *gin.Context) {
	sub := c.GetString("uid")
	p, err := h.Repo.GetProfile(sub)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "no profile"})
		return
	}
	creds, _ := h.Repo.GetStravaCreds(sub)
	_, tokErr := h.Repo.GetStravaToken(sub)
	c.JSON(http.StatusOK, gin.H{
		"user":             userView(p),
		"stravaConfigured": creds != nil && creds.ClientID != "",
		"stravaConnected":  tokErr == nil,
	})
}

// Logout clears the session cookie.
func (h *Handler) Logout(c *gin.Context) {
	c.SetCookie("session", "", -1, "/", "", false, true)
	c.JSON(http.StatusOK, gin.H{"status": "logged out"})
}

func userView(p *users.Profile) gin.H {
	return gin.H{"email": p.Email, "name": p.Name, "picture": p.Picture}
}
