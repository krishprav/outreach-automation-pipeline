import axios, { isAxiosError, type AxiosInstance } from "axios";
import type { AppConfig } from "../config/env.js";
import {
  ProspeoInsufficientCreditsError,
  type OutreachContact,
  type ProspectDraft,
  type ProspeoApiErrorBody,
  type ProspeoBulkEnrichMatch,
  type ProspeoBulkEnrichRequest,
  type ProspeoBulkEnrichResponse,
  type ProspeoSearchPersonRequest,
  type ProspeoSearchPersonResponse,
  type ProspeoSearchResult,
} from "../types/index.js";
import { sleep } from "../utils/delay.js";
import { createSpinner, logger } from "../utils/logger.js";
import { isRetryableError, withRetry } from "../utils/retry.js";

const PROSPEO_BASE_URL = "https://api.prospeo.io";
const SEARCH_ENDPOINT = "/search-person";
const BULK_ENRICH_ENDPOINT = "/bulk-enrich-person";
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_ENRICH_BATCH_SIZE = 50;

const LEADERSHIP_SENIORITIES = [
  "C-Suite",
  "Founder/Owner",
  "Vice President",
  "Head",
] as const;

export interface ProspeoService {
  searchDecisionMakers: (
    companyDomain: string,
    options?: { companyName?: string; limit?: number },
  ) => Promise<ProspectDraft[]>;

  enrichProspects: (drafts: ProspectDraft[]) => Promise<OutreachContact[]>;
}

// Prospeo people search + email enrich
export function createProspeoService(config: AppConfig): ProspeoService {
  const client = axios.create({
    baseURL: PROSPEO_BASE_URL,
    timeout: REQUEST_TIMEOUT_MS,
    headers: {
      "Content-Type": "application/json",
      "X-KEY": config.prospeoApiKey,
    },
  });

  async function searchDecisionMakers(
    companyDomain: string,
    options?: { companyName?: string; limit?: number },
  ): Promise<ProspectDraft[]> {
    const targetLimit = options?.limit ?? config.contactsPerCompany;

    const body: ProspeoSearchPersonRequest = {
      page: 1,
      filters: {
        company: { websites: { include: [companyDomain] } },
        person_seniority: { include: [...LEADERSHIP_SENIORITIES] },
        max_person_per_company: targetLimit,
      },
    };

    try {
      const response = await postSearchPerson(client, body, config);

      if (response.error) {
        return handleSearchErrorResponse(response, companyDomain);
      }

      const drafts = mapSearchResponseToDrafts(
        response,
        companyDomain,
        options?.companyName,
      );

      const ranked = sortByLeadershipRank(drafts);
      const selected = ranked.slice(0, targetLimit);

      if (selected.length === 0) {
        logger.warn(`No decision-makers found for ${companyDomain}`);
      } else {
        logger.info(
          `Found ${selected.length} decision-maker${selected.length === 1 ? "" : "s"} at ${companyDomain}`,
        );
      }

      return selected;
    } catch (error) {
      if (error instanceof ProspeoInsufficientCreditsError) {
        throw error;
      }
      if (isProspeoBusinessError(error) && error.errorCode === "NO_RESULTS") {
        logger.warn(
          `No decision-makers found for ${companyDomain} (NO_RESULTS)`,
        );
        return [];
      }
      if (
        isProspeoBusinessError(error) &&
        error.errorCode === "INSUFFICIENT_CREDITS"
      ) {
        throw new ProspeoInsufficientCreditsError(
          "Prospeo credits exhausted during search",
        );
      }
      throw new Error(
        `Prospeo search failed for ${companyDomain}: ${formatAxiosError(error)}`,
        { cause: error },
      );
    }
  }

  async function enrichProspects(
    drafts: ProspectDraft[],
  ): Promise<OutreachContact[]> {
    if (drafts.length === 0) {
      return [];
    }

    const batches = chunkArray(drafts, MAX_ENRICH_BATCH_SIZE);
    const contacts: OutreachContact[] = [];
    const spinner = createSpinner(
      `Enriching ${drafts.length} prospect${drafts.length === 1 ? "" : "s"}...`,
    );

    try {
      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i]!;
        const draftLookup = buildDraftLookup(batch);

        try {
          const response = await postBulkEnrich(client, batch, config);

          if (response.error) {
            if (response.error_code === "NO_MATCH") {
              logger.warn(
                `No verified email match for batch ${i + 1}/${batches.length}`,
              );
              continue;
            }
            handleEnrichErrorResponse(response, contacts.length);
          }

          const batchContacts = mapEnrichResponseToContacts(
            response,
            draftLookup,
          );
          contacts.push(...batchContacts);

          const notMatched = response.not_matched?.length ?? 0;
          const invalid = response.invalid_datapoints?.length ?? 0;

          if (notMatched > 0) {
            logger.warn(
              `${notMatched} prospect${notMatched === 1 ? "" : "s"} had no verified email (batch ${i + 1}/${batches.length})`,
            );
          }
          if (invalid > 0) {
            logger.warn(
              `${invalid} prospect${invalid === 1 ? "" : "s"} had invalid datapoints (batch ${i + 1}/${batches.length})`,
            );
          }

          logger.info(
            `Enriched ${batchContacts.length}/${batch.length} prospects (batch ${i + 1}/${batches.length})`,
          );
        } catch (error) {
          const isCreditsError =
            error instanceof ProspeoInsufficientCreditsError ||
            (isProspeoBusinessError(error) &&
              error.errorCode === "INSUFFICIENT_CREDITS");

          if (isCreditsError) {
            spinner.warn(
              `Credit limit reached. ${contacts.length} contact${contacts.length === 1 ? "" : "s"} enriched so far`,
            );
            throw new ProspeoInsufficientCreditsError(
              `Prospeo credits exhausted after enriching ${contacts.length} contact${contacts.length === 1 ? "" : "s"}`,
              contacts.length,
            );
          }

          if (isRateLimitError(error)) {
            spinner.warn(
              `Rate limit reached. ${contacts.length} contact${contacts.length === 1 ? "" : "s"} enriched so far`,
            );
            return contacts;
          }

          if (isEnrichNoMatchError(error)) {
            logger.warn(
              `No verified email match for batch ${i + 1}/${batches.length}`,
            );
            continue;
          }

          throw error;
        }

        const isLastBatch = i === batches.length - 1;
        if (!isLastBatch && config.apiDelayMs > 0) {
          await sleep(config.apiDelayMs);
        }
      }

      if (contacts.length === 0) {
        spinner.warn("No prospects enriched with verified emails");
      } else {
        spinner.succeed(
          `Enriched ${contacts.length} contact${contacts.length === 1 ? "" : "s"} with verified emails`,
        );
      }

      return contacts;
    } catch (error) {
      if (error instanceof ProspeoInsufficientCreditsError) {
        return contacts;
      }

      if (isRateLimitError(error)) {
        spinner.warn(
          contacts.length > 0
            ? `Rate limit reached. Returning ${contacts.length} enriched contact${contacts.length === 1 ? "" : "s"}`
            : "Rate limit reached. No prospects enriched",
        );
        return contacts;
      }

      if (isEnrichNoMatchError(error)) {
        spinner.warn("No verified email matches from enrich");
        return contacts;
      }

      spinner.fail("Failed to enrich prospects");
      throw new Error(`Prospeo enrich failed: ${formatAxiosError(error)}`, {
        cause: error,
      });
    }
  }

  return { searchDecisionMakers, enrichProspects };
}

