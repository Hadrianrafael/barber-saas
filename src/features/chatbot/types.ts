/** Shared view types (safe to import from client components). */
export interface ChatMessageView {
  id: string;
  role: string;
  content: string;
  toolName?: string | null;
  createdAt: string;
}
