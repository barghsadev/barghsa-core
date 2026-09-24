import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import PDFDocument from 'pdfkit';

const require = createRequire(__filename);
const font = join(
  dirname(require.resolve('vazirmatn/package.json')),
  'fonts/ttf/Vazirmatn-Regular.ttf'
);
const boldFont = join(
  dirname(require.resolve('vazirmatn/package.json')),
  'fonts/ttf/Vazirmatn-Bold.ttf'
);

export interface ContractPdfInput {
  contractNumber: string;
  versionNumber: number;
  templateName: string;
  text: string;
  createdAt: Date;
}

/** Render only the saved, immutable template text; never reread the current template. */
export async function renderContractPdf(input: ContractPdfInput): Promise<Buffer> {
  const document = new PDFDocument({
    size: 'A4',
    margins: { top: 56, bottom: 62, left: 54, right: 54 },
    bufferPages: true,
    info: {
      Title: input.templateName,
      Subject: `Contract ${input.contractNumber}, version ${input.versionNumber}`,
      CreationDate: input.createdAt,
    },
  });
  const chunks: Buffer[] = [];
  const completed = new Promise<Buffer>((resolve, reject) => {
    document.on('data', (chunk: Buffer) => chunks.push(chunk));
    document.once('error', reject);
    document.once('end', () => resolve(Buffer.concat(chunks)));
  });
  const rtl = /[\u0600-\u06ff]/u.test(input.text);
  const align = rtl ? 'right' : 'left';
  document
    .font(boldFont)
    .fontSize(17)
    .fillColor('#172235')
    .text(input.templateName, {
      align,
      width: 487,
      features: rtl ? ['rtla'] : undefined,
    });
  document.moveDown(0.45);
  document
    .font(font)
    .fontSize(9)
    .fillColor('#536174')
    .text(`#${input.contractNumber}  ·  v${input.versionNumber}`, { align, width: 487 });
  document.moveDown(0.9);
  document
    .strokeColor('#d6dce5')
    .lineWidth(0.7)
    .moveTo(54, document.y)
    .lineTo(541, document.y)
    .stroke();
  document.moveDown(1.1);
  document
    .font(font)
    .fontSize(11)
    .fillColor('#172235')
    .text(input.text.trim(), {
      align,
      width: 487,
      lineGap: 4,
      paragraphGap: 10,
      features: rtl ? ['rtla'] : undefined,
    });
  const pages = document.bufferedPageRange();
  for (let page = 0; page < pages.count; page += 1) {
    document.switchToPage(page);
    document
      .font(font)
      .fontSize(8)
      .fillColor('#697586')
      .text(`${page + 1} / ${pages.count}`, 54, 795, { align: 'center', width: 487 });
  }
  document.end();
  const bytes = await completed;
  if (bytes.length > 50 * 1024 * 1024)
    throw new Error('Generated contract PDF exceeds document limit');
  return bytes;
}
