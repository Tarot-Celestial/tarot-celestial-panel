// All landmarks refer to the approved 1448 × 1086 painting, in top-left pixel coordinates.
const LOOK_EYES = [[669, 244], [799, 203]];
// Gaze towards the visitor, bow of the head, hand orbit, violet bounce light.
const POSES = {
  idle:       [0.78,  0.00, 0.04, 0.11],
  listening:  [0.02,  0.64, 0.36, 0.38],
  channeling: [0.00,  1.00, 1.00, 0.94],
  answer:     [1.00, -0.74, 0.12, 0.32],
};

const vertex = `
  attribute vec2 aPosition;
  uniform vec4 uPose;
  uniform vec2 uCrop;
  uniform float uTime;
  varying vec2 vImage;

  float lobe(vec2 p, vec2 center, vec2 radius) {
    vec2 d = (p - center) / radius;
    return exp(-dot(d,d) * 1.8);
  }
  void main() {
    const vec2 imageSize = vec2(1448., 1086.);
    vec2 p = ((vec2(aPosition.x, -aPosition.y) * uCrop) * .5 + .5) * imageSize;
    float breath = sin(uTime * 1.28);
    float bow = uPose.y;
    float orbit = uPose.z;
    vec2 d = vec2(0.);

    // Shoulders rise, the face turns about the base of the neck.
    float chest = lobe(p, vec2(809.,547.), vec2(390.,220.));
    d.y -= chest * breath * 3.7;
    d.x += chest * sin(uTime*.66) * .9;
    float head = lobe(p, vec2(730.,215.), vec2(398.,415.));
    vec2 neck = p - vec2(821.,466.);
    float tilt = -.035 * bow + .004 * sin(uTime*.79);
    d += head * (vec2(-neck.y, neck.x)*tilt + vec2(-2.8*bow, 10.5*bow - 1.7*breath));

    // The wrist remains anchored. The hovering fingers trace a small asymmetric arc.
    float hand = lobe(p, vec2(524.,522.), vec2(247.,98.));
    hand *= 1. - smoothstep(575.,620.,p.y);
    vec2 wrist = p - vec2(286.,606.);
    float fingerTurn = orbit * (.032 + .023 * sin(uTime * 1.52));
    d += hand * (vec2(-wrist.y, wrist.x)*fingerTurn +
      orbit * vec2(3.5 + 9.*sin(uTime*1.52+.62), 3.5*cos(uTime*1.52)));
    float restingHand = lobe(p, vec2(824.,910.), vec2(145.,78.));
    d.y -= restingHand * (.85*breath + 1.6*orbit);

    // The crystal's contour, base and reflected highlights at the edge stay anchored.
    vec2 glass = (p - vec2(581.,754.)) / vec2(176.,169.);
    float interior = 1. - smoothstep(.58,1.,length(glass));
    d += vec2(-glass.y,glass.x) * interior * (5.+9.*orbit) * sin(uTime*.72);
    vImage = (p - d) / imageSize;
    gl_Position = vec4(aPosition,0.,1.);
  }`;

