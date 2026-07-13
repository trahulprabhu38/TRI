// Package model holds shared data types persisted across the app.
package model

// Race is a normalized finished-race/activity record.
type Race struct {
	ID           string    `json:"id" bson:"raceId"`
	Sub          string    `json:"-" bson:"sub"`
	Name         string    `json:"name" bson:"name"`
	Sport        string    `json:"sport" bson:"sport"`
	Date         string    `json:"date" bson:"date"`
	DistanceKm   float64   `json:"distanceKm" bson:"distanceKm"`
	DurationSec  float64   `json:"durationSec" bson:"durationSec"`
	AvgPaceSecKm float64   `json:"avgPaceSecKm" bson:"avgPaceSecKm"`
	AvgHR        float64   `json:"avgHr" bson:"avgHr"`
	MaxHR        float64   `json:"maxHr" bson:"maxHr"`
	AvgCadence   float64   `json:"avgCadence" bson:"avgCadence"`
	AvgPowerW    float64   `json:"avgPowerW" bson:"avgPowerW"`
	Calories     float64   `json:"calories" bson:"calories"`
	Elevation    float64   `json:"elevationGain" bson:"elevationGain"`
	Polyline     string    `json:"polyline,omitempty" bson:"polyline,omitempty"`
	StartLatLng  []float64 `json:"startLatLng,omitempty" bson:"startLatLng,omitempty"`
}
