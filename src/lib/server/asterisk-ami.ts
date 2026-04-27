import net from "net";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

type AmiResponse = {
  ok: boolean;
  raw: string;
  error?: string;
};

type ExtensionLiveState = {
  registered: boolean;
  status: "offline" | "registered" | "ringing" | "in_call";
  active_call_count: number;
  talking_to: string | null;
  active_call_started_at: string | null;
};

export type AsteriskLiveSnapshot = {
  ok: boolean;
  extensions: Record<string, ExtensionLiveState>;
  error?: string;
};

const HAS_EXPLICIT_AMI_HOST = Boolean(process.env.ASTERISK_AMI_HOST);
const DEFAULT_AMI_HOST = process.env.ASTERISK_AMI_HOST || "127.0.0.1";
const DEFAULT_AMI_PORT = Number(process.env.ASTERISK_AMI_PORT || 5038);
const DEFAULT_AMI_USER = process.env.ASTERISK_AMI_USER || "panel";
const DEFAULT_AMI_SECRET = process.env.ASTERISK_AMI_SECRET || "superpassword123";
const AMI_TIMEOUT_MS = Number(process.env.ASTERISK_AMI_TIMEOUT_MS || 2500);

function getAmiConfig() {
  return {
    host: DEFAULT_AMI_HOST,
    port: DEFAULT_AMI_PORT,
    username: DEFAULT_AMI_USER,
    secret: DEFAULT_AMI_SECRET,
    timeoutMs: AMI_TIMEOUT_MS,
  };
}

function writeAction(socket: net.Socket, fields: Record<string, string>) {
  const body = Object.entries(fields)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\r\n");
  socket.write(`${body}\r\n\r\n`);
}

async function localCliCommand(command: string): Promise<AmiResponse> {
  try {
    const { stdout, stderr } = await execFileAsync("asterisk", ["-rx", command], { timeout: AMI_TIMEOUT_MS });
    return { ok: true, raw: String(stdout || stderr || "") };
  } catch (error: any) {
    return { ok: false, raw: String(error?.stdout || error?.stderr || ""), error: error?.message || "ASTERISK_LOCAL_CLI_FAILED" };
  }
}

async function sshCliCommand(command: string): Promise<AmiResponse> {
  const host = process.env.ASTERISK_SSH_HOST || process.env.ASTERISK_HOST || "";
  if (!host) return { ok: false, raw: "", error: "ASTERISK_SSH_HOST_NOT_SET" };

  const user = process.env.ASTERISK_SSH_USER || "root";
  const port = process.env.ASTERISK_SSH_PORT || "22";
  const key = process.env.ASTERISK_SSH_KEY_PATH || "";
  const remote = `${user}@${host}`;
  const args = ["-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=4", "-p", port];
  if (key) args.push("-i", key);
  args.push(remote, "asterisk", "-rx", command);

  try {
    const { stdout, stderr } = await execFileAsync("ssh", args, { timeout: Math.max(AMI_TIMEOUT_MS, 5000) });
    return { ok: true, raw: String(stdout || stderr || "") };
  } catch (error: any) {
    return { ok: false, raw: String(error?.stdout || error?.stderr || ""), error: error?.message || "ASTERISK_SSH_CLI_FAILED" };
  }
}

async function cliCommand(command: string): Promise<AmiResponse> {
  if (process.env.ASTERISK_SSH_HOST || process.env.ASTERISK_HOST) {
    const ssh = await sshCliCommand(command);
    if (ssh.ok || ssh.raw) return ssh;
  }

  if (process.env.ASTERISK_CLI_LOCAL === "1" || !process.env.VERCEL) {
    const local = await localCliCommand(command);
    if (local.ok || local.raw) return local;
  }

  return {
    ok: false,
    raw: "",
    error: "ASTERISK_NOT_CONFIGURED: set ASTERISK_AMI_HOST for remote AMI, or ASTERISK_SSH_HOST/ASTERISK_SSH_USER for remote CLI.",
  };
}

function amiCommandOnly(command: string): Promise<AmiResponse> {
  const cfg = getAmiConfig();

  return new Promise((resolve) => {
    let settled = false;
    let raw = "";
    const socket = net.createConnection(cfg.port, cfg.host);

    const finish = (response: AmiResponse) => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch {
        // noop
      }
      resolve(response);
    };

    const timer = setTimeout(() => {
      finish({ ok: false, raw, error: "AMI_TIMEOUT" });
    }, cfg.timeoutMs);

    socket.on("connect", () => {
      writeAction(socket, { Action: "Login", Username: cfg.username, Secret: cfg.secret, Events: "off" });
      writeAction(socket, { Action: "Command", Command: command });
      writeAction(socket, { Action: "Logoff" });
    });

    socket.on("data", (chunk) => {
      raw += chunk.toString("utf8");
      if (raw.includes("Message: Thanks for all the fish") || raw.includes("Response: Goodbye")) {
        clearTimeout(timer);
        const loginFailed = /Message:\s*Authentication failed/i.test(raw);
        finish({ ok: !loginFailed, raw, error: loginFailed ? "AMI_AUTH_FAILED" : undefined });
      }
    });

    socket.on("error", (err) => {
      clearTimeout(timer);
      finish({ ok: false, raw, error: err.message });
    });

    socket.on("close", () => {
      clearTimeout(timer);
      if (!settled) finish({ ok: raw.length > 0, raw });
    });
  });
}

