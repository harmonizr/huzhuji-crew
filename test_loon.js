// Node harness: runs hzj_crew.js with shims for Loon globals ($httpClient etc.)
const https = require('https'), zlib = require('zlib'), fs = require('fs');

const store = new Map();
const logLines = [];
let doneValue = null;

global.$persistentStore = {
  read: (k) => store.get(k) ?? '',
  write: (v, k) => { store.set(k || '__default__', v); return true; },
  remove: () => store.clear(),
};
global.$notification = { post: (t, s, c) => { logLines.push('NOTIFY: ' + t + ' | ' + s + ' | ' + (c || '').toString().slice(0, 600)); } };
global.$done = (v) => { doneValue = v; };
global.$argument = null; // set per run

global.$httpClient = {
  get: (o, cb) => doReq('GET', o, cb),
  post: (o, cb) => doReq('POST', o, cb),
};
function doReq(method, o, cb) {
  const headers = {};
  for (const [k, v] of Object.entries(o.headers || {})) headers[k] = v;
  const body = o.body ? String(o.body) : null;
  let tries = 0;
  const go = () => {
    const r = https.request({
      hostname: new URL(o.url).hostname,
      path: new URL(o.url).pathname + new URL(o.url).search,
      method, headers,
      rejectUnauthorized: o.insecure !== false ? false : true,
      servername: 'huzhuji.com',
    }, (res) => {
      const chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => {
        let buf = Buffer.concat(chunks);
        if ((res.headers['content-encoding'] || '').includes('gzip')) { try { buf = zlib.gunzipSync(buf); } catch (e) { } }
        cb(null, { status: res.statusCode, headers: res.headers }, buf.toString('utf8'));
      });
    });
    r.on('error', (e) => { if (++tries < 3) setTimeout(go, 1200); else cb(String(e)); });
    if (body) r.write(body);
    r.end();
  };
  go();
}

// ---- run ----
(async () => {
  const args = JSON.parse(process.argv[2] || '{}');
  global.$argument = args; // object form (like plugin object argument)
  // speed up: override pace in a COPY of the script file
  let code = fs.readFileSync('/var/minis/workspace/huzhuji-crew/hzj_crew.js', 'utf8');
  code = code.replace('var CFG = {', 'var CFG = {\n  _harness: true,'); // no-op marker
  // shorten sleeps via harness flag: wrap sleep
  code = code.replace('function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }',
    'function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms * ' + (process.argv[3] || '1') + '); }); }');
  fs.writeFileSync('/tmp/hzj_run.js', code);
  require('/tmp/hzj_run.js');
  // wait for async main to finish
  const t0 = Date.now();
  while (doneValue === null && Date.now() - t0 < 20 * 60 * 1000) { await new Promise(r => setTimeout(r, 2000)); }
  console.log('--- script done:', JSON.stringify(doneValue && doneValue.error ? doneValue.error : 'ok'));
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
