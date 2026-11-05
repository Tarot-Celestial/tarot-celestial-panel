// The six frames share a camera. Pin corresponding wrists, knuckles and deck
// edges before blending, so the card travels with the fingertips holding it.
const ATLAS = new URL('../assets/card-poses.webp', import.meta.url).href;
const CARD_STATES = new Set(['shuffle', 'offer', 'reveal']);
const RADII = [0.115, 0.075, 0.075, 0.10, 0.070, 0.065, 0.070, 0.075];
const LANDMARKS = [
  // Left wrist, upper and lower fingertips; right wrist and fingertips;
  // top, lower-left and right corners of the center packet/card.
  [.262,.79, .446,.790, .405,.946, .793,.790, .650,.784, .469,.825, .405,.949, .518,.880],
  [.312,.795,.489,.833, .457,.933, .761,.786, .559,.839, .504,.842, .433,.923, .581,.879],
  [.225,.745,.234,.807, .333,.928, .837,.796, .733,.955, .479,.887, .457,.967, .609,.950],
  [.314,.774,.455,.899, .443,.927, .841,.793, .737,.948, .463,.866, .456,.937, .600,.952],
  [.293,.730,.443,.717, .438,.764, .837,.800, .728,.948, .420,.611, .463,.825, .583,.800],
  [.290,.646,.404,.632, .396,.705, .797,.831, .625,.932, .386,.476, .404,.747, .525,.730],
];

const clamp = n => Math.min(1, Math.max(0, n));
const ease = n => { const t = clamp(n); return t * t * (3 - 2 * t); };

function pose(state, time) {
  if (state === 'shuffle') {
    const phase = (time % 1.53) / 1.53;
    const join = phase < .64 ? ease(phase / .64) : 1 - ease((phase - .64) / .36);
    return [0, 1, join];
  }
  if (state === 'offer') return [1, 2, ease(time / .86)];
  const step = time < .62 ? 0 : time < 1.42 ? 1 : 2;
  const stops = [0, .62, 1.42, 2.32];
  return [2 + step, 3 + step, ease((time - stops[step]) / (stops[step + 1] - stops[step]))];
}

const VERTEX = `
  precision highp float;
  attribute vec2 aPoint;
  uniform vec2 uFrom[8], uTo[8];
  uniform float uRadius[8], uTime, uShuffle, uOffer, uReach;
  uniform mediump float uBlend;
  uniform vec2 uCrop;
  varying mediump vec2 vFrom, vTo;
  void main() {
    vec2 p=(aPoint-.5)*uCrop+.5;
    vec2 shift=vec2(0.);
    float sum=5.;
    for(int i=0; i<8; i++) {
      vec2 loc=mix(uFrom[i],uTo[i],uBlend);
      vec2 d=(p-loc)*vec2(1.13,1.);
      float d2=dot(d,d);
      float w=exp(-d2/(uRadius[i]*uRadius[i]*1.8))/(d2+.00022);
      shift+=(uTo[i]-uFrom[i])*w;
      sum+=w;
    }
    // Keep head, shoulders, table edges, candle and background registered.
    float body=smoothstep(.45,.69,p.y)*(1.-smoothstep(.978,1.,p.y));
    shift*=body/sum;
    vec2 middle=mix(uFrom[1],uTo[1],uBlend);
    vec2 dm=p-middle;
    vec2 card=mix(uFrom[5],uTo[5],uBlend);
    vec2 dc=p-card;
    float wrist=exp(-dot(dm,dm)/.013);
    float paper=exp(-dot(dc,dc)/.009);
    // A small wrist extension follows the chosen position before the lift.
    vec2 move=vec2(uReach*(.68*wrist+.32*paper),0.);
    move.x+=uOffer*.010*sin(uTime*1.6)*wrist;
    move.y+=uOffer*.007*cos(uTime*1.6)*wrist;
    // Uneven release of the two packets under the thumbs.
    move.y+=uShuffle*.008*sin(41.*uTime+12.*p.x)*paper;
    vec2 chest=p-vec2(.54,.61);
    move.y+=.0026*sin(uTime*1.38)*exp(-dot(chest,chest)/.059);
    vFrom=p-move-uBlend*shift;
    vTo=p-move+(1.-uBlend)*shift;
    gl_Position=vec4(aPoint*vec2(2.,-2.)+vec2(-1.,1.),0.,1.);
  }`;

