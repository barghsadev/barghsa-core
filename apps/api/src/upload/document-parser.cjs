const { parentPort, workerData } = require('node:worker_threads');
const CFB = require('cfb');

function validCsv(bytes) {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (!text.length) return false;
  let state = 'start';
  let fields = 1;
  let expectedFields;
  let rowStarted = false;
  const finishRow = () => {
    expectedFields ??= fields;
    const valid = fields === expectedFields;
    fields = 1;
    rowStarted = false;
    return valid;
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const code = text.charCodeAt(i);
    if ((code < 32 && ![9, 10, 13].includes(code)) || code === 127) return false;
    if (state === 'quoted') {
      if (ch === '"') {
        if (text[i + 1] === '"') i++;
        else state = 'closed';
      }
      continue;
    }
    if (ch === ',' || ch === '\r' || ch === '\n') {
      if (ch === ',') {
        fields++;
        rowStarted = true;
      } else {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        if (!finishRow()) return false;
      }
      state = 'start';
      continue;
    }
    if (state === 'closed' || (ch === '"' && state !== 'start')) return false;
    state = ch === '"' ? 'quoted' : 'unquoted';
    rowStarted = true;
  }
  return state !== 'quoted' && (!rowStarted || finishRow());
}

async function detect(bytes) {
  const signature = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  if (!bytes.subarray(0, 8).equals(signature)) {
    const { fileTypeFromBuffer } = await import('file-type');
    return (await fileTypeFromBuffer(bytes))?.mime ?? null;
  }
  const container = CFB.read(bytes, { type: 'buffer' });
  const root = container.FullPaths[0];
  const stream = (name) => {
    const index = container.FullPaths.indexOf(root + name);
    const entry = container.FileIndex[index];
    return entry?.type === 2 ? Buffer.from(entry.content) : Buffer.alloc(0);
  };
  const word = stream('WordDocument');
  const workbook = stream('Workbook').length ? stream('Workbook') : stream('Book');
  const isWord = word.length >= 32 && word.readUInt16LE(0) === 0xa5ec;
  const isWorkbook =
    workbook.length >= 8 &&
    workbook.readUInt16LE(0) === 0x0809 &&
    [0x0500, 0x0600].includes(workbook.readUInt16LE(4)) &&
    workbook.readUInt16LE(6) === 0x0005;
  // Reject ambiguous compound containers; filenames never decide the format.
  if (isWord === isWorkbook) return null;
  return isWord ? 'application/msword' : 'application/vnd.ms-excel';
}

Promise.resolve()
  .then(() => {
    const bytes = Buffer.from(workerData.bytes);
    return workerData.format === 'csv' ? (validCsv(bytes) ? 'text/csv' : null) : detect(bytes);
  })
  .then(
    (mime) => parentPort.postMessage(mime),
    () => parentPort.postMessage(null)
  );
