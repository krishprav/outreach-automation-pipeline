// Internal pipeline types. Services map vendor JSON into these shapes.

/** A company domain discovered from Ocean.io lookalike search. */
export interface CompanyDomain {
  domain: string;
  name?: string;
}

/** A prospect found via Prospeo search, before email enrichment. */
export interface ProspectDraft {
  personId: string;
  firstName: string;
  lastName: string;
  fullName: string;
  jobTitle: string;
  linkedinUrl?: string;
  companyDomain: string;
  companyName?: string;
}

/** A fully enriched contact ready for outreach. */
export interface OutreachContact {
  email: string;
  firstName: string;
  lastName: string;
  fullName: string;
  jobTitle: string;
  companyName: string;
  companyDomain: string;
  linkedinUrl?: string;
}

/** Aggregated pipeline run statistics for final CLI output. */
export interface PipelineStats {
  seedDomain: string;
  companiesFound: number;
  prospectsFound: number;
  duplicatesRemoved: number;
  contactsReady: number;
  emailsSent: number;
  emailsFailed: number;
  skippedCompanies: number;
  skippedProspects: number;
}

/** Result of deduplication pass. */
export interface DedupeResult {
  unique: OutreachContact[];
  removedCount: number;
}

// Ocean.io API shapes

export interface OceanCompany {
  domain: string;
  name?: string;
}

/** Raw company entry. v3 may return flat or nested under `company`. */
export interface OceanCompanyRecord {
  domain?: string;
  name?: string;
  company?: OceanCompany;
}

export interface OceanSearchCompaniesRequest {
  size: number;
  searchAfter?: string | string[];
  companiesFilters: {
    lookalikeDomains: string[];
    excludeDomains?: string[];
  };
}

export interface OceanSearchCompaniesResponse {
  companies?: OceanCompanyRecord[];
  searchAfter?: string | string[];
  total?: number;
  missingDomains?: Record<string, string>;
}

// Prospeo API shapes

export interface ProspeoSearchPersonRequest {
  page: number;
  filters: {
    company: { websites: { include: string[] } };
    person_seniority: { include: string[] };
    person_job_title?: { include: string[]; match_mode: "CONTAINS" };
    max_person_per_company?: number;
  };
}

export interface ProspeoBulkEnrichRequest {
  only_verified_email: true;
  data: Array<{
    identifier: string;
    person_id: string;
  }>;
}

export interface ProspeoApiErrorBody {
  error: true;
  error_code?: string;
  filter_error?: string;
}

/** Thrown when Prospeo credits are exhausted mid-pipeline. */
export class ProspeoInsufficientCreditsError extends Error {
  readonly enrichedCount: number;

  constructor(message: string, enrichedCount = 0) {
    super(message);
    this.name = "ProspeoInsufficientCreditsError";
    this.enrichedCount = enrichedCount;
  }
}

export interface ProspeoPerson {
  person_id: string;
  first_name: string;
  last_name: string;
  full_name: string;
  current_job_title: string | null;
  linkedin_url: string | null;
  seniority?: string | null;
}

export interface ProspeoCompany {
  name: string;
  domain: string;
  website?: string;
}

export interface ProspeoSearchResult {
  person: ProspeoPerson;
  company: ProspeoCompany | null;
}

export interface ProspeoSearchPersonResponse {
  error: boolean;
  free?: boolean;
  results: ProspeoSearchResult[];
  pagination: {
    current_page: number;
    per_page: number;
    total_page: number;
    total_count: number;
  };
  error_code?: string;
  filter_error?: string;
}

export interface ProspeoEmail {
  status: string;
  revealed: boolean;
  email: string;
}

export interface ProspeoEnrichedPerson extends ProspeoPerson {
  email: ProspeoEmail | null;
}

export interface ProspeoBulkEnrichMatch {
  identifier: string;
  person: ProspeoEnrichedPerson;
  company: ProspeoCompany | null;
}

export interface ProspeoBulkEnrichResponse {
  error: boolean;
  total_cost: number;
  matched: ProspeoBulkEnrichMatch[];
  not_matched: string[];
  invalid_datapoints: string[];
  error_code?: string;
}

// Email template

export interface EmailContent {
  subject: string;
  htmlContent: string;
  textContent: string;
}

// Brevo API shapes

export interface BrevoSendEmailPayload {
  sender: { name: string; email: string };
  to: Array<{ email: string; name: string }>;
  subject: string;
  htmlContent: string;
  textContent?: string;
}

export interface BrevoSendEmailResponse {
  messageId: string;
}

export interface BrevoSendResult {
  sent: number;
  failed: number;
  failures: Array<{ email: string; reason: string }>;
}
