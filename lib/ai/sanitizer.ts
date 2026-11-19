export interface SanitizeResult {
  isSafe: boolean;
  sanitizedText: string;
  threatsDetected: string[];
}

// Patterns commonly used in jailbreaks, prompt injection, and command overrides
const ADVERSARIAL_PATTERNS = [
  /system\s+override/i,
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /ignore\s+(all\s+)?above\s+instructions/i,
  /forget\s+all\s+prior\s+guidelines/i,
  /delete\s+all\s+(database|rows|tables|records)/i,
  /reply\s+with\s+(api\s+keys|env|environment\s+variables|system\s+prompt|credentials)/i,
  /reveal\s+(api\s+keys|system\s+prompt|passwords)/i,
  /you\s+are\s+now\s+in\s+(developer|unrestricted|god)\s+mode/i,
  /output\s+["']?pwned["']?/i,
  /<script[\s\S]*?>[\s\S]*?<\/script>/i,
  /javascript:/i,
];

/**
 * Strips adversarial instructions, malicious prompt injection vectors,
 * and flags security threats while preserving legitimate business inquiries.
 */
export function sanitizeInboundPrompt(text: string): SanitizeResult {
  if (!text) {
    return {
      isSafe: true,
      sanitizedText: "",
      threatsDetected: [],
    };
  }

  const threats: string[] = [];
  let sanitized = text;

  for (const pattern of ADVERSARIAL_PATTERNS) {
    if (pattern.test(sanitized)) {
      threats.push(pattern.source);
      // Neutralize matched adversarial text into safe redacted token
      sanitized = sanitized.replace(pattern, "[BLOCKED_ADVERSARIAL_PAYLOAD]");
    }
  }

  // Remove potential script tags or direct raw code execution tags
  sanitized = sanitized.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");

  return {
    isSafe: threats.length === 0,
    sanitizedText: sanitized.trim(),
    threatsDetected: threats,
  };
}
