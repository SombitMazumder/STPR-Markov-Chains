import assert from 'node:assert/strict';
import {frameStates, populations} from '../web/playback.mjs';

// Two batches, four runs. Batch 1 exits before batch 2; both must remain visible.
const chunks = [
  {offset:0,count:2,frameCount:2,states:Uint8Array.from([0,0,1,2])},
  {offset:2,count:2,frameCount:3,states:Uint8Array.from([0,0,0,1,2,1])}
];
assert.deepEqual([...frameStates(chunks,0,4)], [0,0,0,0]);
assert.deepEqual([...frameStates(chunks,1,4)], [1,2,0,1]);
assert.deepEqual([...frameStates(chunks,2,4)], [1,2,2,1]);
assert.deepEqual([...populations(frameStates(chunks,2,4),3)], [0,2,2]);
// All 200,000 runs are represented, including at the supported UI limit.
const full = [{offset:0,count:200000,frameCount:1,states:new Uint8Array(200000).fill(2)}];
assert.deepEqual([...populations(frameStates(full,200,200000),3)], [0,0,200000]);
console.log('Concurrent playback: all runs, unequal batch lengths, retained destinations, and counts passed.');
