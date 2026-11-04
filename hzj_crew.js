// ============================================================
// 互助集·车队助力 多账号自动化  (huzhuji.com / 好价集)
// Loon 3.5+ Script  (经典 $httpClient / $persistentStore API)
// 功能: 每个账号每天:
//   Lv<2 : 在开放频道(pdd/jdj/tb)助力他人 攒积分(到 200=Lv.2 解锁车队频道)
//   Lv>=2: 在车队互助频道(jdj-teamhelp)助力他人(赚"被助力"余额) + 发布自己的车队口令
// 多账号"不同环境": 每账号独立设备指纹/会话cookie, 可配不同代理节点(node)
// ============================================================
"use strict";

// ---------- 配置 ----------
var CFG = {
  enabled: true,
  accounts: "[]",          // JSON: [{"n":名,"c":"aid值","node":"节点/策略组(可空)","code":"专属口令(可空)","ua":"UA(可空)"}]
  crew_code: "",           // 共享车队口令(淘宝车队"拉人助力 向前冲"链接, 每日0点失效需更新)
  earn: "pdd,jdj,tb",      // 攒分频道
  help_count: 6,           // 每账号车队助力次数(站点上限6)
  earn_count: 10,          // 每账号攒分助力总次数上限
  pace_ms: 12000,          // 请求间隔(防429爆发限制, >=10000)
  gap_ms: 45000,           // 账号之间间隔(显得像不同人)
  dry_run: false
};

(function () {
  var a = typeof $argument !== "undefined" ? $argument : null;
  if (a && typeof a === "object" && a !== null) {
    if (a.enabled === false) CFG.enabled = false;
    if (a.accounts) CFG.accounts = typeof a.accounts === "string" ? a.accounts : JSON.stringify(a.accounts);
    if (a.crew_code !== undefined && a.crew_code !== null) CFG.crew_code = String(a.crew_code);
    if (a.earn) CFG.earn = String(a.earn);
    if (a.help_count) CFG.help_count = Number(a.help_count) || 6;
    if (a.earn_count) CFG.earn_count = Number(a.earn_count) || 10;
    if (a.pace_ms) CFG.pace_ms = Number(a.pace_ms) || 12000;
    if (a.dry_run) CFG.dry_run = true;
  } else if (a && typeof a === "string" && a) {
    try {
      var o = JSON.parse(a);
      if (o.enabled === false) CFG.enabled = false;
      if (o.accounts) CFG.accounts = JSON.stringify(o.accounts);
      if (o.crew_code) CFG.crew_code = o.crew_code;
      if (o.earn) CFG.earn = o.earn;
      if (o.help_count) CFG.help_count = o.help_count;
      if (o.earn_count) CFG.earn_count = o.earn_count;
      if (o.pace_ms) CFG.pace_ms = o.pace_ms;
      if (o.dry_run) CFG.dry_run = true;
    } catch (e) { console.log("argument parse: " + e); }
  }
})();

var BASE = "https://huzhuji.com";
var DEFAULT_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 27_2 like Mac OS X; zh-cn) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Quark/10.16.5.3177 Mobile";

// ---------- 小工具 ----------
function uuid4() {
  var hex = "0123456789abcdef", s = "", i;
  for (i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) s += "-";
    else if (i === 14) s += "4";
    else if (i === 19) s += hex[(Math.floor(Math.random() * 16) & 0x3) | 0x8];
    else s += hex[Math.floor(Math.random() * 16)];
  }
  return s;
}
function randHex(n) {
  var hex = "0123456789abcdef", s = "";
  for (var i = 0; i < n; i++) s += hex[Math.floor(Math.random() * 16)];
  return s;
}
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function todayStr() {
  var d = new Date();
  // 站点按北京时间(UTC+8)0点重置
  d.setUTCHours(d.getUTCHours() + 8);
  return d.toISOString().slice(0, 10);
}
function jstr(body) { // body 可能是字符串或 Uint8Array
  var s = typeof body === "string" ? body : (body ? String.fromCharCode.apply(null, body) : "");
  return s;
}
function jparse(s) { try { return JSON.parse(s); } catch (e) { return null; } }

