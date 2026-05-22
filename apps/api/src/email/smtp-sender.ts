import nodemailer from 'nodemailer';

import type { Env } from '../env.js';
import { logger } from '../logger.js';

import type { EmailSender, SendResult } from './sender.js';

// Per-send transport (no pool — slice-1 volume; Decision 2). send() NEVER throws
// (Q2): it returns a result union so the better-auth verification hook can't fail
// signup (which would trip Commit 3's orphan-rollback and delete the user).
export class SmtpEmailSender implements EmailSender {
  private readonly from: string;
  private readonly config: {
    host: string;
    port: number;
    secure: boolean;
    auth: { user: string; pass: string };
  };

  constructor(env: Env) {
    this.from = `"Toodooh" <${env.SMTP_FROM}>`;
    this.config = {
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
    };
  }

  async send(params: {
    to: string;
    subject: string;
    html: string;
    text?: string;
  }): Promise<SendResult> {
    try {
      const transporter = nodemailer.createTransport(this.config);
      const info = await transporter.sendMail({ from: this.from, ...params });
      return { messageId: info.messageId };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'unknown SMTP error';
      logger.error({ to: params.to, error }, 'SMTP send failed');
      return { error };
    }
  }
}
