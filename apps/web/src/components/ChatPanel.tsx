import { useEffect, useId, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { api } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { useChatThread } from '../lib/hooks';
import { Banner, Button, Card, ErrorPanel, TextArea, cn } from './ui';
import { SendIcon, ShieldCheckIcon } from './icons';

/**
 * The chat both parties coordinate a handover in.
 *
 * Refresh, not push: the API has no websocket and this build has no push service, so the thread
 * re-reads every ten seconds while the booking is open. A message is shown only once the server has
 * returned it — there is no optimistic bubble that could lie about a send that failed.
 *
 * Whether the thread is still open is the server's answer, not something the page infers from the
 * booking status — the list of closed states lives in one place.
 */
export function ChatPanel({ bookingId }: { bookingId: string }) {
  const queryClient = useQueryClient();
  const composerId = useId();
  const thread = useChatThread(bookingId);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const messages = thread.data?.items ?? [];
  const unread = thread.data?.unread_count ?? 0;
  const closed = thread.data?.closed ?? false;

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    // Only follow the bottom when the reader is already near it, so scrolling back to an older
    // message is not undone by the other party typing.
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (nearBottom) bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  useEffect(() => {
    if (unread === 0 || thread.isError) return;
    let cancelled = false;
    void api
      .post(`/bookings/${bookingId}/conversation/read`, {})
      .then(() => {
        if (cancelled) return;
        void queryClient.invalidateQueries({ queryKey: ['chat', bookingId] });
        // The chrome badge and the account inbox read the same last_read_at, so both need a re-read.
        void queryClient.invalidateQueries({ queryKey: ['conversations'] });
      })
      .catch(() => {
        // Marking read is cosmetic. Failing at it must not interrupt the thread.
      });
    return () => {
      cancelled = true;
    };
  }, [unread, bookingId, queryClient, thread.isError]);

  async function send() {
    const body = draft.trim();
    if (body.length === 0 || sending) return;
    setSending(true);
    setError(null);
    try {
      await api.post(`/bookings/${bookingId}/conversation/messages`, { body });
      setDraft('');
      await queryClient.invalidateQueries({ queryKey: ['chat', bookingId] });
      await queryClient.invalidateQueries({ queryKey: ['conversations'] });
      await thread.refetch();
    } catch (err) {
      setError(err);
    } finally {
      setSending(false);
    }
  }

  const tooLong = draft.length > 2000;

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-ink-900">Coordinate the handover</h2>
          <p className="mt-1 text-sm text-ink-500">
            Agree where and when to meet. Both sides see this thread; nobody else does.
          </p>
        </div>
        <span className="text-xs text-ink-500">{thread.isFetching ? 'Checking for new messages…' : 'Updates every few seconds'}</span>
      </div>

      <div
        ref={listRef}
        role="log"
        aria-live="polite"
        aria-label="Messages on this booking"
        className="mt-4 max-h-80 space-y-2.5 overflow-y-auto rounded-card border border-line bg-canvas p-3"
      >
        {thread.isLoading ? (
          <p className="py-6 text-center text-sm text-ink-500">Loading the conversation…</p>
        ) : thread.isError ? (
          <p className="py-6 text-center text-sm text-ink-500">
            The conversation could not be loaded.{' '}
            <button type="button" className="font-semibold text-brand-700 underline" onClick={() => void thread.refetch()}>
              Try again
            </button>
          </p>
        ) : messages.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-500">
            No messages yet. Say where you can hand over, and when.
          </p>
        ) : (
          messages.map((m) =>
            m.kind === 'system' ? (
              <p key={m.id} className="mx-auto max-w-md rounded-input bg-surface px-3 py-2 text-center text-xs text-ink-500">
                {m.body}
              </p>
            ) : (
              <div key={m.id} className={cn('flex', m.mine ? 'justify-end' : 'justify-start')}>
                <div
                  className={cn(
                    'max-w-[85%] rounded-card px-3 py-2',
                    m.mine ? 'bg-brand-600 text-white' : 'border border-line bg-surface text-ink-900',
                  )}
                >
                  {!m.mine ? <p className="text-[11px] font-semibold text-ink-500">{m.sender_name}</p> : null}
                  <p className="whitespace-pre-wrap break-words text-sm">{m.body}</p>
                  <p className={cn('mt-1 text-[11px]', m.mine ? 'text-brand-200' : 'text-ink-300')}>
                    {formatDateTime(m.created_at)}
                  </p>
                </div>
              </div>
            ),
          )
        )}
        <div ref={bottomRef} />
      </div>

      {closed ? (
        <Banner tone="info" className="mt-4" title="This delivery is closed">
          The thread stays readable as the record of what was agreed, but no new messages can be sent.
        </Banner>
      ) : (
        <form
          className="mt-4"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <label htmlFor={composerId} className="sr-only">
            Message
          </label>
          <TextArea
            id={composerId}
            rows={3}
            value={draft}
            maxLength={2200}
            placeholder="For example: I can meet at the Civil Lines gate tomorrow between 10 and 11."
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault();
                void send();
              }
            }}
          />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-xs text-ink-500">
              <ShieldCheckIcon size={14} className="shrink-0" />
              Never post a handover code here. Say it in person.
            </p>
            <div className="flex items-center gap-3">
              <span className={cn('tabular text-xs', tooLong ? 'font-semibold text-danger-600' : 'text-ink-300')}>
                {draft.length}/2000
              </span>
              <Button type="submit" loading={sending} disabled={draft.trim().length === 0 || tooLong}>
                <SendIcon size={16} className="mr-1.5" />
                Send
              </Button>
            </div>
          </div>
        </form>
      )}

      {error ? <ErrorPanel error={error} /> : null}
    </Card>
  );
}
