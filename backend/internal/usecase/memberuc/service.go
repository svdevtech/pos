// Package memberuc implements co-op members: profile CRUD, the share-capital ledger,
// LINE link codes and the LIFF member self-service (verify / link / me / purchases / dividend).
package memberuc

import (
	"context"
	"crypto/rand"
	"errors"
	"io"
	"time"

	"github.com/google/uuid"

	"github.com/svdev/pos/internal/auth"
	"github.com/svdev/pos/internal/domain"
	"github.com/svdev/pos/internal/repository/postgres"
	"github.com/svdev/pos/internal/usecase/storeuc"
)

// Actor identifies the staff user performing an action (shared with storeuc so handlers can pass actorOf(r)).
type Actor = storeuc.Actor

// LineVerifier validates a LIFF id-token (see auth.LineVerifier).
type LineVerifier interface {
	Verify(ctx context.Context, idToken string) (auth.LineProfile, error)
}

type Service struct {
	db        *postgres.DB
	jwt       *auth.JWT
	line      LineVerifier
	members   postgres.MemberRepo
	shares    postgres.ShareRepo
	codes     postgres.LinkCodeRepo
	dividends postgres.DividendReadRepo
	stores    postgres.StoreRepo
	audit     postgres.AuditRepo
	now       func() time.Time
	rand      io.Reader
}

func New(db *postgres.DB, jwt *auth.JWT, line LineVerifier) *Service {
	return &Service{db: db, jwt: jwt, line: line, now: time.Now, rand: rand.Reader}
}

func (s *Service) scope(storeID uuid.UUID) postgres.Scope { return postgres.Scope{StoreID: storeID} }

func actorID(a Actor) *uuid.UUID {
	if a.UserID == uuid.Nil {
		return nil
	}
	id := a.UserID
	return &id
}

func (s *Service) writeAudit(ctx context.Context, storeID uuid.UUID, a Actor, action, entity, entityID string, before, after any) error {
	return s.audit.Write(ctx, domain.AuditEntry{StoreID: &storeID, ActorID: actorID(a), ActorName: a.Name, Action: action, Entity: entity, EntityID: entityID, Before: before, After: after, IP: a.IP})
}

// mapLineErr translates verifier errors into domain errors.
func mapLineErr(err error) error {
	switch {
	case err == nil:
		return nil
	case errors.Is(err, auth.ErrLineTokenInvalid):
		return domain.ErrTokenInvalid
	default:
		return domain.ErrLineUpstream.Wrap(err)
	}
}