async function postSearchPerson(
  client: AxiosInstance,
  body: ProspeoSearchPersonRequest,
  config: AppConfig,
): Promise<ProspeoSearchPersonResponse> {
  return postWithRetry<ProspeoSearchPersonResponse>(
    client,
    SEARCH_ENDPOINT,
    body,
    config,
  );
}

async function postBulkEnrich(
  client: AxiosInstance,
  drafts: ProspectDraft[],
  config: AppConfig,
): Promise<ProspeoBulkEnrichResponse> {
  const body: ProspeoBulkEnrichRequest = {
    only_verified_email: true,
    data: drafts.map((draft) => ({
      identifier: buildIdentifier(draft),
      person_id: draft.personId,
    })),
  };

  return postWithRetry<ProspeoBulkEnrichResponse>(
    client,
    BULK_ENRICH_ENDPOINT,
    body,
    config,
  );
}

async function postWithRetry<T>(
  client: AxiosInstance,
  endpoint: string,
  body: ProspeoSearchPersonRequest | ProspeoBulkEnrichRequest,
  config: AppConfig,
): Promise<T> {
  return withRetry(
    async () => {
      try {
        const { data } = await client.post<T>(endpoint, body);
        return data;
      } catch (error) {
        throw normalizeProspeoAxiosError(error);
      }
    },
    {
      maxAttempts: config.retryMaxAttempts,
      shouldRetry: (error) => {
        if (isProspeoBusinessError(error)) return false;
        return isRetryableError(error);
      },
      onRetry: (attempt, error) => {
        logger.warn(
          `Prospeo request failed (attempt ${attempt}/${config.retryMaxAttempts}): ${formatAxiosError(error)}`,
        );
      },
    },
  );
}

