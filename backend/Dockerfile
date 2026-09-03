FROM golang:1.25-alpine AS build
WORKDIR /src
RUN apk add --no-cache git ca-certificates tzdata
COPY go.mod go.sum ./
RUN go mod download
COPY . .
ARG VERSION=dev
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags "-s -w -X main.version=${VERSION}" -o /out/api ./cmd/api \
 && CGO_ENABLED=0 GOOS=linux go build -ldflags "-s -w" -o /out/seed ./cmd/seed \
 && CGO_ENABLED=0 GOOS=linux go build -ldflags "-s -w" -o /out/migrate-legacy ./cmd/migrate-legacy

FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata curl && adduser -D -u 10001 app
ENV TZ=Asia/Bangkok
WORKDIR /app
COPY --from=build /out/api /out/seed /out/migrate-legacy /app/
USER app
EXPOSE 8090
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD curl -fsS http://localhost:8090/health || exit 1
ENTRYPOINT ["/app/api"]
