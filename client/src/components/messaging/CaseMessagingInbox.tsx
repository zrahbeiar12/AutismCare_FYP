import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import {
  MessageSquare,
  Send,
  User,
  Clock,
  Search,
  ArrowLeft,
  Activity,
  ClipboardList,
  Home,
  Loader2,
  ExternalLink,
} from 'lucide-react';
import { messagingAPI, parentAPI } from '../../api';
import { toast } from 'sonner';
import { cn } from '../ui/utils';
import { AuthContext } from '../../context/AuthContext';
import { parseJwtSubjectId } from '../../utils/jwtSubject';

export type MessagingInboxVariant = 'therapist' | 'parent' | 'clinician';

type ApiConversation = {
  _id: string;
  caseId?: string;
  parentId?: string;
  therapistId?: string;
  parentName?: string;
  therapistName?: string;
  childName?: string;
  preview?: string;
  previewAt?: string;
  lastMessageAt?: string;
};

/** Show the other side of the thread: parents see their therapist, staff see the parent. */
function counterpartName(c: ApiConversation, variant: MessagingInboxVariant) {
  if (variant === 'parent') return c.therapistName ? `${c.therapistName} (therapist)` : 'Your therapist';
  return c.parentName || 'Parent';
}

type ApiMessage = {
  _id: string;
  conversationId?: string;
  senderId: string | { _id: string; firstName?: string; lastName?: string; role?: string };
  text: string;
  createdAt: string;
};

const therapistTemplates = [
  {
    label: 'Session Feedback',
    icon: <ClipboardList className="h-4 w-4" />,
    text: "Today's session went well. Here are the key observations and activities we covered...",
  },
  {
    label: 'Home Activity',
    icon: <Home className="h-4 w-4" />,
    text: 'Here is a home activity to practice this week:\n\nActivity: \nDuration: 10-15 minutes\nFrequency: Daily\nInstructions: ',
  },
  {
    label: 'Progress Update',
    icon: <Activity className="h-4 w-4" />,
    text: "I wanted to share an update on your child's progress. Over the past week, we've seen improvements in...",
  },
];

function senderIdStr(msg: ApiMessage): string {
  const s = msg.senderId as unknown;
  if (s && typeof s === 'object' && '_id' in (s as object)) {
    return String((s as { _id: string })._id);
  }
  return String(s);
}

function formatListTime(iso?: string) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch {
    return '';
  }
}

function formatMsgTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  } catch {
    return '';
  }
}

function isOutgoing(
  msg: ApiMessage,
  selected: ApiConversation,
  variant: MessagingInboxVariant,
  clinicianUserId: string | null
): boolean {
  const sid = senderIdStr(msg);
  if (variant === 'therapist') return sid === String(selected.therapistId);
  if (variant === 'parent') return sid === String(selected.parentId);
  return clinicianUserId != null && sid === clinicianUserId;
}

type ConversationListProps = {
  variant: MessagingInboxVariant;
  conversations: ApiConversation[];
  filteredConversations: ApiConversation[];
  selected: ApiConversation | null;
  mobileShowChat: boolean;
  listLoading: boolean;
  listError: string | null;
  emptyListHint: string;
  searchQuery: string;
  setSearchQuery: (v: string) => void;
  onSelectConversation: (conv: ApiConversation) => void;
};

