const { parentPort, workerData } = require('node:worker_threads');
const CFB = require('cfb');

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

detect(Buffer.from(workerData)).then(
  (mime) => parentPort.postMessage(mime),
  () => parentPort.postMessage(null)
);
