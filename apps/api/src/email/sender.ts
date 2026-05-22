export type SendResult = { messageId: string } | { error: string };

export interface EmailSender {
  send(params: { to: string; subject: string; html: string; text?: string }): Promise<SendResult>;
}
