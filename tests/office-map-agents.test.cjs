const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const React = require("react");
const { act, create } = require("react-test-renderer");
const ts = require("typescript");

const initial = { id: "entrega-1", taskId: "cohorte:2026-04", taskTitle: "Cohorte de abril",
  from: "captacion-reservas", to: "inteligencia", what: "Altas y primeras compras comprobadas", at: "2026-04-30T08:00:00Z" };
const followup = { ...initial, id: "entrega-2", from: "inteligencia", to: "finanzas", at: "2026-04-30T08:00:01Z" };
const final = { ...initial, id: "entrega-3", from: "finanzas", to: "atlas", at: "2026-04-30T08:00:02Z" };

function fixture(reduced = false) {
  const cache = new Map(), animations = [], opened = [], listeners = new Map();
  const media = { matches: reduced, addEventListener: (key, fn) => listeners.set(key, fn), removeEventListener: key => listeners.delete(key) };
  const document = { hidden: false, addEventListener() {}, removeEventListener() {} };
  function load(name) {
    if (cache.has(name)) return cache.get(name);
    const dir = path.join(__dirname, "../src/features/office", name);
    const file = [dir + ".ts", dir + ".tsx"].find(fs.existsSync);
    const js = ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
    } }).outputText;
    const exports = {};
    vm.runInNewContext(js, { exports, Date, Intl, document, window: { matchMedia: () => media }, require(spec) {
      if (spec.endsWith(".css")) return { default: {} };
      if (spec === "@/lib/atlas-identity") return { ATLAS_IDENTITY: { image: "/companions/atlas-universal-v1.png" } };
      return spec.startsWith("./") ? load(spec.slice(2)) : require(spec);
    } });
    cache.set(name, exports); return exports;
  }
  let tree;
  return { load, animations, opened,
    async show(records, props) {
      const element = React.createElement(load("OfficeMap").default, { view: "map", selectedId: "marketing", onSelect() {},
        tasks: [], handoffs: records, onOpenTask: id => opened.push(id), ...props });
      await act(async () => {
        if (tree) tree.update(element);
        else tree = create(element, { createNodeMock: el => el.props["data-transfer"] ? { animate(frames, options) {
          const animation = { frames, options, cancelled: false, cancel() { this.cancelled = true; } };
          animations.push(animation); return animation;
        } } : null });
      });
    },
    get nodes() { return tree.root; }, get text() { return JSON.stringify(tree.toJSON()); },
    async button(label) {
      const button = tree.root.findAllByType("button").find(el => el.children.includes(label));
      assert.ok(button, label); await act(async () => button.props.onClick());
    },
    async finish() { const callback = animations.at(-1)?.onfinish; assert.ok(callback); await act(async () => callback()); },
    async reduceMotion() { media.matches = true; await act(async () => listeners.get("change")()); },
    async close() { await act(async () => tree.unmount()); },
  };
}

test("sitúa los dieciséis puestos y conecta escritorios por tramos de pasillo con velocidad proporcional", () => {
  const f = fixture(), { officeRoute, officeDesk, routeTiming, mapHandoffs } = f.load("office-map-activity");
  const stations = [...f.load("catalog").officeDepartments.map(s => s.id), "atlas"];
  for (const from of stations) for (const to of stations) {
    const points = officeRoute(from, to), timing = routeTiming(points);
    assert.deepEqual(points[0], officeDesk(from)); assert.deepEqual(points.at(-1), officeDesk(to));
    for (let i = 1; i < points.length; i++) {
      assert.ok(points[i].x === points[i - 1].x || points[i].y === points[i - 1].y);
      assert.ok(timing.frames[i].offset > timing.frames[i - 1].offset);
    }
    if (from !== to) assert.equal(timing.frames.at(-1).offset, 1);
  }
  assert.ok(officeRoute("captacion-reservas", "inteligencia").some(p => p.x === 50));
  assert.equal(mapHandoffs([initial, initial, { ...followup, from: "unknown" }, { ...final, at: "sin fecha" }]).length, 1);
});

test("esperan sin eventos y reproducen una vez la última entrega histórica y, por orden, únicamente las nuevas", async () => {
  const f = fixture();
  try {
    await f.show([]);
    assert.match(f.text, /Agentes en espera/);
    assert.equal(f.nodes.findAllByType("img").filter(img => img.props.src === "/office/agente-celestial.webp").length, 15);
    assert.equal(f.animations.length, 0);
    await f.show([initial], { loadingActivity: true }); assert.equal(f.animations.length, 0);
    await f.show([initial]); assert.equal(f.animations.length, 1);
    assert.match(f.text, /Última entrega/); assert.match(f.text, /Altas y primeras compras comprobadas/);
    await f.finish(); await f.show([{ ...initial }]); assert.equal(f.animations.length, 1);
    await f.show([final, followup, initial]);
    assert.equal(f.nodes.findByProps({ "data-transfer": followup.id }).type, "span");
    await f.finish(); assert.equal(f.nodes.findByProps({ "data-transfer": final.id }).type, "span");
    await f.finish(); assert.equal(f.animations.length, 3);
    await f.button("Abrir informe"); assert.deepEqual(f.opened, ["cohorte:2026-04"]);
  } finally { await f.close(); }
});

test("detener persiste cuando llegan datos y movimiento reducido conserva fecha, tarea y ruta estática", async () => {
  const f = fixture();
  try {
    await f.show([initial]); await f.button("Detener recorrido");
    assert.equal(f.animations[0].cancelled, true);
    await f.show([followup, initial]); assert.equal(f.animations.length, 1);
    await f.button("Reproducir recorrido"); assert.equal(f.animations.length, 2);
    await f.reduceMotion(); assert.equal(f.animations[1].cancelled, true);
    await f.show([final, followup, initial]); assert.equal(f.animations.length, 2);
    assert.match(f.text, /Recorrido estático/); assert.match(f.text, /Cohorte de abril/);
    assert.doesNotMatch(f.text, /Reproducir recorrido|Detener recorrido/);
    assert.ok(f.nodes.findAllByType("time").every(t => t.props.dateTime));
  } finally { await f.close(); }
});

test("un fallo de consulta se muestra como error y un encargo abierto mantiene su origen real", async () => {
  const f = fixture(true);
  try {
    const task = { id: "encargo", department_id: "marketing", objective: "Entregar pieza", status: "en_curso" };
    await f.show([], { activityError: "No se pudo consultar la actividad.", tasks: [task] });
    assert.doesNotMatch(f.text, /Agentes en espera/);
    assert.match(f.text, /No se pudo consultar la actividad/);
    await f.button("Entregar pieza"); assert.deepEqual(f.opened, ["encargo"]);
  } finally { await f.close(); }
});
