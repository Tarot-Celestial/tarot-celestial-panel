'use client';
import { useEffect, useRef, useState } from 'react';
import * as T from 'three';
import type { PetId } from '@/lib/central-assistant';

type Props = { pet: PetId; state: string; reduced: boolean; onUnavailable: () => void; onReady?: () => void };

// A compact toy-like character, built from lit geometry so it stays crisp at any size.
export default function Companion3D({ pet, state, reduced, onUnavailable, onReady }: Props) {
  const host = useRef<HTMLSpanElement>(null), live = useRef({ state, reduced }); live.current = { state, reduced };
  const wakeRender = useRef<() => void>(() => {});
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const element = host.current; if (!element) return;
    let renderer: T.WebGLRenderer;
    try { renderer = new T.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' }); }
    catch { onUnavailable(); return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = T.SRGBColorSpace; renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
    renderer.setClearColor(0x000000, 0);
    element.appendChild(renderer.domElement); renderer.domElement.style.cssText = 'width:100%;height:100%;display:block;pointer-events:none';
    const scene = new T.Scene(), camera = new T.OrthographicCamera(-1.68, 1.68, 1.68, -1.68, .1, 20);
    camera.position.set(0, 1.75, 7); camera.lookAt(0, 1.53, 0);
    scene.add(new T.HemisphereLight(0xf4f4ff, 0x4d3158, 2.6));
    const key = new T.DirectionalLight(0xfff1dd, 3.3); key.position.set(-3, 5, 5); scene.add(key);
    const fill = new T.DirectionalLight(0xaddcff, 1.6); fill.position.set(3, 1, 4); scene.add(fill);
    const rim = new T.DirectionalLight(pet === 'sol' ? 0xffa648 : 0xbfa0ff, 4); rim.position.set(2, 3, -3); scene.add(rim);
    const material = (color: number, metalness = 0, roughness = .38) => new T.MeshPhysicalMaterial({ color, metalness, roughness, clearcoat: .65, clearcoatRoughness: .24 });
    const skin = material(pet === 'sol' ? 0xffbe45 : 0x8771cc, .08), rays = material(0xffa825, .16);
    const gold = material(0xffdb7f, .46, .29), violet = material(0x7b4ddd, .13), dark = material(0x29213e), face = material(0x141c32, .08, .26);
    const sole = material(0xe5ddff, .08), glow = new T.MeshStandardMaterial({ color: 0xb5fbff, emissive: 0x67dfe7, emissiveIntensity: .85, roughness: .28 });
    const blush = new T.MeshStandardMaterial({ color: pet === 'sol' ? 0xffae86 : 0xda9fee, emissive: pet === 'sol' ? 0xea8057 : 0x985eae, emissiveIntensity: .35 });
    const sphereGeometry = new T.SphereGeometry(1, 28, 20), geometries = new Set<T.BufferGeometry>([sphereGeometry]);
    function sphere(parent: T.Object3D, mat: T.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number) {
      const mesh = new T.Mesh(sphereGeometry, mat); mesh.position.set(x, y, z); mesh.scale.set(sx, sy, sz); parent.add(mesh); return mesh;
    }
    function tube(parent: T.Object3D, mat: T.Material, points: number[][], radius: number) {
      const curve = new T.CatmullRomCurve3(points.map(p => new T.Vector3(p[0], p[1], p[2])));
      const geometry = new T.TubeGeometry(curve, 18, radius, 8, false); geometries.add(geometry);
      const mesh = new T.Mesh(geometry, mat); parent.add(mesh); return mesh;
    }
    function capsule(parent: T.Object3D, mat: T.Material, radius: number, length: number, x: number, y: number, z: number, angle = 0) {
      const geometry = new T.CapsuleGeometry(radius, length, 6, 16); geometries.add(geometry);
      const mesh = new T.Mesh(geometry, mat); mesh.position.set(x, y, z); mesh.rotation.z = angle; parent.add(mesh); return mesh;
    }
    const root = new T.Group(); root.rotation.y = -.12; scene.add(root);
    const torso = new T.Group(); root.add(torso);
    sphere(torso, violet, 0, 1.01, 0, .43, .43, .3);
    sphere(torso, dark, 0, 1.10, .242, .25, .25, .067);
    tube(torso, gold, [[-.27, 1.30, .20], [-.13, 1.13, .30], [0, 1.05, .31], [.13, 1.13, .30], [.27, 1.30, .20]], .025);
    tube(torso, gold, [[0, 1.06, .31], [0, .77, .25]], .018);
    sphere(torso, glow, 0, 1.20, .311, .054, .054, .024);
    for (const sign of [-1, 1]) sphere(torso, gold, sign * .29, .88, .235, .023, .023, .018);
    const head = new T.Group(); head.position.set(0, 2.02, 0); root.add(head);
    sphere(head, skin, 0, 0, 0, .66, .61, .46);
    const crown: T.Mesh[] = [];
    if (pet === 'sol') {
      for (let i = 0; i < 7; i++) {
        const angle = (i - 3) * .46;
        crown.push(capsule(head, i % 2 ? gold : rays, .092, i === 3 ? .25 : .18, Math.sin(angle) * .61, Math.cos(angle) * .58, -.055, -angle));
      }
    } else {
      for (const sign of [-1, 1]) {
        capsule(head, gold, .073, .27, sign * .43, .58, -.07, -sign * .4);
        sphere(head, skin, sign * .64, .13, -.02, .19, .15, .095);
      }
      tube(root, skin, [[0, .80, -.18], [.4, .55, -.43], [.70, .48, -.38], [.84, .7, -.2]], .087);
      sphere(root, gold, .84, .70, -.2, .10, .13, .08);
    }
    // Independent face elements avoid squashing the eyes through nested mesh scaling.
    sphere(head, gold, 0, -.035, .397, .541, .435, .155);
    sphere(head, face, 0, -.035, .435, .505, .399, .143);
    const eyeGroups: T.Group[] = [], eyes: T.Mesh[] = [], lids: T.Mesh[] = [], brows: T.Mesh[] = [];
    for (const sign of [-1, 1]) {
      const eyeGroup = new T.Group(); eyeGroup.position.set(sign * .181, .026, .574); head.add(eyeGroup); eyeGroups.push(eyeGroup);
      eyes.push(sphere(eyeGroup, glow, 0, 0, 0, .058, .088, .023));
      sphere(eyeGroup, sole, -.017, .037, .019, .014, .02, .006);
      const lid = tube(head, glow, [[sign * .181 - .065, -.01, .591], [sign * .181, -.04, .596], [sign * .181 + .065, -.01, .591]], .013); lid.visible = false; lids.push(lid);
      brows.push(tube(head, gold, [[sign * .181 - .063, .184, .561], [sign * .181, .204, .577], [sign * .181 + .063, .184, .561]], .013));
      sphere(head, blush, sign * .335, -.139, .540, .051, .025, .012);
    }
    const smile = tube(head, glow, [[-.072, -.168, .571], [0, -.198, .588], [.072, -.168, .571]], .014);
    const mouth = sphere(head, glow, 0, -.183, .580, .035, .027, .012); mouth.visible = false;
    // Headset gives both companions the same helpful operator identity.
    tube(head, dark, [[-.65, 0, 0], [-.62, .38, -.05], [0, .65, -.11], [.62, .38, -.05], [.65, 0, 0]], .047);
    for (const sign of [-1, 1]) {
      sphere(head, dark, sign * .651, -.04, 0, .092, .174, .16);
      sphere(head, violet, sign * .715, -.04, .025, .044, .118, .116);
      sphere(head, glow, sign * .75, -.045, .05, .015, .04, .035);
    }
    tube(head, dark, [[.67, -.12, .09], [.60, -.34, .35], [.29, -.32, .53]], .023);
    sphere(head, gold, .29, -.32, .53, .06, .032, .034);
    const arms: T.Group[] = [], legs: T.Group[] = [], wings: T.Group[] = [];
    for (const sign of [-1, 1]) {
      const arm = new T.Group(); arm.position.set(sign * .4, 1.26, 0); root.add(arm); arms.push(arm);
      sphere(arm, violet, sign * .09, -.16, 0, .151, .25, .16);
      sphere(arm, gold, sign * .13, -.33, .024, .138, .05, .134);
      sphere(arm, skin, sign * .14, -.415, .032, .13, .123, .12);
      sphere(arm, skin, sign * .045, -.403, .11, .064, .070, .064);
      const leg = new T.Group(); leg.position.set(sign * .20, .71, 0); root.add(leg); legs.push(leg);
      sphere(leg, dark, 0, -.18, 0, .144, .236, .154);
      sphere(leg, sole, 0, -.415, .09, .183, .102, .245);
      sphere(leg, violet, 0, -.355, .071, .177, .105, .23);
      tube(leg, gold, [[-.075, -.33, .274], [.075, -.33, .274]], .015);
      if (pet === 'draco') {
        const wing = new T.Group(); wing.position.set(sign * .34, 1.3, -.20); root.add(wing); wings.push(wing);
        const shape = new T.Shape(); shape.moveTo(0, 0); shape.quadraticCurveTo(sign * .3, .56, sign * .64, .57); shape.lineTo(sign * .59, .05); shape.quadraticCurveTo(sign * .39, .17, sign * .31, -.11); shape.quadraticCurveTo(sign * .15, .06, 0, -.2);
        const geometry = new T.ExtrudeGeometry(shape, { depth: .035, bevelEnabled: true, bevelThickness: .012, bevelSize: .015, bevelSegments: 2, steps: 1 }); geometries.add(geometry);
        wing.add(new T.Mesh(geometry, violet)); tube(wing, skin, [[0, 0, 0], [sign * .25, .4, 0], [sign * .64, .57, 0]], .033);
      }
    }
    const tablet = new T.Group(); tablet.position.set(0, .95, .46); tablet.rotation.x = -.2; root.add(tablet);
    const tabletGeometry = new T.BoxGeometry(.52, .32, .045); geometries.add(tabletGeometry); tablet.add(new T.Mesh(tabletGeometry, dark));
    sphere(tablet, glow, 0, 0, .028, .17, .008, .007); sphere(tablet, glow, 0, -.05, .028, .12, .008, .007);
    tablet.visible = false;
    let frame = 0, last = 0, time = 0, visible = true, previousState = '', previousReduced = false, announcedReady = false;
    const schedule = () => {
      if (!frame && !document.hidden && visible) frame = requestAnimationFrame(draw);
    };
    const invalidate = () => { previousState = ''; schedule(); };
    wakeRender.current = invalidate;
    const gaze = { x: 0, y: 0 }, smoothGaze = { x: 0, y: 0 };
    const pointer = (event: PointerEvent) => {
      if (document.hidden || !visible || live.current.reduced) return;
      const rect = element.getBoundingClientRect();
      gaze.x = T.MathUtils.clamp((event.clientX - rect.x - rect.width / 2) / 650, -.32, .32);
      gaze.y = T.MathUtils.clamp((event.clientY - rect.y - rect.height / 2) / 700, -.17, .17);
    };
    const resetGaze = () => { gaze.x = 0; gaze.y = 0; };
    window.addEventListener('pointermove', pointer, { passive: true }); window.addEventListener('blur', resetGaze);
    const resize = new ResizeObserver(() => {
      const { width, height } = element.getBoundingClientRect(); if (!width || !height) return;
      renderer.setSize(width, height, false); const aspect = width / height;
      camera.left = -1.68 * Math.max(1, aspect); camera.right = -camera.left;
      camera.top = 1.68 * Math.max(1, 1 / aspect); camera.bottom = -camera.top; camera.updateProjectionMatrix(); invalidate();
    }); resize.observe(element);
    const resumeVisible = () => {
      cancelAnimationFrame(frame); frame = 0; last = 0;
      if (!document.hidden && visible) invalidate();
    };
    const observer = new IntersectionObserver(entries => { visible = entries[0]?.isIntersecting ?? true; resumeVisible(); }); observer.observe(element);
    document.addEventListener('visibilitychange', resumeVisible);
    const lost = (event: Event) => { event.preventDefault(); onUnavailable(); }; renderer.domElement.addEventListener('webglcontextlost', lost);
    const approach = (value: number, next: number, dt: number) => live.current.reduced ? next : T.MathUtils.lerp(value, next, 1 - Math.exp(-dt * 9));
    function draw(now: number) {
      frame = 0;
      if (document.hidden || !visible) return;
      if (now - last < 33 && last) { schedule(); return; }
      const { state: s, reduced: still } = live.current;
      // Reduced motion renders only state/size changes, with no gaze or breathing loop.
      if (still && previousReduced && previousState === s) return;
      const dt = Math.min((now - last) / 1000 || .033, .05); last = now; if (!still) time += dt;
      previousState = s; previousReduced = still;
      const t = time, walk = !still && s === 'walking', dance = !still && (s === 'dancing' || s === 'celebrating'), wave = !still && s === 'greeting';
      const worried = s === 'concerned' || s === 'error', thinking = s === 'thinking' || s === 'working', sleeping = s === 'sleeping', held = s === 'dragging';
      root.position.y = still ? 0 : Math.sin(t * (walk ? 11 : 2.2)) * (walk ? .035 : .018) + (dance ? Math.abs(Math.sin(t * 6)) * .13 : 0);
      root.rotation.y = approach(root.rotation.y, still ? -.12 : s === 'turning' ? Math.sin(t * 1.8) * 1.2 : -.12 + (dance ? Math.sin(t * 4) * .3 : walk ? .32 : Math.sin(t * .65) * .065), dt);
      root.rotation.z = approach(root.rotation.z, held ? -.07 : dance ? Math.sin(t * 6) * .07 : 0, dt);
      smoothGaze.x = approach(smoothGaze.x, still || sleeping ? 0 : gaze.x, dt); smoothGaze.y = approach(smoothGaze.y, still || sleeping ? 0 : gaze.y, dt);
      head.rotation.y = smoothGaze.x; head.rotation.x = approach(head.rotation.x, sleeping ? .16 : smoothGaze.y + (!still && s === 'listening' ? Math.sin(t * 3) * .025 : 0), dt);
      head.rotation.z = approach(head.rotation.z, thinking ? -.12 : worried ? .08 : wave ? -.09 : 0, dt);
      const blinkPhase = t % 4.7, blinking = !still && blinkPhase > 4.48;
      const openness = sleeping ? .04 : blinking ? Math.max(.04, Math.abs(blinkPhase - 4.59) / .11) : 1;
      eyes.forEach((eye, i) => {
        eye.scale.y = .088 * (worried ? .76 : held ? 1.2 : 1) * openness;
        eyeGroups[i].position.x = (i ? 1 : -1) * .181 + smoothGaze.x * .09;
        eyeGroups[i].position.y = .026 - smoothGaze.y * .10; eyeGroups[i].visible = openness > .15;
        lids[i].visible = openness <= .15; brows[i].rotation.z = worried ? (i ? -.10 : .10) : thinking && i === 1 ? -.08 : 0;
      });
      const talking = s === 'talking'; smile.visible = !talking && !worried && !sleeping; mouth.visible = talking || worried || sleeping;
      mouth.scale.y = talking && !still ? .025 + Math.abs(Math.sin(t * 13)) * .036 : .019;
      arms.forEach((arm, i) => {
        const sign = i === 0 ? -1 : 1;
        const x = walk ? Math.sin(t * 10 + i * Math.PI) * .5 : s === 'break' || thinking ? -.72 : 0;
        const z = !still && s === 'stretching' ? sign * 2.4 : held ? sign * 1.1 : dance ? sign * (1.65 + Math.sin(t * 7) * .30) : wave && i === 1 ? 2.25 + Math.sin(t * 9) * .30 : s === 'pointing' && i === 1 ? 1.4 : sign * .13;
        arm.rotation.x = approach(arm.rotation.x, x, dt); arm.rotation.z = approach(arm.rotation.z, z, dt);
      });
      legs.forEach((leg, i) => { leg.rotation.x = approach(leg.rotation.x, walk ? Math.sin(t * 10 + i * Math.PI) * .48 : held ? -.15 : 0, dt); leg.rotation.z = approach(leg.rotation.z, dance ? Math.sin(t * 6 + i) * .1 : 0, dt); });
      wings.forEach((wing, i) => { wing.rotation.y = (i === 0 ? 1 : -1) * (.1 + (still ? 0 : Math.sin(t * (dance ? 7 : 2)) * .12)); });
      crown.forEach((ray, i) => { ray.scale.y = still ? 1 : 1 + Math.sin(t * 2 + i * .4) * .025; });
      tablet.visible = s === 'break' || s === 'working'; renderer.render(scene, camera);
      if (!announcedReady) { announcedReady = true; setLoaded(true); onReady?.(); }
      if (!still) schedule();
    }
    schedule();
    return () => {
      wakeRender.current = () => {};
      cancelAnimationFrame(frame); resize.disconnect(); observer.disconnect(); document.removeEventListener('visibilitychange', resumeVisible); window.removeEventListener('pointermove', pointer); window.removeEventListener('blur', resetGaze); renderer.domElement.removeEventListener('webglcontextlost', lost);
      geometries.forEach(geometry => geometry.dispose()); const materials = new Set<T.Material>();
      scene.traverse(object => { if (object instanceof T.Mesh) (Array.isArray(object.material) ? object.material : [object.material]).forEach(mat => materials.add(mat)); });
      materials.forEach(mat => mat.dispose()); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
    };
  }, [pet, onUnavailable, onReady]);
  useEffect(() => { wakeRender.current(); }, [state, reduced]);
  return <span ref={host} data-companion-3d={loaded ? 'ready' : 'loading'} style={{ position: 'absolute', inset: 0, display: 'block' }} />;
}
