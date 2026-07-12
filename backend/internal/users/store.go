// Package users provides per-user, file-based persistence (profile, Strava creds/token, races).
package users

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
)

// Profile is a signed-up user's identity.
type Profile struct {
	Sub       string `json:"sub"`
	Email     string `json:"email"`
	Name      string `json:"name"`
	Picture   string `json:"picture"`
	CreatedAt string `json:"createdAt"`
	LastLogin string `json:"lastLogin"`
}

// StravaCreds holds a user's own Strava API application keys.
type StravaCreds struct {
	ClientID     string `json:"clientId"`
	ClientSecret string `json:"clientSecret"`
}

// Store lays out per-user directories under a base path.
type Store struct{ base string }

func New(base string) *Store { return &Store{base: base} }

var unsafe = regexp.MustCompile(`[^a-zA-Z0-9_-]`)

func (s *Store) dir(sub string) string {
	return filepath.Join(s.base, "users", unsafe.ReplaceAllString(sub, "_"))
}

func (s *Store) ensure(sub string) string {
	d := s.dir(sub)
	_ = os.MkdirAll(filepath.Join(d, "races"), 0o755)
	return d
}

// RacesDir returns (and creates) the user's races directory.
func (s *Store) RacesDir(sub string) string {
	d := filepath.Join(s.dir(sub), "races")
	_ = os.MkdirAll(d, 0o755)
	return d
}

// GarminDir returns (and creates) the user's Garmin export directory.
func (s *Store) GarminDir(sub string) string {
	d := filepath.Join(s.dir(sub), "garmin")
	_ = os.MkdirAll(d, 0o755)
	return d
}

// StravaTokenPath returns the path to the user's stored Strava token.
func (s *Store) StravaTokenPath(sub string) string {
	s.ensure(sub)
	return filepath.Join(s.dir(sub), "strava_token.json")
}

func (s *Store) SaveProfile(p *Profile) error {
	s.ensure(p.Sub)
	return writeJSON(filepath.Join(s.dir(p.Sub), "profile.json"), p)
}

func (s *Store) LoadProfile(sub string) (*Profile, error) {
	var p Profile
	if err := readJSON(filepath.Join(s.dir(sub), "profile.json"), &p); err != nil {
		return nil, err
	}
	return &p, nil
}

func (s *Store) SaveStravaCreds(sub string, c *StravaCreds) error {
	s.ensure(sub)
	return writeJSON(filepath.Join(s.dir(sub), "strava_creds.json"), c)
}

func (s *Store) LoadStravaCreds(sub string) (*StravaCreds, error) {
	var c StravaCreds
	if err := readJSON(filepath.Join(s.dir(sub), "strava_creds.json"), &c); err != nil {
		return nil, err
	}
	return &c, nil
}

func writeJSON(path string, v any) error {
	b, _ := json.MarshalIndent(v, "", "  ")
	return os.WriteFile(path, b, 0o600)
}

func readJSON(path string, v any) error {
	b, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	return json.Unmarshal(b, v)
}
