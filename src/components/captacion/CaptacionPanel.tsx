// MODIFIED: fix load captacion
async function load() {
  const res = await fetch("/api/captacion/list", { cache: "no-store" });
  const json = await res.json();
  if (json?.ok) setItems(json.items || []);
}
