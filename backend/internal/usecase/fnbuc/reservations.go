package fnbuc

import (
	"context"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/svdev/pos/internal/domain"
	"github.com/svdev/pos/internal/repository/postgres"
)

// ---------------------------------------------------------------------------
// The reservation book and the walk-in waitlist
// ---------------------------------------------------------------------------

// Reservations is the book for one day (bookings by time) plus every party still waiting.
func (s *Service) Reservations(ctx context.Context, storeID uuid.UUID, day time.Time) ([]domain.Reservation, error) {
	start := time.Date(day.Year(), day.Month(), day.Day(), 0, 0, 0, 0, postgres.Bangkok())
	var out []domain.Reservation
	err := s.db.WithTx(ctx, postgres.Scope{StoreID: storeID}, func(ctx context.Context, _ pgx.Tx) error {
		var err error
		out, err = s.repo.Reservations(ctx, storeID, start, start.AddDate(0, 0, 1))
		return err
	})
	if out == nil {
		out = []domain.Reservation{}
	}
	return out, err
}

func (s *Service) SaveReservation(ctx context.Context, storeID uuid.UUID, actor Actor, r domain.Reservation) (*domain.Reservation, error) {
	r.StoreID = storeID
	r.Name = strings.TrimSpace(r.Name)
	if r.Name == "" {
		return nil, domain.ErrValidation.With("field", "name")
	}
	if r.Kind != domain.ReservationBooked && r.Kind != domain.ReservationWaitlist {
		return nil, domain.ErrValidation.With("field", "kind")
	}
	if r.PartySize <= 0 {
		r.PartySize = 2
	}
	if r.At.IsZero() {
		r.At = time.Now()
	}
	if r.Status == "" {
		if r.Kind == domain.ReservationWaitlist {
			r.Status = "waiting"
		} else {
			r.Status = "booked"
		}
	}
	if r.ID == uuid.Nil {
		r.CreatedBy = actor.idPtr()
	}
	err := s.db.WithTx(ctx, postgres.Scope{StoreID: storeID}, func(ctx context.Context, _ pgx.Tx) error { return s.repo.UpsertReservation(ctx, &r) })
	if err == nil {
		s.hub.Publish(storeID, Event{Kind: "reservations"})
	}
	return &r, err
}

// SeatReservation puts the party on a table: the reservation is marked seated and the table is
// opened for them (an order with no lines, guests = party size), so the floor turns "seated"
// and the table's QR may take their orders.
func (s *Service) SetReservationStatus(ctx context.Context, storeID uuid.UUID, actor Actor, id uuid.UUID, status, tableCode string) (*domain.Reservation, error) {
	switch status {
	case "booked", "waiting", "seated", "cancelled", "no_show":
	default:
		return nil, domain.ErrValidation.With("field", "status")
	}
	tableCode = strings.TrimSpace(tableCode)
	var out *domain.Reservation
	err := s.db.WithTx(ctx, postgres.Scope{StoreID: storeID}, func(ctx context.Context, _ pgx.Tx) error {
		if err := s.repo.SetReservationStatus(ctx, storeID, id, status, tableCode); err != nil {
			return err
		}
		var err error
		out, err = s.repo.GetReservation(ctx, storeID, id)
		return err
	})
	if err != nil {
		return nil, err
	}
	if status == "seated" && out.TableCode != "" {
		n, err := s.liveOrders(ctx, storeID, out.TableCode)
		if err == nil && n == 0 {
			if _, err := s.CreateOrder(ctx, storeID, actor, CreateOrderInput{Channel: domain.ChannelDineIn, TableCode: out.TableCode, Guests: out.PartySize, OpenTable: true, Note: "reservation: " + out.Name}); err != nil {
				return nil, err
			}
		}
	}
	s.hub.Publish(storeID, Event{Kind: "reservations"})
	return out, nil
}

func (s *Service) liveOrders(ctx context.Context, storeID uuid.UUID, tableCode string) (int, error) {
	var n int
	err := s.db.WithTx(ctx, postgres.Scope{StoreID: storeID}, func(ctx context.Context, _ pgx.Tx) error {
		var err error
		n, err = s.repo.LiveOrderCount(ctx, storeID, tableCode)
		return err
	})
	return n, err
}
