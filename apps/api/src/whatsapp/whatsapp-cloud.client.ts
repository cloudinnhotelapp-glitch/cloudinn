// Client for the WhatsApp Business Platform (Meta Cloud API): uploads an image once per send, then sends the business's
// approved marketing template to one number at a time. Errors carry Meta's own explanation (shortened); the access token
// is only ever placed in the Authorization header and never appears in errors or logs.
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.validation.js';

// What a send needs from the business's settings (the token already decrypted).
export interface WhatsAppSender {
  phoneNumberId: string;
  accessToken: string;
  templateName: string;
  templateLanguage: string;
}

// A request Meta refused or that could not reach Meta.
export class WhatsAppApiError extends Error {}

// The parts of Meta's answers that are read.
interface MetaAnswer {
  id?: unknown;
  messages?: { id?: unknown }[];
  error?: { message?: unknown; error_data?: { details?: unknown } };
}

// How long one request to Meta may take.
const REQUEST_TIMEOUT_MS = 15_000;

// Meta rejects template text with line breaks, tabs, or more than four spaces in a row, and limits its length.
export function templateText(value: string, max = 1000): string {
  const cleaned = value.replace(/[\r\n\t]+/g, ' ').replace(/ {4,}/g, '   ').trim();
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}…` : cleaned;
}

// The three body values of the advertisement template: {{1}} the guest's name, {{2}} the title, {{3}} the details
// (description and link, or a short fallback, because Meta refuses empty values).
export function adTemplateParameters(guestName: string, ad: { title: string; description: string | null; linkUrl: string | null }): [string, string, string] {
  const details = [ad.description, ad.linkUrl].filter((part): part is string => Boolean(part && part.trim())).join(' ');
  return [templateText(guestName, 100) || 'Guest', templateText(ad.title, 120), templateText(details) || 'Ask us for details.'];
}

// Calls Meta's Graph API with the business's credentials.
@Injectable()
export class WhatsAppCloudClient {
  private readonly baseUrl: string;

  constructor(config: ConfigService<Env, true>) {
    this.baseUrl = config.get('WHATSAPP_GRAPH_BASE_URL', { infer: true }).replace(/\/+$/, '');
  }

  // Uploads the advertisement image to the business's WhatsApp account; returns Meta's media ID.
  async uploadImage(sender: WhatsAppSender, content: Buffer, contentType: string, fileName: string): Promise<string> {
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('type', contentType);
    form.append('file', new Blob([new Uint8Array(content)], { type: contentType }), fileName);
    const body = await this.call(sender, 'media', form);
    const id = typeof body.id === 'string' ? body.id : null;
    if (!id) throw new WhatsAppApiError('WhatsApp did not return an ID for the uploaded image.');
    return id;
  }

  // Sends the template with the image header and the three body values; returns Meta's message ID.
  async sendTemplate(sender: WhatsAppSender, to: string, imageId: string, parameters: readonly string[]): Promise<string> {
    const body = await this.call(sender, 'messages', {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'template',
      template: {
        name: sender.templateName,
        language: { code: sender.templateLanguage },
        components: [
          { type: 'header', parameters: [{ type: 'image', image: { id: imageId } }] },
          { type: 'body', parameters: parameters.map((text) => ({ type: 'text', text })) },
        ],
      },
    });
    const first = Array.isArray(body.messages) ? body.messages[0] : undefined;
    const id = typeof first?.id === 'string' ? first.id : null;
    if (!id) throw new WhatsAppApiError('WhatsApp did not confirm the message.');
    return id;
  }

  // Posts to "<base>/<phone number ID>/<path>" and returns the JSON answer, or throws a readable error.
  private async call(sender: WhatsAppSender, path: 'media' | 'messages', payload: FormData | object): Promise<MetaAnswer> {
    if (!/^\d{5,30}$/.test(sender.phoneNumberId)) throw new WhatsAppApiError('The WhatsApp phone number ID is not valid.');
    const isForm = payload instanceof FormData;
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/${sender.phoneNumberId}/${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${sender.accessToken}`, ...(isForm ? {} : { 'Content-Type': 'application/json' }) },
        body: isForm ? payload : JSON.stringify(payload),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new WhatsAppApiError('Could not reach WhatsApp. Check the internet connection and try again.');
    }
    const body = (await response.json().catch(() => null)) as MetaAnswer | null;
    if (!response.ok) {
      const message = typeof body?.error?.message === 'string' ? body.error.message : `WhatsApp answered with status ${response.status}.`;
      const details = typeof body?.error?.error_data?.details === 'string' ? ` ${body.error.error_data.details}` : '';
      throw new WhatsAppApiError(templateText(`${message}${details}`.replaceAll(sender.accessToken, '[token]'), 280));
    }
    return body ?? {};
  }
}
