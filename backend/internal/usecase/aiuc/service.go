// Package aiuc implements the T-RAG "ask your data" feature: natural language → guarded SQL → result → explanation.
package aiuc

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/svdev/pos/internal/ai/nl2sql"
	"github.com/svdev/pos/internal/ai/tllm"
	"github.com/svdev/pos/internal/domain"
	"github.com/svdev/pos/internal/repository/postgres"
)

type Service struct {
	db      *postgres.DB
	llm     *tllm.Client
	enabled bool
	maxRows int
}

func New(db *postgres.DB, llm *tllm.Client, enabled bool) *Service {
	return &Service{db: db, llm: llm, enabled: enabled, maxRows: 200}
}

type Result struct {
	Question    string   `json:"question"`
	SQL         string   `json:"sql"`
	Columns     []string `json:"columns"`
	Rows        [][]any  `json:"rows"`
	RowCount    int      `json:"row_count"`
	DurationMS  int64    `json:"duration_ms"`
	Explanation string   `json:"explanation,omitempty"`
	Attempts    int      `json:"attempts"`
	Warnings    []string `json:"warnings,omitempty"`
	Truncated   bool     `json:"truncated"`
	LogID       int64    `json:"log_id,omitempty"`
}

func (s *Service) Enabled() bool { return s.enabled && s.llm != nil }

func (s *Service) Status(ctx context.Context) map[string]any {
	out := map[string]any{"enabled": s.Enabled()}
	if s.Enabled() {
		if err := s.llm.Health(ctx); err != nil {
			out["gateway"] = "unreachable"
			out["error"] = err.Error()
		} else {
			out["gateway"] = "ok"
		}
		out["base_url"] = s.llm.BaseURL
		out["model"] = s.llm.Model
	}
	return out
}

// Ask generates SQL for the question, runs it read-only under the tenant scope, retrying once with the
// database error as a hint, then (optionally) asks the model to explain the result.
func (s *Service) Ask(ctx context.Context, storeID, userID uuid.UUID, question string, explain bool) (*Result, error) {
	if !s.Enabled() {
		return nil, domain.ErrFeatureDisabled
	}
	question = strings.TrimSpace(question)
	if question == "" || len(question) > 1000 {
		return nil, domain.ErrValidation.With("field", "question")
	}
	res := &Result{Question: question}
	var hints []string
	var lastErr error
	for attempt := 1; attempt <= 3; attempt++ {
		res.Attempts = attempt
		raw, err := s.llm.Generate(ctx, nl2sql.SystemPrompt, nl2sql.BuildUserPrompt(question, hints))
		if err != nil {
			s.log(ctx, storeID, userID, question, "", 0, 0, err.Error())
			return nil, domain.ErrAIUpstream.Wrap(err)
		}
		sql, err := nl2sql.Guard(raw, s.maxRows)
		if err != nil {
			lastErr = err
			hints = append(hints, "guard rejected: "+err.Error()+" (statement was: "+truncate(nl2sql.Clean(raw), 200)+")")
			res.Warnings = append(res.Warnings, err.Error())
			continue
		}
		res.SQL = sql
		start := time.Now()
		if err := s.run(ctx, storeID, sql, res); err != nil {
			lastErr = err
			hints = append(hints, "PostgreSQL error: "+err.Error()+" (statement was: "+truncate(sql, 300)+")")
			res.Warnings = append(res.Warnings, err.Error())
			continue
		}
		res.DurationMS = time.Since(start).Milliseconds()
		lastErr = nil
		break
	}
	if lastErr != nil {
		s.log(ctx, storeID, userID, question, res.SQL, 0, res.DurationMS, lastErr.Error())
		if errors.Is(lastErr, nl2sql.ErrForbidden) || errors.Is(lastErr, nl2sql.ErrNotSelect) || errors.Is(lastErr, nl2sql.ErrNoTable) {
			return nil, domain.ErrAIUnsafeSQL.Wrap(lastErr)
		}
		return nil, domain.ErrAIUpstream.Wrap(lastErr)
	}
	if explain && res.RowCount > 0 {
		sample, _ := json.Marshal(map[string]any{"columns": res.Columns, "rows": firstN(res.Rows, 30)})
		if txt, err := s.llm.Generate(ctx, nl2sql.ExplainPrompt, "Question: "+question+"\nSQL: "+res.SQL+"\nResult (JSON): "+string(sample)); err == nil {
			res.Explanation = strings.TrimSpace(txt)
		}
	}
	res.LogID = s.log(ctx, storeID, userID, question, res.SQL, res.RowCount, res.DurationMS, "")
	return res, nil
}

