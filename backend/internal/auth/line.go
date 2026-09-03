package auth

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// LineProfile is the identity extracted from a verified LINE id-token.
type LineProfile struct {
	UserID      string
	DisplayName string
	Picture     string
}

// ErrLineTokenInvalid is returned when LINE rejects the id-token (or a mock token is malformed).
var ErrLineTokenInvalid = errors.New("line: invalid id token")

// ErrLineUnavailable is returned when the LINE verify endpoint cannot be reached or misbehaves.
var ErrLineUnavailable = errors.New("line: verify service unavailable")

const lineVerifyURL = "https://api.line.me/oauth2/v2.1/verify"

// LineVerifier validates LIFF id-tokens. When Mock is true it accepts tokens of the form
// "mock:<lineUserId>:<displayName>" without calling LINE.
type LineVerifier struct {
	Mock      bool
	ChannelID string
	HTTP      *http.Client
	endpoint  string
}

func NewLineVerifier(mock bool, channelID string) *LineVerifier {
	return &LineVerifier{Mock: mock, ChannelID: channelID, HTTP: &http.Client{Timeout: 10 * time.Second}, endpoint: lineVerifyURL}
}

// Verify returns the profile for the id-token, ErrLineTokenInvalid when it is rejected,
// or ErrLineUnavailable (wrapped) when LINE cannot be reached.
func (v *LineVerifier) Verify(ctx context.Context, idToken string) (LineProfile, error) {
	idToken = strings.TrimSpace(idToken)
	if idToken == "" {
		return LineProfile{}, ErrLineTokenInvalid
	}
	if v.Mock {
		return parseMockToken(idToken)
	}
	return v.verifyRemote(ctx, idToken)
}

func parseMockToken(tok string) (LineProfile, error) {
	parts := strings.SplitN(tok, ":", 3)
	if len(parts) < 2 || parts[0] != "mock" || strings.TrimSpace(parts[1]) == "" {
		return LineProfile{}, ErrLineTokenInvalid
	}
	p := LineProfile{UserID: strings.TrimSpace(parts[1])}
	if len(parts) == 3 {
		p.DisplayName = strings.TrimSpace(parts[2])
	}
	if p.DisplayName == "" {
		p.DisplayName = p.UserID
	}
	return p, nil
}

func (v *LineVerifier) verifyRemote(ctx context.Context, idToken string) (LineProfile, error) {
	form := url.Values{"id_token": {idToken}, "client_id": {v.ChannelID}}
	endpoint := v.endpoint
	if endpoint == "" {
		endpoint = lineVerifyURL
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(form.Encode()))
	if err != nil {
		return LineProfile{}, fmt.Errorf("%w: %v", ErrLineUnavailable, err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	client := v.HTTP
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}
	res, err := client.Do(req)
	if err != nil {
		return LineProfile{}, fmt.Errorf("%w: %v", ErrLineUnavailable, err)
	}
	defer res.Body.Close()
	body, err := io.ReadAll(io.LimitReader(res.Body, 64<<10))
	if err != nil {
		return LineProfile{}, fmt.Errorf("%w: %v", ErrLineUnavailable, err)
	}
	switch {
	case res.StatusCode == http.StatusOK:
	case res.StatusCode >= 400 && res.StatusCode < 500:
		// LINE answers 400 with {"error":"invalid_request","error_description":"..."} for bad/expired tokens.
		return LineProfile{}, ErrLineTokenInvalid
	default:
		return LineProfile{}, fmt.Errorf("%w: status %d", ErrLineUnavailable, res.StatusCode)
	}
	var out struct {
		Sub     string `json:"sub"`
		Name    string `json:"name"`
		Picture string `json:"picture"`
	}
	if err := json.Unmarshal(body, &out); err != nil || out.Sub == "" {
		return LineProfile{}, ErrLineTokenInvalid
	}
	p := LineProfile{UserID: out.Sub, DisplayName: out.Name, Picture: out.Picture}
	if p.DisplayName == "" {
		p.DisplayName = p.UserID
	}
	return p, nil
}
