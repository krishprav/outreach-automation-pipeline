import { loadConfig } from "../src/config/env.js";

try {
  const config = loadConfig();

  const requiredKeys = [
    "oceanApiKey",
    "prospeoApiKey",
    "brevoApiKey",
    "brevoSenderEmail",
    "brevoSenderName",
  ] as const;

  for (const key of requiredKeys) {
    if (!config[key] || config[key].trim() === "") {
      console.error(`FAIL: config.${key} is empty`);
      process.exit(1);
    }
  }

  console.log("PASS: smoke-config");
  console.log(`  Company limit: ${config.companyLimit}`);
  console.log(`  Contacts per company: ${config.contactsPerCompany}`);
  console.log(`  Retry attempts: ${config.retryMaxAttempts}`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`FAIL: ${message}`);
  process.exit(1);
}
