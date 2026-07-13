package store

import (
	"context"
	"time"

	"garmin-analyzer/internal/model"
	"garmin-analyzer/internal/strava"
	"garmin-analyzer/internal/users"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

// Mongo is a MongoDB-backed Repo.
type Mongo struct {
	client *mongo.Client
	users  *mongo.Collection
	races  *mongo.Collection
}

// stravaDoc is the persisted Strava state embedded on a user document.
type userDoc struct {
	Sub          string         `bson:"_id"`
	Profile      *users.Profile `bson:"profile,omitempty"`
	ClientID     string         `bson:"stravaClientId,omitempty"`
	ClientSecret string         `bson:"stravaClientSecret,omitempty"`
	Token        *strava.Token  `bson:"stravaToken,omitempty"`
}

// NewMongo connects to MongoDB and ensures indexes.
func NewMongo(uri, dbName string) (*Mongo, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	client, err := mongo.Connect(ctx, options.Client().ApplyURI(uri))
	if err != nil {
		return nil, err
	}
	if err := client.Ping(ctx, nil); err != nil {
		return nil, err
	}
	db := client.Database(dbName)
	m := &Mongo{client: client, users: db.Collection("users"), races: db.Collection("races")}
	// Unique race per user.
	_, _ = m.races.Indexes().CreateOne(ctx, mongo.IndexModel{
		Keys:    bson.D{{Key: "sub", Value: 1}, {Key: "raceId", Value: 1}},
		Options: options.Index().SetUnique(true),
	})
	_, _ = m.races.Indexes().CreateOne(ctx, mongo.IndexModel{Keys: bson.D{{Key: "sub", Value: 1}}})
	return m, nil
}

func ctx() (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.Background(), 8*time.Second)
}

func (m *Mongo) set(sub string, field string, val any) error {
	c, cancel := ctx()
	defer cancel()
	_, err := m.users.UpdateByID(c, sub, bson.M{"$set": bson.M{field: val}}, options.Update().SetUpsert(true))
	return err
}

func (m *Mongo) getUser(sub string) (*userDoc, error) {
	c, cancel := ctx()
	defer cancel()
	var d userDoc
	if err := m.users.FindOne(c, bson.M{"_id": sub}).Decode(&d); err != nil {
		return nil, err
	}
	return &d, nil
}

func (m *Mongo) UpsertProfile(p *users.Profile) error { return m.set(p.Sub, "profile", p) }

func (m *Mongo) GetProfile(sub string) (*users.Profile, error) {
	d, err := m.getUser(sub)
	if err != nil {
		return nil, err
	}
	if d.Profile == nil {
		return nil, mongo.ErrNoDocuments
	}
	return d.Profile, nil
}

func (m *Mongo) SaveStravaCreds(sub string, cr *users.StravaCreds) error {
	c, cancel := ctx()
	defer cancel()
	_, err := m.users.UpdateByID(c, sub,
		bson.M{"$set": bson.M{"stravaClientId": cr.ClientID, "stravaClientSecret": cr.ClientSecret}},
		options.Update().SetUpsert(true))
	return err
}

func (m *Mongo) GetStravaCreds(sub string) (*users.StravaCreds, error) {
	d, err := m.getUser(sub)
	if err != nil {
		return nil, err
	}
	return &users.StravaCreds{ClientID: d.ClientID, ClientSecret: d.ClientSecret}, nil
}

func (m *Mongo) SaveStravaToken(sub string, t *strava.Token) error { return m.set(sub, "stravaToken", t) }

func (m *Mongo) GetStravaToken(sub string) (*strava.Token, error) {
	d, err := m.getUser(sub)
	if err != nil {
		return nil, err
	}
	if d.Token == nil {
		return nil, mongo.ErrNoDocuments
	}
	return d.Token, nil
}

func (m *Mongo) DeleteStravaToken(sub string) error {
	c, cancel := ctx()
	defer cancel()
	_, err := m.users.UpdateByID(c, sub, bson.M{"$unset": bson.M{"stravaToken": ""}})
	return err
}

func (m *Mongo) SaveRace(sub string, r model.Race) error {
	r.Sub = sub
	c, cancel := ctx()
	defer cancel()
	_, err := m.races.UpdateOne(c,
		bson.M{"sub": sub, "raceId": r.ID},
		bson.M{"$set": r},
		options.Update().SetUpsert(true))
	return err
}

func (m *Mongo) UpsertRaces(sub string, rs []model.Race) (int, error) {
	n := 0
	for _, r := range rs {
		if m.SaveRace(sub, r) == nil {
			n++
		}
	}
	return n, nil
}

func (m *Mongo) ListRaces(sub string) ([]model.Race, error) {
	c, cancel := ctx()
	defer cancel()
	cur, err := m.races.Find(c, bson.M{"sub": sub}, options.Find().SetSort(bson.D{{Key: "date", Value: -1}}))
	if err != nil {
		return nil, err
	}
	defer cur.Close(c)
	var out []model.Race
	if err := cur.All(c, &out); err != nil {
		return nil, err
	}
	return out, nil
}
