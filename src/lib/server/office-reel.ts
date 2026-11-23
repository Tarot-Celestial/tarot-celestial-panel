import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import ffmpeg from 'ffmpeg-static';
import { OFFICE_FILE_LIMIT } from '@/features/office/model';
import { renderOfficeReelScene, type OfficeVisualVariant, type Poster } from './office-artwork';

const encode = promisify(execFile);
export const REEL_WIDTH = 720, REEL_HEIGHT = 1280;
// Longer copy remains on screen long enough to read. FFmpeg keeps each shot
// subtle; the graphics already include the title, brand and scene safe areas.
const seconds = (text:string) => Math.max(3.2, Math.min(8, 0.6 + text.trim().split(/\s+/).length / 2.8));
export async function renderOfficeReel(poster:Poster, variant:OfficeVisualVariant) {
  const executable = process.env.FFMPEG_PATH || ffmpeg;
  if (!executable) throw new Error('No está disponible el codificador de vídeo de la Oficina.');
  const dir = await mkdtemp(path.join(tmpdir(),'office-reel-'));
  try {
    const frames = [poster.headline,...poster.lines].map(text => Math.ceil(seconds(text) * 30));
    for (let i = 0; i < frames.length; i++) {
      const bytes = await renderOfficeReelScene(poster,variant,i);
      await writeFile(path.join(dir,`scene-${i}.png`),bytes);
    }
    const duration = frames.reduce((a,b) => a + b,0) / 30;
    const startFrames = frames.map((_,i) => frames.slice(0,i).reduce((a,b) => a+b,0));
    const choose = (values:number[]) => values.reduceRight<string>((expr,value,i) =>
      i === values.length - 1 ? String(value) : `if(eq(in,${i}),${value},${expr})`,'');
    const zoom = `1+0.025*(on-(${choose(startFrames)}))/(${choose(frames)}-1)`;
    const bitrate = Math.floor((OFFICE_FILE_LIMIT - 170000) * 8 / duration / 1000);
    const file = path.join(dir,'reel.mp4');
    await encode(executable,['-hide_banner','-nostdin','-loglevel','error','-threads','1','-framerate','1',
      '-i',path.join(dir,'scene-%d.png'),'-vf',`zoompan=z='${zoom}':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2':d='${choose(frames)}':s=720x1280:fps=30,setsar=1,format=yuv420p`,
      '-an','-c:v','libx264','-threads','1','-preset','veryfast','-crf','23','-maxrate',bitrate+'k','-bufsize',Math.floor(bitrate/2)+'k',
      '-map_metadata','-1','-movflags','+faststart',file], {windowsHide:true,timeout:45000,maxBuffer:64000});
    const bytes = await readFile(file);
    if (bytes.subarray(4,8).toString('ascii') !== 'ftyp' || bytes.length > OFFICE_FILE_LIMIT) throw new Error('El Reel no cumple el formato o el límite de 2 MiB.');
    return bytes;
  } finally { await rm(dir,{recursive:true,force:true}); }
}
