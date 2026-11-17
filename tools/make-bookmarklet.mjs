// Builds public/sniffer.bookmarklet.txt from public/sniffer.user.js.
import { readFileSync, writeFileSync } from 'node:fs';
const src = readFileSync(new URL('../public/sniffer.user.js', import.meta.url), 'utf8');
writeFileSync(new URL('../public/sniffer.bookmarklet.txt', import.meta.url), 'javascript:' + encodeURIComponent(src) + '\n');
console.log('wrote public/sniffer.bookmarklet.txt');
