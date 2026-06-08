import type { EmailContent, OutreachContact } from "../types/index.js";

export function buildEmail(
  contact: OutreachContact,
  senderName: string,
): EmailContent {
  const firstName = contact.firstName.trim() || "there";
  const companyName = contact.companyName.trim() || contact.companyDomain;
  const jobTitle = contact.jobTitle.trim() || "your role";
  const signature = senderName.trim() || "Praveen";

  const subject = `Quick idea for ${companyName}`;

  const bodyParagraph = `I came across ${companyName} while researching teams in your space. Given your work as ${jobTitle}, I thought a quick note might be useful.`;

  const pitchParagraph = `We build workflow tools for small teams. Happy to share what we've learned if a 15-min call next week works.`;

  const textContent = [
    `Hi ${firstName},`,
    "",
    bodyParagraph,
    "",
    pitchParagraph,
    "",
    "Thanks,",
    signature,
  ].join("\n");

  const htmlContent = [
    `<p>Hi ${escapeHtml(firstName)},</p>`,
    `<p>${escapeHtml(bodyParagraph)}</p>`,
    `<p>${escapeHtml(pitchParagraph)}</p>`,
    `<p>Thanks,<br>${escapeHtml(signature)}</p>`,
  ].join("");

  return { subject, htmlContent, textContent };
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
