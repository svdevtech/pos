#!/usr/bin/env bash
# End-to-end API smoke test (bash + curl + python). Usage:
#   bash tools/smoke/smoke.sh http://localhost:8090 BBR owner Owner12345
set -euo pipefail
BASE=${1:-http://localhost:8090}
STORE=${2:-BBR}
USER=${3:-owner}
PASS=${4:-Owner12345}
API="$BASE/api/v1"
fail() { echo "FAIL: $*"; exit 1; }
jq() { python -c "import sys,json; d=json.load(sys.stdin); print(eval(sys.argv[1]))" "$1"; }

echo "== health"; curl -fsS "$BASE/health"; echo
LOGIN=$(curl -fsS -X POST "$API/auth/login" -H 'Content-Type: application/json' -d "{\"store_code\":\"$STORE\",\"username\":\"$USER\",\"password\":\"$PASS\"}")
TOK=$(echo "$LOGIN" | jq "d['access_token']")
H=(-H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' -H 'X-Locale: th')
echo "== logged in as $(echo "$LOGIN" | jq "d['user']['display_name']") role $(echo "$LOGIN" | jq "d['user']['role']")"

echo "== category + unit + product"
CAT=$(curl -fsS -X POST "$API/categories" "${H[@]}" -d '{"name":"SMOKE หมวดทดสอบ"}' 2>/dev/null || curl -fsS "$API/categories" "${H[@]}")
CAT_ID=$(echo "$CAT" | jq "d['id'] if isinstance(d,dict) else [c for c in d if c['name'].startswith('SMOKE')][0]['id']")
SKU="SMOKE-$(date +%s)"
PROD=$(curl -fsS -X POST "$API/products" "${H[@]}" -d "{\"sku\":\"$SKU\",\"name\":\"น้ำดื่มทดสอบ $SKU\",\"category_id\":\"$CAT_ID\",\"cost_last\":7,\"cost_avg\":7,\"sell_price\":10,\"min_level1\":5,\"barcodes\":[\"$SKU\"],\"opening_stock\":20}")
PID=$(echo "$PROD" | jq "d['id']")
echo "product $PID stock $(echo "$PROD" | jq "d['stock_on_hand']")"
curl -fsS "$API/products/by-barcode/$SKU" "${H[@]}" >/dev/null || fail "barcode lookup"

echo "== member"
MCODE="SM$(date +%s | tail -c 6)"
MEM=$(curl -fsS -X POST "$API/members" "${H[@]}" -d "{\"member_code\":\"$MCODE\",\"name\":\"สมาชิกทดสอบ\",\"phone\":\"0812345678\",\"opening_share\":500}")
MID=$(echo "$MEM" | jq "d['id']")
echo "member $MID"

echo "== shift"
SH=$(curl -fsS -X POST "$API/shifts/open" "${H[@]}" -d '{"terminal":"SMOKE","opening_float":500}' || true)
SHIFT_ID=$(curl -fsS "$API/shifts/current" "${H[@]}" | jq "d['shift']['id']")
echo "shift $SHIFT_ID"

echo "== quote"
QUOTE=$(curl -fsS -X POST "$API/sales/quote" "${H[@]}" -d "{\"member_id\":\"$MID\",\"lines\":[{\"product_id\":\"$PID\",\"qty\":3,\"discount\":2}],\"payments\":[]}")
NET=$(echo "$QUOTE" | jq "d['net']")
[ "$NET" = "28" ] || fail "quote net expected 28 got $NET"
echo "quote net $NET"

echo "== cash sale with change"
SALE=$(curl -fsS -X POST "$API/sales" "${H[@]}" -d "{\"member_id\":\"$MID\",\"lines\":[{\"product_id\":\"$PID\",\"qty\":3,\"discount\":2}],\"payments\":[{\"method\":\"cash\",\"amount\":50}]}")
SID=$(echo "$SALE" | jq "d['id']"); DOC=$(echo "$SALE" | jq "d['doc_no']")
CHG=$(echo "$SALE" | jq "d['change_amount']")
[ "$CHG" = "22" ] || fail "change expected 22 got $CHG"
echo "sale $DOC change $CHG"
STOCK=$(curl -fsS "$API/products/$PID" "${H[@]}" | jq "d['stock_on_hand']")
[ "$STOCK" = "17" ] || fail "stock expected 17 got $STOCK"
echo "stock after sale $STOCK"
curl -fsS "$API/sales/$SID/receipt" "${H[@]}" >/dev/null || fail "receipt"

echo "== credit sale"
CS=$(curl -fsS -X POST "$API/sales" "${H[@]}" -d "{\"member_id\":\"$MID\",\"lines\":[{\"product_id\":\"$PID\",\"qty\":2}],\"payments\":[{\"method\":\"credit\",\"amount\":0}]}")
CSID=$(echo "$CS" | jq "d['id']"); [ "$(echo "$CS" | jq "d['ar_status']")" = "unpaid" ] || fail "credit sale ar_status"
echo "credit sale $(echo "$CS" | jq "d['doc_no']") balance $(echo "$CS" | jq "d['ar_balance']")"

echo "== AR partial payment"
PAY=$(curl -fsS -X POST "$API/ar/payments" "${H[@]}" -d "{\"member_id\":\"$MID\",\"amount\":5,\"method\":\"cash\"}")
[ "$(echo "$PAY" | jq "d[0]['balance_after']")" = "15" ] || fail "ar balance after"
echo "paid 5, remaining $(echo "$PAY" | jq "d[0]['balance_after']")"

echo "== return 1 unit of the cash sale"
LINE_ID=$(echo "$SALE" | jq "d['lines'][0]['id']")
RET=$(curl -fsS -X POST "$API/sales/$SID/returns" "${H[@]}" -d "{\"lines\":[{\"sale_line_id\":\"$LINE_ID\",\"qty\":1}],\"refund_method\":\"cash\",\"restock\":true}")
echo "return $(echo "$RET" | jq "d['doc_no']") refund $(echo "$RET" | jq "d['refund_amount']")"
STOCK=$(curl -fsS "$API/products/$PID" "${H[@]}" | jq "d['stock_on_hand']")
[ "$STOCK" = "16" ] || fail "stock after return expected 16 got $STOCK"

echo "== cancel a fresh sale"
S3=$(curl -fsS -X POST "$API/sales" "${H[@]}" -d "{\"lines\":[{\"product_id\":\"$PID\",\"qty\":1}],\"payments\":[{\"method\":\"cash\",\"amount\":10}]}")
S3ID=$(echo "$S3" | jq "d['id']")
curl -fsS -X POST "$API/sales/$S3ID/cancel" "${H[@]}" -d '{"reason":"smoke"}' >/dev/null
STOCK=$(curl -fsS "$API/products/$PID" "${H[@]}" | jq "d['stock_on_hand']")
[ "$STOCK" = "16" ] || fail "stock after cancel expected 16 got $STOCK"
echo "cancel restocked ok"

echo "== held bill"
HB=$(curl -fsS -X POST "$API/held-bills" "${H[@]}" -d '{"label":"smoke","cart":{"lines":[]}}'); HBID=$(echo "$HB" | jq "d['id']")
curl -fsS -X DELETE "$API/held-bills/$HBID" "${H[@]}" || fail "delete held"

echo "== expense + drawer"
curl -fsS -X POST "$API/expenses" "${H[@]}" -d "{\"expensed_at\":\"$(date +%F)\",\"amount\":12.5,\"note\":\"smoke ice\",\"paid_from\":\"cash\",\"from_drawer\":true}" >/dev/null
curl -fsS -X POST "$API/drawer" "${H[@]}" -d '{"reason":"no_sale"}' >/dev/null

echo "== reports"
curl -fsS "$API/reports/dashboard" "${H[@]}" | jq "'today bills', d['today']['bills']"
curl -fsS "$API/reports/daily-sales?from=$(date +%F)&to=$(date +%F)&format=csv" "${H[@]}" | head -3

echo "== dividend period + simulate"
YEAR=$(( $(date +%Y) + 543 ))
PERIOD=$(curl -fsS -X POST "$API/dividends/periods" "${H[@]}" -d "{\"be_year\":$YEAR,\"net_profit\":100000}" 2>/dev/null || true)
PERIOD_ID=$(curl -fsS "$API/dividends/periods" "${H[@]}" | jq "[p for p in d if p['be_year']==$YEAR][0]['id']")
RUN=$(curl -fsS -X POST "$API/dividends/periods/$PERIOD_ID/simulate" "${H[@]}" -d '{}')
echo "simulated run members $(echo "$RUN" | jq "d.get('member_count', d.get('run',{}).get('member_count'))") totals $(echo "$RUN" | jq "d.get('totals', d.get('run',{}).get('totals'))" | head -c 200)"

echo "== close shift"
CLOSE=$(curl -fsS -X POST "$API/shifts/$SHIFT_ID/close" "${H[@]}" -d '{"counted_cash":540}')
echo "expected $(echo "$CLOSE" | jq "d['shift']['expected_cash']") counted 540 variance $(echo "$CLOSE" | jq "d['shift']['variance']")"

echo "== liff mock"
curl -fsS -X POST "$API/auth/line/verify" -H 'Content-Type: application/json' -d "{\"id_token\":\"mock:U123smoke:Smoke\",\"store_code\":\"$STORE\"}" | head -c 200; echo
CODE=$(curl -fsS -X POST "$API/members/$MID/link-code" "${H[@]}" | jq "d['code']")
LINK=$(curl -fsS -X POST "$API/auth/line/link" -H 'Content-Type: application/json' -d "{\"id_token\":\"mock:U123smoke:Smoke\",\"store_code\":\"$STORE\",\"link_code\":\"$CODE\"}")
MT=$(echo "$LINK" | jq "d['access_token']")
curl -fsS "$API/liff/me" -H "Authorization: Bearer $MT" | head -c 300; echo
echo "== ALL SMOKE CHECKS PASSED"
