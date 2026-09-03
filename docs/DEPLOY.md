# คู่มือติดตั้งและดูแลระบบ (Deployment & Operations Guide)

คู่มือนี้สำหรับผู้ดูแลระบบ (IT/ผู้ดูแลเซิร์ฟเวอร์) ครอบคลุมการติดตั้งครั้งแรก การอัปเดต การสำรอง/กู้คืนข้อมูล การเปิดร้านใหม่ การเปิดใช้ LINE และ AI และการแก้ปัญหา
คู่มือผู้ใช้งานหน้าจออยู่ที่ [USER_GUIDE.md](USER_GUIDE.md) · การย้ายข้อมูลจากระบบเดิมอยู่ที่ [MIGRATION.md](MIGRATION.md)

---

## 1. ภาพรวมการติดตั้ง

ระบบรันด้วย **Docker Compose** 3 คอนเทนเนอร์บนเซิร์ฟเวอร์ Linux เครื่องเดียว (ทดสอบบน `tee-dev`, Ubuntu + Docker 29):

| บริการ | หน้าที่ | พอร์ตใน container | พอร์ตที่เผยแพร่บนเซิร์ฟเวอร์ |
|---|---|---|---|
| `web` | Next.js (หน้าเว็บ + proxy `/api/*` ไป api) | 3010 | `0.0.0.0:3010` — ผู้ใช้เข้าพอร์ตนี้พอร์ตเดียว |
| `api` | Go API (รัน migration ฐานข้อมูลอัตโนมัติตอนเริ่ม) | 8090 | `127.0.0.1:8090` (เฉพาะ debug บนเครื่อง) |
| `postgres` | PostgreSQL 16 | 5432 | `127.0.0.1:54322` (เฉพาะ debug บนเครื่อง) |

พอร์ต 3010/8090/54322 เลือกไว้ไม่ให้ชนกับโปรเจกต์อื่นบน tee-dev (3000–3006, 8000–8089, 54321, 63791) — ปรับได้ใน `/data/pos/.env` (`WEB_PORT`, `API_PORT`, `PG_PORT`)

โครงสร้างบนเซิร์ฟเวอร์:

```
/data/pos/
├── src/         ← โค้ดที่ส่งขึ้นไปด้วย deploy.sh (ถูกเขียนทับทุกครั้งที่ deploy)
├── .env         ← ความลับและค่าตั้งค่า (อยู่นอก src จึงไม่ถูกเขียนทับ; chmod 600)
├── pgdata/      ← ข้อมูล PostgreSQL (บน NVMe) — ห้ามลบ
├── legacy/      ← dump จากระบบเดิม + import-report.json
└── backups/     ← ไฟล์ pg_dump รายวัน (pos-YYYYMMDD-HHMMSS.dump.gz)
```

การเข้าเซิร์ฟเวอร์: ใช้ ssh alias `ubuntu-server` (Tailscale `100.122.174.19`) หรือ LAN `192.168.1.120` ตามคู่มือเชื่อมต่อ SSH ของเครื่อง (ไม่ได้อยู่ใน repo นี้) ผู้ใช้ `tee` ต้องอยู่ในกลุ่ม `docker`

---

## 2. ติดตั้งครั้งแรก (ทำจากเครื่อง dev ที่มี Git Bash)

### 2.1 ส่งโค้ดและเตรียมเครื่อง

```bash
cd D:/workspace/pos
bash deploy/tee-dev/deploy.sh --no-build          # tar โค้ดขึ้น /data/pos/src (ยังไม่ build)
scp -i ~/.ssh/spark_tunnel deploy/tee-dev/install.sh tee@100.122.174.19:/tmp/
ssh ubuntu-server 'SUDO_PW="<รหัส sudo ของ tee>" bash /tmp/install.sh; rm -f /tmp/install.sh'
```

`install.sh` (รันซ้ำได้) จะ: สร้างโฟลเดอร์ `/data/pos/*` · ตรวจ/ติดตั้ง Docker + Compose · เพิ่มผู้ใช้เข้ากลุ่ม docker · เปิด ufw พอร์ต 3010/tcp · สร้าง `/data/pos/.env` จาก `deploy/.env.example` พร้อมสุ่ม `POSTGRES_PASSWORD`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `PLATFORM_ADMIN_PASSWORD` แล้ว **พิมพ์รหัสผู้ดูแลระบบกลางออกมา — จดไว้**

