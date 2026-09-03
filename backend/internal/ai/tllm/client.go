// Package tllm is a client for the T-LLM gateway (see T-LLM-API-SPEC.md): /v1/generate (plain text,
// optional SSE) and /v1/embeddings. It follows the spec's client rules: retry 502s 2-3 times with a
// slightly perturbed prompt, ≥ 90 s timeout, and line-buffered SSE reading (Thai is multibyte).
package tllm

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

type Client struct {
	BaseURL    string
	Model      string
	AdminToken string
	HTTP       *http.Client
	Retries    int
}

func New(baseURL, model, adminToken string) *Client {
	return &Client{BaseURL: strings.TrimRight(baseURL, "/"), Model: model, AdminToken: adminToken, HTTP: &http.Client{Timeout: 120 * time.Second}, Retries: 3}
}

var ErrUpstream = errors.New("tllm upstream error")

type generateReq struct {
	User   string `json:"user"`
	System string `json:"system,omitempty"`
	Prefer string `json:"prefer"`
	Model  string `json:"model,omitempty"`
	Stream bool   `json:"stream"`
}

// Generate returns the full completion for a prompt.
func (c *Client) Generate(ctx context.Context, system, user string) (string, error) {
	var last error
	for attempt := 0; attempt < max(1, c.Retries); attempt++ {
		prompt := user
		if attempt > 0 {
			prompt = user + strings.Repeat("\n", attempt) // perturb: Gemini sometimes rejects an exact prompt deterministically
		}
		body, _ := json.Marshal(generateReq{User: prompt, System: system, Prefer: "cloud", Model: c.Model})
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.BaseURL+"/v1/generate", bytes.NewReader(body))
		if err != nil {
			return "", err
		}
		req.Header.Set("Content-Type", "application/json")
		resp, err := c.HTTP.Do(req)
		if err != nil {
			last = err
			continue
		}
		data, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
		resp.Body.Close()
		if resp.StatusCode == http.StatusOK {
			var out struct {
				Content string `json:"content"`
			}
			if err := json.Unmarshal(data, &out); err != nil {
				return "", fmt.Errorf("decode: %w", err)
			}
			return out.Content, nil
		}
		last = fmt.Errorf("%w: status %d: %s", ErrUpstream, resp.StatusCode, truncate(string(data), 300))
		if resp.StatusCode != http.StatusBadGateway && resp.StatusCode < 500 {
			break // 401/403/4xx are not retryable
		}
		select {
		case <-ctx.Done():
			return "", ctx.Err()
		case <-time.After(time.Duration(attempt+1) * 800 * time.Millisecond):
		}
	}
	return "", last
}

// GenerateStream streams chunks to fn (line-buffered SSE).
func (c *Client) GenerateStream(ctx context.Context, system, user string, fn func(chunk string) error) error {
	body, _ := json.Marshal(generateReq{User: user, System: system, Prefer: "cloud", Model: c.Model, Stream: true})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.BaseURL+"/v1/generate", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "text/event-stream")
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		data, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return fmt.Errorf("%w: status %d: %s", ErrUpstream, resp.StatusCode, truncate(string(data), 300))
	}
	sc := bufio.NewScanner(resp.Body)
	sc.Buffer(make([]byte, 64*1024), 1<<20)
	for sc.Scan() {
		line := sc.Text()
		if !strings.HasPrefix(line, "data: ") {
			continue
		}
		payload := strings.TrimPrefix(line, "data: ")
		if payload == "[DONE]" {
			return nil
		}
		var d struct {
			Content string `json:"content"`
		}
		if json.Unmarshal([]byte(payload), &d) == nil && d.Content != "" {
			if err := fn(d.Content); err != nil {
				return err
			}
		}
	}
	return sc.Err()
}

// Health reports whether the gateway answers /health.
func (c *Client) Health(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, c.BaseURL+"/health", nil)
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return err
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("%w: health status %d", ErrUpstream, resp.StatusCode)
	}
	return nil
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
