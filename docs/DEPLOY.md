# Deploy — ทดสอบบน tee-dev (Ubuntu, Docker Compose ที่ `/data/pos`)

เครื่องปลายทาง: `tee-dev` (Tailscale `100.122.174.19`, LAN `192.168.1.120`) — ดู [SSH-LOCAL-UBUNTU-SERVER.md](../SSH-LOCAL-UBUNTU-SERVER.md) สำหรับการเชื่อมต่อ

พอร์ตที่ใช้ (ไม่ชนกับโปรเจกต์อื่นที่รันอยู่: 3000–3006, 8000–8089, 54321, 63791):

| บริการ | ภายใน container | เผยแพร่บนเซิร์ฟเวอร์ |
|---|---|---|
| web (Next.js) | 3010 | `0.0.0.0:3010` — เปิด ufw |
| api (Go) | 8090 | `127.0.0.1:8090` (debug เท่านั้น; browser เรียกผ่าน Next rewrite `/api/*`) |
| postgres 16 | 5432 | `127.0.0.1:54322` |

โครงบนเซิร์ฟเวอร์:

```
/data/pos/
├── src/        ← โค้ดที่ tar ขึ้นไป (deploy.sh)
├── .env        ← ความลับ (นอก source tree; สร้างโดย install.sh)
├── pgdata/     ← ข้อมูล PostgreSQL (NVMe)
├── legacy/     ← dump จาก extract.ps1 (mount เข้า api ที่ /legacy)
└── backups/    ← pg_dump รายวัน
```

## ครั้งแรก

```bash
# 1) ส่งโค้ด (ไม่ build) แล้วเตรียมเครื่อง
bash deploy/tee-dev/deploy.sh --no-build
scp -i ~/.ssh/spark_tunnel deploy/tee-dev/install.sh tee@100.122.174.19:/tmp/
ssh ubuntu-server 'SUDO_PW="<รหัส sudo ของ tee>" bash /tmp/install.sh; rm -f /tmp/install.sh'
#    install.sh: สร้างโฟลเดอร์, ตรวจ docker/compose (มีแล้ว), เปิด ufw 3010/tcp, สร้าง /data/pos/.env พร้อมความลับสุ่ม
#    (จดรหัส PLATFORM_ADMIN_PASSWORD ที่พิมพ์ออกมา)

# 2) build + start
bash deploy/tee-dev/deploy.sh

# 3) seed ผู้ดูแลระบบ + ร้านแรก
ssh ubuntu-server 'cd /data/pos/src/deploy && docker compose --env-file /data/pos/.env run --rm --entrypoint /app/seed api -store BBR -store-name "ร้านค้าชุมชน(ประชารัฐ)บ้านบุญเรืองเหนือ" -owner owner -owner-password "Owner12345"'

# 4) นำเข้าข้อมูลเดิม (ดู docs/MIGRATION.md)
tar -C D:/workspace/pos -czf - legacy-dump | ssh ubuntu-server 'tar -xzf - -C /data/pos/legacy --strip-components=1'
ssh ubuntu-server 'cd /data/pos/src/deploy && docker compose --env-file /data/pos/.env run --rm --entrypoint /app/migrate-legacy api -dir /legacy -store BBR -dry-run'
ssh ubuntu-server 'cd /data/pos/src/deploy && docker compose --env-file /data/pos/.env run --rm --entrypoint /app/migrate-legacy api -dir /legacy -store BBR -report /legacy/import-report.json'
```

เปิดใช้งาน: `http://192.168.1.120:3010` (LAN) หรือ `http://100.122.174.19:3010` (Tailscale) — เข้าสู่ระบบด้วยรหัสร้าน `BBR`

## อัปเดตครั้งถัดไป

```bash
bash deploy/tee-dev/deploy.sh
```

## คำสั่งดูแล

```bash
ssh ubuntu-server 'cd /data/pos/src/deploy && docker compose --env-file /data/pos/.env ps'
ssh ubuntu-server 'cd /data/pos/src/deploy && docker compose --env-file /data/pos/.env logs -f --tail=100 api'
ssh ubuntu-server 'bash /data/pos/src/deploy/tee-dev/backup.sh'     # สำรองฐานข้อมูล (ตั้ง cron 02:00 ได้)
ssh ubuntu-server 'docker exec -it pos-postgres-1 psql -U pos -d pos' # เข้า SQL
```

กู้คืนจาก backup: `gunzip -c pos-YYYYMMDD.dump.gz | docker compose ... exec -T postgres pg_restore -U pos -d pos --clean --no-owner`

## URL สาธารณะ (จำเป็นเฉพาะทดสอบ LINE LIFF จริง)

เครื่อง tee-dev ใช้ reverse tunnel ไป relay `123.253.61.101` แบบเดียวกับ `hermes-tunnel-todo.service` → ติดตั้ง `deploy/tee-dev/pos-tunnel.service` (ส่งพอร์ต 3010 ไป relay `127.0.0.1:9111`) **และต้องเพิ่ม nginx vhost `pos.tdev2022.com → 127.0.0.1:9111` บน relay** (ต้องมีสิทธิ์ root บน relay — ยังไม่ได้ทำ) จากนั้นใส่ `https://pos.tdev2022.com` ใน `CORS_ORIGINS` และตั้ง LIFF endpoint URL เป็น `https://pos.tdev2022.com/liff`

## AI (T-RAG / NL→SQL)

ปิดไว้ (`AI_ENABLED=false`) เพราะ `192.168.1.116:9001` ยังเข้าถึงจาก tee-dev ไม่ได้ (ตรวจ 2026-09-02: connection failed) — เมื่อเครือข่ายถึงกันแล้วต้องเพิ่ม `192.168.1.120` ใน `config.security.ip_whitelist` ของ gateway `:9001` บน Local Spark (config เข้ารหัส ดู SERVER_MANUAL §2) แล้วตั้ง `AI_ENABLED=true` ทดสอบด้วย `curl http://192.168.1.116:9001/health` จากเครื่อง tee-dev

## Checklist ก่อนใช้จริง (production hardening)

- เปลี่ยน `APP_ENV=prod` (บังคับให้มี JWT secret), ปิด `127.0.0.1:8090` ถ้าไม่ต้อง debug
- ตั้ง cron backup และทดสอบ restore
- เปิด HTTPS ผ่าน tunnel/relay ก่อนใช้จากอินเทอร์เน็ต (JWT ผ่าน HTTP ใน LAN/Tailscale เท่านั้น)
- ตั้ง `require_shift=true` ในตั้งค่าร้านถ้าต้องการบังคับเปิดกะก่อนขาย