const fragment = `
  precision highp float;
  varying vec2 vImage;
  uniform sampler2D uBase, uLook;
  uniform vec4 uPose;
  uniform vec2 uLookLeft, uLookRight;
  uniform float uTime, uBlink, uHasLook;
  const vec2 ref = vec2(1448.,1086.);
  const vec2 eyeL = vec2(666.,258.), eyeR = vec2(806.,217.);

  float spot(vec2 p, vec2 c, vec2 r) {
    vec2 q=(p-c)/r;
    return exp(-dot(q,q)*2.);
  }

  // Remap three intervals: fixed skin to moving upper lid, visible iris, lower lid to fixed skin.
  // At full closure the skin of the real upper lid covers the iris. The corners stay put.
  vec2 eyelid(vec2 p, vec2 center, float slope, vec2 dims) {
    vec2 axis = normalize(vec2(1.,slope)), normal=vec2(-axis.y,axis.x);
    vec2 q=p-center;
    float x=dot(q,axis), y=dot(q,normal);
    float edge=clamp(x/dims.x,-1.,1.);
    float arch=sqrt(max(0.,1.-edge*edge));
    float top=-dims.y*arch, bottom=dims.y*arch;
    float pad=(17.+dims.y)*arch;
    if (arch < .02 || abs(y) >= pad || uBlink <= 0.) return p;
    float newTop=mix(top,bottom*.65,uBlink);
    float newBottom=mix(bottom,bottom*.72,uBlink);
    float sy;
    if (y < newTop) sy=mix(-pad,top,(y+pad)/max(.01,newTop+pad));
    else if (y < newBottom) sy=mix(top,bottom,(y-newTop)/max(.01,newBottom-newTop));
    else sy=mix(bottom,pad,(y-newBottom)/max(.01,pad-newBottom));
    return p + normal*(sy-y);
  }

  float patchMask(vec2 p, vec2 c, vec2 halfSize, float slope) {
    vec2 axis=normalize(vec2(1.,slope)), normal=vec2(-axis.y,axis.x), q=p-c;
    return 1.-smoothstep(.60,1.,length(vec2(dot(q,axis),dot(q,normal))/halfSize));
  }
  vec2 matchingLook(vec2 p) {
    vec2 orig=eyeR-eyeL, next=uLookRight-uLookLeft;
    vec2 a=normalize(orig), b=next/length(orig), q=p-eyeL;
    return uLookLeft + b*dot(q,a) + vec2(-b.y,b.x)*dot(q,vec2(-a.y,a.x));
  }
  void main() {
    vec2 p=vImage*ref;
    float gaze=uPose.x;
    vec4 color;
    if (p.x>601. && p.x<873. && p.y>176. && p.y<293.) {
      p=eyelid(p,eyeL,-.23,vec2(38.,mix(7.5,13.5,gaze*uHasLook)));
      p=eyelid(p,eyeR,-.32,vec2(40.,mix(8.5,13.5,gaze*uHasLook)));
      float mask=max(patchMask(p,eyeL,vec2(51.,25.),-.23),
                     patchMask(p,eyeR,vec2(55.,26.),-.32));
      // Keep a small, bounded eye movement on devices still loading the second expression.
      vec2 irisShift=(1.-uHasLook)*gaze*mask*vec2(2.7,-2.2);
      color=texture2D(uBase,(p-irisShift)/ref);
      if (uHasLook>.5 && mask>.0 && gaze>.0) {
        vec4 lift=texture2D(uLook,matchingLook(p)/ref);
        color=mix(color,lift,mask*smoothstep(.10,.90,gaze));
      }
    } else {
      color=texture2D(uBase,vImage);
    }

    // Light returned by the glass reaches the two palms, with its strongest bounce below the fingers.
    float light=uPose.w*(.87+.13*sin(uTime*1.5));
    float fingers=spot(p,vec2(561.,552.),vec2(134.,45.));
    float palm=spot(p,vec2(744.,900.),vec2(85.,93.));
    color.rgb+=(1.-color.rgb)*vec3(.32,.12,.56)*light*(fingers*.8+palm*.43);
    vec2 ball=(p-vec2(581.,754.))/vec2(176.,169.);
    float radius=length(ball);
    if(radius < 1.){
      float inside=1.-smoothstep(.74,1.,radius);
      float core=exp(-2.8*dot(ball-vec2(.04,.18),ball-vec2(.04,.18)));
      color.rgb+=(1.-color.rgb)*vec3(.29,.17,.49)*light*inside*core;
    }
    gl_FragColor=vec4(color.rgb,1.);
  }`;

function shader(gl, type, source) {
  const item = gl.createShader(type);
  gl.shaderSource(item, source);
  gl.compileShader(item);
  if (gl.getShaderParameter(item, gl.COMPILE_STATUS)) return item;
  const reason = gl.getShaderInfoLog(item);
  gl.deleteShader(item);
  throw new Error(reason);
}

function makeGeometry() {
  const columns = 64, rows = 48, vertices = [], triangles = [];
  for (let row = 0; row <= rows; row++) {
    for (let col = 0; col <= columns; col++) {
      vertices.push(2 * col / columns - 1, 2 * row / rows - 1);
      if (col === columns || row === rows) continue;
      const i = row * (columns + 1) + col, next = i + columns + 1;
      triangles.push(i, i + 1, next, next, i + 1, next + 1);
    }
  }
  return { vertices: new Float32Array(vertices), indices: new Uint16Array(triangles) };
}