const FRAGMENT = `
  precision mediump float;
  uniform sampler2D uAtlas;
  uniform vec2 uCellA,uCellB;
  uniform mediump float uBlend;
  varying mediump vec2 vFrom,vTo;
  vec2 uv(vec2 v,vec2 cell) {
    return (clamp(v,vec2(.0019),vec2(.9981))+cell)/vec2(3.,2.);
  }
  void main() {
    vec4 a=texture2D(uAtlas,uv(vFrom,uCellA));
    vec4 b=texture2D(uAtlas,uv(vTo,uCellB));
    gl_FragColor=mix(a,b,smoothstep(.25,.75,uBlend));
  }`;

function makeGrid() {
  const columns=46, rows=34, points=[], indices=[];
  for(let y=0;y<=rows;y++) for(let x=0;x<=columns;x++) {
    points.push(x/columns,y/rows);
    if(x===columns || y===rows) continue;
    const a=y*(columns+1)+x, b=a+1, c=a+columns+1;
    indices.push(a,b,c,b,c+1,c);
  }
  return {points:new Float32Array(points), indices:new Uint16Array(indices)};
}

function makeRenderer(gl,image) {
  const shaders=[], buffers=[];
  const program=gl.createProgram(), texture=gl.createTexture();
  function dispose() {
    for(const buffer of buffers) gl.deleteBuffer(buffer);
    for(const shader of shaders) gl.deleteShader(shader);
    gl.deleteTexture(texture);
    gl.deleteProgram(program);
  }
  try {
    for(const [type,source] of [[gl.VERTEX_SHADER,VERTEX],[gl.FRAGMENT_SHADER,FRAGMENT]]) {
      const shader=gl.createShader(type);
      shaders.push(shader);
      gl.shaderSource(shader,source);
      gl.compileShader(shader);
      if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader)||'card shader');
      gl.attachShader(program,shader);
    }
    gl.linkProgram(program);
    if(!gl.getProgramParameter(program,gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program)||'card program');
    gl.useProgram(program);
    const grid=makeGrid();
    for(const [target,data] of [[gl.ARRAY_BUFFER,grid.points],[gl.ELEMENT_ARRAY_BUFFER,grid.indices]]) {
      const buffer=gl.createBuffer();
      buffers.push(buffer); gl.bindBuffer(target,buffer); gl.bufferData(target,data,gl.STATIC_DRAW);
    }
    const point=gl.getAttribLocation(program,'aPoint');
    gl.enableVertexAttribArray(point); gl.vertexAttribPointer(point,2,gl.FLOAT,false,0,0);
    gl.bindTexture(gl.TEXTURE_2D,texture);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);
    const loc = name=>gl.getUniformLocation(program,'u'+name);
    const u=Object.fromEntries(['Time','Shuffle','Offer','Reach','From[0]','To[0]','Radius[0]','Blend','CellA','CellB','Crop'].map(n=>[n,loc(n)]));
    gl.uniform1fv(u['Radius[0]'],RADII);
    return {dispose, draw(frame,state,time,index) {
      const [a,b,t]=frame, aspect=gl.canvas.width/gl.canvas.height, original=4/3;
      gl.viewport(0,0,gl.canvas.width,gl.canvas.height);
      gl.uniform2f(u.Crop,Math.min(1,aspect/original),Math.min(1,original/aspect));
      gl.uniform1f(u.Blend,t); gl.uniform1f(u.Time,time);
      gl.uniform2fv(u['From[0]'],LANDMARKS[a]); gl.uniform2fv(u['To[0]'],LANDMARKS[b]);
      gl.uniform2f(u.CellA,a%3,Math.floor(a/3)); gl.uniform2f(u.CellB,b%3,Math.floor(b/3));
      gl.uniform1f(u.Shuffle,state==='shuffle'?Math.sin(Math.PI*t):0);
      gl.uniform1f(u.Offer,state==='offer'?t:0);
      const reach=state==='reveal'?(index-1)*.135*ease(time/.36)*(1-ease((time-.66)/.62)):0;
      gl.uniform1f(u.Reach,reach);
      gl.drawElements(gl.TRIANGLES,grid.indices.length,gl.UNSIGNED_SHORT,0);
    }};
  } catch(error) { dispose(); throw error; }
}

