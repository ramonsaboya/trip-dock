'use client';



export function VoiceAttribution({ visible }: { visible: boolean }) {
  return <span className="voice-attribution" style={{ visibility: visible ? 'visible' : 'hidden' }} aria-hidden={!visible}>
    <span>GPT Live Transcribe</span><small>Audio sent to OpenAI</small>
  </span>;
}
