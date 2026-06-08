import axios, { isAxiosError } from "axios";
import type { AppConfig } from "../config/env.js";
import type {
  CompanyDomain,
  OceanSearchCompaniesRequest,
  OceanSearchCompaniesResponse,
  OceanCompanyRecord,
} from "../types/index.js";
import { sleep } from "../utils/delay.js";
import { logger, createSpinner } from "../utils/logger.js";
import { normalizeDomain } from "../utils/normalizeDomain.js";
import { withRetry } from "../utils/retry.js";

const OCEAN_BASE_URL = "https://api.ocean.io";
const SEARCH_ENDPOINT = "/v3/search/companies";
const REQUEST_TIMEOUT_MS = 45_000;
// Ocean allows up to 10k per request; 100 is enough for our page size
const MAX_PAGE_SIZE = 100;

export interface OceanService {
  findLookalikeCompanies: (
    seedDomain: string,
    limit?: number,
  ) => Promise<CompanyDomain[]>;
}

// Ocean.io lookalike company search
export function createOceanService(config: AppConfig): OceanService {
  const client = axios.create({
    baseURL: OCEAN_BASE_URL,
    timeout: REQUEST_TIMEOUT_MS,
    headers: {
      "Content-Type": "application/json",
      "X-Api-Token": config.oceanApiKey,
    },
  });

  async function searchCompanies(
    body: OceanSearchCompaniesRequest,
  ): Promise<OceanSearchCompaniesResponse> {
    return withRetry(
      async () => {
        const { data } = await client.post<OceanSearchCompaniesResponse>(
          SEARCH_ENDPOINT,
          body,
        );
        return data;
      },
      {
        maxAttempts: config.retryMaxAttempts,
        onRetry: (attempt, error) => {
          logger.warn(
            `Ocean.io request failed (attempt ${attempt}/${config.retryMaxAttempts}): ${formatAxiosError(error)}`,
          );
        },
      },
    );
  }

  async function findLookalikeCompanies(
    seedDomain: string,
    limit?: number,
  ): Promise<CompanyDomain[]> {
    const targetLimit = limit ?? config.companyLimit;
    const collected: CompanyDomain[] = [];
    const seenDomains = new Set<string>();
    let searchAfter: string | string[] | undefined;

    const spinner = createSpinner(
      `Finding lookalike companies for ${seedDomain}...`,
    );

    try {
      while (collected.length < targetLimit) {
        const pageSize = Math.min(
          MAX_PAGE_SIZE,
          targetLimit - collected.length,
        );

        const response = await searchCompanies({
          size: pageSize,
          ...(searchAfter !== undefined ? { searchAfter } : {}),
          companiesFilters: {
            lookalikeDomains: [seedDomain],
            excludeDomains: [seedDomain],
          },
        });

        logMissingDomains(response.missingDomains, seedDomain);

        const pageCompanies = mapResponseToDomains(response);
        let addedOnPage = 0;

        for (const company of pageCompanies) {
          if (collected.length >= targetLimit) break;
          if (seenDomains.has(company.domain)) continue;

          seenDomains.add(company.domain);
          collected.push(company);
          addedOnPage++;
        }

        const skippedOnPage = pageCompanies.length - addedOnPage;
        if (skippedOnPage > 0) {
          logger.warn(
            `Skipped ${skippedOnPage} duplicate or excess compan${skippedOnPage === 1 ? "y" : "ies"} on this page`,
          );
        }

        searchAfter = response.searchAfter;

        if (
          !searchAfter ||
          pageCompanies.length === 0 ||
          collected.length >= targetLimit
        ) {
          break;
        }

        if (config.apiDelayMs > 0) {
          await sleep(config.apiDelayMs);
        }
      }

      if (collected.length === 0) {
        spinner.warn("No lookalike companies found");
        logger.warn(
          `Ocean.io returned no results for seed domain "${seedDomain}". The domain may be missing from their database.`,
        );
        return [];
      }

      spinner.succeed(
        `Found ${collected.length} lookalike compan${collected.length === 1 ? "y" : "ies"}`,
      );
      return collected;
    } catch (error) {
      spinner.fail("Failed to fetch lookalike companies");
      throw new Error(
        `Ocean.io search failed: ${formatAxiosError(error)}`,
        { cause: error },
      );
    }
  }

  return { findLookalikeCompanies };
}

function mapResponseToDomains(
  response: OceanSearchCompaniesResponse,
): CompanyDomain[] {
  if (!Array.isArray(response.companies)) {
    logger.warn(
      "Ocean.io response missing or malformed `companies` array, treating as empty",
    );
    return [];
  }

  const results: CompanyDomain[] = [];

  for (const record of response.companies) {
    const mapped = mapRecordToDomain(record);
    if (mapped !== null) {
      results.push(mapped);
    }
  }

  return results;
}

function mapRecordToDomain(record: OceanCompanyRecord): CompanyDomain | null {
  const rawDomain = record.domain ?? record.company?.domain;
  const rawName = record.name ?? record.company?.name;

  if (typeof rawDomain !== "string" || rawDomain.trim() === "") {
    return null;
  }

  const domain = normalizeDomain(rawDomain);
  if (domain === null) {
    logger.warn(`Skipping company with unparseable domain: "${rawDomain}"`);
    return null;
  }

  const company: CompanyDomain = { domain };

  if (typeof rawName === "string" && rawName.trim() !== "") {
    company.name = rawName.trim();
  }

  return company;
}

function logMissingDomains(
  missingDomains: Record<string, string> | undefined,
  seedDomain: string,
): void {
  if (!missingDomains || Object.keys(missingDomains).length === 0) {
    return;
  }

  for (const [domain, reason] of Object.entries(missingDomains)) {
    const label = domain === seedDomain ? "seed domain" : domain;
    logger.warn(`Ocean.io missing ${label}: ${reason}`);
  }
}

function formatAxiosError(error: unknown): string {
  if (isAxiosError(error)) {
    const status = error.response?.status;
    const statusLabel = status !== undefined ? `HTTP ${status}` : "network error";
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
