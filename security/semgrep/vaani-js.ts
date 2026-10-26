// Test cases for vaani-js.yaml (run: semgrep --test security/semgrep). Not application code.
declare const x: string;
declare const el: { innerHTML: string };
declare function jwtVerify(...a: unknown[]): unknown;
declare function createHash(a: string): unknown;
declare function exec(...a: unknown[]): unknown;
declare const express: { json: (o?: unknown) => unknown };
declare function cors(o: unknown): unknown;

// ruleid: vaani-no-eval
eval(x);
// ruleid: vaani-no-eval
const f = new Function(x);
// ok: vaani-no-eval
JSON.parse(x);

// ruleid: vaani-no-raw-html
el.innerHTML = x;
// ok: vaani-no-raw-html
const t = x.trim();

// ruleid: vaani-jwt-verify-needs-options
jwtVerify(x, x);
// ok: vaani-jwt-verify-needs-options
jwtVerify(x, x, { algorithms: ['HS256'] });

// ruleid: vaani-no-weak-hash
createHash('md5');
// ruleid: vaani-no-weak-hash
createHash('sha1');
// ok: vaani-no-weak-hash
createHash('sha256');

// ruleid: vaani-no-shell-exec
exec(x);
// ok: vaani-no-shell-exec
const ok = x.length;

// ruleid: vaani-express-json-needs-limit
express.json();
// ok: vaani-express-json-needs-limit
express.json({ limit: '100kb' });

// ruleid: vaani-cors-no-wildcard
cors({ origin: '*' });
// ruleid: vaani-cors-no-wildcard
cors({ origin: true });
// ok: vaani-cors-no-wildcard
cors({ origin: 'https://app.example.invalid' });

// ruleid: vaani-no-plain-http
fetch('http://example.org/api');
// ok: vaani-no-plain-http
fetch('http://localhost:4000/api');
// ok: vaani-no-plain-http
fetch('https://example.org/api');