function ConversationList({
  conversations,
  filteredConversations,
  selected,
  mobileShowChat,
  listLoading,
  listError,
  emptyListHint,
  searchQuery,
  setSearchQuery,
  onSelectConversation,
  variant,
}: ConversationListProps) {
  return (
    <div
      className={cn(
        'flex w-full flex-col border-r border bg-card lg:w-[340px]',
        mobileShowChat ? 'hidden lg:flex' : 'flex'
      )}
    >
      <div className="border-b border p-4">
        <div className="flex items-center gap-2 rounded-lg border bg-background px-3 py-2.5 focus-within:ring-2 focus-within:ring-ring/50">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search conversations..."
            className="min-w-0 flex-1 border-0 bg-transparent p-0 text-sm leading-normal text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-0"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {listLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : listError ? (
          <p className="px-4 py-6 text-sm text-destructive">{listError}</p>
        ) : filteredConversations.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            {conversations.length === 0 ? emptyListHint : 'No matches.'}
          </p>
        ) : (
          filteredConversations.map((conv) => {
            const isActive = selected?._id === conv._id;
            const lastAt = conv.previewAt || conv.lastMessageAt;
            return (
              <button
                key={conv._id}
                type="button"
                onClick={() => onSelectConversation(conv)}
                className={cn(
                  'w-full border-b border p-4 text-left transition-colors',
                  isActive ? 'bg-secondary/40' : 'hover:bg-background'
                )}
              >
                <div className="flex items-start gap-3">
                  <div
                    className={cn(
                      'flex h-10 w-10 shrink-0 items-center justify-center rounded-full',
                      isActive ? 'bg-primary text-primary-foreground' : 'bg-secondary text-primary'
                    )}
                  >
                    <User className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <h4 className="truncate text-sm font-semibold text-foreground">{counterpartName(conv, variant)}</h4>
                      <span className="shrink-0 text-xs text-muted-foreground">{formatListTime(lastAt)}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">Re: {conv.childName || 'Child'}</p>
                    <p className="mt-1 truncate text-sm text-muted-foreground">{conv.preview || '—'}</p>
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

type ChatAreaProps = {
  selected: ApiConversation | null;
  mobileShowChat: boolean;
  variant: MessagingInboxVariant;
  clinicianUserId: string | null;
  messages: ApiMessage[];
  messagesLoading: boolean;
  messagesError: string | null;
  messageText: string;
  setMessageText: (v: string) => void;
  sending: boolean;
  showTemplates?: boolean;
  caseHref?: (caseId: string) => string;
  onBack: () => void;
  onSend: () => Promise<void>;
  onTemplate: (text: string) => void;
};

function ChatArea({
  selected,
  mobileShowChat,
  variant,
  clinicianUserId,
  messages,
  messagesLoading,
  messagesError,
  messageText,
  setMessageText,
  sending,
  showTemplates,
  caseHref,
  onBack,
  onSend,
  onTemplate,
}: ChatAreaProps) {
  if (!selected) {
    return (
      <div className="hidden min-h-[400px] flex-1 items-center justify-center bg-background/50 lg:flex">
        <div className="space-y-3 text-center text-muted-foreground">
          <MessageSquare className="mx-auto h-16 w-16 opacity-30" />
          <p className="text-lg font-medium text-muted-foreground">Select a conversation</p>
          <p className="text-sm">Choose a thread from the list to view and send messages</p>
        </div>
      </div>
    );
  }

  const caseLink = selected.caseId && caseHref ? caseHref(String(selected.caseId)) : null;

  return (
    <div
      className={cn(
        'flex min-h-[400px] flex-1 flex-col bg-background/30 lg:min-h-[600px]',
        !mobileShowChat ? 'hidden lg:flex' : 'flex'
      )}
    >
      <div className="flex items-center gap-3 border-b border bg-card p-4">
        <button type="button" onClick={onBack} className="rounded-md p-1 hover:bg-muted lg:hidden">
          <ArrowLeft className="h-5 w-5 text-muted-foreground" />
        </button>
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-secondary">
          <User className="h-5 w-5 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <h4 className="truncate text-sm font-semibold text-foreground">{counterpartName(selected, variant)}</h4>
          <p className="truncate text-xs text-muted-foreground">Re: {selected.childName || 'Child'}</p>
        </div>
        {caseLink ? (
          <Link
            to={caseLink}
            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1.5 text-xs font-medium text-primary hover:bg-muted"
          >
            Case <ExternalLink className="h-3.5 w-3.5" />
          </Link>
        ) : null}
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {messagesLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : messagesError ? (
          <p className="text-sm text-destructive">{messagesError}</p>
        ) : messages.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground">No messages yet. Say hello below.</p>
        ) : (
          messages.map((msg) => {
            const outgoing = isOutgoing(msg, selected, variant, clinicianUserId);
            return (
              <motion.div
                key={msg._id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={cn('flex', outgoing ? 'justify-end' : 'justify-start')}
              >
                <div
                  className={cn(
                    'max-w-[75%] rounded-2xl px-4 py-3',
                    outgoing
                      ? 'rounded-br-md bg-primary text-primary-foreground'
                      : 'rounded-bl-md border bg-card text-foreground shadow-sm'
                  )}
                >
                  <p className="whitespace-pre-line text-sm leading-relaxed">{msg.text}</p>
                  <div className={cn('mt-2 flex items-center gap-1.5', outgoing ? 'justify-end' : 'justify-start')}>
                    <Clock className={cn('h-3 w-3', outgoing ? 'text-primary-foreground/80' : 'text-muted-foreground')} />
                    <span
                      className={cn('text-[10px]', outgoing ? 'text-primary-foreground/80' : 'text-muted-foreground')}
                    >
                      {formatMsgTime(msg.createdAt)}
                    </span>
                  </div>
                </div>
              </motion.div>
            );
          })
        )}
      </div>

      {showTemplates && variant === 'therapist' ? (
        <div className="border-t border bg-card px-4 py-2">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {therapistTemplates.map((tpl) => (
              <Button
                key={tpl.label}
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0 text-xs text-foreground hover:bg-muted"
                onClick={() => onTemplate(tpl.text)}
              >
                {tpl.icon}
                <span className="ml-1">{tpl.label}</span>
              </Button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="border-t border bg-card p-4">
        <div className="flex items-end gap-2">
          <div className="relative flex-1">
            <textarea
              value={messageText}
              onChange={(e) => setMessageText(e.target.value)}
              placeholder="Type a message..."
              rows={2}
              disabled={sending}
              className="input h-auto w-full resize-none px-4 py-3 text-sm"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void onSend();
                }
              }}
            />
          </div>
          <Button
            type="button"
            onClick={() => void onSend()}
            disabled={!messageText.trim() || sending}
            className="h-11 w-11 shrink-0 rounded-xl p-0"
            variant="default"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
      </div>
    </div>
  );
}

export type CaseMessagingInboxProps = {
  variant: MessagingInboxVariant;
  title: string;
  subtitle: string;
  showTemplates?: boolean;
  /** When set, show a link to open the case from the chat header */
  caseHref?: (caseId: string) => string;
  /** Deep link: open this conversation once it appears in the inbox list */
  initialConversationId?: string | null;
  /** Called after `initialConversationId` is applied or if it never matches */
  onInitialConversationHandled?: () => void;
};

export function CaseMessagingInbox({
  variant,
  title,
  subtitle,
  showTemplates,
  caseHref,
  initialConversationId,
  onInitialConversationHandled,
}: CaseMessagingInboxProps) {
  const { user } = useContext(AuthContext);
  const clinicianUserId = variant === 'clinician' ? parseJwtSubjectId(user?.token) : null;

  const [conversations, setConversations] = useState<ApiConversation[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [selected, setSelected] = useState<ApiConversation | null>(null);
  const [messages, setMessages] = useState<ApiMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesError, setMessagesError] = useState<string | null>(null);

  const [messageText, setMessageText] = useState('');
  const [sending, setSending] = useState(false);
  const [mobileShowChat, setMobileShowChat] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const parentThreadsEnsured = useRef(false);
  const loadConversations = useCallback(async () => {
    try {
      setListError(null);
      const { data: body } = await messagingAPI.listConversations();
      const raw = body?.data;
      let list = Array.isArray(raw) ? raw : [];
      // Threads are created on first open. A parent whose child already has a therapist should not see an
      // empty inbox, so open each case's thread (same call as Child Case) and list again. Cases without a
      // therapist are rejected by the server and simply skipped.
      if (variant === 'parent' && list.length === 0 && !parentThreadsEnsured.current) {
        parentThreadsEnsured.current = true;
        try {
          const casesRes = await parentAPI.getCases();
          const cases = (casesRes.data?.data || []) as Array<{ caseId?: string }>;
          const opened = await Promise.allSettled(
            cases.filter((c) => c.caseId).map((c) => messagingAPI.getOrCreateConversation(String(c.caseId)))
          );
          if (opened.some((r) => r.status === 'fulfilled')) {
            const again = await messagingAPI.listConversations();
            list = Array.isArray(again.data?.data) ? again.data.data : [];
          }
        } catch {
          /* keep the empty state */
        }
      }
      setConversations(list as ApiConversation[]);
    } catch (e: unknown) {
      const ax = e as { response?: { data?: { message?: string } } };
      setListError(ax.response?.data?.message || 'Could not load conversations');
      setConversations([]);
    } finally {
      setListLoading(false);
    }
  }, [variant]);

  useEffect(() => {
    void loadConversations();
    const id = window.setInterval(() => void loadConversations(), 60000);
    return () => window.clearInterval(id);
  }, [loadConversations]);

  useEffect(() => {
    if (!initialConversationId || listLoading) return;
    const match = conversations.find((c) => String(c._id) === String(initialConversationId));
    if (match) {
      setSelected(match);
      setMobileShowChat(true);
      onInitialConversationHandled?.();
      return;
    }
    if (!listLoading) {
      onInitialConversationHandled?.();
    }
  }, [conversations, listLoading, initialConversationId, onInitialConversationHandled]);

  const loadMessages = useCallback(async (conversationId: string) => {
    setMessagesLoading(true);
    setMessagesError(null);
    try {
      const { data: body } = await messagingAPI.listMessages(conversationId);
      const raw = body?.data;
      setMessages(Array.isArray(raw) ? (raw as ApiMessage[]) : []);
    } catch (e: unknown) {
      const ax = e as { response?: { data?: { message?: string } } };
      setMessagesError(ax.response?.data?.message || 'Could not load messages');
      setMessages([]);
    } finally {
      setMessagesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!selected?._id) {
      setMessages([]);
      return;
    }
    void loadMessages(selected._id);
    const id = window.setInterval(() => void loadMessages(selected._id), 20000);
    return () => window.clearInterval(id);
  }, [selected?._id, loadMessages]);

  const filteredConversations = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter((c) => {
      const hay = `${c.parentName || ''} ${c.childName || ''} ${c.preview || ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [conversations, searchQuery]);

  const handleSelectConversation = (conv: ApiConversation) => {
    setSelected(conv);
    setMobileShowChat(true);
  };

  const handleBack = () => {
    setMobileShowChat(false);
  };

  const handleSend = async () => {
    const text = messageText.trim();
    if (!text || !selected?._id) return;
    try {
      setSending(true);
      await messagingAPI.sendMessage({ conversationId: selected._id, text });
      setMessageText('');
      await loadMessages(selected._id);
      await loadConversations();
    } catch (e: unknown) {
      const ax = e as { response?: { data?: { message?: string } } };
      toast.error(ax.response?.data?.message || 'Failed to send message');
    } finally {
      setSending(false);
    }
  };

  const handleTemplate = (text: string) => {
    setMessageText(text);
  };

  const emptyListHint = useMemo(() => {
    if (variant === 'parent') {
      return 'No conversations yet. Once your therapist is linked to a case, you can message them here and from Child Case.';
    }
    if (variant === 'clinician') {
      return 'No case threads yet. Threads appear for cases you coordinate when families and therapists exchange messages.';
    }
    return 'No message threads yet. Threads appear when you have an active case with a parent.';
  }, [variant]);

  return (
    <motion.div className="mx-auto max-w-7xl" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
      <div className="mb-4">
        <h2 className="flex items-center gap-2 text-xl font-semibold text-foreground">
          <MessageSquare className="h-6 w-6" />
          {title}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
      </div>

      <Card className="overflow-hidden border shadow-sm">
        <CardHeader className="border-b border py-3">
          <CardTitle className="text-base font-medium text-foreground">Inbox</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="flex min-h-[min(600px,calc(100vh-14rem))]">
            <ConversationList
              conversations={conversations}
              filteredConversations={filteredConversations}
              selected={selected}
              mobileShowChat={mobileShowChat}
              listLoading={listLoading}
              listError={listError}
              emptyListHint={emptyListHint}
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              onSelectConversation={handleSelectConversation}
              variant={variant}
            />
            <ChatArea
              selected={selected}
              mobileShowChat={mobileShowChat}
              variant={variant}
              clinicianUserId={clinicianUserId}
              messages={messages}
              messagesLoading={messagesLoading}
              messagesError={messagesError}
              messageText={messageText}
              setMessageText={setMessageText}
              sending={sending}
              showTemplates={showTemplates}
              caseHref={caseHref}
              onBack={handleBack}
              onSend={handleSend}
              onTemplate={handleTemplate}
            />
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