// The software path samples the same hand landmarks as the shader. One pixel
// buffer per pose lets a device without WebGL animate without issuing hundreds
// of cropped drawing operations for each video frame.
function makeCanvasRenderer(canvas,image) {
  const ctx=canvas.getContext('2d',{alpha:false});
  if(!ctx) throw new Error('Canvas 2D unavailable');
  const cellW=image.naturalWidth/3, cellH=image.naturalHeight/2;
  const source=document.createElement('canvas');
  source.width=cellW; source.height=cellH;
  const decoder=source.getContext('2d',{willReadFrequently:true});
  if(!decoder) throw new Error('Canvas 2D unavailable');
  const frames=Array.from({length:6},(_,i)=>{
    decoder.drawImage(image,(i%3)*cellW,Math.floor(i/3)*cellH,cellW,cellH,0,0,cellW,cellH);
    return new Uint32Array(decoder.getImageData(0,0,cellW,cellH).data.buffer);
  });
  source.width=source.height=1;
  const cols=32,rows=26, mesh=new Float32Array((cols+1)*(rows+1)*4);
  let output=null, pixels=null;

  // Packed integer lerp keeps bilinear sampling inexpensive in the inner loop.
  function mixPixel(a,b,t) {
    const n=256-t;
    const rb=(((a&0xff00ff)*n+(b&0xff00ff)*t)>>>8)&0xff00ff;
    const g=(((a&0xff00)*n+(b&0xff00)*t)>>>8)&0xff00;
    return rb|g|0xff000000;
  }
  function sample(frame,x,y) {
    x=Math.max(0,Math.min(cellW-1.001,x));
    y=Math.max(0,Math.min(cellH-1.001,y));
    const ix=x|0, iy=y|0, offset=iy*cellW+ix;
    const fx=((x-ix)*256)|0, fy=((y-iy)*256)|0;
    return mixPixel(mixPixel(frame[offset],frame[offset+1],fx),
      mixPixel(frame[offset+cellW],frame[offset+cellW+1],fx),fy);
  }
  function register(frame,state,time,index) {
    const [a,b,t]=frame, start=LANDMARKS[a], end=LANDMARKS[b];
    const ratio=canvas.width/canvas.height, cropX=Math.min(1,ratio/(4/3)), cropY=Math.min(1,(4/3)/ratio);
    const wristX=start[2]+t*(end[2]-start[2]), wristY=start[3]+t*(end[3]-start[3]);
    const cardX=start[10]+t*(end[10]-start[10]), cardY=start[11]+t*(end[11]-start[11]);
    const reach=state==='reveal'?(index-1)*.135*ease(time/.36)*(1-ease((time-.66)/.62)):0;
    const flutter=state==='shuffle'?Math.sin(Math.PI*t):0, offer=state==='offer'?t:0;
    for(let y=0;y<=rows;y++) for(let x=0;x<=cols;x++) {
      const u=(x/cols-.5)*cropX+.5, v=(y/rows-.5)*cropY+.5;
      let sx=0, sy=0, sum=5;
      for(let j=0;j<RADII.length;j++) {
        const dx=end[j*2]-start[j*2], dy=end[j*2+1]-start[j*2+1];
        const d2=((u-start[j*2]-t*dx)*1.13)**2+(v-start[j*2+1]-t*dy)**2;
        const w=Math.exp(-d2/(RADII[j]**2*1.8))/(d2+.00022);
        sx+=w*dx; sy+=w*dy; sum+=w;
      }
      const gain=ease((v-.45)/.24)*(1-ease((v-.978)/.022))/sum;
      sx*=gain; sy*=gain;
      const wrist=Math.exp(-((u-wristX)**2+(v-wristY)**2)/.013);
      const paper=Math.exp(-((u-cardX)**2+(v-cardY)**2)/.009);
      const chest=Math.exp(-((u-.54)**2+(v-.61)**2)/.059);
      const mx=reach*(.68*wrist+.32*paper)+offer*.010*Math.sin(time*1.6)*wrist;
      const my=offer*.007*Math.cos(time*1.6)*wrist+flutter*.008*Math.sin(41*time+12*u)*paper
        +.0026*Math.sin(time*1.38)*chest;
      const k=(y*(cols+1)+x)*4;
      mesh[k]=(u-mx-t*sx)*cellW-.5; mesh[k+1]=(v-my-t*sy)*cellH-.5;
      mesh[k+2]=(u-mx+(1-t)*sx)*cellW-.5; mesh[k+3]=(v-my+(1-t)*sy)*cellH-.5;
    }
  }
  return {dispose(){ output=null; pixels=null; frames.length=0; }, draw(frame,state,time,index) {
    const w=canvas.width, h=canvas.height;
    if(!output||output.width!==w||output.height!==h) {
      output=ctx.createImageData(w,h); pixels=new Uint32Array(output.data.buffer);
    }
    register(frame,state,time,index);
    const a=frames[frame[0]], b=frames[frame[1]], blend=Math.round(256*ease((frame[2]-.25)/.50));
    const row=new Float32Array((cols+1)*4);
    for(let y=0;y<h;y++) {
      const gy=(y+.5)*rows/h, top=Math.min(rows-1,gy|0), fy=gy-top;
      const upper=top*(cols+1)*4, lower=upper+(cols+1)*4;
      for(let k=0;k<row.length;k++) row[k]=mesh[upper+k]+fy*(mesh[lower+k]-mesh[upper+k]);
      for(let col=0;col<cols;col++) {
        const k=col*4, x0=Math.ceil(col*w/cols-.5), x1=Math.ceil((col+1)*w/cols-.5);
        const scale=cols/w, step=(x0+.5)*scale-col;
        const ax=row[k+4]-row[k], ay=row[k+5]-row[k+1];
        const bx=row[k+6]-row[k+2], by=row[k+7]-row[k+3];
        let u=row[k]+step*ax,v=row[k+1]+step*ay, z=row[k+2]+step*bx,q=row[k+3]+step*by;
        for(let x=x0;x<x1;x++) {
          const pa=blend===256?0:sample(a,u,v);
          const pb=blend===0?0:sample(b,z,q);
          pixels[y*w+x]=blend===0?pa:blend===256?pb:mixPixel(pa,pb,blend);
          u+=ax*scale;v+=ay*scale;z+=bx*scale;q+=by*scale;
        }
      }
    }
    ctx.putImageData(output,0,0);
  }};
}

