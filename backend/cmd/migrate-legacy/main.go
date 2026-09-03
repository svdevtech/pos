// Command migrate-legacy imports a pstorenusoft (MS Access) dump into PostgreSQL for one store.
//
//	migrate-legacy -dir ../legacy-dump -store BBR -dry-run
//	migrate-legacy -dir ../legacy-dump -store BBR
//	migrate-legacy -dir ../legacy-dump -store BBR -stage sales,reconcile -report out.json
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"strings"

	"github.com/svdev/pos/internal/config"
	"github.com/svdev/pos/internal/legacy"
	"github.com/svdev/pos/internal/repository/postgres"
)

func main() {
	var (
		dir       = flag.String("dir", "", "directory with manifest.json + *.jsonl (from tools/legacy-extract/extract.ps1)")
		store     = flag.String("store", "", "store code (must exist; create with cmd/seed)")
		stages    = flag.String("stage", "", "comma-separated stages (default all): "+strings.Join(legacy.StageOrder, ","))
		dryRun    = flag.Bool("dry-run", false, "run everything in one transaction and roll back")
		checkHash = flag.Bool("check-hash", false, "verify sha256 of every jsonl file against the manifest")
		reportOut = flag.String("report", "", "write the JSON report to this file")
	)
	flag.Parse()
	if *dir == "" || *store == "" {
		flag.Usage()
		os.Exit(2)
	}
	cfg, err := config.Load()
	if err != nil {
		fatal(err)
	}
	log := slog.New(slog.NewTextHandler(os.Stderr, nil))
	ctx := context.Background()
	if err := postgres.Migrate(cfg.DatabaseURL, log); err != nil {
		fatal(err)
	}
	db, err := postgres.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		fatal(err)
	}
	defer db.Close()

	var st []string
	if *stages != "" {
		for _, s := range strings.Split(*stages, ",") {
			if s = strings.TrimSpace(s); s != "" {
				st = append(st, s)
			}
		}
	}
	im, err := legacy.New(db, legacy.Options{Dir: *dir, StoreCode: *store, Stages: st, DryRun: *dryRun, CheckHash: *checkHash, Log: log})
	if err != nil {
		fatal(err)
	}
	report, runErr := im.Run(ctx)
	b, _ := json.MarshalIndent(report, "", "  ")
	if *reportOut != "" {
		if err := os.WriteFile(*reportOut, b, 0o644); err != nil {
			fatal(err)
		}
		fmt.Fprintln(os.Stderr, "report written:", *reportOut)
	} else {
		fmt.Println(string(b))
	}
	if report.Reconcile != nil {
		fmt.Fprintf(os.Stderr, "\n%-42s %16s %16s  %s\n", "check", "expected", "actual", "")
		for _, c := range report.Reconcile.Checks {
			mark := "OK"
			if !c.OK {
				mark = "MISMATCH"
			}
			fmt.Fprintf(os.Stderr, "%-42s %16s %16s  %s\n", c.Name, c.Expected, c.Actual, mark)
		}
	}
	if runErr != nil {
		fatal(runErr)
	}
}

func fatal(err error) {
	fmt.Fprintln(os.Stderr, "migrate-legacy:", err)
	os.Exit(1)
}
