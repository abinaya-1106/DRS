import { RENT_INTERVAL_SECONDS } from "../config/env.js";

export const agreementGenerationPrompt = (data) => {
  return `
You are a professional legal document generator.

Your task is to generate a **Rental Agreement** formatted as a **complete HTML document** that can be converted to a PDF.

IMPORTANT RULES:
- Return ONLY valid HTML.
- Do NOT include markdown, explanations, or code blocks.
- The response must start with "<!DOCTYPE html>" and end with "</html>".
- Use clean inline CSS only (no external stylesheets).
- The layout must be optimized for A4 printing.
- Use readable fonts and proper spacing.
- Do NOT invent information. Use only the provided data.
- Do NOT but blanks for signature at the end 
- Do NOT put names of landlord and tenant at the end below signature blank

DOCUMENT STRUCTURE REQUIREMENTS:

The agreement must contain these sections in order:

1. Title (Rental Agreement)
2. Parties
3. Property Details
4. Financial Terms
5. Lease Term
6. Tenant Responsibilities
7. Landlord Responsibilities
8. Termination Conditions
9. Additional Terms

STYLE REQUIREMENTS:

- Use a professional legal tone.
- Use clear section headings.
- Add proper paragraph spacing.
- Ensure margins and spacing suitable for A4 page printing.

AGREEMENT DATA:

Landlord Name: ${data.landlord_name}
Tenant Name: ${data.tenant_name}

Property Title: ${data.property_title}
Property Address: ${data.property_address}
Bedrooms: ${data.bedroom_count}
Bathrooms: ${data.bathroom_count}
Area: ${data.area} sq.ft
Maximum Tenants Allowed: ${data.max_tenants}
Furnishing Status: ${data.furnishing_status}

Monthly Rent: ₹${data.rent_amount}
Security Deposit: ₹${data.security_deposit}
Maintenance Charges: ₹${data.maintenance_charges}

Lease Start Date: ${data.startDate}
Lease Duration (converted into human-readable lease period (minutes/hours/days/months/years)): ${data.lease_duration * RENT_INTERVAL_SECONDS} seconds

Additional Terms and Conditions:
${data.terms_and_conditions}

Ensure the document is structured clearly and professionally for legal usage.
`;
};

export const disputeResolutionPrompt = (data) => {
  // Format payment history for readability
  let paymentHistoryText = "N/A";
  if (data.payment_history && data.payment_history.length > 0) {
    paymentHistoryText = data.payment_history
      .map(
        (p, idx) =>
          `Payment ${idx + 1}: ${p.periods_paid} period(s), ₹${p.amount_paid}, Periods ${p.previous_period_index} → ${p.new_period_index}, Paid: ${new Date(p.paid_timestamp * 1000).toISOString().split("T")[0]}`,
      )
      .join("\n");
  }

  return `
You are an impartial rental dispute adjudication assistant.

Your task is to analyze the dispute details and rental contract context, then produce a fair recommendation.

CRITICAL OUTPUT RULES:
- Return ONLY valid JSON.
- Do NOT include markdown, explanation text, or code fences.
- JSON must strictly match this schema:
{
  "ai_decision": "TENANT" | "LANDLORD" | "UNCERTAIN",
  "ai_reasoning": "string"
}

DECISION RULES:
- Choose "TENANT" if evidence and contract terms strongly support the tenant.
- Choose "LANDLORD" if evidence and contract terms strongly support the landlord.
- Choose "UNCERTAIN" when facts are insufficient, conflicting, or outside contractual scope.
- Never fabricate facts, events, payments, clauses, or dates.
- Base reasoning only on inputs provided below.

REASONING RULES:
- Keep ai_reasoning concise (5-10 sentences).
- Reference relevant contract obligations and dispute facts.
- Mention uncertainty explicitly when choosing "UNCERTAIN".
- Do not mention that you are an AI model.

INPUT DATA:

Dispute Meta:
- Raised By: ${data.raised_by || "UNKNOWN"}
- Description: ${data.dispute_description || "N/A"}
- Evidence URL: ${data.evidence_url || "N/A"}

Rental Context:
- Property Title: ${data.property_title || "N/A"}
- Property Address: ${data.property_address || "N/A"}
- Monthly Rent: ${data.rent_amount ?? "N/A"}
- Security Deposit: ${data.security_deposit ?? "N/A"}
- Lease Duration (Multiple): ${data.lease_duration ?? "N/A"}
- Lease Start Date: ${data.start_date || "N/A"}
- Landlord Name: ${data.landlord_name || "N/A"}
- Tenant Name: ${data.tenant_name || "N/A"}

Payment History (Most Recent First):
${paymentHistoryText}

Contract Text:
${data.contract_text || "N/A"}

Now return only the JSON object.
`;
};
