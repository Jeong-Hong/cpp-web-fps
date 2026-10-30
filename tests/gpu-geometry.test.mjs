import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cubeVertices } from '../web/gpu.mjs';
test('unit cube supplies 36 face vertices with unit normals', () => {
  const data=cubeVertices();
  assert.equal(data.length,216);
  for(let i=0;i<data.length;i+=6) {
    for(let j=0;j<3;j++) assert.equal(Math.abs(data[i+j]),0.5);
    assert.equal(data[i+3]**2+data[i+4]**2+data[i+5]**2,1);
  }
});
