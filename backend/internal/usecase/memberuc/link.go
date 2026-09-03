package memberuc

import (
	"context"
	"errors"
	"io"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/svdev/pos/internal/domain"
)

// Link codes: 6 upper-case alphanumerics, ambiguous glyphs (0/O, 1/I) removed, valid for 15 minutes.
const (
	linkCodeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	linkCodeLen      = 6
	linkCodeTTL      = 15 * time.Minute
	linkCodeRetries  = 5
)

// GenerateLinkCode draws a random code from the alphabet using r (crypto/rand in production).
func GenerateLinkCode(r io.Reader) (string, error) {
	buf := make([]byte, linkCodeLen)
	if _, err := io.ReadFull(r, buf); err != nil {
		return "", err
	}
	out := make([]byte, linkCodeLen)
	for i, b := range buf {
		out[i] = linkCodeAlphabet[int(b)%len(linkCodeAlphabet)]
	}
	return string(out), nil
}

// NormalizeLinkCode upper-cases and strips separators/whitespace from user input ("ab-c 12d" → "ABC12D").
func NormalizeLinkCode(s string) string {
	s = strings.ToUpper(strings.TrimSpace(s))
	return strings.NewReplacer(" ", "", "-", "", "_", "").Replace(s)
}

// ValidLinkCode reports whether s has the shape of a generated code (after NormalizeLinkCode).
func ValidLinkCode(s string) bool {
	if len(s) != linkCodeLen {
		return false
	}
	for i := 0; i < len(s); i++ {
		if !strings.ContainsRune(linkCodeAlphabet, rune(s[i])) {
			return false
		}
	}
	return true
}

// LinkCodeResult is the response of POST /members/{id}/link-code.
type LinkCodeResult struct {
	Code      string    `json:"code"`
	ExpiresAt time.Time `json:"expires_at"`
}

func (s *Service) CreateLinkCode(ctx context.Context, actor Actor, storeID, memberID uuid.UUID) (*LinkCodeResult, error) {
	var out *LinkCodeResult
	err := s.db.WithTx(ctx, s.scope(storeID), func(ctx context.Context, _ pgx.Tx) error {
		m, err := s.members.Get(ctx, storeID, memberID)
		if err != nil {
			return err
		}
		if m.IsWalkin {
			return domain.ErrValidation.With("field", "member")
		}
		if m.Status != domain.MemberActive {
			return domain.ErrMemberInactive
		}
		if err := s.codes.RevokeUnused(ctx, storeID, memberID); err != nil {
			return err
		}
		exp := s.now().Add(linkCodeTTL)
		for attempt := 0; attempt < linkCodeRetries; attempt++ {
			code, err := GenerateLinkCode(s.rand)
			if err != nil {
				return err
			}
			err = s.codes.Create(ctx, domain.MemberLinkCode{Code: code, StoreID: storeID, MemberID: memberID, ExpiresAt: exp})
			if errors.Is(err, domain.ErrConflict) {
				continue
			}
			if err != nil {
				return err
			}
			out = &LinkCodeResult{Code: code, ExpiresAt: exp}
			break
		}
		if out == nil {
			return domain.ErrInternal.Wrap(errors.New("link code: could not allocate a unique code"))
		}
		return s.writeAudit(ctx, storeID, actor, "member.link_code", "member", memberID.String(), nil, map[string]any{"expires_at": exp})
	})
	return out, err
}

func (s *Service) UnlinkLine(ctx context.Context, actor Actor, storeID, memberID uuid.UUID) error {
	return s.db.WithTx(ctx, s.scope(storeID), func(ctx context.Context, _ pgx.Tx) error {
		m, err := s.members.Get(ctx, storeID, memberID)
		if err != nil {
			return err
		}
		if !m.LineLinked() {
			return nil
		}
		if err := s.members.ClearLine(ctx, storeID, memberID); err != nil {
			return err
		}
		return s.writeAudit(ctx, storeID, actor, "member.line.unlink", "member", memberID.String(),
			map[string]any{"line_user_id": m.LineUserID, "line_display": m.LineDisplay}, nil)
	})
}