function makeRenderer(gl) {
  const program = gl.createProgram();
  const shaders = [], buffers = [], textures = [];
  function destroy() {
    for (const item of textures) gl.deleteTexture(item);
    for (const item of buffers) gl.deleteBuffer(item);
    for (const item of shaders) gl.deleteShader(item);
    gl.deleteProgram(program);
  }
  try {
    shaders.push(shader(gl, gl.VERTEX_SHADER, vertex));
    shaders.push(shader(gl, gl.FRAGMENT_SHADER, fragment));
    for (const item of shaders) gl.attachShader(program, item);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    gl.useProgram(program);
    const geometry = makeGeometry();
    buffers.push(gl.createBuffer(), gl.createBuffer());
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers[0]);
    gl.bufferData(gl.ARRAY_BUFFER, geometry.vertices, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffers[1]);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geometry.indices, gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'aPosition');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    const names = ['uBase','uLook','uTime','uBlink','uPose','uHasLook','uCrop','uLookLeft','uLookRight'];
    const uniforms = Object.fromEntries(names.map(name => [name, gl.getUniformLocation(program, name)]));
    gl.disable(gl.BLEND);
    for (let index = 0; index < 2; index++) {
      const texture = gl.createTexture();
      textures.push(texture);
      gl.activeTexture(gl.TEXTURE0 + index);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0,0,0,255]));
    }
    gl.uniform1i(uniforms.uBase, 0);
    gl.uniform1i(uniforms.uLook, 1);
    return {
      upload(index, img) {
        gl.activeTexture(gl.TEXTURE0 + index);
        gl.bindTexture(gl.TEXTURE_2D, textures[index]);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      },
      draw(pose, time, blink, hasLook, centers, aspect) {
        const crop = aspect / (1448 / 1086);
        gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
        gl.uniform2f(uniforms.uCrop, Math.min(1, crop), Math.min(1, 1 / crop));
        gl.uniform4fv(uniforms.uPose, pose);
        gl.uniform1f(uniforms.uTime, time);
        gl.uniform1f(uniforms.uBlink, blink);
        gl.uniform1f(uniforms.uHasLook, hasLook ? 1 : 0);
        gl.uniform2fv(uniforms.uLookLeft, centers[0]);
        gl.uniform2fv(uniforms.uLookRight, centers[1]);
        gl.drawElements(gl.TRIANGLES, geometry.indices.length, gl.UNSIGNED_SHORT, 0);
      },
      destroy,
    };
  } catch (err) {
    destroy();
    throw err;
  }
}