function normalizeProspeoAxiosError(error: unknown): unknown {
  if (!isAxiosError(error)) return error;

  const body = error.response?.data;
  if (!isProspeoApiErrorBody(body)) return error;

  const apiError = new Error(body.error_code ?? "PROSPEO_API_ERROR");
  Object.assign(apiError, {
    errorCode: body.error_code,
    filterError: body.filter_error,
    statusCode: error.response?.status,
    isProspeoBusinessError: true,
  });
  return apiError;
}

interface ProspeoBusinessError extends Error {
  errorCode?: string;
  filterError?: string;
  statusCode?: number;
  isProspeoBusinessError: true;
}

function isProspeoBusinessError(error: unknown): error is ProspeoBusinessError {
  return (
    error instanceof Error &&
    "isProspeoBusinessError" in error &&
    (error as ProspeoBusinessError).isProspeoBusinessError === true
  );
}

function isRateLimitError(error: unknown): boolean {
  if (isAxiosError(error)) {
    return error.response?.status === 429;
  }
  if (isProspeoBusinessError(error)) {
    return error.statusCode === 429;
  }
  return false;
}

function isEnrichNoMatchError(error: unknown): boolean {
  if (isProspeoBusinessError(error)) {
    return error.errorCode === "NO_MATCH";
  }
  if (isAxiosError(error) && error.response?.status === 400) {
    const body = error.response.data;
    if (
      typeof body === "object" &&
      body !== null &&
      "error_code" in body &&
      (body as { error_code: unknown }).error_code === "NO_MATCH"
    ) {
      return true;
    }
  }
  return false;
}

function isProspeoApiErrorBody(data: unknown): data is ProspeoApiErrorBody {
  return (
    typeof data === "object" &&
    data !== null &&
    "error" in data &&
    (data as ProspeoApiErrorBody).error === true
  );
}

function handleSearchErrorResponse(
  response: ProspeoSearchPersonResponse,
  companyDomain: string,
): ProspectDraft[] {
  const code = response.error_code;

  if (code === "NO_RESULTS") {
    logger.warn(`No decision-makers found for ${companyDomain} (NO_RESULTS)`);
    return [];
  }

  if (code === "INSUFFICIENT_CREDITS") {
    throw new ProspeoInsufficientCreditsError(
      "Prospeo credits exhausted during search",
    );
  }

  const detail = response.filter_error ?? code ?? "unknown error";
  throw new Error(`Prospeo search error for ${companyDomain}: ${detail}`);
}

function handleEnrichErrorResponse(
  response: ProspeoBulkEnrichResponse,
  enrichedSoFar: number,
): never {
  const code = response.error_code;

  if (code === "INSUFFICIENT_CREDITS") {
    throw new ProspeoInsufficientCreditsError(
      `Prospeo credits exhausted during enrich (${enrichedSoFar} enriched so far)`,
      enrichedSoFar,
    );
  }

  throw new Error(`Prospeo enrich error: ${code ?? "unknown error"}`);
}

function mapSearchResponseToDrafts(
  response: ProspeoSearchPersonResponse,
  companyDomain: string,
  companyName?: string,
): ProspectDraft[] {
  if (!Array.isArray(response.results)) {
    logger.warn(
      `Prospeo search response missing results array for ${companyDomain}`,
    );
    return [];
  }

  const seen = new Set<string>();
  const drafts: ProspectDraft[] = [];

  for (const result of response.results) {
    const draft = mapSearchResultToDraft(result, companyDomain, companyName);
    if (draft === null) continue;
    if (seen.has(draft.personId)) continue;

    seen.add(draft.personId);
    drafts.push(draft);
  }

  return drafts;
}

function mapSearchResultToDraft(
  result: ProspeoSearchResult,
  companyDomain: string,
  fallbackCompanyName?: string,
): ProspectDraft | null {
  const { person, company } = result;

  if (!person?.person_id?.trim()) {
    logger.warn("Skipping prospect with missing person_id");
    return null;
  }

  const firstName = person.first_name?.trim() ?? "";
  const lastName = person.last_name?.trim() ?? "";
  const fullName = person.full_name?.trim() || `${firstName} ${lastName}`.trim();

  if (!fullName) {
    logger.warn(`Skipping prospect ${person.person_id}: missing name`);
    return null;
  }

  const draft: ProspectDraft = {
    personId: person.person_id,
    firstName: firstName || fullName.split(" ")[0] || "Unknown",
    lastName: lastName || fullName.split(" ").slice(1).join(" ") || "",
    fullName,
    jobTitle: person.current_job_title?.trim() || "Unknown",
    companyDomain,
    companyName: company?.name?.trim() || fallbackCompanyName,
  };

  const linkedin = person.linkedin_url?.trim();
  if (linkedin) {
    draft.linkedinUrl = linkedin;
  }

  return draft;
}

