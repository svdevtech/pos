/**
 * Tiny pure-TS barcode encoders. Each returns a module string ("1" = bar,
 * "0" = space) that a renderer turns into rects; no external dependencies.
 *
 * - EAN-13 for 12/13-digit numeric input (check digit computed/validated)
 * - Code 128 (sets B and C, auto-switching for digit runs) for everything else
 */

export type BarcodeSymbology = 'ean13' | 'code128';

export interface EncodedBarcode {
  symbology: BarcodeSymbology;
  /** Bars and spaces as "1"/"0" characters, one per module. */
  modules: string;
  /** Human-readable text to print under the bars. */
  text: string;
}

// ---------------------------------------------------------------------------
// EAN-13
// ---------------------------------------------------------------------------

const EAN_L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const EAN_G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
const EAN_R = EAN_L.map((p) => p.replace(/[01]/g, (c) => (c === '0' ? '1' : '0')));
const EAN_PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

/** Computes the EAN-13 check digit for the first 12 digits. */
export function ean13CheckDigit(digits12: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const d = digits12.charCodeAt(i) - 48;
    sum += i % 2 === 0 ? d : d * 3;
  }
  return (10 - (sum % 10)) % 10;
}

/** True when `value` is a 13-digit string with a valid check digit. */
export function isValidEan13(value: string): boolean {
  return /^\d{13}$/.test(value) && ean13CheckDigit(value.slice(0, 12)) === Number(value[12]);
}

export function encodeEan13(value: string): EncodedBarcode {
  let digits = value.replace(/\D/g, '');
  if (digits.length === 12) digits += String(ean13CheckDigit(digits));
  if (!isValidEan13(digits)) throw new Error('invalid EAN-13');

  const first = Number(digits[0]);
  const parity = EAN_PARITY[first];
  let out = '101';
  for (let i = 1; i <= 6; i++) {
    const d = Number(digits[i]);
    out += parity[i - 1] === 'L' ? EAN_L[d] : EAN_G[d];
  }
  out += '01010';
  for (let i = 7; i <= 12; i++) out += EAN_R[Number(digits[i])];
  out += '101';
  return { symbology: 'ean13', modules: out, text: digits };
}

// ---------------------------------------------------------------------------
// Code 128
// ---------------------------------------------------------------------------

const CODE128_PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];

const START_B = 104;
const START_C = 105;
const CODE_B = 100;
const CODE_C = 99;
const STOP = 106;

function patternToModules(pattern: string): string {
  let out = '';
  for (let i = 0; i < pattern.length; i++) {
    const width = Number(pattern[i]);
    out += (i % 2 === 0 ? '1' : '0').repeat(width);
  }
  return out;
}

/** Encodes printable ASCII (32..126) using code sets B and C. */
export function encodeCode128(value: string): EncodedBarcode {
  const text = Array.from(value)
    .map((ch) => {
      const code = ch.charCodeAt(0);
      return code >= 32 && code <= 126 ? ch : '?';
    })
    .join('');
  if (text.length === 0) throw new Error('empty barcode');

  const codes: number[] = [];
  let i = 0;
  let set: 'B' | 'C' | null = null;

  const digitRun = (from: number): number => {
    let n = 0;
    while (from + n < text.length && text[from + n] >= '0' && text[from + n] <= '9') n++;
    return n;
  };

  while (i < text.length) {
    const run = digitRun(i);
    const useC = run >= 4 || (run >= 2 && (i + run === text.length || set === 'C'));
    if (useC && run >= 2) {
      if (set !== 'C') {
        codes.push(set === null ? START_C : CODE_C);
        set = 'C';
      }
      const pairs = Math.floor(run / 2);
      for (let p = 0; p < pairs; p++) {
        codes.push(Number(text.slice(i, i + 2)));
        i += 2;
      }
      continue;
    }
    if (set !== 'B') {
      codes.push(set === null ? START_B : CODE_B);
      set = 'B';
    }
    codes.push(text.charCodeAt(i) - 32);
    i++;
  }

  let checksum = codes[0];
  for (let k = 1; k < codes.length; k++) checksum += codes[k] * k;
  codes.push(checksum % 103);
  codes.push(STOP);

  const modules = codes.map((c) => patternToModules(CODE128_PATTERNS[c])).join('');
  return { symbology: 'code128', modules, text };
}

// ---------------------------------------------------------------------------
// Auto
// ---------------------------------------------------------------------------

/** EAN-13 for 12/13-digit numeric values with a valid check digit, Code 128 otherwise. */
export function encodeBarcode(value: string): EncodedBarcode {
  const trimmed = value.trim();
  if (/^\d{13}$/.test(trimmed) && isValidEan13(trimmed)) return encodeEan13(trimmed);
  if (/^\d{12}$/.test(trimmed)) return encodeEan13(trimmed);
  return encodeCode128(trimmed);
}

export interface BarcodeSvgOptions {
  /** Width of one module in user units (default 1). */
  moduleWidth?: number;
  /** Bar height in user units (default 40). */
  height?: number;
  /** Render the human-readable text (default true). */
  showText?: boolean;
  fontSize?: number;
  /** Horizontal quiet zone in modules (default 10). */
  quietZone?: number;
}

export interface BarcodeSvg {
  width: number;
  height: number;
  rects: { x: number; width: number }[];
  text: string;
  textY: number;
  barHeight: number;
}

/** Turns modules into rect geometry that a React SVG can render directly. */
export function layoutBarcode(encoded: EncodedBarcode, opts: BarcodeSvgOptions = {}): BarcodeSvg {
  const mw = opts.moduleWidth ?? 1;
  const barHeight = opts.height ?? 40;
  const quiet = opts.quietZone ?? 10;
  const showText = opts.showText ?? true;
  const fontSize = opts.fontSize ?? 10;
  const rects: { x: number; width: number }[] = [];
  const modules = encoded.modules;
  let i = 0;
  while (i < modules.length) {
    if (modules[i] === '1') {
      let n = 0;
      while (i + n < modules.length && modules[i + n] === '1') n++;
      rects.push({ x: (quiet + i) * mw, width: n * mw });
      i += n;
    } else {
      i++;
    }
  }
  const width = (modules.length + quiet * 2) * mw;
  const textGap = showText ? fontSize + 4 : 0;
  return { width, height: barHeight + textGap, rects, text: encoded.text, textY: barHeight + fontSize + 1, barHeight };
}
