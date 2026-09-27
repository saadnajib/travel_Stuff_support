import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { errorMessage } from '../../api/client';
import { getMessages, sendMessage } from '../../api/endpoints';
import type { MatchStatus, Message } from '../../api/types';
import { useToast } from '../../components/Toast';
import { formatDateTime, formatTime } from '../../lib/format';

// Mirrors the API: chat stays open during a dispute so both parties can share evidence.
const CHAT_OPEN: MatchStatus[] = ['accepted', 'funded', 'in_transit', 'delivered', 'disputed'];
const POLL_MS = 5000;

interface Props {
  matchId: string;
  status: MatchStatus;
  meId: string;
  names: Record<string, string>;
}

function mergeMessages(prev: Message[], incoming: Message[]): Message[] {
  const byId = new Map(prev.map((m) => [m.id, m]));
  incoming.forEach((m) => byId.set(m.id, m));
  return Array.from(byId.values()).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function Chat({ matchId, status, meId, names }: Props) {
  const toast = useToast();
  const open = CHAT_OPEN.includes(status);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [lastRedacted, setLastRedacted] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const lastCount = useRef(0);

  // Cursor = createdAt of the newest *polled* message (server returns only newer ones, ascending).
  // Messages we send are merged locally but don't advance the cursor, so nothing sent by the
  // other party in the meantime is skipped.
  const cursor = useRef<string | undefined>(undefined);

  const fetchMessages = useCallback(async () => {
    try {
      const msgs = await getMessages(matchId, cursor.current);
      if (msgs.length) {
        cursor.current = msgs.reduce((max, m) => (m.createdAt > max ? m.createdAt : max), cursor.current ?? '');
        setMessages((prev) => mergeMessages(prev, msgs));
      }
      setLoadError(null);
    } catch (e) {
      setLoadError(errorMessage(e));
    } finally {
      setLoaded(true);
    }
  }, [matchId]);

  // Initial load, then poll every 5s while chat is open and the tab is visible.
  useEffect(() => {
    void fetchMessages();
    if (!open) return undefined;
    const timer = window.setInterval(() => {
      if (!document.hidden) void fetchMessages();
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [fetchMessages, open]);

  useEffect(() => {
    if (messages.length !== lastCount.current && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
    lastCount.current = messages.length;
  }, [messages]);

  const onSend = async (e: FormEvent) => {
    e.preventDefault();
    const text = body.trim();
    if (!text || text.length > 2000) return;
    setSending(true);
    try {
      const msg = await sendMessage(matchId, text);
      setMessages((prev) => mergeMessages(prev, [msg]));
      setLastRedacted(msg.redacted);
      setBody('');
    } catch (err) {
      toast.error(err);
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="card chat" aria-label="Chat">
      <div className="row between">
        <h2>Chat</h2>
        {open && <span className="small muted">Updates every 5s</span>}
      </div>
      <div className="chat-list" ref={listRef} aria-live="polite">
        {!loaded && <p className="muted small">Loading messages…</p>}
        {loaded && loadError && messages.length === 0 && <p className="muted small">{loadError}</p>}
        {loaded && !loadError && messages.length === 0 && (
          <p className="muted small">No messages yet.{open ? ' Say hello and agree on a handover time and place.' : ''}</p>
        )}
        {messages.map((m) => {
          const mine = m.senderId === meId;
          return (
            <div key={m.id} className={mine ? 'msg msg-mine' : 'msg'}>
              {!mine && <span className="msg-author">{names[m.senderId] ?? 'Participant'}</span>}
              <p className="msg-body">{m.body}</p>
              <span className="msg-meta" title={formatDateTime(m.createdAt)}>
                {formatTime(m.createdAt)}
                {m.redacted && <span className="msg-redacted"> · contact info hidden</span>}
              </span>
            </div>
          );
        })}
      </div>
      {open ? (
        <form className="chat-form" onSubmit={onSend}>
          {lastRedacted && (
            <p className="hint">
              We hid contact details (phone, email or links) in your last message. Keep communication on CarryLink so
              your delivery stays protected.
            </p>
          )}
          <label htmlFor="chat-input" className="sr-only">
            Message
          </label>
          <div className="chat-input-row">
            <textarea
              id="chat-input"
              rows={2}
              maxLength={2000}
              value={body}
              placeholder="Write a message…"
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
            />
            <button type="submit" className="btn" disabled={sending || !body.trim()}>
              {sending ? 'Sending…' : 'Send'}
            </button>
          </div>
        </form>
      ) : (
        <p className="chat-closed small muted">
          {status === 'proposed'
            ? 'Chat opens once the match is accepted.'
            : 'Chat is closed for this match. It is only available from acceptance until delivery.'}
        </p>
      )}
    </section>
  );
}
