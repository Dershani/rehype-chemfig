import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = fileURLToPath(new URL('./public/', import.meta.url));
const port = Number(process.env.PORT ?? 4173);
const args = process.argv.slice(2);
const { values } = parseArgs({
  args: args.map((argument, index) =>
    argument === '--host' && (!args[index + 1] || args[index + 1].startsWith('-'))
      ? '--host=0.0.0.0'
      : argument,
  ),
  options: { host: { type: 'string', default: '0.0.0.0' } },
});
const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.svg': 'image/svg+xml',
  '.md': 'text/plain; charset=utf-8',
  '.map': 'application/json',
};
createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const path = resolve(root, pathname === '/' ? 'index.html' : `.${pathname}`);
    if (!path.startsWith(root.endsWith(sep) ? root : root + sep)) {
      response.writeHead(403).end('Forbidden');
      return;
    }
    const data = await readFile(path);
    response.writeHead(200, {
      'Content-Type': types[extname(path)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    response.end(data);
  } catch {
    response.writeHead(404).end('Not found');
  }
}).listen(port, values.host, () =>
  console.log(`Chemfig demo: http://localhost:${port} (listening on ${values.host})`),
);
