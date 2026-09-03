// Package config loads runtime configuration from environment variables (optionally a .env file).
package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/joho/godotenv"
)

type Config struct {
	Env         string // dev | test | prod
	HTTPAddr    string
	DatabaseURL string
	// Auth
	JWTSecret        string
	JWTRefreshSecret string
	AccessTTL        time.Duration
	RefreshTTL       time.Duration
	// CORS
	CORSOrigins []string
	// AI / T-LLM
	AIEnabled      bool
	TLLMBaseURL    string
	TLLMAdminToken string
	TLLMModel      string
	// LINE
	LineMock          bool
	LineChannelID     string
	LineChannelSecret string
	LiffID            string
	// Platform bootstrap (seed)
	PlatformAdminUser     string
	PlatformAdminPassword string
	// Misc
	Timezone    string
	LogLevel    string
	RateLimit   int // requests per minute per IP for auth endpoints
	AutoMigrate bool
}

func Load() (*Config, error) {
	_ = godotenv.Load() // best effort: ./.env
	c := &Config{
		Env:                   get("APP_ENV", "dev"),
		HTTPAddr:              get("HTTP_ADDR", ":8090"),
		DatabaseURL:           get("DATABASE_URL", "postgres://pos:pos@localhost:54322/pos?sslmode=disable"),
		JWTSecret:             get("JWT_SECRET", ""),
		JWTRefreshSecret:      get("JWT_REFRESH_SECRET", ""),
		AccessTTL:             getDuration("JWT_ACCESS_TTL", 15*time.Minute),
		RefreshTTL:            getDuration("JWT_REFRESH_TTL", 30*24*time.Hour),
		CORSOrigins:           splitList(get("CORS_ORIGINS", "http://localhost:3010,http://localhost:3000")),
		AIEnabled:             getBool("AI_ENABLED", false),
		TLLMBaseURL:           get("TLLM_BASE_URL", "http://192.168.1.116:9001"),
		TLLMAdminToken:        get("TLLM_ADMIN_TOKEN", ""),
		TLLMModel:             get("TLLM_MODEL", "T-LLM-GC"),
		LineMock:              getBool("LINE_MOCK", true),
		LineChannelID:         get("LINE_CHANNEL_ID", ""),
		LineChannelSecret:     get("LINE_CHANNEL_SECRET", ""),
		LiffID:                get("LIFF_ID", ""),
		PlatformAdminUser:     get("PLATFORM_ADMIN_USER", "admin"),
		PlatformAdminPassword: get("PLATFORM_ADMIN_PASSWORD", ""),
		Timezone:              get("TZ", "Asia/Bangkok"),
		LogLevel:              get("LOG_LEVEL", "info"),
		RateLimit:             getInt("AUTH_RATE_LIMIT", 30),
		AutoMigrate:           getBool("AUTO_MIGRATE", true),
	}
	if c.JWTSecret == "" || c.JWTRefreshSecret == "" {
		if c.Env == "prod" {
			return nil, fmt.Errorf("JWT_SECRET and JWT_REFRESH_SECRET are required in prod")
		}
		if c.JWTSecret == "" {
			c.JWTSecret = "dev-insecure-access-secret-change-me"
		}
		if c.JWTRefreshSecret == "" {
			c.JWTRefreshSecret = "dev-insecure-refresh-secret-change-me"
		}
	}
	return c, nil
}

func (c *Config) IsProd() bool { return c.Env == "prod" }

func get(k, def string) string {
	if v, ok := os.LookupEnv(k); ok && strings.TrimSpace(v) != "" {
		return strings.TrimSpace(v)
	}
	return def
}

func getBool(k string, def bool) bool {
	v := strings.ToLower(get(k, ""))
	switch v {
	case "1", "true", "yes", "on":
		return true
	case "0", "false", "no", "off":
		return false
	}
	return def
}

func getInt(k string, def int) int {
	if v, err := strconv.Atoi(get(k, "")); err == nil {
		return v
	}
	return def
}

func getDuration(k string, def time.Duration) time.Duration {
	if v, err := time.ParseDuration(get(k, "")); err == nil {
		return v
	}
	return def
}

func splitList(s string) []string {
	var out []string
	for _, p := range strings.Split(s, ",") {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}
