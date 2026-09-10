// This alias is installed only by the standalone simulated preview server.
import { recognitionConstructor, type RecognitionConstructor } from '../../lib/voice-dictation';

export const liveRecognitionSupported = () => Boolean(recognitionConstructor(window));
export const LiveRecognition = function () {
    const Constructor = recognitionConstructor(window);
    if (!Constructor) throw new Error('Simulation unavailable');
    return new Constructor();
} as unknown as RecognitionConstructor;
