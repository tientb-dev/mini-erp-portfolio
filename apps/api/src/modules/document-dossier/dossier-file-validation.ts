import { BadRequestException } from '@nestjs/common';
import { extname } from 'node:path';
import * as cfb from 'cfb';
import { fromBuffer } from 'yauzl';

const formats: Record<string, string> = {
  '.pdf': 'application/pdf', '.doc': 'application/msword', '.xls': 'application/vnd.ms-excel',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
};

function officeZip(buffer: Buffer, word: boolean): Promise<boolean> {
  const mainPart = word ? 'word/document.xml' : 'xl/workbook.xml';
  const expected = new Map([
    ['[Content_Types].xml', /<(?:\w+:)?Types\b/],
    ['_rels/.rels', /<(?:\w+:)?Relationships\b/],
    [mainPart, word ? /<(?:\w+:)?document\b/ : /<(?:\w+:)?workbook\b/],
  ]);
  return new Promise(resolve => {
    fromBuffer(buffer, { lazyEntries: true, strictFileNames: true }, (error, zip) => {
      if (error || !zip) { resolve(false); return; }
      const parts = new Set<string>();
      const reject = () => { zip.close(); resolve(false); };
      zip.on('error', reject);
      zip.on('entry', entry => {
        if (entry.isEncrypted() || parts.has(entry.fileName)) { reject(); return; }
        parts.add(entry.fileName);
        const root = expected.get(entry.fileName);
        if (!root) { zip.readEntry(); return; }
        const prefixLimit = 16 * 1024;
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) { reject(); return; }
          let prefix = Buffer.alloc(0);
          let done = false;
          const check = () => {
            if (done) return;
            done = true;
            stream.destroy();
            const text = prefix[0] === 0xff && prefix[1] === 0xfe ? prefix.toString('utf16le')
              : prefix[0] === 0xfe && prefix[1] === 0xff ? new TextDecoder('utf-16be').decode(prefix)
                : prefix.toString('utf8');
            if (!root.test(text)) reject();
            else zip.readEntry();
          };
          stream.on('data', (chunk: Buffer) => {
            prefix = Buffer.concat([prefix, chunk.subarray(0, prefixLimit - prefix.length)]);
            if (prefix.length >= prefixLimit) check();
          });
          stream.on('end', check);
          stream.on('error', reject);
        });
      });
      zip.on('end', () => { zip.close(); resolve([...expected.keys()].every(key => parts.has(key))); });
      zip.readEntry();
    });
  });
}

export async function validateDossierFile(name: string, mime: string, bytes: Buffer) {
  const extension = extname(name).toLowerCase();
  const mediaType = formats[extension];
  let valid = false;
  if (mediaType && (mime === mediaType || mime === 'application/octet-stream')) {
    if (extension === '.pdf') valid = /^%PDF-[12]\.\d/.test(bytes.subarray(0, 8).toString('ascii'))
      && /%%EOF\s*$/.test(bytes.subarray(-1024).toString('latin1'));
    if (extension === '.png') valid = bytes.subarray(0, 16).toString('hex') === '89504e470d0a1a0a0000000d49484452'
      && bytes.subarray(-12).toString('hex') === '0000000049454e44ae426082';
    if (mediaType === 'image/jpeg') valid = bytes.subarray(0, 3).toString('hex') === 'ffd8ff'
      && bytes.subarray(-2).toString('hex') === 'ffd9' && bytes.length > 10;
    if (extension === '.docx' || extension === '.xlsx') valid = await officeZip(bytes, extension === '.docx');
    if ((extension === '.doc' || extension === '.xls') && bytes.subarray(0, 8).toString('hex') === 'd0cf11e0a1b11ae1') {
      try {
        const compound = cfb.read(bytes, { type: 'buffer' });
        valid = (extension === '.doc' ? ['/WordDocument'] : ['/Workbook', '/Book'])
          .some(stream => Boolean(cfb.find(compound, stream)?.size));
      } catch { valid = false; }
    }
  }
  if (!valid) throw new BadRequestException('File type, extension or content is invalid. Select a PDF, Word, Excel, JPG or PNG file.');
  return mediaType;
}
