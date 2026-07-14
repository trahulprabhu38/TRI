package store

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"garmin-analyzer/internal/model"
	"garmin-analyzer/internal/strava"
	"garmin-analyzer/internal/users"
)

// FileRepo is a filesystem-backed Repo (fallback when MongoDB isn't configured).
type FileRepo struct{ u *users.Store }

func NewFileRepo(u *users.Store) *FileRepo { return &FileRepo{u: u} }

func (f *FileRepo) UpsertProfile(p *users.Profile) error      { return f.u.SaveProfile(p) }
func (f *FileRepo) GetProfile(sub string) (*users.Profile, error) { return f.u.LoadProfile(sub) }

func (f *FileRepo) SaveStravaCreds(sub string, c *users.StravaCreds) error {
	return f.u.SaveStravaCreds(sub, c)
}
func (f *FileRepo) GetStravaCreds(sub string) (*users.StravaCreds, error) {
	return f.u.LoadStravaCreds(sub)
}

func (f *FileRepo) SaveStravaToken(sub string, t *strava.Token) error {
	b, _ := json.MarshalIndent(t, "", "  ")
	return os.WriteFile(f.u.StravaTokenPath(sub), b, 0o600)
}
func (f *FileRepo) GetStravaToken(sub string) (*strava.Token, error) {
	b, err := os.ReadFile(f.u.StravaTokenPath(sub))
	if err != nil {
		return nil, err
	}
	var t strava.Token
	if err := json.Unmarshal(b, &t); err != nil {
		return nil, err
	}
	return &t, nil
}
func (f *FileRepo) DeleteStravaToken(sub string) error { return os.Remove(f.u.StravaTokenPath(sub)) }

func (f *FileRepo) SaveRace(sub string, r model.Race) error {
	out, _ := json.MarshalIndent(r, "", "  ")
	return os.WriteFile(filepath.Join(f.u.RacesDir(sub), "race_"+r.ID+".json"), out, 0o644)
}

func (f *FileRepo) UpsertRaces(sub string, rs []model.Race) (int, error) {
	n := 0
	for _, r := range rs {
		if f.SaveRace(sub, r) == nil {
			n++
		}
	}
	return n, nil
}

func (f *FileRepo) SaveBundle(sub string, raw []byte) error {
	return os.WriteFile(filepath.Join(f.u.GarminDir(sub), "live_bundle.json"), raw, 0o600)
}

func (f *FileRepo) GetBundle(sub string) ([]byte, error) {
	return os.ReadFile(filepath.Join(f.u.GarminDir(sub), "live_bundle.json"))
}

func (f *FileRepo) BundleUpdatedAt(sub string) (time.Time, error) {
	info, err := os.Stat(filepath.Join(f.u.GarminDir(sub), "live_bundle.json"))
	if err != nil {
		return time.Time{}, err
	}
	return info.ModTime(), nil
}

func (f *FileRepo) ListRaces(sub string) ([]model.Race, error) {
	dir := f.u.RacesDir(sub)
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	var races []model.Race
	for _, e := range entries {
		if e.IsDir() || !strings.HasPrefix(e.Name(), "race_") {
			continue
		}
		raw, err := os.ReadFile(filepath.Join(dir, e.Name()))
		if err != nil {
			continue
		}
		var r model.Race
		if json.Unmarshal(raw, &r) == nil {
			races = append(races, r)
		}
	}
	sort.Slice(races, func(i, j int) bool { return races[i].Date > races[j].Date })
	return races, nil
}
