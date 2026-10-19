type Actor = { id?: unknown; username?: unknown } | null | undefined;
const actorId = (actor: Actor) => typeof actor?.id === 'string' && /^\d{1,40}$/.test(actor.id) ? actor.id : null;
const username = (value: unknown) => typeof value === 'string' ? value.trim().replace(/^@/, '').toLowerCase() : '';

// Instagram may return different IDs for the connected account and the same
// account in messaging. Learn aliases only from Meta's own account username.
export function resolveMessageIdentity(account: { accountId: string; username: string }, participants: Actor[], messages: any[]) {
  const ownIds = new Set([account.accountId]);
  const ownUsername = username(account.username);
  const actors: Actor[] = [...participants];
  for (const message of messages) {
    actors.push(message?.from);
    if (Array.isArray(message?.to?.data)) actors.push(...message.to.data);
  }
  for (const actor of actors) {
    const id = actorId(actor);
    if (id && ownUsername && username(actor?.username) === ownUsername) ownIds.add(id);
  }
  const isOwnActor = (actor: Actor) => Boolean((actorId(actor) && ownIds.has(actorId(actor)!)) || (ownUsername && username(actor?.username) === ownUsername));
  const others = new Set<string>();
  for (const actor of actors) {
    const id = actorId(actor);
    if (id && !isOwnActor(actor)) others.add(id);
  }
  return { ownIds, isOwnActor, recipientId: actors.some(isOwnActor) && others.size === 1 ? [...others][0] : null };
}
