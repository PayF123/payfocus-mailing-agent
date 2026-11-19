import { google } from "googleapis";
import { OAuth2Client } from "google-auth-library";

export interface GmailCredentials {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  refreshToken?: string;
  accessToken?: string;
}

export interface ParsedEmailMessage {
  message_id: string;
  thread_id: string;
  sender: string;
  recipient: string;
  subject: string;
  body: string;
  date: string;
  truncated: boolean;
  rawSizeEstimateBytes: number;
}

// 4MB safe boundary to respect Vercel's 4.5MB serverless payload limit
export const MAX_SAFE_BODY_BYTES = 4 * 1024 * 1024;

export class GmailAuthError extends Error {
  statusCode: number;
  constructor(message: string, statusCode: number = 401) {
    super(message);
    this.name = "GmailAuthError";
    this.statusCode = statusCode;
  }
}

let mockOAuth2ClientOverride: any = null;

export function setMockOAuth2Client(client: any) {
  mockOAuth2ClientOverride = client;
}

const globalForGmail = globalThis as unknown as {
  __payfocusLatestTokens?: { accessToken?: string; refreshToken?: string };
  __payfocusTokensByEmail?: Record<string, { accessToken?: string; refreshToken?: string }>;
};

export function cacheUserOAuthTokens(
  tokens: { accessToken?: string; refreshToken?: string },
  userEmail?: string | null
) {
  if (!tokens.accessToken && !tokens.refreshToken) return;
  globalForGmail.__payfocusLatestTokens = {
    accessToken: tokens.accessToken || globalForGmail.__payfocusLatestTokens?.accessToken,
    refreshToken: tokens.refreshToken || globalForGmail.__payfocusLatestTokens?.refreshToken,
  };
  if (userEmail) {
    if (!globalForGmail.__payfocusTokensByEmail) {
      globalForGmail.__payfocusTokensByEmail = {};
    }
    const key = userEmail.toLowerCase();
    globalForGmail.__payfocusTokensByEmail[key] = {
      accessToken: tokens.accessToken || globalForGmail.__payfocusTokensByEmail[key]?.accessToken,
      refreshToken: tokens.refreshToken || globalForGmail.__payfocusTokensByEmail[key]?.refreshToken,
    };
  }
}

export function getCachedUserOAuthTokens(userEmail?: string | null): {
  accessToken?: string;
  refreshToken?: string;
} | undefined {
  if (userEmail && globalForGmail.__payfocusTokensByEmail?.[userEmail.toLowerCase()]) {
    return globalForGmail.__payfocusTokensByEmail[userEmail.toLowerCase()];
  }
  return globalForGmail.__payfocusLatestTokens;
}

/**
 * Creates and configures an authorized OAuth2Client with refresh token support
 */
export function getOAuth2Client(credentials?: Partial<GmailCredentials>): OAuth2Client {
  if (mockOAuth2ClientOverride) {
    return mockOAuth2ClientOverride;
  }

  const clientId = credentials?.clientId || process.env.GOOGLE_CLIENT_ID;
  const clientSecret = credentials?.clientSecret || process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = credentials?.redirectUri || process.env.GOOGLE_REDIRECT_URI || "https://developers.google.com/oauthplayground";
  const cached = getCachedUserOAuthTokens();
  const accessToken = credentials?.accessToken || cached?.accessToken;
  const refreshToken =
    credentials?.refreshToken ||
    cached?.refreshToken ||
    (!accessToken ? process.env.GOOGLE_REFRESH_TOKEN : undefined);

  if (!clientId || !clientSecret) {
    throw new GmailAuthError("Missing Google OAuth credentials (client ID or client secret)", 500);
  }

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

  if (credentials?.accessToken || credentials?.refreshToken) {
    cacheUserOAuthTokens({
      accessToken: credentials.accessToken,
      refreshToken: credentials.refreshToken,
    });
    oauth2Client.setCredentials({
      ...(credentials.accessToken ? { access_token: credentials.accessToken } : {}),
      ...(credentials.refreshToken ? { refresh_token: credentials.refreshToken } : {}),
    });
  } else if (accessToken || refreshToken) {
    oauth2Client.setCredentials({
      ...(accessToken ? { access_token: accessToken } : {}),
      ...(refreshToken ? { refresh_token: refreshToken } : {}),
    });
  }

  return oauth2Client;
}

/**
 * Decodes base64url encoded string safe for email bodies
 */
export function decodeBase64Url(data: string): string {
  try {
    const sanitized = data.replace(/-/g, "+").replace(/_/g, "/");
    return Buffer.from(sanitized, "base64").toString("utf-8");
  } catch {
    return "";
  }
}

/**
 * Decodes RFC 2047 encoded-word headers, e.g. =?UTF-8?B?...?= or =?ISO-8859-1?Q?...?=
 */
export function decodeMimeHeader(headerVal: string): string {
  if (!headerVal) return "";

  // Regex pattern for RFC 2047: =?charset?encoding?encoded_text?=
  const regex = /=\?([^?]+)\?([BQbq])\?([^?]+)\?=/g;

  return headerVal.replace(regex, (_, charset, encoding, text) => {
    try {
      const enc = encoding.toUpperCase();
      if (enc === "B") {
        return Buffer.from(text, "base64").toString(charset.toLowerCase() as BufferEncoding);
      } else if (enc === "Q") {
        // Quoted-printable
        const decoded = text
          .replace(/_/g, " ")
          .replace(/=([0-9A-Fa-f]{2})/g, (_m: string, hex: string) =>
            String.fromCharCode(parseInt(hex, 16))
          );
        return decoded;
      }
    } catch {
      // Fallback if charset or decoding fails
      return text;
    }
    return text;
  });
}

