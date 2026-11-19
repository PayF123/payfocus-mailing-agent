import { EmailRecord, DraftRecord } from "@/types/database";

export interface DemoEmailWithDrafts extends EmailRecord {
  drafts: DraftRecord[];
}

export const inMemoryDemoStore: {
  emails: DemoEmailWithDrafts[];
} = {
  emails: [
    {
      id: "demo-email-001",
      message_id: "msg-001",
      thread_id: "th-001",
      sender: "alex.kumar@enterprise-client.com",
      recipient: "support@payfocus.com",
      subject: "How do I rotate API secret keys in production?",
      body: "Hi PayFocus Team,\n\nWe need to rotate our primary production API secret keys per our quarterly security policy. Could you guide us on whether this requires any service downtime and where in the dashboard we should initiate the key regeneration?\n\nBest,\nAlex Kumar\nLead DevOps Engineer",
      status: "pending_review",
      urgency_score: 3,
      intent: "Support",
      created_at: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
      updated_at: new Date().toISOString(),
      drafts: [
        {
          id: "demo-draft-001",
          email_id: "demo-email-001",
          draft_body: "Hi Alex,\n\nThank you for reaching out to PayFocus support!\n\nTo rotate your production API secret keys with zero downtime:\n1. Navigate to Dashboard > Settings > API & Credentials.\n2. Click 'Generate Secondary Secret Key' to activate dual-verification.\n3. Update your production configuration with the secondary key.\n4. Once traffic switches over, click 'Revoke Primary Secret Key'.\n\nNo downtime is required when utilizing dual keys. Let us know if you need any additional assistance!\n\nBest regards,\nPayFocus Support Team",
          rationale: "Cited 'API Secret Key Dual-Rotation SLA' documentation. Recommended zero-downtime dual-key migration flow.",
          human_edited: false,
          created_at: new Date(Date.now() - 1000 * 60 * 25).toISOString(),
          updated_at: new Date().toISOString(),
        },
      ],
    },
    {
      id: "demo-email-002",
      message_id: "msg-002",
      thread_id: "th-002",
      sender: "sarah.jenkins@finscale.io",
      recipient: "sales@payfocus.com",
      subject: "Enterprise Tier & High-Volume SLA Inquiry",
      body: "Hello PayFocus Sales,\n\nWe are projecting 250,000 monthly transactions starting next quarter and would like to review custom volume pricing, dedicated account management, and our uptime guarantee terms.\n\nPlease share your enterprise tier schedule.\n\nRegards,\nSarah Jenkins\nHead of Engineering",
      status: "drafted",
      urgency_score: 4,
      intent: "Sales",
      created_at: new Date(Date.now() - 1000 * 60 * 60).toISOString(),
      updated_at: new Date().toISOString(),
      drafts: [
        {
          id: "demo-draft-002",
          email_id: "demo-email-002",
          draft_body: "Hi Sarah,\n\nThank you for considering PayFocus for FinScale's high-volume payment processing!\n\nFor accounts scaling past 100,000 monthly transactions, our Enterprise Tier includes:\n- Custom tiered pricing with volume rebates starting at 150k transactions.\n- 99.99% contractual uptime SLA with financial credits.\n- Dedicated Solutions Architect and 24/7 priority incident response.\n\nI would love to arrange a 15-minute briefing with our solutions lead this week. Would Thursday at 2 PM EST work for you?\n\nWarm regards,\nPayFocus Enterprise Team",
          rationale: "Enterprise Sales Playbook matched. Proposed tailored call schedule and cited 99.99% contractual SLA.",
          human_edited: false,
          created_at: new Date(Date.now() - 1000 * 60 * 55).toISOString(),
          updated_at: new Date().toISOString(),
        },
      ],
    },
    {
      id: "demo-email-003",
      message_id: "msg-003",
      thread_id: "th-003",
      sender: "security-auditor@external-audit.org",
      recipient: "support@payfocus.com",
      subject: "URGENT: Suspicious settlement discrepancy in batch #9482",
      body: "Dear Support,\n\nWe noticed a batch settlement mismatch in batch #9482 processed at 04:00 UTC. The aggregate sum displays an offset of $1,420.00 against the clearing house ledger. Please verify immediately.\n\nUrgent,\nMarcus Aurel",
      status: "pending_review",
      urgency_score: 5,
      intent: "Urgent",
      created_at: new Date(Date.now() - 1000 * 60 * 15).toISOString(),
      updated_at: new Date().toISOString(),
      drafts: [
        {
          id: "demo-draft-003",
          email_id: "demo-email-003",
          draft_body: "Hi Marcus,\n\nThank you for alerting us immediately regarding batch #9482.\n\nOur financial reconciliation engine has identified the transient ledger hold causing this $1,420.00 clearing house offset, and our Tier-3 financial engineering team has initiated the verification protocol.\n\nWe will update you within the next 30 minutes with the resolution audit trail.\n\nBest regards,\nPayFocus Escalations Desk",
          rationale: "Flagged Urgency 5 due to financial discrepancy. Formulated high-priority response acknowledging investigation.",
          human_edited: false,
          created_at: new Date(Date.now() - 1000 * 60 * 10).toISOString(),
          updated_at: new Date().toISOString(),
        },
      ],
    },
  ],
};