export function createPortrait(canvas, { src, gazeSrc, gazeEyes = LOOK_EYES }) {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  let state = 'idle', pose = Float32Array.from(POSES.idle);
  let paused = false, visible = true, disposed = false, lost = false;
  let renderer, gl, base, look, hasLook = false, frame = 0, last = 0, time = 0;
  let nextBlink = 2.9;
  const pendingImages = [];
  canvas.dataset.state = state;
  canvas.dataset.renderer = 'loading';
  canvas.dataset.paused = String(reduce.matches);
  canvas.style.backgroundImage = 'url(' + JSON.stringify(src) + ')';
  canvas.style.backgroundPosition = 'center';
  canvas.style.backgroundSize = 'cover';
  function stop() {
    if (frame) window.cancelAnimationFrame(frame);
    frame = 0;
    last = 0;
  }
  function canMove() {
    return !disposed && !lost && !paused && !reduce.matches && visible && !document.hidden;
  }
  function schedule() {
    if (renderer && base && canMove() && !frame) frame = window.requestAnimationFrame(tick);
  }
  function draw(blink = 0) {
    if (renderer && base && !lost && canvas.width && canvas.height) {
      renderer.draw(pose, time, blink, hasLook, gazeEyes, canvas.width / canvas.height);
    }
  }
  function tick(now) {
    frame = 0;
    if (!canMove()) return;
    // Render at up to 30 fps, using the display's animation clock for smooth transitions.
    if (!last || now - last >= 32) {
      const dt = last ? Math.min(.07, (now - last) / 1000) : .033;
      last = now;
      time += dt;
      const ease = 1 - Math.exp(-dt * 3.8);
      for (let i = 0; i < pose.length; i++) pose[i] += (POSES[state][i] - pose[i]) * ease;
      if (time > nextBlink + .23) nextBlink = time + 3.4 + Math.random() * 2.5;
      const phase = (time - nextBlink) / .22;
      // Fast close, slightly slower reopening.
      const blink = phase > 0 && phase < 1
        ? Math.sin(Math.PI * (phase < .38 ? phase / .76 : .5 + (phase - .38) / 1.24)) : 0;
      draw(blink);
    }
    schedule();
  }
  function resize() {
    if (disposed) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const scale = Math.min(window.devicePixelRatio || 1, 1.5, 1448 / rect.width, 1086 / rect.height);
    const width = Math.max(1, Math.round(rect.width * scale));
    const height = Math.max(1, Math.round(rect.height * scale));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      draw();
    }
  }
  function syncMotion() {
    canvas.dataset.paused = String(paused || reduce.matches);
    stop();
    if (reduce.matches) { pose.set(POSES[state]); draw(); }
    schedule();
  }
  function poster() {
    stop();
    renderer?.destroy();
    renderer = undefined;
    canvas.dataset.renderer = 'poster';
    if (gl && !gl.isContextLost()) {
      gl.clearColor(0,0,0,0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
  }
  function init() {
    if (disposed || lost || !base) return;
    try {
      gl = canvas.getContext('webgl', { alpha: true, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' });
      if (!gl || gl.isContextLost()) { poster(); return; }
      renderer = makeRenderer(gl);
      renderer.upload(0, base);
      if (look) { renderer.upload(1, look); hasLook = true; }
      resize();
      draw();
      canvas.dataset.renderer = 'ready';
      schedule();
    } catch { poster(); }
  }
  function image(url, done, failed) {
    const item = new Image();
    item.decoding = 'async';
    pendingImages.push(item);
    item.onload = () => { if (!disposed) done(item); };
    item.onerror = () => { if (!disposed) failed(); };
    item.src = url;
  }
  function contextLost(event) {
    event.preventDefault();
    stop();
    lost = true;
    hasLook = false;
    renderer = undefined;
    canvas.dataset.renderer = 'poster';
  }
  function restore() { lost = false; init(); }
  canvas.addEventListener('webglcontextlost', contextLost);
  canvas.addEventListener('webglcontextrestored', restore);
  document.addEventListener('visibilitychange', syncMotion);
  reduce.addEventListener('change', syncMotion);
  const sizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
  if (sizeObserver) sizeObserver.observe(canvas);
  else window.addEventListener('resize', resize);
  const visibilityObserver = typeof IntersectionObserver === 'function'
    ? new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; syncMotion(); })
    : null;
  visibilityObserver?.observe(canvas);
  image(src, item => { base = item; init(); }, () => { canvas.dataset.renderer = 'error'; });
  if (gazeSrc) image(gazeSrc, item => {
    look = item;
    if (!renderer || lost) return;
    try { renderer.upload(1, look); hasLook = true; draw(); }
    catch { hasLook = false; }
  }, () => {});
  return {
    setState(next) {
      if (disposed || !Object.hasOwn(POSES, next) || state === next) return;
      state = next;
      canvas.dataset.state = next;
      if (reduce.matches || paused) { pose.set(POSES[next]); draw(); }
      schedule();
    },
    setPaused(value) { if (!disposed) { paused = !!value; syncMotion(); } },
    destroy() {
      if (disposed) return;
      disposed = true;
      stop();
      sizeObserver?.disconnect();
      if (!sizeObserver) window.removeEventListener('resize', resize);
      visibilityObserver?.disconnect();
      document.removeEventListener('visibilitychange', syncMotion);
      reduce.removeEventListener('change', syncMotion);
      canvas.removeEventListener('webglcontextlost', contextLost);
      canvas.removeEventListener('webglcontextrestored', restore);
      for (const item of pendingImages) { item.onload = null; item.onerror = null; }
      renderer?.destroy();
      renderer = undefined;
      gl?.getExtension('WEBGL_lose_context')?.loseContext();
      base = look = undefined;
    },
  };
}
