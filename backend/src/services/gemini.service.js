import geminiClient from "../config/gemini.config.js";
import {
  agreementGenerationPrompt,
  disputeResolutionPrompt,
} from "../utils/geminiPrompt.js";

export const generateAgreementHTML = async (data) => {
  const prompt = agreementGenerationPrompt(data);

  const response = await geminiClient.models.generateContent({
    model: "gemini-2.5-flash-lite",
    contents: prompt,
  });

  return response.text;
};

const safeParseDecision = (rawText) => {
  const fallback = {
    ai_decision: "UNCERTAIN",
    ai_reasoning:
      "Unable to generate a reliable AI decision from the provided dispute and contract context.",
  };

  if (!rawText || typeof rawText !== "string") {
    return fallback;
  }

  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    const start = rawText.indexOf("{");
    const end = rawText.lastIndexOf("}");

    if (start === -1 || end === -1 || end <= start) {
      return fallback;
    }

    try {
      parsed = JSON.parse(rawText.slice(start, end + 1));
    } catch {
      return fallback;
    }
  }

  const decision = ["TENANT", "LANDLORD", "UNCERTAIN"].includes(
    parsed?.ai_decision,
  )
    ? parsed.ai_decision
    : "UNCERTAIN";

  const reasoning =
    typeof parsed?.ai_reasoning === "string" && parsed.ai_reasoning.trim()
      ? parsed.ai_reasoning.trim()
      : fallback.ai_reasoning;

  return {
    ai_decision: decision,
    ai_reasoning: reasoning,
  };
};

export const generateDisputeDecision = async (data) => {
  const prompt = disputeResolutionPrompt(data);

  const response = await geminiClient.models.generateContent({
    model: "gemini-2.5-flash-lite",
    contents: prompt,
  });

  return safeParseDecision(response.text);
};