> ถ้า `.env` ถูกสร้างแล้วสคริปต์จะไม่แตะต้อง แก้ค่าเองได้ด้วย `nano /data/pos/.env`

### 2.2 ตรวจและแก้ค่าใน `/data/pos/.env`

| ตัวแปร | ความหมาย | ค่าที่แนะนำ |
|---|---|---|
| `APP_ENV` | `prod` บังคับให้มี JWT secret | `prod` |
| `POSTGRES_PASSWORD` | รหัสฐานข้อมูล | สุ่ม (install.sh สร้างให้) |
| `JWT_SECRET`, `JWT_REFRESH_SECRET` | กุญแจเซ็น token | สุ่ม 32 ไบต์ (`openssl rand -hex 32`) — เปลี่ยนแล้วผู้ใช้ทุกคนต้อง login ใหม่ |
| `WEB_PORT`, `API_PORT`, `PG_PORT` | พอร์ตที่เผยแพร่ | 3010 / 8090 / 54322 |
| `CORS_ORIGINS` | origin ที่อนุญาต (คั่นด้วย `,`) | ทุก URL ที่ผู้ใช้เปิดเว็บ เช่น `http://192.168.1.120:3010,http://100.122.174.19:3010` |
| `AI_ENABLED`, `TLLM_BASE_URL`, `TLLM_MODEL`, `TLLM_ADMIN_TOKEN` | ผู้ช่วย AI | ปิด (`false`) จนกว่า gateway จะพร้อม (ข้อ 7) |
| `LINE_MOCK`, `LINE_CHANNEL_ID`, `LINE_CHANNEL_SECRET`, `LIFF_ID`, `NEXT_PUBLIC_LIFF_ID`, `NEXT_PUBLIC_LINE_MOCK` | LINE LIFF | mock (`true`) จนกว่าจะมี channel (ข้อ 6) |
| `PLATFORM_ADMIN_USER`, `PLATFORM_ADMIN_PASSWORD` | บัญชีผู้ดูแลระบบกลางที่ `seed` สร้าง | ผู้ใช้ `admin` |

### 2.3 build และเริ่มระบบ

```bash
bash deploy/tee-dev/deploy.sh
```

สคริปต์จะ tar โค้ด (ไม่รวม node_modules/.git/.env/ข้อมูล) ส่งไป `/data/pos/src`, สั่ง `docker compose up -d --build` แล้วเรียก `/health` ครั้งแรกใช้เวลา build ประมาณ 3–6 นาที (ดาวน์โหลด image + build Next.js)

### 2.4 สร้างผู้ดูแลระบบและร้านแรก

```bash
ssh ubuntu-server 'cd /data/pos/src/deploy && docker compose --env-file /data/pos/.env run --rm --entrypoint /app/seed api \
  -store BBR -store-name "ชื่อร้าน" -owner owner -owner-password "รหัสเจ้าของร้าน"'
```

- `seed` รันซ้ำได้ (ถ้ามีอยู่แล้วจะแจ้ง `exists`)
- **ต้องใส่ `--entrypoint /app/seed`** เสมอ เพราะ entrypoint ปกติของ image คือ `/app/api` (ถ้าลืม จะได้ API server ตัวใหม่รันค้างแทน — ลบด้วย `docker rm -f $(docker ps -q --filter name=pos-api-run-)`)
- รหัสร้าน (`-store`) เป็นรหัสที่พนักงานพิมพ์ตอน login ใช้ตัวพิมพ์ใหญ่สั้นๆ

### 2.5 นำเข้าข้อมูลจากระบบเดิม (ถ้ามี)

ดูรายละเอียดใน [MIGRATION.md](MIGRATION.md) โดยย่อ:

```bash
tar -C D:/workspace/pos -czf - legacy-dump | ssh ubuntu-server 'tar -xzf - -C /data/pos/legacy --strip-components=1'
ssh ubuntu-server 'cd /data/pos/src/deploy && docker compose --env-file /data/pos/.env run --rm --entrypoint /app/migrate-legacy api -dir /legacy -store BBR -dry-run'
ssh ubuntu-server 'cd /data/pos/src/deploy && docker compose --env-file /data/pos/.env run --rm --entrypoint /app/migrate-legacy api -dir /legacy -store BBR -report /legacy/import-report.json'
```

### 2.6 ทดสอบ

- เปิด `http://192.168.1.120:3010` (LAN) หรือ `http://100.122.174.19:3010` (Tailscale) → login ด้วยรหัสร้าน + owner
- ทดสอบ API ครบวงจรจากเครื่อง dev ผ่าน ssh tunnel:

```bash
ssh -f -N -L 18090:127.0.0.1:8090 ubuntu-server
bash tools/smoke/smoke.sh http://localhost:18090 BBR owner "รหัสเจ้าของร้าน"
```

(สคริปต์จะสร้างสินค้า/สมาชิก/บิลทดสอบชื่อขึ้นต้น `SMOKE`/`SM` ในร้านนั้น — ใช้กับร้านทดสอบเท่านั้น)

---

## 3. อัปเดตเวอร์ชันใหม่

```bash
cd D:/workspace/pos && git pull            # ถ้าโค้ดอยู่บน GitHub
bash deploy/tee-dev/deploy.sh
```

- migration ฐานข้อมูลรันอัตโนมัติตอน `api` เริ่ม (`AUTO_MIGRATE=true`) และเป็นแบบเพิ่มเท่านั้น (ไม่ลบข้อมูล)
- ระหว่าง build ระบบเดิมยังให้บริการ จะสะดุดเพียงตอนสลับคอนเทนเนอร์ (~5–10 วินาที) ควรทำนอกเวลาขาย
- ตรวจหลังอัปเดต: `ssh ubuntu-server 'curl -s http://localhost:8090/health'` ต้องได้ `"status":"ok"` และ `version` ตรงกับที่ deploy

**ย้อนกลับ (rollback)**: `git checkout <commit เดิม>` แล้ว deploy ซ้ำ; ถ้า migration ใหม่ทำให้ข้อมูลเสีย ให้กู้จาก backup (ข้อ 4) ก่อน deploy เวอร์ชันเดิม

---

## 4. สำรองและกู้คืนข้อมูล

มีสองระดับ ใช้คู่กัน:

| ระดับ | ทำโดย | ครอบคลุม | ใช้เมื่อ |
|---|---|---|---|
| **ในแอป** (ตั้งค่า → ข้อมูลและการสำรอง) | เจ้าของร้าน | ข้อมูลของ "ร้านนั้น" ทั้งหมดเป็นไฟล์ .zip | เจ้าของร้านต้องการสำเนาของตัวเอง / ย้ายร้านไปเซิร์ฟเวอร์อื่น / กู้ข้อมูลที่เสียหาย |
| **pg_dump** (ด้านล่าง) | ผู้ดูแลเซิร์ฟเวอร์ | ทั้งฐานข้อมูล ทุกร้าน รวม audit log | สำรองประจำวัน / กู้ทั้งเครื่อง |

> โฟลเดอร์ `appdata` ต้องเป็นของ uid **10001** (ผู้ใช้ในอิมเมจ `api`) — `install.sh` ตั้งให้แล้ว ถ้าเจอข้อความ `mkdir /data/backups: permission denied` ให้รัน `docker run --rm -v /data/pos/appdata:/d alpine:3.20 chown -R 10001:10001 /d`

ไฟล์สำรองในแอปเก็บที่ `${DATA_DIR:-/data/pos/appdata}/backups/<store_id>/` (เก็บ 20 ไฟล์ล่าสุดต่อร้าน) และ dump ระบบเดิมที่อัปโหลดเข้ามาอยู่ที่ `${DATA_DIR}/legacy/<store_id>/current/` — โฟลเดอร์นี้ถูก mount เข้า container `api` ที่ `/data` (ตัวแปร `DATA_DIR` ใน `/data/pos/.env`) ควรรวมไว้ในแผนสำรองข้อมูลของเครื่องด้วย

### สำรอง

