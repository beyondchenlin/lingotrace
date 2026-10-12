import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const files=new Map([['/',['index.html','text/html; charset=utf-8']],['/index.html',['index.html','text/html; charset=utf-8']],['/data-browser.js',['data-browser.js','text/javascript; charset=utf-8']]]);
const port=Number(process.argv[2]??8765);if(!Number.isInteger(port)||port<0||port>65535)throw new Error('Choose a port from 0 through 65535.');
const server=createServer(async(req,res)=>{const pathname=new URL(req.url,'http://127.0.0.1').pathname,entry=files.get(pathname);if(!entry||!['GET','HEAD'].includes(req.method)){res.writeHead(404);res.end();return}try{const bytes=await readFile(fileURLToPath(new URL(entry[0],import.meta.url)));res.writeHead(200,{'content-type':entry[1],'cache-control':'no-store','x-content-type-options':'nosniff'});res.end(req.method==='HEAD'?undefined:bytes)}catch{res.writeHead(500);res.end('QA file missing; build the bundle before serving.')}});
server.listen(port,'127.0.0.1',()=>console.log(`Isolated QA page: http://127.0.0.1:${server.address().port}/`));