export function createCardPerformance(container) {
  container.classList.add('card-performance');
  const poster=document.createElement('div'), canvas=document.createElement('canvas');
  poster.className='card-performance__poster'; canvas.className='card-performance__canvas';
  poster.style.backgroundImage='url("'+ATLAS+'")';
  container.append(poster,canvas); container.dataset.active='false';
  let state='idle', index=1, paused=false, visible=true, elapsed=0, last=0, raf=0;
  let renderer=null, softCanvas=null, gl=null, stopped=false, imageReady=false, previousFrame=-1;
  const image=new Image();
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  function isActive() { return CARD_STATES.has(state); }
  function staticTime() { return state==='reveal'?2.32:state==='offer'?.86:.5; }
  function paint() {
    if(!isActive()) return;
    const time=reduced.matches?staticTime():elapsed;
    const frame=pose(state,time);
    const hold=frame[2]<.5?frame[0]:frame[1];
    if(hold!==previousFrame) {
      poster.style.backgroundPosition=(hold%3*50)+'% '+(Math.floor(hold/3)*100)+'%';
      previousFrame=hold;
    }
    renderer?.draw(frame,state,time,index);
  }
  function tick(now) {
    raf=0;
    if(!last || now-last>=1000/32) {
      if(last) elapsed+=Math.min((now-last)/1000,.10);
      last=now; paint();
    }
    if(isActive() && !paused && !reduced.matches && visible && !document.hidden) raf=requestAnimationFrame(tick);
  }
  function refresh() {
    cancelAnimationFrame(raf); raf=0; last=0;
    if(stopped || !isActive()) return;
    paint();
    if(!paused && !reduced.matches && visible && !document.hidden) raf=requestAnimationFrame(tick);
  }
  function resize() {
    const r=container.getBoundingClientRect();
    const scale=Math.min(devicePixelRatio||1,1.5,(softCanvas?520:1152)/Math.max(1,r.width));
    const w=Math.max(1,Math.round(r.width*scale)), h=Math.max(1,Math.round(r.height*scale));
    if(canvas.width!==w || canvas.height!==h) { canvas.width=w; canvas.height=h; }
    if(softCanvas && (softCanvas.width!==w || softCanvas.height!==h)) { softCanvas.width=w; softCanvas.height=h; }
    paint();
  }
  function initializeRenderer() {
    if(stopped || !imageReady || !isActive() || renderer) return;
    try {
      gl ||= canvas.getContext('webgl',{alpha:false,antialias:false,depth:false,stencil:false});
      if(gl && !gl.isContextLost()) renderer=makeRenderer(gl,image);
    } catch(error) {
      container.dataset.rendererIssue=String(error?.message||'context').slice(0,320);
      renderer=null;
    }
    canvas.style.visibility=renderer?'visible':'hidden';
    container.dataset.renderer=renderer?'mesh':'poster';
    if(!renderer) {
      softCanvas=document.createElement('canvas');
      softCanvas.className='card-performance__canvas';
      try {
        renderer=makeCanvasRenderer(softCanvas,image);
        container.append(softCanvas);
        container.dataset.renderer='canvas2d';
      } catch {
        softCanvas=null;
      }
    }
    resize(); refresh();
  }
  function lost(event) {
    event.preventDefault(); renderer=null; canvas.style.visibility='hidden';
    container.dataset.renderer='poster';
    initializeRenderer();
  }
  function restore() {
    renderer?.dispose(); renderer=null; softCanvas?.remove(); softCanvas=null;
    initializeRenderer();
  }
  canvas.style.visibility='hidden';
  canvas.addEventListener('webglcontextlost',lost);
  canvas.addEventListener('webglcontextrestored',restore);
  image.onload=()=>{ imageReady=true; initializeRenderer(); };
  let resizeObserver=null, intersectionObserver=null;
  if(typeof ResizeObserver!=='undefined') {
    resizeObserver=new ResizeObserver(resize); resizeObserver.observe(container);
  }
  if(typeof IntersectionObserver!=='undefined') {
    intersectionObserver=new IntersectionObserver(entries=>{ visible=entries[0].isIntersecting;refresh(); });
    intersectionObserver.observe(container);
  }
  reduced.addEventListener('change',refresh); document.addEventListener('visibilitychange',refresh);
  return {
    setState(next,selectedIndex=1) {
      if(stopped) return;
      const pick=Math.min(2,Math.max(0,Math.trunc(selectedIndex)||0));
      if(next===state && pick===index) return;
      state=next; index=pick; elapsed=paused?staticTime():0;
      container.dataset.active=String(isActive()); container.dataset.state=state;
      if(isActive() && !image.src) image.src=ATLAS;
      initializeRenderer(); refresh();
    },
    setPaused(value) { paused=Boolean(value);refresh(); },
    destroy() {
      stopped=true; cancelAnimationFrame(raf);
      reduced.removeEventListener('change',refresh); document.removeEventListener('visibilitychange',refresh);
      resizeObserver?.disconnect(); intersectionObserver?.disconnect();
      canvas.removeEventListener('webglcontextlost',lost); canvas.removeEventListener('webglcontextrestored',restore);
      image.onload=null; renderer?.dispose(); gl?.getExtension('WEBGL_lose_context')?.loseContext();
      poster.remove(); canvas.remove(); softCanvas?.remove(); delete container.dataset.renderer; container.dataset.active='false';
    }
  };
}
