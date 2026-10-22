import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import net from 'node:net';
import {fileURLToPath} from 'node:url';
import {runBridge} from './bridge-worker.mjs';
const directory=path.dirname(fileURLToPath(import.meta.url));
const configPath=process.argv[2];
if(!configPath)throw new Error('Missing local configuration path');
const config=JSON.parse(fs.readFileSync(configPath,'utf8'));
// A localhost-only lock prevents two launchers from consuming the same queue.
const lock=net.createServer(socket=>socket.end());
await new Promise((resolve,reject)=>{lock.once('error',()=>reject(new Error('Local WhatsApp bridge is already running or its lock port is unavailable')));lock.listen(8788,'127.0.0.1',resolve);});
const shutdown=new AbortController();
const env={...process.env,WA_GATEWAY_SECRET:config.secret,WA_DATA_DIR:path.join(path.dirname(configPath),'data'),HOST:'127.0.0.1',PORT:'8787',WA_LOG_LEVEL:'error'};
let child=null,stopping=false;
const start=()=>{
  if(stopping)return;
  child=spawn(process.execPath,[path.join(directory,'server.mjs')],{env,cwd:directory,stdio:['ignore','inherit','inherit'],windowsHide:true});
  child.on('error',()=>{console.error('Local WhatsApp service could not start');});
  child.on('exit',()=>{child=null;if(!stopping)setTimeout(start,5000);});
};
const stop=()=>{stopping=true;shutdown.abort();child?.kill();lock.close();};
process.on('SIGTERM',stop);process.on('SIGINT',stop);
start();
try { await runBridge({origin:config.origin,secret:config.secret,signal:shutdown.signal}); }
finally { stop(); }
