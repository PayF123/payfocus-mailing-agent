"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import {
  Inbox,
  Send,
  Edit3,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RefreshCw,
  Clock,
  User as UserIcon,
  LogOut,
  LogIn,
  Mail,
  FileText,
  Archive,
  BookOpen,
  Plus,
  Trash2,
  Upload,
  Database,
} from "lucide-react";

interface Draft {
  id: string;
  email_id: string;
  draft_body: string;
  rationale: string;
  human_edited: boolean;
  created_at: string;
}

interface EmailItem {
  id: string;
  message_id: string;
  thread_id: string;
  sender: string;
  recipient: string;
  subject: string;
  body: string;
  status: "pending_review" | "drafted" | "approved" | "sent" | "dismissed";
  urgency_score: number;
  intent: string;
  created_at: string;
  drafts?: Draft[];
}

interface KnowledgeDoc {
  id: string;
  title: string;
  content: string;
  category: string;
  created_at: string;
}

export default function Dashboard() {
  const router = useRouter();
  const { user, loading: authLoading, getGoogleTokens, signOut } = useAuth();

  const [activeView, setActiveView] = useState<"mail" | "knowledge">("mail");
  const [allEmails, setAllEmails] = useState<EmailItem[]>([]);
  const [selectedEmail, setSelectedEmail] = useState<EmailItem | null>(null);
  const [activeFilter, setActiveFilter] = useState<string>("all");
  const [loading, setLoading] = useState<boolean>(false);
  const [syncing, setSyncing] = useState<boolean>(false);
  const [actionLoading, setActionLoading] = useState<boolean>(false);
  const [editedDraft, setEditedDraft] = useState<string>("");
  const [feedbackMessage, setFeedbackMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Knowledge Base State
  const [knowledgeDocs, setKnowledgeDocs] = useState<KnowledgeDoc[]>([]);
  const [kbLoading, setKbLoading] = useState<boolean>(false);
  const [showAddDoc, setShowAddDoc] = useState<boolean>(false);
  const [newDocTitle, setNewDocTitle] = useState<string>("");
  const [newDocCategory, setNewDocCategory] = useState<string>("Sales & Pricing");
  const [newDocContent, setNewDocContent] = useState<string>("");
  const [kbFeedback, setKbFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (authLoading) return;
    setAllEmails([]);
    setSelectedEmail(null);
    fetchInbox(user?.email);
    fetchKnowledgeDocs();
  }, [user?.email, authLoading]);

  const filteredEmails =
    activeFilter === "all"
      ? allEmails
      : activeFilter === "pending_review"
      ? allEmails.filter((e) => e.status === "pending_review" || e.status === "drafted")
      : allEmails.filter((e) => e.status === activeFilter);

  const counts = {
    all: allEmails.length,
    pending_review: allEmails.filter((e) => e.status === "pending_review" || e.status === "drafted").length,
    drafted: allEmails.filter((e) => e.status === "drafted").length,
    sent: allEmails.filter((e) => e.status === "sent").length,
    dismissed: allEmails.filter((e) => e.status === "dismissed").length,
  };

  useEffect(() => {
    if (filteredEmails.length > 0) {
      setSelectedEmail((prev) => {
        const exists = prev && filteredEmails.some((e) => e.id === prev.id);
        return exists ? prev : filteredEmails[0];
      });
    } else {
      setSelectedEmail(null);
    }
  }, [activeFilter, allEmails]);

  useEffect(() => {
    if (selectedEmail) {
      const activeDraft = selectedEmail.drafts && selectedEmail.drafts[0];
      setEditedDraft(activeDraft ? activeDraft.draft_body : "");
    }
  }, [selectedEmail]);

  const fetchInbox = async (overrideEmail?: string | null) => {
    setLoading(true);
    try {
      const targetEmail = overrideEmail !== undefined ? overrideEmail : user?.email;
      const url = targetEmail
        ? `/api/emails?user_email=${encodeURIComponent(targetEmail)}`
        : "/api/emails";
      const res = await fetch(url);
      const json = await res.json();
      if (json.emails) {
        setAllEmails(json.emails);
      }
    } catch {
      // Fallback display if database isn't connected
    } finally {
      setLoading(false);
    }
  };

  const fetchKnowledgeDocs = async () => {
    setKbLoading(true);
    try {
      const res = await fetch("/api/knowledge");
      const json = await res.json();
      if (Array.isArray(json.docs)) {
        setKnowledgeDocs(json.docs);
      }
    } catch {
      // Ignore error
    } finally {
      setKbLoading(false);
    }
  };

  const handleSeedStarterDocs = async () => {
    setKbLoading(true);
    setKbFeedback(null);
    try {
      const res = await fetch("/api/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "seed_defaults" }),
      });
      const json = await res.json();
      if (!res.ok || json.error) {
        throw new Error(json.error || "Failed to load starter documents");
      }
      setKnowledgeDocs(json.docs || []);
      setKbFeedback({
        type: "success",
        text:
          json.seededCount > 0
            ? `Added ${json.seededCount} starter policy documents with 768-dim vector embeddings.`
            : "All starter policy documents are already present in the knowledge base.",
      });
    } catch (err: any) {
      setKbFeedback({ type: "error", text: err.message });
    } finally {
      setKbLoading(false);
    }
  };

  const handleCreateDoc = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDocTitle.trim() || !newDocContent.trim()) {
      setKbFeedback({ type: "error", text: "Please provide both a document title and content." });
      return;
    }

    setKbLoading(true);
    setKbFeedback(null);
    try {
      const res = await fetch("/api/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: newDocTitle.trim(),
          category: newDocCategory,
          content: newDocContent.trim(),
        }),
      });
      const json = await res.json();
      if (!res.ok || json.error) {
        throw new Error(json.error || "Failed to save knowledge document");
      }
      if (json.doc) {
        setKnowledgeDocs((prev) => [json.doc, ...prev]);
      } else {
        await fetchKnowledgeDocs();
      }
      setNewDocTitle("");
      setNewDocContent("");
      setShowAddDoc(false);
      setKbFeedback({
        type: "success",
        text: "Document indexed with 768-dim vector embedding and added to Knowledge Base.",
      });
    } catch (err: any) {
      setKbFeedback({ type: "error", text: err.message });
    } finally {
      setKbLoading(false);
    }
  };

  const handleDeleteDoc = async (docId: string, docTitle: string) => {
    setKbLoading(true);
    setKbFeedback(null);
    try {
      const res = await fetch(`/api/knowledge/${docId}`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (!res.ok || json.error) {
        throw new Error(json.error || "Failed to delete document");
      }
      setKnowledgeDocs((prev) => prev.filter((d) => d.id !== docId));
      setKbFeedback({
        type: "success",
        text: `Removed "${docTitle}" from Knowledge Base.`,
      });
    } catch (err: any) {
      setKbFeedback({ type: "error", text: err.message });
    } finally {
      setKbLoading(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === "string" ? reader.result : "";
      if (!newDocTitle.trim()) {
        setNewDocTitle(file.name.replace(/\.(txt|md|csv|json)$/i, ""));
      }
      setNewDocContent(text);
    };
    reader.readAsText(file);
  };

  const handleSyncGmail = async () => {
    setSyncing(true);
    setFeedbackMessage(null);
    try {
      const url = user?.email
        ? `/api/emails/sync?limit=5&user_email=${encodeURIComponent(user.email)}`
        : "/api/emails/sync?limit=5";
      const { accessToken, refreshToken } = getGoogleTokens();
      const headers: Record<string, string> = {};
      if (accessToken) headers["x-gmail-access-token"] = accessToken;
      if (refreshToken) headers["x-gmail-refresh-token"] = refreshToken;

      const res = await fetch(url, { headers });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || "Failed to sync emails from Gmail");
      }
      setFeedbackMessage({
        type: "success",
        text: `Synced ${data.syncedCount || 0} messages from Gmail (${user?.email || "Admin"}).`,
      });
      await fetchInbox(user?.email);
    } catch (err: any) {
      setFeedbackMessage({
        type: "error",
        text: `Sync failed: ${err.message}`,
      });
    } finally {
      setSyncing(false);
    }
  };

  const handleApproveAndSend = async () => {
    if (!selectedEmail) return;
    setActionLoading(true);
    setFeedbackMessage(null);

    const prevStatus = selectedEmail.status;
    const updated = { ...selectedEmail, status: "sent" as const };
    setSelectedEmail(updated);
    setAllEmails((prev) =>
      prev.map((e) => (e.id === selectedEmail.id ? updated : e))
    );

    try {
      const { accessToken, refreshToken } = getGoogleTokens();
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Authorization: "Bearer active_session_token",
      };
      if (accessToken) headers["x-gmail-access-token"] = accessToken;
      if (refreshToken) headers["x-gmail-refresh-token"] = refreshToken;

      const res = await fetch(`/api/drafts/${selectedEmail.id}/approve`, {
        method: "POST",
        headers,
        body: JSON.stringify({ editedDraftBody: editedDraft }),
      });

      const json = await res.json();
      if (!res.ok) {
        setSelectedEmail({ ...selectedEmail, status: prevStatus });
        setAllEmails((prev) =>
          prev.map((e) => (e.id === selectedEmail.id ? { ...e, status: prevStatus } : e))
        );
        setFeedbackMessage({ type: "error", text: json.error || "Failed to send message" });
      } else {
        setFeedbackMessage({ type: "success", text: "Reply sent via Gmail and moved to Sent." });
      }
    } catch (err: any) {
      setSelectedEmail({ ...selectedEmail, status: prevStatus });
      setAllEmails((prev) =>
        prev.map((e) => (e.id === selectedEmail.id ? { ...e, status: prevStatus } : e))
      );
      setFeedbackMessage({ type: "error", text: err.message });
    } finally {
      setActionLoading(false);
    }
  };

  const handleSaveDraft = async () => {
    if (!selectedEmail) return;
    setActionLoading(true);
    const draftId = selectedEmail.drafts?.[0]?.id || selectedEmail.id;

    try {
      const { accessToken, refreshToken } = getGoogleTokens();
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Authorization: "Bearer active_session_token",
      };
      if (accessToken) headers["x-gmail-access-token"] = accessToken;
      if (refreshToken) headers["x-gmail-refresh-token"] = refreshToken;

      const res = await fetch(`/api/drafts/${draftId}/save`, {
        method: "POST",
        headers,
        body: JSON.stringify({ draftBody: editedDraft }),
      });

      if (res.ok) {
        const json = await res.json();
        const savedDraft = json.draft || {
          id: draftId,
          email_id: selectedEmail.id,
          draft_body: editedDraft,
          human_edited: true,
          rationale: "Updated by operator",
          created_at: new Date().toISOString(),
        };

        const existingDrafts = selectedEmail.drafts || [];
        const updatedDrafts = [savedDraft, ...existingDrafts.filter((d) => d.id !== savedDraft.id)];
        const updatedEmail = { ...selectedEmail, drafts: updatedDrafts };

        setSelectedEmail(updatedEmail);
        setAllEmails((prev) => prev.map((e) => (e.id === selectedEmail.id ? updatedEmail : e)));
        setFeedbackMessage({ type: "success", text: "Draft changes saved and synced to Gmail." });
      } else {
        const json = await res.json();
        setFeedbackMessage({ type: "error", text: json.error || "Could not save draft." });
      }
    } catch (err: any) {
      setFeedbackMessage({ type: "error", text: err.message });
    } finally {
      setActionLoading(false);
    }
  };

  const handleDismiss = async () => {
    if (!selectedEmail) return;
    setActionLoading(true);
    try {
      const res = await fetch(`/api/emails/${selectedEmail.id}/dismiss`, {
        method: "POST",
        headers: { Authorization: "Bearer active_session_token" },
      });

      if (res.ok) {
        const updated = { ...selectedEmail, status: "dismissed" as const };
        setSelectedEmail(updated);
        setAllEmails((prev) =>
          prev.map((e) => (e.id === selectedEmail.id ? updated : e))
        );
        setFeedbackMessage({ type: "success", text: "Conversation archived / dismissed." });
      } else {
        const json = await res.json();
        setFeedbackMessage({ type: "error", text: json.error || "Could not dismiss message" });
      }
    } catch (err: any) {
      setFeedbackMessage({ type: "error", text: err.message });
    } finally {
      setActionLoading(false);
    }
  };

  const selectMailFilter = (filter: string) => {
    setActiveView("mail");
    setActiveFilter(filter);
  };

  return (
    <div className="flex h-screen w-full bg-[#f6f7f9] font-sans text-slate-800 overflow-hidden">
      {/* Left Navigation Sidebar — Soft Warm Stone (#F0F2F5) for zero eye strain */}
      <aside className="w-60 border-r border-slate-200/90 bg-[#f0f2f5] p-3.5 flex flex-col justify-between select-none">
        <div>
          {/* Classic Enterprise Header */}
          <div className="flex items-center gap-2.5 mb-6 px-2 pt-1">
            <div className="w-7 h-7 rounded-md bg-slate-800 text-white flex items-center justify-center font-semibold text-xs tracking-tight shadow-sm">
              PF
            </div>
            <div className="leading-tight">
              <span className="font-semibold text-sm text-slate-900 block">PayFocus</span>
              <span className="text-[11px] text-slate-500 block">Mail Operations</span>
            </div>
          </div>

          <div className="px-2 mb-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Mailboxes
            </span>
          </div>

          <nav className="space-y-0.5">
            <button
              onClick={() => selectMailFilter("all")}
              className={`w-full flex items-center justify-between px-2.5 py-2 rounded-md text-[13px] font-medium transition ${
                activeView === "mail" && activeFilter === "all"
                  ? "bg-white text-slate-900 shadow-sm border border-slate-200/80"
                  : "text-slate-600 hover:bg-slate-200/60 hover:text-slate-900"
              }`}
            >
              <span className="flex items-center gap-2.5">
                <Inbox className="w-4 h-4 text-slate-500" /> All Inbound
              </span>
              <span className="text-xs text-slate-500 font-normal">{counts.all}</span>
            </button>

            <button
              onClick={() => selectMailFilter("pending_review")}
              className={`w-full flex items-center justify-between px-2.5 py-2 rounded-md text-[13px] font-medium transition ${
                activeView === "mail" && activeFilter === "pending_review"
                  ? "bg-white text-slate-900 shadow-sm border border-slate-200/80"
                  : "text-slate-600 hover:bg-slate-200/60 hover:text-slate-900"
              }`}
            >
              <span className="flex items-center gap-2.5">
                <Clock className="w-4 h-4 text-amber-600" /> Needs Review
              </span>
              <span className="text-xs font-medium text-amber-700 bg-amber-100/80 px-1.5 py-0.5 rounded">
                {counts.pending_review}
              </span>
            </button>

            <button
              onClick={() => selectMailFilter("drafted")}
              className={`w-full flex items-center justify-between px-2.5 py-2 rounded-md text-[13px] font-medium transition ${
                activeView === "mail" && activeFilter === "drafted"
                  ? "bg-white text-slate-900 shadow-sm border border-slate-200/80"
                  : "text-slate-600 hover:bg-slate-200/60 hover:text-slate-900"
              }`}
            >
              <span className="flex items-center gap-2.5">
                <Edit3 className="w-4 h-4 text-blue-600" /> Drafts Ready
              </span>
              <span className="text-xs text-slate-500 font-normal">{counts.drafted}</span>
            </button>

            <button
              onClick={() => selectMailFilter("sent")}
              className={`w-full flex items-center justify-between px-2.5 py-2 rounded-md text-[13px] font-medium transition ${
                activeView === "mail" && activeFilter === "sent"
                  ? "bg-white text-slate-900 shadow-sm border border-slate-200/80"
                  : "text-slate-600 hover:bg-slate-200/60 hover:text-slate-900"
              }`}
            >
              <span className="flex items-center gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" /> Sent
              </span>
              <span className="text-xs text-slate-500 font-normal">{counts.sent}</span>
            </button>

            <button
              onClick={() => selectMailFilter("dismissed")}
              className={`w-full flex items-center justify-between px-2.5 py-2 rounded-md text-[13px] font-medium transition ${
                activeView === "mail" && activeFilter === "dismissed"
                  ? "bg-white text-slate-900 shadow-sm border border-slate-200/80"
                  : "text-slate-600 hover:bg-slate-200/60 hover:text-slate-900"
              }`}
            >
              <span className="flex items-center gap-2.5">
                <Archive className="w-4 h-4 text-slate-500" /> Archived
              </span>
              <span className="text-xs text-slate-500 font-normal">{counts.dismissed}</span>
            </button>
          </nav>

          {/* Self-Serve Knowledge Base Section */}
          <div className="px-2 mt-6 mb-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Company Context
            </span>
          </div>

          <nav className="space-y-0.5">
            <button
              onClick={() => setActiveView("knowledge")}
              className={`w-full flex items-center justify-between px-2.5 py-2 rounded-md text-[13px] font-medium transition ${
                activeView === "knowledge"
                  ? "bg-white text-slate-900 shadow-sm border border-slate-200/80"
                  : "text-slate-600 hover:bg-slate-200/60 hover:text-slate-900"
              }`}
            >
              <span className="flex items-center gap-2.5">
                <BookOpen className="w-4 h-4 text-slate-600" /> Knowledge Base
              </span>
              <span className="text-xs text-slate-600 bg-slate-200/80 px-1.5 py-0.5 rounded font-medium">
                {knowledgeDocs.length}
              </span>
            </button>
          </nav>
        </div>

        {/* Operator Account Footer */}
        <div className="pt-3 border-t border-slate-200/90 space-y-2.5">
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-2 overflow-hidden">
              <div className="w-7 h-7 rounded-full bg-slate-200 border border-slate-300 flex items-center justify-center text-slate-700 font-semibold text-xs flex-shrink-0">
                {user?.email ? user.email.charAt(0).toUpperCase() : "A"}
              </div>
              <div className="truncate">
                <p className="text-xs font-medium text-slate-800 truncate">
                  {user?.email ?? "Local Operator"}
                </p>
                <p className="text-[11px] text-slate-500 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-600" />
                  Gmail synced
                </p>
              </div>
            </div>

            {user ? (
              <button
                onClick={async () => {
                  await signOut();
                  router.push("/login");
                }}
                title="Sign Out"
                className="p-1.5 rounded-md text-slate-500 hover:text-rose-600 hover:bg-slate-200/70 transition"
              >
                <LogOut className="w-4 h-4" />
              </button>
            ) : (
              <button
                onClick={() => router.push("/login")}
                title="Sign In / Switch Account"
                className="p-1.5 rounded-md text-slate-500 hover:text-slate-900 hover:bg-slate-200/70 transition"
              >
                <LogIn className="w-4 h-4" />
              </button>
            )}
          </div>

          <div className="px-1 text-[11px] text-slate-500 flex items-center justify-between">
            <span>Manual approval active</span>
          </div>
        </div>
      </aside>

      {activeView === "knowledge" ? (
        /* Self-Serve Company Knowledge Base (RAG) Workspace */
        <main className="flex-1 flex flex-col bg-[#f6f7f9] overflow-y-auto">
          <div className="p-6 lg:p-8 max-w-5xl w-full mx-auto space-y-6">
            {/* Header Bar */}
            <div className="flex flex-wrap items-start justify-between gap-4 bg-white border border-slate-200/90 rounded-lg p-6 shadow-sm">
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-lg font-semibold text-slate-900">
                    Company Knowledge Base
                  </h1>
                  <span className="text-[11px] font-medium px-2 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200">
                    {knowledgeDocs.length} Indexed Policies
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-1 max-w-2xl leading-relaxed">
                  Add your company&apos;s official pricing tiers, refund rules, SLAs, and technical FAQs here. Every document is automatically indexed into Supabase pgvector (768-dim) and referenced when drafting replies.
                </p>
              </div>

              <div className="flex items-center gap-2.5">
                <button
                  onClick={handleSeedStarterDocs}
                  disabled={kbLoading}
                  className="px-3.5 py-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 rounded-md text-xs font-medium flex items-center gap-1.5 transition shadow-sm disabled:opacity-50"
                >
                  <Database className="w-3.5 h-3.5 text-slate-500" />
                  Load Sample Policies
                </button>

                <button
                  onClick={() => setShowAddDoc((v) => !v)}
                  className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-md text-xs font-medium flex items-center gap-1.5 transition shadow-sm"
                >
                  <Plus className="w-3.5 h-3.5" />
                  {showAddDoc ? "Close Editor" : "Add Policy / FAQ"}
                </button>
              </div>
            </div>

            {kbFeedback && (
              <div
                className={`px-4 py-3 rounded-md text-xs font-medium border flex items-center gap-2.5 shadow-sm ${
                  kbFeedback.type === "success"
                    ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                    : "bg-rose-50 border-rose-200 text-rose-800"
                }`}
              >
                {kbFeedback.type === "success" ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-rose-600 flex-shrink-0" />
                )}
                <span>{kbFeedback.text}</span>
              </div>
            )}

            {/* Add New Document Form */}
            {showAddDoc && (
              <form
                onSubmit={handleCreateDoc}
                className="bg-white border border-slate-300 rounded-lg p-6 shadow-sm space-y-4"
              >
                <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">
                      Add New Knowledge Document
                    </h3>
                    <p className="text-xs text-slate-500">
                      Paste your policy text below or upload a .txt / .md file.
                    </p>
                  </div>

                  <label className="cursor-pointer px-3 py-1.5 bg-slate-100 hover:bg-slate-200/80 text-slate-700 border border-slate-200 rounded-md text-xs font-medium inline-flex items-center gap-1.5 transition">
                    <Upload className="w-3.5 h-3.5 text-slate-500" />
                    <span>Import .txt / .md</span>
                    <input
                      type="file"
                      accept=".txt,.md,.csv,.json"
                      onChange={handleFileUpload}
                      className="hidden"
                    />
                  </label>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="md:col-span-2">
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Document Title
                    </label>
                    <input
                      type="text"
                      value={newDocTitle}
                      onChange={(e) => setNewDocTitle(e.target.value)}
                      placeholder="e.g. Enterprise Pricing & Custom Volume Tiers"
                      className="w-full bg-white border border-slate-300 rounded-md px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-slate-600"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Category
                    </label>
                    <select
                      value={newDocCategory}
                      onChange={(e) => setNewDocCategory(e.target.value)}
                      className="w-full bg-white border border-slate-300 rounded-md px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-slate-600"
                    >
                      <option value="Sales & Pricing">Sales & Pricing</option>
                      <option value="Technical & API">Technical & API</option>
                      <option value="Billing & Refunds">Billing & Refunds</option>
                      <option value="SLA & Support">SLA & Support</option>
                      <option value="General FAQ">General FAQ</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Official Policy / Reference Content
                  </label>
                  <textarea
                    value={newDocContent}
                    onChange={(e) => setNewDocContent(e.target.value)}
                    rows={6}
                    placeholder="Write exact rates, steps, SLA timelines, or policy guidelines that should be cited in customer replies..."
                    className="w-full bg-[#fcfcfd] border border-slate-300 rounded-md p-3 text-xs text-slate-800 focus:outline-none focus:border-slate-600 leading-relaxed"
                    required
                  />
                </div>

                <div className="flex items-center justify-end gap-2.5 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowAddDoc(false)}
                    className="px-3.5 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 rounded-md"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={kbLoading}
                    className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-md text-xs font-medium transition shadow-sm disabled:opacity-50"
                  >
                    {kbLoading ? "Indexing Vector..." : "Save & Index to Knowledge Base"}
                  </button>
                </div>
              </form>
            )}

            {/* Indexed Documents List */}
            {knowledgeDocs.length === 0 ? (
              <div className="bg-white border border-slate-200/90 rounded-lg p-12 text-center space-y-3 shadow-sm">
                <BookOpen className="w-8 h-8 text-slate-300 mx-auto" />
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold text-slate-800">
                    No company knowledge documents indexed yet
                  </h3>
                  <p className="text-xs text-slate-500 max-w-md mx-auto">
                    Click &ldquo;Load Sample Policies&rdquo; to populate 5 starter templates, or click &ldquo;Add Policy / FAQ&rdquo; to enter your own company documentation.
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {knowledgeDocs.map((doc) => (
                  <div
                    key={doc.id}
                    className="bg-white border border-slate-200/90 rounded-lg p-5 shadow-sm hover:border-slate-300 transition"
                  >
                    <div className="flex items-start justify-between gap-4 pb-3 border-b border-slate-100">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-sm font-semibold text-slate-900">
                            {doc.title}
                          </h3>
                          <span className="text-[11px] font-medium px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">
                            {doc.category || "General"}
                          </span>
                          <span className="text-[10px] font-medium px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                            pgvector 768d
                          </span>
                        </div>
                      </div>

                      <button
                        onClick={() => handleDeleteDoc(doc.id, doc.title)}
                        disabled={kbLoading}
                        title="Delete policy from knowledge base"
                        className="p-1.5 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="mt-3 whitespace-pre-wrap text-xs text-slate-600 leading-relaxed">
                      {doc.content}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </main>
      ) : (
        <>
          {/* Middle Column: Message List */}
          <section className="w-[360px] border-r border-slate-200/90 bg-white flex flex-col">
            <div className="px-4 py-3.5 border-b border-slate-200/90 flex items-center justify-between gap-2 bg-[#fafbfc]">
              <div>
                <h2 className="font-semibold text-slate-800 text-sm">Messages</h2>
                <p className="text-[11px] text-slate-500 capitalize">
                  {counts[activeFilter as keyof typeof counts] ?? counts.all} in {activeFilter.replace("_", " ")}
                </p>
              </div>
              <button
                onClick={handleSyncGmail}
                disabled={syncing || loading}
                className="px-3 py-1.5 bg-white hover:bg-slate-50 active:bg-slate-100 disabled:opacity-50 text-slate-700 border border-slate-300 rounded-md text-xs font-medium flex items-center gap-1.5 transition shadow-sm"
                title="Check Gmail for new unread messages"
              >
                <RefreshCw className={`w-3.5 h-3.5 text-slate-500 ${syncing || loading ? "animate-spin" : ""}`} />
                {syncing ? "Syncing..." : "Sync Gmail"}
              </button>
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
              {filteredEmails.length === 0 ? (
                <div className="p-10 text-center">
                  <Mail className="w-7 h-7 text-slate-300 mx-auto mb-2" />
                  <p className="text-xs text-slate-500">No messages in this folder.</p>
                </div>
              ) : (
                filteredEmails.map((email) => {
                  const isSelected = selectedEmail?.id === email.id;
                  return (
                    <div
                      key={email.id}
                      onClick={() => setSelectedEmail(email)}
                      className={`px-4 py-3.5 cursor-pointer transition border-l-[3px] ${
                        isSelected
                          ? "bg-[#f1f5f9] border-slate-800"
                          : "border-transparent hover:bg-slate-50"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-semibold text-slate-800 truncate max-w-[200px]">
                          {email.sender.replace(/<.*>/, "").trim() || email.sender}
                        </span>
                        <span
                          className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${
                            email.urgency_score >= 4
                              ? "bg-rose-50 text-rose-700 border-rose-200"
                              : email.urgency_score === 3
                              ? "bg-amber-50 text-amber-700 border-amber-200"
                              : "bg-slate-100 text-slate-600 border-slate-200/80"
                          }`}
                        >
                          P{email.urgency_score}
                        </span>
                      </div>

                      <p className="text-[13px] font-medium text-slate-900 truncate mb-1">
                        {email.subject || "(No Subject)"}
                      </p>

                      <p className="text-xs text-slate-500 line-clamp-2 leading-relaxed">
                        {email.body || "(No message body)"}
                      </p>

                      <div className="mt-2 flex items-center gap-2 text-[11px] text-slate-400">
                        <span className="capitalize text-slate-500 font-medium">
                          {email.status.replace("_", " ")}
                        </span>
                        <span>·</span>
                        <span>{email.intent}</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </section>

          {/* Right Column: Reading & Reply Workspace — Soft Alabaster (#F6F7F9) */}
          <main className="flex-1 flex flex-col bg-[#f6f7f9] overflow-y-auto">
            {selectedEmail ? (
              <div className="p-6 lg:p-8 max-w-4xl w-full mx-auto space-y-5">
                {feedbackMessage && (
                  <div
                    className={`px-4 py-3 rounded-md text-xs font-medium border flex items-center gap-2.5 shadow-sm ${
                      feedbackMessage.type === "success"
                        ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                        : "bg-rose-50 border-rose-200 text-rose-800"
                    }`}
                  >
                    {feedbackMessage.type === "success" ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 text-rose-600 flex-shrink-0" />
                    )}
                    <span>{feedbackMessage.text}</span>
                  </div>
                )}

                {/* Inbound Customer Message Card */}
                <div className="bg-white border border-slate-200/90 rounded-lg p-6 shadow-sm">
                  <div className="flex items-start justify-between gap-4 pb-4 border-b border-slate-100">
                    <div>
                      <h1 className="text-lg font-semibold text-slate-900 mb-1.5 leading-snug">
                        {selectedEmail.subject}
                      </h1>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                        <span className="inline-flex items-center gap-1.5 font-medium text-slate-700">
                          <UserIcon className="w-3.5 h-3.5 text-slate-400" />
                          {selectedEmail.sender}
                        </span>
                        <span>→</span>
                        <span>{selectedEmail.recipient}</span>
                      </div>
                    </div>
                    <div className="flex-shrink-0">
                      <span
                        className={`inline-block text-[11px] font-medium px-2.5 py-0.5 rounded-md border capitalize ${
                          selectedEmail.status === "sent"
                            ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                            : selectedEmail.status === "dismissed"
                            ? "bg-slate-100 text-slate-600 border-slate-200"
                            : "bg-amber-50 text-amber-800 border-amber-200"
                        }`}
                      >
                        {selectedEmail.status.replace("_", " ")}
                      </span>
                    </div>
                  </div>

                  <div className="mt-4 whitespace-pre-wrap text-[13.5px] text-slate-700 leading-relaxed font-normal">
                    {selectedEmail.body || "(No message body)"}
                  </div>
                </div>

                {/* Archived Notice */}
                {selectedEmail.status === "dismissed" && (
                  <div className="bg-slate-100 border border-slate-200 rounded-md px-4 py-3 flex items-center gap-2.5 text-xs text-slate-600">
                    <XCircle className="w-4 h-4 text-slate-500 flex-shrink-0" />
                    <span>This conversation was archived. No outbound reply will be sent.</span>
                  </div>
                )}

                {/* Context & Triage Notes (Subtle Warm Callout) */}
                {selectedEmail.drafts && selectedEmail.drafts[0] && (
                  <div className="bg-[#fafaf9] border border-slate-200/90 rounded-lg px-4 py-3.5 flex items-start gap-3">
                    <FileText className="w-4 h-4 text-slate-500 flex-shrink-0 mt-0.5" />
                    <div>
                      <h4 className="text-xs font-semibold text-slate-700 uppercase tracking-wide">
                        Triage & Context Notes
                      </h4>
                      <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                        {selectedEmail.drafts[0].rationale}
                      </p>
                    </div>
                  </div>
                )}

                {/* Outbound Reply Composer Card */}
                <div className="bg-white border border-slate-200/90 rounded-lg p-6 shadow-sm">
                  <div className="flex items-center justify-between mb-3">
                    <label className="text-xs font-semibold uppercase tracking-wider text-slate-600 flex items-center gap-2">
                      <Edit3 className="w-3.5 h-3.5 text-slate-500" />
                      Reply Draft
                    </label>
                    {selectedEmail.drafts?.[0]?.human_edited && (
                      <span className="text-[11px] bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded font-medium">
                        Edited by operator
                      </span>
                    )}
                  </div>

                  <textarea
                    value={editedDraft}
                    onChange={(e) => setEditedDraft(e.target.value)}
                    disabled={selectedEmail.status === "sent" || selectedEmail.status === "dismissed" || actionLoading}
                    rows={8}
                    className="w-full bg-[#fcfcfd] border border-slate-300 rounded-md p-3.5 text-[13.5px] text-slate-800 focus:outline-none focus:border-slate-600 focus:bg-white leading-relaxed font-sans transition disabled:bg-slate-50 disabled:text-slate-500"
                    placeholder="Write or edit your reply..."
                  />

                  <div className="mt-4 flex items-center justify-between pt-1">
                    <button
                      onClick={handleDismiss}
                      disabled={actionLoading || selectedEmail.status === "dismissed"}
                      className="px-3.5 py-2 text-xs font-medium rounded-md text-slate-600 hover:text-slate-900 hover:bg-slate-100 border border-transparent hover:border-slate-200 transition disabled:opacity-40"
                    >
                      {selectedEmail.status === "dismissed" ? "Archived" : "Archive / Dismiss"}
                    </button>

                    <div className="flex items-center gap-2.5">
                      <button
                        onClick={handleSaveDraft}
                        disabled={actionLoading || selectedEmail.status === "sent" || selectedEmail.status === "dismissed"}
                        className="px-3.5 py-2 text-xs font-medium rounded-md bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 transition disabled:opacity-40 shadow-sm"
                      >
                        Save Draft
                      </button>

                      <button
                        onClick={handleApproveAndSend}
                        disabled={actionLoading || selectedEmail.status === "sent" || selectedEmail.status === "dismissed"}
                        className="px-4 py-2 text-xs font-medium rounded-md bg-slate-900 hover:bg-slate-800 text-white flex items-center gap-1.5 transition disabled:opacity-40 shadow-sm"
                      >
                        <Send className="w-3.5 h-3.5" />
                        {selectedEmail.status === "sent" ? "Sent" : "Approve & Send"}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-slate-400 p-8">
                <Inbox className="w-10 h-10 mb-2.5 stroke-1 text-slate-300" />
                <p className="text-xs text-slate-500">Select a conversation from the list to view and reply.</p>
              </div>
            )}
          </main>
        </>
      )}
    </div>
  );
}
