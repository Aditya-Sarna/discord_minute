import { loadConfig } from "./config.js";
import { getDb } from "./db.js";
import type { Surface } from "./types.js";

function listFor(kind: "admins" | "requesters" | "tech"): string[] {
  return loadConfig()[kind].discordUserIds;
}

export function isAdmin(_surface: Surface, userId: string): boolean {
  return listFor("admins").includes(userId);
}

export function isRequester(surface: Surface, userId: string): boolean {
  if (isAdmin(surface, userId)) return true;
  return [...listFor("requesters"), ...overlayIds(surface)].includes(userId);
}

export function grant(surface: Surface, userId: string): void {
  getDb()
    .prepare("INSERT OR IGNORE INTO access_overlay (surface, user_id) VALUES (?, ?)")
    .run(surface, userId);
}

export function revoke(surface: Surface, userId: string): void {
  getDb().prepare("DELETE FROM access_overlay WHERE surface = ? AND user_id = ?").run(surface, userId);
}

function overlayIds(surface: Surface): string[] {
  const rows = getDb()
    .prepare("SELECT user_id FROM access_overlay WHERE surface = ?")
    .all(surface) as { user_id: string }[];
  return rows.map((r) => r.user_id);
}

export function listGranted(surface: Surface): string[] {
  return [...new Set([...listFor("requesters"), ...overlayIds(surface)])];
}

export function denyMessage(): string {
  return "You don’t have Minute access — ask an admin to allow you.";
}