function mapEnrichResponseToContacts(
  response: ProspeoBulkEnrichResponse,
  draftLookup: Map<string, ProspectDraft>,
): OutreachContact[] {
  if (!Array.isArray(response.matched)) {
    logger.warn("Prospeo enrich response missing matched array");
    return [];
  }

  const contacts: OutreachContact[] = [];

  for (const match of response.matched) {
    const contact = mapEnrichMatchToContact(match, draftLookup);
    if (contact !== null) {
      contacts.push(contact);
    }
  }

  return contacts;
}

function mapEnrichMatchToContact(
  match: ProspeoBulkEnrichMatch,
  draftLookup: Map<string, ProspectDraft>,
): OutreachContact | null {
  const draft = draftLookup.get(match.identifier);
  if (!draft) {
    logger.warn(`No draft found for enrich identifier: ${match.identifier}`);
    return null;
  }

  const emailField = match.person?.email;
  if (!emailField?.revealed || !emailField.email?.trim()) {
    logger.warn(
      `Skipping ${draft.fullName}: no verified email in enrich response`,
    );
    return null;
  }

  if (emailField.status !== "VERIFIED") {
    logger.warn(
      `Skipping ${draft.fullName}: email status is "${emailField.status}", not VERIFIED`,
    );
    return null;
  }

  const email = emailField.email.trim().toLowerCase();
  const companyName =
    match.company?.name?.trim() || draft.companyName || draft.companyDomain;

  const contact: OutreachContact = {
    email,
    firstName: draft.firstName,
    lastName: draft.lastName,
    fullName: draft.fullName,
    jobTitle:
      match.person.current_job_title?.trim() || draft.jobTitle,
    companyName,
    companyDomain: draft.companyDomain,
  };

  const linkedin =
    match.person.linkedin_url?.trim() || draft.linkedinUrl;
  if (linkedin) {
    contact.linkedinUrl = linkedin;
  }

  return contact;
}

/** Lower rank = higher priority. C-Suite > Founder > VP > Head > other. */
function rankLeadershipTitle(jobTitle: string): number {
  const title = jobTitle.toLowerCase();

  if (
    title.includes("ceo") ||
    title.includes("cto") ||
    title.includes("cfo") ||
    title.includes("coo") ||
    title.includes("chief ")
  ) {
    return 0;
  }
  if (title.includes("founder") || title.includes("co-founder")) {
    return 1;
  }
  if (
    title.includes("vice president") ||
    title.includes("svp") ||
    title.includes("evp") ||
    /\bvp\b/.test(title)
  ) {
    return 2;
  }
  if (title.includes("head of") || /\bhead\b/.test(title)) {
    return 3;
  }

  return 4;
}

function sortByLeadershipRank(drafts: ProspectDraft[]): ProspectDraft[] {
  return [...drafts].sort((a, b) => {
    const rankDiff =
      rankLeadershipTitle(a.jobTitle) - rankLeadershipTitle(b.jobTitle);
    if (rankDiff !== 0) return rankDiff;
    return a.fullName.localeCompare(b.fullName);
  });
}

function buildIdentifier(draft: ProspectDraft): string {
  return `${draft.companyDomain}:${draft.personId}`;
}

function buildDraftLookup(
  drafts: ProspectDraft[],
): Map<string, ProspectDraft> {
  const map = new Map<string, ProspectDraft>();
  for (const draft of drafts) {
    map.set(buildIdentifier(draft), draft);
  }
  return map;
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function formatAxiosError(error: unknown): string {
  if (isProspeoBusinessError(error)) {
    const detail = error.filterError ?? error.errorCode ?? error.message;
    return error.statusCode !== undefined
      ? `HTTP ${error.statusCode}: ${detail}`
      : detail;
  }

  if (isAxiosError(error)) {
    const status = error.response?.status;
    const statusLabel =
      status !== undefined ? `HTTP ${status}` : "network error";
    const body = error.response?.data;
    const detail =
      typeof body === "object" && body !== null && "error_code" in body
        ? String((body as { error_code: unknown }).error_code)
        : typeof body === "string"
          ? body
          : error.message;
    return `${statusLabel}: ${detail}`;
  }

  return error instanceof Error ? error.message : String(error);
}
