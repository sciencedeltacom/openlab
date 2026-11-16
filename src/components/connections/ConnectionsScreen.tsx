/**
 * Connections — the global accounts surface.
 *
 * One place to sign in to the accounts other surfaces build on: Google (Drive) and GitHub. It
 * reads like a platform accounts pane — a quiet list, a status, and a sign-in — and each sign-in
 * is a real OAuth flow whose tokens live in the vault, never here. The OAuth app the user
 * registered is configured per provider, once, behind a disclosure.
 */

import { useEffect, useState } from 'react';
import { Check, ExternalLink, LoaderCircle, LogIn, Plus, TriangleAlert } from 'lucide-react';

import { BrandMark, Button, Chip, Input, ScrollShadow, SectionLabel } from '@/components/ui';
import { cn } from '@/lib/cn';
import { ACCOUNT_PROVIDERS, accountLabel } from '@/lib/accounts/providers';
import {
  connectAccount,
  disconnectAccount,
  refreshAccount,
  setAccountClient,
  useAccount,
} from '@/lib/accounts/store';
import type { AccountProvider } from '@/lib/accounts/types';

/** One account: its state, its sign-in, and the OAuth app behind a disclosure. */
function AccountCard({ provider }: { provider: AccountProvider }) {
  const state = useAccount(provider.id);
  const [open, setOpen] = useState(false);
  const [clientId, setClientId] = useState('');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState<'save' | 'connect' | 'disconnect' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void refreshAccount(provider.id);
  }, [provider.id]);
  useEffect(() => {
    if (state?.clientId) {
      setClientId(state.clientId);
    }
  }, [state?.clientId]);

  const connected = Boolean(state?.connected);
  const hasClient = Boolean(state?.clientId);

  const run = async (kind: 'save' | 'connect' | 'disconnect', work: () => Promise<void>) => {
    setBusy(kind);
    setError(null);
    try {
      await work();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col rounded-3xl bg-surface">
      <div className="flex items-center gap-4 p-4">
        <BrandMark icon={provider.icon} label={provider.label} className="size-11 rounded-2xl" />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[1.0625rem] font-semibold text-foreground">{provider.label}</span>
            {connected && (
              <Chip size="sm" variant="soft" color="success" className="text-meta">
                <Check className="size-3" aria-hidden />
                Connected
              </Chip>
            )}
          </div>
          <p className="truncate text-meta text-muted">
            {connected
              ? accountLabel(state, provider.id)
              : hasClient
                ? 'App registered, ready to sign in'
                : provider.summary}
          </p>
        </div>

        {connected ? (
          <Button
            variant="ghost"
            onPress={() => void run('disconnect', () => disconnectAccount(provider.id))}
            isDisabled={busy !== null}
          >
            {busy === 'disconnect' ? <LoaderCircle className="size-4 animate-spin" /> : 'Sign out'}
          </Button>
        ) : (
          <div className="flex items-center gap-2">
            <Button variant="ghost" className="gap-1.5" onPress={() => setOpen((value) => !value)}>
              <Plus className="size-3.5" />
              Set up
            </Button>
            <Button
              variant="primary"
              className="gap-1.5"
              isDisabled={busy !== null || !hasClient}
              onPress={() => void run('connect', () => connectAccount(provider.id))}
            >
              {busy === 'connect' ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <LogIn className="size-3.5" />
              )}
              Sign in
            </Button>
          </div>
        )}
      </div>

      {!connected && open && (
        <div className="flex flex-col gap-3 border-t border-separator p-4">
          <div className="flex flex-col gap-1">
            <span className="text-label text-foreground">{provider.label} OAuth app</span>
            <p className="text-meta text-muted">
              Create an OAuth app in {provider.label} and paste its client id and secret. They stay in the
              encrypted vault on this machine.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-label text-foreground">Client id</span>
              <Input
                value={clientId}
                onChange={(event) => setClientId(event.target.value)}
                placeholder="Client id"
                aria-label={`${provider.label} client id`}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-label text-foreground">Client secret</span>
              <Input
                type="password"
                value={secret}
                onChange={(event) => setSecret(event.target.value)}
                placeholder="Client secret"
                aria-label={`${provider.label} client secret`}
              />
            </label>
          </div>
          <div className="flex items-center gap-3">
            <Button
              variant="secondary"
              className="gap-1.5"
              isDisabled={busy !== null || !clientId.trim()}
              onPress={() =>
                void run('save', () => setAccountClient(provider.id, clientId.trim(), secret.trim()))
              }
            >
              {busy === 'save' ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Check className="size-4" />
              )}
              Save app
            </Button>
            <a
              href={provider.docsUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1 text-body text-link underline underline-offset-2"
            >
              Where to create one
              <ExternalLink className="size-3.5" aria-hidden />
            </a>
          </div>
        </div>
      )}

      {error && (
        <p className="mx-4 mb-4 flex items-center gap-1.5 rounded-2xl bg-danger-soft px-3 py-2 text-meta text-danger">
          <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
          {error}
        </p>
      )}
    </div>
  );
}

/** The Connections surface. */
export function ConnectionsScreen() {
  return (
    <ScrollShadow className="h-full">
      <div className="mx-auto flex w-full max-w-[760px] flex-col gap-6 px-7 py-8">
        <header className="flex flex-col gap-2">
          <h1 className="text-[1.6rem] font-semibold tracking-[-0.01em] text-foreground">Connections</h1>
          <p className="max-w-[68ch] text-body text-muted">
            Sign in once to the accounts your work builds on; the tokens stay on this machine.
          </p>
        </header>

        <section className={cn('flex flex-col gap-3')}>
          <SectionLabel>Accounts</SectionLabel>
          <div className="flex flex-col gap-3">
            {ACCOUNT_PROVIDERS.map((provider) => (
              <AccountCard key={provider.id} provider={provider} />
            ))}
          </div>
        </section>
      </div>
    </ScrollShadow>
  );
}
