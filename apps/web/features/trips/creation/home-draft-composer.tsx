'use client';

import { useState, type FormEvent } from 'react';
import { DictationTextarea } from '../../../components/dictation-textarea';
import { VoiceAttribution } from '../../../components/voice-attribution';
import { deviceTimezone } from '../../../lib/device-timezone';
import { errorMessage } from '../../../lib/error-message';
import { graphqlRequest } from '../../../lib/graphql/request';
import { localIsoDate } from '../../../lib/trips/dates';
import { operations } from '../../../lib/trips/operations';
import { type GenerateTripDraftInput, type TripDraft } from '../../../lib/trips/types';

export function HomeDraftComposer({ onDraft, onStart, hidden, disabled }: { onDraft: (draft: TripDraft, prompt: string) => void; onStart: () => void; hidden: boolean; disabled: boolean }) {
  const [prompt, setPrompt] = useState('');
  const [dictating, setDictating] = useState(false);
  const [voiceUsed, setVoiceUsed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generateDraft(event: FormEvent) {
    event.preventDefault();
    if (busy || disabled || dictating || !prompt.trim()) return;
    onStart();
    setBusy(true);
    setError(null);
    try {
      const input: GenerateTripDraftInput = {
        prompt: prompt.trim(),
        locale: navigator.language || 'en-GB',
        timeZone: deviceTimezone() ?? 'UTC',
        referenceDate: localIsoDate(),
      };
      const data = await graphqlRequest<
        { generateTripDraft: TripDraft },
        { input: GenerateTripDraftInput }
      >(operations.generateDraft, { input });
      const draft = data.generateTripDraft;
      onDraft(draft, prompt.trim());
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="home-compose" aria-labelledby="home-compose-title" hidden={hidden}>
      <div>
        <p className="section-kicker">Start with an idea</p>
        <h2 id="home-compose-title">Describe your trip</h2>
        <p>Share the places and dates you already know. You can edit every detail before creating it.</p>
      </div>
      <form onSubmit={(event) => void generateDraft(event)} aria-busy={busy}>
        <label htmlFor="home-trip-prompt">What do you have in mind?</label>
        <DictationTextarea id="home-trip-prompt" rows={8} maxLength={5000} value={prompt} onChange={setPrompt} onActiveChange={setDictating} onVoiceUsed={() => setVoiceUsed(true)} disabled={busy || disabled} placeholder="Ten days in Japan for two people, starting in Tokyo and ending in Kyoto…" />
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <div className="composer-actions">
          <button className="button-primary" type="submit" disabled={busy || disabled || dictating || !prompt.trim()}>{busy ? 'Building your draft…' : 'Build a trip draft'}</button>
          <VoiceAttribution visible={voiceUsed} />
        </div>
      </form>
    </section>
  );
}
