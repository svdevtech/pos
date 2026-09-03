// Package httptransport wires use cases to chi routes.
package httptransport

import (
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"

	"github.com/svdev/pos/internal/auth"
	"github.com/svdev/pos/internal/config"
	"github.com/svdev/pos/internal/repository/postgres"
)

// Deps groups every use-case service the HTTP layer needs. Fields are added as modules are built.
type Deps struct {
	Cfg *config.Config
	DB  *postgres.DB
	JWT *auth.JWT
	Log *slog.Logger

	Auth      AuthService
	Store     StoreService
	Product   ProductService
	Member    MemberService
	Sales     SalesService
	Inventory InventoryService
	AR        ARService
	Expense   ExpenseService
	Report    ReportService
	Dividend  DividendService
	AI        AIService
	Admin     AdminService
	Liff      LiffService
	DataOps   DataOpsService
	Promo     PromotionService
}

type Server struct {
	Deps
	jwt     *auth.JWT
	router  chi.Router
	version string
	started time.Time
	authRL  *rateLimiter
}

func New(d Deps, version string) *Server {
	s := &Server{Deps: d, jwt: d.JWT, version: version, started: time.Now(), authRL: newRateLimiter(d.Cfg.RateLimit, time.Minute)}
	s.router = s.routes()
	return s
}

func (s *Server) Handler() http.Handler { return s.router }

func (s *Server) routes() chi.Router {
	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Recoverer)
	r.Use(middleware.Timeout(120 * time.Second))
	r.Use(requestLogger(s.Log))
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   s.Cfg.CORSOrigins,
		AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-Store-Id", "X-Locale", "Accept-Language"},
		AllowCredentials: true,
		MaxAge:           300,
	}))

	r.Get("/health", s.health)
	r.Get("/api/v1/health", s.health)
	r.Get("/api/v1/version", func(w http.ResponseWriter, r *http.Request) {
		ok(w, map[string]any{"version": s.version, "started_at": s.started})
	})

	r.Route("/api/v1", func(r chi.Router) {
		s.mountAuth(r)
		r.Group(func(r chi.Router) {
			r.Use(s.authenticate)
			s.mountAdmin(r)
			r.Group(func(r chi.Router) {
				r.Use(requireStore)
				s.mountStore(r)
				s.mountProducts(r)
				s.mountMembers(r)
				s.mountSales(r)
				s.mountPromotions(r)
				s.mountInventory(r)
				s.mountAR(r)
				s.mountExpenses(r)
				s.mountReports(r)
				s.mountDividends(r)
				s.mountAI(r)
				s.mountLiff(r)
				s.mountDataOps(r)
			})
		})
	})
	return r
}

func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	status := "ok"
	code := http.StatusOK
	if err := s.DB.Pool.Ping(r.Context()); err != nil {
		status = "db_down"
		code = http.StatusServiceUnavailable
	}
	writeJSON(w, code, map[string]any{"status": status, "version": s.version, "uptime_s": int(time.Since(s.started).Seconds())})
}

func requestLogger(log *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
			next.ServeHTTP(ww, r)
			if r.URL.Path == "/health" || r.URL.Path == "/api/v1/health" {
				return
			}
			log.Info("http", "method", r.Method, "path", r.URL.Path, "status", ww.Status(), "ms", time.Since(start).Milliseconds(), "rid", middleware.GetReqID(r.Context()))
		})
	}
}
