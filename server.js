const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');
const url   = require('url');

const PORT = process.env.PORT || 3000;

http.createServer((req, res) => {
  const parsed = url.parse(req.url);
  const p = parsed.pathname;

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Accept',
    });
    res.end();
    return;
  }

  // Proxy to arkivportalen.no
  if (p.startsWith('/api/arkivportalen')) {
    const targetPath = req.url.replace('/api/arkivportalen', '');

    // Collect body first
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      console.log(`[PROXY] ${req.method} ${targetPath} body=${body.length}b`);
      if (body.length) console.log(`[BODY]`, body.toString());

      const opts = {
        hostname: 'arkivportalen.no',
        port: 443,
        path: targetPath,
        method: req.method,
        rejectUnauthorized: false,
        headers: {
          'Host': 'arkivportalen.no',
          'Accept': 'application/json, */*',
          'Content-Type': 'application/json',
          'Referer': 'https://arkivportalen.no/',
          'Origin': 'https://arkivportalen.no',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        }
      };

      if (body.length) opts.headers['Content-Length'] = body.length;

      const proxyReq = https.request(opts, apiRes => {
        console.log(`[RESP] ${apiRes.statusCode}`);
        const respChunks = [];
        apiRes.on('data', c => respChunks.push(c));
        apiRes.on('end', () => {
          const respBody = Buffer.concat(respChunks);
          console.log(`[RESP BODY]`, respBody.toString().slice(0, 200));
          res.writeHead(apiRes.statusCode, {
            'Content-Type': apiRes.headers['content-type'] || 'application/json',
            'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Accept',
          });
          res.end(respBody);
        });
      });

      proxyReq.on('error', e => {
        console.error('[ERROR]', e.message);
        res.writeHead(502);
        res.end(JSON.stringify({ error: e.message }));
      });

      if (body.length) proxyReq.write(body);
      proxyReq.end();
    });
    return;
  }

  // Static files
  const pathname = p === '/' ? '/index.html' : p;
  const filePath = path.join(__dirname, pathname);
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const ext = path.extname(filePath);
    const mime = { '.html':'text/html; charset=utf-8', '.js':'application/javascript', '.css':'text/css' };
    res.writeHead(200, { 'Content-Type': mime[ext] || 'text/plain' });
    res.end(data);
  });

}).listen(PORT, () => console.log(`\n✅ Vestlandsarkivet → http://localhost:${PORT}\n`));
