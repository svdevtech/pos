package dataopsuc

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/svdev/pos/internal/domain"
)

// Backups are large (~80 MB) and downloaded from tablets, where fetching the whole file into a Blob
// and clicking a synthetic <a download> does not work: iOS Safari ignores the download attribute and
// the memory copy can fail outright. So the UI asks for a short-lived signed link instead and lets
// the browser's own download manager stream the file.

// DownloadTTL is how long a signed backup link stays valid.
const DownloadTTL = 5 * time.Minute

// SignDownload returns a token authorising exactly one file of one store until it expires.
func (s *Service) SignDownload(secret string, storeID uuid.UUID, name string) (token string, expires time.Time, err error) {
	if _, err := s.FilePath(storeID, name); err != nil {
		return "", time.Time{}, err
	}
	expires = time.Now().Add(DownloadTTL)
	return sign(secret, storeID, name, expires.Unix()), expires, nil
}

// VerifyDownload checks a token and returns the file it authorises.
func (s *Service) VerifyDownload(secret string, storeID uuid.UUID, name, token string) (string, error) {
	exp, mac, ok := splitToken(token)
	if !ok {
		return "", domain.ErrTokenInvalid
	}
	if time.Now().Unix() > exp {
		return "", domain.ErrTokenInvalid
	}
	want := sign(secret, storeID, name, exp)
	// constant time: the token is the only thing standing in front of the file
	if !hmac.Equal([]byte(want), []byte(strconv.FormatInt(exp, 10)+"."+mac)) {
		return "", domain.ErrTokenInvalid
	}
	return s.FilePath(storeID, name)
}

func sign(secret string, storeID uuid.UUID, name string, exp int64) string {
	m := hmac.New(sha256.New, []byte(secret))
	fmt.Fprintf(m, "backup:%s:%s:%d", storeID, name, exp)
	return fmt.Sprintf("%d.%s", exp, base64.RawURLEncoding.EncodeToString(m.Sum(nil)))
}

func splitToken(token string) (exp int64, mac string, ok bool) {
	parts := strings.SplitN(token, ".", 2)
	if len(parts) != 2 {
		return 0, "", false
	}
	exp, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil {
		return 0, "", false
	}
	return exp, parts[1], true
}
