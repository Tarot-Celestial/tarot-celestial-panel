const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const { PGlite } = require("@electric-sql/pglite");

let db;
const admin = randomUUID();
const png = Buffer.from("89504e470d0a1a0a1234", "hex");
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const all = async (sql, values=[]) => (await db.query(sql, values)).rows;
const request = () => ({ action:"create_task", instagram_publication:"photo", request_id:randomUUID(),
  file_name:"prueba.png", file_type:"image/png", file_alt:"Ilustración sintética", file_sha256:digest(png), file_base64:png.toString("base64") });
const order = async input => (await all("select office_create_instagram_order_with_file($1,$2) as receipt", [admin,input]))[0].receipt;

before(async () => {
  db = new PGlite();
  await db.exec("create role anon; create role authenticated; create role service_role bypassrls");
  await db.exec([
    "create table office_runs(id uuid primary key, task_id uuid not null default gen_random_uuid(), actor_id uuid not null, result_version_id uuid)",
    "create table office_versions(id uuid primary key, task_id uuid, version int, file_type text, file_name text, file_bytes bytea)",
    "create table office_instagram_posts(request_id uuid, task_id uuid, version_id uuid, original_sha256 text, media_sha256 text, alt_text text)",
    "create table office_events(department_id text,task_id uuid,actor_id uuid,kind text,note text,details jsonb)",
    "create function office_actor(who uuid) returns uuid language sql as $$select who$$",
    "create function office_create_instagram_order(p_user uuid,p_input jsonb) returns jsonb language plpgsql as $$" +
      "declare r public.office_runs; begin insert into public.office_runs(id,actor_id) values((p_input->>'request_id')::uuid,p_user) on conflict do nothing; " +
      "select * into r from public.office_runs where id=(p_input->>'request_id')::uuid; return jsonb_build_object('run_id',r.id,'id',r.task_id); end $$",
    "grant select,insert,update on office_runs,office_versions,office_instagram_posts,office_events to service_role",
  ].join(";"));
  const schema = path.join(__dirname,"../supabase/migrations/20261123013312_office_atlas_order_attachment.sql");
  await db.exec(fs.readFileSync(schema,"utf8"));
  await db.exec("set role service_role");
});
after(async () => { if (db) await db.close(); });

test("el encargo conserva el adjunto y su huella, es idempotente y no expone los bytes a clientes", async () => {
  const input = request(), {run_id} = await order(input);
  assert.equal((await order(input)).run_id,run_id);
  const [row] = await all("select f.sha256,r.instagram_source_sha256,f.file_bytes,f.file_alt from office_instagram_order_files f join office_runs r on r.id=f.run_id where f.run_id=$1",[run_id]);
  assert.equal(row.sha256,input.file_sha256); assert.equal(row.instagram_source_sha256,input.file_sha256);
  assert.deepEqual(Buffer.from(row.file_bytes),png); assert.equal(row.file_alt,input.file_alt);
  assert.equal((await all("select count(*)::int n from office_events where details->>'run_id'=$1",[run_id]))[0].n,1);
  await assert.rejects(order({...input,file_alt:"Otra descripción"}),/OFFICE_CONFLICT/);
  await assert.rejects(db.query("update office_instagram_order_files set file_name='otro.png'"),/permission denied/);
  await db.exec("reset role; set role authenticated");
  try {
    await assert.rejects(all("select * from office_instagram_order_files"),/permission denied/);
    await assert.rejects(order(input),/permission denied/);
  } finally { await db.exec("reset role; set role service_role"); }
});

test("una discordancia de formato, descripción, bytes o hash revierte también la creación del encargo", async () => {
  const input = request();
  const wrong = Buffer.from("archivo diferente");
  for (const patch of [
    {instagram_publication:"reel"}, {file_sha256:"0".repeat(64)}, {file_alt:""}, {file_name:"incorrecto.mp4"},
    {file_base64:wrong.toString("base64"),file_sha256:digest(wrong)},
  ]) {
    await assert.rejects(order({...input,...patch}));
    assert.equal((await all("select id from office_runs where id=$1",[input.request_id])).length,0);
  }
});

test("solo la versión exacta y su descripción autorizan el transporte; el MP4 conserva su hash al publicarse", async () => {
  const video = Buffer.from("000000186674797069736f6d00000000", "hex");
  for (const bytes of [png, video]) {
    const input = request();
    if (bytes === video) Object.assign(input,{instagram_publication:"reel",file_type:"video/mp4",file_name:"video.mp4",
      file_sha256:digest(video),file_base64:video.toString("base64"),file_alt:""});
    const {id,run_id} = await order(input), version = randomUUID(), wrong = randomUUID();
    await db.query("insert into office_versions values($1,$2,1,$3,$4,$5),($6,$2,1,$3,$4,$7)",
      [version,id,input.file_type,input.file_name,bytes,wrong,Buffer.from("otro archivo")]);
    const post = (v, sha, rendered, alt) => db.query("insert into office_instagram_posts values($1,$2,$3,$4,$5,$6)",
      [run_id,id,v,sha,rendered,alt]);
    await db.query("update office_runs set result_version_id=$1 where id=$2",[wrong,run_id]);
    await assert.rejects(post(wrong,input.file_sha256,input.file_sha256,input.file_alt),/OFFICE_IG_APPROVAL_INVALID/);
    await db.query("update office_runs set result_version_id=$1 where id=$2",[version,run_id]);
    await assert.rejects(post(wrong,input.file_sha256,input.file_sha256,input.file_alt),/OFFICE_IG_APPROVAL_INVALID/);
    await assert.rejects(post(version,input.file_sha256,input.file_sha256,"Texto distinto"),/OFFICE_IG_APPROVAL_INVALID/);
    if (bytes === video) await assert.rejects(post(version,input.file_sha256,"0".repeat(64),input.file_alt),/OFFICE_IG_APPROVAL_INVALID/);
    const rendered = bytes === video ? input.file_sha256 : digest(Buffer.from("JPEG convertido"));
    await post(version,input.file_sha256,rendered,input.file_alt);
    assert.equal((await all("select * from office_instagram_posts where request_id=$1",[run_id])).length,1);
  }
});
