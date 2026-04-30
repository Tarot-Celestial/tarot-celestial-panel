export type LoadLevel = "low" | "medium" | "high" | "critical";

export type LoadSummaryInput = {
  presences?: any[];
  expected?: any[];
  outboundItems?: any[];
  chatItems?: any[];
  parkingCount?: number;
  chatUnread?: number;
  incidentCount?: number;
};

export type LoadSummary = {
  onlineCount: number;
  expectedCount: number;
  offlineExpected: number;
  pendingCalls: number;
  activeChats: number;
  chatUnread: number;
  incidentCount: number;
  parkingCount: number;
  pressureScore: number;
  level: LoadLevel;
  label: string;
};

function levelFromScore(score: number): LoadLevel {
  if (score >= 12) return "critical";
  if (score >= 8) return "high";
  if (score >= 4) return "medium";
  return "low";
}

function labelFromLevel(level: LoadLevel) {
  if (level === "critical") return "Presión crítica";
  if (level === "high") return "Presión alta";
  if (level === "medium") return "Presión media";
  return "Presión baja";
}

export function getLoadSummary(input: LoadSummaryInput): LoadSummary {
  const presences = input.presences || [];
  const expected = input.expected || [];
  const onlineCount = presences.filter((row) => !!row?.online).length;
  const expectedCount = expected.length;
  const offlineExpected = expected.filter((row) => row?.online === false).length;
  const pendingCalls = (input.outboundItems || []).length;
  const activeChats = (input.chatItems || []).length;
  const chatUnread = Number(input.chatUnread || 0);
  const incidentCount = Number(input.incidentCount || 0);
  const parkingCount = Number(input.parkingCount || 0);

  const pressureScore = parkingCount * 6 + offlineExpected * 3 + pendingCalls * 1.5 + Math.min(chatUnread, 5) + incidentCount;
  const level = levelFromScore(pressureScore);

  return {
    onlineCount,
    expectedCount,
    offlineExpected,
    pendingCalls,
    activeChats,
    chatUnread,
    incidentCount,
    parkingCount,
    pressureScore,
    level,
    label: labelFromLevel(level),
  };
}
