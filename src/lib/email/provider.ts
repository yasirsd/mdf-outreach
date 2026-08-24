export interface OutboundEmail {
  to: string;
  toName?: string;
  subject: string;
  html: string;
  text: string;
  fromName: string;
  replyTo?: string;
}

export interface SendResult {
  ok: boolean;
  simulated: boolean;
  message: string;
  at: string;
}

export interface EmailProvider {
  readonly kind: "simulation" | "gmail";
  send(email: OutboundEmail): Promise<SendResult>;
}

export class SimulationEmailProvider implements EmailProvider {
  readonly kind = "simulation" as const;
  async send(email: OutboundEmail): Promise<SendResult> {
    // Runs entirely locally — no network call.
    return {
      ok: true,
      simulated: true,
      message: `Simulated send to ${email.to}. Live Gmail sending will be connected in Phase 2.`,
      at: new Date().toISOString(),
    };
  }
}

export const emailProvider: EmailProvider = new SimulationEmailProvider();