export async function amiCommand(command: string): Promise<AmiResponse> {
  if (HAS_EXPLICIT_AMI_HOST) {
    const ami = await amiCommandOnly(command);
    if (ami.ok) return ami;

    const cli = await cliCommand(command);
    if (cli.ok || cli.raw) return cli;
    return { ok: false, raw: ami.raw || cli.raw, error: `${ami.error || "AMI_FAILED"}; ${cli.error || "CLI_FAILED"}` };
  }

  return cliCommand(command);
}

function parseCommandOutput(raw: string) {
  const output = raw
    .split(/\r?\n/)
    .filter((line) => /^Output:\s*/.test(line))
    .map((line) => line.replace(/^Output:\s?/, ""))
    .join("\n");

  // AMI Command responses prefix each line with Output:. CLI/SSH returns plain text.
  return output || String(raw || "");
}

function digits(value: string | null | undefined) {
  return String(value || "").replace(/\D/g, "");
}

function extractEndpointFromChannel(channel: string) {
  const match = String(channel || "").match(/^PJSIP\/([^/-]+)-/);
  return match?.[1] || null;
}

function extractPeer(value: string) {
  const clean = String(value || "");
  const dialMatch = clean.match(/PJSIP\/([^@,\s]+)/);
  if (dialMatch?.[1]) return dialMatch[1].replace(/^\+34/, "");
  const sipMatch = clean.match(/sip:([^@>;]+)/i);
  if (sipMatch?.[1]) return sipMatch[1].replace(/^\+34/, "");
  const numberMatch = clean.match(/\+?\d{5,15}/);
  if (numberMatch?.[0]) return numberMatch[0].replace(/^\+34/, "");
  return null;
}

function normalizeChannelState(state: string, app: string, data: string) {
  const s = String(state || "").toLowerCase();
  const a = String(app || "").toLowerCase();
  const d = String(data || "").toLowerCase();
  if (s.includes("ring") || a.includes("dial") || d.includes("ring")) return "ringing" as const;
  return "in_call" as const;
}

function markRegistered(map: Record<string, ExtensionLiveState>, extension: string) {
  const ext = digits(extension);
  if (!ext) return;
  map[ext] = {
    registered: true,
    status: map[ext]?.status === "in_call" || map[ext]?.status === "ringing" ? map[ext].status : "registered",
    active_call_count: map[ext]?.active_call_count || 0,
    talking_to: map[ext]?.talking_to || null,
    active_call_started_at: map[ext]?.active_call_started_at || null,
  };
}

function markCall(map: Record<string, ExtensionLiveState>, extension: string, peer: string | null, ringing = false) {
  const ext = digits(extension);
  if (!ext) return;
  const previous = map[ext];
  map[ext] = {
    registered: previous?.registered !== false,
    status: ringing ? "ringing" : "in_call",
    active_call_count: Math.max(1, Number(previous?.active_call_count || 0) + 1),
    talking_to: peer || previous?.talking_to || null,
    active_call_started_at: previous?.active_call_started_at || new Date().toISOString(),
  };
}

export type ParkedCallInfo = {
  slot: string;
  parkingLot: string | null;
  channel: string | null;
  caller: string | null;
  timeoutSeconds: number | null;
  raw: string;
};

export type AsteriskParkingSnapshot = {
  ok: boolean;
  calls: ParkedCallInfo[];
  raw?: string;
  error?: string;
};

export type AsteriskIncomingCallInfo = {
  id: string;
  channel: string;
  caller: string | null;
  did: string | null;
  state: string | null;
  app: string | null;
  data: string | null;
  context: string | null;
  exten: string | null;
  durationSeconds: number | null;
  raw: string;
};

export type AsteriskIncomingSnapshot = {
  ok: boolean;
  calls: AsteriskIncomingCallInfo[];
  raw?: string;
  error?: string;
};

