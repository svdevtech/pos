// Package i18n localizes API error codes into Thai / English messages.
package i18n

import (
	"fmt"
	"sort"
	"strings"
)

type Locale string

const (
	TH Locale = "th"
	EN Locale = "en"
)

// FromAcceptLanguage picks th or en from an Accept-Language header (default th).
func FromAcceptLanguage(h string, def Locale) Locale {
	if def == "" {
		def = TH
	}
	h = strings.ToLower(h)
	if h == "" {
		return def
	}
	for _, part := range strings.Split(h, ",") {
		tag := strings.TrimSpace(strings.SplitN(part, ";", 2)[0])
		switch {
		case strings.HasPrefix(tag, "th"):
			return TH
		case strings.HasPrefix(tag, "en"):
			return EN
		}
	}
	return def
}

// Message returns the localized message for an error code, substituting {param} placeholders.
func Message(loc Locale, code string, params map[string]any) string {
	cat := th
	if loc == EN {
		cat = en
	}
	msg, ok := cat[code]
	if !ok {
		msg = cat["INTERNAL"]
		if loc == EN {
			msg = fmt.Sprintf("%s (%s)", msg, code)
		} else {
			msg = fmt.Sprintf("%s (%s)", msg, code)
		}
	}
	for k, v := range params {
		msg = strings.ReplaceAll(msg, "{"+k+"}", fmt.Sprint(v))
	}
	return msg
}

