import "server-only";
import { buildMimeRaw, type MimeInput } from "./mime";

export interface GmailSendResult {
  messageId: string;
  threadId: string;
}

/**
 * Call Gmail API `users.messages.send`. `accessToken` must have been
 * refreshed via ensureFreshAccessToken() before this is invoked.
 */
export async function sendGmailMessage(
  accessToken: string,
  input: MimeInput,
): Promise<GmailSendResult> {
  const raw = buildMimeRaw(input);
  const res = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw }),
    },
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new GmailApiError(
      `Gmail rejected the message. No buyer was contacted.`,
      res.status,
      detail,
    );
  }
  const body = (await res.json()) as { id?: string; threadId?: string };
  if (!body.id || !body.threadId) {
    throw new GmailApiError("Gmail did not return a message id.", 200, JSON.stringify(body));
  }
  return { messageId: body.id, threadId: body.threadId };
}

export class GmailApiError extends Error {
  constructor(message: string, public status: number, public detail: string) {
    super(message);
    this.name = "GmailApiError";
  }
}