// run executes the guarded SQL in a read-only, tenant-scoped transaction with a statement timeout.
func (s *Service) run(ctx context.Context, storeID uuid.UUID, sql string, res *Result) error {
	return s.db.WithTx(ctx, postgres.Scope{StoreID: storeID}, func(ctx context.Context, tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, "SET TRANSACTION READ ONLY"); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, "SET LOCAL statement_timeout = '8s'"); err != nil {
			return err
		}
		rows, err := tx.Query(ctx, sql)
		if err != nil {
			return err
		}
		defer rows.Close()
		res.Columns = nil
		for _, f := range rows.FieldDescriptions() {
			res.Columns = append(res.Columns, f.Name)
		}
		res.Rows = [][]any{}
		for rows.Next() {
			vals, err := rows.Values()
			if err != nil {
				return err
			}
			for i, v := range vals {
				vals[i] = normalize(v)
			}
			res.Rows = append(res.Rows, vals)
			if len(res.Rows) >= s.maxRows {
				res.Truncated = true
				break
			}
		}
		res.RowCount = len(res.Rows)
		return rows.Err()
	})
}

func (s *Service) log(ctx context.Context, storeID, userID uuid.UUID, q, sql string, n int, ms int64, errStr string) int64 {
	var id int64
	_ = s.db.WithTx(ctx, postgres.Scope{StoreID: storeID}, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `INSERT INTO ai_query_logs (store_id, user_id, question, generated_sql, row_count, duration_ms, error) VALUES ($1,$2,$3,NULLIF($4,''),$5,$6,NULLIF($7,'')) RETURNING id`,
			storeID, userID, q, sql, n, int(ms), errStr).Scan(&id)
	})
	return id
}

type HistoryRow struct {
	ID        int64     `json:"id"`
	Question  string    `json:"question"`
	SQL       string    `json:"sql,omitempty"`
	RowCount  int       `json:"row_count"`
	Error     string    `json:"error,omitempty"`
	CreatedAt time.Time `json:"created_at"`
}

func (s *Service) History(ctx context.Context, storeID uuid.UUID, limit int) ([]HistoryRow, error) {
	out := []HistoryRow{}
	err := s.db.WithTx(ctx, postgres.Scope{StoreID: storeID}, func(ctx context.Context, tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `SELECT id, question, COALESCE(generated_sql,''), COALESCE(row_count,0), COALESCE(error,''), created_at FROM ai_query_logs WHERE store_id=$1 ORDER BY id DESC LIMIT $2`, storeID, limit)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var h HistoryRow
			if err := rows.Scan(&h.ID, &h.Question, &h.SQL, &h.RowCount, &h.Error, &h.CreatedAt); err != nil {
				return err
			}
			out = append(out, h)
		}
		return rows.Err()
	})
	return out, err
}

func normalize(v any) any {
	switch x := v.(type) {
	case time.Time:
		return x.In(postgres.Bangkok()).Format(time.RFC3339)
	case [16]byte:
		return uuid.UUID(x).String()
	case fmt.Stringer:
		return x.String()
	default:
		return v
	}
}

func firstN(rows [][]any, n int) [][]any {
	if len(rows) <= n {
		return rows
	}
	return rows[:n]
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
