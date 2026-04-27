import { NextResponse } from "next/server";
import { exec } from "child_process";

export const runtime = "nodejs";

function execCmd(cmd: string) {
  return new Promise<string>((resolve, reject) => {
    exec(cmd, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout);
    });
  });
}

export async function GET() {
  try {
    const raw = await execCmd("asterisk -rx \"parking show\"");

    const lines = raw.split("\n");

    const calls = lines
      .map((line) => {
        const match = line.match(/(70\d)\s+(\S+)/);
        if (!match) return null;

        return {
          slot: match[1],
          caller: match[2],
        };
      })
      .filter(Boolean);

    return NextResponse.json({
      ok: true,
      calls,
    });
  } catch (e: any) {
    return NextResponse.json({
      ok: false,
      error: e.message,
    });
  }
}
