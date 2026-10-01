// Local test server: serves the app and runs api/extract.js like Vercel does.
// Run:  node dev-server.js   then open http://localhost:3000
const http = require('http'), fs = require('fs'), path = require('path');
const root = __dirname;

// Load settings from .env.local (ANTHROPIC_API_KEY=..., optional MODEL=..., APP_PASSWORD=...)
try {
  fs.readFileSync(path.join(root, '.env.local'), 'utf8').split(/\r?\n/).forEach(l => {
    const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
} catch (e) {}

const handler = require('./api/extract.js');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const LIMIT = 4.5 * 1024 * 1024; // same request size limit as Vercel

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/extract') {
    const chunks = []; let size = 0;
    req.on('data', c => { size += c.length; chunks.push(c); });
    req.on('end', async () => {
      res.status = c => { res.statusCode = c; return res; };
      res.json = o => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
      if (size > LIMIT) return res.status(413).json({ error: 'Request too large (over Vercel 4.5 MB limit)' });
      const raw = Buffer.concat(chunks).toString();
      try { req.body = raw ? JSON.parse(raw) : {}; } catch (e) { req.body = raw; }
      const t = Date.now();
      await handler(req, res);
      console.log(req.method, '/api/extract', res.statusCode, ((Date.now() - t) / 1000).toFixed(1) + 's');
    });
    return;
  }
  let file = path.join(root, decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
  if (!file.startsWith(root) || /\.env/.test(file)) { res.statusCode = 403; return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.statusCode = 404; return res.end('Not found'); }
    res.setHeader('content-type', types[path.extname(file)] || 'application/octet-stream');
    res.end(data);
  });
}).listen(3000, () => {
  console.log('Opening BOQ running at http://localhost:3000');
  console.log(process.env.ANTHROPIC_API_KEY ? 'API key loaded.' : 'WARNING: no API key. Put ANTHROPIC_API_KEY=... in .env.local');
});
