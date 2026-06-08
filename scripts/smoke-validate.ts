import {
  filterSendableContacts,
  isValidEmail,
} from "../src/utils/validate.js";
import type { OutreachContact } from "../src/types/index.js";

let failed = false;

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    failed = true;
  }
}

assert(isValidEmail("user@example.com"), "valid email rejected");
assert(!isValidEmail(""), "empty email accepted");
assert(!isValidEmail("not-an-email"), "malformed email accepted");
assert(!isValidEmail("@missing.com"), "missing local part accepted");

const contacts: OutreachContact[] = [
  {
    email: "good@shortcut.com",
    firstName: "Arun",
    lastName: "Kumar",
    fullName: "Arun Kumar",
    jobTitle: "Head of Engineering",
    companyName: "Shortcut",
    companyDomain: "shortcut.com",
  },
  {
    email: "bad-email",
    firstName: "C",
    lastName: "D",
    fullName: "C D",
    jobTitle: "CTO",
    companyName: "Bad",
    companyDomain: "bad.com",
  },
];

const { sendable, invalidCount } = filterSendableContacts(contacts);
assert(sendable.length === 1, `expected 1 sendable, got ${sendable.length}`);
assert(invalidCount === 1, `expected 1 invalid, got ${invalidCount}`);

if (failed) {
  process.exit(1);
}

console.log("PASS: smoke-validate");