function parseParkingShow(output: string): ParkedCallInfo[] {
  const calls: ParkedCallInfo[] = [];
  const seen = new Set<string>();
  const text = String(output || "");

  const pushCall = (slot: string | null, raw: string, channel?: string | null, callerRaw?: string | null, timeoutRaw?: string | null) => {
    if (!slot || seen.has(slot)) return;
    seen.add(slot);
    const caller = extractPeer(callerRaw || "") || digits(callerRaw) || extractPeer(channel || "") || null;
    calls.push({
      slot,
      parkingLot: raw.match(/Parking\s*Lot\s*[:=]\s*([^\r\n]+)/i)?.[1]?.trim() || "default",
      channel: channel || null,
      caller,
      timeoutSeconds: timeoutRaw ? Number(timeoutRaw) : null,
      raw,
    });
  };

  for (const line of text.split(/\r?\n/)) {
    const row = line.trim();
    if (!row) continue;

    const tableMatch = row.match(/^(?:Space\s+)?(\d{3,})\s*:?\s+(PJSIP\/\S+|SIP\/\S+|Local\/\S+)(.*)$/i);
    if (tableMatch) {
      const rest = tableMatch[3] || "";
      const timeout = rest.match(/(?:timeout|expires|left)\D*(\d{1,4})/i)?.[1] || rest.match(/\b(\d{1,4})\b/)?.[1] || null;
      const caller = rest.match(/(?:caller|cid|from)\D*(\+?\d{5,15})/i)?.[1] || rest.match(/(\+?\d{5,15})/)?.[1] || null;
      pushCall(tableMatch[1], row, tableMatch[2], caller, timeout);
      continue;
    }

    const slotOnly = row.match(/(?:Parking\s+Space|Space)\s*[:=]\s*(\d{3,})/i);
    if (slotOnly) {
      const channel = row.match(/(PJSIP\/\S+|SIP\/\S+|Local\/\S+)/i)?.[1] || null;
      const caller = row.match(/(?:caller|cid|from)\D*(\+?\d{5,15})/i)?.[1] || row.match(/(\+?\d{5,15})/)?.[1] || null;
      const timeout = row.match(/(?:timeout|expires|left)\D*(\d{1,4})/i)?.[1] || null;
      pushCall(slotOnly[1], row, channel, caller, timeout);
    }
  }

  const blocks = text
    .split(/(?=\n?\s*(?:Parking Space|Space)\s*[:=]?\s*\d{3,})/i)
    .map((value) => value.trim())
    .filter(Boolean);

  for (const block of blocks) {
    const slot = block.match(/(?:Parking Space|Space)\s*[:=]?\s*(\d{3,})/i)?.[1] || block.match(/^\s*(\d{3,})\s+/m)?.[1] || null;
    const channel = block.match(/Channel\s*[:=]\s*([^\r\n]+)/i)?.[1]?.trim() || block.match(/(PJSIP\/[A-Za-z0-9_.+@-]+)/)?.[1] || null;
    const callerRaw = block.match(/(?:Caller\s*ID|Parker\s*Caller\s*ID|From)\s*[:=]\s*([^\r\n]+)/i)?.[1]?.trim() || block.match(/(?:CID|CallerID)\s*[:=]\s*([^\r\n]+)/i)?.[1]?.trim() || null;
    const timeoutRaw = block.match(/(?:Timeout|Time(?:\s*Left)?)\s*[:=]?\s*(\d+)/i)?.[1] || null;
    pushCall(slot, block, channel, callerRaw, timeoutRaw);
  }

  return calls.sort((a, b) => Number(a.slot) - Number(b.slot));
}