```bash
ssh ubuntu-server 'bash /data/pos/src/deploy/tee-dev/backup.sh'
```

ได้ไฟล์ `/data/pos/backups/pos-YYYYMMDD-HHMMSS.dump.gz` (pg_dump แบบ custom, บีบอัด) เก็บย้อนหลัง 30 วัน (`KEEP_DAYS`)

ตั้งเวลาอัตโนมัติทุกวัน 02:00 (บนเซิร์ฟเวอร์ ในฐานะผู้ใช้ `tee`):

```bash
(crontab -l 2>/dev/null; echo "0 2 * * * /data/pos/src/deploy/tee-dev/backup.sh >> /data/pos/backups/backup.log 2>&1") | crontab -
```

ควรคัดลอกไฟล์ backup ออกนอกเครื่องเป็นระยะ เช่น `scp ubuntu-server:/data/pos/backups/pos-*.dump.gz D:/backup/pos/`

### กู้คืน

```bash
ssh ubuntu-server
cd /data/pos/src/deploy
docker compose --env-file /data/pos/.env stop api web
gunzip -c /data/pos/backups/pos-YYYYMMDD-HHMMSS.dump.gz | docker compose --env-file /data/pos/.env exec -T postgres pg_restore -U pos -d pos --clean --if-exists --no-owner
docker compose --env-file /data/pos/.env start api web
```

ทดสอบการกู้คืนอย่างน้อยปีละครั้งบนฐานข้อมูลชื่ออื่น (`createdb` + `pg_restore -d pos_test`) เพื่อยืนยันว่าไฟล์ backup ใช้ได้

---

## 5. เปิดร้านใหม่ (multi-tenant)

1. login เว็บด้วยผู้ดูแลระบบกลาง (`admin`, ไม่ต้องใส่รหัสร้าน — ติ๊ก "เข้าสู่ระบบในฐานะผู้ดูแลแพลตฟอร์ม")
2. เมนู **ร้านค้า** → **เพิ่มร้าน**: ใส่รหัสร้าน (เช่น `SHOP2`), ชื่อ, ภาษาเริ่มต้น, ชื่อผู้ใช้/รหัสผ่านเจ้าของร้าน
3. เจ้าของร้าน login ด้วยรหัสร้านนั้น → ตั้งค่าร้าน (ที่อยู่ หัว/ท้ายใบเสร็จ โลโก้) → เพิ่มพนักงาน → เพิ่มสินค้า/สมาชิก (หรือ import จากระบบเดิมของร้านนั้นด้วย `migrate-legacy -store SHOP2`)

ข้อมูลทุกร้านแยกกันด้วย Row-Level Security ในฐานข้อมูล ผู้ใช้ของร้านหนึ่งมองไม่เห็นข้อมูลของอีกร้าน ผู้ดูแลระบบกลางเข้าดูร้านใดก็ได้ผ่านปุ่ม "เข้าร้าน"

---

## 6. URL สาธารณะ (HTTPS) และ LINE LIFF

### 6.1 URL สาธารณะ — ติดตั้งแล้ว

**https://t-pos.tdev2022.com** ใช้งานได้แล้ว เส้นทาง:

```
ผู้ใช้ → https://t-pos.tdev2022.com (nginx + Let's Encrypt บน relay 123.253.61.101)
       → 127.0.0.1:9111 บน relay
       → reverse SSH tunnel (pos-tunnel.service บน tee-dev, autossh)
       → localhost:3010 = คอนเทนเนอร์ web
```

องค์ประกอบที่ติดตั้งไว้:

| ที่ | สิ่งที่ติดตั้ง |
|---|---|
| tee-dev | `/etc/systemd/system/pos-tunnel.service` (จาก `deploy/tee-dev/pos-tunnel.service`) — `autossh -R 127.0.0.1:9111:localhost:3010 root@123.253.61.101`, `Restart=always`, enable แล้ว |
| relay 123.253.61.101 | `/etc/nginx/sites-available/t-pos.tdev2022.com` (+ symlink ใน `sites-enabled`) proxy ไป `127.0.0.1:9111`, ปิด buffering เพื่อรองรับ SSE |
| relay | ใบรับรอง Let's Encrypt `t-pos.tdev2022.com` (certbot ตั้ง auto-renew ให้แล้ว; หมดอายุ 2026-12-02) + redirect 80 → 443 |
| `/data/pos/.env` | `CORS_ORIGINS` มี `https://t-pos.tdev2022.com` |

