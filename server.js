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
 *   FFMPEG          caminho do ffmpeg (padrão: ffmpeg). Usado para converter filmes MKV/AVI/HEVC.
 *   MAX_TRANSCODES  conversões simultâneas (padrão 2)
 */
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const dns = require('dns');
const net = require('net');
const { URL } = require('url');
const { spawn, spawnSync } = require('child_process');

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


/* ---------- conversão de filmes (ffmpeg) ---------- */
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const MAX_TC = Math.max(1, parseInt(process.env.MAX_TRANSCODES || '2', 10) || 2);
const HAS_FFMPEG = (() => { try { return spawnSync(FFMPEG, ['-version'], { timeout: 5000 }).status === 0; } catch { return false; } })();
let tcActive = 0;
const infoCache = new Map();
// o ffmpeg lê o filme pela própria ponte (/p), então herda todas as proteções (hosts permitidos, IP privado, Range)
const localUrl = t => 'http://127.0.0.1:' + PORT + '/p?u=' + encodeURIComponent(t);
function checkTarget(t) {
  let u; try { u = new URL(t); } catch { return 'URL inválida'; }
  if (!/^https?:$/.test(u.protocol)) return 'Protocolo não permitido';
  const AL = allowedHosts();
  if (AL.length && !AL.includes(u.hostname.toLowerCase())) return 'Servidor não permitido';
  return null;
}
function sameOrigin(req) {
  const o = req.headers.origin; if (!o) return true;
  try { return new URL(o).host === req.headers.host; } catch { return false; }
}
function probe(t) {
  const hit = infoCache.get(t);
  if (hit && Date.now() - hit.t < 600000) return Promise.resolve(hit.v);
  return new Promise((resolve, reject) => {
    const p = spawn(FFMPEG, ['-hide_banner', '-nostdin', '-i', localUrl(t)], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = ''; const kill = setTimeout(() => p.kill('SIGKILL'), 25000);
    p.stderr.on('data', d => { if (err.length < 60000) err += d; });
    p.on('error', reject);
    p.on('close', () => {
      clearTimeout(kill);
      const d = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(err);
      const vl = /Stream #\d+:\d+[^\n]*?: Video: ([a-z0-9_]+)[^\n]*/i.exec(err);
      const v = vl && [vl[0], vl[1], (/,\s*(yuv\w+|nv\d+|gbr\w+|p0\d+\w*|rgb\w+|gray\w*)/i.exec(vl[0]) || [])[1]];
      if (!v) return reject(new Error('sem vídeo'));
      const out = { dur: d ? (+d[1] * 3600 + +d[2] * 60 + +d[3]) : 0, vcodec: v[1].toLowerCase(), pix: (v[2] || '').toLowerCase() };
      infoCache.set(t, { t: Date.now(), v: out });
      resolve(out);
    });
  });
}
function handleTc(url, req, res) {
  if (!HAS_FFMPEG) return sendErr(res, 501, 'Conversão indisponível (ffmpeg não instalado no servidor)');
  if (!sameOrigin(req)) return sendErr(res, 403, 'Origem não permitida');
  const t = url.searchParams.get('u'); if (!t) return sendErr(res, 400, 'Falta o parâmetro u');
  const bad = checkTarget(t); if (bad) return sendErr(res, 403, bad);
  if (url.pathname === '/t/info') {
    return probe(t).then(v => { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(v)); })
      .catch(() => sendErr(res, 502, 'Não foi possível ler o arquivo de vídeo'));
  }
  if (tcActive >= MAX_TC) return sendErr(res, 429, 'Servidor ocupado convertendo outros filmes. Tente de novo em instantes.');
  const ss = Math.max(0, Math.floor(+url.searchParams.get('ss') || 0));
  tcActive++;
  probe(t).then(info => {
    if (res.destroyed || res.writableEnded) { tcActive--; return; }
    // copia o vídeo se já for H.264 8 bits (quase sem CPU); senão converte e limita a 720p
    const copy = info.vcodec === 'h264' && (!info.pix || info.pix === 'yuv420p' || info.pix === 'yuvj420p');
    const args = ['-hide_banner', '-loglevel', 'error', '-nostdin'];
    if (ss) args.push('-ss', String(ss));
    args.push('-i', localUrl(t), '-map', '0:v:0', '-map', '0:a:0?', '-sn', '-dn');
    if (copy) args.push('-c:v', 'copy');
    else args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-vf', "scale=-2:'min(720,ih)'");
    args.push('-c:a', 'aac', '-b:a', '160k', '-ac', '2', '-f', 'mp4', '-movflags', 'frag_keyframe+empty_moov+default_base_moof', 'pipe:1');
    const p = spawn(FFMPEG, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let done = false; const fin = () => { if (!done) { done = true; tcActive--; } };
    res.writeHead(200, { 'Content-Type': 'video/mp4', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
    p.stdout.pipe(res);
    p.stderr.on('data', d => console.log('[ffmpeg]', String(d).trim().slice(0, 200)));
    p.on('close', () => { fin(); res.end(); });
    p.on('error', () => { fin(); res.destroy(); });
    res.on('close', () => { p.kill('SIGKILL'); fin(); });
  }).catch(() => { tcActive--; sendErr(res, 502, 'Não foi possível ler o arquivo de vídeo'); });
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/healthz') { res.writeHead(200); return res.end('ok'); }

  if (url.pathname === '/t' || url.pathname === '/t/info') return handleTc(url, req, res);

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
}).listen(PORT, () => console.log('IPTV Premium Player em http://localhost:' + PORT + (allowedHosts().length ? ' (hosts: ' + allowedHosts().join(',') + ')' : ' (ATENÇÃO: defina servers.json ou ALLOWED_HOSTS)') + (HAS_FFMPEG ? ' • conversão de filmes: ativa' : ' • conversão de filmes: indisponível (sem ffmpeg)')));
