// parse.js — a fast, dependency-free CommonMark 0.31.2 + GFM 0.29 renderer that
// returns exactly the HTML marked 18.1.3 renders with its default options
// (GFM on, breaks off, pedantic off, async off). Written from scratch for the
// make.fun "Make Markdown rendering faster" bounty (markdown-render-speed-02).
// No dependencies, no WASM, no native code, no caching across calls.

// ---------------------------------------------------------------------------
// HTML escaping
// marked's rules, verified against marked 18.1.3:
//  - Text: escape & < > " ' — except & is NOT escaped when it begins a
//    numeric character reference (&#123; / &#x1F600;) which is decoded to the
//    character (0, out-of-range and surrogates become U+FFFD), or a
//    named-entity-like sequence (&word;) which passes through unchanged.
//  - Code spans / code blocks: escape & < > " ' unconditionally.
//  - Link href / title: same entity-aware rule as text, but numeric references
//    are NOT decoded (they pass through unchanged).
// ---------------------------------------------------------------------------

const REPLACEMENT = '\uFFFD';

function decodeNumeric(body, isHex) {
  // body is the digits (without &# and ;). Returns the decoded string.
  let cp;
  if (isHex) {
    if (body.length === 0 || body.length > 6) return null;
    cp = parseInt(body, 16);
    if (Number.isNaN(cp)) return null;
  } else {
    if (body.length === 0 || body.length > 7) return null;
    cp = parseInt(body, 10);
    if (Number.isNaN(cp)) return null;
  }
  if (cp === 0 || cp > 0x10FFFF || (cp >= 0xD800 && cp <= 0xDFFF)) return REPLACEMENT;
  return String.fromCodePoint(cp);
}

// Escape text content (paragraphs, headings, etc.): decodes numeric refs.
function escText(s) {
  if (s.indexOf('&') === -1 && s.indexOf('<') === -1 && s.indexOf('>') === -1 && s.indexOf('"') === -1 && s.indexOf("'") === -1) return s;
  let out = '';
  let start = 0;
  const n = s.length;
  for (let i = 0; i < n; i++) {
    const c = s.charCodeAt(i);
    let rep = null;
    let adv = 1;
    if (c === 38) { // &
      // numeric character reference?
      if (i + 2 < n && s.charCodeAt(i + 1) === 35) { // &#
        let j = i + 2;
        let hex = false;
        if (j < n && (s.charCodeAt(j) === 120 || s.charCodeAt(j) === 88)) { hex = true; j++; } // x X
        let k = j;
        if (hex) { while (k < n && ((s.charCodeAt(k) >= 48 && s.charCodeAt(k) <= 57) || (s.charCodeAt(k) >= 65 && s.charCodeAt(k) <= 70) || (s.charCodeAt(k) >= 97 && s.charCodeAt(k) <= 102))) k++; }
        else { while (k < n && s.charCodeAt(k) >= 48 && s.charCodeAt(k) <= 57) k++; }
        if (k > j && k < n && s.charCodeAt(k) === 59) { // ;
          const dec = decodeNumeric(s.slice(j, k), hex);
          if (dec !== null) {
            // emit decoded char, escaped if it is special
            if (dec === '&') rep = '&amp;';
            else if (dec === '<') rep = '&lt;';
            else if (dec === '>') rep = '&gt;';
            else if (dec === '"') rep = '&quot;';
            else if (dec === "'") rep = '&#39;';
            else rep = dec;
            adv = k + 1 - i;
          }
        }
      }
      if (rep === null) {
        // named-entity-like &word; passes through unchanged
        let k = i + 1;
        while (k < n && ((s.charCodeAt(k) >= 48 && s.charCodeAt(k) <= 57) || (s.charCodeAt(k) >= 65 && s.charCodeAt(k) <= 90) || (s.charCodeAt(k) >= 97 && s.charCodeAt(k) <= 122) || s.charCodeAt(k) === 95)) k++;
        if (k > i + 1 && k < n && s.charCodeAt(k) === 59) { rep = s.slice(i, k + 1); adv = k + 1 - i; }
        else rep = '&amp;';
      }
    } else if (c === 60) rep = '&lt;';
    else if (c === 62) rep = '&gt;';
    else if (c === 34) rep = '&quot;';
    else if (c === 39) rep = '&#39;';
    if (rep !== null) {
      out += s.slice(start, i) + rep;
      i += adv - 1;
      start = i + 1;
    }
  }
  return start === 0 ? s : out + s.slice(start);
}

// Escape an attribute value (href / title): entity-aware, no numeric decoding.
// Href encoding: marked uses encodeURI but leaves '%' untouched (a bare %
// stays %, and %XX escapes stay %XX).
function encodeHref(u) {
  return encodeURI(u).replace(/%25/g, '%');
}

function escAttr(s) {
  if (s.indexOf('&') === -1 && s.indexOf('<') === -1 && s.indexOf('>') === -1 && s.indexOf('"') === -1 && s.indexOf("'") === -1) return s;
  let out = '';
  let start = 0;
  const n = s.length;
  for (let i = 0; i < n; i++) {
    const c = s.charCodeAt(i);
    let rep = null;
    let adv = 1;
    if (c === 38) { // &
      // numeric ref &#...; / &#x...; passes through unchanged
      if (i + 2 < n && s.charCodeAt(i + 1) === 35) {
        let j = i + 2;
        let hex = false;
        if (j < n && (s.charCodeAt(j) === 120 || s.charCodeAt(j) === 88)) { hex = true; j++; }
        let k = j;
        if (hex) { while (k < n && ((s.charCodeAt(k) >= 48 && s.charCodeAt(k) <= 57) || (s.charCodeAt(k) >= 65 && s.charCodeAt(k) <= 70) || (s.charCodeAt(k) >= 97 && s.charCodeAt(k) <= 102))) k++; }
        else { while (k < n && s.charCodeAt(k) >= 48 && s.charCodeAt(k) <= 57) k++; }
        if (k > j && k < n && s.charCodeAt(k) === 59) { rep = s.slice(i, k + 1); adv = k + 1 - i; }
      }
      if (rep === null) {
        // named-entity-like &word; passes through unchanged
        let k = i + 1;
        while (k < n && ((s.charCodeAt(k) >= 48 && s.charCodeAt(k) <= 57) || (s.charCodeAt(k) >= 65 && s.charCodeAt(k) <= 90) || (s.charCodeAt(k) >= 97 && s.charCodeAt(k) <= 122) || s.charCodeAt(k) === 95)) k++;
        if (k > i + 1 && k < n && s.charCodeAt(k) === 59) { rep = s.slice(i, k + 1); adv = k + 1 - i; }
        else rep = '&amp;';
      }
    } else if (c === 60) rep = '&lt;';
    else if (c === 62) rep = '&gt;';
    else if (c === 34) rep = '&quot;';
    else if (c === 39) rep = '&#39;';
    if (rep !== null) {
      out += s.slice(start, i) + rep;
      i += adv - 1;
      start = i + 1;
    }
  }
  return start === 0 ? s : out + s.slice(start);
}

function escCode(s) {
  if (s.indexOf('&') === -1 && s.indexOf('<') === -1 && s.indexOf('>') === -1 && s.indexOf('"') === -1 && s.indexOf("'") === -1) return s;
  let out = '';
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    let rep = null;
    if (c === 38) rep = '&amp;';
    else if (c === 60) rep = '&lt;';
    else if (c === 62) rep = '&gt;';
    else if (c === 34) rep = '&quot;';
    else if (c === 39) rep = '&#39;';
    if (rep !== null) { out += s.slice(start, i) + rep; start = i + 1; }
  }
  return out + s.slice(start);
}

// Normalize a link label: collapse whitespace to single spaces, lowercase,
// strip leading/trailing whitespace. (CommonMark link reference labels.)
function normalizeLabel(s) {
  // Unicode case folding: sharp s (ß U+00DF, ẞ U+1E9E) folds to "ss".
  return s.replace(/\s+/g, ' ').trim().toLowerCase().replace(/ß/g, 'ss');
}