/**
 * Traverses Gmail message payload parts to extract plaintext or html body
 */
export function extractBodyFromParts(payload: any): string {
  if (!payload) return "";

  // If top-level body has data
  if (payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }

  if (payload.parts && Array.isArray(payload.parts)) {
    // Priority 1: text/plain
    for (const part of payload.parts) {
      if (part.mimeType === "text/plain" && part.body?.data) {
        return decodeBase64Url(part.body.data);
      }
    }

    // Priority 2: text/html
    for (const part of payload.parts) {
      if (part.mimeType === "text/html" && part.body?.data) {
        const html = decodeBase64Url(part.body.data);
        // Strip basic HTML tags for body text
        return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
      }
    }

    // Recursive search for multipart/alternative or multipart/mixed
    for (const part of payload.parts) {
      if (part.parts) {
        const nested = extractBodyFromParts(part);
        if (nested) return nested;
      }
    }
  }

  return "";
}

/**
 * Parses raw Gmail API message resource into clean, safe ParsedEmailMessage
 */
export function parseGmailMessage(message: any): ParsedEmailMessage {
  if (!message || !message.id) {
    throw new Error("Invalid Gmail message object: missing message id");
  }

  const headers: Record<string, string> = {};
  if (message.payload?.headers && Array.isArray(message.payload.headers)) {
    for (const h of message.payload.headers) {
      if (h.name && h.value) {
        headers[h.name.toLowerCase()] = h.value;
      }
    }
  }

  const rawSubject = headers["subject"] || "(No Subject)";
  const subject = decodeMimeHeader(rawSubject);

  const rawSender = headers["from"] || "unknown@sender.com";
  const sender = decodeMimeHeader(rawSender);

  const rawRecipient = headers["to"] || headers["delivered-to"] || "unknown@recipient.com";
  const recipient = decodeMimeHeader(rawRecipient);

  const date = headers["date"] || new Date().toISOString();

  let body = extractBodyFromParts(message.payload);

  // Payload truncation guard: check byte size
  const bodyBytes = Buffer.byteLength(body, "utf-8");
  let truncated = false;

  if (bodyBytes > MAX_SAFE_BODY_BYTES) {
    // Truncate to MAX_SAFE_BODY_BYTES safely at utf-8 boundary
    const buf = Buffer.from(body, "utf-8");
    body = buf.subarray(0, MAX_SAFE_BODY_BYTES).toString("utf-8") + "\n\n[TRUNCATED: Payload exceeded 4MB limit]";
    truncated = true;
  }

  return {
    message_id: message.id,
    thread_id: message.threadId || message.id,
    sender,
    recipient,
    subject,
    body,
    date,
    truncated,
    rawSizeEstimateBytes: message.sizeEstimate || bodyBytes,
  };
}

/**
 * Refreshes OAuth2 access token if needed or throws clean 401
 */
export async function ensureValidAccessToken(oauth2Client: OAuth2Client): Promise<string> {
  try {
    const tokenResponse = await oauth2Client.getAccessToken();
    if (!tokenResponse || !tokenResponse.token) {
      throw new GmailAuthError("Failed to obtain OAuth access token from refresh token", 401);
    }
    return tokenResponse.token;
  } catch (err: any) {
    if (
      err.message?.includes("invalid_grant") ||
      err.message?.includes("Token has been expired or revoked") ||
      err.code === "400" ||
      err.code === "401"
    ) {
      throw new GmailAuthError("OAuth refresh token is invalid or revoked", 401);
    }
    throw new GmailAuthError(err.message || "OAuth authentication failure", 401);
  }
}

/**
 * Fetches unread or recent messages from Gmail inbox
 */
export async function fetchRecentEmails(
  oauth2Client: OAuth2Client,
  query: string = "is:unread",
  maxResults: number = 10
): Promise<ParsedEmailMessage[]> {
  await ensureValidAccessToken(oauth2Client);

  const gmail = google.gmail({ version: "v1", auth: oauth2Client });

  const listRes = await gmail.users.messages.list({
    userId: "me",
    q: query,
    maxResults,
  });

  const messageSummaries = listRes.data.messages || [];
  const parsedEmails: ParsedEmailMessage[] = [];

  for (const summary of messageSummaries) {
    if (!summary.id) continue;
    try {
      const fullMsg = await gmail.users.messages.get({
        userId: "me",
        id: summary.id,
        format: "full",
      });

      if (fullMsg.data) {
        parsedEmails.push(parseGmailMessage(fullMsg.data));
      }
    } catch (err) {
      // Individual message failure shouldn't abort the entire sync
      console.error(`Failed to fetch message ${summary.id}:`, err);
    }
  }

  return parsedEmails;
}

/**
 * Creates a draft in Gmail
 */
export async function createGmailDraft(
  oauth2Client: OAuth2Client,
  params: {
    to: string;
    subject: string;
    body: string;
    threadId?: string;
  }
): Promise<{ draftId: string; threadId: string }> {
  await ensureValidAccessToken(oauth2Client);

  const gmail = google.gmail({ version: "v1", auth: oauth2Client });

  const emailLines = [
    `To: ${params.to}`,
    `Subject: ${params.subject}`,
    "Content-Type: text/plain; charset=utf-8",
    "MIME-Version: 1.0",
    "",
    params.body,
  ];

  const rawMessage = emailLines.join("\r\n");
  const encodedEmail = Buffer.from(rawMessage)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const res = await gmail.users.drafts.create({
    userId: "me",
    requestBody: {
      message: {
        raw: encodedEmail,
        threadId: params.threadId,
      },
    },
  });

  return {
    draftId: res.data.id || "",
    threadId: res.data.message?.threadId || params.threadId || "",
  };
}
