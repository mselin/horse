import { bakeHorse } from './bake.js';

self.onmessage = (e) => {
  const { cell } = e.data;
  const result = bakeHorse({
    cell,
    onProgress: (p, label) => self.postMessage({ type: 'progress', p, label }),
  });
  const transfer = [
    result.positions.buffer,
    result.normals.buffer,
    result.indices.buffer,
    result.skinIndex.buffer,
    result.skinWeight.buffer,
    result.tangent.buffer,
    result.mats.buffer,
    result.aoCurv.buffer,
  ];
  self.postMessage({ type: 'done', result }, transfer);
};
