// Command seed creates the platform admin and (optionally) a first store with an owner user.
//
//	seed                              -> platform admin from PLATFORM_ADMIN_USER / PLATFORM_ADMIN_PASSWORD
//	seed -store BBR -store-name "..." -owner owner -owner-password secret
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"os"

	"github.com/jackc/pgx/v5"

	"github.com/svdev/pos/internal/auth"
	"github.com/svdev/pos/internal/config"
	"github.com/svdev/pos/internal/domain"
	"github.com/svdev/pos/internal/repository/postgres"
)

func main() {
	var (
		storeCode = flag.String("store", "", "store code to create (optional)")
		storeName = flag.String("store-name", "", "store name")
		owner     = flag.String("owner", "owner", "store owner username")
		ownerPass = flag.String("owner-password", "", "store owner password")
		adminUser = flag.String("admin", "", "platform admin username (default PLATFORM_ADMIN_USER)")
		adminPass = flag.String("admin-password", "", "platform admin password (default PLATFORM_ADMIN_PASSWORD)")
	)
	flag.Parse()
	cfg, err := config.Load()
	if err != nil {
		fatal(err)
	}
	log := slog.New(slog.NewTextHandler(os.Stdout, nil))
	if err := postgres.Migrate(cfg.DatabaseURL, log); err != nil {
		fatal(err)
	}
	ctx := context.Background()
	db, err := postgres.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		fatal(err)
	}
	defer db.Close()

	if *adminUser == "" {
		*adminUser = cfg.PlatformAdminUser
	}
	if *adminPass == "" {
		*adminPass = cfg.PlatformAdminPassword
	}
	var users postgres.UserRepo
	var stores postgres.StoreRepo

	err = db.WithTx(ctx, postgres.Scope{Bypass: true}, func(ctx context.Context, _ pgx.Tx) error {
		if *adminPass != "" {
			if _, err := users.FindByStoreAndUsername(ctx, nil, *adminUser); errors.Is(err, domain.ErrNotFound) {
				h, err := auth.HashPassword(*adminPass)
				if err != nil {
					return err
				}
				u := &domain.User{Username: *adminUser, PasswordHash: h, DisplayName: "Platform Admin", Role: domain.RolePlatformAdmin, Locale: "th", IsActive: true}
				if err := users.Create(ctx, u); err != nil {
					return err
				}
				fmt.Println("created platform admin:", *adminUser)
			} else if err == nil {
				fmt.Println("platform admin exists:", *adminUser)
			} else {
				return err
			}
		} else {
			fmt.Println("PLATFORM_ADMIN_PASSWORD not set; skipping platform admin")
		}

		if *storeCode == "" {
			return nil
		}
		st, err := stores.GetByCode(ctx, *storeCode)
		if errors.Is(err, domain.ErrNotFound) {
			st = &domain.Store{Code: *storeCode, Name: orDefault(*storeName, *storeCode), DefaultLocale: "th", Timezone: "Asia/Bangkok", IsActive: true}
			if err := stores.Create(ctx, st); err != nil {
				return err
			}
			fmt.Println("created store:", st.Code, st.ID)
		} else if err != nil {
			return err
		} else {
			fmt.Println("store exists:", st.Code, st.ID)
		}
		if *ownerPass != "" {
			if _, err := users.FindByStoreAndUsername(ctx, &st.ID, *owner); errors.Is(err, domain.ErrNotFound) {
				h, err := auth.HashPassword(*ownerPass)
				if err != nil {
					return err
				}
				u := &domain.User{StoreID: &st.ID, Username: *owner, PasswordHash: h, DisplayName: *owner, Role: domain.RoleStoreOwner, Locale: "th", IsActive: true}
				if err := users.Create(ctx, u); err != nil {
					return err
				}
				fmt.Println("created store owner:", *owner)
			} else if err == nil {
				fmt.Println("store owner exists:", *owner)
			} else {
				return err
			}
		}
		return nil
	})
	if err != nil {
		fatal(err)
	}
}

func orDefault(s, d string) string {
	if s == "" {
		return d
	}
	return s
}

func fatal(err error) {
	fmt.Fprintln(os.Stderr, "seed:", err)
	os.Exit(1)
}
