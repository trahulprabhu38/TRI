// Package store abstracts persistence (users + races) and caching.
package store

import (
	"time"

	"garmin-analyzer/internal/model"
	"garmin-analyzer/internal/strava"
	"garmin-analyzer/internal/users"
)

// Repo persists user profiles, Strava credentials/tokens, and races.
type Repo interface {
	UpsertProfile(p *users.Profile) error
	GetProfile(sub string) (*users.Profile, error)

	SaveStravaCreds(sub string, c *users.StravaCreds) error
	GetStravaCreds(sub string) (*users.StravaCreds, error)

	SaveStravaToken(sub string, t *strava.Token) error
	GetStravaToken(sub string) (*strava.Token, error)
	DeleteStravaToken(sub string) error

	SaveRace(sub string, r model.Race) error
	UpsertRaces(sub string, rs []model.Race) (int, error)
	ListRaces(sub string) ([]model.Race, error)
}

// Cache is a small JSON cache (Redis-backed, or a no-op).
type Cache interface {
	Get(key string, out any) bool
	Set(key string, val any, ttl time.Duration)
	Del(key string)
}

// NoopCache disables caching (used when Redis isn't configured).
type NoopCache struct{}

func (NoopCache) Get(string, any) bool         { return false }
func (NoopCache) Set(string, any, time.Duration) {}
func (NoopCache) Del(string)                    {}
