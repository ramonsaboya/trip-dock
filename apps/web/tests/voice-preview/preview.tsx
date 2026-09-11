// Test-only entry point. Never imported by the app or its production build.
/* eslint-disable @next/next/no-html-link-for-pages -- Standalone Vite harness: full reloads reset the simulated browser API. */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { TripDockApp } from '../../components/trip-dock-app';
import type { Recognition, RecognitionConstructor } from '../../lib/voice-dictation';
import type { TripDraft } from '../../lib/graphql-client';
import '../../app/globals.css';

const params = new URLSearchParams(location.search);
const mode = params.get('mode') ?? 'speech';
const speechWindow = window as Window & { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor };
let requests = 0;
let aborts = 0;

function report() {
  document.getElementById('preview-counts')!.textContent = `Simulated draft requests: ${requests}; microphone aborts: ${aborts}`;
}

class SimulatedRecognition implements Recognition {
  lang = '';
  continuous = false;
  interimResults = false;
  maxAlternatives = 1;
  onstart: Recognition['onstart'] = null;
  onend: Recognition['onend'] = null;
  onerror: Recognition['onerror'] = null;
  onresult: Recognition['onresult'] = null;
  private timers: ReturnType<typeof setTimeout>[] = [];
  start() {
    if (mode === 'denied' || mode === 'network') {
      this.timers.push(setTimeout(() => this.onerror?.({ error: mode === 'denied' ? 'not-allowed' : 'network' }), 250));
      return;
    }
    this.timers.push(setTimeout(() => this.onstart?.(), mode === 'starting' ? 8000 : 1200));
    const phrases = ['Ten days in Jap', 'Ten days in Japan', 'Ten days in Japan for two people'];
    phrases.forEach((transcript, index) => this.timers.push(setTimeout(() => this.onresult?.({ results: [[{ transcript }]] }), (mode === 'starting' ? 8500 : 1600) + index * 650)));
  }
  stop() {
    this.timers.forEach(clearTimeout);
    this.timers.push(setTimeout(() => {
      this.onresult?.({ results: [[{ transcript: 'Ten days in Japan for two people.' }]] });
      this.onend?.();
    }, 400));
  }
  abort() { this.timers.forEach(clearTimeout); aborts++; report(); }
}

// Override both names before mounting: this preview cannot open a real microphone.
speechWindow.SpeechRecognition = mode === 'unsupported' ? undefined : SimulatedRecognition;
speechWindow.webkitSpeechRecognition = undefined;

const draft: TripDraft = {
  name: 'Japan idea', destinationArea: 'Japan', startDate: null, endDate: null, travelerCount: 2,
  stops: [{ name: 'Tokyo', locationText: 'Japan', arrivalDate: null, departureDate: null, localityKind: 'CITY', cityResolution: 'RESOLVED' }],
  assumptions: [], warnings: [], fieldStates: [],
  questions: [{ id: 'dates', fieldPaths: ['trip.startDate', 'trip.endDate'], prompt: 'Which dates would you like?', options: [], allowFreeText: true, blocking: true }],
  minimumViable: false, referenceDate: '2026-09-10', locale: 'en-GB', timeZone: 'Europe/London',
};

// Every application request is intercepted. Unknown operations fail closed.
window.fetch = async (input, init) => {
  if (input !== '/__voice-preview/graphql') throw new Error('External requests are disabled in the voice preview.');
  const { query } = JSON.parse(String(init?.body)) as { query: string };
  if (query.includes('generateTripDraft')) {
    requests++;
    report();
    return Response.json({ data: { generateTripDraft: draft } });
  }
  if (query.includes('query Trips')) return Response.json({ data: { trips: [] } });
  throw new Error('Only simulated trip listing and draft generation are allowed.');
};

if (params.has('mobile')) {
  createRoot(document.getElementById('root')!).render(<iframe title="390 pixel mobile preview" src={`/?mode=${mode}`} style={{ width: 390, height: '95vh', border: '1px solid #ccc', display: 'block', margin: 'auto' }} />);
} else {
  createRoot(document.getElementById('root')!).render(<StrictMode>
    <aside style={{ padding: 12, background: '#fff3df', fontSize: 14 }}>
      <strong>Simulated dictation · no microphone, provider, or database</strong>
      <p id="preview-counts">Simulated draft requests: 0; microphone aborts: 0</p>
      <nav style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}><a href="/">Speech</a><a href="/?mode=denied">Permission denied</a><a href="/?mode=network">Network error</a><a href="/?mode=unsupported">Unsupported</a><a href="/?mobile=1">390px mobile</a></nav>
    </aside>
    <TripDockApp />
  </StrictMode>);
}
