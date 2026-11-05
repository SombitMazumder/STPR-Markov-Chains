// Batches can stop at different steps. Completed runs stay at their entry states.
export function frameStates(chunks, step, total) {
  const states = new Uint8Array(total);
  for (const chunk of chunks) {
    const frame = Math.min(step, chunk.frameCount - 1);
    states.set(chunk.states.subarray(frame * chunk.count, (frame + 1) * chunk.count), chunk.offset);
  }
  return states;
}

export function populations(states, stateCount) {
  const counts = new Uint32Array(stateCount);
  for (const state of states) counts[state]++;
  return counts;
}
