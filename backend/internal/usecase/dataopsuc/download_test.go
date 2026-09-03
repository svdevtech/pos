package dataopsuc

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

// a service whose backup directory holds one file
func withBackup(t *testing.T, name string) (*Service, uuid.UUID) {
	t.Helper()
	dir := t.TempDir()
	s := New(nil, dir, nil)
	store := uuid.New()
	sub, err := s.storeDir(store, "backups")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(sub, name), []byte("zip"), 0o600); err != nil {
		t.Fatal(err)
	}
	return s, store
}

func TestSignedDownloadRoundTrip(t *testing.T) {
	const secret = "test-secret"
	name := "pos-backup-BBR-20260903-214437.zip"
	s, store := withBackup(t, name)

	token, exp, err := s.SignDownload(secret, store, name)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	if time.Until(exp) <= 0 || time.Until(exp) > DownloadTTL+time.Second {
		t.Fatalf("expiry out of range: %v", exp)
	}
	path, err := s.VerifyDownload(secret, store, name, token)
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if filepath.Base(path) != name {
		t.Fatalf("path = %s", path)
	}
}

func TestSignedDownloadRejects(t *testing.T) {
	const secret = "test-secret"
	name := "pos-backup-BBR-20260903-214437.zip"
	s, store := withBackup(t, name)
	token, _, err := s.SignDownload(secret, store, name)
	if err != nil {
		t.Fatal(err)
	}

	other, otherStore := withBackup(t, name)

	tests := []struct {
		name string
		call func() (string, error)
	}{
		{"a tampered signature", func() (string, error) {
			return s.VerifyDownload(secret, store, name, strings.TrimSuffix(token, "A")+"B")
		}},
		{"the wrong secret", func() (string, error) { return s.VerifyDownload("other-secret", store, name, token) }},
		{"another store's token", func() (string, error) { return other.VerifyDownload(secret, otherStore, name, token) }},
		{"another file", func() (string, error) {
			return s.VerifyDownload(secret, store, "pos-backup-BBR-19990101-000000.zip", token)
		}},
		{"garbage", func() (string, error) { return s.VerifyDownload(secret, store, name, "not-a-token") }},
		{"an expired token", func() (string, error) {
			return s.VerifyDownload(secret, store, name, sign(secret, store, name, time.Now().Add(-time.Minute).Unix()))
		}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if _, err := tt.call(); err == nil {
				t.Fatal("expected the download to be refused")
			}
		})
	}
}

// a name that tries to walk out of the store's directory must never resolve
func TestSignDownloadRefusesPathTricks(t *testing.T) {
	s, store := withBackup(t, "pos-backup-BBR-20260903-214437.zip")
	for _, name := range []string{"../../etc/passwd", "..\\secrets.zip", "sub/dir.zip", ""} {
		if _, _, err := s.SignDownload("secret", store, name); err == nil {
			t.Fatalf("%q was accepted", name)
		}
	}
}
