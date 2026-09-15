package fnbuc

import (
	"context"
	"sync"

	"github.com/google/uuid"

	"github.com/svdev/pos/internal/domain"
)

// Event is what the kitchen, the floor and a table's own screen hear about: an order changed,
// or a table got a new customer code. The whole order rides along so a listener never has to
// make a second call.
type Event struct {
	Kind  string        `json:"kind"` // created | updated | table | floor
	Order *domain.Order `json:"order,omitempty"`
	Table *TableToken   `json:"table,omitempty"`
}

// hub fans events out per store. In-process only: one API container serves every till, and a
// restart simply drops the connections — the screens fall back to polling and reconnect.
type hub struct {
	mu   sync.Mutex
	subs map[uuid.UUID]map[chan Event]struct{}
}

func newHub() *hub { return &hub{subs: map[uuid.UUID]map[chan Event]struct{}{}} }

// Subscribe returns a channel of the store's events until ctx ends. A slow listener does not
// hold the others up: an event it cannot take right now is dropped, and its next poll catches up.
func (h *hub) Subscribe(ctx context.Context, storeID uuid.UUID) <-chan Event {
	ch := make(chan Event, 16)
	h.mu.Lock()
	if h.subs[storeID] == nil {
		h.subs[storeID] = map[chan Event]struct{}{}
	}
	h.subs[storeID][ch] = struct{}{}
	h.mu.Unlock()
	go func() {
		<-ctx.Done()
		h.mu.Lock()
		delete(h.subs[storeID], ch)
		if len(h.subs[storeID]) == 0 {
			delete(h.subs, storeID)
		}
		h.mu.Unlock()
		close(ch)
	}()
	return ch
}

func (h *hub) Publish(storeID uuid.UUID, ev Event) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for ch := range h.subs[storeID] {
		select {
		case ch <- ev:
		default:
		}
	}
}

// Subscribe exposes the store's order events to the HTTP layer (SSE) and to tests.
func (s *Service) Subscribe(ctx context.Context, storeID uuid.UUID) <-chan Event {
	return s.hub.Subscribe(ctx, storeID)
}
