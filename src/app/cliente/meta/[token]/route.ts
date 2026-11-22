import { NextResponse } from "next/server";
import { metaPanelCookie, tokenDigest, validPanelToken } from "@/lib/server/office-meta-attribution";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: { token: string } }) {
  const token = params.token;
  const ref=validPanelToken(token) ? tokenDigest(token).slice(0,24) : null;
  const response = NextResponse.redirect(new URL(ref ? "/cliente/vincular-meta?ref="+ref : "/cliente/login", req.url), 303);
  response.headers.set("Cache-Control","private, no-store");
  response.headers.set("Referrer-Policy","no-referrer");
  response.headers.set("X-Robots-Tag","noindex, nofollow");
  if (ref) response.cookies.set(metaPanelCookie(ref),token,{httpOnly:true,secure:process.env.NODE_ENV==="production",
    sameSite:"lax",path:"/api/cliente/meta-attribution",maxAge:30*86400});
  return response;
}