// 容错解析账号 JSON: 严格 JSON → 全量引号/全角清洗 → 正则抽取(任何引号都行)
var ACCOUNT_QCHARS = "'\"\u201C\u201D\u2018\u2019\uFF02";
function parseAccounts(raw) {
  if (raw === undefined || raw === null) return [];
  var s0 = String(raw).trim();
  if (!s0 || s0 === "[]") return [];
  var a = jparse(s0);
  if (Array.isArray(a)) return a;
  if (typeof a === "string") { a = jparse(a); if (Array.isArray(a)) return a; }
  var clean = s0
    .replace(/[\u201C\u201D\u201E\u201F\uFF02\u00AB\u00BB\u2033\u2034\u2039\u203A\u02BB\u02BC\u02BA]/g, '"')
    .replace(/[\u2018\u2019\uFF07]/g, "'")
    .replace(/\uFF1A/g, ':')
    .replace(/\uFF0C/g, ',')
    .replace(/\uFF5B/g, '[').replace(/\uFF5D/g, ']')
    .replace(/\uFF5C/g, '\\')
    .replace(/[\u200B\u200C\u200D\uFEFF\u3000\u00A0]/g, ' ')
    .replace(/\s+/g, ' ');
  var b = jparse(clean);
  if (Array.isArray(b)) { console.log("[diag] accounts 经引号清洗后解析成功"); return b; }
  var blocks = clean.match(/\{[^{}]*\}/g);
  if (blocks) {
    var out = [], Q = "[" + ACCOUNT_QCHARS + "]";
    var pairRe = new RegExp(Q + "([A-Za-z_][\\w-]*)" + Q + "\\s*:\\s*" + Q + "([^" + ACCOUNT_QCHARS + "]*)" + Q, "g");
    for (var bi = 0; bi < blocks.length; bi++) {
      var obj = {}, pm;
      pairRe.lastIndex = 0;
      while ((pm = pairRe.exec(blocks[bi])) !== null) obj[pm[1]] = pm[2];
      if (Object.keys(obj).length) out.push(obj);
    }
    if (out.length) { console.log("[diag] accounts 经正则抽取解析成功 " + out.length + " 个"); return out; }
  }
  console.log("[diag] accounts 无法解析, 原始=" + s0.slice(0, 60));
  return [];
}
function accountsDiag(raw) {
  var raws = String(raw || "");
  var cps = [];
  for (var i = 0; i < raws.length; i++) {
    var cp = raws.charCodeAt(i);
    if (cp > 127 || cp < 33) cps.push("U+" + cp.toString(16).toUpperCase());
  }
  var uniq = cps.filter(function (v, i2) { return cps.indexOf(v) === i2; }).slice(0, 12).join(" ");
  return raws.length + " 码点: " + (uniq || "(纯ASCII)");
}


