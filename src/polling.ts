import { type ParsedUpdate, updateSchema } from "./telegram/bot";

export const ALLOWED_UPDATES = ["message", "callback_query", "my_chat_member"] as const;

export async function pollOnce(
  fetchUpdates: (offset: number) => Promise<unknown[]>,
  handle: (update: ParsedUpdate) => Promise<void>,
  offset: number,
): Promise<number> {
  const updates = await fetchUpdates(offset);
  let next = offset;
  for (const raw of updates) {
    const parsed = updateSchema.safeParse(raw);
    if (!parsed.success) {
      continue;
    }
    next = Math.max(next, parsed.data.update_id + 1);
    await handle(parsed.data);
  }
  return next;
}
