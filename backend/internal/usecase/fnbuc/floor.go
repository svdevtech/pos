package fnbuc

import (
	"context"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/svdev/pos/internal/domain"
	"github.com/svdev/pos/internal/repository/postgres"
)

// ---------------------------------------------------------------------------
// The dining room: zones and tables, edited by managers, drawn by every screen
// ---------------------------------------------------------------------------

// FloorView is the whole room in one round trip; the floor plans draw it to scale.
type FloorView struct {
	Zones  []domain.FloorZone  `json:"zones"`
	Tables []domain.FloorTable `json:"tables"`
}

func (s *Service) Floor(ctx context.Context, storeID uuid.UUID, activeOnly bool) (*FloorView, error) {
	out := &FloorView{}
	err := s.db.WithTx(ctx, postgres.Scope{StoreID: storeID}, func(ctx context.Context, _ pgx.Tx) error {
		var err error
		if out.Zones, err = s.repo.Zones(ctx, storeID, activeOnly); err != nil {
			return err
		}
		out.Tables, err = s.repo.Tables(ctx, storeID, activeOnly)
		return err
	})
	return out, err
}

func (s *Service) SaveZone(ctx context.Context, storeID uuid.UUID, z domain.FloorZone) (*domain.FloorZone, error) {
	z.StoreID = storeID
	z.Name = strings.TrimSpace(z.Name)
	if z.Name == "" {
		return nil, domain.ErrValidation.With("field", "name")
	}
	if strings.TrimSpace(z.Color) == "" {
		z.Color = "#2b3d55"
	}
	err := s.db.WithTx(ctx, postgres.Scope{StoreID: storeID}, func(ctx context.Context, _ pgx.Tx) error { return s.repo.UpsertZone(ctx, &z) })
	if err == nil {
		s.hub.Publish(storeID, Event{Kind: "floor"})
	}
	return &z, err
}

// SaveTable saves a table and makes sure it has a QR token, so the QR page and the customer's
// phone work the moment a table exists.
func (s *Service) SaveTable(ctx context.Context, storeID uuid.UUID, t domain.FloorTable) (*domain.FloorTable, error) {
	t.StoreID = storeID
	t.Code = strings.TrimSpace(t.Code)
	if t.Code == "" {
		return nil, domain.ErrValidation.With("field", "code")
	}
	switch t.Shape {
	case "round", "square", "long":
	default:
		t.Shape = "square"
	}
	if t.Seats <= 0 {
		t.Seats = 4
	}
	err := s.db.WithTx(ctx, postgres.Scope{StoreID: storeID}, func(ctx context.Context, _ pgx.Tx) error {
		if err := s.repo.UpsertTable(ctx, &t); err != nil {
			return err
		}
		_, err := s.repo.EnsureTableToken(ctx, storeID, t.Code, false)
		return err
	})
	if err == nil {
		s.hub.Publish(storeID, Event{Kind: "floor"})
	}
	return &t, err
}