ตรวจสุขภาพ:

```bash
curl -s -o /dev/null -w "%{http_code}
" https://t-pos.tdev2022.com/login          # ต้องได้ 200
ssh ubuntu-server 'systemctl is-active pos-tunnel'                                   # active
ssh ubuntu-server 'ssh root@123.253.61.101 "ss -tln | grep 9111"'                    # relay ต้องฟังพอร์ต 9111
ssh ubuntu-server 'echo "<รหัส sudo>" | sudo -S systemctl restart pos-tunnel'        # เมื่อ tunnel ตายเงียบ
```

> ⚠️ `systemctl is-active pos-tunnel` = active ไม่ได้แปลว่า tunnel ยังใช้ได้ ต้องทดสอบด้วย curl จริงเสมอ
> ⚠️ relay ตั้ง `GatewayPorts` ไว้ พอร์ต 9111 จึงเปิดที่ `0.0.0.0` ด้วย (เข้าถึงแบบ http ตรงได้ที่ `123.253.61.101:9111` โดยไม่ผ่าน TLS) เหมือนโปรเจกต์อื่นบน relay เดียวกัน — ถ้าต้องการปิด ให้ตั้ง firewall บน relay หรือเปลี่ยน `GatewayPorts` เป็น `no`
> ⚠️ เว็บเปิดสาธารณะแล้ว ต้องเปลี่ยนรหัสผ่านทดสอบทุกบัญชี (`owner` ฯลฯ) และตั้งรหัสที่คาดเดายาก

เพิ่มโดเมนใหม่: แก้พอร์ต/ชื่อใน `pos-tunnel.service` และคัดลอก vhost เดิมเป็นชื่อใหม่ แล้วรัน `certbot --nginx -d <โดเมน>` บน relay

### 6.2 LINE LIFF

เมื่อมี URL สาธารณะแล้ว:

1. สร้าง **LINE Login channel** + **LIFF app** ใน LINE Developers Console: Endpoint URL = `https://t-pos.tdev2022.com/liff`, scope `profile openid`
2. ใส่ค่าใน `/data/pos/.env`: `LINE_MOCK=false`, `LINE_CHANNEL_ID`, `LINE_CHANNEL_SECRET`, `LIFF_ID`, `NEXT_PUBLIC_LIFF_ID`, `NEXT_PUBLIC_LINE_MOCK=false` แล้ว deploy ใหม่ (ค่า `NEXT_PUBLIC_*` ถูกฝังตอน build)
3. ทดสอบ: เปิด LIFF URL ใน LINE → ผูกบัญชีด้วย "รหัสผูกบัญชี" ที่พนักงานสร้างจากหน้าสมาชิก หรือเบอร์โทรที่ตรงกับทะเบียน

ระหว่างที่ยังเป็น mock: หน้า `/liff` รับ token รูปแบบ `mock:<lineUserId>:<ชื่อ>` เพื่อทดสอบ flow ได้โดยไม่ต้องมี LINE จริง

## 7. เปิดใช้ผู้ช่วย AI (ถาม-ตอบข้อมูลร้านด้วยภาษาไทย)

ใช้ T-LLM gateway ที่ `http://192.168.1.116:9001` (Local Spark) ผ่าน `/v1/generate` — ปัจจุบัน tee-dev **ยังเชื่อมต่อไม่ได้** (ตรวจ 2026-09-02: connection failed)

1. ทำให้เครือข่ายถึงกัน แล้วเพิ่ม IP ของ tee-dev (`192.168.1.120`) ใน `config.security.ip_whitelist` ของ gateway `:9001` (config เข้ารหัส ต้อง decrypt → แก้ → encrypt → restart service ตามคู่มือของเครื่อง Local Spark)
2. ทดสอบจาก tee-dev: `curl -s http://192.168.1.116:9001/health` ต้องได้ 200 (403 = ยังไม่ whitelist)
3. ตั้ง `AI_ENABLED=true` (และ `TLLM_ADMIN_TOKEN` ถ้ามี) ใน `.env` → `docker compose ... up -d api`
4. ตรวจในเว็บ: เมนู **ผู้ช่วย AI** → สถานะ gateway ต้องเป็น ok

