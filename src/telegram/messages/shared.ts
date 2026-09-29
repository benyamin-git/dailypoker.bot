import type { Card } from "../../engine/types";

const SUIT_SYMBOL: Record<string, string> = { s: "♠", h: "♥", d: "♦", c: "♣" };

export function escapeHtml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function formatAmount(amount: number): string {
  const sign = amount < 0 ? "-" : "";
  const digits = Math.abs(Math.trunc(amount)).toString();
  return `${sign}${digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}

export function cardText(card: Card): string {
  const rank = card[0] === "T" ? "10" : (card[0] as string);
  return `${rank}${SUIT_SYMBOL[card[1] as string]}`;
}

export function cardsText(cards: readonly Card[]): string {
  return cards.map(cardText).join(" ");
}

export function nameOf(names: Map<number, string>, userId: number): string {
  return escapeHtml(names.get(userId) ?? `user ${userId}`);
}

export function errorBox(text: string): string {
  return `<i>${escapeHtml(text)}</i>`;
}

export function boardText(board: readonly Card[], label: string): string | null {
  if (board.length === 0) {
    return null;
  }
  const slots: string[] = [];
  for (let i = 0; i < 5; i++) {
    slots.push(board[i] ? cardText(board[i] as Card) : "—");
  }
  return `${label} ${slots.join(" ")}`;
}

export function formatDurationEn(ms: number): string {
  const totalMinutes = Math.max(0, Math.ceil(ms / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0 && minutes > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (hours > 0) {
    return `${hours}h`;
  }
  return `${minutes}m`;
}

export function formatDurationFa(ms: number): string {
  const totalMinutes = Math.max(0, Math.ceil(ms / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0 && minutes > 0) {
    return `${hours} ساعت و ${minutes} دقیقه`;
  }
  if (hours > 0) {
    return `${hours} ساعت`;
  }
  return `${minutes} دقیقه`;
}
