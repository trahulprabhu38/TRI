package store

import (
	"context"
	"encoding/json"
	"time"

	"github.com/redis/go-redis/v9"
)

// Redis is a JSON cache backed by Redis.
type Redis struct{ c *redis.Client }

// NewRedis connects to Redis and verifies the connection.
func NewRedis(addr string) (*Redis, error) {
	c := redis.NewClient(&redis.Options{Addr: addr})
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := c.Ping(ctx).Err(); err != nil {
		return nil, err
	}
	return &Redis{c: c}, nil
}

func (r *Redis) Get(key string, out any) bool {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	raw, err := r.c.Get(ctx, key).Bytes()
	if err != nil {
		return false
	}
	return json.Unmarshal(raw, out) == nil
}

func (r *Redis) Set(key string, val any, ttl time.Duration) {
	raw, err := json.Marshal(val)
	if err != nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	_ = r.c.Set(ctx, key, raw, ttl).Err()
}

func (r *Redis) Del(key string) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	_ = r.c.Del(ctx, key).Err()
}
