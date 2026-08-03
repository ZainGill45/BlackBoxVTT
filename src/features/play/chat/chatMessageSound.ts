import chatMessageSoundUrl from '../../../assets/sounds/ChatMessageSound.wav';

const activeSounds = new Set<HTMLAudioElement>();

/** Play one overlapping-safe copy of the bundled chat notification sound. */
export function playChatMessageSound(): void {
  try {
    const audio = new Audio(chatMessageSoundUrl);
    activeSounds.add(audio);
    const release = () => activeSounds.delete(audio);
    audio.addEventListener('ended', release, { once: true });
    audio.addEventListener('error', release, { once: true });
    void audio.play().catch(release);
  } catch {
    // Audio failures must never interrupt chat delivery.
  }
}
