/**
 * Plays a US-style ringing tone (440 + 480 Hz, 2 s on / 4 s off) in the rep's headset.
 * Conference calls don't get Twilio's own ringing sound, and many phone companies don't
 * send one, so the CRM makes it. Returns a function that stops it.
 */
export function startRingback(volume = 0.08): () => void {
  if (typeof window === "undefined" || !window.AudioContext) return () => {};
  const ctx = new AudioContext();
  const gain = ctx.createGain();
  gain.gain.value = 0;
  gain.connect(ctx.destination);
  const oscillators = [440, 480].map((hz) => {
    const o = ctx.createOscillator();
    o.frequency.value = hz;
    o.connect(gain);
    o.start();
    return o;
  });
  const ring = () => {
    const t = ctx.currentTime;
    gain.gain.setValueAtTime(volume, t);
    gain.gain.setValueAtTime(0, t + 2);
  };
  void ctx.resume();
  ring();
  const timer = setInterval(ring, 6000);
  return () => {
    clearInterval(timer);
    oscillators.forEach((o) => o.stop());
    void ctx.close();
  };
}
