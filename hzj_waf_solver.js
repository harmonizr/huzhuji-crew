// Pure-JS Aliyun WAF acw_sc__v2 challenge solver (no eval, no atob, Loon-safe).
// Call hzjWafSolve(challengeHtml) -> acw_sc__v2 value or null.
function hzjWafSolve(html) {
  if (typeof html !== 'string' || html.indexOf('var arg1=') === -1) return null;
  function m1(re) { var m = String(html).match(re); return m ? m[1] : null; }

  var arg1 = m1(/var arg1='([0-9A-Fa-f]+)'/); if (!arg1) return null;
  var Nraw = m1(/var N=\[([^\]]+)\]/); if (!Nraw) return null;
  var N = Nraw.split(',').map(function (s) { return s.trim().replace(/^['"]|['"]$/g, ''); }).filter(Boolean);
  var cHex = m1(/\(a0i,0x([0-9a-fA-F]+)\)/); if (!cHex) return null;
  var c = parseInt(cHex, 16);

  // base64 decode to bytes -> latin1 string (values we use are ASCII)
  var B64 = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/=';
  var T = {};
  for (var i = 0; i < 64; i++) T[B64.charAt(i)] = i;
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
    var str = '';
    for (var y = 0; y < out.length; y++) str += String.fromCharCode(out[y]);
    return str;
  }

  function jsparseInt(s) { // JS parseInt default radix: leading decimal digits
    s = String(s).trim();
    var i = 0; if (s.charAt(0) === '+' || s.charAt(0) === '-') i = 1;
    var j = i;
    while (j < s.length && s.charAt(j) >= '0' && s.charAt(j) <= '9') j++;
    if (j === i) return NaN;
    return parseInt(s.slice(0, j), 10);
  }

  function makeG(arr) {
    return function (off) {
      try { return b64dec(arr[off - 0xfb]); } catch (e) { return NaN; }
    };
  }
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
  for (var k = 0; k <= arr.length; k++) {
    if (checksum(arr)) break;
    arr.push(arr.shift());
  }
  if (!checksum(arr)) return null;

  var p = b64dec(arr[0x115 - 0xfb]);
  var mArrRaw = m1(/var m=\[([^\]]+)\],p=/); if (!mArrRaw) return null;
  var perm = mArrRaw.split(',').map(function (x) { return parseInt(x, 0); });

  var q = [];
  for (var x = 0; x < arg1.length; x++) {
    for (var z = 0; z < perm.length; z++) if (perm[z] === x + 1) q[z] = arg1.charAt(x);
  }
  var u = q.join('');
  var v = '';
  for (x = 0; x < u.length && x < p.length; x += 2) {
    var A = (parseInt(u.substr(x, 2), 16) ^ parseInt(p.substr(x, 2), 16)).toString(16);
    if (A.length === 1) A = '0' + A;
    v += A;
  }
  return v;
}

if (typeof module !== "undefined" && module.exports) module.exports = { hzjWafSolve: hzjWafSolve };
