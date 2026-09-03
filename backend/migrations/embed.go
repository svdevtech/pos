// Package migrations embeds the SQL schema migrations so the API binary can apply them on start-up.
package migrations

import "embed"

//go:embed *.sql
var FS embed.FS
