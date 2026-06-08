import { buildEmail } from "../src/templates/emailTemplate.js";
import type { OutreachContact } from "../src/types/index.js";

const mockContact: OutreachContact = {
  email: "arun.kumar@shortcut.com",
  firstName: "Arun",
  lastName: "Kumar",
  fullName: "Arun Kumar",
  jobTitle: "Head of Engineering",
  companyName: "Shortcut",
  companyDomain: "shortcut.com",
};

const email = buildEmail(mockContact, "Praveen");

if (!email.subject || !email.htmlContent || !email.textContent) {
  console.error("FAIL: buildEmail returned incomplete content");
  process.exit(1);
}

if (!email.subject.includes("Shortcut")) {
  console.error("FAIL: subject missing company name");
  process.exit(1);
}

if (!email.textContent.includes("Arun")) {
  console.error("FAIL: text body missing first name");
  process.exit(1);
}

if (!email.textContent.includes("Praveen")) {
  console.error("FAIL: text body missing sender signature");
  process.exit(1);
}

console.log("PASS: smoke-template");
console.log(`  Subject: ${email.subject}`);
console.log(`  Text preview: ${email.textContent.split("\n")[0]}`);