// Codes returns every known code (used by tests to assert th/en parity).
func Codes() []string {
	out := make([]string, 0, len(th))
	for k := range th {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

func has(cat map[string]string, code string) bool { _, ok := cat[code]; return ok }

// MissingIn returns codes that exist in one catalogue but not the other.
func MissingIn() (missingEN, missingTH []string) {
	for k := range th {
		if !has(en, k) {
			missingEN = append(missingEN, k)
		}
	}
	for k := range en {
		if !has(th, k) {
			missingTH = append(missingTH, k)
		}
	}
	sort.Strings(missingEN)
	sort.Strings(missingTH)
	return
}

var th = map[string]string{
	"INTERNAL":                   "เกิดข้อผิดพลาดภายในระบบ",
	"VALIDATION":                 "ข้อมูลไม่ถูกต้อง: {field}",
	"BAD_REQUEST":                "คำขอไม่ถูกต้อง",
	"UNAUTHORIZED":               "กรุณาเข้าสู่ระบบ",
	"FORBIDDEN":                  "คุณไม่มีสิทธิ์ทำรายการนี้",
	"DATA_OP_BUSY":               "มีงานข้อมูล ({kind}) กำลังทำงานอยู่ กรุณารอให้เสร็จก่อน",
	"BACKUP_INVALID":             "ไฟล์สำรองข้อมูลไม่ถูกต้องหรือเสียหาย",
	"BACKUP_VERSION_UNSUPPORTED": "ไฟล์สำรองข้อมูลเวอร์ชัน {version} ใหม่กว่าที่ระบบนี้รองรับ",
	"LEGACY_DUMP_MISSING":        "ยังไม่ได้อัปโหลดข้อมูลจากระบบเดิม",
	"LEGACY_DUMP_INVALID":        "ไฟล์ข้อมูลระบบเดิมไม่ถูกต้อง ({reason})",
	"NOT_FOUND":                  "ไม่พบข้อมูล",
	"CONFLICT":                   "ข้อมูลซ้ำหรือขัดแย้งกับข้อมูลเดิม",
	"RATE_LIMITED":               "ทำรายการถี่เกินไป กรุณาลองใหม่ภายหลัง",
	"FEATURE_DISABLED":           "ฟีเจอร์นี้ยังไม่เปิดใช้งาน",

	"AUTH_LOGIN_FAILED":      "รหัสร้าน ชื่อผู้ใช้ หรือรหัสผ่านไม่ถูกต้อง",
	"AUTH_USER_DISABLED":     "บัญชีผู้ใช้นี้ถูกระงับการใช้งาน",
	"AUTH_STORE_INACTIVE":    "ร้านค้านี้ถูกปิดการใช้งาน",
	"AUTH_TOKEN_INVALID":     "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่",
	"AUTH_PASSWORD_WEAK":     "รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร",
	"AUTH_PASSWORD_MISMATCH": "รหัสผ่านเดิมไม่ถูกต้อง",
	"TENANT_STORE_REQUIRED":  "ต้องระบุร้านค้า",

	"PRODUCT_NOT_FOUND": "ไม่พบสินค้า",
	"BARCODE_NOT_FOUND": "ไม่พบบาร์โค้ด {barcode}",
	"BARCODE_EXISTS":    "บาร์โค้ด {barcode} ถูกใช้แล้ว",
	"SKU_EXISTS":        "รหัสสินค้า {sku} มีอยู่แล้ว",
	"PRODUCT_ARCHIVED":  "สินค้านี้ถูกเก็บถาวรแล้ว ไม่สามารถขายได้",

	"MEMBER_NOT_FOUND":          "ไม่พบสมาชิก",
	"MEMBER_CODE_EXISTS":        "รหัสสมาชิก {code} มีอยู่แล้ว",
	"MEMBER_ALREADY_LINKED":     "บัญชี LINE นี้ผูกกับสมาชิกอื่นแล้ว",
	"MEMBER_LINK_CODE_INVALID":  "รหัสผูกบัญชีไม่ถูกต้องหรือหมดอายุ",
	"MEMBER_SHARE_INSUFFICIENT": "ยอดหุ้นไม่พอสำหรับการถอน",

	"SALE_EMPTY":               "ไม่มีรายการสินค้าในบิล",
	"SALE_NOT_FOUND":           "ไม่พบบิลขาย",
	"SALE_ALREADY_CANCELLED":   "บิลนี้ถูกยกเลิกไปแล้ว",
	"SALE_PAYMENT_SHORT":       "ยอดชำระไม่ครบ ขาดอีก {short} บาท",
	"SALE_CREDIT_NEEDS_MEMBER": "การขายเชื่อต้องระบุสมาชิก",
	"SALE_SERIAL_REQUIRED":     "สินค้า {name} ต้องระบุหมายเลขซีเรียล",
	"STOCK_INSUFFICIENT":       "สต็อกสินค้า {name} ไม่พอ (คงเหลือ {stock})",
	"SHIFT_NOT_OPEN":           "ยังไม่ได้เปิดกะ กรุณาเปิดกะก่อนขาย",
	"SHIFT_ALREADY_OPEN":       "มีกะที่เปิดอยู่แล้ว",
	"RETURN_EXCEEDS_SOLD":      "จำนวนคืนมากกว่าจำนวนที่ขาย",

	"AR_NOTHING_DUE": "บิลนี้ไม่มียอดค้างชำระ",
	"AR_OVERPAY":     "ยอดชำระเกินยอดค้าง ({balance} บาท)",

	"RECEIPT_NOT_FOUND":         "ไม่พบใบรับสินค้า",
	"STOCKTAKE_CLOSED":          "ใบตรวจนับนี้ปิดแล้ว",
	"RECEIPT_ALREADY_CANCELLED": "ใบรับสินค้า {doc_no} ถูกยกเลิกไปแล้ว",

	"DIVIDEND_PERIOD_EXISTS":    "มีงวดปันผลปี {year} อยู่แล้ว",
	"DIVIDEND_NOT_FOUND":        "ไม่พบงวดปันผล",
	"DIVIDEND_LOCKED":           "งวดปันผลนี้ถูกอนุมัติแล้ว แก้ไขไม่ได้",
	"DIVIDEND_BAD_TRANSITION":   "ไม่สามารถเปลี่ยนสถานะจาก {from} เป็น {to}",
	"DIVIDEND_NO_RUN":           "ยังไม่ได้คำนวณปันผล กรุณาจำลองการคำนวณก่อน",
	"DIVIDEND_CRITERIA_INVALID": "เกณฑ์ปันผลไม่ถูกต้อง: {reason}",
	"DIVIDEND_NOT_APPROVED":     "ต้องอนุมัติงวดปันผลก่อนจึงจะจ่ายได้ (สถานะ {status})",
	"DIVIDEND_PAYOUT_EXCEEDS":   "ยอดจ่ายเกินยอดคงเหลือ (คงเหลือ {remaining})",

	"AI_UNSAFE_SQL": "คำสั่งที่ AI สร้างไม่ปลอดภัย จึงไม่ถูกเรียกใช้",
	"AI_UPSTREAM":   "บริการ AI ไม่ตอบสนอง กรุณาลองใหม่",

	"IMPORT_MANIFEST_INVALID": "ไฟล์ manifest ของข้อมูลเดิมไม่ถูกต้อง",

	"MEMBER_INACTIVE": "สมาชิกนี้ถูกระงับหรือพ้นสภาพ กรุณาติดต่อร้าน",
	"LINE_UPSTREAM":   "ไม่สามารถตรวจสอบบัญชี LINE ได้ กรุณาลองใหม่",
}

var en = map[string]string{
	"INTERNAL":                   "Internal server error",
	"VALIDATION":                 "Invalid input: {field}",
	"BAD_REQUEST":                "Bad request",
	"UNAUTHORIZED":               "Please sign in",
	"FORBIDDEN":                  "You do not have permission to do this",
	"DATA_OP_BUSY":               "Another data job ({kind}) is still running",
	"BACKUP_INVALID":             "The backup file is not valid or is damaged",
	"BACKUP_VERSION_UNSUPPORTED": "Backup version {version} is newer than this system supports",
	"LEGACY_DUMP_MISSING":        "No legacy data has been uploaded yet",
	"LEGACY_DUMP_INVALID":        "The legacy dump is not valid ({reason})",
	"NOT_FOUND":                  "Not found",
	"CONFLICT":                   "Duplicate or conflicting data",
	"RATE_LIMITED":               "Too many requests, please try again later",
	"FEATURE_DISABLED":           "This feature is not enabled",

	"AUTH_LOGIN_FAILED":      "Wrong store code, username or password",
	"AUTH_USER_DISABLED":     "This user account is disabled",
	"AUTH_STORE_INACTIVE":    "This store is inactive",
	"AUTH_TOKEN_INVALID":     "Session expired, please sign in again",
	"AUTH_PASSWORD_WEAK":     "Password must be at least 8 characters",
	"AUTH_PASSWORD_MISMATCH": "Current password is incorrect",
	"TENANT_STORE_REQUIRED":  "A store must be specified",

	"PRODUCT_NOT_FOUND": "Product not found",
	"BARCODE_NOT_FOUND": "Barcode {barcode} not found",
	"BARCODE_EXISTS":    "Barcode {barcode} is already in use",
	"SKU_EXISTS":        "SKU {sku} already exists",
	"PRODUCT_ARCHIVED":  "This product is archived and cannot be sold",

	"MEMBER_NOT_FOUND":          "Member not found",
	"MEMBER_CODE_EXISTS":        "Member code {code} already exists",
	"MEMBER_ALREADY_LINKED":     "This LINE account is already linked to another member",
	"MEMBER_LINK_CODE_INVALID":  "Link code is invalid or expired",
	"MEMBER_SHARE_INSUFFICIENT": "Share balance is insufficient for this withdrawal",

	"SALE_EMPTY":               "The bill has no items",
	"SALE_NOT_FOUND":           "Sale not found",
	"SALE_ALREADY_CANCELLED":   "This sale is already cancelled",
	"SALE_PAYMENT_SHORT":       "Payment is short by {short}",
	"SALE_CREDIT_NEEDS_MEMBER": "Credit sales require a member",
	"SALE_SERIAL_REQUIRED":     "Product {name} requires a serial number",
	"STOCK_INSUFFICIENT":       "Insufficient stock for {name} (on hand {stock})",
	"SHIFT_NOT_OPEN":           "No open shift; open a shift before selling",
	"SHIFT_ALREADY_OPEN":       "A shift is already open",
	"RETURN_EXCEEDS_SOLD":      "Return quantity exceeds quantity sold",

	"AR_NOTHING_DUE": "This bill has no outstanding balance",
	"AR_OVERPAY":     "Payment exceeds the outstanding balance ({balance})",

	"RECEIPT_NOT_FOUND":         "Goods receipt not found",
	"STOCKTAKE_CLOSED":          "This stock take is closed",
	"RECEIPT_ALREADY_CANCELLED": "Goods receipt {doc_no} is already cancelled",

	"DIVIDEND_PERIOD_EXISTS":    "A dividend period for {year} already exists",
	"DIVIDEND_NOT_FOUND":        "Dividend period not found",
	"DIVIDEND_LOCKED":           "This dividend period is approved and locked",
	"DIVIDEND_BAD_TRANSITION":   "Cannot change status from {from} to {to}",
	"DIVIDEND_NO_RUN":           "Dividend has not been calculated yet; run a simulation first",
	"DIVIDEND_CRITERIA_INVALID": "Dividend criteria are invalid: {reason}",
	"DIVIDEND_NOT_APPROVED":     "The dividend period must be approved before payouts (status {status})",
	"DIVIDEND_PAYOUT_EXCEEDS":   "Payout exceeds the remaining balance (remaining {remaining})",

	"AI_UNSAFE_SQL": "The AI-generated query was rejected as unsafe",
	"AI_UPSTREAM":   "The AI service is not responding, please retry",

	"IMPORT_MANIFEST_INVALID": "Legacy data manifest is invalid",

	"MEMBER_INACTIVE": "This member is suspended or inactive; please contact the store",
	"LINE_UPSTREAM":   "Could not verify the LINE account, please retry",
}
