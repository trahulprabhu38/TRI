package main

import (
	"crypto/rand"
	"encoding/hex"
	"log"
	"net/http"
	"os"
	"path/filepath"

	"garmin-analyzer/internal/data"
	"garmin-analyzer/internal/handlers"
	"garmin-analyzer/internal/store"
	"garmin-analyzer/internal/users"

	"github.com/gin-gonic/gin"
)

func main() {
	dataDir := getenv("GARMIN_DATA_DIR", "../json")
	port := getenv("PORT", "8080")
	baseDir := getenv("UPLOAD_DIR", "uploads")

	sampleStore := data.NewStore(dataDir)
	if _, err := sampleStore.Reload(); err != nil {
		log.Fatalf("failed to load data from %s: %v", dataDir, err)
	}
	log.Printf("loaded Garmin data from %s", dataDir)

	// Auth + per-user storage.
	handlers.Users = users.New(baseDir)
	handlers.GoogleClientID = os.Getenv("GOOGLE_CLIENT_ID")
	handlers.SessionSecret = sessionSecret(baseDir)
	handlers.StravaRedirect = getenv("STRAVA_REDIRECT_URI", "http://localhost:8080/api/strava/callback")
	handlers.FrontendURL = getenv("FRONTEND_URL", "http://localhost:5173")

	// Persistence: MongoDB when configured, else filesystem.
	var repo store.Repo
	if uri := os.Getenv("MONGO_URI"); uri != "" {
		m, err := store.NewMongo(uri, getenv("MONGO_DB", "garmin"))
		if err != nil {
			log.Fatalf("mongodb connection failed: %v", err)
		}
		repo = m
		log.Printf("persistence: MongoDB (%s)", getenv("MONGO_DB", "garmin"))
	} else {
		repo = store.NewFileRepo(handlers.Users)
		log.Printf("persistence: filesystem (set MONGO_URI to use MongoDB)")
	}

	// Cache: Redis when configured, else no-op.
	var cache store.Cache = store.NoopCache{}
	if addr := os.Getenv("REDIS_ADDR"); addr != "" {
		r, err := store.NewRedis(addr)
		if err != nil {
			log.Fatalf("redis connection failed: %v", err)
		}
		cache = r
		log.Printf("cache: Redis (%s)", addr)
	} else {
		log.Printf("cache: disabled (set REDIS_ADDR to enable Redis)")
	}

	h := handlers.New(sampleStore, repo, cache)

	r := gin.Default()
	r.Use(cors())

	// Root-level health probe (for Kubernetes / load balancers).
	r.GET("/health", h.Health)

	api := r.Group("/api")

	// Public routes (no session required).
	api.GET("/health", h.Health)
	api.GET("/auth/config", h.AuthConfig)
	api.POST("/auth/google", h.GoogleLogin)
	api.POST("/auth/logout", h.Logout)
	api.GET("/strava/callback", h.StravaCallback) // identity via signed state, not cookie

	// Protected routes (require a valid session).
	p := api.Group("")
	p.Use(h.AuthMiddleware())
	{
		p.GET("/auth/me", h.Me)

		p.GET("/profile", h.Profile)
		p.GET("/overview", h.Overview)
		p.GET("/race-predictions", h.RacePredictions)
		p.GET("/vo2max", h.VO2Max)
		p.GET("/physiology", h.Physiology)
		p.GET("/training-load", h.TrainingLoad)
		p.GET("/readiness", h.Readiness)
		p.GET("/sleep", h.Sleep)

		p.GET("/garmin/status", h.GarminStatus)
		p.POST("/garmin/upload", h.GarminUpload)
		p.POST("/garmin/clear", h.GarminClear)

		p.GET("/races", h.ListRaces)
		p.GET("/races/compare", h.CompareRaces)
		p.POST("/races/upload", h.UploadRace)
		p.POST("/races/analyze", h.AnalyzeRaces)

		p.GET("/strava/status", h.StravaStatus)
		p.GET("/strava/credentials", h.GetStravaCredentials)
		p.POST("/strava/credentials", h.SaveStravaCredentials)
		p.GET("/strava/auth-url", h.StravaAuthURL)
		p.POST("/strava/sync", h.StravaSync)
		p.POST("/strava/disconnect", h.StravaDisconnect)

		p.POST("/ai/insights", h.AIInsights)
	}

	log.Printf("garmin-analyzer API listening on :%s", port)
	if err := r.Run(":" + port); err != nil {
		log.Fatal(err)
	}
}

func getenv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

// sessionSecret returns SESSION_SECRET, or a persisted random secret so
// sessions survive restarts without needing a configured value.
func sessionSecret(baseDir string) string {
	if s := os.Getenv("SESSION_SECRET"); s != "" {
		return s
	}
	_ = os.MkdirAll(baseDir, 0o755)
	path := filepath.Join(baseDir, ".session_secret")
	if b, err := os.ReadFile(path); err == nil && len(b) > 0 {
		return string(b)
	}
	buf := make([]byte, 32)
	_, _ = rand.Read(buf)
	secret := hex.EncodeToString(buf)
	_ = os.WriteFile(path, []byte(secret), 0o600)
	return secret
}

// cors allows the local dev server to call the API with credentials.
func cors() gin.HandlerFunc {
	return func(c *gin.Context) {
		origin := c.GetHeader("Origin")
		if origin != "" {
			c.Header("Access-Control-Allow-Origin", origin)
			c.Header("Access-Control-Allow-Credentials", "true")
		}
		c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	}
}
