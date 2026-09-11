'use client';
import type { Dispatch, SetStateAction } from 'react';
import { DictationTextarea } from '../../../components/dictation-textarea';
import { VoiceAttribution } from '../../../components/voice-attribution';
import type { TripClarificationQuestion } from '../../../lib/trips/types';

export function QuestionStage({ visibleQuestions, blocking, followUpBusy, selectedOptions, setSelectedOptions, applySelectedAnswers, followUp, sourcePrompt, setFollowUp, setFollowUpDictating, setFollowUpVoiceUsed, inactive, submitFollowUp, followUpDictating, followUpVoiceUsed, error, onClose, onBack }: {
  visibleQuestions: readonly TripClarificationQuestion[]; blocking: boolean;
  followUpBusy: boolean; selectedOptions: Record<string, string>;
  setSelectedOptions: Dispatch<SetStateAction<Record<string, string>>>;
  applySelectedAnswers: () => void; followUp: string; sourcePrompt?: string;
  setFollowUp: (value: string) => void; setFollowUpDictating: (active: boolean) => void;
  setFollowUpVoiceUsed: (used: boolean) => void; inactive: boolean;
  submitFollowUp: () => Promise<void>; followUpDictating: boolean;
  followUpVoiceUsed: boolean; error: string | null; onClose: () => void; onBack: () => void;
}) {
    return (
      <div className="creation-question-stage">
        <div className="creation-stage-intro">
          <p className="section-kicker">{blocking ? 'Before we build the draft' : 'AI follow-up'}</p>
          <h3>{blocking ? 'A few details need a clear answer' : 'What should TripDock adjust?'}</h3>
          <p>{blocking ? 'These answers affect the essential destination or dates. Answer them together, then we’ll show you the interpreted trip.' : visibleQuestions.length ? 'Answer any of the suggested questions, or describe the adjustment in your own words. We’ll bring you back to an updated summary.' : 'Describe the adjustment in your own words. We’ll interpret it and bring you back to an updated summary.'}</p>
        </div>
        <div className="clarification-list">
          {visibleQuestions.map((item, index) => (
            <fieldset className="clarification-question" key={item.id} disabled={followUpBusy}>
              <legend><span className="question-number">{index + 1}</span><span>{item.prompt}</span></legend>
              {item.options.length ? <div className="clarification-options">{item.options.map((option) => <label key={option.id}><input type="radio" name={`question-${item.id}`} value={option.id} checked={selectedOptions[item.id] === option.id} onChange={() => setSelectedOptions((current) => ({ ...current, [item.id]: option.id }))} /><span>{option.label}</span></label>)}</div> : <p className="clarification-free-note">Include this in the message below.</p>}
            </fieldset>
          ))}
        </div>
        {visibleQuestions.some((item) => item.options.length) ? <button className="button-secondary apply-quick-answers" type="button" onClick={applySelectedAnswers} disabled={followUpBusy || !Object.keys(selectedOptions).length}>{blocking ? 'Continue with selected answers' : 'Use selected answers'}</button> : null}
        <div className="follow-up-compose">
          <label htmlFor="trip-draft-follow-up">{blocking ? 'Or answer everything in one message' : 'Tell TripDock what to adjust'}</label>
          <DictationTextarea id="trip-draft-follow-up" rows={4} maxLength={1500} value={followUp} context={sourcePrompt} onChange={setFollowUp} onActiveChange={setFollowUpDictating} onVoiceUsed={() => setFollowUpVoiceUsed(true)} placeholder={blocking ? 'For example: Bristol, 10–14 May, using the later weekend.' : 'For example: Keep the proposed dates, but give Rome one extra night.'} disabled={inactive || followUpBusy} />
          <div className="composer-actions">
            <button className="button-primary" type="button" onClick={() => void submitFollowUp()} disabled={followUpBusy || followUpDictating || !followUp.trim()}>{followUpBusy ? 'Updating your draft…' : 'Update interpreted draft'}</button>
            <VoiceAttribution visible={followUpVoiceUsed} />
          </div>
        </div>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <footer className="dialog-footer"><button className="button-text" type="button" onClick={onClose}>Cancel</button>{!blocking ? <button className="button-secondary" type="button" onClick={onBack}>Back to summary</button> : <small className="creation-stage-note">Your trip summary appears after the essentials are clear.</small>}</footer>
      </div>
    );
}