ความปลอดภัย: AI สร้างได้เฉพาะ `SELECT` ตารางที่อนุญาต, รันใน transaction read-only ภายใต้ RLS ของร้าน, timeout 8 วินาที, สูงสุด 200 แถว, ทุกคำถามถูกบันทึกใน `ai_query_logs`

---

## 8. คำสั่งดูแลประจำวัน

```bash
# สถานะคอนเทนเนอร์
ssh ubuntu-server 'cd /data/pos/src/deploy && docker compose --env-file /data/pos/.env ps'
# log ของ API (JSON บรรทัดละรายการ; level=ERROR คือปัญหา)
ssh ubuntu-server 'cd /data/pos/src/deploy && docker compose --env-file /data/pos/.env logs --tail=200 api'
ssh ubuntu-server 'cd /data/pos/src/deploy && docker compose --env-file /data/pos/.env logs -f web'
# รีสตาร์ต
ssh ubuntu-server 'cd /data/pos/src/deploy && docker compose --env-file /data/pos/.env restart api web'
# เข้า SQL (อ่านอย่างเดียวถ้าไม่จำเป็น)
ssh -t ubuntu-server 'docker exec -it pos-postgres-1 psql -U pos -d pos'
# พื้นที่ดิสก์ / ขนาดฐานข้อมูล
ssh ubuntu-server 'df -h /data; docker exec pos-postgres-1 psql -U pos -d pos -tAc "select pg_size_pretty(pg_database_size(current_database()))"'
# ล้าง image เก่าหลัง deploy หลายครั้ง
ssh ubuntu-server 'docker image prune -f'
```

การรีเซ็ตรหัสผ่านผู้ใช้ที่ลืม: เจ้าของร้านทำได้ที่ **ตั้งค่า → ผู้ใช้** (ตั้งรหัสใหม่ ผู้ใช้จะถูกบังคับเปลี่ยนตอน login ถัดไป); ถ้าเจ้าของร้านลืมเอง ให้ผู้ดูแลระบบกลางเข้าร้านแล้วแก้ที่หน้าเดียวกัน; ถ้าผู้ดูแลระบบกลางลืม ให้สร้างผู้ดูแลกลางคนใหม่ด้วย `seed -admin admin2 -admin-password "<รหัส>"` (seed ไม่เขียนทับรหัสของผู้ใช้ที่มีอยู่)

---

## 9. ความปลอดภัย (checklist ก่อนใช้จริง)

- [ ] `APP_ENV=prod`, JWT secret สุ่ม, `POSTGRES_PASSWORD` สุ่ม, `.env` สิทธิ์ 600
- [ ] เปลี่ยนรหัสผ่านทดสอบทั้งหมด (`owner`/ผู้ใช้ที่สร้างตอนทดสอบ) และให้ผู้ใช้ที่ย้ายมาจากระบบเดิมตั้งรหัสใหม่ (ระบบบังคับอยู่แล้ว)
- [ ] เว็บถูกเข้าถึงได้เฉพาะ LAN/Tailscale (ufw เปิดเฉพาะ 22 และ 3010) — ถ้าจะเปิดสู่อินเทอร์เน็ตต้องผ่าน HTTPS (tunnel/relay หรือ reverse proxy) เท่านั้น เพราะ token วิ่งใน header
- [ ] ตั้ง cron backup และทดสอบกู้คืนแล้ว
- [ ] ปิด `127.0.0.1:8090`/`54322` ใน compose ถ้าไม่ต้อง debug (ลบบรรทัด `ports:` ของ api/postgres)
- [ ] ตรวจ `audit_logs` ได้จากเมนู ตั้งค่า → บันทึกการใช้งาน (เจ้าของร้าน/ผู้จัดการ)

---

## 10. แก้ปัญหาที่พบบ่อย

