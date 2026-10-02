export interface EmailAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

export type SendResult = { messageId: string } | { error: string };

export interface EmailSender {
  send(params: {
    to: string;
    subject: string;
    html: string;
    text?: string;
    /** NEWLANDING-1 — files to attach (e.g. a candidate's CV). */
    attachments?: EmailAttachment[];
    /** Where a reply goes (e.g. the candidate), when it is not the sender. */
    replyTo?: string;
  }): Promise<SendResult>;
}
