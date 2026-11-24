'use strict';
/*
 * IPTV Premium Player - servidor
 * Serve o site (pasta public/) e faz a ponte (/p?u=URL) com o servidor IPTV,
 * assim o navegador do cliente não sofre bloqueio de CORS nem de HTTP/HTTPS.
 * Sem dependências: só Node 18+.
 *
 * Variáveis de ambiente:
 *   PORT            porta (padrão 3000)
 *   ALLOWED_HOSTS   (recomendado) hosts IPTV permitidos, separados por vírgula
 *                   ex: ALLOWED_HOSTS=meuservidor.com,painel.meuservidor.com
 *   ALLOW_PRIVATE   1 = permite IPs internos (só para testes)
 */
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const dns = require('dns');
const net = require('net');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;
const ALLOWED = (process.env.ALLOWED_HOSTS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
const ALLOW_PRIVATE = process.env.ALLOW_PRIVATE === '1';
const PUB = path.join(__dirname, 'public');
let _sv = { t: 0, hosts: [] };
// hosts dos servidores listados em public/servers.json (recarrega a cada 10 s)
function allowedHosts() {
  if (Date.now() - _sv.t > 10000) {
    _sv.t = Date.now();
    try {
      const j = JSON.parse(fs.readFileSync(path.join(PUB, 'servers.json'), 'utf8'));
      _sv.hosts = (j.servers || []).map(x => { try { return new URL(/^https?:\/\//.test(x.url) ? x.url : 'http://' + x.url).hostname.toLowerCase(); } catch { return null; } }).filter(Boolean);
    } catch { _sv.hosts = []; }
  }
  return ALLOWED.concat(_sv.hosts);
}
const UA = 'VLC/3.0.20 LibVLC/3.0.20';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };

function isPrivateIp(ip) {
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase();
    if (l === '::1' || l === '::' || l.startsWith('fc') || l.startsWith('fd') || l.startsWith('fe80')) return true;
    const m = l.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return m ? isPrivateIp(m[1]) : false;
  }
  const [a, b] = ip.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

// resolve o DNS e bloqueia IPs internos (evita uso do servidor para atacar a rede interna)
function safeLookup(hostname, opts, cb) {
  dns.lookup(hostname, { all: true }, (err, addrs) => {
    if (err) return cb(err);
    const ok = addrs.filter(a => ALLOW_PRIVATE || !isPrivateIp(a.address));
    if (!ok.length) return cb(new Error('blocked-private'));
    if (opts && opts.all) return cb(null, ok);
    cb(null, ok[0].address, ok[0].family);
  });
}

function sendErr(res, code, msg) {
  if (res.headersSent) return res.destroy();
  res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  res.end(msg);
}

function rewriteM3u8(text, base) {
  const wrap = u => { try { return '/p?u=' + encodeURIComponent(new URL(u, base).href); } catch { return u; } };
  return text.split(/\r?\n/).map(l => {
    const t = l.trim();
    if (!t) return l;
    if (t.startsWith('#')) return l.replace(/URI="([^"]+)"/g, (_, u) => 'URI="' + wrap(u) + '"');
    return wrap(t);
  }).join('\n');
}

function upstream(target, req, res, hops) {
  let u;
  try { u = new URL(target); } catch { return sendErr(res, 400, 'URL inválida'); }
  if (!/^https?:$/.test(u.protocol)) return sendErr(res, 400, 'Protocolo não permitido');
  const host = u.hostname.toLowerCase();
  const AL = allowedHosts();
  if (AL.length && !AL.includes(host)) return sendErr(res, 403, 'Servidor não permitido');

  const bare = host.replace(/^\[|\]$/g, '');
  if (net.isIP(bare) && !ALLOW_PRIVATE && isPrivateIp(bare)) return sendErr(res, 403, 'Endereço não permitido');

  const headers = { 'User-Agent': UA, Accept: '*/*', Connection: 'close' };
  if (req.headers.range) headers.Range = req.headers.range;
  if (/player_api\.php|xmltv\.php|get\.php/.test(u.pathname)) headers['Accept-Encoding'] = 'gzip';

  const lib = u.protocol === 'https:' ? https : http;
  const opts = { method: 'GET', headers, lookup: safeLookup, timeout: 20000 };
  if (u.protocol === 'https:') opts.rejectUnauthorized = false; // painéis IPTV costumam ter certificado inválido
  const up = lib.request(u, opts, r => {
    // redireciona (comum em painéis Xtream com token)
    if ([301, 302, 303, 307, 308].includes(r.statusCode) && r.headers.location) {
      r.resume();
      if (hops >= 6) return sendErr(res, 508, 'Redirecionamentos demais');
      return upstream(new URL(r.headers.location, u).href, req, res, hops + 1);
    }
    const ct = String(r.headers['content-type'] || '');
    const isPl = /\.m3u8?$/i.test(u.pathname) && !/\bget\.php\b/.test(u.pathname) || /mpegurl/i.test(ct);
    const out = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'Content-Length,Content-Range', 'Cache-Control': /^image\//i.test(ct) ? 'public, max-age=86400' : 'no-store' };
    for (const h of ['content-type', 'content-range', 'accept-ranges', 'content-encoding']) if (r.headers[h]) out[h] = r.headers[h];

    if (isPl && !r.headers['content-encoding']) {
      const chunks = []; let size = 0;
      r.on('data', c => { size += c.length; if (size > 8e6) { up.destroy(); } else chunks.push(c); });
      r.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        if (!body.trimStart().startsWith('#EXTM3U')) { res.writeHead(r.statusCode, { ...out }); return res.end(body); }
        const txt = rewriteM3u8(body, u.href);
        out['content-type'] = 'application/vnd.apple.mpegurl';
        res.writeHead(r.statusCode, out); res.end(txt);
      });
      r.on('error', () => sendErr(res, 502, 'Falha ao ler a lista'));
      return;
    }
    if (r.headers['content-length']) out['content-length'] = r.headers['content-length'];
    res.writeHead(r.statusCode, out);
    r.pipe(res);
    r.on('error', () => res.destroy());
  });
  up.on('timeout', () => up.destroy(new Error('timeout')));
  up.on('error', e => sendErr(res, e.message === 'blocked-private' ? 403 : 502, e.message === 'blocked-private' ? 'Endereço não permitido' : 'Não foi possível conectar ao servidor IPTV'));
  res.on('close', () => up.destroy());
  up.end();
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/healthz') { res.writeHead(200); return res.end('ok'); }

  if (url.pathname === '/p') {
    if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Range', 'Access-Control-Allow-Methods': 'GET' }); return res.end(); }
    // só o próprio site pode usar a ponte (impede outros sites de usar seu servidor)
    const o = req.headers.origin;
    if (o) { try { if (new URL(o).host !== req.headers.host) return sendErr(res, 403, 'Origem não permitida'); } catch { return sendErr(res, 403, 'Origem inválida'); } }
    const t = url.searchParams.get('u');
    if (!t) return sendErr(res, 400, 'Falta o parâmetro u');
    return upstream(t, req, res, 0);
  }

  // arquivos estáticos
  let f = path.normalize(path.join(PUB, decodeURIComponent(url.pathname)));
  if (!f.startsWith(PUB)) { res.writeHead(403); return res.end(); }
  if (url.pathname.endsWith('/')) f = path.join(f, 'index.html');
  fs.stat(f, (e, st) => {
    if (e || !st.isFile()) f = path.join(PUB, 'index.html');
    fs.readFile(f, (e2, data) => {
      if (e2) { res.writeHead(404); return res.end('Não encontrado'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': /\.(html|webmanifest)$|sw\.js$|servers\.json$/.test(f) ? 'no-cache' : 'public, max-age=86400' });
      res.end(data);
    });
  });
}).listen(PORT, () => console.log('IPTV Premium Player em http://localhost:' + PORT + (allowedHosts().length ? ' (hosts: ' + allowedHosts().join(',') + ')' : ' (ATENÇÃO: defina servers.json ou ALLOWED_HOSTS)')));