| อาการ | สาเหตุ / วิธีแก้ |
|---|---|
| เปิดเว็บไม่ได้จากเครื่องอื่น | ufw ไม่เปิดพอร์ต 3010 → `sudo ufw allow 3010/tcp`; หรือ `WEB_PORT` ใน `.env` ไม่ตรง |
| หน้าเว็บขึ้นแต่ login แล้ว "เกิดข้อผิดพลาดภายในระบบ" | api ล่มหรือกำลัง restart → ดู `docker compose logs api`; ตรวจ `/health` |
| login ได้แต่ทุกหน้าแจ้ง "เซสชันหมดอายุ" | เปลี่ยน `JWT_SECRET` หลังผู้ใช้ login ค้าง → ให้ login ใหม่ |
| `docker compose run ... seed` ค้างไม่จบ | ลืม `--entrypoint /app/seed` (รัน API แทน) → กด Ctrl-C แล้ว `docker rm -f` คอนเทนเนอร์ `pos-api-run-*` |
| `migrate-legacy` แจ้ง `read-only file system` ตอนเขียน report | โฟลเดอร์ `/legacy` mount แบบอ่านอย่างเดียวใน compose เวอร์ชันเก่า → อัปเดต compose (ตอนนี้เป็น rw แล้ว) หรือใช้ `-report /tmp/x.json` |
| build ล้มเหลว `failed to resolve docker/dockerfile` / `TLS handshake timeout` | เซิร์ฟเวอร์ต่อ Docker Hub ไม่ได้ชั่วคราว → ลองใหม่; image พื้นฐาน (`golang`, `node`, `postgres`) ถูก cache ไว้แล้วหลัง build แรก |
| ขายแล้วช้าหรือค้างระหว่างกำลัง import ข้อมูลเดิม | import ใช้ transaction ใหญ่ ล็อกแถวสินค้าแบบ KEY SHARE — ทำ import นอกเวลาขาย |
| POS แจ้ง "ยังไม่ได้เปิดกะ" ทั้งที่ไม่ต้องการใช้กะ | ตั้งค่าร้าน → ใบเสร็จ/การขาย → ปิด `require_shift` |
| สต็อกติดลบหลัง import | ค่าติดลบมาจากระบบเดิม → ทำใบตรวจนับสต็อก (คลังสินค้า → ตรวจนับ) แล้ว finalize |
| พิมพ์ใบเสร็จไม่ออก | ใช้ print dialog ของเบราว์เซอร์ → ตั้งค่าเครื่องพิมพ์ความร้อน 58/80 มม. เป็นค่าเริ่มต้นและปิด margin; เลือกความกว้างกระดาษให้ตรงใน ตั้งค่า → ใบเสร็จ |
| ต้องการรีเซ็ตทั้งระบบ (ทดสอบใหม่) | `docker compose down` แล้วลบ `/data/pos/pgdata/*` (ข้อมูลหายทั้งหมด) → `up -d` → seed → import ใหม่ |

---

## 11. โครงสร้าง repo ที่เกี่ยวกับ deploy

| ไฟล์ | หน้าที่ |
|---|---|
| `deploy/docker-compose.yml` | นิยาม 3 บริการ, volume, พอร์ต, ตัวแปรที่ส่งเข้า container |
| `deploy/.env.example` | แม่แบบ `.env` (คัดลอกไป `/data/pos/.env`) |
| `deploy/tee-dev/install.sh` | เตรียมเครื่อง (idempotent) |
| `deploy/tee-dev/deploy.sh` | ส่งโค้ด + build + restart (`--no-build` = ส่งโค้ดอย่างเดียว) |
| `deploy/tee-dev/backup.sh` | pg_dump รายวัน |
| `deploy/tee-dev/pos-tunnel.service` | systemd unit ของ reverse tunnel สำหรับ URL สาธารณะ |
| `backend/Dockerfile` | build api/seed/migrate-legacy (multi-stage, alpine, non-root) |
| `frontend/Dockerfile` | build Next.js standalone (ต้องส่ง `BACKEND_INTERNAL_URL`, `NEXT_PUBLIC_*` เป็น build arg) |
| `tools/smoke/smoke.sh` | ทดสอบ API ครบวงจร |
