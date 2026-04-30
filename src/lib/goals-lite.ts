
export function getGoals(analytics: any) {
  const targets = { leads: 20, calls: 30, chats: 15 };

  const build = (value: number, target: number) => ({
    percent: Math.min(100, Math.round((value / target) * 100)),
  });

  return {
    leads: build(analytics.leads, targets.leads),
    calls: build(analytics.calls, targets.calls),
    chats: build(analytics.chats, targets.chats),
  };
}