// ---------- 设备身份 (模拟不同环境: 每账号稳定指纹, 每 run 新 sampleId) ----------
function getDevice(acct) {
  var key = "hzj_dev_" + (acct.n || "anon");
  var saved = jparse($persistentStore.read(key));
  if (!saved || !saved.installId) {
    saved = {
      installId: uuid4(),
      parts: {
        hardware: randHex(64), screen: randHex(64), locale: randHex(64),
        browser: randHex(64), capabilities: randHex(64), webgl: randHex(64), fonts: randHex(64)
      }
    };
    $persistentStore.write(JSON.stringify(saved), key);
  }
  var sampleId = uuid4();
  var ua = acct.ua || DEFAULT_UA;
  var parts = {
    version: 3,
    parts: saved.parts,
    details: { os: "iOS", platform: "iPhone", browserFamily: "Quark", browserVersion: "10.16.5.3177", threads: 4, touchPoints: 5, screenWidth: 393, screenHeight: 852, pixelRatio: 3, colorDepth: 24, timezone: "Asia/Shanghai", languages: "zh-CN", sampleId: sampleId },
    sampleId: sampleId
  };
  var access = {
    version: 1, sampleId: uuid4(), ua: ua, platform: "iPhone", touchPoints: 5, pointerCoarse: true,
    worker: { status: "ok", platform: "iPhone" }, gpu: { status: "ok", renderer: "Apple GPU" },
    observation: { screenWidth: 393, screenHeight: 852, pixelRatio: 3, innerWidth: 393, innerHeight: 694, hover: false, anyPointerFine: false, threads: 4 }
  };
  return {
    "x-device-install-id": saved.installId,
    "x-device-fingerprint": "v1:" + randHex(64),
    "x-device-access": JSON.stringify(access),
    "x-device-fingerprint-parts": JSON.stringify(parts),
    "x-client-app": "web",
    "x-client-protocol": "2"
  };
}

