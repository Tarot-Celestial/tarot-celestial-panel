import { NextResponse } from 'next/server';
import { assistantAuth, checked } from '@/lib/server/central-assistant';
import { validUuid } from '@/lib/central-assistant';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(req: Request) {
  try {
    const ctx = await assistantAuth(req); if (ctx.worker.role !== 'admin') return NextResponse.json({ ok: false }, { status: 403 });
    const [workers, profiles, knowledge] = await Promise.all([checked(ctx.db.from('workers').select('id,display_name').eq('role', 'central').order('display_name')), checked(ctx.db.from('central_assistant_profiles').select('worker_id,pet')),checked(ctx.db.from('central_assistant_knowledge').select('topic,content,version,created_at').order('created_at',{ascending:false}).limit(100))]);
    return NextResponse.json({ ok: true, workers, profiles, knowledge }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch { return NextResponse.json({ ok: false, error: 'No se pudieron cargar las asignaciones.' }, { status: 503 }); }
}
export async function POST(req: Request) {
  try {
    const ctx = await assistantAuth(req); if (ctx.worker.role !== 'admin') return NextResponse.json({ ok: false }, { status: 403 });
    const body = await req.json();
    if(body.action==='knowledge'){
      if(typeof body.topic!=='string'||!body.topic.trim()||body.topic.length>80||typeof body.content!=='string'||!body.content.trim()||body.content.length>4000)return NextResponse.json({ok:false},{status:400});
      const last=await checked(ctx.db.from('central_assistant_knowledge').select('version').eq('topic',body.topic.trim()).order('version',{ascending:false}).limit(1));
      await checked(ctx.db.from('central_assistant_knowledge').insert({topic:body.topic.trim(),content:body.content.trim(),version:(last[0]?.version||0)+1,approved_by:ctx.worker.id}));
      return NextResponse.json({ok:true});
    }
    if (!validUuid(body.worker_id) || !['sol', 'draco'].includes(body.pet)) return NextResponse.json({ ok: false }, { status: 400 });
    const worker = await checked(ctx.db.from('workers').select('id').eq('id', body.worker_id).eq('role', 'central').maybeSingle());
    if (!worker) return NextResponse.json({ ok: false }, { status: 404 });
    await checked(ctx.db.from('central_assistant_profiles').upsert({ worker_id: body.worker_id, pet: body.pet, updated_at: new Date().toISOString() }, { onConflict: 'worker_id' }));
    await checked(ctx.db.from('central_assistant_audit').insert({worker_id:body.worker_id,actor_worker_id:ctx.worker.id,action:`assign_pet:${body.pet}`}));
    return NextResponse.json({ ok: true });
  } catch { return NextResponse.json({ ok: false, error: 'No se pudo guardar la asignación.' }, { status: 503 }); }
}
