import * as THREE from 'three';
import { oracleCharacterPose, type OracleCharacterState, type Point3 } from './oracle-character-motion';

type SceneController = {
  update: (state: OracleCharacterState) => void;
  render: (elapsed: number, delta: number) => void;
  resize: () => void;
  dispose: () => void;
};

/** All geometry is original, generated locally. No external models, video or inference requests. */
export function createOracleCharacterScene(container: HTMLDivElement, onContextLost: () => void): SceneController {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.setClearColor(0x160d23, 1);
  renderer.domElement.setAttribute('aria-hidden', 'true');
  renderer.domElement.setAttribute('tabindex', '-1');
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x160d23, .055);
  const camera = new THREE.PerspectiveCamera(35, 4 / 3, .1, 40);
  camera.position.set(0, 2.55, 6.8);
  camera.lookAt(0, 1.73, .0);
  const materials = new Set<THREE.Material>();
  const geometries = new Set<THREE.BufferGeometry>();
  const textures = new Set<THREE.Texture>();
  const mat = (color: number, extra: THREE.MeshStandardMaterialParameters = {}) => {
    const m = new THREE.MeshStandardMaterial({ color, roughness: .65, metalness: .03, ...extra }); materials.add(m); return m;
  };
  const basic = (color: number, opacity = 1) => {
    const m = new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, depthWrite: opacity === 1 }); materials.add(m); return m;
  };
  const sphereGeo = new THREE.SphereGeometry(1, 28, 20); geometries.add(sphereGeo);
  const cylinderGeo = new THREE.CylinderGeometry(1, 1, 1, 20); geometries.add(cylinderGeo);
  const sphere = (parent: THREE.Object3D, material: THREE.Material, xyz: Point3, scale: Point3) => {
    const m = new THREE.Mesh(sphereGeo, material); m.position.set(...xyz); m.scale.set(...scale); parent.add(m); return m;
  };
  const geometry = <T extends THREE.BufferGeometry>(g: T): T => { geometries.add(g); return g; };
  const mesh = (parent: THREE.Object3D, g: THREE.BufferGeometry, material: THREE.Material, xyz: Point3 = [0, 0, 0]) => {
    const m = new THREE.Mesh(g, material); m.position.set(...xyz); parent.add(m); return m;
  };
  const tube = (parent: THREE.Object3D, pts: Point3[], radius: number, material: THREE.Material, segments = 24) =>
    mesh(parent, geometry(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(...p))), segments, radius, 6, false)), material);
  const torus = (parent: THREE.Object3D, radius: number, thickness: number, material: THREE.Material, xyz: Point3, arc = Math.PI * 2) =>
    mesh(parent, geometry(new THREE.TorusGeometry(radius, thickness, 8, 80, arc)), material, xyz);

  const gold = mat(0xe5b970, { metalness: .75, roughness: .28 });
  const darkGold = mat(0x785137, { metalness: .7, roughness: .46 });
  const skin = mat(0xce936e, { roughness: .72 });
  const skinWarm = mat(0xb97962, { roughness: .76 });
  const hair = mat(0x261626, { roughness: .63 });
  const hairShine = mat(0x3f2639, { roughness: .47 });
  const dress = mat(0x342044, { roughness: .91, metalness: 0 });
  const dressHighlight = mat(0x493052, { roughness: .88, metalness: 0 });
  const fabricFold = mat(0x50335b, { roughness: .94, metalness: 0 });
  const eyeWhite = mat(0xf6e6d6, { roughness: .35 });
  const eyeIris = mat(0x54796c, { roughness: .3 });
  const eyeBlack = mat(0x17101e, { roughness: .3 });
  const lips = mat(0x9f5667, { roughness: .5 });
  const lightGold = basic(0xffd89a);
  const paleLight = basic(0xf0edff);
  const violetLight = basic(0xb8a0ff, .6);

  scene.add(new THREE.HemisphereLight(0xd7c5ff, 0x27101d, 2.05));
  const key = new THREE.DirectionalLight(0xffe3bf, 3.8); key.position.set(-3, 5, 4); scene.add(key);
  const fill = new THREE.DirectionalLight(0xbc96ff, 1.9); fill.position.set(3, 3, 1); scene.add(fill);
  const rim = new THREE.DirectionalLight(0xd89aff, 2.5); rim.position.set(0, 4, -3); scene.add(rim);
  const orbLight = new THREE.PointLight(0xa998ff, 0, 3.3, 2); orbLight.position.set(0, 1.45, 1.3); scene.add(orbLight);

  // A sculptural midnight alcove frames the figure; the camera never jumps between actions.
  const backdrop = mat(0x211330);
  mesh(scene, geometry(new THREE.PlaneGeometry(18, 12)), backdrop, [0, 2, -2.3]);
  const halo = new THREE.Group(); halo.position.set(0, 2.12, -1.32); scene.add(halo);
  torus(halo, 1.56, .018, gold, [0, 0, 0]); torus(halo, 1.48, .009, darkGold, [0, 0, .01]);
  torus(halo, 1.34, .007, darkGold, [0, 0, .015]);
  for (let n = 0; n < 48; n++) {
    const angle = n / 48 * Math.PI * 2;
    const length = n % 4 ? .035 : .075;
    const tick = mesh(halo, geometry(new THREE.BoxGeometry(.009, length, .01)), gold, [Math.sin(angle) * 1.42, Math.cos(angle) * 1.42, .02]); tick.rotation.z = -angle;
  }
  for (let n = 0; n < 7; n++) {
    const a = (n - 3) * .22;
    const star = mesh(halo, geometry(new THREE.OctahedronGeometry(n === 3 ? .07 : .035)), lightGold, [Math.sin(a) * 1.69, Math.cos(a) * 1.69, .02]);
    star.scale.y = 1.4;
  }
  const curtains = mat(0x2b1539, { roughness: .92 });
  for (const side of [-1, 1]) {
    for (let i = 0; i < 7; i++) sphere(scene, curtains, [side * (2.08 + i * .18), 2, -1.45 + Math.sin(i) * .06], [.17, 2.7, .15]);
  }
  const starsGeometry = geometry(new THREE.BufferGeometry());
  const positions: number[] = [];
  for (let n = 0; n < 80; n++) {
    const seed = Math.sin(n * 12.9898 + 19) * 43758.5453, f = seed - Math.floor(seed);
    const seed2 = Math.sin(n * 7.178 + 2) * 31851.5453, g = seed2 - Math.floor(seed2);
    positions.push((f - .5) * 7, g * 4.8, -1.58);
  }
  starsGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const starMat = new THREE.PointsMaterial({ color: 0xebca8e, size: .025, transparent: true, opacity: .55, depthWrite: false }); materials.add(starMat);
  scene.add(new THREE.Points(starsGeometry, starMat));

  // Table, cloth and engraved orbital rings.
  const table = new THREE.Group(); table.position.set(0, .77, .50); scene.add(table);
  const tabletop = mesh(table, geometry(new THREE.CylinderGeometry(2.12, 2.10, .14, 96)), mat(0x31152f, { roughness: .98 })); tabletop.scale.z = .73;
  const edge = torus(table, 2.1, .028, darkGold, [0, .015, 0]); edge.rotation.x = Math.PI / 2; edge.scale.y = .73;
  for (const radius of [.57, .69, 1.37]) { const ring = torus(table, radius, .005, darkGold, [0, .075, .13]); ring.rotation.x = Math.PI / 2; }

  const flameMeshes: THREE.Mesh[] = [];
  for (const side of [-1, 1]) {
    const x = side * 1.55;
    const candle = new THREE.Group(); candle.position.set(x, .85, -.06); scene.add(candle);
    const stand = mesh(candle, geometry(new THREE.CylinderGeometry(.16, .20, .055, 24)), gold);
    stand.position.y = .02;
    mesh(candle, geometry(new THREE.CylinderGeometry(.045, .065, .40, 20)), darkGold, [0, .22, 0]);
    mesh(candle, geometry(new THREE.CylinderGeometry(.12, .14, .055, 24)), gold, [0, .43, 0]);
    mesh(candle, geometry(new THREE.CylinderGeometry(.071, .074, .28 + (side > 0 ? .09 : 0), 20)), mat(0xe6c7a7), [0, .59, 0]);
    const fy = .77 + (side > 0 ? .045 : 0);
    flameMeshes.push(sphere(candle, lightGold, [0, fy, 0], [.035, .095, .035]));
    sphere(candle, basic(0xffad54, .07), [0, fy, 0], [.15, .22, .15]);
    const glow = new THREE.PointLight(0xffbd75, .75, 2.6); glow.position.set(x, 1.6, .05); scene.add(glow);
  }

  const figure = new THREE.Group(); scene.add(figure);
  const torso = sphere(figure, dress, [0, 1.41, -.21], [.57, .72, .32]);
  sphere(figure, dressHighlight, [0, 1.82, -.17], [.52, .28, .29]);
  // Neckline and embroidered lapels give a coherent garment rather than disconnected primitive shapes.
  sphere(figure, skin, [0, 1.98, -.06], [.155, .26, .15]);
  for (const s of [-1, 1]) {
    tube(figure, [[s * .40, 1.98, .08], [s * .25, 1.82, .15], [0, 1.62, .17]], .013, gold);
    tube(figure, [[s * .36, 1.87, .15], [s * .30, 1.45, .13], [s * .26, .89, .08]], .008, darkGold);
    for (let n = 0; n < 3; n++) tube(figure, [[s * (.12 + n * .055), 1.65, .18], [s * (.15 + n * .065), 1.33, .14], [s * (.20 + n * .07), .91, .07]], .011, fabricFold, 20);
  }
  const necklace = tube(figure, [[-.135, 2.02, .10], [-.12, 1.87, .19], [0, 1.81, .22], [.12, 1.87, .19], [.135, 2.02, .10]], .009, gold);
  necklace.name = 'necklace';
  const pendant = mesh(figure, geometry(new THREE.OctahedronGeometry(.052)), gold, [0, 1.77, .24]); pendant.scale.y = 1.5;
  for (const s of [-1, 1]) {
    for (let n = 0; n < 4; n++) {
      const bead = sphere(figure, gold, [s * (.20 + n * .045), 1.48 - n * .07, .115], [.009, .016, .006]); bead.rotation.z = s * .5;
    }
  }

  const head = new THREE.Group(); head.position.set(0, 2.37, -.06); head.scale.setScalar(1.10); figure.add(head);
  // Back hair sits behind the face. A soft tapered chin and cheek volume keep the face friendly.
  sphere(head, hair, [0, -.05, -.13], [.46, .57, .34]);
  const faceGeometry = geometry(new THREE.SphereGeometry(1, 40, 32));
  const faceVertices = faceGeometry.getAttribute('position');
  for (let n = 0; n < faceVertices.count; n++) {
    const y = faceVertices.getY(n), lower = Math.max(0, -y);
    faceVertices.setXYZ(n, faceVertices.getX(n) * .345 * (1 - lower * .22), y * .43, faceVertices.getZ(n) * .285 + Math.max(0, faceVertices.getZ(n)) * lower * .025);
  }
  faceGeometry.computeVertexNormals(); mesh(head, faceGeometry, skin, [0, 0, .025]);
  for (const s of [-1, 1]) {
    sphere(head, skin, [s * .325, -.04, -.01], [.063, .105, .05]);
    sphere(head, skinWarm, [s * .213, -.104, .225], [.061, .019, .009]);
    const earring = torus(head, .055, .012, gold, [s * .365, -.18, .025]); earring.scale.y = 1.45;
    const jewel = mesh(head, geometry(new THREE.OctahedronGeometry(.035)), mat(0x9579b9, { metalness: .45, roughness: .23 }), [s * .365, -.285, .027]); jewel.scale.y = 1.4;
  }
  // Nose is deliberately subtle and sculpted; lips are separate contours with a calm smile.
  sphere(head, skin, [0, -.033, .285], [.045, .115, .058]);
  sphere(head, skin, [0, -.106, .328], [.048, .033, .038]);
  tube(head, [[-.095, -.208, .275], [-.045, -.22, .302], [0, -.226, .309], [.045, -.22, .302], [.095, -.208, .275]], .012, lips, 18);
  tube(head, [[-.075, -.213, .28], [0, -.244, .302], [.075, -.213, .28]], .014, lips, 18);
  const eyeGroups: THREE.Group[] = [], pupilGroups: THREE.Group[] = [];
  for (const s of [-1, 1]) {
    const eye = new THREE.Group(); eye.position.set(s * .139, .034, .265); eye.rotation.z = -s * .10; head.add(eye); eyeGroups.push(eye);
    sphere(eye, eyeWhite, [0, 0, 0], [.088, .034, .018]);
    const pupil = new THREE.Group(); eye.add(pupil); pupilGroups.push(pupil);
    sphere(pupil, eyeIris, [-s * .007, 0, .018], [.029, .030, .007]);
    sphere(pupil, eyeBlack, [-s * .007, 0, .025], [.015, .019, .005]);
    sphere(pupil, paleLight, [-s * .007 - .009, .011, .030], [.006, .007, .003]);
    tube(eye, [[-.086, -.002, .005], [-.05, .031, .012], [0, .037, .015], [.05, .029, .012], [.086, -.002, .005]], .006, hair, 16);
    tube(head, [[s * .053, .125, .264], [s * .128, .142, .263], [s * .22, .122, .224]], .012, hair, 15);
    for (let n = 0; n < 3; n++) tube(eye, [[s * (.065 + n * .009), .021 - n * .006, .012], [s * (.083 + n * .012), .047 - n * .004, .014]], .0035, hair, 5);
  }
  // Side part and individual flowing locks, all attached to the head pivot.
  for (const s of [-1, 1]) {
    for (let n = 0; n < 7; n++) {
      const offset = n * .026;
      const path: Point3[] = [
        [s * (.035 + offset), .405 - offset * .12, -.01],
        [s * (.29 + offset * .45), .30 - offset * .2, .13 - offset * .3],
        [s * (.375 + Math.sin(n) * .018), .03, .02 - offset * .9],
        [s * (.39 + Math.sin(n + 2) * .035), -.30, .13 - offset],
        [s * (.40 + Math.cos(n) * .035), -.58, .24 - offset * .65],
        [s * (.33 + Math.sin(n + 1) * .035), -.86, .26 - offset * .55],
        [s * (.29 + Math.cos(n + 1) * .025), -1.04, .22 - offset * .45],
      ];
      tube(head, path, .044 + (n % 2) * .011, n % 3 ? hair : hairShine, 36);
    }
  }
  // Swept fringe leaves both eyes unobstructed.
  tube(head, [[-.05, .415, .04], [.15, .395, .16], [.30, .285, .22], [.355, .12, .13]], .06, hairShine, 30);
  const forehead = tube(head, [[-.30, .235, .20], [-.14, .255, .276], [0, .23, .29], [.14, .255, .276], [.30, .235, .20]], .009, gold);
  forehead.name = 'celestial-diadem';
  const diadem = mesh(head, geometry(new THREE.OctahedronGeometry(.039)), gold, [0, .20, .30]); diadem.scale.y = 1.6;

  const unitY = new THREE.Vector3(0, 1, 0), direction = new THREE.Vector3(), midpoint = new THREE.Vector3();
  const sleeveGeometry = geometry(new THREE.LatheGeometry([
    new THREE.Vector2(.0, -.50), new THREE.Vector2(.68, -.49), new THREE.Vector2(.9, -.40),
    new THREE.Vector2(1.02, -.25), new THREE.Vector2(1.06, -.05), new THREE.Vector2(1.03, .16),
    new THREE.Vector2(.94, .34), new THREE.Vector2(.72, .47), new THREE.Vector2(.0, .50),
  ], 24));
  const segment = (parent: THREE.Object3D, material: THREE.Material) => mesh(parent, sleeveGeometry, material);
  const aimSegment = (part: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3, startRadius: number, endRadius = startRadius) => {
    direction.copy(b).sub(a); midpoint.copy(a).add(b).multiplyScalar(.5);
    part.position.copy(midpoint); part.quaternion.setFromUnitVectors(unitY, direction.clone().normalize());
    part.scale.set((startRadius + endRadius) / 2, direction.length(), (startRadius + endRadius) / 2);
  };
  type Arm = { side: number; shoulder: THREE.Vector3; elbow: THREE.Vector3; wrist: THREE.Vector3; upper: THREE.Mesh; lower: THREE.Mesh; joint: THREE.Mesh; hand: THREE.Group; fingers: THREE.Group[]; cuff: THREE.Mesh };
  const arms: Arm[] = [];
  for (const s of [-1, 1]) {
    const shoulder = new THREE.Vector3(s * .48, 1.91, -.11);
    sphere(figure, dress, [s * .48, 1.89, -.08], [.145, .17, .17]);
    const upper = segment(figure, dress), lower = segment(figure, dress), joint = sphere(figure, dress, [0, 0, 0], [.105, .105, .105]);
    const hand = new THREE.Group(); figure.add(hand);
    sphere(hand, skin, [0, .015, 0], [.086, .035, .116]);
    const fingers: THREE.Group[] = [];
    for (let n = 0; n < 4; n++) {
      const finger = new THREE.Group(); finger.position.set((n - 1.5) * .040, .012, .075); hand.add(finger); fingers.push(finger);
      const length = [.11, .14, .133, .102][n];
      sphere(finger, skin, [0, 0, length * .38], [.020, .020, length * .63]);
      const nail = sphere(finger, lips, [0, .014, length * .85], [.014, .005, .024]); nail.rotation.x = -.12;
    }
    const thumb = new THREE.Group(); thumb.position.set(-s * .068, .007, .0); thumb.rotation.y = -s * .72; hand.add(thumb);
    sphere(thumb, skin, [0, 0, .055], [.025, .026, .067]);
    const bracelet = torus(hand, .068, .012, gold, [0, -.003, -.075]); bracelet.rotation.x = Math.PI / 2; bracelet.scale.y = .55;
    const ring = torus(fingers[2], .021, .005, gold, [0, 0, .048]); ring.rotation.x = Math.PI / 2;
    const cuff = sphere(figure, gold, [0, 0, 0], [.078, .026, .078]);
    arms.push({ side: s, shoulder, elbow: new THREE.Vector3(s * .74, 1.35, .28), wrist: new THREE.Vector3(s * .68, 1.03, .94), upper, lower, joint, hand, fingers, cuff });
  }

  // Original card back artwork rendered to a local canvas once; no network dependency.
  const cardCanvas = document.createElement('canvas'); cardCanvas.width = 256; cardCanvas.height = 384;
  const ctx = cardCanvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#26163c'; ctx.fillRect(0, 0, 256, 384);
    ctx.strokeStyle = '#cba773'; ctx.lineWidth = 4; ctx.strokeRect(13, 13, 230, 358); ctx.lineWidth = 1; ctx.strokeRect(22, 22, 212, 340);
    ctx.save(); ctx.translate(128, 192); ctx.rotate(Math.PI / 4); ctx.strokeRect(-64, -64, 128, 128); ctx.rotate(Math.PI / 4); ctx.strokeRect(-64, -64, 128, 128); ctx.restore();
    ctx.fillStyle = '#e6c992'; ctx.beginPath(); ctx.arc(121, 186, 37, .45, 5.85); ctx.fill(); ctx.fillStyle = '#26163c'; ctx.beginPath(); ctx.arc(139, 176, 34, 0, Math.PI * 2); ctx.fill();
    for (const [x, y] of [[128, 55], [128, 330], [50, 192], [205, 192]]) { ctx.fillStyle = '#e6c992'; ctx.beginPath(); ctx.moveTo(x, y - 9); ctx.lineTo(x + 4, y); ctx.lineTo(x, y + 9); ctx.lineTo(x - 4, y); ctx.closePath(); ctx.fill(); }
  }
  const cardTexture = new THREE.CanvasTexture(cardCanvas); cardTexture.colorSpace = THREE.SRGBColorSpace; textures.add(cardTexture);
  const cardMat = new THREE.MeshStandardMaterial({ map: cardTexture, roughness: .75, metalness: .08, side: THREE.DoubleSide }); materials.add(cardMat);
  const cardGeo = geometry(new THREE.BoxGeometry(.21, .012, .32));
  const cardTop = geometry(new THREE.PlaneGeometry(.21, .32));
  const cardEdgeMat = mat(0xb99b77, { roughness: .8 });
  const makeCard = (parent: THREE.Object3D) => {
    const group = new THREE.Group(); parent.add(group); mesh(group, cardGeo, cardEdgeMat);
    const top = mesh(group, cardTop, cardMat, [0, .007, 0]); top.rotation.x = -Math.PI / 2; return group;
  };
  const deckGroup = new THREE.Group(); scene.add(deckGroup);
  const deckHalves: THREE.Group[] = [];
  for (let half = 0; half < 2; half++) { const h = new THREE.Group(); deckGroup.add(h); deckHalves.push(h); for (let n = 0; n < 6; n++) { const c = makeCard(h); c.position.y = n * .014; c.rotation.y = (n % 2) * .012; } }
  const fanGroup = new THREE.Group(); fanGroup.position.set(0, .865, 1.0); scene.add(fanGroup);
  const fanCards: THREE.Group[] = [];
  for (let n = 0; n < 7; n++) { const c = makeCard(fanGroup); c.position.set((n - 3) * .155, .006 * n, Math.abs(n - 3) * -.025); c.rotation.y = -(n - 3) * .12; fanCards.push(c); }

  const orbGroup = new THREE.Group(); orbGroup.position.set(0, 1.25, .94); scene.add(orbGroup);
  const orbMaterial = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { time: { value: 0 }, intensity: { value: .45 } },
    vertexShader: 'varying vec3 vNormal; varying vec3 vPos; void main(){ vNormal=normalize(normalMatrix*normal); vPos=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: 'varying vec3 vNormal; varying vec3 vPos; uniform float time; uniform float intensity; void main(){ float rim=pow(1.0-abs(vNormal.z),2.0); float cloud=sin(vPos.x*12.0+sin(vPos.y*8.0+time*.7)*1.7+time*.4)*sin(vPos.z*9.0-vPos.y*8.0+time*.3); vec3 base=mix(vec3(.12,.06,.27),vec3(.39,.28,.68),cloud*.5+.5); base+=vec3(.38,.35,.68)*rim; base+=vec3(.08,.17,.17)*intensity; gl_FragColor=vec4(base,.85); }',
  }); materials.add(orbMaterial);
  sphere(orbGroup, orbMaterial, [0, 0, 0], [.285, .285, .285]);
  sphere(orbGroup, basic(0xb8b0ff, .035), [0, 0, 0], [.34, .34, .34]);
  sphere(orbGroup, basic(0xfff4e3, .5), [-.09, .12, .235], [.037, .069, .009]).rotation.z = -.45;
  const orbBase = torus(orbGroup, .19, .023, gold, [0, -.25, 0]); orbBase.rotation.x = Math.PI / 2;
  const orbit1 = torus(orbGroup, .37, .004, violetLight, [0, 0, 0]); orbit1.rotation.x = 1.0;
  const orbit2 = torus(orbGroup, .40, .003, violetLight, [0, 0, 0]); orbit2.rotation.x = -.65; orbit2.rotation.y = .6;
  for (let n = 0; n < 8; n++) { const a = n / 8 * Math.PI * 2; sphere(orbGroup, lightGold, [Math.cos(a) * .37, Math.sin(a) * .14, Math.sin(a) * .34], [.008, .008, .008]); }

  let state: OracleCharacterState = { action: 'welcome', motion: true, selectedIndex: 10 };
  let actionTime = 0, previousTime = 0, disposed = false;
  let orbWeight = 0, deckWeight = 1, fanWeight = 0;
  const wristGoal = new THREE.Vector3();
  function update(next: OracleCharacterState) { if (next.action !== state.action) actionTime = 0; state = next; }
  function resize() {
    if (disposed) return;
    const width = Math.max(1, container.clientWidth), height = Math.max(1, container.clientHeight);
    renderer.setSize(width, height, false); camera.aspect = width / height;
    // Keep both hands and the circular stage inside small portrait layouts.
    camera.position.z = camera.aspect < 1.15 ? 7.5 : 6.8;
    camera.updateProjectionMatrix();
  }
  function render(elapsed: number, delta: number) {
    if (disposed) return;
    const dt = Math.min(.08, Math.max(.001, delta));
    if (state.motion) actionTime += Math.max(0, elapsed - previousTime);
    previousTime = elapsed;
    const t = state.motion ? elapsed : 0;
    const pose = oracleCharacterPose(state.action, state.motion ? actionTime : 1.5, state.selectedIndex);
    const blend = state.motion ? 1 - Math.exp(-dt * 5.5) : 1;
    figure.position.y = state.motion ? Math.sin(t * 1.4) * .009 : 0;
    torso.scale.z = .32 + (state.motion ? Math.sin(t * 1.4) * .004 : 0);
    head.rotation.x = THREE.MathUtils.lerp(head.rotation.x, pose.headX, blend);
    head.rotation.y = THREE.MathUtils.lerp(head.rotation.y, pose.headY, blend);
    head.rotation.z = THREE.MathUtils.lerp(head.rotation.z, pose.headZ, blend);
    const blinkCycle = t % 5.7;
    const blink = state.motion && blinkCycle > 5.42 ? Math.max(.06, Math.abs((blinkCycle - 5.56) / .14)) : 1;
    eyeGroups.forEach(eye => { eye.scale.y = Math.min(1, blink); });
    pupilGroups.forEach(pupil => { pupil.position.y = -pose.headX * .07; pupil.position.x = pose.headY * .04; });
    arms.forEach((arm, index) => {
      wristGoal.set(...(index === 0 ? pose.left : pose.right)); arm.wrist.lerp(wristGoal, blend);
      // An elbow pole outside the torso maintains an anatomically plausible bend.
      const shoulder = arm.shoulder;
      const center = midpoint.copy(shoulder).add(arm.wrist).multiplyScalar(.5);
      const reach = shoulder.distanceTo(arm.wrist);
      const elbowOut = Math.sqrt(Math.max(.025, .76 * .76 - reach * reach * .25));
      arm.elbow.set(center.x + arm.side * elbowOut * .58, center.y - elbowOut * .53, center.z - elbowOut * .37);
      aimSegment(arm.upper, shoulder, arm.elbow, .13); aimSegment(arm.lower, arm.elbow, arm.wrist, .085);
      arm.joint.position.copy(arm.elbow); arm.hand.position.copy(arm.wrist); arm.cuff.position.copy(arm.wrist).add(new THREE.Vector3(0, .005, -.055));
      const roll = index === 0 ? pose.leftRoll : pose.rightRoll;
      arm.hand.rotation.z = THREE.MathUtils.lerp(arm.hand.rotation.z, roll, blend);
      arm.hand.rotation.x = THREE.MathUtils.lerp(arm.hand.rotation.x, state.action === 'welcome' && index === 1 ? -1.45 : -.08, blend);
      arm.hand.rotation.y = THREE.MathUtils.lerp(arm.hand.rotation.y, -arm.side * (pose.orb ? .62 : .12), blend);
      arm.fingers.forEach((finger, n) => { finger.rotation.x = (state.action === 'shuffle' ? .3 : .08) + (state.motion ? Math.sin(t * .9 + n * .7) * .025 : 0); finger.rotation.y = (n - 1.5) * .035; });
    });
    orbWeight = THREE.MathUtils.lerp(orbWeight, pose.orb, blend); deckWeight = THREE.MathUtils.lerp(deckWeight, pose.deck, blend); fanWeight = THREE.MathUtils.lerp(fanWeight, pose.fan, blend);
    orbGroup.visible = orbWeight > .015; orbGroup.scale.setScalar(Math.max(.001, orbWeight));
    orbGroup.position.y = 1.24 + (state.motion ? Math.sin(t * .8) * .018 : 0);
    orbMaterial.uniforms.time.value = t; orbMaterial.uniforms.intensity.value = state.action === 'channeling' ? .9 : .35;
    orbLight.intensity = orbWeight * (state.action === 'channeling' ? 1.1 + Math.sin(t * 1.4) * .1 : .5);
    orbit1.rotation.z = t * .13; orbit2.rotation.z = -t * .17;
    deckGroup.visible = deckWeight > .015; deckGroup.scale.setScalar(Math.max(.001, deckWeight));
    deckHalves.forEach((half, index) => {
      const s = index === 0 ? -1 : 1;
      if (state.action === 'shuffle') { half.position.copy(arms[index].wrist).add(new THREE.Vector3(-s * .095, .035, .04)); half.rotation.z = s * .12 + Math.sin(t * 3.8) * .06; half.rotation.y = s * .1; }
      else { half.position.set(s * .035, .88 + index * .08, .91); half.rotation.set(0, s * .08, 0); }
    });
    fanGroup.visible = fanWeight > .015; fanGroup.scale.setScalar(Math.max(.001, fanWeight));
    const selected = Math.round(Math.max(0, Math.min(20, state.selectedIndex)) / 20 * 6);
    fanCards.forEach((card, index) => {
      const lift = pose.reveal && index === selected ? .27 : 0;
      card.position.y = THREE.MathUtils.lerp(card.position.y, index * .006 + lift, blend);
      card.rotation.x = THREE.MathUtils.lerp(card.rotation.x, lift ? -.7 : 0, blend);
    });
    flameMeshes.forEach((flame, index) => { flame.scale.y = .095 + (state.motion ? Math.sin(t * 4.7 + index) * .007 : 0); });
    renderer.render(scene, camera);
  }
  const lost = (event: Event) => { event.preventDefault(); onContextLost(); };
  renderer.domElement.addEventListener('webglcontextlost', lost);
  try { resize(); render(0, .033); } catch (error) { dispose(); throw error; }
  function dispose() {
    if (disposed) return; disposed = true;
    renderer.domElement.removeEventListener('webglcontextlost', lost);
    geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); textures.forEach(t => t.dispose());
    renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
  }
  return { update, render, resize, dispose };
}
