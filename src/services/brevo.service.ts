import axios, { isAxiosError, type AxiosInstance } from "axios";
import type { AppConfig } from "../config/env.js";
import { buildEmail } from "../templates/emailTemplate.js";
import type {
  BrevoSendEmailPayload,
  BrevoSendEmailResponse,
  BrevoSendResult,
  EmailContent,
  OutreachContact,
} from "../types/index.js";
import { sleep } from "../utils/delay.js";
import { createSpinner, logger } from "../utils/logger.js";
import { isRetryableError, withRetry } from "../utils/retry.js";
import { isValidEmail } from "../utils/validate.js";

const BREVO_BASE_URL = "https://api.brevo.com";
const SEND_ENDPOINT = "/v3/smtp/email";
const REQUEST_TIMEOUT_MS = 30_000;

export interface BrevoService {
  sendOutreachEmail: (contact: OutreachContact) => Promise<void>;
  sendBulkEmails: (contacts: OutreachContact[]) => Promise<BrevoSendResult>;
}

// Brevo transactional email send
export function createBrevoService(config: AppConfig): BrevoService {
  const client = axios.create({
    baseURL: BREVO_BASE_URL,
    timeout: REQUEST_TIMEOUT_MS,
    headers: {
      "Content-Type": "application/json",
      "api-key": config.brevoApiKey,
    },
  });

  async function sendOutreachEmail(contact: OutreachContact): Promise<void> {
    if (!isValidEmail(contact.email)) {
      throw new Error(
        `Invalid recipient email: "${contact.email}". Skipping send.`,
      );
    }

    const content = buildEmail(contact, config.brevoSenderName);
    const payload = buildPayload(contact, content, config);

    await postEmail(client, payload, config);

    logger.success(`Email sent to ${contact.email}`);
  }

  async function sendBulkEmails(
    contacts: OutreachContact[],
  ): Promise<BrevoSendResult> {
    const result: BrevoSendResult = {
      sent: 0,
      failed: 0,
      failures: [],
    };

    if (contacts.length === 0) {
      return result;
    }

    const spinner = createSpinner(
      `Sending ${contacts.length} email${contacts.length === 1 ? "" : "s"}...`,
    );

    for (let i = 0; i < contacts.length; i++) {
      const contact = contacts[i]!;

      try {
        await sendOutreachEmail(contact);
        result.sent++;
      } catch (error) {
        const reason = formatAxiosError(error);
        result.failed++;
        result.failures.push({ email: contact.email, reason });
        logger.warn(`Failed to send to ${contact.email}: ${reason}`);

        if (isAuthOrConfigError(error)) {
          const remaining = contacts.length - i - 1;
          if (remaining > 0) {
            logger.error(
              `Stopping bulk send: auth/config error. ${remaining} email${remaining === 1 ? "" : "s"} not attempted.`,
            );
          }
          break;
        }
      }

      const isLast = i === contacts.length - 1;
      if (!isLast && config.apiDelayMs > 0) {
        await sleep(config.apiDelayMs);
      }
    }

    if (result.sent === 0 && result.failed > 0) {
      spinner.fail(
        `Failed to send emails (${result.failed} failure${result.failed === 1 ? "" : "s"})`,
      );
    } else if (result.failed > 0) {
      spinner.warn(
        `Sent ${result.sent}/${contacts.length} emails (${result.failed} failed)`,
      );
    } else {
      spinner.succeed(
        `Sent ${result.sent} email${result.sent === 1 ? "" : "s"} successfully`,
      );
    }

    return result;
  }

  return { sendOutreachEmail, sendBulkEmails };
}

async function postEmail(
  client: AxiosInstance,
  payload: BrevoSendEmailPayload,
  config: AppConfig,
): Promise<BrevoSendEmailResponse> {
  return withRetry(
    async () => {
      const { data } = await client.post<BrevoSendEmailResponse>(
        SEND_ENDPOINT,
        payload,
      );
      return data;
    },
    {
      maxAttempts: config.retryMaxAttempts,
      shouldRetry: (error) => {
        if (isAuthOrConfigError(error)) return false;
        return isRetryableError(error);
      },
      onRetry: (attempt, error) => {
        logger.warn(
          `Brevo request failed (attempt ${attempt}/${config.retryMaxAttempts}): ${formatAxiosError(error)}`,
        );
      },
    },
  );
}

function buildPayload(
  contact: OutreachContact,
  content: EmailContent,
  config: AppConfig,
): BrevoSendEmailPayload {
  return {
    sender: {
      name: config.brevoSenderName,
      email: config.brevoSenderEmail,
    },
    to: [{ email: contact.email, name: contact.fullName }],
    subject: content.subject,
    htmlContent: content.htmlContent,
    textContent: content.textContent,
  };
}

function isAuthOrConfigError(error: unknown): boolean {
  if (!isAxiosError(error)) return false;

  const status = error.response?.status;
  if (status === 401 || status === 403) return true;

  // Stop only on sender/config 400s, not per-recipient validation errors
  if (status === 400) {
    const detail = formatAxiosError(error).toLowerCase();
    return (
      detail.includes("sender") ||
      detail.includes("api key") ||
      detail.includes("api-key") ||
      detail.includes("unauthorized") ||
      detail.includes("not verified")
    );
  }

  return false;
}

function formatAxiosError(error: unknown): string {
  if (isAxiosError(error)) {
    const status = error.response?.status;
    const statusLabel =
      status !== undefined ? `HTTP ${status}` : "network error";
    const body = error.response?.data;
    const detail =
      typeof body === "object" && body !== null && "message" in body
        ? String((body as { message: unknown }).message)
        : typeof body === "string"
          ? body
          : error.message;
    return `${statusLabel}: ${detail}`;
  }

  return error instanceof Error ? error.message : String(error);
}