function parseIncomingShowChannels(output: string): AsteriskIncomingCallInfo[] {
  const calls: AsteriskIncomingCallInfo[] = [];
  const seen = new Set<string>();

  for (const rawLine of String(output || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || !line.includes("!")) continue;

    const parts = line.split("!");
    const channel = parts[0] || "";
    const context = parts[1] || "";
    const exten = parts[2] || "";
    const state = parts[4] || "";
    const app = parts[5] || "";
    const data = parts[6] || "";
    const callerId = parts[7] || "";
    const duration = parts[10] || "";
    const bridgedChannel = parts[11] || "";
    const uniqueId = parts[12] || parts[13] || channel;

    const isInboundContext = context === "from-trunk" || context === "from-pstn" || context === "default";
    const isInboundChannel = /PJSIP\/.*(?:premium|trunk|b2com|from)/i.test(channel) || isInboundContext;
    const isCentralDial = /PJSIP\/10\d{2}/.test(data) || /PJSIP\/(100[0-6])/.test(bridgedChannel);
    const isWaitingApp = /^(Dial|Queue|Wait|Ringing|Progress|Playback|Park)$/i.test(app);
    const alreadyParked = /ParkedCall|Park\(/i.test(app) || /parkedcalls/i.test(context);

    if (!isInboundChannel || alreadyParked) continue;
    if (!isInboundContext && !isCentralDial && !isWaitingApp) continue;

    const id = String(uniqueId || channel);
    if (seen.has(id)) continue;
    seen.add(id);

    const caller = digits(callerId) || extractPeer(channel) || extractPeer(data) || null;
    const did = /^\d+$/.test(exten) ? exten : extractPeer(data);
    const durationSeconds = Number(duration || 0);

    calls.push({
      id,
      channel,
      caller,
      did: did || null,
      state: state || null,
      app: app || null,
      data: data || null,
      context: context || null,
      exten: exten || null,
      durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : null,
      raw: line,
    });
  }

  return calls.sort((a, b) => Number(b.durationSeconds || 0) - Number(a.durationSeconds || 0));
}

export async function getAsteriskIncomingSnapshot(): Promise<AsteriskIncomingSnapshot> {
  try {
    const res = await amiCommand("core show channels concise");
    const output = parseCommandOutput(res.raw);
    return {
      ok: res.ok,
      calls: res.ok ? parseIncomingShowChannels(output) : [],
      raw: output || res.raw,
      error: res.error,
    };
  } catch (error: any) {
    return { ok: false, calls: [], error: error?.message || "AMI_INCOMING_ERROR" };
  }
}

export async function getAsteriskParkingSnapshot(): Promise<AsteriskParkingSnapshot> {
  try {
    const res = await amiCommand("parking show");
    const output = parseCommandOutput(res.raw);
    return {
      ok: res.ok,
      calls: res.ok ? parseParkingShow(output) : [],
      raw: output || res.raw,
      error: res.error,
    };
  } catch (error: any) {
    return { ok: false, calls: [], error: error?.message || "AMI_PARKING_ERROR" };
  }
}

export async function refreshPjsipRealtimeObject(extension: string) {
  const ext = digits(extension);
  if (!ext) return { ok: false, error: "NO_EXTENSION" };

  // Asterisk 20 installations vary in the exact Sorcery CLI commands exposed.
  // Try the lightweight cache-expire commands first, then fall back to pjsip reload.
  const commands = [
    `sorcery memory cache expire object res_pjsip endpoint ${ext}`,
    `sorcery memory cache expire object res_pjsip auth ${ext}`,
    `sorcery memory cache expire object res_pjsip aor ${ext}`,
    `pjsip reload`,
  ];

  const results = [] as AmiResponse[];
  for (const command of commands) {
    // eslint-disable-next-line no-await-in-loop
    results.push(await amiCommand(command));
  }

  return {
    ok: results.some((item) => item.ok),
    results: results.map((item, index) => ({ command: commands[index], ok: item.ok, error: item.error, raw: item.raw.slice(0, 1000) })),
  };
}

export async function getAsteriskLiveSnapshot(): Promise<AsteriskLiveSnapshot> {
  try {
    const [contactsRes, channelsRes] = await Promise.all([
      amiCommand("pjsip show contacts"),
      amiCommand("core show channels concise"),
    ]);

    const extensions: Record<string, ExtensionLiveState> = {};

    if (contactsRes.ok) {
      const contacts = parseCommandOutput(contactsRes.raw);
      for (const line of contacts.split(/\r?\n/)) {
        const match = line.match(/Contact:\s+(\d+)\//);
        if (match?.[1]) markRegistered(extensions, match[1]);
      }
    }

    if (channelsRes.ok) {
      const channels = parseCommandOutput(channelsRes.raw);
      for (const line of channels.split(/\r?\n/)) {
        if (!line || !line.includes("PJSIP/")) continue;
        const parts = line.split("!");
        const channel = parts[0] || "";
        const context = parts[1] || "";
        const exten = parts[2] || "";
        const state = parts[4] || "";
        const app = parts[5] || "";
        const data = parts[6] || "";
        const callerId = parts[7] || "";
        const bridgedChannel = parts[11] || "";

        const channelExt = extractEndpointFromChannel(channel);
        const bridgeExt = extractEndpointFromChannel(bridgedChannel);
        const channelStatus = normalizeChannelState(state, app, data);
        const isRinging = channelStatus === "ringing";
        const peer = extractPeer(data) || extractPeer(bridgedChannel) || digits(callerId) || digits(exten) || null;

        if (channelExt && /^\d{2,6}$/.test(channelExt)) {
          markCall(extensions, channelExt, peer && peer !== channelExt ? peer : null, isRinging);
        }

        if (bridgeExt && /^\d{2,6}$/.test(bridgeExt)) {
          markCall(extensions, bridgeExt, peer && peer !== bridgeExt ? peer : null, isRinging);
        }

        if (/^\d{2,6}$/.test(exten) && context === "from-trunk") {
          markCall(extensions, exten, digits(callerId) || null, true);
        }
      }
    }

    return { ok: contactsRes.ok || channelsRes.ok, extensions };
  } catch (error: any) {
    return { ok: false, extensions: {}, error: error?.message || "AMI_ERROR" };
  }
}