// ASCII punctuation (for backslash escapes and emphasis flanking).
function isAsciiPunct(c) {
  return (c >= 33 && c <= 47) || (c >= 58 && c <= 64) || (c >= 91 && c <= 96) || (c >= 123 && c <= 126);
}
function isSpace(c) { return c === 32 || c === 9 || c === 10 || c === 13; }
function isDigit(c) { return c >= 48 && c <= 57; }
// Unicode punctuation or symbol (CommonMark "punctuation character").
const UNICODE_PUNCT = /[\p{P}\p{S}]/u;
function isPunctCh(ch) {
  const c = ch.charCodeAt(0);
  if (c < 128) return isAsciiPunct(c);
  return UNICODE_PUNCT.test(ch);
}
// Code-based variants (for flankInfo/delimCan, which already have char codes).
function isSpaceCode(c) {
  if (c === 32 || c === 9 || c === 10 || c === 13) return true;
  if (c < 128) return false;
  return c === 0x00A0 || c === 0x1680 || (c >= 0x2000 && c <= 0x200A) ||
    c === 0x202F || c === 0x205F || c === 0x3000 || c === 0x000B || c === 0x000C;
}
function isPunctCode(c) {
  if (c < 128) return isAsciiPunct(c);
  return UNICODE_PUNCT.test(String.fromCharCode(c));
}
function isSpaceCh(ch) {
  if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') return true;
  const c = ch.charCodeAt(0);
  if (c < 128) return false;
  // Unicode whitespace (Zs category and friends): NBSP and other spaces
  return c === 0x00A0 || c === 0x1680 || (c >= 0x2000 && c <= 0x200A) ||
    c === 0x202F || c === 0x205F || c === 0x3000 || c === 0x000B || c === 0x000C;
}
function isUnicodeAlnumCh(ch) {
  const c = ch.charCodeAt(0);
  if (c < 128) return (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
  return /[\p{L}\p{N}]/u.test(ch);
}

// ---------------------------------------------------------------------------
// Inline parsing. Builds a flat item list, resolves links with an opener
// stack, resolves emphasis/strikethrough with the CommonMark delimiter
// algorithm, then renders to HTML.
// Item types: 0 text, 1 code, 2 html, 3 link, 4 image, 5 delim, 6 br,
//             7 softbr, 8 em, 9 strong, 10 del.
// ---------------------------------------------------------------------------

// Flanking for a delimiter run in `s` spanning [a, b): char before is s[a-1]
// (or start), char after is s[b] (or end). Start/end count as whitespace.
// Returns a bitmask: bit 0 (1) = left-flanking, bit 1 (2) = right-flanking.
function flankInfo(s, a, b) {
  const before = a > 0 ? s.charCodeAt(a - 1) : 32;
  const after = b < s.length ? s.charCodeAt(b) : 32;
  const beforeWS = isSpaceCode(before);
  const afterWS = isSpaceCode(after);
  const beforePunct = !beforeWS && isPunctCode(before);
  const afterPunct = !afterWS && isPunctCode(after);
  const leftFlanking = !afterWS && (!afterPunct || beforeWS || beforePunct);
  const rightFlanking = !beforeWS && (!beforePunct || afterWS || afterPunct);
  return (leftFlanking ? 1 : 0) | (rightFlanking ? 2 : 0);
}

// Can a run of `ch` (* or _) open/close emphasis? `isStar` for * vs _.
// Returns a bitmask: bit 0 (1) = can open, bit 1 (2) = can close.
function delimCan(s, a, b, isStar) {
  const f = flankInfo(s, a, b);
  if (isStar) return f;
  // _ : extra condition
  const before = a > 0 ? s.charCodeAt(a - 1) : 32;
  const after = b < s.length ? s.charCodeAt(b) : 32;
  const beforePunct = !isSpaceCode(before) && isPunctCode(before);
  const afterPunct = !isSpaceCode(after) && isPunctCode(after);
  const open = (f & 1) && (!(f & 2) || beforePunct);
  const close = (f & 2) && (!(f & 1) || afterPunct);
  return (open ? 1 : 0) | (close ? 2 : 0);
}

// Parse a link destination starting at `i` (first char after '(' and any
// spaces). Returns {dest, next} where next is the index after the
// destination, or null. Handles <...> and bare (balanced parens, escapes).
function parseDestination(s, i) {
  const n = s.length;
  if (i >= n) return null;
  if (s.charCodeAt(i) === 60) { // <
    let j = i + 1;
    let out = '';
    while (j < n) {
      const c = s.charCodeAt(j);
      if (c === 62) return { dest: out, next: j + 1 }; // >
      if (c === 10 || c === 60) return null; // newline or < ends it
      if (c === 92 && j + 1 < n && isAsciiPunct(s.charCodeAt(j + 1))) { out += s[j + 1]; j += 2; continue; }
      out += s[j]; j++;
    }
    return null;
  }
  // bare destination: no spaces/control chars, balanced parens, escapes
  let j = i;
  let out = '';
  let depth = 0;
  while (j < n) {
    const c = s.charCodeAt(j);
    if (c === 32 || c === 10 || c === 9 || c === 13) break;
    if (c === 92 && j + 1 < n && isAsciiPunct(s.charCodeAt(j + 1))) { out += s[j + 1]; j += 2; continue; }
    if (c === 40) { depth++; out += s[j]; j++; continue; } // (
    if (c === 41) { // )
      if (depth === 0) break;
      depth--; out += s[j]; j++; continue;
    }
    if (c < 32) return null;
    out += s[j]; j++;
  }
  if (j === i) return null;
  return { dest: out, next: j };
}

// Parse a link title starting at `i`. Returns {title, next} or null.
// Title is "..." or '...' or (...), with backslash escapes inside.
function parseTitle(s, i) {
  const n = s.length;
  if (i >= n) return null;
  const open = s.charCodeAt(i);
  let close, j;
  if (open === 34) { close = 34; j = i + 1; } // "
  else if (open === 39) { close = 39; j = i + 1; } // '
  else if (open === 40) { close = 41; j = i + 1; } // ( )
  else return null;
  let out = '';
  while (j < n) {
    const c = s.charCodeAt(j);
    if (c === close) return { title: out, next: j + 1 };
    // newlines are allowed inside a title (multi-line definitions)
    if (c === 92 && j + 1 < n && isAsciiPunct(s.charCodeAt(j + 1))) { out += s[j + 1]; j += 2; continue; }
    if (open === 40 && c === 40) return null; // ( inside (title) not allowed
    out += s[j]; j++;
  }
  return null;
}

// Parse a link label starting at `i` (s[i] === '['). Returns {label, next}
// where next is after ']'. Allows balanced nested brackets, no unescaped
// brackets beyond depth, max 999 chars.
// Split text items in items[from..to) on bare GFM autolinks (scheme://
// and www.), turning each URL into an autolink item. Used when a
// reference link fails to resolve: the URL inside its label was
// suppressed while the `[` was open, but the label is literal text now
// and marked autolinks it (doc-39). Trailing punctuation is trimmed the
// way tryGfmAutolinkFull does (.,;:!? and unmatched ) are excluded).
function autolinkTextItems(items, from, to) {
  const isUrlChar = (c) => c > 32 && c !== 60 && c !== 62;
  const trimEnd = (txt, a, b) => {
    while (b > a) {
      const c = txt.charCodeAt(b - 1);
      if (c === 46 || c === 44 || c === 59 || c === 58 || c === 33 || c === 63 || c === 95 || c === 42 || c === 126) { b--; continue; }
      if (c === 41) {
        let open = 0, close = 0;
        for (let q = a; q < b; q++) {
          if (txt.charCodeAt(q) === 40) open++;
          else if (txt.charCodeAt(q) === 41) close++;
        }
        if (close > open) { b--; continue; }
      }
      if (c === 93) { b--; continue; } // ] never belongs to a bare URL here
      break;
    }
    return b;
  };
  for (let x = from; x < to; x++) {
    if (items[x].t !== 0) continue;
    const txt = items[x].s;
    // find URL starts: scheme:// or www.
    let m = null, start = -1, scheme = false;
    const re = /(https?:\/\/|www\.)/g;
    let mm;
    const found = [];
    while ((mm = re.exec(txt)) !== null) {
      const st = mm.index;
      // word boundary: previous char must not be a word char
      if (st > 0) {
        const pc = txt.charCodeAt(st - 1);
        if ((pc >= 48 && pc <= 57) || (pc >= 65 && pc <= 90) || (pc >= 97 && pc <= 122) || pc === 95 || pc === 45 || pc === 46 || pc === 47 || pc === 58) continue;
      }
      let e = st + mm[0].length;
      while (e < txt.length && isUrlChar(txt.charCodeAt(e))) e++;
      e = trimEnd(txt, st, e);
      if (e <= st + mm[0].length) continue;
      const body = txt.slice(st, e);
      if (mm[0] === 'www.') {
        // needs a dot in the domain and a valid TLD-ish tail
        const dom = body.slice(4).split(/[\/?#]/)[0];
        if (dom.indexOf('.') === -1) continue;
      }
      found.push([st, e, mm[0] === 'www.']);
    }
    if (found.length === 0) continue;
    const out = [];
    let pos = 0;
    for (const [st, e, isWww] of found) {
      if (st > pos) out.push({ t: 0, s: txt.slice(pos, st) });
      const url = txt.slice(st, e);
      out.push({ t: 3, href: isWww ? 'http://' + url : url, title: null, kids: [{ t: 0, s: url }], auto: true });
      pos = e;
    }
    if (pos < txt.length) out.push({ t: 0, s: txt.slice(pos) });
    items.splice(x, 1, ...out);
    const delta = out.length - 1;
    x += delta; to += delta;
  }
}

// Position of the lone backtick that a mismatched label code span's
// closer pairs with in marked's delimiter stack, or -1. A length-1 run
// inside a multi-backtick code span is available (it is content there,
// not a code span opener); a length-1 run that opens a real single
// code span (its next length-1 run is its closer) is consumed. Scans
// forward from `from` to the end of the current block (blank line).
function findPairBacktick(s, from) {
  const n = s.length;
  let p = from;
  while (p < n) {
    const c = s.charCodeAt(p);
    if (c === 10 && p + 1 < n && s.charCodeAt(p + 1) === 10) return -1; // blank line
    if (c === 96) {
      let e = p;
      while (e < n && s.charCodeAt(e) === 96) e++;
      const run = e - p;
      if (run >= 2) {
        let q = e, close = -1;
        while (q < n) {
          if (s.charCodeAt(q) === 96) {
            let f = q;
            while (f < n && s.charCodeAt(f) === 96) f++;
            if (f - q === run) { close = q; break; }
            q = f;
          } else q++;
        }
        if (close < 0) { p = e; continue; }
        let r = e;
        while (r < close) {
          if (s.charCodeAt(r) === 96) {
            let g = r;
            while (g < n && s.charCodeAt(g) === 96) g++;
            if (g - r === 1) return r;
            r = g;
          } else r++;
        }
        p = close;
        while (p < n && s.charCodeAt(p) === 96) p++;
        continue;
      }
      let q = e, nr = -1;
      while (q < n) {
        if (s.charCodeAt(q) === 96) { nr = q; break; }
        q++;
      }
      if (nr < 0) return p;
      let f = nr;
      while (f < n && s.charCodeAt(f) === 96) f++;
      if (f - nr === 1) { p = f; continue; }
      return p;
    }
    p++;
  }
  return -1;
}

function parseLabel(s, i) {
  const n = s.length;
  let j = i + 1;
  let out = '';
  while (j < n) {
    const c = s.charCodeAt(j);
    if (c === 92 && j + 1 < n && isAsciiPunct(s.charCodeAt(j + 1))) {
      // only bracket escapes are unescaped in a label; others stay literal
      const d = s.charCodeAt(j + 1);
      if (d === 91 || d === 93) { out += s[j + 1]; j += 2; continue; }
      out += s[j]; out += s[j + 1]; j += 2; continue;
    }
    if (c === 91) return null; // unescaped '[' inside a label: invalid
    if (c === 93) { j++; return { text: out, next: j }; } // ]
    if (c === 10) {
      // a line ending is allowed in a label, but not a blank line
      if (out.length > 0 && out.charCodeAt(out.length - 1) === 10) return null;
      out += s[j]; j++; continue;
    }
    out += s[j]; j++;
    if (out.length > 999) return null;
  }
  return null;
}

// Skip spaces/tabs/newlines (up to 1 newline for link parsing is handled by
// caller). Returns index after whitespace.
function skipSpace(s, i) {
  while (i < s.length) {
    const c = s.charCodeAt(i);
    if (c === 32 || c === 9 || c === 10 || c === 13) i++; else break;
  }
  return i;
}

// Render the plain-text content of inline items (for image alt text):
// emphasis/code delimiters drop out, text is kept raw (escaped later).
function plainText(items) {
  let out = '';
  for (const it of items) {
    if (it.t === 0) out += it.s;
    else if (it.t === 1) out += it.s;
    else if (it.t === 2) out += it.s;
    else if (it.t === 3) out += plainText(it.kids);
    else if (it.t === 4) out += plainText(it.kids); // image alt text
    else if (it.t === 5) out += it.c.repeat(it.n);
    else if (it.t === 6) out += '\n';
    else if (it.t === 7) out += '\n';
    else if (it.t === 8 || it.t === 9 || it.t === 10) out += plainText(it.kids);
  }
  return out;
}

// Is a link label (the raw text between [ and ]) valid per marked's
// label pattern? Backtick runs must be accounted for: a run opens a
// code span when another backtick run follows it (the two runs need not
// match in length, so ``url` counts), or a run of 2+ backticks may sit
// at the very end of the label. A lone single backtick that cannot
// pair -- e.g. the trailing ` in `at `a ` b`` -- makes the whole label
// fail to match, so the link does not form at all.
function isValidLinkLabel(label) {
  const n = label.length;
  let i = 0;
  while (i < n) {
    const c = label.charCodeAt(i);
    if (c === 92) { i += 2; continue; } // backslash escape
    if (c !== 96) { i++; continue; } // not a backtick
    let j = i;
    while (j < n && label.charCodeAt(j) === 96) j++;
    // find the next backtick run (a code-span closer)
    let k = j;
    while (k < n && label.charCodeAt(k) !== 96) k++;
    if (k < n) {
      let m = k;
      while (m < n && label.charCodeAt(m) === 96) m++;
      i = m;
      continue;
    }
    // no closer run: only a 2+ run at the very end of the label is ok
    if (j === n && j - i >= 2) { i = j; continue; }
    return false;
  }
  return true;
}

// Try to form a link/image from the opener at linkStack[top].
// `s` is the inline text, `j` is the index just after the ']' (closer).
// `items` is the item list, `op` is the opener record {i, image, bang}.
// Returns {href, title, next} on success (next = index after the link),
// or null. The opener's text node is at items[op.i].
function tryLink(s, j, items, op, refs, dead) {
  const n = s.length;
  // marked's link label pattern rejects a label with an unpaired lone
  // backtick, so the link never forms (the URL is then autolinked as
  // plain text instead). Validate the raw label first.
  if (op.src !== undefined && !isValidLinkLabel(s.slice(op.src + 1, j - 1))) return null;
  // inline link: '(' must follow ']' directly, or after exactly one
  // newline; spaces on the same line are not allowed. If the inline link
  // fails, fall through to the reference checks (the opener may still be
  // a shortcut reference).
  let k = j;
  if (k < n && s.charCodeAt(k) === 10) k++;
  if (k < n && s.charCodeAt(k) === 40) { // (
    let m = k + 1;
    m = skipSpace(s, m);
    // empty destination: ()
    if (m < n && s.charCodeAt(m) === 41) {
      return { href: '', title: null, next: m + 1 };
    }
    const dest = parseDestination(s, m);
    if (dest) {
      let p = dest.next;
      p = skipSpace(s, p);
      let title = null;
      let ok = true;
      if (p < n && s.charCodeAt(p) !== 41) {
        const t = parseTitle(s, p);
        if (!t) ok = false;
        else {
          title = t.title;
          p = skipSpace(s, t.next);
        }
      }
      if (ok && p < n && s.charCodeAt(p) === 41) {
        return { href: dest.dest, title, next: p + 1 };
      }
    }
    // inline link failed: fall through to reference links
  }
  // reference link: [label], [] (collapsed), or nothing (shortcut).
  // The '[' must immediately follow ']' (no newline allowed here).
  if (j < n && s.charCodeAt(j) === 91) { // [
    const lab = parseLabel(s, j);
    if (lab) {
      const key = normalizeLabel(lab.text.length === 0 ? linkTextOf(items, op) : lab.text);
      const ref = refs.get(key);
      if (ref) return { href: ref.href, title: ref.title, next: lab.next };
      // A parsed label that does not match is a hard failure: this opener
      // is not a shortcut link either.
      // The label's '[' is dead for a later *shortcut* only when the
      // label, unescaped, would match a definition (otherwise it may still
      // serve as link text for a following full reference).
      if (dead) {
        const unesc = lab.text.replace(/\\([!-/:-@\[-`{-~])/g, '$1');
        if (refs.has(normalizeLabel(unesc))) dead.add(j);
      }
      return null;
    }
  }
  // shortcut reference: label is the link text itself
  const key = normalizeLabel(linkTextOf(items, op));
  const ref = refs.get(key);
  if (!ref) return null;
  return { href: ref.href, title: ref.title, next: j };
}

// The raw text of the link (items between the opener and the closer),
// used as a shortcut/collapsed reference label.
function linkTextOf(items, op) {
  let out = '';
  for (let x = op.i + 1; x < items.length; x++) {
    const it = items[x];
    if (it.t === 0) out += it.s;
    else if (it.t === 1) out += it.s;
    else if (it.t === 2) out += it.s;
    else if (it.t === 5) out += it.c.repeat(it.n);
    else if (it.t === 3) out += plainText(it.kids);
    else if (it.t === 4) out += plainText(it.kids);
    else if (it.t === 8 || it.t === 9 || it.t === 10) out += plainText(it.kids);
  }
  return out;
}

// Process emphasis / strikethrough delimiters in `items`.
// Returns a new item list with matched delimiters replaced by em/strong/del
// nodes. Implements the CommonMark delimiter-stack algorithm: first pair
// delimiters (tracking remaining lengths), then rebuild the list with a
// stack so nesting is correct.
function processEmphasis(items) {
  // Recurse into link/image kids first: image alt text is derived from the
  // (emphasis-resolved) link text, and must be computed even when this level
  // has no emphasis delimiters at all. Single pass: also collect delimiter
  // positions, so a run with neither links nor delimiters returns at once.
  const dpos = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.t === 3) it.kids = processEmphasis(it.kids);
    else if (it.t === 4) { it.kids = processEmphasis(it.kids); it.alt = plainText(it.kids); }
    else if (it.t === 5) dpos.push(i);
  }
  if (dpos.length === 0) return items;
  const recs = dpos.map(i => {
    const d = items[i];
    return { idx: i, c: d.c, n: d.n, open: d.o, close: d.cl };
  });
  const pairs = [];
  // --- Opener-driven pairing for * and _ (marked's emStrong algorithm) ---
  // marked scans forward from each opener with an m/f ledger: m starts at
  // the opener run length; a can-open-only run adds its length to m; a
  // can-both run is skipped (f += its length) when the rule of 3 fires
  // (y%3 && (y+b)%3===0, y = opener length, b = candidate length); a
  // closer candidate does m -= b and is skipped while m > 0. When a
  // closer is found, use = 1 if min(k, bAdj) is odd else 2, where
  // bAdj = min(b, b + m + f). Crucially this runs left-to-right over
  // openers, so an outer opener is resolved BEFORE the inner ** pairs
  // form -- which is why `*a **b**c*` leaves the outer * unpaired while
  // a closer-driven (cmark) scan pairs it.
  // A second marked subtlety: emStrong is called at EVERY delimiter
  // character, so a run's suffix can pair even when the whole run
  // cannot (`**foo*` -> `*<em>foo</em>`: the first * is literal, the
  // second pairs). We model that by trying each run at successive
  // offsets: offset j has m starting at the remaining length (n - j)
  // while y stays the FULL run length n (the rule of 3 uses y).
  // A third: marked's RDelim regex has a leading skip alternative
  // (`__...*...__` for * scans, `**..._...**` for _ scans) that
  // shields a delimiter inside a double run of the other char from
  // ever being a candidate. A * rec is protected when its immediate
  // neighbours are both _ runs of length >= 2 (and vice versa) -- but
  // only when the run before it can OPEN and the run after it can
  // CLOSE, i.e. the delimiter really sits inside a matched double
  // run of the other char. A run that is merely adjacent (e.g. the
  // `__` closer in `__a **b**__ **c**`, whose left neighbour is the
  // closer of `**b**` and whose right neighbour opens `**c**`) is
  // not shielded: the two `**` runs are not a pair around it.
  const prot = new Array(recs.length).fill(false);
  for (let i = 1; i < recs.length - 1; i++) {
    const r = recs[i], a = recs[i - 1], b = recs[i + 1];
    if (r.c === '*' && a.c === '_' && b.c === '_' && a.n >= 2 && b.n >= 2 && a.open && b.close) prot[i] = true;
    else if (r.c === '_' && a.c === '*' && b.c === '*' && a.n >= 2 && b.n >= 2 && a.open && b.close) prot[i] = true;
  }
  const rem = recs.map(r => r.n);
  const start = new Array(recs.length).fill(0); // first unresolved offset in each run
  for (let p = 0; p < recs.length; p++) {
    const o = recs[p];
    if ((o.c !== '*' && o.c !== '_') || !o.open) continue;
    // Try offsets in order; a failed offset becomes one literal char.
    while (start[p] < o.n && rem[p] > 0) {
      const y = o.n; // full run length, for the rule of 3
      const k = rem[p]; // remaining length from this offset
      let m = k, f = 0;
      let found = -1, foundUse = 0, foundFull = false;
      for (let q = p + 1; q < recs.length; q++) {
        const d = recs[q];
        if (d.c !== o.c || rem[q] <= 0) continue;
        if (prot[q]) continue; // shielded by a double run of the other char
        const b = rem[q];
        if (d.open && !d.close) { m += b; continue; }
        if (d.open && d.close) {
          if (y % 3 !== 0 && (y + b) % 3 === 0) { f += b; continue; }
        }
        if (!d.close) continue;
        m -= b;
        if (m > 0) continue;
        const bAdj = Math.min(b, b + m + f);
        const use = (Math.min(k, bAdj) % 2 === 1) ? 1 : 2;
        found = q; foundUse = use; foundFull = (bAdj === b);
        break;
      }
      if (found === -1) {
        // this offset cannot open: one literal char, try the next offset
        start[p] += 1;
        rem[p] -= 1;
        continue;
      }
      // crossing check: an opener inside an already-closed pair cannot
      // pair with a closer outside that pair
      let inside = false;
      for (const pr of pairs) {
        if (pr.o < p && p < pr.c && pr.c < found) { inside = true; break; }
      }
      if (inside) {
        start[p] += 1;
        rem[p] -= 1;
        continue;
      }
      const type = foundUse === 2 ? 9 : 8;
      pairs.push({ o: p, c: found, type, use: foundUse, full: foundFull });
      rem[p] -= foundUse;
      start[p] += foundUse;
      rem[found] -= foundUse;
      // Leftover chars of the same two runs pair again (marked's
      // recursion on the inner text, e.g. ***a*** -> em around strong).
      // The opener's remaining chars start at the new start[p]; the
      // closer's remaining chars are its prefix. Loop while both have
      // length, using the same min%2 rule on the new remainders.
      while (rem[p] > 0 && rem[found] > 0) {
        const k2 = rem[p], b2 = rem[found];
        const use2 = (Math.min(k2, b2) % 2 === 1) ? 1 : 2;
        const type2 = use2 === 2 ? 9 : 8;
        pairs.push({ o: p, c: found, type: type2, use: use2, full: foundFull });
        rem[p] -= use2;
        start[p] += use2;
        rem[found] -= use2;
      }
    }
  }
  // --- Closer-driven pairing for ~ (marked's del: equal-length runs,
  // no rule of 3) -- kept as before ---
  {
    const openers = [];
    for (let p = 0; p < recs.length; p++) {
      const d = recs[p];
      if (d.c !== '~') continue;
      if (d.close && rem[p] > 0) {
        while (rem[p] > 0) {
          let oi = -1;
          for (let k = openers.length - 1; k >= 0; k--) {
            const o = recs[openers[k]];
            if (o.c !== '~' || !o.open || rem[openers[k]] <= 0) continue;
            let inside = false;
            for (const pr of pairs) {
              if (pr.o < openers[k] && openers[k] < pr.c && pr.c < p) { inside = true; break; }
            }
            if (inside) continue;
            oi = k;
            break;
          }
          if (oi === -1) break;
          const o = recs[openers[oi]];
          let use = (rem[openers[oi]] >= 2 && rem[p] >= 2) ? 2 : 1;
          if (use > rem[openers[oi]]) use = 1;
          if (use > rem[p]) use = 1;
          pairs.push({ o: openers[oi], c: p, type: 10, use, full: true });
          rem[openers[oi]] -= use;
          rem[p] -= use;
          if (rem[openers[oi]] === 0) openers.splice(oi, 1);
        }
      }
      if (d.open && rem[p] > 0) openers.push(p);
    }
  }
  // Pairs for one opener must be ordered so the tree builder (which
  // makes the last pair outermost) nests them correctly: by closer
  // ascending (the pair reaching furthest is outermost), then by use
  // descending for pairs sharing a closer (e.g. ***a*** -> em(1)
  // outside strong(2)).
  // Stable-sort pairs by opener, then closer, then use descending.
  // (Array.prototype.sort is stable, so no index map is needed.)
  pairs.sort((a, b) => (a.o - b.o) || (a.c - b.c) || (b.use - a.use));
  // Sync recs' n with rem so leftover rendering matches.
  for (let i = 0; i < recs.length; i++) recs[i].n = rem[i];
  if (pairs.length === 0) {
    return items.map(it => it.t === 5 ? { t: 0, s: it.c.repeat(it.n) } : it);
  }
  const opens = new Map();
  const closes = new Map();
  for (const pr of pairs) {
    if (!opens.has(pr.o)) opens.set(pr.o, []);
    opens.get(pr.o).push(pr);
    if (!closes.has(pr.c)) closes.set(pr.c, []);
    closes.get(pr.c).push(pr);
  }
  // A closer may close several pairs (e.g. a *** run closing both an em
  // and a strong). They must be closed innermost-first: latest opener
  // first, and for one opener use descending (strong before em).
  for (const list of closes.values()) {
    list.sort((a, b) => (b.o - a.o) || (b.use - a.use));
  }
  const root = { kids: [] };
  const stack = [root];
  const pairNode = new Map();
  // O(1) item-index -> rec-index lookup (was dpos.indexOf per delimiter).
  // A Map over just the delimiter positions (avoids filling an array
  // sized to the whole item list).
  const recByItem = new Map();
  for (let k = 0; k < dpos.length; k++) recByItem.set(dpos[k], k);
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.t !== 5) {
      stack[stack.length - 1].kids.push(it);
      continue;
    }
    const ri = recByItem.get(i);
    const rec = recs[ri];
    const myCloses = closes.get(ri) || [];
    const myOpens = opens.get(ri) || [];
    let used = 0;
    for (const pr of myCloses) used += pr.use;
    for (const pr of myOpens) used += pr.use;
    const leftover = items[i].n - used;
    // A closer's leftover chars are its prefix: they belong INSIDE the
    // pair it closes only when the closer was fully available for that
    // pairing (bAdj === b, i.e. the pairing ledger m+f >= 0, as in
    // `**return that *old*two***` where a skipped can-both run leaves
    // f=1); when the closer overflowed the ledger (bAdj < b, as in
    // `**a***`), the leftover is a suffix left OUTSIDE. An opener's
    // leftover is always a prefix outside the pair it opens.
    const closerInside = myCloses.length > 0 && myCloses.every(pr => pr.full);
    if (leftover > 0 && closerInside) {
      stack[stack.length - 1].kids.push({ t: 0, s: rec.c.repeat(leftover) });
    }
    for (const pr of myCloses) {
      const node = pairNode.get(pr);
      if (!node) continue;
      while (stack.length > 1) {
        const f = stack.pop();
        if (f.node === node) break;
      }
    }
    if (leftover > 0 && !closerInside) {
      stack[stack.length - 1].kids.push({ t: 0, s: rec.c.repeat(leftover) });
    }
    for (let k = myOpens.length - 1; k >= 0; k--) {
      const pr = myOpens[k];
      const node = { t: pr.type, kids: [] };
      pairNode.set(pr, node);
      stack[stack.length - 1].kids.push(node);
      stack.push({ node, kids: node.kids });
    }
  }
  return root.kids;
}


// ---------------------------------------------------------------------------
// Inline scan: builds the item list, resolves links with an opener stack.
// `refs` is a Map of normalized label -> {href, title}.
// Returns the item list (emphasis already resolved).
// ---------------------------------------------------------------------------
// Unclosed raw <a ...> state, shared across parseInline calls within one
// document: marked's lexer keeps `state.inLink` across blocks, so an
// unclosed <a> in one paragraph suppresses GFM autolinks in later
// paragraphs too (doc-03). Reset at the start of each parse().
let inRawAState = false;

// Word characters for the GFM autolink boundary check (parseInline else
// branch): alnum plus _ - . / : @ ~ % + = ? # & $. Indexed by charCode.
const WORD_CHAR = new Uint8Array(128);
for (const ch of '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_-./:@~%+=?#&$') WORD_CHAR[ch.charCodeAt(0)] = 1;
// ASCII alphanumeric (for the autolink-start check).
const IS_ALNUM = new Uint8Array(128);
for (const ch of '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz') IS_ALNUM[ch.charCodeAt(0)] = 1;

// Fast-path test for parseInline: no inline-special char (\ ` * _ ~ [ <),
// no autolink marker (@, ://, www.), and no hard break (2+ spaces before
// a newline). Such a string is a single text run.
const PLAIN_INLINE_RE = /[\\`*_~[<@]|:\/\/|www\.| {2}\n/;

function parseInline(s, refs) {
  const n = s.length;
  if (n > 0 && !PLAIN_INLINE_RE.test(s)) return [{ t: 0, s }];
  const items = [];
  let needsEmph = false; // set when a delimiter/link/image item is created
  const linkStack = [];
  const dead = new Set(); // '[' positions consumed by a failed full-ref label
  let inRawA = inRawAState; // a raw <a ...> tag (unclosed) suppresses GFM autolinks
  let openUnd = 0; // unmatched `_` openers seen so far in this inline run:
  // a trailing `_` after an email domain only invalidates the autolink
  // when it is a literal `_`; when it closes an open `_`/`__` span
  // (marked tokenizes the emphasis content separately, so the email
  // never sees the closer), the autolink stands.
  let suppressEmph = false; // after a link whose label held a mismatched
  // backtick pair (``url`), marked's shared delimiter stack pairs the
  // label's lone backtick with a later one inside a multi-backtick code
  // span, swallowing the emphasis delimiters in between (doc-09,
  // doc-16, doc-28, doc-35). Cleared by a code span whose content holds
  // a backtick, or by a link whose label holds a code span; never
  // suppresses delimiters inside a link label.
  let i = 0;
  let textStart = 0;
  const flushText = (end) => { if (end > textStart) items.push({ t: 0, s: s.slice(textStart, end) }); };
  while (i < n) {
    const c = s.charCodeAt(i);
    if (c === 92) { // backslash
      if (i + 1 < n) {
        const d = s.charCodeAt(i + 1);
        if (d === 10) { flushText(i); items.push({ t: 6 }); i += 2; while (i < n && (s.charCodeAt(i) === 32 || s.charCodeAt(i) === 9)) i++; textStart = i; continue; }
        if (isAsciiPunct(d)) { flushText(i); items.push({ t: 0, s: s[i + 1] }); i += 2; textStart = i; continue; }
      }
      i++;
    } else if (c === 96) { // backtick: code span
      let j = i;
      while (j < n && s.charCodeAt(j) === 96) j++;
      const run = j - i;
      // A multi-backtick run inside a label that has no matching closer
      // before the label's `]` is not a real code-span opener: it is the
      // opener of a mismatched label code span (``url`), so it and the
      // single backtick that closes the pair are literal text, not
      // code-span openers (doc-09, doc-16, doc-28, doc-35). A multi-run
      // whose matching closer IS before the `]` is a real code span and
      // forms normally.
      if (linkStack.length > 0 && run >= 2) {
        const top = linkStack[linkStack.length - 1];
        // next `]` after this run
        let p = j, nc = -1;
        while (p < n) { if (s.charCodeAt(p) === 93) { nc = p; break; } p++; }
        // matching closer before that `]`?
        let q = j, matchBefore = false, singleBefore = false;
        while (q < n && (nc < 0 || q < nc)) {
          if (s.charCodeAt(q) === 96) {
            let e = q;
            while (e < n && s.charCodeAt(e) === 96) e++;
            if (e - q === run) { matchBefore = true; break; }
            if (e - q === 1) singleBefore = true;
            q = e;
          } else q++;
        }
        if (!matchBefore) {
          if (singleBefore) { top.expectSingle = true; top.mismatched = true; }
          i = j; continue; // literal: no code span from this run
        }
      } else if (linkStack.length > 0 && run === 1) {
        const top = linkStack[linkStack.length - 1];
        if (top.expectSingle) { top.expectSingle = false; i = j; continue; }
      }
      let k = j, found = -1;
      while (k < n) {
        if (s.charCodeAt(k) === 96) {
          let m = k;
          while (m < n && s.charCodeAt(m) === 96) m++;
          if (m - k === run) { found = k; break; }
          k = m;
        } else k++;
      }
      if (found === -1) { i = j; continue; } // whole run is literal text
      let content = s.slice(j, found).replace(/\n/g, ' ');
      if (content.length >= 2 && content.charCodeAt(0) === 32 && content.charCodeAt(content.length - 1) === 32 && content.trim() !== '') {
        content = content.slice(1, -1);
      }
      flushText(i);
      items.push({ t: 1, s: content });
      // a code span whose content holds a backtick is where the lone
      // backtick from a mismatched label pairs: it ends the suppression
      if (content.indexOf('`') >= 0) suppressEmph = false;
      i = found + run;
      textStart = i;
    } else if (c === 42 || c === 95) { // * _
      let j = i;
      while (j < n && s.charCodeAt(j) === c) j++;
      const ch = c === 42 ? '*' : '_';
      const can = delimCan(s, i, j, c === 42);
      flushText(i);
      const sup = suppressEmph && linkStack.length === 0;
      const canOpen = (can & 1) !== 0, canClose = (can & 2) !== 0;
      items.push({ t: 5, c: ch, n: j - i, o: sup ? false : canOpen, cl: sup ? false : canClose }); needsEmph = true;
      if (c === 95) {
        // track unmatched `_` openers (approximation: a can-both run
        // closes when one is open, else opens)
        if (canOpen && !canClose) openUnd++;
        else if (canClose && !canOpen) openUnd = Math.max(0, openUnd - 1);
        else if (canOpen && canClose) { if (openUnd > 0) openUnd--; else openUnd++; }
      }
      i = j; textStart = i;
    } else if (c === 126) { // ~ (single ~ is a strikethrough delimiter too)
      let j = i;
      while (j < n && s.charCodeAt(j) === 126) j++;
      const can = delimCan(s, i, j, true);
      flushText(i);
      // a run of 3+ tildes never forms strikethrough
      const ok = (j - i) < 3;
      const supT = suppressEmph && linkStack.length === 0;
      const canOpen = (can & 1) !== 0, canClose = (can & 2) !== 0;
      items.push({ t: 5, c: '~', n: j - i, o: supT ? false : (ok && canOpen), cl: supT ? false : (ok && canClose) }); needsEmph = true;
      i = j; textStart = i;
    } else if (c === 91) { // [
      flushText(i);
      items.push({ t: 0, s: '[' });
      if (!dead.has(i)) linkStack.push({ i: items.length - 1, image: false, bang: -1, src: i });
      i++; textStart = i;
    } else if (c === 33 && i + 1 < n && s.charCodeAt(i + 1) === 91) { // ![
      flushText(i);
      items.push({ t: 0, s: '!' });
      items.push({ t: 0, s: '[' });
      linkStack.push({ i: items.length - 1, image: true, bang: items.length - 2, src: i + 1 });
      i += 2; textStart = i;
    } else if (c === 93) { // ]
      flushText(i);
      textStart = i;
      let formed = false;
      // Only the most recent opener is tried at this ']'. If it fails it is
      // discarded; an outer opener's closer is a later ']'.
      if (linkStack.length > 0) {
        const op = linkStack[linkStack.length - 1];
        let hasLink = false;
        for (let x = op.i + 1; x < items.length; x++) {
          // only an explicit link blocks a containing link; autolinks
          // (marked forms the outer link anyway, nesting them) do not
          if (items[x].t === 3 && !items[x].auto) { hasLink = true; break; }
        }
        const res = (hasLink && !op.image) ? null : tryLink(s, i + 1, items, op, refs, dead);
        if (res) {
          // A link whose label held a mismatched backtick pair leaves a
          // lone backtick that marked's delimiter stack pairs with a
          // later one inside a multi-backtick code span, swallowing the
          // emphasis delimiters in between (doc-09, doc-16, doc-28,
          // doc-35). The suppression ends when a later link forms whose
          // label holds a code span (doc-16: the `[previous `a_b`]` link
          // ends it, so `**two small many**` forms); links without a
          // code span in the label leave it alone (doc-35).
          if (op.mismatched) {
            // Suppress only when the emphasis to swallow is reachable:
            // either an emphasis delimiter sits on the link's own line
            // before its end (doc-28: `__issues most__` on the same
            // line), or a pairing backtick exists later in the block
            // (doc-09, doc-35). With neither, the emphasis after a hard
            // break forms normally (doc-06).
            let eol = res.next, emphOnLine = false;
            while (eol < n && s.charCodeAt(eol) !== 10) {
              const cc = s.charCodeAt(eol);
              if (cc === 42 || cc === 95 || cc === 126) { emphOnLine = true; break; }
              eol++;
            }
            if (emphOnLine || findPairBacktick(s, res.next) >= 0) suppressEmph = true;
          } else {
            for (let x = op.i + 1; x < items.length; x++) {
              if (items[x].t === 1) { suppressEmph = false; break; }
            }
          }
          let kids;
          if (op.image) {
            kids = items.splice(op.bang, items.length - op.bang);
            kids.splice(0, 2); // drop ! and [
            items.push({ t: 4, src: res.href, title: res.title, kids, alt: '' }); needsEmph = true;
          } else {
            kids = items.splice(op.i, items.length - op.i);
            kids.shift(); // drop [
            items.push({ t: 3, href: res.href, title: res.title, kids }); needsEmph = true;
          }
          linkStack.pop();
          formed = true;
          i = res.next;
          textStart = i;
        } else {
          // A failed inline link attempt -- `](...)` right after the `]`
          // but the destination/title does not parse -- leaves the whole
          // label literal, including its emphasis delimiters: marked
          // does not form `_..._` inside such a label (`[a _b_ c](<url> t)`
          // keeps the underscores), while a link that forms, or a `]`
          // with no `(` after it, keeps emphasis working. This applies
          // only when the destination failed to parse, not when the label
          // merely contains a nested link (hasLink): there the label text
          // around the nested link is ordinary text and keeps emphasis.
          if (!hasLink && i + 1 < n && s.charCodeAt(i + 1) === 40) {
            for (let x = op.i + 1; x < items.length; x++) {
              if (items[x].t === 5) { items[x].o = false; items[x].cl = false; }
            }
          }
          // A failed REFERENCE link (`][ref]`, `[]`, or shortcut) leaves
          // the label literal too, and a bare URL inside it was
          // suppressed while the `[` was open but is autolinked by
          // marked now that the label is plain text (doc-39: the `[3]`
          // reference does not resolve, so the https:// URL inside
          // autolinks). Only when there is no `(` after the `]`.
          if (!hasLink && !(i + 1 < n && s.charCodeAt(i + 1) === 40)) {
            autolinkTextItems(items, op.i + 1, items.length); needsEmph = true;
          }
          linkStack.pop();
        }
      }
      if (!formed) { i++; }
    } else if (c === 60) { // < : autolink or raw HTML
      const auto = tryAutolink(s, i);
      if (auto) {
        flushText(i);
        items.push(auto.node); needsEmph = true;
        i = auto.next;
        textStart = i;
        continue;
      }
      const tag = tryHtmlTag(s, i);
      if (tag) {
        flushText(i);
        items.push({ t: 2, s: tag.html });
        // marked's startATag is /^<a /i (a space after <a); a bare <a>
        // does not set inLink. </a> clears it.
        if (/^<a /i.test(tag.html)) inRawA = true;
        else if (/^<\/a>/i.test(tag.html)) inRawA = false;
        i = tag.next;
        textStart = i;
        continue;
      }
      i++;
    } else if (c === 10) { // newline: hard break if preceded by 2+ spaces or backslash
      // (backslash-newline handled above; here check trailing spaces)
      let back = i - 1, spaces = 0;
      while (back >= textStart && s.charCodeAt(back) === 32) { spaces++; back--; }
      // only count spaces in the current text run (not across items)
      if (spaces >= 2) {
        flushText(i - spaces);
        items.push({ t: 6 });
        i++;
        // a hard break strips leading whitespace of the next line
        while (i < n && (s.charCodeAt(i) === 32 || s.charCodeAt(i) === 9)) i++;
        textStart = i;
      } else {
        flushText(i);
        items.push({ t: 7 });
        i++;
        textStart = i;
      }
    } else {
      // GFM extended autolink at a word boundary: www., email, scheme://
      // Suppressed inside link text (marked only tries `url` when
      // !state.inLink) and after an unclosed raw <a ...> tag. But a URL
      // right after `](` -- or after `](<`, an angle-bracket destination
      // of a failed link -- is in a failed link's destination: a forming
      // link would have jumped past it, so it may autolink (doc-10,
      // doc-12, doc-22).
      // (c is already s.charCodeAt(i); afterFailedDest is only relevant
      // inside a link label, so it is computed lazily.)
      if (!inRawA && (linkStack.length === 0 || ((i >= 2 && s.charCodeAt(i - 1) === 40 && s.charCodeAt(i - 2) === 93) ||
        (i >= 3 && s.charCodeAt(i - 1) === 60 && s.charCodeAt(i - 2) === 40 && s.charCodeAt(i - 3) === 93))) && ((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57))) {
        const prev = i === 0 ? 32 : s.charCodeAt(i - 1);
        let prevIsWord = prev < 128 && WORD_CHAR[prev] === 1;
        // A `_` that opens emphasis (`__foo@bar.com__`) is a delimiter,
        // not a word char: the autolink starts right after it.
        if (prev === 95) {
          let a = i - 1;
          while (a > 0 && s.charCodeAt(a - 1) === 95) a--;
          if (delimCan(s, a, i, false) & 1) prevIsWord = false;
        }
        if (!prevIsWord) {
          const g = tryGfmAutolinkFull(s, i, openUnd);
          if (g) {
            flushText(i);
            items.push({ t: 3, href: g.href, title: null, kids: [{ t: 0, s: g.text }], auto: true }); needsEmph = true;
            i = g.next;
            textStart = i;
            continue;
          }
        }
      }
      i++;
    }
  }
  flushText(n);
  inRawAState = inRawA; // persist the unclosed-<a> state to later blocks
  return needsEmph ? processEmphasis(items) : items;
}

// Try an autolink at s[i] === '<'. Returns {node, next} or null.
// Handles <scheme:...>, <email>, and (GFM) nothing else here.
function tryAutolink(s, i) {
  const n = s.length;
  let j = i + 1;
  // scheme:...  (2-32 chars, letter first, then letters/digits/+/-/. )
  if (j < n) {
    const c0 = s.charCodeAt(j);
    if ((c0 >= 65 && c0 <= 90) || (c0 >= 97 && c0 <= 122)) {
      let k = j + 1;
      while (k < n && k - j < 32) {
        const c = s.charCodeAt(k);
        if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 43 || c === 45 || c === 46) k++;
        else break;
      }
      if (k - j >= 2 && k < n && s.charCodeAt(k) === 58) { // :
        let m = k + 1;
        while (m < n && s.charCodeAt(m) !== 62 && s.charCodeAt(m) !== 32 && s.charCodeAt(m) !== 10) m++;
        if (m < n && s.charCodeAt(m) === 62 && m > k + 1) {
          const url = s.slice(i + 1, m);
          return { node: { t: 3, href: url, title: null, kids: [{ t: 0, s: url }], auto: true }, next: m + 1 };
        }
      }
    }
  }
  // email: local@domain.tld
  {
    let k = i + 1;
    // local part: letters/digits and .!#$%&'*+-/=?^_`{|}~ (no < > ( ) [ ] etc.)
    let m = k;
    while (m < n) {
      const c = s.charCodeAt(m);
      if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) ||
          c === 46 || c === 33 || c === 35 || c === 36 || c === 37 || c === 38 || c === 39 ||
          c === 42 || c === 43 || c === 45 || c === 47 || c === 61 || c === 63 || c === 94 ||
          c === 95 || c === 96 || c === 123 || c === 124 || c === 125 || c === 126) m++;
      else break;
    }
    if (m > k && m < n && s.charCodeAt(m) === 64) { // @
      let d = m + 1;
      let labels = 0, lastDot = -1, ok = true;
      let p = d;
      while (p < n && s.charCodeAt(p) !== 62) {
        const c = s.charCodeAt(p);
        if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 45 || c === 46) p++;
        else { ok = false; break; }
      }
      if (ok && p < n && s.charCodeAt(p) === 62) {
        const dom = s.slice(d, p);
        // must have a dot, labels alnum/hyphen, TLD >= 2 letters
        const parts = dom.split('.');
        if (parts.length >= 2) {
          const tld = parts[parts.length - 1];
          let tldOk = tld.length >= 2;
          for (let q = 0; q < tld.length && tldOk; q++) {
            const c = tld.charCodeAt(q);
            if (!((c >= 65 && c <= 90) || (c >= 97 && c <= 122))) tldOk = false;
          }
          let domOk = true;
          for (const part of parts) {
            if (part.length === 0) { domOk = false; break; }
            for (let q = 0; q < part.length; q++) {
              const c = part.charCodeAt(q);
              if (!((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 45)) { domOk = false; break; }
            }
            if (!domOk) break;
          }
          if (tldOk && domOk) {
            const email = s.slice(i + 1, p);
            return { node: { t: 3, href: 'mailto:' + email, title: null, kids: [{ t: 0, s: email }], auto: true }, next: p + 1 };
          }
        }
      }
    }
  }
  return null;
}

// GFM extended autolinks at a word boundary: www., email, scheme://,
// and scheme: (mailto:, xmpp:). Returns {href, text, next} or null.
// --- Module-level helpers for tryGfmAutolinkFull (hoisted: defining these
// closures per call was a large share of the autolink cost). ---
function gfmIsAlnum(c) { return (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57); }
function gfmIsDomChar(c) { return gfmIsAlnum(c) || c === 45 || c === 46; }
function gfmValidDomain(dom, minTld) {
  if (dom.indexOf('.') === -1) return false;
  if (dom.charCodeAt(dom.length - 1) === 45) return false; // ends with -
  const parts = dom.split('.');
  const tld = parts[parts.length - 1];
  if (tld.length < minTld) return false;
  for (let q = 0; q < tld.length; q++) {
    const c = tld.charCodeAt(q);
    if (!gfmIsAlnum(c) && c !== 95) return false;
  }
  for (const part of parts) {
    if (part.length === 0) return false;
    if (!gfmIsAlnum(part.charCodeAt(0)) || !gfmIsAlnum(part.charCodeAt(part.length - 1))) return false;
    for (let q = 0; q < part.length; q++) {
      const c = part.charCodeAt(q);
      if (!gfmIsAlnum(c) && c !== 45 && c !== 95) return false;
    }
  }
  return true;
}
// Trim trailing punctuation (.,;:!? and unmatched )) from a URL end.
function gfmTrimTrail(s, start, end) {
  while (end > start) {
    const c = s.charCodeAt(end - 1);
    if (c === 46 || c === 44 || c === 59 || c === 58 || c === 33 || c === 63 || c === 95 || c === 42 || c === 126) { end--; continue; }
    if (c === 41) {
      let open = 0, close = 0;
      for (let q = start; q < end; q++) {
        if (s.charCodeAt(q) === 40) open++;
        else if (s.charCodeAt(q) === 41) close++;
      }
      if (close > open) { end--; continue; }
    }
    break;
  }
  return end;
}
function gfmIsPunctA(c) { return c === 63 || c === 33 || c === 46 || c === 44 || c === 58 || c === 59 || c === 42 || c === 95 || c === 39 || c === 34 || c === 126 || c === 40 || c === 41 || c === 38; }
function gfmIsPunctD(c) { return c === 63 || c === 33 || c === 46 || c === 44 || c === 58 || c === 59 || c === 42 || c === 95 || c === 39 || c === 34 || c === 126 || c === 41; }
function gfmBackpedalEnd(s, start, end) {
  let p = start;
  while (p < end) {
    const c = s.charCodeAt(p);
    if (!gfmIsPunctA(c)) {
      while (p < end && !gfmIsPunctA(s.charCodeAt(p))) p++;
      continue;
    }
    if (c === 40) { // ( : a balanced (...) group, else the URL ends here
      let q = p + 1;
      while (q < end && s.charCodeAt(q) !== 41) q++;
      if (q < end) { p = q + 1; continue; }
      break;
    }
    if (c === 38) { // & : a lone & is fine; one starting an entity ends it
      let q = p + 1;
      while (q < end && gfmIsAlnum(s.charCodeAt(q))) q++;
      if (q > p + 1 && q < end && s.charCodeAt(q) === 59) break;
      p++;
      continue;
    }
    if (gfmIsPunctD(c)) {
      let q = p;
      while (q < end && gfmIsPunctD(s.charCodeAt(q))) q++;
      if (q >= end) break; // trailing punctuation: stop before the run
      p = q;
      continue;
    }
    break;
  }
  return p;
}
// Cut a URL before an entity-like &word; sequence.
function gfmCutEntity(s, start, end) {
  for (let q = start; q < end; q++) {
    if (s.charCodeAt(q) === 38) { // &
      let k = q + 1;
      while (k < end && ((s.charCodeAt(k) >= 48 && s.charCodeAt(k) <= 57) || (s.charCodeAt(k) >= 65 && s.charCodeAt(k) <= 90) || (s.charCodeAt(k) >= 97 && s.charCodeAt(k) <= 122))) k++;
      if (k > q + 1 && k < end && s.charCodeAt(k) === 59) return q; // ; ends entity
    }
  }
  return end;
}

function tryGfmAutolinkFull(s, i, openUnd) {
  const n = s.length;
  const isAlnum = gfmIsAlnum;
  const isDomChar = gfmIsDomChar;
  // Validate a domain. `minTld` is the minimum TLD length (2 for www.,
  // 1 for email). Each label must start and end with alnum; `_` is allowed
  // inside a label (marked autolinks www.foo_bar.com and foo@bar_baz.com).
  const validDomain = gfmValidDomain;
  // www.
  if (s.startsWith('www.', i)) {
    let k = i + 4;
    while (k < n && (isDomChar(s.charCodeAt(k)) || s.charCodeAt(k) === 95)) k++;
    let dom = s.slice(i + 4, k);
    // A trailing _ or . is not part of the domain (marked's backpedal
    // strips it); trim before validating, so www.relay.com_ autolinks.
    while (dom.length > 0 && (dom.charCodeAt(dom.length - 1) === 46 || dom.charCodeAt(dom.length - 1) === 95)) { dom = dom.slice(0, -1); k--; }
    if (!validDomain(dom, 2)) return null;
    let m = k;
    while (m < n) {
      const c = s.charCodeAt(m);
      if (c === 32 || c === 10 || c === 60 || c === 62) break;
      m++;
    }
    let end = gfmCutEntity(s, k, m);
    end = gfmBackpedalEnd(s, k, end);
    const text = s.slice(i, end);
    if (text.length === 0) return null;
    return { href: 'http://' + text, text, next: end };
  }
  // Email: local@domain (TLD may be 1 char; trailing '-' invalidates).
  // Scheme: scheme: or scheme:// .
  // Look ahead for @ or : within 64 chars.
  let at = -1, colon = -1;
  const limit = Math.min(n, i + 64);
  for (let k = i; k < limit; k++) {
    const c = s.charCodeAt(k);
    if (c === 64) { at = k; break; }
    if (c === 58) { colon = k; break; }
    if (c === 32 || c === 10 || c === 60 || c === 62) break;
  }
  if (at !== -1 && (colon === -1 || at < colon)) {
    // email: local part is s[i..at]
    const local = s.slice(i, at);
    if (local.length === 0) return null;
    for (let q = 0; q < local.length; q++) {
      const c = local.charCodeAt(q);
      if (!(isAlnum(c) || c === 46 || c === 33 || c === 35 || c === 36 || c === 37 || c === 38 || c === 39 || c === 42 || c === 43 || c === 45 || c === 47 || c === 61 || c === 63 || c === 94 || c === 95 || c === 96 || c === 123 || c === 124 || c === 125 || c === 126)) return null;
    }
    if (local.charCodeAt(0) === 46 || local.charCodeAt(local.length - 1) === 46 || local.indexOf('..') !== -1) return null;
    let m = at + 1;
    while (m < n && (isDomChar(s.charCodeAt(m)) || s.charCodeAt(m) === 95)) m++;
    let dom = s.slice(at + 1, m);
    while (dom.length > 0 && (dom.charCodeAt(dom.length - 1) === 46 || dom.charCodeAt(dom.length - 1) === 95)) { dom = dom.slice(0, -1); m--; }
    if (!validDomain(dom, 1)) return null;
    // a word char immediately after the domain invalidates the autolink,
    // except a trailing `_` that closes an open `_`/`__` span (openUnd>0):
    // marked tokenizes that emphasis content separately, so the email
    // never sees the closer.
    if (m < n && isAlnum(s.charCodeAt(m))) return null;
    if (m < n && s.charCodeAt(m) === 95 && !openUnd) return null;
    const text = s.slice(i, m);
    return { href: 'mailto:' + text, text, next: m };
  }
  if (colon !== -1) {
    const scheme = s.slice(i, colon);
    if (scheme.length < 2 || scheme.length > 32) return null;
    if (!((scheme.charCodeAt(0) >= 65 && scheme.charCodeAt(0) <= 90) || (scheme.charCodeAt(0) >= 97 && scheme.charCodeAt(0) <= 122))) return null;
    for (let q = 0; q < scheme.length; q++) {
      const c = scheme.charCodeAt(q);
      if (!(isAlnum(c) || c === 43 || c === 45 || c === 46)) return null;
    }
    // scheme:// -> full URL path
    if (s.startsWith('//', colon + 1)) {
      let m = colon + 3;
      if (m >= n) return null;
      let end = m;
      while (end < n) {
        const c = s.charCodeAt(end);
        if (c === 32 || c === 10 || c === 60 || c === 62) break;
        end++;
      }
      end = gfmCutEntity(s, m, end);
      end = gfmBackpedalEnd(s, m, end);
      if (end <= m) return null;
      const text = s.slice(i, end);
      return { href: text, text, next: end };
    }
    // scheme: (no //) -> email-like rest, optionally one /segment
    let m = colon + 1;
    if (m >= n) return null;
    const c0 = s.charCodeAt(m);
    if (c0 === 32 || c0 === 10 || c0 === 60 || c0 === 62) return null;
    // scan the rest until whitespace/<>
    let end = m;
    while (end < n) {
      const c = s.charCodeAt(end);
      if (c === 32 || c === 10 || c === 60 || c === 62) break;
      end++;
    }
    // If the rest contains @, it is email-like: keep local@domain plus at
    // most one /segment.
    const rest = s.slice(m, end);
    const atIx = rest.indexOf('@');
    if (atIx !== -1) {
      const local = rest.slice(0, atIx);
      if (local.length === 0) return null;
      let d = atIx + 1;
      let de = d;
      while (de < rest.length && isDomChar(rest.charCodeAt(de))) de++;
      let dom = rest.slice(d, de);
      while (dom.length > 0 && dom.charCodeAt(dom.length - 1) === 46) { dom = dom.slice(0, -1); de--; }
      if (!validDomain(dom, 1)) return null;
      // a word char immediately after the domain invalidates the autolink
      if (m + de < n && (isAlnum(s.charCodeAt(m + de)) || s.charCodeAt(m + de) === 95)) return null;
      let stop = m + de;
      // optionally one /segment (up to the next / or whitespace); only if
      // the segment is non-empty
      if (stop < end && s.charCodeAt(stop) === 47) {
        let se = stop + 1;
        while (se < end && s.charCodeAt(se) !== 47 && s.charCodeAt(se) !== 32 && s.charCodeAt(se) !== 10 && s.charCodeAt(se) !== 60 && s.charCodeAt(se) !== 62) se++;
        if (se > stop + 1) stop = gfmTrimTrail(s, stop, se);
      }
      stop = gfmCutEntity(s, m, stop);
      const text = s.slice(i, stop);
      return { href: text, text, next: stop };
    }
    // No @: the rest must be a valid domain (with a dot); otherwise this
    // is not an autolink (e.g. 'Warning:**' is not one).
    let stop = gfmCutEntity(s, m, end);
    stop = gfmTrimTrail(s, m, stop);
    if (stop <= m) return null;
    const restDom = s.slice(m, stop);
    // a domain must start with alnum and contain a dot
    if (!isAlnum(restDom.charCodeAt(0))) return null;
    let dd = stop;
    // strip a single trailing path segment? No: for a bare domain the whole
    // rest must be the domain (no path allowed without //).
    if (restDom.indexOf('.') === -1) return null;
    // validate the domain part (up to the first / if any)
    const slashIx = restDom.indexOf('/');
    const domPart = slashIx === -1 ? restDom : restDom.slice(0, slashIx);
    if (!validDomain(domPart, 1)) return null;
    const text = s.slice(i, stop);
    return { href: text, text, next: stop };
  }
  return null;
}

// Try an inline HTML tag / comment / processing instruction / declaration /
// CDATA at s[i] === '<'. Returns {html, next} or null.
function tryHtmlTag(s, i) {
  const n = s.length;
  if (i >= n || s.charCodeAt(i) !== 60) return null; // must start with '<'
  // comment: <!--> and <!---> are valid empty comments (abrupt close);
  // otherwise the comment runs to the first -->
  if (s.startsWith('<!--', i)) {
    if (s.startsWith('<!-->', i)) return { html: '<!-->', next: i + 5 };
    if (s.startsWith('<!--->', i)) return { html: '<!--->', next: i + 6 };
    const end = s.indexOf('-->', i + 4);
    if (end !== -1) {
      return { html: s.slice(i, end + 3), next: end + 3 };
    }
    // unterminated comment runs to end of line
    let e = i;
    while (e < n && s.charCodeAt(e) !== 10) e++;
    return { html: s.slice(i, e), next: e };
  }
  // processing instruction <? ... ?>
  if (s.startsWith('<?', i)) {
    const end = s.indexOf('?>', i + 2);
    if (end !== -1) return { html: s.slice(i, end + 2), next: end + 2 };
    let e = i;
    while (e < n && s.charCodeAt(e) !== 10) e++;
    return { html: s.slice(i, e), next: e };
  }
  // declaration <!A ...> or <!- not a comment
  if (s.startsWith('<!', i)) {
    if (s.startsWith('<![CDATA[', i)) {
      const end = s.indexOf(']]>', i + 9);
      if (end !== -1) return { html: s.slice(i, end + 3), next: end + 3 };
      let e = i;
      while (e < n && s.charCodeAt(e) !== 10) e++;
      return { html: s.slice(i, e), next: e };
    }
    // <!DOCTYPE ...> or <!A ...>: up to '>'
    let j = i + 2;
    if (j < n && ((s.charCodeAt(j) >= 65 && s.charCodeAt(j) <= 90) || (s.charCodeAt(j) >= 97 && s.charCodeAt(j) <= 122))) {
      while (j < n && s.charCodeAt(j) !== 62 && s.charCodeAt(j) !== 10) j++;
      if (j < n && s.charCodeAt(j) === 62) return { html: s.slice(i, j + 1), next: j + 1 };
    }
    return null;
  }
  // open/close tag: <name ...> or </name>
  let j = i + 1;
  let closing = false;
  if (j < n && s.charCodeAt(j) === 47) { closing = true; j++; } // /
  if (j >= n) return null;
  const c0 = s.charCodeAt(j);
  if (!((c0 >= 65 && c0 <= 90) || (c0 >= 97 && c0 <= 122))) return null;
  while (j < n) {
    const c = s.charCodeAt(j);
    if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 45) j++;
    else break;
  }
  const name = s.slice(closing ? i + 2 : i + 1, j);
  if (name.length === 0) return null;
  if (closing) {
    // closing tag: only whitespace then '>'
    while (j < n) {
      const c = s.charCodeAt(j);
      if (c === 62) return { html: s.slice(i, j + 1), next: j + 1 };
      if (c === 32 || c === 9 || c === 10 || c === 13) { j++; continue; }
      return null;
    }
    return null;
  }
  // after the tag name, only whitespace, '/' or '>' may follow
  if (j < n) {
    const nc = s.charCodeAt(j);
    if (!(nc === 32 || nc === 9 || nc === 10 || nc === 13 || nc === 47 || nc === 62)) return null;
  }
  // open tag: attributes (whitespace may include newlines)
  const isAttrStart = (c) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c === 58;
  const isAttrChar = (c) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95 || c === 58 || c === 46 || c === 45;
  while (j < n) {
    const c = s.charCodeAt(j);
    if (c === 62) return { html: s.slice(i, j + 1), next: j + 1 }; // >
    if (c === 47) { // / must be followed by >
      if (j + 1 < n && s.charCodeAt(j + 1) === 62) return { html: s.slice(i, j + 2), next: j + 2 };
      return null;
    }
    if (c === 32 || c === 9 || c === 10 || c === 13) { j++; continue; } // whitespace
    // attribute name
    if (!isAttrStart(c)) return null;
    j++;
    while (j < n && isAttrChar(s.charCodeAt(j))) j++;
    // optional = value
    while (j < n && (s.charCodeAt(j) === 32 || s.charCodeAt(j) === 9 || s.charCodeAt(j) === 10 || s.charCodeAt(j) === 13)) j++;
    if (j < n && s.charCodeAt(j) === 61) { // =
      j++;
      while (j < n && (s.charCodeAt(j) === 32 || s.charCodeAt(j) === 9 || s.charCodeAt(j) === 10 || s.charCodeAt(j) === 13)) j++;
      if (j >= n) return null;
      const q = s.charCodeAt(j);
      if (q === 34 || q === 39) { // quoted value (may span lines)
        j++;
        while (j < n && s.charCodeAt(j) !== q) j++;
        if (j >= n) return null;
        j++;
      } else {
        // unquoted value: no whitespace, ", ', =, <, >, `
        let vlen = 0;
        while (j < n) {
          const vc = s.charCodeAt(j);
          if (vc === 32 || vc === 9 || vc === 10 || vc === 13 || vc === 34 || vc === 39 || vc === 61 || vc === 60 || vc === 62 || vc === 96) break;
          j++; vlen++;
        }
        if (vlen === 0) return null;
      }
      // after a value, the next char must be whitespace, '/' or '>'
      if (j < n) {
        const nc = s.charCodeAt(j);
        if (!(nc === 32 || nc === 9 || nc === 10 || nc === 13 || nc === 47 || nc === 62)) return null;
      }
    }
  }
  return null;
}

// Render an item list to HTML.
function renderItems(items, out) {
  for (const it of items) {
    switch (it.t) {
      case 0: out.push(escText(it.s)); break;
      case 1: out.push('<code>' + escCode(it.s) + '</code>'); break;
      case 2: out.push(it.s); break;
      case 3: {
        out.push('<a href="' + escAttr(encodeHref(it.href)) + '"');
        if (it.title != null) out.push(' title="' + escAttr(it.title) + '"');
        out.push('>');
        renderItems(it.kids, out);
        out.push('</a>');
        break;
      }
      case 4: {
        out.push('<img src="' + escAttr(encodeHref(it.src)) + '" alt="' + escAttr(it.alt || '') + '"');
        if (it.title != null) out.push(' title="' + escAttr(it.title) + '"');
        out.push('>');
        break;
      }
      case 6: out.push('<br>'); break;
      case 7: out.push('\n'); break;
      case 8: out.push('<em>'); renderItems(it.kids, out); out.push('</em>'); break;
      case 9: out.push('<strong>'); renderItems(it.kids, out); out.push('</strong>'); break;
      case 10: out.push('<del>'); renderItems(it.kids, out); out.push('</del>'); break;
      case 5: out.push(it.c.repeat(it.n)); break; // *, _, ~ need no escaping
    }
  }
}

// ---------------------------------------------------------------------------
// Block parsing. Input: array of lines (tabs already expanded, no \r).
// Returns an array of block nodes. `refs` collects link reference definitions.
// ---------------------------------------------------------------------------

function expandTabs(s) {
  if (!s.includes('\t')) return s;
  let out = '';
  let col = 0;
  for (let k = 0; k < s.length; k++) {
    const ch = s[k];
    if (ch === '\t') {
      const nsp = 4 - (col % 4);
      out += '    '.slice(0, nsp);
      col += nsp;
    } else {
      out += ch;
      col = ch === '\n' ? 0 : col + 1;
    }
  }
  return out;
}

// Leading-whitespace info: [columns, charIndex]. A tab advances the column
// to the next multiple of 4.
function indentInfo(line) {
  let cols = 0, i = 0;
  while (i < line.length) {
    const c = line.charCodeAt(i);
    if (c === 32) { cols++; i++; }
    else if (c === 9) { cols += 4 - (cols % 4); i++; }
    else break;
  }
  return [cols, i];
}

// Indent in columns (tab-aware). No allocation: returns just the column count.
function indentOf(line) {
  let cols = 0, i = 0;
  const n = line.length;
  while (i < n) {
    const c = line.charCodeAt(i);
    if (c === 32) { cols++; i++; }
    else if (c === 9) { cols += 4 - (cols % 4); i++; }
    else break;
  }
  return cols;
}

// Index where leading indentation ends (tab-aware). No allocation.
function indentEnd(line) {
  let cols = 0, i = 0;
  const n = line.length;
  while (i < n) {
    const c = line.charCodeAt(i);
    if (c === 32) { cols++; i++; }
    else if (c === 9) { cols += 4 - (cols % 4); i++; }
    else break;
  }
  return i;
}

// Remove `cols` columns of leading indentation, converting a partially
// consumed tab into spaces. Returns the remaining string.
function stripCols(line, cols) {
  let c = 0, i = 0;
  while (i < line.length && c < cols) {
    const ch = line.charCodeAt(i);
    if (ch === 32) { c++; i++; }
    else if (ch === 9) {
      const next = c + 4 - (c % 4);
      if (next <= cols) { c = next; i++; }
      else {
        // tab straddles the boundary: remainder becomes spaces
        return ' '.repeat(next - cols) + line.slice(i + 1);
      }
    } else break;
  }
  return line.slice(i);
}

// Strip one indented-code indent (4 columns) from the start of a line,
// but only when the line starts with at least 4 columns of whitespace.
// A paragraph continuation line inside a list item loses exactly this
// much: marked keeps 1-3 leading spaces but drops 4 (cm-291, and a
// 5-space line keeps 1). Fewer than 4 columns: untouched.
function stripCodeIndent(line) {
  let c = 0, i = 0;
  while (i < line.length && c < 4) {
    const ch = line.charCodeAt(i);
    if (ch === 32) { c++; i++; }
    else if (ch === 9) { c += 4 - (c % 4); i++; }
    else return line;
  }
  if (c < 4) return line;
  return stripCols(line, 4);
}

// Strip the indented-code indent from every continuation line of a
// (possibly multi-line) paragraph chunk `l`. If `isFirst` is true, `l`'s
// own first line is the paragraph's first line and is kept; otherwise
// it is a continuation too and is stripped as well.
function stripListParaIndent(l, isFirst) {
  const parts = l.split('\n');
  for (let k = isFirst ? 1 : 0; k < parts.length; k++) parts[k] = stripCodeIndent(parts[k]);
  return parts.join('\n');
}

function isBlank(line) {
  return indentEnd(line) === line.length;
}

// Empty or ASCII-space-only line (a tab makes it non-blank for table rows).
function isSpacesOnly(line) {
  for (let i = 0; i < line.length; i++) if (line.charCodeAt(i) !== 32) return false;
  return true;
}

// Expand the leading whitespace of `s` (whose first char is at absolute
// column `col`) into spaces, using absolute columns for tab stops. Returns
// the spaces plus the rest of the string from the first non-whitespace char.
function expandLeading(s, col) {
  let extra = 0, j = 0;
  while (j < s.length) {
    const ch = s.charCodeAt(j);
    if (ch === 32) { extra++; col++; j++; }
    else if (ch === 9) { const n2 = col + 4 - (col % 4); extra += n2 - col; col = n2; j++; }
    else break;
  }
  return ' '.repeat(extra) + s.slice(j);
}

// Like stripCols, but for lines that will be re-parsed as block structure
// (container inner lines). Tabs in the remaining leading whitespace are
// expanded to spaces using their absolute columns, because a tab's width
// depends on the column it starts at, and that base is lost once the
// container prefix is removed. Code-content strips must NOT use this:
// a tab that survives into code content is output literally.
function stripColsExpand(line, cols) {
  let c = 0, i = 0;
  while (i < line.length && c < cols) {
    const ch = line.charCodeAt(i);
    if (ch === 32) { c++; i++; }
    else if (ch === 9) {
      const next = c + 4 - (c % 4);
      if (next <= cols) { c = next; i++; }
      else {
        // tab straddles the boundary: its remainder is spaces, and the
        // rest of the line starts at absolute column `next`
        return ' '.repeat(next - cols) + expandLeading(line.slice(i + 1), next);
      }
    } else break;
  }
  return expandLeading(line.slice(i), cols);
}

// Extract the content of a line starting at char index `idx`, whose
// absolute column is `col`. If `partialTab` > 0, line[idx] is a tab of
// which `partialTab` columns were already consumed by a container prefix;
// its remaining width counts from the tab stop. Used for list-item first
// lines and blockquote content.
function extractContent(line, idx, col, partialTab) {
  let extra = 0;
  let j = idx;
  if (partialTab > 0) {
    const startCol = col - partialTab;
    const stop = startCol + 4 - (startCol % 4);
    extra += stop - col;
    col = stop;
    j++;
  }
  return ' '.repeat(extra) + expandLeading(line.slice(j), col);
}

// Thematic break: up to 3 leading spaces, then 3+ of the same of * - _,
// with only spaces between them.
function isThematicBreak(line) {
  const ind = indentOf(line);
  if (ind > 3) return false;
  const s = line.slice(ind);
  if (s.length < 3) return false;
  const c = s.charCodeAt(0);
  if (c !== 42 && c !== 45 && c !== 95) return false;
  let count = 0;
  for (let k = 0; k < s.length; k++) {
    const ch = s.charCodeAt(k);
    if (ch === c) count++;
    else if (ch !== 32 && ch !== 9) return false;
  }
  return count >= 3;
}

// ATX heading: returns level (1-6) or 0. `content` is the heading text.
function parseAtx(line) {
  const ind = indentOf(line);
  if (ind > 3) return null;
  let j = ind;
  let level = 0;
  while (j < line.length && line.charCodeAt(j) === 35 && level < 6) { level++; j++; }
  if (level === 0) return null;
  if (j < line.length && line.charCodeAt(j) !== 32 && line.charCodeAt(j) !== 9) return null;
  // empty heading: `#` alone
  let content = line.slice(j).trim();
  // closing sequence: trailing #s preceded by a space, or the whole
  // content being #s (the space after the opening hashes separates them)
  if (content.length > 0) {
    if (/^#+$/.test(content)) {
      content = '';
    } else {
      const m = content.match(/^(.*?)[ \t]+#+[ \t]*$/);
      if (m) content = m[1].trimEnd();
    }
  }
  return { level, content };
}

// Fenced code: returns {ch, len, info} or null.
function parseFence(line) {
  const ind = indentOf(line);
  if (ind > 3) return null;
  const c = line.charCodeAt(ind);
  if (c !== 96 && c !== 126) return null;
  let j = ind;
  while (j < line.length && line.charCodeAt(j) === c) j++;
  const len = j - ind;
  if (len < 3) return null;
  const info = line.slice(j).trim();
  if (c === 96 && info.includes('`')) return null;
  return { ch: String.fromCharCode(c), len, info };
}

// Setext underline: 1 for ===, 2 for ---, 0 otherwise.
function setextLevel(line) {
  const ind = indentOf(line);
  if (ind > 3) return 0;
  const s = line.slice(ind).trim();
  if (s.length === 0) return 0;
  const c = s.charCodeAt(0);
  if (c !== 61 && c !== 45) return 0;
  // a setext underline is a run of one char only (no internal spaces)
  for (let k = 0; k < s.length; k++) {
    if (s.charCodeAt(k) !== c) return 0;
  }
  return c === 61 ? 1 : 2;
}

// HTML block start: returns type 1-7 or 0.
function htmlBlockType(line) {
  const ind = indentOf(line);
  if (ind > 3) return 0;
  const s = line.slice(ind);
  if (s.startsWith('<pre') || s.startsWith('<script') || s.startsWith('<style') || s.startsWith('<textarea')) {
    // type 1: <pre, <script, <style, <textarea followed by space, >, or EOL
    const m = s.match(/^<(pre|script|style|textarea)(?:[ \t>]|$)/i);
    if (m) return 1;
  }
  if (s.startsWith('<!--')) return 2;
  if (s.startsWith('<?')) return 3;
  if (s.startsWith('<!')) {
    const c = s.charCodeAt(2);
    if (c >= 65 && c <= 90) return 4; // <!A
    if (s.startsWith('<![CDATA[')) return 5;
  }
  if (s.startsWith('<![CDATA[')) return 5;
  // type 6: block-level tag (open or close), optionally followed by space/>/EOL
  const m6 = s.match(/^<\/?(address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h1|h2|h3|h4|h5|h6|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|meta|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?:[ \t>]|$)/i);
  if (m6) return 6;
  // type 7: any other complete open/close tag on its own line (validated
  // with the same rules as inline tags; must cover the whole line).
  const tag7 = tryHtmlTag(line, ind);
  if (tag7) {
    const rest = line.slice(tag7.next).trim();
    if (rest === '') return 7;
  }
  return 0;
}

// List item start: returns {ordered, start, markerLen, contentCols,
// contentIdx, indent} or null. contentCols is the content indent in columns
// (for stripping continuation lines); contentIdx is the char index where the
// content starts on this line.
function parseListMarker(line) {
  const info = indentInfo(line);
  const ind = info[0];
  const idx = info[1];
  if (ind > 3) return null;
  const c = line.charCodeAt(idx);
  let markerLen = 0, ordered = false, start = 0, markerEnd = 0;
  if (c === 45 || c === 43 || c === 42) { // - + *
    markerLen = 1; markerEnd = idx + 1;
  } else if (c >= 48 && c <= 57) { // digits
    let j = idx;
    while (j < line.length && line.charCodeAt(j) >= 48 && line.charCodeAt(j) <= 57) j++;
    if (j - idx > 9) return null;
    const d = line.charCodeAt(j);
    if (d !== 46 && d !== 41) return null; // . or )
    markerLen = j - idx + 1; markerEnd = j + 1;
    ordered = true;
    start = parseInt(line.slice(idx, j), 10);
  } else return null;
  if (markerEnd >= line.length) {
    return { ordered, start, markerLen, contentCols: ind + markerLen + 1, contentIdx: markerEnd, indent: ind, marker: ordered ? line.charCodeAt(markerEnd - 1) : c };
  }
  const nc = line.charCodeAt(markerEnd);
  if (nc !== 32 && nc !== 9) return null;
  // Scan the whole whitespace run after the marker. If it is at most 4
  // columns wide, it is all the separator (content starts after it). If
  // it is wider than 4 columns, only 1 column is the separator: the
  // content starts after the first whitespace char, and a tab there is
  // only partially consumed (partialTab = 1).
  let ci = markerEnd;
  let col = ind + markerLen;
  let totalW = 0;
  while (ci < line.length) {
    const ch = line.charCodeAt(ci);
    if (ch === 32) { totalW++; col++; ci++; }
    else if (ch === 9) { const n2 = col + 4 - (col % 4); totalW += n2 - col; col = n2; ci++; }
    else break;
  }
  if (ci >= line.length) {
    return { ordered, start, markerLen, contentCols: ind + markerLen + 1, contentIdx: markerEnd, indent: ind, marker: ordered ? line.charCodeAt(markerEnd - 1) : c };
  }
  if (totalW <= 4) {
    return { ordered, start, markerLen, contentCols: col, contentIdx: ci, indent: ind, marker: ordered ? line.charCodeAt(markerEnd - 1) : c };
  }
  if (nc === 32) {
    return { ordered, start, markerLen, contentCols: ind + markerLen + 1, contentIdx: markerEnd + 1, indent: ind, marker: ordered ? line.charCodeAt(markerEnd - 1) : c };
  }
  return { ordered, start, markerLen, contentCols: ind + markerLen + 1, contentIdx: markerEnd, partialTab: 1, indent: ind, marker: ordered ? line.charCodeAt(markerEnd - 1) : c };
}

// Try to parse a link reference definition starting at lines[i].
// Returns {def: {label, href, title}, next} or null. Consumes 1-3 lines.
function tryLinkRefDef(lines, i) {
  const n = lines.length;
  const line = lines[i];
  const ind = indentOf(line);
  if (ind > 3) return null;
  let j = ind;
  if (line.charCodeAt(j) !== 91) return null; // [
  // The label may span up to 3 lines: parse it from the joined lines.
  const joinEnd = Math.min(i + 3, n);
  const joined = lines.slice(i, joinEnd).join('\n');
  const lab = parseLabel(joined, j);
  if (!lab) return null;
  const label = normalizeLabel(lab.text.replace(/\\([!-/:-@\[-`{-~])/g, '$1'));
  if (label.length === 0) return null;
  // Which line does the label end on? Count newlines before lab.next.
  let labelEndLine = i;
  for (let p = 0; p < lab.next; p++) if (joined.charCodeAt(p) === 10) labelEndLine++;
  // Column of the character just after ']' on its line.
  let lineStart = 0;
  for (let k = i; k < labelEndLine; k++) lineStart += lines[k].length + 1;
  let curLine = lines[labelEndLine];
  let curJ = lab.next - lineStart;
  // skip spaces/tabs, must see ':'
  while (curJ < curLine.length && (curLine.charCodeAt(curJ) === 32 || curLine.charCodeAt(curJ) === 9)) curJ++;
  if (curJ >= curLine.length || curLine.charCodeAt(curJ) !== 58) return null; // :
  curJ++;
  // Rebind so the rest of the function works on the label's end line.
  j = curJ;
  // `line` is used below for the destination; point it at the end line.
  // (We keep a separate binding via a mutable variable.)
  const endLineIdx = labelEndLine;
  // destination may be on this line or the next
  let dest = null;
  let destEndLine = endLineIdx;
  let rest = lines[endLineIdx].slice(j);
  let r = rest;
  let rStart = j;
  // skip leading whitespace on this line
  let k = 0;
  while (k < r.length && (r.charCodeAt(k) === 32 || r.charCodeAt(k) === 9)) k++;
  r = r.slice(k); rStart += k;
  if (r.length === 0 && endLineIdx + 1 < n) {
    // try next line
    r = lines[endLineIdx + 1];
    rStart = 0;
    destEndLine = endLineIdx + 1;
    k = 0;
    while (k < r.length && (r.charCodeAt(k) === 32 || r.charCodeAt(k) === 9)) k++;
    r = r.slice(k); rStart = k;
  }
  if (r.length === 0) return null;
  const d = parseDestination(r, 0);
  if (!d) return null;
  dest = d.dest;
  let after = r.slice(d.next);
  let title = null;
  let titleEndLine = destEndLine;
  // title: same line, or next line
  let a = 0;
  while (a < after.length && (after.charCodeAt(a) === 32 || after.charCodeAt(a) === 9)) a++;
  // a title on the same line must be preceded by whitespace
  if (a === 0 && after.length > 0) return null;
  after = after.slice(a);
  if (after.length === 0) {
    // try next line for the title
    if (destEndLine + 1 < n) {
      const nl = lines[destEndLine + 1];
      let b = 0;
      while (b < nl.length && (nl.charCodeAt(b) === 32 || nl.charCodeAt(b) === 9)) b++;
      const t = parseTitle(nl, b);
      if (t) {
        title = t.title;
        titleEndLine = destEndLine + 1;
        let tail = nl.slice(t.next).trim();
        if (tail.length !== 0) {
          // trailing junk after the title: the def is destination-only
          return { def: { label, href: dest, title: null }, next: destEndLine + 1 };
        }
        return { def: { label, href: dest, title }, next: titleEndLine + 1 };
      }
      // no title: the def ends here, but the next line must be blank or a new block;
      // the def is complete without a title.
      return { def: { label, href: dest, title: null }, next: destEndLine + 1 };
    }
    return { def: { label, href: dest, title: null }, next: destEndLine + 1 };
  }
  const t = parseTitle(after, 0);
  if (!t) {
    // the title may span multiple lines: join subsequent lines and retry
    let joinedT = after;
    let endLine = destEndLine;
    for (let m = destEndLine + 1; m < n && m <= destEndLine + 5; m++) {
      joinedT += '\n' + lines[m];
      const t2 = parseTitle(joinedT, 0);
      if (t2) {
        let nlCount = 0;
        for (let p = 0; p < t2.next; p++) if (joinedT.charCodeAt(p) === 10) nlCount++;
        endLine = destEndLine + nlCount;
        let tail = joinedT.slice(t2.next).trim();
        // the remainder after the closing quote must be only whitespace
        // (and only on the title's last line)
        if (tail.length !== 0) return null;
        return { def: { label, href: dest, title: t2.title }, next: endLine + 1 };
      }
      // a blank line ends the definition
      if (isBlank(lines[m])) break;
    }
    return null;
  }
  title = t.title;
  let tail = after.slice(t.next).trim();
  if (tail.length !== 0) return null;
  return { def: { label, href: dest, title }, next: destEndLine + 1 };
}

// Parse a table's delimiter row. Returns align array or null.
function parseTableDelim(line) {
  const ind = indentOf(line);
  if (ind > 3) return null;
  let s = line.slice(ind).trim();
  if (s.length === 0) return null;
  if (s.charCodeAt(0) === 124) s = s.slice(1);
  if (s.charCodeAt(s.length - 1) === 124) s = s.slice(0, -1);
  if (s.length === 0) return null;
  const cells = s.split('|');
  const align = [];
  for (const cell of cells) {
    const c = cell.trim();
    if (!/^:?-+:?$/.test(c)) return null;
    if (c.charCodeAt(0) === 58 && c.charCodeAt(c.length - 1) === 58) align.push('center');
    else if (c.charCodeAt(c.length - 1) === 58) align.push('right');
    else if (c.charCodeAt(0) === 58) align.push('left');
    else align.push(null);
  }
  return align;
}

// Split a table row into cells (respecting \| escapes and code spans; an
// unmatched backtick run is literal text and does not hide a |).
function splitTableRow(line) {
  const info = indentInfo(line);
  let s = line.slice(info[1]).trim();
  if (s.charCodeAt(0) === 124) s = s.slice(1);
  if (s.length > 0 && s.charCodeAt(s.length - 1) === 124) s = s.slice(0, -1);
  // marked's table splitter does not track code spans at all: a cell ends
  // at an unescaped `|` (one preceded by an even number of backslashes).
  // A `|` inside a code span must be written `\|` in the source to survive
  // (an unescaped one splits the cell and breaks the table). After
  // splitting, `\|` becomes `|` in each cell (before inline parsing).
  const cells = [];
  let cur = '';
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === '|') {
      let bs = 0, k = i - 1;
      while (k >= 0 && s[k] === '\\') { bs++; k--; }
      if (bs % 2 === 0) {
        cells.push(cur.trim().replace(/\\\|/g, '|'));
        cur = '';
        i++;
        continue;
      }
    }
    cur += ch;
    i++;
  }
  cells.push(cur.trim().replace(/\\\|/g, '|'));
  return cells;
}


// Is there an unclosed fenced code block among these lines?
function hasOpenFence(ls) {
  let fence = null;
  for (const l of ls) {
    const f = parseFence(l);
    if (!fence) {
      if (f) fence = f;
    } else if (f && f.ch === fence.ch && f.len >= fence.len && f.info.trim() === '') {
      fence = null;
    }
  }
  return fence !== null;
}

// Main block parser over a line range. `inList` is true when the lines are
// the content of a list item: there, any ordered list marker may interrupt
// a paragraph (not only one starting at 1).
function parseBlocks(lines, refs, inList) {
  const blocks = [];
  const n = lines.length;
  let i = 0;
  // pushB records the line range [s, e) each block covers (used to detect
  // a blank line between two top-level blocks of a list item).
  let curStart = 0;
  const pushB = (b) => { b.s = curStart; b.e = i; blocks.push(b); };
  while (i < n) {
    const line = lines[i];
    if (isBlank(line)) { i++; continue; }
    curStart = i;
    const ind = indentOf(line);
    // ATX heading
    const atx = parseAtx(line);
    if (atx) {
      pushB({ t: 'h', level: atx.level, content: atx.content });
      i++;
      continue;
    }
    // Fenced code
    const fence = parseFence(line);
    if (fence) {
      const buf = [];
      // Opening fence indent, stripped from content lines -- but only
      // for backtick fences. A tilde (~~~) fence does not strip its
      // indent: marked keeps the content's leading spaces for ~~~
      // (top-level `   ~~~js` keeps 3 spaces, `>   ~~~js` keeps 2),
      // while a ``` fence strips them.
      const find = fence.ch === '~' ? 0 : ind;
      i++;
      while (i < n) {
        const l = lines[i];
        const ind2 = indentOf(l);
        if (ind2 <= 3) {
          let j = ind2;
          while (j < l.length && l.charCodeAt(j) === fence.ch.charCodeAt(0)) j++;
          if (j - ind2 >= fence.len && l.slice(j).trim() === '') { i++; break; }
        }
        let content = l;
        if (find > 0) {
          let p = 0, col = 0, hasTab = false;
          while (p < l.length && (l.charCodeAt(p) === 32 || l.charCodeAt(p) === 9)) {
            if (l.charCodeAt(p) === 9) { hasTab = true; col += 4 - (col % 4); }
            else col++;
            p++;
            if (col >= find) break;
          }
          if (hasTab) {
            // drop the whole leading whitespace run, not just to `p`
            let q = p;
            while (q < l.length && (l.charCodeAt(q) === 32 || l.charCodeAt(q) === 9)) q++;
            content = l.slice(q);
          } else {
            content = stripCols(l, find);
          }
        }
        buf.push(content);
        i++;
      }
      // The line right before the closing fence is not content: marked's
      // fences regex captures the content up to (not including) the single
      // newline before the closing fence. That means exactly one trailing
      // EMPTY line is dropped -- but a whitespace-only line (spaces/tabs)
      // is real content and is kept. So pop only a truly empty last line,
      // whether or not any non-blank content exists.
      if (buf.length > 0 && buf[buf.length - 1] === '') buf.pop();
      pushB({ t: 'code', info: fence.info, lines: buf });
      continue;
    }
    // Indented code (4+ spaces, not a list item / blank)
    if (ind >= 4) {
      const buf = [];
      while (i < n) {
        const l = lines[i];
        if (isBlank(l)) {
          // look ahead: blank lines belong if followed by indented code
          let j = i + 1;
          while (j < n && isBlank(lines[j])) j++;
          if (j < n && indentOf(lines[j]) >= 4) {
            // keep the blank lines' spaces (minus the 4-column indent)
            while (i < j) { buf.push(stripCols(lines[i], 4)); i++; }
            continue;
          }
          break;
        }
        if (indentOf(l) >= 4) { buf.push(stripCols(l, 4)); i++; }
        else break;
      }
      pushB({ t: 'icode', lines: buf });
      continue;
    }
    // HTML block
    const htype = htmlBlockType(line);
    if (htype > 0) {
      const buf = [line];
      i++;
      const endRe = htype === 1 ? /<\/(pre|script|style|textarea)>/i
        : htype === 2 ? /-->/
        : htype === 3 ? /\?>/
        : htype === 4 ? />/
        : htype === 5 ? /\]\]>/
        : null;
      if (endRe) {
        if (!endRe.test(line)) {
          while (i < n) {
            const l = lines[i];
            buf.push(l);
            i++;
            if (endRe.test(l)) break;
          }
        }
      } else {
        // type 6/7: ends at first blank line
        while (i < n && !isBlank(lines[i])) { buf.push(lines[i]); i++; }
      }
      // marked's block-html regex ends types 1-5 with (?: *\n|\s*$)
      // (one newline) but types 6/7 with (?: *\n{2,}|\s*$), and its
      // ge() strips the raw when 2+ trailing blank lines accumulate.
      // Net effect: a type 1-5 block keeps its trailing newline when
      // the next line is non-blank OR whitespace-only-but-non-empty
      // (a tab/space line); an empty blank line, and any blank line
      // after a type 6/7 block, drops it.
      const nextLine = i < lines.length ? lines[i] : null;
      const trail = nextLine !== null && (!isBlank(nextLine) || (htype <= 5 && nextLine.length > 0));
      pushB({ t: 'html', lines: buf, htype, trail });
      continue;
    }
    // Thematic break
    if (isThematicBreak(line)) {
      pushB({ t: 'hr' });
      i++;
      continue;
    }
    // Block quote
    if (line.charCodeAt(ind) === 62) { // >
      const inner = [];
      while (i < n) {
        const l = lines[i];
        const ind2 = indentOf(l);
        if (l.charCodeAt(ind2) === 62) {
          let j = ind2 + 1;
          let contentCols = ind2 + 1;
          let partialTab = 0;
          if (j < l.length) {
            if (l.charCodeAt(j) === 32) { j++; contentCols++; }
            else if (l.charCodeAt(j) === 9) { partialTab = 1; contentCols++; }
          }
          const content = extractContent(l, j, contentCols, partialTab);
          // a quote line whose content is only spaces still contributes
          // those spaces to an open paragraph (it is not a blank line:
          // the source line was not blank, it carried a `>`)
          if (isBlank(content) && content.length > 0 && inner.length > 0 && !isBlank(inner[inner.length - 1])) {
            inner[inner.length - 1] += '\n' + content;
          } else {
            inner.push(content);
          }
          i++;
        } else if (isBlank(l)) {
          break;
        } else if (inner.length > 0 && !isBlank(l)) {
          // lazy continuation line: only if it can continue an open
          // paragraph (not a block start, not inside a fenced code block,
          // and the quote content does not end with a blank line).
          const indL = indentOf(l);
          const isBlockStart = parseAtx(l) || parseFence(l) || isThematicBreak(l) ||
            htmlBlockType(l) > 0 || parseListMarker(l) ||
            l.charCodeAt(indL) === 62;
          const lastInner = inner[inner.length - 1];
          // lazy continuation only continues an open paragraph: if the
          // quote's last content line is indented code (4+ spaces), the
          // line is a separate block, not a continuation
          const lastIsCode = lastInner !== undefined && indentOf(lastInner) >= 4;
          if (!isBlockStart && !lastIsCode && !hasOpenFence(inner) && lastInner !== undefined && !isBlank(lastInner)) {
            // A lazy line is paragraph text. It loses one indented-code
            // indent (4 columns) if it has one -- `> foo\n    bar` gives
            // `foo\nbar`, `> foo\n     bar` gives `foo\n bar` -- and
            // otherwise keeps its leading whitespace (`> foo\n bar`
            // keeps the space). A lazy line that looks like a setext
            // underline is indented by 4, but only when the paragraph it
            // joins already spans lines (cm-093 `> foo\nbar\n===` gives
            // `foo\nbar\n    ===`); a setext line joining a single-line
            // paragraph is kept as-is (`> a\n===` gives `a\n===`).
            let add = stripCodeIndent(l);
            if (setextLevel(l) > 0 && lastInner.indexOf('\n') !== -1) add = '    ' + add;
            inner[inner.length - 1] += '\n' + add;
            i++;
          } else break;
        } else break;
      }
      pushB({ t: 'quote', children: parseBlocks(inner, refs, inList) });
      continue;
    }
    // List
    const lm = parseListMarker(line);
    if (lm) {
      const { items, next } = parseList(lines, i, refs);
      pushB(items);
      i = next;
      continue;
    }
    // Paragraph (may start with link reference definitions; may be a table
    // header if followed by a delimiter row; may end in a setext heading)
    {
      const start = i;
      const plines = [];
      let j = i;
      // collect paragraph lines, consuming leading link ref defs
      let defsOnly = true;
      while (j < n) {
        const l = lines[j];
        if (isBlank(l)) break;
        // a link ref def at the start of the paragraph (or after other defs)
        if (defsOnly || plines.length === 0) {
          const d = tryLinkRefDef(lines, j);
          if (d) {
            if (!refs.has(d.def.label)) refs.set(d.def.label, { href: d.def.href, title: d.def.title });
            // a definition is a block (it renders nothing) so that the
            // list tight/loose check can see the blank line before it
            pushB({ t: 'def', s: j, e: d.next });
            j = d.next;
            continue;
          }
        }
        // interruption checks: a new block-starting line ends the paragraph.
        // Block starts are checked even when only link ref defs have been
        // consumed so far (a following blockquote/list/etc. is a new block,
        // not paragraph text); setext/table need paragraph content.
        // Type-7 HTML blocks cannot interrupt a paragraph.
        if (parseAtx(l) || parseFence(l) || isThematicBreak(l)) break;
        {
          const ht = htmlBlockType(l);
          if (ht > 0 && ht < 7) break;
        }
        const ind2 = indentOf(l);
        if (l.charCodeAt(ind2) === 62) break;
        if (plines.length > 0 || !defsOnly) {
          {
            const lmP = parseListMarker(l);
            // a list interrupts a paragraph only if its first item is
            // non-empty (a bare marker line is a paragraph continuation);
            // an ordered list must start at 1, except inside a list item
            // where any start number interrupts
            if (lmP && (!lmP.ordered || lmP.start === 1 || inList) && l.slice(lmP.contentIdx).trim() !== '') break;
          }
          // a setext underline ends the paragraph (it becomes a heading)
          if (plines.length > 0 && setextLevel(l) > 0) break;
          // a table delimiter row ends the paragraph (the last paragraph
          // line becomes the table header) -- only when its cell count
          // matches the header's
          if (plines.length > 0) {
            const dl = parseTableDelim(l);
            if (dl !== null) {
              const hc = splitTableRow(plines[plines.length - 1]);
              if (dl.length === hc.length) break;
            }
          }
        }
        // A paragraph continuation line inside a list item loses one
        // indented-code indent (4 columns). `l` may itself contain
        // embedded newlines (a lazy continuation merged into the previous
        // inner line), so strip every line after the paragraph's first.
        plines.push(inList ? stripListParaIndent(l, plines.length === 0) : l);
        defsOnly = false;
        j++;
      }
      // setext heading? (checked before table: a bare --- is a heading,
      // not a table delimiter)
      if (plines.length >= 1 && j < n) {
        const sl0 = setextLevel(lines[j]);
        if (sl0 > 0) {
          pushB({ t: 'h', level: sl0, content: plines.join('\n').trim() });
          i = j + 1;
          continue;
        }
      }
      // table? header line + delimiter row (cell counts must match)
      if (plines.length >= 1 && j < n) {
        const align = parseTableDelim(lines[j]);
        if (align) {
          const header = splitTableRow(plines[plines.length - 1]);
          // header must have been a single paragraph line (or the last line)
          const rows = [];
          j++;
          // marked's table body-row regex excludes only a line that is
          // empty or spaces-only (` *\n`); a line containing a tab is a
          // row (it becomes an all-empty row). isBlank() treats a tab-only
          // line as blank, so use a spaces-only test here.
          while (j < n && !isSpacesOnly(lines[j])) {
            const rl = lines[j];
            // a line that starts a new block ends the table
            if (parseAtx(rl) || parseFence(rl) || isThematicBreak(rl) || htmlBlockType(rl) > 0) break;
            const rind = indentOf(rl);
            if (rl.charCodeAt(rind) === 62) break; // block quote
            if (parseListMarker(rl)) break;
            rows.push(splitTableRow(rl));
            j++;
          }
          // the table consumes the last paragraph line as its header
          const preLines = plines.slice(0, -1);
          if (preLines.length > 0) {
            pushB({ t: 'p', lines: preLines });
          }
          pushB({ t: 'table', header, align, rows });
          i = j;
          continue;
        }
      }
      if (plines.length > 0) {
        pushB({ t: 'p', lines: plines });
      }
      i = j;
      continue;
    }
  }
  return blocks;
}

// Parse a list starting at lines[start]. Returns {items: block, next}.
function parseList(lines, start, refs) {
  const n = lines.length;
  const first = parseListMarker(lines[start]);
  const ordered = first.ordered;
  const startNum = first.start;
  const marker0 = first.marker;
  const items = [];
  let i = start;
  let tight = true;
  let lastItemBlank = false;
  while (i < n) {
    let line = lines[i];
    // blank lines between items: skip them; if the next non-blank line is a
    // same-type list item, the list continues (and becomes loose).
    if (isBlank(line)) {
      let j = i + 1;
      while (j < n && isBlank(lines[j])) j++;
      if (j < n) {
        const lmJ = parseListMarker(lines[j]);
        if (lmJ && lmJ.ordered === ordered && lmJ.marker === marker0) {
          tight = false;
          i = j;
          line = lines[i];
        } else break;
      } else break;
    }
    // a thematic break ends the list (it is not a list item)
    if (isThematicBreak(line)) break;
    const lm = parseListMarker(line);
    if (!lm) break;
    if (lm.ordered !== ordered) break;
    if (lm.marker !== marker0) break;
    // same list only if the marker matches the list type; a different
    // bullet char starts a new list, a different ordered delimiter too.
    // (We approximate: any marker of the same ordered-ness continues.)
    const contentCols = lm.contentCols;
    const itemIndent = contentCols;
    // task list?
    let checked = null;
    let firstLine = extractContent(line, lm.contentIdx, lm.contentCols, lm.partialTab || 0);
    const tm = firstLine.match(/^\[([ xX])\][ \t]+(.*)$/s);
    if (tm) {
      checked = tm[1] === ' ' ? false : true;
      firstLine = tm[2];
    } else if (/^\[[ xX]\]$/.test(firstLine.trim())) {
      // `[ ]` alone on the line is not a task marker (no content after)
    }
    const inner = [];
    inner.push(firstLine);
    i++;
    // gather continuation lines belonging to this item
    let blankRun = 0;
    while (i < n) {
      const l = lines[i];
      if (isBlank(l)) {
        // an empty item (no content after the marker) followed by a blank
        // line is complete; indented lines after it are a separate block
        if (isBlank(firstLine)) break;
        // look ahead
        let j = i + 1;
        while (j < n && isBlank(lines[j])) j++;
        if (j < n) {
          const indJ = indentOf(lines[j]);
          const lmJ = parseListMarker(lines[j]);
          if (lmJ && lmJ.indent < itemIndent && indJ <= 3) {
            // next item of an outer list (or this list) — stop
            break;
          }
          if (indJ >= itemIndent || (lmJ && lmJ.indent >= itemIndent)) {
            // belongs to this item
            while (i < j) { inner.push(''); i++; }
            blankRun = 0;
            continue;
          }
          if (lmJ) break;
          break;
        }
        break;
      }
      const indL = indentOf(l);
      if (indL >= itemIndent) {
        inner.push(stripColsExpand(l, itemIndent));
        blankRun = 0;
        i++;
        continue;
      }
      // a line with less indent: could be a lazy paragraph continuation
      // (only if the item's content so far ends in a paragraph and the
      // line is not a block start). It merges into the previous inner line
      // so it stays paragraph text and cannot start a new block. A lazy
      // line keeps its leading whitespace: it is paragraph text, not
      // indentation to strip (marked keeps the space in `+ At foo\n bar`).
      // But a lazy line cannot continue a fenced code block: if the
      // item's last line opened a fence, an under-indented line ends the
      // item (and the fence, which then comes out empty) instead of being
      // swallowed as fence content (doc-13, doc-17, doc-38).
      const lastInnerLine = inner.length > 0 ? inner[inner.length - 1] : '';
      const lastIsFence = lastInnerLine !== '' && parseFence(lastInnerLine.split('\n')[0]) !== null && hasOpenFence(inner);
      if (!parseAtx(l) && !parseFence(l) && !isThematicBreak(l) && htmlBlockType(l) === 0 && !parseListMarker(l) && l.charCodeAt(indL) !== 62 && !lastIsFence) {
        if (inner.length > 0) inner[inner.length - 1] += '\n' + l;
        else inner.push(l);
        i++;
        continue;
      }
      break;
    }
    // determine tight/loose: a blank line between two of the item's own
    // top-level blocks (by line range) makes the list loose. A blank line
    // inside a nested block does not.
    const itemBlocks = parseBlocks(inner, refs, true);
    let innerLoose = false;
    for (let bi = 0; bi + 1 < itemBlocks.length; bi++) {
      const a = itemBlocks[bi], b = itemBlocks[bi + 1];
      for (let li = a.e; li < b.s; li++) {
        if (isBlank(inner[li])) { innerLoose = true; break; }
      }
      if (innerLoose) break;
    }
    if (innerLoose) tight = false;
    items.push({ checked, children: itemBlocks });
    // blank line after this item before the next item marker of the
    // SAME list? A blank line before a different list (or any other
    // block) ends this list and does not make it loose.
    if (i < n && isBlank(lines[i])) {
      let j = i + 1;
      while (j < n && isBlank(lines[j])) j++;
      if (j < n) {
        const lmJ = parseListMarker(lines[j]);
        if (lmJ && lmJ.ordered === ordered && lmJ.marker === marker0) {
          tight = false;
        }
      }
    }
  }
  return { items: { t: 'list', ordered, start: startNum, tight, items }, next: i };
}

// Render a block list to HTML (appended to `out`).
function renderBlocks(blocks, refs, out) {
  for (const b of blocks) {
    switch (b.t) {
      case 'def': break; // link reference definition: renders nothing
      case 'p': {
        out.push('<p>');
        renderItems(parseInline(b.lines.join('\n'), refs), out);
        out.push('</p>\n');
        break;
      }
      case 'h': {
        out.push('<h' + b.level + '>');
        renderItems(parseInline(b.content, refs), out);
        out.push('</h' + b.level + '>\n');
        break;
      }
      case 'hr': out.push('<hr>\n'); break;
      case 'code': {
        const info = b.info ? escAttr(b.info.split(/\s+/)[0].replace(/\\([!-/:-@\[-`{-~])/g, '$1')) : '';
        out.push('<pre><code' + (info ? ' class="language-' + info + '"' : '') + '>');
        out.push(escCode(b.lines.join('\n') + (b.lines.length ? '\n' : '')));
        out.push('</code></pre>\n');
        break;
      }
      case 'icode': {
        out.push('<pre><code>');
        out.push(escCode(b.lines.join('\n') + (b.lines.length ? '\n' : '')));
        out.push('</code></pre>\n');
        break;
      }
      case 'html': {
        out.push(b.lines.join('\n'));
        if (b.trail) out.push('\n');
        break;
      }
      case 'quote': {
        out.push('<blockquote>\n');
        renderBlocks(b.children, refs, out);
        out.push('</blockquote>\n');
        break;
      }
      case 'list': {
        const tag = b.ordered ? 'ol' : 'ul';
        out.push('<' + tag + (b.ordered && b.start !== 1 ? ' start="' + b.start + '"' : '') + '>\n');
        for (const item of b.items) {
          out.push('<li>');
          const checkbox = item.checked !== null
            ? '<input ' + (item.checked ? 'checked="" ' : '') + 'disabled="" type="checkbox"> '
            : null;
          renderListItem(item.children, refs, b.tight, out, checkbox);
          out.push('</li>\n');
        }
        out.push('</' + tag + '>\n');
        break;
      }
      case 'table': {
        out.push('<table>\n<thead>\n<tr>\n');
        for (let k = 0; k < b.header.length; k++) {
          const a = b.align[k];
          out.push('<th' + (a ? ' align="' + a + '"' : '') + '>');
          renderItems(parseInline(b.header[k], refs), out);
          out.push('</th>\n');
        }
        out.push('</tr>\n</thead>\n');
        if (b.rows.length === 0) { out.push('</table>\n'); break; }
        out.push('<tbody>');
        for (const row of b.rows) {
          out.push('<tr>\n');
          for (let k = 0; k < b.header.length; k++) {
            const a = b.align[k];
            const cell = k < row.length ? row[k] : '';
            out.push('<td' + (a ? ' align="' + a + '"' : '') + '>');
            renderItems(parseInline(cell, refs), out);
            out.push('</td>\n');
          }
          out.push('</tr>\n');
        }
        out.push('</tbody></table>\n');
        break;
      }
    }
  }
}

// Render a list item's children. In a tight list every paragraph renders
// inline (no <p> tags, no trailing newline); other blocks render normally.
// A task checkbox goes directly in the <li> for tight lists, but inside
// the first <p> for loose lists.
function renderListItem(children, refs, tight, out, checkbox) {
  if (tight) {
    if (checkbox) out.push(checkbox);
    for (const b of children) {
      if (b.t === 'p') {
        renderItems(parseInline(b.lines.join('\n'), refs), out);
      } else {
        renderBlocks([b], refs, out);
      }
    }
    return;
  }
  let done = false;
  for (const b of children) {
    if (!done && checkbox && b.t === 'p') {
      out.push('<p>');
      out.push(checkbox);
      renderItems(parseInline(b.lines.join('\n'), refs), out);
      out.push('</p>\n');
      done = true;
    } else {
      renderBlocks([b], refs, out);
    }
  }
  if (!done && checkbox) out.push(checkbox);
}

// ---------------------------------------------------------------------------
// Main entry.
// ---------------------------------------------------------------------------
export function parse(markdown) {
  let normalized = markdown;
  if (typeof normalized !== 'string') normalized = String(normalized);
  // Most documents have no \r: skip the regex pass entirely in that case.
  if (normalized.indexOf('\r') !== -1) normalized = normalized.replace(/\r\n?/g, '\n');
  const endsWithNewline = normalized.endsWith('\n');
  const refs = new Map();
  inRawAState = false; // fresh document: no unclosed <a> yet
  const lines = normalized.split('\n');
  // A trailing newline produces a final empty line; drop it (it is just the
  // document terminator, not a blank line that matters).
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  const blocks = parseBlocks(lines, refs);
  const out = [];
  renderBlocks(blocks, refs, out);
  // An HTML block as the last block keeps the source's trailing newline
  // (a mid-document html block already appends its own via trail).
  if (endsWithNewline && blocks.length > 0 && blocks[blocks.length - 1].t === 'html' && !blocks[blocks.length - 1].trail) {
    out.push('\n');
  }
  return out.join('');
}
