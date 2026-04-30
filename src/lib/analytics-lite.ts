
export function getAnalytics({ leads, outboundItems, chatItems }: any) {
  return {
    leads: leads?.length || 0,
    calls: outboundItems?.length || 0,
    chats: chatItems?.length || 0,
  };
}
