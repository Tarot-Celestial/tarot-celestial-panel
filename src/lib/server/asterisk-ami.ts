import net from "net";

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

export function amiCommand(command: string): Promise<AmiResponse> {
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

function parseCommandOutput(raw: string) {
  return raw
    .split(/\r?\n/)
    .filter((line) => /^Output:\s*/.test(line))
    .map((line) => line.replace(/^Output:\s?/, ""))
    .join("\n");
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