// ---------- WAF 回退 (纯JS解算 acw_sc__v2, 仅当 /api 返回挑战页时用) ----------
function hzjWafSolve(html) {
  if (typeof html !== "string" || html.indexOf("var arg1=") === -1) return null;
  function m1(re) { var m = String(html).match(re); return m ? m[1] : null; }
  var arg1 = m1(/var arg1='([0-9A-Fa-f]+)'/); if (!arg1) return null;
  var Nraw = m1(/var N=\[([^\]]+)\]/); if (!Nraw) return null;
  var N = Nraw.split(',').map(function (s) { return s.trim().replace(/^['"]|['"]$/g, ''); }).filter(Boolean);
  var cHex = m1(/\(a0i,0x([0-9a-fA-F]+)\)/); if (!cHex) return null;
  var c = parseInt(cHex, 16);
  var B64 = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/=';
  var T = {}; for (var i = 0; i < 64; i++) T[B64.charAt(i)] = i;
  function b64dec(s) {
    s = String(s).replace(/=+$/g, '');
    var out = [], c1, c2, c3, c4;
    for (var x = 0; x < s.length; x += 4) {
      c1 = T[s.charAt(x)]; c2 = T[s.charAt(x + 1)]; c3 = T[s.charAt(x + 2)]; c4 = T[s.charAt(x + 3)];
      if (c1 === undefined || c2 === undefined) break;
      out.push((c1 << 2) | (c2 >> 4));
      if (c3 !== undefined) out.push(((c2 & 15) << 4) | (c3 >> 2));
      if (c4 !== undefined) out.push(((c3 & 3) << 6) | c4);
    }
    var str = ''; for (var y = 0; y < out.length; y++) str += String.fromCharCode(out[y]);
    return str;
  }
  function jsparseInt(s) {
    s = String(s).trim();
    var i = 0; if (s.charAt(0) === '+' || s.charAt(0) === '-') i = 1;
    var j = i; while (j < s.length && s.charAt(j) >= '0' && s.charAt(j) <= '9') j++;
    if (j === i) return NaN;
    return parseInt(s.slice(0, j), 10);
  }
  function makeG(arr) { return function (off) { try { return b64dec(arr[off - 0xfb]); } catch (e) { return NaN; } }; }
  function checksum(arr) {
    var g = makeG(arr);
    var e =
      (-jsparseInt(g(0x117)) / 0x1 * (jsparseInt(g(0x111)) / 0x2))
      + (-jsparseInt(g(0xfb)) / 0x3 * (jsparseInt(g(0x10e)) / 0x4))
      + (-jsparseInt(g(0x101)) / 0x5 * (-jsparseInt(g(0xfd)) / 0x6))
      + (-jsparseInt(g(0x102)) / 0x7 * (jsparseInt(g(0x122)) / 0x8))
      + (jsparseInt(g(0x112)) / 0x9)
      + (jsparseInt(g(0x11d)) / 0xa * (jsparseInt(g(0x11c)) / 0xb))
      + (jsparseInt(g(0x114)) / 0xc);
    if (isNaN(e)) return false;
    return Math.abs(e - c) < 1e-9;
  }
  var arr = N.slice();
  for (var k = 0; k <= arr.length; k++) { if (checksum(arr)) break; arr.push(arr.shift()); }
  if (!checksum(arr)) return null;
  var p = b64dec(arr[0x115 - 0xfb]);
  var mArrRaw = m1(/var m=\[([^\]]+)\],p=/); if (!mArrRaw) return null;
  var perm = mArrRaw.split(',').map(function (x) { return parseInt(x, 0); });
  var q = [];
  for (var x = 0; x < arg1.length; x++) for (var z = 0; z < perm.length; z++) if (perm[z] === x + 1) q[z] = arg1.charAt(x);
  var u = q.join(''), v = '';
  for (x = 0; x < u.length && x < p.length; x += 2) {
    var A = (parseInt(u.substr(x, 2), 16) ^ parseInt(p.substr(x, 2), 16)).toString(16);
    if (A.length === 1) A = '0' + A;
    v += A;
  }
  return v;
}

// ---------- HTTP ----------
function http(method, url, headers, bodyStr, node) {
  return new Promise(function (resolve, reject) {
    var o = { url: url, headers: headers || {}, timeout: 30000, "auto-cookie": false, insecure: true };
    if (node) o.node = node; // 指定 DIRECT / 节点名 / 策略组 → 不同账号走不同出口IP
    if (bodyStr !== null && bodyStr !== undefined) { o.body = bodyStr; }
    var fn = method.toLowerCase() === "get" ? $httpClient.get : $httpClient.post;
    fn(o, function (error, response, data) {
      if (error) return reject(new Error(error));
      resolve({ status: response ? response.status : 0, headers: (response && response.headers) || {}, body: jstr(data) });
    });
  });
}

function normAid(c) {
  if (!c) return "";
  c = String(c).trim();
  if (c.indexOf("aid=") === 0) c = c.slice(4);
  // 兼容粘贴整串 cookie "aid=...; _c_WBKFRo=..." → 只取 aid
  var m = c.match(/aid=([^;\s]+)/);
  if (m) c = m[1];
  return c;
}

// 每账号 API 会话 (cookie 可变: 自动创建账号后更新; 设备头可刷新)
function makeSession(acct) {
  var sess = {
    cookie: "", acw: "", csrf: "", identity: null, channels: null, dev: null,
    headers: function () {
      var h = {
        "user-agent": acct.ua || DEFAULT_UA,
        "accept": "application/json",
        "accept-language": "zh-Hans-CN;q=1, en-CN;q=0.9, zh-Hant-HK;q=0.8",
        "origin": BASE, "referer": BASE + "/",
        "sec-fetch-dest": "empty", "sec-fetch-site": "same-origin", "sec-fetch-mode": "cors",
        "content-type": "application/json"
      };
      var ck = [];
      if (sess.acw) ck.push("acw_sc__v2=" + sess.acw);
      if (sess.cookie) ck.push("aid=" + sess.cookie);
      if (ck.length) h["cookie"] = ck.join("; ");
      for (var k in sess.dev) h[k] = sess.dev[k];
      if (sess.csrf) h["x-csrf-token"] = sess.csrf;
      return h;
    }
  };
  sess.dev = getDevice(acct);
  sess.acct = acct;
  sess.aidKey = "hzj_aid_" + (acct.n || "anon");
  sess.init = async function () {
    sess.cookie = normAid(acct.c || "");
    if (!sess.cookie) { // 自动开号: 复用持久化的 aid
      var savedAid = $persistentStore.read(sess.aidKey);
      if (savedAid) { sess.cookie = normAid(savedAid); console.log("[" + (acct.n || "anon") + "] 复用已存 aid"); }
    }
    // 先取身份 (无 aid 时服务端自动签发新身份 → 记录 Set-Cookie)
    var r = await http("GET", BASE + "/api/identity/context", sess.headers(), null, acct.node);
    captureSetCookie(sess, r);
    if (r.status === 401 || (jparse(r.body) || {}).code === "SESSION_INVALID") {
      // 存的 aid 失效(过期/被清) → 清掉, 无 cookie 重试(服务端会签发新身份)
      if (!acct.c) {
        console.log("[" + (acct.n || "anon") + "] 已存 aid 失效, 重开新号");
        $persistentStore.write(undefined, sess.aidKey);
      }
      sess.cookie = "";
      r = await http("GET", BASE + "/api/identity/context", sess.headers(), null, acct.node);
      captureSetCookie(sess, r);
    }
    var j = jparse(r.body);
    if (j && j.data) {
      sess.csrf = j.data.csrfToken || "";
      sess.identity = j.data.identity;
    } else if (r.body.indexOf("var arg1=") > -1) {
      sess.acw = hzjWafSolve(r.body) || sess.acw;
      r = await http("GET", BASE + "/api/identity/context", sess.headers(), null, acct.node);
      captureSetCookie(sess, r);
      var j2 = jparse(r.body);
      if (j2 && j2.data) { sess.csrf = j2.data.csrfToken || ""; sess.identity = j2.data.identity; }
    }
    if (!sess.identity) throw new Error("identity/context failed: " + r.body.slice(0, 120));
    return sess.identity;
  };
  // 核心请求: 429 重试 + WAF 回退 + 设备头刷新
  sess.api = async function (method, path, body) {
    var last = null;
    for (var attempt = 0; attempt < 4; attempt++) {
      var bodyStr = body ? JSON.stringify(body) : null;
      var r = await http(method, BASE + path, sess.headers(), bodyStr, acct.node);
      captureSetCookie(sess, r);
      if (r.body.indexOf("var arg1=") > -1) {
        var v = hzjWafSolve(r.body);
        if (v) { sess.acw = v; attempt--; continue; }
      }
      last = r;
      var j = jparse(r.body) || {};
      if (r.status === 429) {
        var wait = Number(j.retryAfterSeconds || 10) * 1000 + 1500;
        console.log("[429] " + path + " wait " + Math.round(wait / 1000) + "s");
        await sleep(wait);
        continue;
      }
      if (r.status === 403 && j.code === "E1005") { // 设备初始化失败(偶发) → 换设备指纹重试
        sess.dev = getDevice(acct);
        continue;
      }
      return { status: r.status, json: jparse(r.body), raw: r.body };
    }
    return { status: last ? last.status : 0, json: jparse(last ? last.body : ""), raw: last ? last.body : "" };
  };
  return sess;
}
function captureSetCookie(sess, r) {
  var sc = r.headers["set-cookie"] || r.headers["Set-Cookie"] || "";
  if (Array.isArray(sc)) sc = sc.join("; ");
  if (!sc) return;
  var m = String(sc).match(/aid=([^;]+)/);
  if (m && normAid(m[1])) {
    sess.cookie = m[1]; // 记下(可能是自动创建的新身份)
    if (!sess.acct.c) $persistentStore.write(m[1], sess.aidKey); // 自动号 → 持久化, 下次运行复用
  }
}


// ---------- 业务: 取某频道可助力的邀请 ----------
async function eligibleInvites(sess, channelSlug, limit) {
  var r = await sess.api("GET", "/api/invites?limit=" + (limit || 30) + "&channelSlug=" + channelSlug, null);
  if (r.status !== 200 || !r.json || !r.json.data) {
    return { ok: false, error: "invites list failed: " + r.status + " " + (r.json && r.json.message || "") };
  }
  var items = r.json.data.filter(function (it) {
    return it.status === "ACTIVE" && it.helpCount < it.maxHelpCount &&
      !it.pairUsedToday && !it.withdrawnByMe && !it.ownerLinkedToMe && !it.reportedByMe;
  });
  return { ok: true, items: items };
}

async function channelInfo(sess, slug) {
  if (sess.channels) {
    var hit = sess.channels.find(function (c) { return c.slug === slug; });
    if (hit) return hit;
  }
  var r = await sess.api("GET", "/api/channels", null);
  if (r.status === 200 && r.json && r.json.data) {
    sess.channels = r.json.data;
    return sess.channels.find(function (c) { return c.slug === slug; });
  }
  return null;
}

// 助力 N 条指定频道邀请; 返回 {done, points}
async function doHelp(sess, slug, count, log, ch) {
  var helped = 0, pts = 0;
  if (count <= 0) return { done: helped, points: pts };
  var el = await eligibleInvites(sess, slug, Math.max(30, count * 4));
  if (!el.ok) { log.push(slug + ": " + el.error); return { done: helped, points: pts }; }
  var target = Math.min(count, el.items.length);
  if (el.items.length === 0) log.push(slug + ": 无可助力邀请(列表空或今日已刷完)");
  var helperPoints = ch && ch.helperPoints ? ch.helperPoints : 10;
  for (var i = 0; i < target; i++) {
    var it = el.items[i];
    if (CFG.dry_run) { log.push("[dry] 助力 " + slug + " " + it.maskedCode + " (" + it.helpCount + "/" + it.maxHelpCount + ")"); }
    else {
      var r = await sess.api("POST", "/api/invites/" + it.id + "/help", {});
      if (r.status === 201 || r.status === 200) {
        helped++;
        pts += helperPoints;
        log.push("助力 " + it.maskedCode + " → 成功");
      } else {
        log.push("助力失败 " + it.maskedCode + ": " + r.status + " " + ((r.json && (r.json.message || r.json.code)) || r.raw.slice(0, 80)));
        if (r.status === 403 || r.status === 400) break; // 额度/权限问题, 不再尝试
      }
      await sleep(CFG.pace_ms + Math.floor(Math.random() * 4000));
    }
  }
  return { done: helped, points: pts };
}

// 动态解析"车队互助"频道 (11-04 起 slug jdj-crew→jdj-teamhelp; 站点可能再改 → 名称/slug 双特征匹配)
async function findCrewChannel(sess, fresh) {
  if (!fresh && sess.channels && sess.channels.length) {
    var hit0 = matchCrew(sess.channels);
    if (hit0) return hit0;
  }
  var r = await sess.api("GET", "/api/channels", null);
  if (!(r.status === 200 && r.json && r.json.data)) return null;
  var list = r.json.data;
  if (!fresh) sess.channels = list;
  return matchCrew(list);
}
function matchCrew(list) {
  var byName = null, bySlug = null;
  for (var i = 0; i < list.length; i++) {
    var c = list[i];
    if (!byName && String(c.displayName || "").indexOf("车队互助") > -1) byName = c;
    if (!bySlug && /teamhelp|crew/i.test(c.slug || "")) bySlug = c;
  }
  return byName || bySlug || null;
}

// 发布口令 (仅当有被助力余额或可免费发布; 每次助力他人+1次被助力余额, 上限6, 0点失效)
async function doPublish(sess, code, log, crewCh, crewSlug) {
  if (!code || code.length < 2) { log.push("未配置口令 → 跳过发布"); return "NO_CODE"; }
  // 今日是否已发布 (防止重复)
  var sub = await sess.api("GET", "/api/me/submissions?limit=10&channelSlug=" + encodeURIComponent(crewSlug || "jdj-teamhelp"), null);
  if (sub.status === 200 && sub.json && sub.json.data) {
    var t = todayStr();
    var dup = sub.json.data.some(function (s) {
      return s.createdAt && s.createdAt.slice(0, 10) === t && !s.withdrawnByMe &&
        (s.status === "ACTIVE" || s.status === "COMPLETED");
    });
    if (dup) { log.push("今日已发布过车队口令 → 跳过"); return "ALREADY"; }
  }
  var rq = (crewCh && crewCh.receiveQuota) || {};
  var slots = Math.max(0, rq.remaining || 0, rq.earnedRemaining || 0);
  var freePub = !!rq.freePublishAvailable;
  if (slots <= 0 && !freePub) {
    log.push("无被助力名额(remaining=" + (rq.remaining || 0) + ", earnedRemaining=" + (rq.earnedRemaining || 0) + ", 免费发布=" + (rq.freePublishAvailable ? "是" : "否") + ") → 跳过发布");
    return "NO_QUOTA";
  }
  if (CFG.dry_run) { log.push("[dry] 发布口令 " + code.slice(0, 40) + "… (" + slots + " 余额" + (freePub ? "+免费发布" : "") + ")"); return "DRY"; }
  var r = await sess.api("POST", "/api/invites", { channelSlug: crewSlug || "jdj-teamhelp", code: code });
  if (r.status === 201 || r.status === 200) {
    log.push("发布成功" + (r.json && r.json.data && r.json.data.id ? " id=" + String(r.json.data.id).slice(0, 8) : ""));
    return "OK";
  }
  // 服务端每日独占规则: 同一淘宝账号的口令每天只能由一个本站账号"认领"发布(最先发的那个), 其余账号当天 409
  if (r.status === 409 && r.json && r.json.code === "TAOBAO_PUBLISHER_CLAIMED_TODAY") {
    log.push("发布: 今日该淘宝口令已被其他站点账号先发布(原账号独占, 服务端规则不可绕过)。今日无需再发; 明天换新口令后让本账号先手发布即可");
    return "CLAIMED";
  }
  log.push("发布失败: " + r.status + " " + ((r.json && (r.json.message || r.json.code)) || r.raw.slice(0, 100)));
  return "FAIL";
}

// ---------- 单账号全流程 ----------
async function runAccount(acct) {
  var log = [];
  var sess = makeSession(acct);
  var identity;
  try { identity = await sess.init(); } catch (e) { log.push("初始化失败: " + e.message); return { n: acct.n, log: log, error: true }; }
  var nick = identity.nickname || "anon", pts = identity.pointsBalance || 0;
  if (identity.status !== "ACTIVE") {
    log.push("身份状态 " + identity.status + (identity.banUntil ? " (封禁至 " + identity.banUntil + ")" : "") + " → 跳过");
    return { n: nick, log: log, points: pts };
  }
  log.push(nick + " · 积分 " + pts + (identity.level ? " · " + identity.level.name : ""));

  // 车队频道准入: 服务端 403 CREW_ACCESS_DENIED "仅供Lv.2级以上或正式用户使用"
  // 11-04 起 access 端点已下线, 频道 slug 改为 jdj-teamhelp → 以 identity 积分≥200(Lv.2) 为门禁
  var allowed = pts >= 200;

  if (allowed) {
    // ===== 车队模式: 助力 + 发布 (频道 slug 动态解析, 防站点再改名) =====
    var crewCh = await findCrewChannel(sess);
    if (!crewCh) {
      log.push("车队互助频道未在开放列表 → 本次跳过车队助力/发布");
    } else {
      var crewSlug = crewCh.slug;
      console.log("[" + nick + "] 车队频道: " + crewSlug + " (" + crewCh.displayName + ", 额度剩 " + (crewCh.quota ? crewCh.quota.remaining : "?") + ")");
      var helpRem = crewCh.quota ? (crewCh.quota.remaining || 0) : CFG.help_count;
      var wantHelp = Math.min(CFG.help_count, helpRem);
      if (wantHelp > 0) {
        var h = await doHelp(sess, crewSlug, wantHelp, log, crewCh);
        log.push("车队助力 " + h.done + "/" + wantHelp + " 次" + (CFG.dry_run ? " (dry)" : ", 约+" + h.points + " 分"));
        if (h.done > 0 && !CFG.dry_run) {
          // 每次助力赚 1 次被助力余额 → 刷新频道信息, 发布判定用最新状态
          sess.channels = null;
          var crewCh2 = await findCrewChannel(sess, true);
          if (crewCh2) { crewSlug = crewCh2.slug; crewCh = crewCh2; }
        }
      } else {
        log.push("今日车队助力额度已用完(" + (crewCh.quota ? (crewCh.quota.used || 0) + "/" + (crewCh.quota.limit || 6) : "6/6") + ", 之前已助满) → 仅做发布");
      }
      var code = acct.code || CFG.crew_code || "";
      await doPublish(sess, code, log, crewCh, crewSlug);
    }
  } else {
    // ===== 攒分模式: 开放频道助力 → 冲 Lv.2 (200分) =====
    var left = CFG.earn_count;
    var earned = 0;
    var chs = String(CFG.earn).split(",").map(function (s) { return s.trim(); }).filter(Boolean);
    for (var i = 0; i < chs.length && left > 0; i++) {
      var ch = await channelInfo(sess, chs[i]);
      if (!ch) { log.push(chs[i] + ": 频道不可用"); continue; }
      var rem = ch.quota ? ch.quota.remaining : 0;
      var n2 = Math.min(left, rem, CFG.earn_count);
      if (n2 <= 0) { log.push(chs[i] + ": 今日助力额度已用完"); continue; }
      var h2 = await doHelp(sess, chs[i], n2, log, ch);
      earned += h2.points;
      left -= h2.done;
      if (!CFG.dry_run) await sleep(15000); // 频道之间多停一下
    }
    var after = pts + earned;
    log.push("攒分模式: 本单 +" + earned + " 分 (现约 " + after + ")" + (after >= 200 ? " → 达 Lv.2, 下次自动进车队模式" : ""));
  }
  return { n: nick, log: log, points: pts };
}

// ---------- 主入口 ----------
(async function main() {
  if (!CFG.enabled) { console.log("disabled"); $done(); return; }
  var accounts = parseAccounts(CFG.accounts);
  var argObj = (typeof $argument === "object" && $argument) ? $argument : null;
  var argDebug = argObj ? ("$argument.accounts 类型=" + (typeof argObj.accounts) + " 长度=" + String(argObj.accounts || "").length) : ("$argument 非对象: " + typeof $argument);
  console.log("[diag] " + argDebug + " 解析出账号数=" + accounts.length);
  if (!accounts.length) {
    $notification.post("互助集·车队", "未配置账号", "诊断: " + argDebug + "\n实际收到: " + String(CFG.accounts || "(空)") + "\n" + accountsDiag(CFG.accounts) + "\n请确认参数已点✓保存且 JSON 完整");
    $done({ error: "no accounts", diag: argDebug + " " + String(CFG.accounts) + " " + accountsDiag(CFG.accounts) });
    return;
  }
  var results = [];
  for (var i = 0; i < accounts.length; i++) {
    var acct = accounts[i];
    if (!acct || (!acct.n && !acct.c)) continue;
    acct.n = acct.n || ("acct" + (i + 1));
    console.log("=== 账号 " + acct.n + " (dry_run=" + CFG.dry_run + ", node=" + (acct.node || "当前路由") + ") ===");
    var res = await runAccount(acct);
    res.node = acct.node || "";
    results.push(res);
    if (i < accounts.length - 1) await sleep(CFG.gap_ms + Math.floor(Math.random() * 15000));
  }
  var lines = results.map(function (r) {
    return "【" + (r.n || "?") + (r.error ? " · 错误" : "") + "】\n" + (r.log || []).join("\n");
  });
  var summary = "互助集·车队 " + new Date().toLocaleString() + (CFG.dry_run ? " (dry-run)" : "") + "\n" + lines.join("\n——\n");
  console.log(summary);
  $persistentStore.write(summary, "hzj_last_run");
  $notification.post("互助集·车队助力", CFG.dry_run ? "(dry-run)" : "完成", lines.join("\n"));
  $done({ results: results });
})();
