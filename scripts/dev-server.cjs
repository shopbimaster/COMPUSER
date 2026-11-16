// Serve only application assets; never expose local schedules, signing files or tokens.
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
function createServer() {
  return http.createServer(async (req, res) => {
    try {
      let name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (name === '/') name = '/src/index.html';
      const file = path.resolve(root, '.' + name);
      const relative = path.relative(root, file).replaceAll('\\', '/');
      if (!/^(src\/|core\/|adapters\/|branding\.js$)/.test(relative) || relative.includes('..')) {
        res.writeHead(404); res.end('Not found'); return;
      }
      const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png' };
      const content = await fs.readFile(file);
      res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(content);
    } catch { res.writeHead(404); res.end('Not found'); }
  });
}
if (require.main === module) {
  const port = Number(process.env.PORT) || 8766;
  createServer().listen(port, '127.0.0.1', () => console.log(`campuser: http://127.0.0.1:${port}/src/index.html`));
}
module.exports = { createServer };
